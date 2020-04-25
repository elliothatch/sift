import {Attributes, Terminal, Buffer, ScreenBuffer, TextBuffer} from 'terminal-kit';

import {LogRecord} from './logdb';
import {ResultSet} from './logdb';

export interface Panel<T extends Buffer> {
    options: Panel.Options;

    buffer: T;
    calculatedHeight?: number;
    calculatedWidth?: number;

    children?: Panel<Buffer>[];
}

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
    }

    export function createScreenPanel(dst: Buffer | Terminal, options: Options): Panel<ScreenBuffer> {
        return {
            options,
            buffer: new ScreenBuffer({
                dst,
                width: options.width,
                height: options.height,
            }),
        };
    }

    export function createTextPanel(dst: Buffer | Terminal, options: Options): Panel<TextBuffer> {
        return {
            options,
            buffer: new TextBuffer({
                dst: new ScreenBuffer({
                    dst,
                    width: options.width,
                    height: options.height,
                }),
                width: options.width,
                height: options.height,
            }),
        };
    }

    export function addChild(parent: Panel<Buffer>, child: Panel<Buffer>): void {
        if(!parent.children) {
            parent.children = [];
        }
        parent.children.push(child);
        getScreenBuffer(child.buffer).dst = getScreenBuffer(parent.buffer);
    };

    /** draw the buffer and all its parents */
    export function draw(panel: Panel<Buffer>) {
        let currentBuffer = panel.buffer;
        while(currentBuffer && currentBuffer instanceof ScreenBuffer || currentBuffer instanceof TextBuffer) {
            currentBuffer.draw();
            currentBuffer.drawCursor();
            currentBuffer = currentBuffer.dst as ScreenBuffer;
        }
    }

    /** draw all children in a post-DFS order */
    export function redrawChildren(panel: Panel<Buffer>): void {
        if(panel.children) {
            panel.children.forEach(redrawChildren);
        }

        panel.buffer.draw();
        panel.buffer.drawCursor();

        if(panel.buffer instanceof TextBuffer) {
            panel.buffer.dst.draw();
            panel.buffer.dst.drawCursor();
        }

    }

    /** returns the screen buffer if it is one, or the dst buffer of a TextBuffer */
    export function getScreenBuffer(buffer: Buffer): ScreenBuffer {
        return buffer instanceof ScreenBuffer? buffer: buffer.dst;
    }

    /** recalculate the size of a panel and its children */
    export function resize(panel: Panel<Buffer>): void {
        if(!panel.options.flex || !panel.options.flex.width) {
            panel.calculatedWidth = panel.options.width;
        }

        if(!panel.options.flex || !panel.options.flex.height) {
            panel.calculatedHeight = panel.options.height;
        }

        if(panel.calculatedHeight == undefined || panel.calculatedWidth == undefined) {
            throw new Error(`Panel.resize: panel '${panel.options.name}' has flex '${panel.options.flex}', but does not have its own width/height calculated. Ensure Panel.resize() has been drawn on the parent of '${panel.options.name}', or disable flex on this panel`);
        }

        getScreenBuffer(panel.buffer).resize({
            x: 0,
            y: 0,
            width: panel.calculatedWidth!,
            height: panel.calculatedHeight!,
        });

        if(panel.buffer instanceof TextBuffer) {
            (panel.buffer as any).width = panel.calculatedWidth;
            (panel.buffer as any).height = panel.calculatedHeight;
        }

        if(panel.children) {
            const flexChildren: Panel<Buffer>[] = [];
            const fixedChildren: Panel<Buffer>[] = [];
            panel.children.forEach((child) => {
                if((panel.options.flexCol && child.options.flex && child.options.flex.width)
                    || !panel.options.flexCol && child.options.flex && child.options.flex.height) {
                    flexChildren.push(child);
                }
                else {
                    fixedChildren.push(child);
                }
            });

            const fixedSize = fixedChildren.reduce(
                (sum, child) => sum + (panel.options.flexCol? child.options.width: child.options.height),
                0
            );

            const flexSize = 
                (panel.options.flexCol? panel.calculatedWidth || 0 : panel.calculatedHeight || 0)
                - fixedSize;
            const flexGrowSum = flexChildren.reduce(
                (sum, child) => sum + (panel.options.flexCol? child.options.width: child.options.height),
                0
            );

            // resize the children
            let position = 0;

            panel.children.forEach((child) => {
                const screenBuffer = getScreenBuffer(child.buffer);
                if(panel.options.flexCol) {
                    child.calculatedWidth = child.options.flex && child.options.flex.width?
                        Math.round(flexSize * (child.options.width / flexGrowSum)):
                        child.options.width;

                    child.calculatedHeight = child.options.flex && child.options.flex.height?
                        panel.calculatedHeight:
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
                        panel.calculatedWidth:
                        child.options.width;

                    screenBuffer.x = 0;
                    screenBuffer.y = position;
                    position += child.calculatedHeight;
                }

                resize(child);
            });
        }
    }

    /** a LogDisplay panel displays a list of logs */
    export interface LogDisplay extends Panel<ScreenBuffer> {
        /** displays the logIdx for the log (i.e. line number) */
        idxPanel: Panel<TextBuffer>;
        /** displays a list of logs */
        logPanel: Panel<TextBuffer>;

        logs: LogRecord[];
        matches?: ResultSet.MatchMap;
        expanededView: boolean;
        logLevelColors: {[level: string]: string};

        children: Panel<TextBuffer>[];
    }

    export namespace LogDisplay {
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

        /** 
         * prints all the logs in the logs object
         * Even though screenbuffer has its own implementation of scrolling, we don't use it, because screenbuffer also stores attr data for every line, which isn't reasonable for a large number of logs
         */
        export function print(logDisplay: LogDisplay, scrollOffset: number): void {
            // TODO: implement scrolling, reset display properly
            const printOptions: PrintOptions = {
                dst: logDisplay.logPanel.buffer,
                matches: logDisplay.matches,
                logLevelColors: logDisplay.logLevelColors,
                expandedView: logDisplay.expanededView,
                indentStr: ' '.repeat(4),
            };
            logDisplay.logs.forEach((record) => {
                const linesPrinted = printLog(record, printOptions);
                logDisplay.logPanel.buffer.newLine();

                logDisplay.idxPanel.buffer.insert(record.idx.toString());
                for(let i = 0; i < linesPrinted; i++) {
                    logDisplay.idxPanel.buffer.newLine();
                }
            });
        }

        export function printLog(record: LogRecord, printOptions: PrintOptions): number {
            const messageColor = record.log && record.log.level?
                printOptions.logLevelColors[record.log.level]:
                printOptions.logLevelColors.info;

            if(record.log.timestamp) {
                printOptions.dst.insert('[', {color: messageColor, dim: true});
                printHighlightedText(record.log.timestamp, printOptions.dst, [], {color: messageColor, dim: true}, {color: 'blue'});
                printOptions.dst.insert(']', {color: messageColor, dim: true});
            }

            if(record.log.level) {
                printOptions.dst.insert('[', {color: messageColor, dim: true});
                printHighlightedText(record.log.level, printOptions.dst, [], {color: messageColor, dim: true}, {color: 'blue'});
                printOptions.dst.insert(']', {color: messageColor, dim: true});
            }

            if(record.log.message) {
                printHighlightedText(record.log.message, printOptions.dst, [], {color: messageColor}, {color: 'blue'});
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
                linesPrinted += printJson(expandedLog, printOptions);
            }

            return linesPrinted;
        }

        export function printJson(obj: any, printOptions: PrintOptions, propertyPath?: Array<string | number>): number {
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
                printHighlightedText(obj.toString(), printOptions.dst, [], attr, highlightValueAttr);

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
                    linesPrinted += printJson(value, printOptions, propertyPath!.concat([index.toString()]));

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
                    printHighlightedText(property, printOptions.dst, [], attr, highlightPropertyAttr);
                    printOptions.dst.insert('"', attr);

                    //print value
                    linesPrinted += printJson(value, printOptions, propertyPath!.concat([property]));
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

        export function printHighlightedText(str: string, dst: TextBuffer, highlightIndexes: number[], attr: Attributes, highlightAttr: Attributes): void {
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

    export function createLogDisplayPanel(dst: Buffer | Terminal, options: Options, logDisplayOptions?: Partial<LogDisplay.Options>): LogDisplay {
        const panel = createScreenPanel(dst, options);
        const idxPanel = createTextPanel(panel.buffer, {
            name: `${panel.options.name? panel.options.name: ''}.idxPanel`,
            width: logDisplayOptions && logDisplayOptions.idxWidth || 4,
            height: 1,
            flex: {
                height: true,
            },
        });

        const logPanel = createTextPanel(panel.buffer, {
            name: `${panel.options.name? panel.options.name: ''}.logPanel`,
            width: 1,
            height: 1,
            flex: {
                width: true,
                height: true,
            }
        });
        // TODO: width/height calculation is wrong if FLEX enabled?? */

        const logDisplayPanel = Object.assign(panel, {
            options: Object.assign(options, {
                flexCol: true,
            }),
            idxPanel,
            logPanel,
            logs: [],
            expanededView: false,
            logLevelColors: logDisplayOptions && logDisplayOptions.logLevelColors || {
                info: 'bold',
                warn: 'yellow',
                error: 'red',
            },
            children: [],
        });

        addChild(logDisplayPanel, idxPanel);
        addChild(logDisplayPanel, logPanel);

        return logDisplayPanel;
    }

}
