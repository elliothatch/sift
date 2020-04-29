import {Attributes, Terminal, Buffer, ScreenBuffer, TextBuffer} from 'terminal-kit';

import {LogRecord} from './logdb';
import {ResultSet} from './logdb';

export namespace Panel {
    export interface Options {
        /** name used for identification in error messages */
        name?: string;
        width: number;
        height: number;
        /** if true, width/height is used as a grow factor to fill remaining space */
        flex?: {
            width?: boolean;
            height?: boolean;
        };
        /** if true, children will be rendered left-to-right instead of top-to-bottom */
        flexCol?: boolean;
        drawCursor?: boolean;
    }
}

export abstract class Panel<T extends Buffer> {
    public options: Panel.Options;
    public buffer: T;

    /** calculated width or height of 0 means the dimension hasn't been calculated yet */
    public calculatedHeight: number;
    public calculatedWidth: number;

    public parent?: Panel<Buffer>;
    public children: Panel<Buffer>[];

    constructor(options: Panel.Options, buffer: T) {
        this.options = options;
        this.buffer = buffer;

        this.calculatedWidth = 0;
        this.calculatedHeight = 0;
        this.children = [];
    }

    public addChild(child: Panel<Buffer>): void {
        this.children.push(child);
        child.parent = this;
        child.getScreenBuffer().dst = this.getScreenBuffer();
    };

    /** returns the screen buffer if it is one, or the dst buffer of a TextBuffer */
    public abstract getScreenBuffer(): ScreenBuffer;

    /** draw the panel itself, but don't propegate the changes up the parent chain
     * the changes may not be visible until the dst chain has been drawn */
    public drawSelf(): void {
        this.buffer.draw();
        if(this.options.drawCursor) {
            this.buffer.drawCursor();
        }
    }

    /** draw the buffer and all its parents */
    public draw() {
        this.drawSelf();
        let parent = this.parent;
        while(parent) {
            parent.drawSelf();
            parent = parent.parent;
        }
        /*
        let currentBuffer = this.buffer;
        while(currentBuffer && currentBuffer instanceof ScreenBuffer || currentBuffer instanceof TextBuffer) {
            currentBuffer.draw();
            currentBuffer.drawCursor();
            currentBuffer = currentBuffer.dst as ScreenBuffer;
        }
        */
    }

    /** draw all children in a post-DFS order */
    public redrawChildren(): void {
        this.children.forEach((child) => child.redrawChildren());
        this.drawSelf();
    }

    /** recalculate the size of a panel and its children */
    public resize(): void {
        if(!this.options.flex || !this.options.flex.width) {
            this.calculatedWidth = this.options.width;
        }

        if(!this.options.flex || !this.options.flex.height) {
            this.calculatedHeight = this.options.height;
        }

        if(this.calculatedHeight === 0 || this.calculatedWidth === 0) {
            throw new Error(`Panel.resize: panel '${this.options.name}' has flex '${this.options.flex}', but does not have its own width/height calculated. Ensure resize() has been drawn on the parent of '${this.options.name}', or disable flex on this panel`);
        }

        this.getScreenBuffer().resize({
            x: 0,
            y: 0,
            width: this.calculatedWidth!,
            height: this.calculatedHeight!,
        });

        if(this.buffer instanceof TextBuffer) {
            // TODO: fix terminal kit type definitions
            (this.buffer as any).width = this.calculatedWidth;
            (this.buffer as any).height = this.calculatedHeight;
        }

        if(this.children.length > 0) {
            const flexChildren: Panel<Buffer>[] = [];
            const fixedChildren: Panel<Buffer>[] = [];
            this.children.forEach((child) => {
                if((this.options.flexCol && child.options.flex && child.options.flex.width)
                    || !this.options.flexCol && child.options.flex && child.options.flex.height) {
                    flexChildren.push(child);
                }
                else {
                    fixedChildren.push(child);
                }
            });

            const fixedSize = fixedChildren.reduce(
                (sum, child) => sum + (this.options.flexCol? child.options.width: child.options.height),
                0
            );

            const flexSize = 
                (this.options.flexCol? this.calculatedWidth || 0 : this.calculatedHeight || 0)
                - fixedSize;
            const flexGrowSum = flexChildren.reduce(
                (sum, child) => sum + (this.options.flexCol? child.options.width: child.options.height),
                0
            );

            // resize the children
            let position = 0;

            this.children.forEach((child) => {
                const screenBuffer = child.getScreenBuffer();
                if(this.options.flexCol) {
                    child.calculatedWidth = child.options.flex && child.options.flex.width?
                        Math.round(flexSize * (child.options.width / flexGrowSum)):
                        child.options.width;

                    child.calculatedHeight = child.options.flex && child.options.flex.height?
                        this.calculatedHeight:
                        child.options.height;

                    screenBuffer.x = position;
                    screenBuffer.y = 0;
                    position += child.calculatedWidth;
                }
                else {
                    child.calculatedHeight = child.options.flex && child.options.flex.height?
                        Math.round(flexSize * (child.options.height / flexGrowSum)):
                        child.options.height;
                    child.calculatedWidth = child.options.flex && child.options.flex.width?
                        this.calculatedWidth:
                        child.options.width;

                    screenBuffer.x = 0;
                    screenBuffer.y = position;
                    position += child.calculatedHeight;
                }

                child.resize();
            });
        }
    }
}

