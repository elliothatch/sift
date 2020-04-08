import {terminal, Terminal, Buffer, ScreenBuffer, TextBuffer} from 'terminal-kit';

export namespace Panel {
    export function addChild(parent: Panel<Buffer>, child: Panel<Buffer>) {
        if(!parent.children) {
            parent.children = [];
        }
        parent.children.push(child);
        getScreenBuffer(child.buffer).dst = getScreenBuffer(parent.buffer);
    };

    /** draw the buffer and all its parents */
    export function draw(panel: Panel<Buffer>) {
        let currentBuffer = panel.buffer;
        while(currentBuffer && currentBuffer instanceof ScreenBuffer || currentBuffer instanceof TextBuffer) {
            currentBuffer.draw();
            currentBuffer.drawCursor();
            currentBuffer = currentBuffer.dst as ScreenBuffer;
        }
    }

    /** draw all children in a post-DFS order */
    export function redrawChildren(panel: Panel<Buffer>) {
        if(panel.children) {
            panel.children.forEach(redrawChildren);
        }
        panel.buffer.draw();
        panel.buffer.drawCursor();
    }

    /** returns the screen buffer if it is one, or the dst buffer of a TextBuffer */
    export function getScreenBuffer(buffer: Buffer): ScreenBuffer {
        return buffer instanceof ScreenBuffer? buffer: buffer.dst;
    }

    /** recalculate the size of a panel and its children */
    export function resize(panel: Panel<Buffer>) {
        if(!panel.flex || !panel.flex.width) {
            panel.calculatedWidth = panel.width;
        }

        if(!panel.flex || !panel.flex.height) {
            panel.calculatedHeight = panel.height;
        }

        if(panel.calculatedHeight == undefined || panel.calculatedWidth == undefined) {
            throw new Error(`Panel.resize: panel '${panel.name}' has flex '${panel.flex}', but does not have its own width/height calculated. Ensure Panel.resize() has been drawn on the parent of '${panel.name}', or disable flex on this panel`);
        }

        getScreenBuffer(panel.buffer).resize({
            x: 0,
            y: 0,
            width: panel.calculatedWidth!,
            height: panel.calculatedHeight!,
        });

        if(panel.children) {
            const flexChildren: Panel<Buffer>[] = [];
            const fixedChildren: Panel<Buffer>[] = [];
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
                const screenBuffer = getScreenBuffer(child.buffer);
                if(panel.flexCol) {
                    child.calculatedWidth = child.flex && child.flex.width?
                        Math.round(flexSize * (child.width / flexGrowSum)):
                        child.width;

                    child.calculatedHeight = child.flex && child.flex.height?
                        panel.calculatedHeight:
                        child.height;

                    screenBuffer.x = position;
                    screenBuffer.y = 0;
                    position += child.calculatedWidth;
                }
                else {
                    child.calculatedHeight = child.flex && child.flex.height?
                        Math.round(flexSize * (child.height / flexGrowSum)):
                        child.height;
                    child.calculatedWidth = child.flex && child.flex.width?
                        panel.calculatedWidth:
                        child.width;

                    screenBuffer.x = 0;
                    screenBuffer.y = position;
                    position += child.calculatedHeight;
                }

                resize(child);
            });
        }
    }
}

export interface Panel<T extends Buffer> {
    /** name used for identification in error messages */
    name?: string;
    buffer: T;
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

    children?: Panel<Buffer>[];
}


export class Display {

    public terminal: Terminal

    public rootPanel: Panel<ScreenBuffer>;
    public logPanel: Panel<ScreenBuffer>;
    public statusBar: Panel<ScreenBuffer>;
    public queryResults: Panel<ScreenBuffer>;
    public processPanel: Panel<ScreenBuffer>;

    public queryPanel: Panel<TextBuffer>;

    constructor(term?: Terminal) {
        this.terminal = term || terminal;

        this.rootPanel = {
            name: 'root',
            buffer: new ScreenBuffer({dst: this.terminal}),
            width: this.terminal.width,
            height: this.terminal.height,
        };

        this.logPanel = {
            name: 'log',
            buffer: new ScreenBuffer({dst: this.rootPanel}),
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
            buffer: new TextBuffer({dst: new ScreenBuffer({dst: this.terminal})}),
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
        // this.rootPanel.buffer.fill({char: '1', attr: {color: 'black', bgColor: 'red'}});
        // this.logPanel.buffer.fill({char: '2', attr: {color: 'black', bgColor: 'green'}});
        // (this.logPanel.children![0].buffer as ScreenBuffer).fill({char: '3', attr: {color: 'black', bgColor: 'blue'}});
        // (this.logPanel.children![1].buffer as ScreenBuffer).fill({char: '4', attr: {color: 'black', bgColor: 'yellow'}});
        // this.statusBar.buffer.fill({char: '5', attr: {color: 'black', bgColor: 'green'}});
        // this.queryResults.buffer.fill({char: '6', attr: {color: 'black', bgColor: 'brightred'}});
        // this.processPanel.buffer.fill({char: '7', attr: {color: 'black', bgColor: 'yellow'}});
        // this.queryPanel.buffer.fill({char: '8', attr: {color: 'black', bgColor: 'white'}});

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
