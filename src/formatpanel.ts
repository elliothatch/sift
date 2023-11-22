import {Attributes, Terminal, Buffer, ScreenBuffer} from 'terminal-kit';

import { Panel, ScreenPanel, TextPanel } from './panel';
import { LogSubstitution, FormatString } from './logdisplaypanel';

/**
* Edit log summary text and formatting. Each row represents a section of text, which can contain data from the message and be conditionally styled
* TODO: add/delete/rearrange rules. window-specific rules (update format panel based on rules in current panel, enable window navigation in format mode)
 */
export class FormatPanel extends Panel<ScreenBuffer> {
    public enabledPanel: ScreenPanel;
    public textPanel: TextPanel;
    public attributesPanel: TextPanel;
    public conditionalAttributesPanel: TextPanel;

    public rules: FormatPanel.Rule[] = []
    public selection: number = 0;

    constructor(dst: Buffer | Terminal, options: Panel.Options) {
        super({...options, flexCol: true}, new ScreenBuffer({
            dst,
            width: options.width,
            height: options.height,
        }));

        this.enabledPanel = new ScreenPanel(this.buffer, {
            name: `${this.options.name? this.options.name: ''}.enabledPanel`,
            width: 5,
            height: 1,
            flex: {
                height: true,
            }
        });

        this.textPanel = new TextPanel(this.buffer, {
            name: `${this.options.name? this.options.name: ''}.textPanel`,
            width: 1,
            height: 1,
            flex: {
                width: true,
                height: true,
            },
        });

        this.attributesPanel = new TextPanel(this.buffer, {
            name: `${this.options.name? this.options.name: ''}.attributesPanel`,
            width: 1,
            height: 1,
            flex: {
                width: true,
                height: true,
            },
        });

        this.conditionalAttributesPanel = new TextPanel(this.buffer, {
            name: `${this.options.name? this.options.name: ''}.conditionalAttributesPanel`,
            width: 1,
            height: 1,
            flex: {
                width: true,
                height: true,
            },
        });

        this.addChild(this.enabledPanel);
        this.addChild(this.textPanel);
        this.addChild(this.attributesPanel);
        this.addChild(this.conditionalAttributesPanel);
    }

    public getScreenBuffer(): ScreenBuffer {
        return this.buffer;
    }

    public render:() => void = () => {
        // clear
        (this.textPanel.buffer as any).setText('');
        this.enabledPanel.buffer.fill({char: ' '});
        (this.attributesPanel.buffer as any).setText('');
        (this.conditionalAttributesPanel.buffer as any).setText('');

        this.enabledPanel.buffer.fill({
            char: ' ',
            region: {
                x: 0,
                y: 0,
                width: this.enabledPanel.calculatedWidth,
                height: 1
            },
            attr: {underline: true}
        });
        (this.textPanel.buffer as any).moveTo(0,0);
        this.textPanel.buffer.insert('text', {underline: true});
        this.textPanel.buffer.insert(' '.repeat(Math.max(0, this.textPanel.calculatedWidth - 'text'.length)), {underline: true});

        (this.attributesPanel.buffer as any).moveTo(0,0);
        this.attributesPanel.buffer.insert('attributes', {underline: true});
        this.attributesPanel.buffer.insert(' '.repeat(Math.max(0, this.attributesPanel.calculatedWidth - 'attributes'.length)), {underline: true});

        (this.conditionalAttributesPanel.buffer as any).moveTo(0,0);
        const textRight = '';
        this.conditionalAttributesPanel.buffer.insert('conditional attributes', {underline: true});
        this.conditionalAttributesPanel.buffer.insert(' '.repeat(Math.max(0, this.conditionalAttributesPanel.calculatedWidth - 'conditional attributes'.length - textRight.length)), {underline: true});
        this.conditionalAttributesPanel.buffer.insert(textRight, {underline: true});

        (this.enabledPanel.buffer as any).moveTo(1,1);
        (this.textPanel.buffer as any).moveTo(0,1);
        (this.attributesPanel.buffer as any).moveTo(0,1);
        (this.conditionalAttributesPanel.buffer as any).moveTo(0,1);

        this.rules.forEach((rule, i) => {
            const attributes: Attributes = i == this.selection? {inverse: true}: {};

            this.enabledPanel.buffer.moveTo(1, i+1);
            (this.enabledPanel.buffer as any).put({attr: attributes}, '[');
            (this.enabledPanel.buffer as any).put({
                attr: {...attributes, bold: true},
            }, rule.enabled? 'X': ' ');
            (this.enabledPanel.buffer as any).put({attr: attributes}, ']');

            const text = 'property' in rule.format?
                `${rule.format.prefix || ''}$${rule.format.property}${rule.format.showNull? ' !': ''}${rule.format.suffix || ''}`:
                rule.format.text;

            if(i == this.selection) {
                this.textPanel.buffer.insert(text, {...rule.format.attributes, inverse: true});
            }
            else {
                this.textPanel.buffer.insert(text, rule.format.attributes);
                }
            this.textPanel.buffer.insert(' ');
            this.textPanel.buffer.insert(' '.repeat(Math.max(0, this.textPanel.calculatedWidth - text.length - 1)), attributes);
            this.textPanel.buffer.newLine();

            const attributesText =  rule.format.attributes? JSON.stringify(rule.format.attributes, undefined, ''): '';
            this.attributesPanel.buffer.insert(attributesText, attributes);
            this.attributesPanel.buffer.insert(' '.repeat(Math.max(0, this.attributesPanel.calculatedWidth - attributesText.length)), attributes);
            this.attributesPanel.buffer.newLine();

            const conditionalAttributesText = rule.format.conditionalAttributes? JSON.stringify(rule.format.conditionalAttributes, undefined, ''): '';
            this.conditionalAttributesPanel.buffer.insert(conditionalAttributesText, attributes);
            this.conditionalAttributesPanel.buffer.insert(' '.repeat(Math.max(0, this.conditionalAttributesPanel.calculatedWidth - conditionalAttributesText.length)), attributes);
            this.conditionalAttributesPanel.buffer.newLine();
        });

        this.enabledPanel.markDirty();
        this.textPanel.markDirty();
        this.attributesPanel.markDirty();
        this.conditionalAttributesPanel.markDirty();
    }

    /** @index - if undefined append to end */
    public insertRule(rule: FormatPanel.Rule, index?: number): void {
        this.rules.splice(index == undefined? this.rules.length: index, 0, rule);

        const panelHeight = Object.keys(this.rules).length + 1;
        if(this.options.height !== panelHeight) {
            this.options.height = panelHeight
            if(this.parent) {
                this.parent.resize();
            }
        }
    }

    public moveSelectionUp(): void {
        if(this.rules.length > 0) {
            this.selection = (this.selection - 1 + this.rules.length) % this.rules.length;
            this.markDirty();
        }
    }

    public moveSelectionDown(): void {
        if(this.rules.length > 0) {
            this.selection = (this.selection + 1) % this.rules.length;
            this.markDirty();
        }
    }

    public toggleSelectionEnabled(): void {
        if(this.rules.length > 0) {
            this.rules[this.selection].enabled = !this.rules[this.selection].enabled;
            this.markDirty();
        }
    }

}

export namespace FormatPanel {
    export interface Rule {
        enabled: boolean;
        format: LogSubstitution | FormatString;
    }
}