export class ScreenPanel extends Panel<ScreenBuffer> {
    constructor(dst: Buffer | Terminal, options: Panel.Options) {
        super(options, new ScreenBuffer({
            dst,
            width: options.width,
            height: options.height,
        }));
    }

    public getScreenBuffer(): ScreenBuffer {
        return this.buffer;
    }
}

export class TextPanel extends Panel<TextBuffer> {
    public screenBuffer: ScreenBuffer;
    constructor(dst: Buffer | Terminal, options: Panel.Options) {
        const screenBuffer = new ScreenBuffer({
            dst,
            width: options.width,
            height: options.height,
        });

        super(options, new TextBuffer({
            dst: screenBuffer,
            width: options.width,
            height: options.height,
        }));

        this.screenBuffer = screenBuffer;
    }

    public drawSelf(): void {
        super.drawSelf();

        this.screenBuffer.draw();
        if(this.options.drawCursor) {
            this.screenBuffer.drawCursor();
        }
    }

    public getScreenBuffer(): ScreenBuffer {
        return this.screenBuffer;
    }
}

export class LogDisplayPanel extends Panel<ScreenBuffer> {
    /** displays the logIdx for the log (i.e. line number) */
    public idxPanel: Panel<TextBuffer>;
    /** displays a list of logs */
    public logPanel: Panel<TextBuffer>;

    public logs: LogRecord[];
    public matches?: ResultSet.MatchMap;
    public expandedView: boolean;
    public logLevelColors: {[level: string]: string};

    constructor(dst: Buffer | Terminal, options: Panel.Options, logDisplayOptions?: Partial<LogDisplayPanel.Options>) {
        super(options, new ScreenBuffer({
            dst,
            width: options.width,
            height: options.height,
        }));
        this.idxPanel = new TextPanel(this.buffer, {
            name: `${this.options.name? this.options.name: ''}.idxPanel`,
            width: logDisplayOptions && logDisplayOptions.idxWidth || 4,
            height: 1,
            flex: {
                height: true,
            },
        });

        this.logPanel = new TextPanel(this.buffer, {
            name: `${this.options.name? this.options.name: ''}.logPanel`,
            width: 1,
            height: 1,
            flex: {
                width: true,
                height: true,
            }
        });

        // TODO: width/height calculation is wrong if FLEX enabled?? */
        this.options.flexCol = true;
        this.logs = [];
        this.expandedView = false;
        this.logLevelColors = logDisplayOptions && logDisplayOptions.logLevelColors || {
            info: 'bold',
            warn: 'yellow',
            error: 'red',
        };

        this.addChild(this.idxPanel);
        this.addChild(this.logPanel);
    }

    public getScreenBuffer(): ScreenBuffer {
        return this.buffer;
    }

    /** 
     * prints all the logs in the logs object
     * Even though screenbuffer has its own implementation of scrolling, we don't use it, because screenbuffer also stores attr data for every line, which isn't reasonable for a large number of logs
     */
    public print(scrollOffset: number): void {
        // TODO: implement scrolling, reset display properly
        const printOptions: LogDisplayPanel.PrintOptions = {
            dst: this.logPanel.buffer,
            matches: this.matches,
            logLevelColors: this.logLevelColors,
            expandedView: this.expandedView,
            indentStr: ' '.repeat(4),
        };
        this.logs.forEach((record) => {
            const linesPrinted = LogDisplayPanel.printLog(record, printOptions);
            this.logPanel.buffer.newLine();

            this.idxPanel.buffer.insert(record.idx.toString());
            for(let i = 0; i < linesPrinted; i++) {
                this.idxPanel.buffer.newLine();
            }
        });
    }

