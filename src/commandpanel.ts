import {Attributes, Terminal, Buffer, ScreenBuffer, TextBuffer} from 'terminal-kit';

import { Panel, ScreenPanel, TextPanel } from './panel';

export class CommandPanel extends Panel<ScreenBuffer> {
    public keyPanel: ScreenPanel;
    public descriptionPanel: TextPanel;

    public commands: Command[] = [];

    constructor(dst: Buffer | Terminal, options: Panel.Options) {
        super({...options, flexCol: true}, new ScreenBuffer({
            dst,
            width: options.width,
            height: options.height,
        }));

        this.keyPanel = new ScreenPanel(this.buffer, {
            name: `${this.options.name? this.options.name: ''}.keyPanel`,
            width: 5,
            height: 1,
            flex: {
                height: true,
            }
        });

        this.descriptionPanel = new TextPanel(this.buffer, {
            name: `${this.options.name? this.options.name: ''}.descriptionPanel`,
            width: 1,
            height: 1,
            flex: {
                width: true,
                height: true,
            },
        });

        this.addChild(this.keyPanel);
        this.addChild(this.descriptionPanel);

    }

    public getScreenBuffer(): ScreenBuffer {
        return this.buffer;
    }

    public setCommands(commands: Command[]): void {
        this.commands = commands;
        if(this.options.height !== this.commands.length) {
            this.options.height = this.commands.length
            if(this.parent) {
                this.parent.resize();
            }
        }
    }

    public printCommands(): void {
        this.keyPanel.buffer.fill({char: ' '});
        (this.keyPanel.buffer as any).moveTo(1,0);

        (this.descriptionPanel.buffer as any).setText('');
        (this.descriptionPanel.buffer as any).moveTo(0,0);

        this.commands.forEach((command) => {
            (this.keyPanel.buffer as any).put({
                attr: {bold: true},
                dx: 0,
                dy: 1
            }, command.key);

            this.descriptionPanel.buffer.insert(command.description);
            this.descriptionPanel.buffer.newLine();
        });
        
    }
}

export namespace CommandPanel {
    export interface Options {
        commands: Command[];
    }
}

export interface Command {
    key: string;
    description: string;
    /** args from terminal.on */
    action: (key: any, matches: any, data: any) => void;
}
