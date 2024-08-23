import {terminal, Terminal} from 'terminal-kit';
import { Subscription } from 'rxjs';


import { ScreenPanel, TextPanel } from './panel';
import { CommandPanel } from './commandpanel';
import { FilterPanel } from './filterpanel';
import { FormatPanel } from './formatpanel';
import { LogStreamPanel } from './logstreampanel';

/** manages the display
* most command that alter the UI don't actually redraw. instead we manually call display.draw() in sift actions that trigger those updates. this prevents flickering when an action changes multiple UI elements at once.
*/
export class Display {

    public terminal: Terminal

    public rootPanel: ScreenPanel;
    public logPanel: ScreenPanel;

    public queryKeyPanel: TextPanel;
    public commandPanel: CommandPanel;
    public filterPanel: FilterPanel;
    public formatPanel: FormatPanel;

    public logStreamPanels: {panel: LogStreamPanel, redrawSubscription: Subscription}[];
    public logStreamPanelIndex: number = 0;

    /** used for arbitrary textual input */
    public textPanel: ScreenPanel;
    public textPromptArrowPanel: ScreenPanel;
    public textLabelPanel: TextPanel;
    public textInputPanel: TextPanel;

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

        this.queryKeyPanel = new TextPanel(this.rootPanel.buffer, {
            name: 'query-keys',
            width: 1,
            height: 1,
            flex: {width: true}
        }, () => {
            (this.queryKeyPanel.buffer as any).setText('');
            (this.queryKeyPanel.buffer as any).moveTo(0, 0);
            // TODO: instead of hardcoding these values, get them from the input bindings? probably not worth it.
            const bindings = [
                ['CTRL_C', 'EXIT'],
                ['\\', 'COMMANDS'],
                ['↑↓←→', 'SCROLL'],
                ['SHIFT_←→', 'MOVE CURSOR'],
                ['SHIFT_PGUP/PGDN', 'FUZZY THRESH'],
            ];
            bindings.forEach(([binding, command]) => {
                this.queryKeyPanel.buffer.insert(binding, {inverse: true, bold: true});
                this.queryKeyPanel.buffer.insert(' ' + command);
                this.queryKeyPanel.buffer.insert('   ');
            });
        });

        this.rootPanel.addChild(this.queryKeyPanel);

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

        this.formatPanel = new FormatPanel(this.rootPanel.buffer, {
            name: 'format',
            width: 1,
            height: 1,
            flex: {width: true},
        });

        this.textPanel = new ScreenPanel(this.rootPanel.buffer, {
            name: `textPanel`,
            width: 1,
            height: 1,
            flex: {
                width: true,
            },
            drawCursor: true,
            flexCol: true,
        });

        this.textPromptArrowPanel = new ScreenPanel(this.textPanel.buffer, {
            name: `textPanel.promptArrow`,
            width: 2,
            height: 1
        }, () => {
            (this.textPromptArrowPanel.buffer as any).put({x: 0, y: 0}, '>');
            (this.textPromptArrowPanel.buffer as any).put({x: 1, y: 0}, ' ');
        });

        this.textLabelPanel = new TextPanel(this.textPanel.buffer, {
            name: `textPanel.label`,
            width: 1,
            height: 1,
        });

        this.textInputPanel = new TextPanel(this.rootPanel.buffer, {
            name: `textPanel.input`,
            width: 1,
            height: 1,
            flex: {
                width: true,
            },
            drawCursor: true
        });

        this.textPanel.addChild(this.textPromptArrowPanel);
        this.textPanel.addChild(this.textLabelPanel);
        this.textPanel.addChild(this.textInputPanel);

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

    public shutdown() {
        this.terminal.fullscreen(false);
        this.terminal.grabInput(false);
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

        this.logPanel.addChild(panel);
        this.logPanel.resize();
    }

    public hideLogStreamPanel(panel: LogStreamPanel): boolean {
        const panelIndex = this.logStreamPanels.findIndex((p) => p.panel === panel);
        if(panelIndex === -1) {
            return false;
        }

        this.logStreamPanels[panelIndex].redrawSubscription.unsubscribe();

        this.logStreamPanels.splice(panelIndex, 1);
        this.logPanel.removeChild(panel);

        this.logPanel.resize();

        if(panelIndex === this.logStreamPanelIndex) {
            panel.setSelected(false);

            this.logStreamPanelIndex = Math.max(0, Math.min(this.logStreamPanels.length - 1, panelIndex));
            if(this.logStreamPanels.length > 0) {
                const newPanel = this.logStreamPanels[this.logStreamPanelIndex].panel;
                newPanel.setSelected(true);
            }
        }
        else if(panelIndex < this.logStreamPanelIndex) {
            this.logStreamPanelIndex -= 1;
        }

        // all panels were marked dirty by resize
        return true;
    }

    public selectLogStreamPanel(index: number) {
        if(this.logStreamPanels.length > 1) {
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
        if(this.rootPanel.removeChild(this.commandPanel)) {
            this.rootPanel.resize();
            (this.terminal as any).hideCursor(false);
        }
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
        if(this.rootPanel.removeChild(this.filterPanel)) {
            this.rootPanel.resize();
            (this.terminal as any).hideCursor(false);
        }
    }

    public showFormatPanel() {
        if(this.formatPanel.parent !== undefined) {
            return;
        }

        this.rootPanel.addChild(this.formatPanel);
        this.rootPanel.resize();
        (this.terminal as any).hideCursor();
    }

    public hideFormatPanel() {
        if(this.rootPanel.removeChild(this.formatPanel)) {
            this.rootPanel.resize();
            (this.terminal as any).hideCursor(false);
        }
    }

    public showTextPanel() {
        if(this.textPanel.parent !== undefined) {
            return;
        }

        this.rootPanel.addChild(this.textPanel);
        this.rootPanel.resize();

        this.logPanel.options.drawCursor = false;
        (this.terminal as any).hideCursor(false);
    }

    public hideTextPanel() {
        if(this.rootPanel.removeChild(this.textPanel)) {
            this.rootPanel.resize();

            this.logPanel.options.drawCursor = true;
            (this.terminal as any).hideCursor();
        }
    }

    public showQueryKeyPanel() {
        if(this.queryKeyPanel.parent !== undefined) {
            return;
        }

        this.rootPanel.addChild(this.queryKeyPanel);
        this.rootPanel.resize();
    }

    public hideQueryKeyPanel() {
        if(this.rootPanel.removeChild(this.queryKeyPanel)) {
            this.rootPanel.resize();
        }
    }

}
