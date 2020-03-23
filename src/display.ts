import {terminal, Terminal, ScreenBuffer, TextBuffer} from 'terminal-kit';

export namespace Panel {
    export interface Options {
        width: number;
        height: number;
    }

    export class Screen {
        options: Options;
        buffer: ScreenBuffer;
        constructor(options: Options) {
            this.options = options;
            this.buffer = new ScreenBuffer(options);
        }
    }

    export class Text {
        buffer: TextBuffer;
        constructor(options: Options) {
            this.buffer = new TextBuffer(options);
        }
    }

    export function addChild(parent: Panel, child: Panel) {
        if(!parent.children) {
            parent.children = [];
        }
        parent.children.push(child);
        child.buffer.dst = parent.buffer;
    };

    /** draw the buffer and all its parents */
    export function draw(panel: Panel) {
        let currentBuffer = panel.buffer;
        while(currentBuffer && currentBuffer instanceof ScreenBuffer) {
            currentBuffer.draw();
            currentBuffer.drawCursor();
            currentBuffer = currentBuffer.dst as ScreenBuffer;
        }
    }

    /** draw all children in a post-DFS order */
    export function redrawChildren(panel: Panel) {
        if(panel.children) {
            panel.children.forEach(redrawChildren);
        }
        panel.buffer.draw();
        panel.buffer.drawCursor();
    }

    /** recalculate the size of a panel and its children */
    export function resize(panel: Panel) {
        if(!panel.flex || !panel.flex.width) {
            panel.calculatedWidth = panel.width;
        }

        if(!panel.flex || !panel.flex.height) {
            panel.calculatedHeight = panel.height;
        }

        if(panel.calculatedHeight == undefined || panel.calculatedWidth == undefined) {
            throw new Error(`Panel.resize: panel '${panel.name}' has flex '${panel.flex}', but does not have its own width/height calculated. Ensure Panel.resize() has been drawn on the parent of '${panel.name}', or disable flex on this panel`);
        }

        panel.buffer.resize({
            x: 0,
            y: 0,
            width: panel.calculatedWidth!,
            height: panel.calculatedHeight!,
        });

        if(panel.children) {
            const flexChildren: Panel[] = [];
            const fixedChildren: Panel[] = [];
            panel.children.forEach((child) => {
                if((panel.flexCol && child.flex && child.flex.width)
                    || !panel.flexCol && child.flex && child.flex.height) {
                    flexChildren.push(child);
                }
                else {
                    fixedChildren.push(child);
                }
            });

            const fixedSize = fixedChildren.reduce(
                (sum, child) => sum + (panel.flexCol? child.width: child.height),
                0
            );

            const flexSize = 
                (panel.flexCol? panel.calculatedWidth || 0 : panel.calculatedHeight || 0)
                - fixedSize;
            const flexGrowSum = flexChildren.reduce(
                (sum, child) => sum + (panel.flexCol? child.width: child.height),
                0
            );

            // resize the children
            let position = 0;

            panel.children.forEach((child) => {
                if(panel.flexCol) {
                    child.calculatedWidth = child.flex && child.flex.width?
                        Math.floor(flexSize * (child.width / flexGrowSum)):
                        child.width;

                    child.calculatedHeight = child.flex && child.flex.height?
                        panel.calculatedHeight:
                        child.height;

                    child.buffer.x = position;
                    child.buffer.y = 0;
                    position += child.calculatedWidth;
                }
                else {
                    child.calculatedHeight = child.flex && child.flex.height?
                        Math.floor(flexSize * (child.height / flexGrowSum)):
                        child.height;
                    child.calculatedWidth = child.flex && child.flex.width?
                        panel.calculatedWidth:
                        child.width;

                    child.buffer.x = 0;
                    child.buffer.y = position;
                    position += child.calculatedHeight;
                }

                resize(child);
            });
        }
    }
}

