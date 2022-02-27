import {terminal, Terminal, Buffer, ScreenBuffer, TextBuffer} from 'terminal-kit';
import { Subscription } from 'rxjs';

import { LogStream } from './logstream';

import { ScreenPanel, TextPanel } from './panel';
import { LogDisplayPanel } from './logdisplaypanel';
import { CommandPanel } from './commandpanel';
import { FilterPanel } from './filterpanel';
import { LogStreamPanel } from './logstreampanel';

export class Display {

    public terminal: Terminal

    public rootPanel: ScreenPanel;
    public logPanel: ScreenPanel;

    public commandPanel: CommandPanel;
    public filterPanel: FilterPanel;

    public logStreamPanels: {panel: LogStreamPanel, redrawSubscription: Subscription}[];
    public logStreamPanelIndex: number = 0;

    constructor(term?: Terminal) {
        this.terminal = term || terminal;

        this.logStreamPanels = [];

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
            flexCol: true,
            drawCursor: true
        });

        this.rootPanel.addChild(this.logPanel);

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
            this.logPanel.children.forEach((logDisplayPanel) => {
                if(logDisplayPanel instanceof LogDisplayPanel) {
                    logDisplayPanel.logEntryCache.clear();
                    logDisplayPanel.print();
                }
            });

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

        this.rootPanel.redrawChildren();
    }

    public showLogStreamPanel(panel: LogStreamPanel) {
        this.logStreamPanels.push({
            panel,
            redrawSubscription: panel.redrawEvents.subscribe(() => {
                panel.redrawChildren();
                panel.draw();
            })
        });

        panel.options.drawCursor = true;
        this.logPanel.addChild(panel);
        this.logPanel.resize();

        this.logPanel.children.forEach((logDisplayPanel) => {
            if(logDisplayPanel instanceof LogDisplayPanel) {
                logDisplayPanel.logEntryCache.clear();
                logDisplayPanel.print();
            }
        });

        this.draw();
    }

    public hideLogStreamPanel(panel: LogStreamPanel): boolean {
        const panelIndex = this.logStreamPanels.findIndex((p) => p.panel === panel);
        if(panelIndex === -1) {
            return false;
        }

        this.logStreamPanels[panelIndex].redrawSubscription.unsubscribe();
        panel.options.drawCursor = false;

        this.logStreamPanels.splice(panelIndex, 1);
        this.logPanel.removeChild(panel);

        this.logPanel.resize();

        if(panelIndex === this.logStreamPanelIndex) {
            panel.selected = false;
            panel.printTitle();

            this.logStreamPanelIndex = Math.max(0, Math.min(this.logStreamPanels.length - 1, panelIndex));
            const newPanel = this.logStreamPanels[this.logStreamPanelIndex].panel;
            newPanel.selected = true;
            newPanel.printTitle();
        }

        this.logPanel.children.forEach((logDisplayPanel) => {
            if(logDisplayPanel instanceof LogDisplayPanel) {
                logDisplayPanel.logEntryCache.clear();
                logDisplayPanel.print();
            }
        });
        this.draw();
        return true;
    }

    public selectLogStreamPanel(index: number) {
        if(this.logStreamPanels.length > 0) {
            const prevPanel = this.logStreamPanels[this.logStreamPanelIndex].panel;
            this.logStreamPanelIndex = Math.max(0, Math.min(this.logStreamPanels.length - 1, index));
            const newPanel = this.logStreamPanels[this.logStreamPanelIndex].panel;

            prevPanel.selected = false;
            prevPanel.printTitle();

            newPanel.selected = true;
            newPanel.printTitle();

            this.draw();
        }
    }

    public showCommandPanel() {
        if(this.commandPanel.parent !== undefined) {
            return;
        }

        this.rootPanel.addChild(this.commandPanel);
        this.rootPanel.resize();
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
        // this.queryBar.draw();
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
