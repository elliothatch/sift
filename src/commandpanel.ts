import {Attributes, Terminal, Buffer, ScreenBuffer, TextBuffer} from 'terminal-kit';

import { Panel, ScreenPanel, TextPanel } from './panel';
import { Input } from './input';

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

    public render: () => void = () => {
        // clear
        this.keyPanel.buffer.fill({char: ' '});
        (this.descriptionPanel.buffer as any).setText('');

        // title row
        (this.keyPanel.buffer as any).fill({
            char: ' ',
            region: {
                x: 0,
                y: 0,
                width: this.keyPanel.calculatedWidth,
                height: 1
            },
            attr: {underline: true}
        });
        (this.keyPanel.buffer as any).put({
            x: 0,
            y: 0,
            attr: {underline: true}
        }, 'key');


        (this.descriptionPanel.buffer as any).moveTo(0,0);
        this.descriptionPanel.buffer.insert(' '.repeat(Math.max(0, this.descriptionPanel.calculatedWidth)), {underline: true});
        (this.descriptionPanel.buffer as any).moveTo(0,0);
        this.descriptionPanel.buffer.insert('description', {underline: true});

        (this.keyPanel.buffer as any).moveTo(1,1);
        (this.descriptionPanel.buffer as any).moveTo(0,1);

        this.commands.forEach((command) => {
            (this.keyPanel.buffer as any).put({
                attr: {bold: true},
                dx: 0,
                dy: 1
            }, command.key);

            this.descriptionPanel.buffer.insert(command.action.description);
            this.descriptionPanel.buffer.newLine();
        });

        this.keyPanel.markDirty();
        this.descriptionPanel.markDirty();
    }

    public setCommands(commands: Command[]): void {
        this.commands = commands;
        const panelHeight = this.commands.length + 1;
        if(this.options.height !== panelHeight) {
            this.options.height = panelHeight
            if(this.parent) {
                this.parent.resize();
            }
        }
    }
}

export interface Command {
    key: string;
    action: Input.Action;
}
