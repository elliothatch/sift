import {Attributes, Terminal, Buffer, ScreenBuffer, TextBuffer} from 'terminal-kit';

import { Panel, ScreenPanel, TextPanel } from './panel';
import { Parse, Parser } from './query';

/**
 * TODO: FORMAT rules will actually go in a different panel I think
 * The filter panel controls persistent filters and formatting rules
 * queries added to the filter list will apply a rule to any matching logs
 *  FILTER rules are ORed with each other, then the combined query is ANDed with the primary query in the query bar
 *  FORMAT rules apply custom styling to logs that match the query
 * they can be toggled on or off
 */
export class FilterPanel extends Panel<ScreenBuffer> {
    public enabledPanel: ScreenPanel;
    public namePanel: TextPanel;
    public queryPanel: TextPanel;

    public rules: FilterPanel.Rule[] = [];

    protected parser: Parser;

    constructor(dst: Buffer | Terminal, options: Panel.Options) {
        super({...options, flexCol: true}, new ScreenBuffer({
            dst,
            width: options.width,
            height: options.height,
        }));

        this.parser = new Parser();

        this.enabledPanel = new ScreenPanel(this.buffer, {
            name: `${this.options.name? this.options.name: ''}.enabledPanel`,
            width: 5,
            height: 1,
            flex: {
                height: true,
            }
        });

        this.namePanel = new TextPanel(this.buffer, {
            name: `${this.options.name? this.options.name: ''}.namePanel`,
            width: 16,
            height: 1,
            flex: {
                height: true,
            },
        });

        this.queryPanel = new TextPanel(this.buffer, {
            name: `${this.options.name? this.options.name: ''}.queryPanel`,
            width: 1,
            height: 1,
            flex: {
                width: true,
                height: true,
            },
        });

        this.addChild(this.enabledPanel);
        this.addChild(this.namePanel);
        this.addChild(this.queryPanel);
    }

    public getScreenBuffer(): ScreenBuffer {
        return this.buffer;
    }

    public setRules(rules: FilterPanel.Rule[]): void {
        rules.forEach((rule) => {
            if(!rule.expr) {
                try {
                    rule.expr = this.parser.parse(rule.query)[0];
                }
                catch {
                    // TODO: store error
                }
            }
        });
        this.rules = rules;
        const panelHeight = this.rules.length + 1;
        if(this.options.height !== panelHeight) {
            this.options.height = panelHeight
            if(this.parent) {
                this.parent.resize();
            }
        }
    }

    public printRules(): void {
        // clear
        this.enabledPanel.buffer.fill({char: ' '});
        (this.namePanel.buffer as any).setText('');
        (this.queryPanel.buffer as any).setText('');

        (this.enabledPanel.buffer as any).fill({
            char: ' ',
            region: {
                x: 0,
                y: 0,
                width: this.enabledPanel.calculatedWidth,
                height: 1
            },
            attr: {underline: true}
        });

        (this.namePanel.buffer as any).moveTo(0,0);
        this.namePanel.buffer.insert(' '.repeat(this.namePanel.calculatedWidth), {underline: true});

        (this.queryPanel.buffer as any).moveTo(0,0);
        this.queryPanel.buffer.insert(' '.repeat(this.queryPanel.calculatedWidth), {underline: true});

        (this.enabledPanel.buffer as any).moveTo(1,1);
        (this.namePanel.buffer as any).moveTo(0,1);
        (this.queryPanel.buffer as any).moveTo(0,1);

        this.rules.forEach((rule, index) => {
            this.enabledPanel.buffer.moveTo(1, index+1);
            (this.enabledPanel.buffer as any).put(undefined, '[');
            if(!rule.expr) {
                (this.enabledPanel.buffer as any).put({
                    attr: {color: 'red', bold: true},
                }, 'E');
            }
            else {
                (this.enabledPanel.buffer as any).put({
                    attr: {bold: true},
                }, rule.enabled? 'X': ' ');
            }

            (this.enabledPanel.buffer as any).put(undefined, ']');

            this.namePanel.buffer.insert(rule.name);
            this.namePanel.buffer.newLine();

            this.queryPanel.buffer.insert(rule.query);
            this.queryPanel.buffer.newLine();

        });
    }
}

export namespace FilterPanel {
    export interface Rule {
        enabled: boolean;
        name: string;
        query: string;
        expr?: Parse.Expression;
    }
}
