import {terminal, Terminal, Buffer, ScreenBuffer, TextBuffer} from 'terminal-kit';

import { Panel } from './panel';

export class Display {

    public terminal: Terminal

    public rootPanel: Panel<ScreenBuffer>;
    public logPanel: Panel<ScreenBuffer>;
    public logDisplayPanel: Panel.LogDisplay;
    public statusBar: Panel<ScreenBuffer>;
    public queryResults: Panel<ScreenBuffer>;
    public processPanel: Panel<ScreenBuffer>;

    public queryPanel: Panel<TextBuffer>;

    constructor(term?: Terminal) {
        this.terminal = term || terminal;

        this.rootPanel = Panel.createScreenPanel(this.terminal, {
            name: 'root',
            width: this.terminal.width,
            height: this.terminal.height,
        });

        this.logPanel = Panel.createScreenPanel(this.rootPanel.buffer, {
            name: 'log',
            width: 1,
            height: 1,
            flex: { width: true, height: true },
            flexCol: true
        });

        Panel.addChild(this.rootPanel, this.logPanel);

        this.logDisplayPanel = Panel.createLogDisplayPanel(this.logPanel.buffer, {
            name: 'logDisplay',
            width: 1,
            height: 1,
            flex: {width: true, height: true},
        });

        Panel.addChild(this.logPanel, this.logDisplayPanel);

        /*
        Panel.addChild(this.logPanel, Panel.createScreenPanel(this.logPanel.buffer, {
            name: 'log1',
            width: 1,
            height: 1,
            flex: { width: true, height: true },
        }));
        Panel.addChild(this.logPanel, Panel.createScreenPanel(this.logPanel.buffer, {
            name: 'log2',
            width: 1,
            height: 1,
            flex: { width: true, height: true },
        }));
        */

        this.statusBar = Panel.createScreenPanel(this.rootPanel.buffer, {
            name: 'statusbar',
            width: 1,
            height: 1,
            flex: { width: true },
            flexCol: true,
        });
        Panel.addChild(this.rootPanel, this.statusBar);

        this.queryResults = Panel.createScreenPanel(this.rootPanel.buffer, {
            name: 'queryresults',
            width: 5,
            height: 1,
        });
        Panel.addChild(this.statusBar, this.queryResults);

        this.processPanel = Panel.createScreenPanel(this.rootPanel.buffer, {
            name: 'processes',
            width: 1,
            height: 1,
            flex: { width: true }
        });
        Panel.addChild(this.statusBar, this.processPanel);

        this.queryPanel = Panel.createTextPanel(this.rootPanel.buffer, {
            name: 'query',
            width: 1,
            height: 1,
            flex: { width: true }
        });
        Panel.addChild(this.rootPanel, this.queryPanel);

        Panel.resize(this.rootPanel);

        this.terminal.on('resize', (width: number, height: number) => {
            this.rootPanel.options.width = width;
            this.rootPanel.options.height = height;
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
        this.logDisplayPanel.idxPanel.buffer.dst.fill({char: '3', attr: {color: 'black', bgColor: 'green'}});
        this.logDisplayPanel.logPanel.buffer.dst.fill({char: '4', attr: {color: 'black', bgColor: 'blue'}});
        // this.statusBar.buffer.fill({char: '5', attr: {color: 'black', bgColor: 'green'}});
        // this.queryResults.buffer.fill({char: '6', attr: {color: 'black', bgColor: 'brightred'}});
        // this.processPanel.buffer.fill({char: '7', attr: {color: 'black', bgColor: 'yellow'}});
        // this.queryPanel.buffer.dst.fill({char: '8', attr: {color: 'black', bgColor: 'white'}});

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
