import {terminal, Terminal} from 'terminal-kit';
import { Subscription } from 'rxjs';


import { ScreenPanel } from './panel';
import { CommandPanel } from './commandpanel';
import { FilterPanel } from './filterpanel';
import { LogStreamPanel } from './logstreampanel';

/** manages the display
* most command that alter the UI don't actually redraw. instead we manually call display.draw() in sift actions that trigger those updates. this prevents flickering when an action changes multiple UI elements at once.
*/
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

            this.draw();
        });
    }

    public init() {
        this.terminal.fullscreen(true);
        this.terminal.grabInput(true);
    }

    public draw() {
        // update panel UI
        this.rootPanel.draw();
        // draw to terminal
        this.rootPanel.drawToParent(false);
    }

    public showLogStreamPanel(panel: LogStreamPanel) {
        this.logStreamPanels.push({
            panel,
            redrawSubscription: panel.redrawEvents.subscribe(() => {
                this.draw();
            })
        });

        panel.options.drawCursor = true;
        this.logPanel.addChild(panel);
        this.logPanel.resize();
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
            panel.setSelected(false);

            this.logStreamPanelIndex = Math.max(0, Math.min(this.logStreamPanels.length - 1, panelIndex));
            const newPanel = this.logStreamPanels[this.logStreamPanelIndex].panel;
            newPanel.setSelected(true);
        }

        // all panels were marked dirty by resize
        return true;
    }

    public selectLogStreamPanel(index: number) {
        if(this.logStreamPanels.length > 0) {
            const prevPanel = this.logStreamPanels[this.logStreamPanelIndex].panel;
            this.logStreamPanelIndex = Math.max(0, Math.min(this.logStreamPanels.length - 1, index));
            const newPanel = this.logStreamPanels[this.logStreamPanelIndex].panel;

            prevPanel.setSelected(false);
            newPanel.setSelected(true);
        }
    }

    public showCommandPanel() {
        if(this.commandPanel.parent !== undefined) {
            return;
        }

        this.rootPanel.addChild(this.commandPanel);
        this.rootPanel.resize();
        (this.terminal as any).hideCursor();
    }

    public hideCommandPanel() {
        this.rootPanel.removeChild(this.commandPanel);
        this.rootPanel.resize();
        (this.terminal as any).hideCursor(false);
    }

    public showFilterPanel() {
        if(this.filterPanel.parent !== undefined) {
            return;
        }

        this.rootPanel.addChild(this.filterPanel);
        this.rootPanel.resize();
        (this.terminal as any).hideCursor();
    }

    public hideFilterPanel() {
        this.rootPanel.removeChild(this.filterPanel);
        this.rootPanel.resize();
        (this.terminal as any).hideCursor(false);
    }
}