    public static printLog(record: LogRecord, printOptions: LogDisplayPanel.PrintOptions): number {
        const messageColor = record.log && record.log.level?
            printOptions.logLevelColors[record.log.level]:
            printOptions.logLevelColors.info;

        if(record.log.timestamp) {
            printOptions.dst.insert('[', {color: messageColor, dim: true});
            LogDisplayPanel.printHighlightedText(record.log.timestamp, printOptions.dst, [], {color: messageColor, dim: true}, {color: 'blue'});
            printOptions.dst.insert(']', {color: messageColor, dim: true});
        }

        if(record.log.level) {
            printOptions.dst.insert('[', {color: messageColor, dim: true});
            LogDisplayPanel.printHighlightedText(record.log.level, printOptions.dst, [], {color: messageColor, dim: true}, {color: 'blue'});
            printOptions.dst.insert(']', {color: messageColor, dim: true});
        }

        if(record.log.message) {
            LogDisplayPanel.printHighlightedText(record.log.message, printOptions.dst, [], {color: messageColor}, {color: 'blue'});
        }

        let linesPrinted = 1;
        if(printOptions.expandedView) {
            // copy top-level properties of the log and delete properties we don't want displayed in the expanded view
            // TODO: make this a user configurable whitelist/blacklist
            const expandedLog = Object.assign({}, record.log);
            delete expandedLog.level;
            delete expandedLog.message;
            delete expandedLog.pid;
            delete expandedLog.timestamp;

            linesPrinted -= 1;// TODO: remove this line
            linesPrinted += LogDisplayPanel.printJson(expandedLog, printOptions);
        }

        return linesPrinted;
    }

    public static printJson(obj: any, printOptions: LogDisplayPanel.PrintOptions, propertyPath?: Array<string | number>): number {
        if(!propertyPath) {
            propertyPath = [];
        }

        const attr = {dim: true};
        const highlightPropertyAttr = {color: 'red'};
        const highlightValueAttr = {color: 'blue'};

        let linesPrinted = 0;
        let text: string;

        // prepare value
        if(typeof obj === 'undefined') {
            text = 'undefined';
        }
        if(obj === null) {
            text = 'null';
        }

        // this doesn't work because of the way the highlight indexes are set up
        // instead, we have to insert the quotations around the highlighted text
        // if(typeof obj === 'string') {
        // obj = '"' + obj + '"';
        // }

        // print
        if(typeof obj === 'string' || typeof obj === 'number') {
            if(typeof obj === 'string') {
                printOptions.dst.insert('"', attr);
            }
            // TODO: get get indexes that should be highlighted
            LogDisplayPanel.printHighlightedText(obj.toString(), printOptions.dst, [], attr, highlightValueAttr);

            if(typeof obj === 'string') {
                printOptions.dst.insert('"', attr);
            }
        }
        else if(Array.isArray(obj)) {
            printOptions.dst.insert('[', attr);
            if(obj.length > 0) {
                printOptions.dst.newLine();
                linesPrinted++;
            }

            obj.forEach((value, index) => {
                printOptions.dst.insert(printOptions.indentStr.repeat(propertyPath!.length + 1), attr);
                linesPrinted += LogDisplayPanel.printJson(value, printOptions, propertyPath!.concat([index.toString()]));

                if(index < obj.length - 1) {
                    printOptions.dst.insert(',', attr);
                    printOptions.dst.newLine();
                    linesPrinted++;
                }
                else {
                    printOptions.dst.newLine();
                    linesPrinted++;
                    // set up indentation for closing brace
                    printOptions.dst.insert(printOptions.indentStr.repeat(propertyPath!.length), attr);
                }
            });

            printOptions.dst.insert(']', attr);
        }
        else if(typeof obj === 'object') {
            printOptions.dst.insert('{', attr);
            printOptions.dst.newLine();
            linesPrinted++;

            Object.keys(obj).forEach((property, index, keys) => {
                const value = obj[property];
                let propertyPrefix = propertyPath!.join('.');
                if(propertyPath!.length > 0) {
                    propertyPrefix += '.';
                }

                const propertyId = propertyPrefix + property;

                //indent
                printOptions.dst.insert(printOptions.indentStr.repeat(propertyPath!.length + 1), attr);

                // print property name
                printOptions.dst.insert('"', attr);
                LogDisplayPanel.printHighlightedText(property, printOptions.dst, [], attr, highlightPropertyAttr);
                printOptions.dst.insert('"', attr);

                //print value
                linesPrinted += LogDisplayPanel.printJson(value, printOptions, propertyPath!.concat([property]));
                if(index < keys.length - 1) {
                    printOptions.dst.insert(',', attr);
                }
                printOptions.dst.newLine();
                linesPrinted++;
            });


            // indent
            printOptions.dst.insert(printOptions.indentStr.repeat(propertyPath.length + 1), attr);
            printOptions.dst.insert('}', attr);
        }

        return linesPrinted;
    }

    public static printHighlightedText(str: string, dst: TextBuffer, highlightIndexes: number[], attr: Attributes, highlightAttr: Attributes): void {
        for(let i = 0; i < str.length; i++) {
            if(highlightIndexes.includes(i)) {
                dst.insert(str[i], highlightAttr);
            }
            else {
                dst.insert(str[i], attr);
            }
        }
    }
}

export namespace LogDisplayPanel {
    export interface Options {
        idxWidth: number;
        logLevelColors: {[level: string]: string};
    }

    export interface PrintOptions {
        dst: TextBuffer;
        matches?: ResultSet.MatchMap;
        logLevelColors: {[level: string]: string};
        expandedView: boolean;
        /** this text is copied once for each level of indent in the exapnded view */
        indentStr: string;
    }
}