export interface Panel {
    /** name used for identification in error messages */
    name?: string;
    buffer: ScreenBuffer | TextBuffer;
    width: number;
    height: number;
    /** if true, width/height is used as a grow factor to fill remaining space */
    flex?: {
        width?: boolean;
        height?: boolean;
    };
    /** if true, children will be rendered left-to-right instead of top-to-bottom */
    flexCol?: boolean;

    calculatedHeight?: number;
    calculatedWidth?: number;

    children?: Panel[];
}


export class Display {

    public terminal: Terminal

    public rootPanel: Panel;
    public logPanel: Panel;
    public statusBar: Panel;
    public queryResults: Panel;
    public processPanel: Panel;

    public queryPanel: Panel;

    constructor() {
        this.terminal = terminal;

        this.rootPanel = {
            name: 'root',
            buffer: new ScreenBuffer({dst: this.terminal}),
            width: this.terminal.width,
            height: this.terminal.height,
        };

        this.logPanel = {
            name: 'log',
            buffer: new ScreenBuffer({dst: this.terminal}),
            width: 1,
            height: 1,
            flex: { width: true, height: true },
            flexCol: true
        };
        Panel.addChild(this.rootPanel, this.logPanel);
        Panel.addChild(this.logPanel, {
            name: 'log1',
            buffer: new ScreenBuffer({dst: this.terminal}),
            width: 1,
            height: 1,
            flex: { width: true, height: true },
        });
        Panel.addChild(this.logPanel, {
            name: 'log2',
            buffer: new ScreenBuffer({dst: this.terminal}),
            width: 1,
            height: 1,
            flex: { width: true, height: true },
        });


        this.statusBar = {
            name: 'statusbar',
            buffer: new ScreenBuffer({dst: this.terminal}),
            width: 1,
            height: 1,
            flex: { width: true },
            flexCol: true,
        };
        Panel.addChild(this.rootPanel, this.statusBar);

        this.queryResults = {
            name: 'queryresults',
            buffer: new ScreenBuffer({dst: this.terminal}),
            width: 5,
            height: 1,
        };
        Panel.addChild(this.statusBar, this.queryResults);

        this.processPanel = {
            name: 'processes',
            buffer: new ScreenBuffer({dst: this.terminal}),
            width: 1,
            height: 1,
            flex: { width: true }
        };
        Panel.addChild(this.statusBar, this.processPanel);

        this.queryPanel = {
            name: 'query',
            buffer: new ScreenBuffer({dst: this.terminal}),
            width: 1,
            height: 1,
            flex: { width: true }
        };
        Panel.addChild(this.rootPanel, this.queryPanel);

        Panel.resize(this.rootPanel);

        this.terminal.on('resize', (width: number, height: number) => {
            this.rootPanel.width = width;
            this.rootPanel.height = height;
            Panel.resize(this.rootPanel);
            this.draw();
        });
    }

    public init() {
        this.terminal.fullscreen(true);
        this.terminal.grabInput(true);
    }

    public draw() {
        this.rootPanel.buffer.fill({char: '1', attr: {color: 'black', bgColor: 'red'}});
        this.logPanel.buffer.fill({char: '2', attr: {color: 'black', bgColor: 'green'}});
        this.logPanel.children![0].buffer.fill({char: '3', attr: {color: 'black', bgColor: 'blue'}});
        this.logPanel.children![1].buffer.fill({char: '4', attr: {color: 'black', bgColor: 'yellow'}});
        this.statusBar.buffer.fill({char: '5', attr: {color: 'black', bgColor: 'green'}});
        this.queryResults.buffer.fill({char: '6', attr: {color: 'black', bgColor: 'brightred'}});
        this.processPanel.buffer.fill({char: '7', attr: {color: 'black', bgColor: 'yellow'}});
        this.queryPanel.buffer.fill({char: '8', attr: {color: 'black', bgColor: 'white'}});

        Panel.redrawChildren(this.rootPanel);
    }
}

/**
1
2
3
4
5 
    {
        abc
    }
6
7
8
9
10
100
  30/58   | RUNNING node | EXITED node2 |
> myquery&yourquery
 */
