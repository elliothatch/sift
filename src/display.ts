import {terminal, Terminal, Buffer, ScreenBuffer, TextBuffer} from 'terminal-kit';

import { ScreenPanel, TextPanel } from './panel';
import { LogDisplayPanel } from './logdisplaypanel';
import { CommandPanel } from './commandpanel';
import { FilterPanel } from './filterpanel';

export class Display {

    public terminal: Terminal

    public rootPanel: ScreenPanel;
    public logPanel: ScreenPanel;
    public logDisplayPanel: LogDisplayPanel;
    public statusBar: ScreenPanel;
    public queryResults: TextPanel;
    public fuzzyThreshold: TextPanel;
    public processPanel: ScreenPanel;
    public queryBar: ScreenPanel;
    public queryPanel: TextPanel;

    public commandPanel: CommandPanel;
    public filterPanel: FilterPanel;

    constructor(term?: Terminal) {
        this.terminal = term || terminal;

        this.rootPanel = new ScreenPanel(this.terminal, {
            name: 'root',
            width: this.terminal.width,
            height: this.terminal.height,
            drawCursor: true,
        });

        this.logPanel = new ScreenPanel(this.rootPanel.buffer, {
            name: 'log',
            width: 1,
            height: 1,
            flex: { width: true, height: true },
            flexCol: true
        });

        this.rootPanel.addChild(this.logPanel);

        this.logDisplayPanel = new LogDisplayPanel(this.logPanel.buffer, {
            name: 'logDisplay',
            width: 1,
            height: 1,
            flex: {width: true, height: true},
        });

        this.logPanel.addChild(this.logDisplayPanel);

        /*
        Panel.addChild(this.logPanel, new ScreenPanel(this.logPanel.buffer, {
            name: 'log1',
            width: 1,
            height: 1,
            flex: { width: true, height: true },
        }));
        Panel.addChild(this.logPanel, new ScreenPanel(this.logPanel.buffer, {
            name: 'log2',
            width: 1,
            height: 1,
            flex: { width: true, height: true },
        }));
        */

        this.statusBar = new ScreenPanel(this.rootPanel.buffer, {
            name: 'statusbar',
            width: 1,
            height: 1,
            flex: { width: true },
            flexCol: true,
        });
        this.rootPanel.addChild(this.statusBar);

        this.queryResults = new TextPanel(this.rootPanel.buffer, {
            name: 'queryresults',
            width: 1,
            height: 1,
            flex: { width: true}
        });
        this.statusBar.addChild(this.queryResults);

        this.fuzzyThreshold = new TextPanel(this.rootPanel.buffer, {
            name: 'fuzzythreshold',
            width: 2,
            height: 1,
        });
        this.statusBar.addChild(this.fuzzyThreshold);

        this.processPanel = new ScreenPanel(this.rootPanel.buffer, {
            name: 'processes',
            width: 1,
            height: 1,
            flex: { width: true }
        });
        this.statusBar.addChild(this.processPanel);

        this.queryBar = new ScreenPanel(this.rootPanel.buffer, {
            name: 'querybar',
            width: 1,
            height: 1,
            flex: { width: true },
            flexCol: true,
            drawCursor: true
        });
        this.rootPanel.addChild(this.queryBar);
        const queryPromptPanel = new ScreenPanel(this.rootPanel.buffer, {
            name: 'queryprompt',
            width: 2,
            height: 1,
        });
        this.queryBar.addChild(queryPromptPanel);
        (queryPromptPanel.buffer as any).put({x: 0, y: 0}, '>');
        (queryPromptPanel.buffer as any).put({x: 1, y: 0}, ' ');


        this.queryPanel = new TextPanel(this.rootPanel.buffer, {
            name: 'query',
            width: 1,
            height: 1,
            flex: { width: true },
            drawCursor: true,
        });
        this.queryBar.addChild(this.queryPanel);

        this.commandPanel = new CommandPanel(this.rootPanel.buffer, {
            name: 'command',
            width: 1,
            height: 1,
            flex: {width: true},
        });

        this.filterPanel = new FilterPanel(this.rootPanel.buffer, {
            name: 'filter',
            width: 1,
            height: 1,
            flex: {width: true},
        });

        this.rootPanel.resize();

        this.terminal.on('resize', (width: number, height: number) => {
            this.rootPanel.options.width = width;
            this.rootPanel.options.height = height;
            this.rootPanel.resize();

            // TODO: we need to make an abstract "print" function for panels
            // that will forcably clear and reprint the entire panel
            // otherwise, we get weird artifacts when resizing
            // we will have to isolate all the drawing calls we stuck randomly
            // around index.ts into panel code
            this.logDisplayPanel.logEntryCache.clear();
            this.logDisplayPanel.print();
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
        // this.logDisplayPanel.idxPanel.buffer.dst.fill({char: '3', attr: {color: 'black', bgColor: 'green'}});
        // this.logDisplayPanel.logPanel.buffer.dst.fill({char: '4', attr: {color: 'black', bgColor: 'blue'}});
        // this.statusBar.buffer.fill({char: '5', attr: {color: 'black', bgColor: 'green'}});
        // this.queryResults.buffer.fill({char: '6', attr: {color: 'black', bgColor: 'brightred'}});
        // this.processPanel.buffer.fill({char: '7', attr: {color: 'black', bgColor: 'yellow'}});
        // this.queryPanel.buffer.dst.fill({char: '8', attr: {color: 'black', bgColor: 'white'}});

        this.rootPanel.redrawChildren();
    }

    public showCommandPanel() {
        if(this.commandPanel.parent !== undefined) {
            return;
        }

        this.rootPanel.addChild(this.commandPanel);
        this.rootPanel.resize();
        this.queryBar.draw();
        this.commandPanel.printCommands();
        this.commandPanel.redrawChildren();
        this.commandPanel.draw();
        (this.terminal as any).hideCursor();
    }

    public hideCommandPanel() {
        this.rootPanel.removeChild(this.commandPanel);
        this.rootPanel.resize();
        this.rootPanel.redrawChildren();
        (this.terminal as any).hideCursor(false);
    }

    public showFilterPanel() {
        if(this.filterPanel.parent !== undefined) {
            return;
        }

        this.rootPanel.addChild(this.filterPanel);
        this.rootPanel.resize();
        this.queryBar.draw();
        this.filterPanel.printRules();
        this.filterPanel.redrawChildren();
        this.filterPanel.draw();
        (this.terminal as any).hideCursor();
    }

    public hideFilterPanel() {
        this.rootPanel.removeChild(this.filterPanel);
        this.rootPanel.resize();
        this.rootPanel.redrawChildren();
        (this.terminal as any).hideCursor(false);
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
