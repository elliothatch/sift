import {Attributes, Terminal, Buffer, ScreenBuffer, TextBuffer} from 'terminal-kit';

import { Panel, ScreenPanel, TextPanel } from './panel';
import {LogRecord, LogIdx, PropertyId, ResultSet, FilterMatch } from './logdb';

/** a substitution in a format string */
export interface LogSubstitution {
    /** name of the property whose value will be substituted. nested properties can be specified with dot notation */
    property: string;
    attributes?: Attributes;
    /** string to prefix substitution, only used if property value is not null */
    prefix?: string;
    /** string to suffix substitution, only used if property value is not null */
    suffix?: string;
    /** by default, if the value of a property is undefined or null, the entire substitution is ignored and nothing is printed. if showNull is set to true, null/undefined values will be be displayed. in this case, prefix and suffix are always printed. */
    showNull?: boolean;
}

export class LogDisplayPanel extends Panel<ScreenBuffer> {
    /** displays a list of logs */
    public logPanel: ScreenPanel;
    public idxPanel: TextPanel;

    // public logs: SkipList<LogIdx, LogRecord>;
    public logs: LogRecord[];
    public resultSet?: ResultSet;
    // public expandedView: boolean;
    public logLevelColors: {[level: string]: string};
    public logFormat: Array<string | LogSubstitution>;

    // add doubly linked list of items to make it an LRU cache
    // each node stores a TextBuffer which is filled with formatted text
    // then we draw() the contents with dst = logPanel when needed
    public logEntryCache: Map<LogIdx, TextBuffer>;
    public maxLogEntries: number = 200;

    /** index of the topmost log on screen */
    public scrollLogIndex: number = 0;
    /** line we have scrolled to within the scrollLogIdx record */
    public scrollPosition: number = 0;
    /** set of all logs that are expanded */
    public expandedLogs: Set<LogIdx>;

    public selectionIndex: number = 0;
    /** if the cursor is in an expanded log, this is the offset */
    public selectionScrollPosition: number = 0;



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
        this.expandedLogs = new Set();

        // TODO: width/height calculation is wrong if FLEX enabled?? */
        this.logs = [];
        this.options.flexCol = true;
        // this.expandedView = false;
        this.logLevelColors = logDisplayOptions && logDisplayOptions.logLevelColors || {
            info: 'bold',
            warn: 'yellow',
            error: 'red',
            default: 'grey',
        };

        this.logFormat = this.parseLogFormat('{timestamp|dim|[|]}][{level|dim|[|]}]{message}');


