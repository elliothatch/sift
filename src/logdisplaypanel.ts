import {Attributes, Terminal, Buffer, ScreenBuffer, TextBuffer} from 'terminal-kit';

import { Panel, ScreenPanel, TextPanel } from './panel';
import {LogRecord, LogIdx, PropertyId, ResultSet, FilterMatch } from './logdb';

export class LogDisplayPanel extends Panel<ScreenBuffer> {
    /** displays a list of logs */
    public logPanel: ScreenPanel;
    public idxPanel: TextPanel;

    public logs: LogRecord[];
    public resultSet?: ResultSet;
    public expandedView: boolean;
    public logLevelColors: {[level: string]: string};

    // add doubly linked list of items to make it an LRU cache
    // each node stores a TextBuffer which is filled with formatted text
    // then we draw() the contents with dst = logPanel when needed
    public logEntryCache: Map<LogIdx, TextBuffer>;
    public maxLogEntries: number = 200;

    constructor(dst: Buffer | Terminal, options: Panel.Options, logDisplayOptions?: Partial<LogDisplayPanel.Options>) {
        super(options, new ScreenBuffer({
            dst,
            width: options.width,
            height: options.height,
        }));
        this.idxPanel = new TextPanel(this.buffer, {
            name: `${this.options.name? this.options.name: ''}.idxPanel`,
            width: logDisplayOptions && logDisplayOptions.idxWidth || 6,
            height: 1,
            flex: {
                height: true,
            },
        });

        this.logPanel = new ScreenPanel(this.buffer, {
            name: `${this.options.name? this.options.name: ''}.logPanel`,
            width: 1,
            height: 1,
            flex: {
                width: true,
                height: true,
            }
        });

        this.logEntryCache = new Map();

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

    public createLogEntry(record: LogRecord): TextBuffer {
        const textBuffer = new TextBuffer({
            dst: this.logPanel.getScreenBuffer(),
            // width: this.logPanel.calculatedWidth,
        });

        const printOptions: LogDisplayPanel.PrintOptions = {
            dst: textBuffer,
            matches: this.resultSet && this.resultSet.matches,
            logLevelColors: this.logLevelColors,
            expandedView: this.expandedView,
            indentStr: ' '.repeat(4),
        };

        const linesPrinted = LogDisplayPanel.printLog(record, printOptions);
        // printOptions.dst.insert(JSON.stringify(record.log));
        // textBuffer.draw();

        return textBuffer;
    }

    public getLogEntry(record: LogRecord): TextBuffer {
        let logEntry = this.logEntryCache.get(record.idx);
        if(!logEntry) {
            logEntry = this.createLogEntry(record);
            this.logEntryCache.set(record.idx, logEntry);
            if(this.logEntryCache.size > this.maxLogEntries) {
                for(let [idx, textBuffer] of this.logEntryCache) {
                    // delete least recently inserted entry
                    this.logEntryCache.delete(idx);
                        break;
                }
            }
        }

        return logEntry;
    }

    public printLogEntry(logEntry: TextBuffer, row: number) {
        /*
        (logEntry as any).draw({
            x: 0,
            y: row,
            //wrapping
            //
        });
        */

        // (logEntry.dst as any).put({
            // x: 0,
            // y: row,
            // attr: {color: 'black', bgColor: 'green'}
        // },
            // 'X');
        // (logEntry as any).moveTo(0, 0)
        // (logEntry as any).x = 0;
        // (logEntry as any).y = row;
        // logEntry.draw();
        (logEntry as any).draw({
            dst: this.logPanel.getScreenBuffer(),
            x: 0,
            y: row,
            dstClipRect: {
                x: 0,
                y: row,
                width: this.logPanel.calculatedWidth,
                height: logEntry.getContentSize().height,
            },
            // blending: true,
        });
        // logEntry.dst.fill({attr: {color: 'black', bgColor: 'green'}});
        // this.logPanel.buffer.fill({attr: {color: 'black', bgColor: 'green'}});
        // this.logPanel.buffer.insert('TEST');
    }

    /** prints a single log entry at the end of the display */
    public appendLog(record: LogRecord, y: number) {
        // TODO: so we need to figure out how many lines long the print will be BEFORE we start printing
    }

    /** prints the log at the bottom of the screen, and previous logs above. */
    // BUG: not all values highlighted
    public printFromBottom(index: number) {

        this.logPanel.buffer.fill({char: ' '});
        this.logPanel.buffer.moveTo(0, 0);
        // (this.logPanel.buffer as any).setText('');
        // (this.logPanel.buffer as any).moveTo(0, 0);

        (this.idxPanel.buffer as any).setText('');
        (this.idxPanel.buffer as any).moveTo(0, 0);

        let totalLines = 0;
        for(let i = index; i >= 0; i--) {
            if(totalLines >= this.logPanel.calculatedHeight) {
                break;
            }

            const record = this.logs[i];
            const logEntry = this.getLogEntry(record);
            totalLines += logEntry.getContentSize().height;

            const currentRow = this.logPanel.calculatedHeight - totalLines;

            this.printIdx(record.idx, currentRow);
            this.printLogEntry(logEntry, currentRow);
            // TODO: what happens if currentRow < 0
        }
        // this.redrawChildren();
        // this.drawSelf();
    }

    public printIdx(idx: LogIdx, row: number) {

        const idxStr = idx.toString();

        (this.idxPanel.buffer as any).moveTo(
            this.idxPanel.options.width - idxStr.length - 1,
            row);

        this.idxPanel.buffer.insert(idxStr);
    }

    /** 
     * prints all the logs in the logs object
     * Even though screenbuffer has its own implementation of scrolling, we don't use it, because screenbuffer also stores attr data for every line, which isn't reasonable for a large number of logs
     */
    /*
    public print(scrollOffset: number): void {
        // reset display
        (this.logPanel.buffer as any).setText('');
        (this.logPanel.buffer as any).moveTo(0, 0);

        (this.idxPanel.buffer as any).setText('');
        (this.idxPanel.buffer as any).moveTo(0, 0);
        // this.logPanel.buffer.dst.clear();
        // this.idxPanel.buffer.dst.clear();

        // TODO: implement scrolling
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

            const idxStr = record.idx.toString();
            // right align
            // TODO: what happens if we overflow?
            // leave 1 column gap
            (this.idxPanel.buffer as any).move(this.idxPanel.options.width - idxStr.length - 1, 0);

            this.idxPanel.buffer.insert(idxStr);
            for(let i = 0; i < linesPrinted; i++) {
                this.idxPanel.buffer.newLine();
            }
        });
    }
    */

    public static printLog(record: LogRecord, printOptions: LogDisplayPanel.PrintOptions): number {
        const messageColor = record.log && record.log.level?
            printOptions.logLevelColors[record.log.level]:
            printOptions.logLevelColors.info;

        if(record.log.timestamp !== undefined) {
            printOptions.dst.insert('[', {color: messageColor, dim: true});
            LogDisplayPanel.printHighlightedText(record.log.timestamp, printOptions.dst, LogDisplayPanel.getValueHighlightIndexes(record.idx, 'timestamp', printOptions.matches), {color: messageColor, dim: true}, {color: 'blue'});
            printOptions.dst.insert(']', {color: messageColor, dim: true});
        }

        if(record.log.level !== undefined) {
            printOptions.dst.insert('[', {color: messageColor, dim: true});
            LogDisplayPanel.printHighlightedText(record.log.level, printOptions.dst, LogDisplayPanel.getValueHighlightIndexes(record.idx, 'level', printOptions.matches), {color: messageColor, dim: true}, {color: 'blue'});
            printOptions.dst.insert(']', {color: messageColor, dim: true});
        }

        if(record.log.message !== undefined) {
            LogDisplayPanel.printHighlightedText(record.log.message.toString(), printOptions.dst, LogDisplayPanel.getValueHighlightIndexes(record.idx, 'message', printOptions.matches), {color: messageColor}, {color: 'blue'});
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

            printOptions.dst.newLine();
            linesPrinted += 1;
            linesPrinted += LogDisplayPanel.printJson(record, expandedLog, printOptions);
        }

        return linesPrinted;
    }

    public static getValueHighlightIndexesFilterMatch(filterMatch: FilterMatch, property: PropertyId): number[] {
        const valueMatch = filterMatch.matches.find((match) => match.value && match.value.property === property);

        if(!valueMatch) {
            return [];
        }

        return valueMatch.value!.fuzzyResult.indexes;

    }

    public static getValueHighlightIndexes(logIdx: LogIdx, property: PropertyId, matches?: ResultSet.MatchMap): number[] {
        const logMatch = matches && matches.get(logIdx);
        if(!logMatch) {
            return [];
        }

        const valueMatch = logMatch.value.find((match) => match.value && match.value.property === property);

        if(!valueMatch) {
            return [];
        }

        return valueMatch.value!.fuzzyResult.indexes;
    }

    public static printJson(record: LogRecord, obj: any, printOptions: LogDisplayPanel.PrintOptions, propertyPath?: Array<string | number>): number {
        if(!propertyPath) {
            propertyPath = [];
        }

        const attr = {dim: true};
        const highlightPropertyAttr = {color: 'red'};
        const highlightValueAttr = {color: 'blue'};

        let linesPrinted = 0;
        let text: string;

        // prepare value
        if(obj === undefined) {
            text = 'undefined';
        }
        else if(obj === null) {
            text = 'null';
        } else {
            text = obj.toString();
        }

        // this doesn't work because of the way the highlight indexes are set up
        // instead, we have to insert the quotations around the highlighted text
        // if(typeof obj === 'string') {
        // obj = '"' + obj + '"';
        // }

        // print
        if(obj == null || typeof obj === 'string' || typeof obj === 'number') {
            if(typeof obj === 'string') {
                printOptions.dst.insert('"', attr);
            }

            LogDisplayPanel.printHighlightedText(text, printOptions.dst, LogDisplayPanel.getValueHighlightIndexes(record.idx, propertyPath.join('.'), printOptions.matches), attr, highlightValueAttr);

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
                linesPrinted += LogDisplayPanel.printJson(record, value, printOptions, propertyPath!.concat([index.toString()]));

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

                let highlightIndexes: number[] = [];
                const logMatch = printOptions.matches && printOptions.matches.get(record.idx);
                if(logMatch) {
                    const propertyMatch = logMatch.property.find((match) => match.property && match.property.name === propertyId);
                    if(propertyMatch) {
                        highlightIndexes = propertyMatch.property!.fuzzyResult.indexes;
                    }
                }
                LogDisplayPanel.printHighlightedText(property, printOptions.dst, highlightIndexes, attr, highlightPropertyAttr);
                printOptions.dst.insert('"', attr);

                printOptions.dst.insert(': ', attr);

                //print value
                linesPrinted += LogDisplayPanel.printJson(record, value, printOptions, propertyPath!.concat([property]));
                if(index < keys.length - 1) {
                    printOptions.dst.insert(',', attr);
                }
                printOptions.dst.newLine();
                linesPrinted++;
            });


            // indent
            printOptions.dst.insert(printOptions.indentStr.repeat(propertyPath.length), attr);
            printOptions.dst.insert('}', attr);
        }

        return linesPrinted;
    }

    public static printHighlightedText(str: string, dst: TextBuffer, highlightIndexes: number[], attr: Attributes, highlightAttr: Attributes): void {
        // TODO: optimize includes
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