        this.addChild(this.idxPanel);
        this.addChild(this.logPanel);
    }

    /** overload resize to reset cache */
    public resize(): void {
        super.resize();
        this.logEntryCache.clear();
    }

    public render: () => void = () => {
        this.logPanel.buffer.fill({char: ' '});
        this.logPanel.buffer.moveTo(0, 0);
        (this.idxPanel.buffer as any).setText('');
        (this.idxPanel.buffer as any).moveTo(0, 0);

        let entryIdx = this.scrollLogIndex;
        let entryScrollPos = this.scrollPosition;

        for(let i = 0; i < this.logPanel.calculatedHeight; i++) {
            if(entryIdx >= this.logs.length) {
                break;
            }

            const record = this.logs[entryIdx];
            const logEntry = this.getLogEntry(record);

            if(entryScrollPos === 0) {
                this.printIdx(record.idx, i);
            }

            this.printLogEntry(logEntry, i, entryScrollPos);
            if(this.selectionIndex === entryIdx && this.selectionScrollPosition === entryScrollPos) {
                // invert the colors of the selected row
                for(let col = 0; col < this.logPanel.calculatedWidth; col++) {
                    const {char, attr} = (this.logPanel.buffer as any).get({x: col, y: i});
                    attr.inverse = true;
                    (this.logPanel.buffer as any).put({x: col, y: i, attr}, char);
                }
            }

            entryScrollPos++;

            const logHeight = logEntry.getContentSize().height;
            if(entryScrollPos >= logHeight) {
                // reached end of log, move onto next
                entryIdx++;
                entryScrollPos = 0;
            }
            // this.redrawChildren();
            // this.draw();
        }

        this.idxPanel.markDirty();
        this.logPanel.markDirty();
    }

    /** @param formatStr - a format string used to color, style, and substitute values in the log summary
    * substitutions are indictated with curly braces {property|attributes|prefix|suffix}
    * attributes is a comma separated list of name:value pairs of terminal-kit attributes
    * see interface LogSubstitution for more details
    * TODO: should the substituions just be a json object used with JSON.parse? that seems overly verbose, but also easy to implement. also you don't have to memorize the order, and there is only one "definition" of the log format (interface LogSubstitution)
    * @returns array of strings and substitutions, which will be concatenated to create the log string
    */
    public parseLogFormat(formatStr: string): Array<string | LogSubstitution> {
        // TODO: parse format str
        return [];
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
            expandedView: this.expandedLogs.has(record.idx),
            indentStr: ' '.repeat(4),
        };

        const linesPrinted = LogDisplayPanel.printLog(record, printOptions);
        // printOptions.dst.insert(JSON.stringify(record.log));
        // textBuffer.draw();

        // if(this.selectionLogIdx === record.idx) {
            // highlight the selected row
            // for(let i = 0; i < (this.logPanel.getScreenBuffer() as any).width; i++) {
            //     const {char, attr} = (this.logPanel.getScreenBuffer() as any).get({x: i, y: this.selectionScrollPosition});
            //     attr.inverse = true;
            //     (this.logPanel.getScreenBuffer() as any).put({
            //         x: i,
            //         y: this.selectionScrollPosition,
            //         attr
            //     }, char);
            // }
        // }

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

    /** prints a single line of a log entry */
    public printLogEntry(logEntry: TextBuffer, row: number, scrollPosition: number) {
        (logEntry as any).draw({
            dst: this.logPanel.getScreenBuffer(),
            x: 0,
            y: row - scrollPosition,
            srcClipRect: {
                x: 0,
                y: scrollPosition,
                width: this.logPanel.calculatedWidth,
                height: 1,
            },
        });
    }

    /** prints a single log entry at the end of the display */
    // public appendLog(record: LogRecord, y: number) {
    // }

    /** scrolls until there is no empty space at the top or bottom of the list, ensuring as many logs are displayed as possible */
    public scrollAlignBottom() {
        if(this.scrollLogIndex >= this.logs.length) {
            return;
        }
        let bottomPosition = this.getBottomPosition();
        if(!bottomPosition) {
            // scroll up until there is no empty space beneath the log
            while(!bottomPosition) {
                if(this.scrollPosition > 0 || this.scrollLogIndex === 0) {
                    this.scrollPosition--;
                }
                else {
                    this.scrollLogIndex--;
                    const record = this.logs[this.scrollLogIndex];
                    const logEntry = this.getLogEntry(record);
                    const logHeight = logEntry.getContentSize().height;
                    this.scrollPosition = logHeight - 1;
                }
                bottomPosition = this.getBottomPosition();
            }
        }
        else {
            // scroll down until as many logs are displayed as possible
            let entryIdx = bottomPosition.entryIndex;
            let scrollOffset = bottomPosition.scrollPosition + 1;
            while(entryIdx && entryIdx < this.logs.length && this.scrollPosition < 0) {
                const record = this.logs[entryIdx];
                const logEntry = this.getLogEntry(record);
                const logHeight = logEntry.getContentSize().height;

                this.scrollPosition = Math.min(0, this.scrollPosition + logHeight - scrollOffset);
                scrollOffset = 0;
                entryIdx++;
            }
        }

        this.markDirty();
    }

    /** sets scrollLogIdx and scrollPosition so the target log is at the bottom of the screen. */
    public scrollToLogFromBottom(index: number) {
        if(this.logs.length === 0) {
            return;
        }

        let entryIdx = index;
        let totalHeight = 0;

        while(totalHeight < this.logPanel.calculatedHeight) {
            if(entryIdx < 0) {
                break;
            }

            const record = this.logs[entryIdx];
            const logEntry = this.getLogEntry(record);
            const logHeight = logEntry.getContentSize().height;

            totalHeight += logHeight;
            entryIdx--;
        }

        this.scrollLogIndex = entryIdx + 1;
        this.scrollPosition = totalHeight - this.logPanel.calculatedHeight;

        this.scrollAlignBottom();
        this.markDirty();
    }

    public scrollToLog(index: number) {
        this.scrollLogIndex = Math.max(0, Math.min(index, this.logs.length));
        this.scrollPosition = 0;
        this.markDirty();
    }

    public scrollUp(count: number) {
        for(let i = 0; i < count; i++) {
            if(this.scrollPosition > 0) {
                this.scrollPosition--;
            }
            else if(this.scrollLogIndex > 0) {
                this.scrollLogIndex--;
                const record = this.logs[this.scrollLogIndex];
                const logEntry = this.getLogEntry(record);
                const logHeight = logEntry.getContentSize().height;
                this.scrollPosition = logHeight - 1;
            }
        }
        this.markDirty();
    }

    public scrollDown(count: number) {
        for(let i = 0; i < count; i++) {
            const record = this.logs[this.scrollLogIndex];
            const logEntry = this.getLogEntry(record);
            const logHeight = logEntry.getContentSize().height;

            if(this.scrollPosition < logHeight - 1) {
                this.scrollPosition++;
            }
            else {
                if(this.scrollLogIndex >= this.logs.length - 1) {
                    return;
                }

                this.scrollLogIndex++;
                this.scrollPosition = 0;
            }
        }
        this.markDirty();
    }

    /** find the log and scroll index of the bottom entry on the screen. */
    public getBottomPosition(): {entryIndex: number, scrollPosition: number} | undefined {
        let entryIndex = this.scrollLogIndex;

        let totalHeight = -this.scrollPosition;
        let lastLogHeight = 0;

        while(totalHeight < this.logPanel.calculatedHeight) {
            if(entryIndex >= this.logs.length) {
                // you can't scroll past the end of the list
                return undefined;
            }

            const record = this.logs[entryIndex];
            const logEntry = this.getLogEntry(record);
            lastLogHeight = logEntry.getContentSize().height;

            totalHeight += lastLogHeight;
            entryIndex++;
        }

        return {
            entryIndex: entryIndex - 1,
            scrollPosition: lastLogHeight - (totalHeight - this.logPanel.calculatedHeight) - 1
        };
    }

    /** scrolls the screen until the selection is in view */
    public scrollToSelection() {
        if(this.selectionIndex < this.scrollLogIndex) {
            this.scrollLogIndex = this.selectionIndex;
            this.scrollPosition = this.selectionScrollPosition;
        }
        else if(this.selectionIndex === this.scrollLogIndex
            && this.selectionScrollPosition < this.scrollPosition) {
            this.scrollPosition = this.selectionScrollPosition;
        }
        else {
            const bottomPosition = this.getBottomPosition();
            if(!bottomPosition) {
                return;
            }
            if(this.selectionIndex > bottomPosition.entryIndex) {
                this.scrollToLogFromBottom(this.selectionIndex);
                // scrollToLogFromBottom will scroll to the end of the log if its expanded, but we want to be at the beginning of the log as if we scrolled down from above
                const selectedLogHeight = this.getLogEntry(this.logs[this.selectionIndex]).getContentSize().height;
                this.scrollUp(selectedLogHeight - 1 - this.selectionScrollPosition);
            }
            else if(this.selectionIndex === bottomPosition.entryIndex
                && this.selectionScrollPosition > bottomPosition.scrollPosition) {
                this.scrollDown(this.selectionScrollPosition - bottomPosition.scrollPosition);
            }
        }
        this.markDirty();
    }

    public selectLog(index: number) {
        this.selectionIndex = Math.min(Math.max(0, index), this.logs.length);
        this.selectionScrollPosition = 0;
        this.markDirty();
    }

    /** tries to find the target log index. if not found, selects the closest log less than the specified idx */
    public selectLogIdx(idx: LogIdx) {
        // binary search for target log
        let low = 0;
        let high = this.logs.length - 1;
        while(low <= high) {
            const mid = Math.floor((low + high) / 2);

            const log = this.logs[mid];
            if(log.idx === idx) {
                this.selectionIndex = mid;
                this.selectionScrollPosition = 0;
                return;
            } else if(log.idx < idx) {
                low = mid + 1;
            }
            else {
                high = mid - 1;
            }
        }

        // idx wasn't found, select the closest log without going over
        if(low >= this.logs.length) {
            this.selectionIndex = Math.max(0, this.logs.length - 1);
            this.selectionScrollPosition = 0;
        } else if(this.logs[low].idx < idx) {
            this.selectionIndex = low;
            this.selectionScrollPosition = 0;
        }
        else {
            this.selectionIndex = Math.max(0, low - 1);
            this.selectionScrollPosition = 0;
        }
    }

    public moveSelectionUp(count: number) {
        for(let i = 0; i < count; i++) {
            if(this.selectionScrollPosition > 0) {
                this.selectionScrollPosition--;
                // this.logEntryCache.delete(this.selectionLogIdx);
            }
            else {
                if(this.selectionIndex <= 0) {
                    return;
                }

                // this.logEntryCache.delete(this.selectionLogIdx);
                this.selectionIndex--;

                const record = this.logs[this.selectionIndex];
                const logEntry = this.getLogEntry(record);
                const logHeight = logEntry.getContentSize().height;
                this.selectionScrollPosition = logHeight - 1;

                // this.logEntryCache.delete(this.selectionLogIdx);
            }
        }
        this.markDirty();
    }

    public moveSelectionDown(count: number) {
        for(let i = 0; i < count; i++) {
            if(this.selectionIndex >= this.logs.length) {
                return;
            }

            const record = this.logs[this.selectionIndex];
            const logEntry = this.getLogEntry(record);
            const logHeight = logEntry.getContentSize().height;

            if(this.selectionScrollPosition < logHeight - 1) {
                this.selectionScrollPosition++;
            }
            else {
                if(this.selectionIndex >= this.logs.length - 1) {
                    return;
                }

                // this.logEntryCache.delete(this.selectionLogIdx);
                this.selectionIndex++;
                this.selectionScrollPosition = 0;
                // this.logEntryCache.delete(this.selectionLogIdx);
            }

        }
        this.markDirty();
    }


    /**
* @returns true if the log was expanded, and false if it was collapsed, or selection is invalid 
*/
    public toggleExpandSelection(): boolean {
        if(this.selectionIndex >= this.logs.length || this.logs.length === 0) {
            return false;
        }

        const idx = this.logs[this.selectionIndex].idx;
        if(this.expandedLogs.has(idx)) {
            this.expandedLogs.delete(idx);
            this.selectionScrollPosition = 0;

            // prevent invalid scroll position
            // this.scrollPosition = 0;

            this.logEntryCache.delete(idx);
            this.markDirty();
            return false;
        }
        else {
            this.expandedLogs.add(idx);
            this.logEntryCache.delete(idx);
            this.markDirty();
            return true;
        }

    }

    /** scrolls the view to ensure the maxiumum amount of the specified log is shown.
    * ensures the beginning of the log is visible, then scrolls down as much as possible to fit the rest of the log onscreen
    * tries to not unnecessarily scroll the screen
    */
    public scrollToMaximizeLog(entryIndex: number) {
        if(entryIndex < this.scrollLogIndex) {
            this.scrollLogIndex = entryIndex;
            this.scrollPosition = 0;
        }
        else if(entryIndex === this.scrollLogIndex) {
            this.scrollPosition = 0;
            this.scrollAlignBottom();
        }
        else {
            const bottomPosition = this.getBottomPosition();
            if(bottomPosition && bottomPosition.entryIndex <= entryIndex) {
                this.scrollToLogFromBottom(entryIndex);
            }
            this.scrollAlignBottom();
        }
        this.markDirty();
    }

    /** prints the log at the bottom of the screen, and previous logs above. */
    // BUG: not all values highlighted
    /*
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

            if(i >= this.logs.length) {
                continue;
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
*/

    public printIdx(idx: LogIdx, row: number) {

        const attr = idx % 10 === 0?
            {color: 'brightWhite', bold: true}:
            idx % 2 === 1?
            {inverse: true, color: 'grey'}:
            {inverse: true, color: 'white'};

        const idxStr = idx.toString();

        (this.idxPanel.buffer as any).moveTo(
            this.idxPanel.options.width - idxStr.length - 1,
            row);

        this.idxPanel.buffer.insert(idxStr, attr);
    }

    public static printLog(record: LogRecord, printOptions: LogDisplayPanel.PrintOptions): number {
        let messageColor = printOptions.logLevelColors.default;
        if(record.log && record.log.level && printOptions.logLevelColors[record.log.level]) {
            messageColor = printOptions.logLevelColors[record.log.level];
        }

        if(record.log.timestamp !== undefined) {
            // don't allow dim gray as it becomes the background color
            const timestampColor = messageColor === 'grey'? 'white' : messageColor;
            printOptions.dst.insert('[', {color: timestampColor, dim: true});
            LogDisplayPanel.printHighlightedText(record.log.timestamp, printOptions.dst, LogDisplayPanel.getValueHighlightIndexes(record.idx, 'timestamp', printOptions.matches), {color: timestampColor, dim: true}, {color: 'blue'});
            printOptions.dst.insert(']', {color: timestampColor, dim: true});
        }

        if(record.log.level !== undefined) {
            // don't allow dim gray as it becomes the background color
            const levelColor = messageColor === 'grey'? 'white' : messageColor;
            printOptions.dst.insert('[', {color: levelColor, dim: true});
            LogDisplayPanel.printHighlightedText(record.log.level, printOptions.dst, LogDisplayPanel.getValueHighlightIndexes(record.idx, 'level', printOptions.matches), {color: levelColor, dim: true}, {color: 'blue'});
            printOptions.dst.insert(']', {color: levelColor, dim: true});
        }

        if(record.log.message !== undefined) {
            LogDisplayPanel.printHighlightedText(record.log.message.toString(), printOptions.dst, LogDisplayPanel.getValueHighlightIndexes(record.idx, 'message', printOptions.matches), {color: messageColor}, {color: 'blue'});
        }

        let linesPrinted = 1;
        if(printOptions.expandedView) {
            // copy top-level properties of the log and delete properties we don't want displayed in the expanded view
            // TODO: make this a user configurable whitelist/blacklist
            // const expandedLog = Object.assign({}, record.log);
            // delete expandedLog.level;
            // delete expandedLog.message;
            // delete expandedLog.pid;
            // delete expandedLog.timestamp;

            printOptions.dst.newLine();
            // linesPrinted += 1;
            linesPrinted += LogDisplayPanel.printJson(record, record.log, printOptions);
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

        const valueMatches = logMatch.value.filter((match) => match.value && match.value.property === property);

        return valueMatches.reduce((arr, valueMatch) => {
            arr.push(...valueMatch.value!.fuzzyResult.indexes);
            return arr;
        }, [] as number[]);
    }

    public static printJson(record: LogRecord, obj: any, printOptions: LogDisplayPanel.PrintOptions, propertyPath?: Array<string | number>): number {
        if(!propertyPath) {
            propertyPath = [];
        }

        const attr = {dim: true};
        const highlightPropertyAttr = {color: 'red'};
        const highlightValueAttr = {color: 'blue'};

        let linesPrinted = 1;
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
        if(obj == null || typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
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
                        highlightIndexes = propertyMatch.property!.fuzzyResult.indexes.map((i) => i - propertyPrefix.length).filter((i) => i >= 0);
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
