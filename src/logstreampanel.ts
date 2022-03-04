import { Terminal, Buffer, ScreenBuffer } from 'terminal-kit';
import { EMPTY, interval, merge, Observable, Subject, Subscription } from 'rxjs';
import { auditTime, filter, finalize, mergeMap, take, tap } from 'rxjs/operators';

import { LogRecord, ResultSet } from './logdb';
import { LogStream } from './logstream';
import { Parse, Parser } from './query';

import { Panel, ScreenPanel, TextPanel } from './panel';
import { LogDisplayPanel } from './logdisplaypanel';
import { FilterPanel } from './filterpanel';

export class LogStreamPanel<T extends LogStream = LogStream> extends Panel<ScreenBuffer> {
    public logStream: T;
    public query: string = '';
    public filter?: Parse.Expression;
    public filterRules: FilterPanel.Rule[] = [];
    public autoscroll: boolean = true;

    protected blockDrawLog: boolean = false;

    protected parser: Parser;

    public redrawEvents: Observable<null>;
    protected redrawEventsSubject: Subject<null>;

    protected filterSubscription?: Subscription;

    public logDisplayPanel: LogDisplayPanel
    public queryResultsPanel: TextPanel;
    protected queryPromptPanel: ScreenPanel;
    protected queryPromptArrowPanel: ScreenPanel;
    public queryPromptInputPanel: TextPanel;
    protected titlePanel: TextPanel;
    protected selected: boolean = false;

    /** current frame of the spinner animation. if -1, spinner is hidden */
    protected spinnerIndex: number = -1;

    public spinnerFrames = ['\\', '|', '/', '-'];

    constructor(dst: Buffer | Terminal, options: Panel.Options, logStream: T) {
        super(options, new ScreenBuffer({
            dst,
            width: options.width,
            height: options.height,
        }));

        this.logStream = logStream;
        this.parser = new Parser;

        this.logDisplayPanel = new LogDisplayPanel(this.buffer, {
            name: `${this.options.name? this.options.name: ''}.logDisplayPanel`,
            width: 1,
            height: 1,
            flex: {
                width: true,
                height: true
            }
        });

        this.queryResultsPanel = new TextPanel(this.buffer, {
            name: `${this.options.name? this.options.name: ''}.queryResultsPanel`,
            width: 1,
            height: 1,
            flex: {
                width: true,
            },
        }, this.renderQueryResults);

        this.queryPromptPanel = new ScreenPanel(this.buffer, {
            name: `${this.options.name? this.options.name: ''}.queryPromptPanel`,
            width: 1,
            height: 1,
            flex: {
                width: true,
            },
            flexCol: true,
            drawCursor: true
        });

        this.queryPromptArrowPanel = new ScreenPanel(this.queryPromptPanel.buffer, {
            name: `${this.options.name? this.options.name: ''}.queryPromptPanel.querypromptarrow`,
            width: 2,
            height: 1
        });
        (this.queryPromptArrowPanel.buffer as any).put({x: 0, y: 0}, '>');
        (this.queryPromptArrowPanel.buffer as any).put({x: 1, y: 0}, ' ');

        this.queryPromptInputPanel = new TextPanel(this.queryPromptPanel.buffer, {
            name: `${this.options.name? this.options.name: ''}.queryPromptPanel.querypromptinput`,
            width: 1,
            height: 1,
            flex: {
                width: true
            },
            drawCursor: true
        });

        this.queryPromptPanel.addChild(this.queryPromptArrowPanel);
        this.queryPromptPanel.addChild(this.queryPromptInputPanel);

        this.titlePanel = new TextPanel(this.buffer, {
            name: `${this.options.name? this.options.name: ''}.titlePanel`,
            width: 1,
            height: 1,
            flex: {
                width: true,
            },
        }, this.renderTitle);

        this.addChild(this.logDisplayPanel);
        this.addChild(this.queryResultsPanel);
        this.addChild(this.queryPromptPanel);
        this.addChild(this.titlePanel);

        this.logDisplayPanel.logs = this.logStream.logdb.logs;

        this.redrawEventsSubject = new Subject();
        this.redrawEvents = this.redrawEventsSubject.asObservable().pipe(
            auditTime(1000/60),
            filter(() => !this.blockDrawLog),
            tap(() => {
                if(this.autoscroll) {
                    this.logDisplayPanel.scrollToLogFromBottom(this.logDisplayPanel.logs.length - 1);
                    this.logDisplayPanel.selectionIndex = Math.max(0, this.logDisplayPanel.logs.length - 1);
                    this.logDisplayPanel.selectionScrollPosition = 0;
                }
                else {
                    // might be aligning too many times
                    this.logDisplayPanel.scrollAlignBottom();
                }
            }),
            finalize(() => {
                // make sure the scroll position is correct if the stream is terminated
                if(this.autoscroll) {
                    this.logDisplayPanel.scrollToLogFromBottom(this.logDisplayPanel.logs.length - 1);
                    this.logDisplayPanel.selectionIndex = Math.max(0, this.logDisplayPanel.logs.length - 1);
                    this.logDisplayPanel.selectionScrollPosition = 0;
                }
                else {
                    // might be aligning too many times
                    this.logDisplayPanel.scrollAlignBottom();
                }
            })
        );

        this.logStream.logsObservable.subscribe((record) => {
            if(this.logDisplayPanel.logs === this.logStream.logdb.logs || !this.filter) {
                this.logDisplayPanel.markDirty();
                this.queryResultsPanel.markDirty();
                this.redrawEventsSubject.next(null);
                return;
            }

            const matches = this.logStream.logdb.matchLog(this.filter, record);

            if(matches.length > 0) {
                this.logDisplayPanel.logs.push(record);
                if(!this.logDisplayPanel.resultSet) {
                    this.logDisplayPanel.resultSet = {
                        matches: new Map(),
                        index: {
                            propertyIndex: new Map(),
                            properties: [],
                            valueIndex: new Map(),
                            values: [],
                        }
                    };
                }
                matches.forEach((match) => {
                    ResultSet.addMatch(match, this.logDisplayPanel.resultSet!)
                    this.logDisplayPanel.logEntryCache.delete(match.logRecord.idx);
                });

                this.logDisplayPanel.markDirty();
                this.queryResultsPanel.markDirty();
                this.redrawEventsSubject.next(null);
            }
            else {
                // just update the max match count
                this.queryResultsPanel.markDirty();
                this.redrawEventsSubject.next(null);
            }
        });
    }

    public getScreenBuffer(): ScreenBuffer {
        return this.buffer;
    }

    public setSelected(selected: boolean) {
        this.selected = selected;
        this.options.drawCursor = selected;
        this.titlePanel.markDirty();
    }

    public renderTitle: () => void = () => {
        (this.titlePanel.buffer as any).setText('');
        (this.titlePanel.buffer as any).moveTo(0, 0);
        const titleText = this.logStream.source.sType === 'observable'? this.logStream.source.name:
            `${this.logStream.source.process.spawnargs.join(' ')} (${this.logStream.source.process.pid})`;

        const fullTitleText = titleText + ' '.repeat(Math.max(0, this.calculatedWidth - titleText.length));

        if(this.selected) {
            this.titlePanel.buffer.insert(fullTitleText, {inverse: true});
        }
        else {
            this.titlePanel.buffer.insert(fullTitleText);
        }
    }

    public renderQueryResults: () => void = () => {
        (this.queryResultsPanel.buffer as any).setText('');
        if(this.spinnerIndex >= 0) {
            (this.queryResultsPanel.buffer as any).moveTo(0, 0);
            this.queryResultsPanel.buffer.insert(this.spinnerFrames[this.spinnerIndex]);
            this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length;
        }

        (this.queryResultsPanel.buffer as any).moveTo(2, 0);
        this.queryResultsPanel.buffer.insert(`${this.logDisplayPanel.logs.length}/${this.logStream.logdb.logs.length}`);
        this.queryResultsPanel.buffer.insert(` `);

        if(this.logDisplayPanel.scrollLogIndex > 0) {
            this.queryResultsPanel.buffer.insert(`[${this.logDisplayPanel.scrollLogIndex} above]`, {dim:true});
        }
        const bottomPosition = this.logDisplayPanel.getBottomPosition();
        if(bottomPosition && bottomPosition.entryIndex < this.logDisplayPanel.logs.length - 1) {
            this.queryResultsPanel.buffer.insert(`[${this.logDisplayPanel.logs.length - 1 - bottomPosition.entryIndex} below]`, {dim:true});
        }
    }

    public setQuery(query: string): Subscription | undefined {
        this.query = query;
        (this.queryPromptInputPanel.buffer as any).setText(query);
        this.queryPromptInputPanel.markDirty();
        let filter: Parse.Expression | undefined = undefined;
        try {
            filter = this.parser.parse(query)[0];
        }
        catch(err) {
            // TODO: show user reason their query is invalid
        }

        // apply rules from FILTER panel
        const filterExpr: Parse.Expression | undefined =
        this.filterRules.filter((rule) => rule.enabled && rule.expr)
        .reduce((filter, rule) => {
            if(!filter) {
                return rule.expr;
            }

            return {
                eType: 'OR',
                lhs: rule.expr,
                rhs: filter
            };
        }, undefined as Parse.Expression | undefined);

        if(filterExpr) {
            if(!filter) {
                filter = filterExpr;
            }
            else {
                filter = {
                    eType: 'AND',
                    lhs: filter,
                    rhs: filterExpr
                };
            }
        };

        if(this.filter && JSON.stringify(filter) === JSON.stringify(this.filter)) {
            // if the new filter is the same as the old one, don't do anything
            return undefined;
        }

        return this.setFilter(filter);
    }

    public setFilter(filter: Parse.Expression | undefined): Subscription | undefined {
        // cancel the previous filter
        if(this.filterSubscription) {
            this.filterSubscription.unsubscribe();
            this.filterSubscription = undefined;
            this.spinnerIndex = -1;
        }

        this.filter = filter;

        // if autoscroll is disabled, the user has selected a log, and we would like to keep that log in view while filtering occurs
        const selectedLog = !this.autoscroll && this.logDisplayPanel.selectionIndex < this.logDisplayPanel.logs.length? this.logDisplayPanel.logs[this.logDisplayPanel.selectionIndex]: undefined;
        const selectedLogScrollPosition = this.logDisplayPanel.selectionScrollPosition;

        if(!selectedLog) {
            // turn on autoscroll if we couldn't find the selected log
            this.autoscroll = true;
        }

        let selectionFound = false;

        this.logDisplayPanel.selectionIndex = 0;
        this.logDisplayPanel.scrollPosition = 0;

        if(this.logDisplayPanel.resultSet) {
            for(let idx of this.logDisplayPanel.resultSet.matches.keys()) {
                this.logDisplayPanel.logEntryCache.delete(idx);
            }
            this.logDisplayPanel.resultSet = undefined;
        }

        // changing the query collapses all logs
        // logDisplayPanel.expandedLogs.clear();
        // this.logDisplayPanel.logEntryCache.clear();

        if(!filter) {
            this.logDisplayPanel.logs = this.logStream.logdb.logs;
            if(selectedLog) {
                this.logDisplayPanel.selectionIndex = selectedLog.idx;
                this.logDisplayPanel.selectionScrollPosition = selectedLogScrollPosition;
                this.logDisplayPanel.scrollToSelection();
            }

            this.logDisplayPanel.markDirty();
            this.queryResultsPanel.markDirty();
            this.redrawEventsSubject.next(null);
            return this.filterSubscription;
        }

        this.spinnerIndex = 0;
        this.blockDrawLog = true;
        this.queryResultsPanel.markDirty();
        this.redrawEventsSubject.next(null);
        // this.printQueryResults();

        /** store logs in reverse order so we can easily iterate from the latest entry */
        // const displayedLogs: SkipList<LogIdx, LogRecord> = new SkipList((a: number, b: number) => b - a);
        const displayedLogs: LogRecord[] = [];
        this.logDisplayPanel.logs = displayedLogs;


        this.filterSubscription = merge(
            this.logStream.logdb.filterAll(filter),
            // below prevents annoying visual flicker when starting search
            interval(1000/60).pipe(
                take(1),
                tap(() => this.blockDrawLog = false),
                mergeMap(() => EMPTY)),
        ).pipe(
            tap(({record, matches, resultSet}) => {
                if(!this.logDisplayPanel.resultSet) {
                    this.logDisplayPanel.resultSet = {
                        matches: new Map(),
                        index: {
                            propertyIndex: new Map(),
                            properties: [],
                            valueIndex: new Map(),
                            values: [],
                        }
                    };
                }

                matches.forEach((match) => {
                    ResultSet.addMatch(match, this.logDisplayPanel.resultSet!)
                    this.logDisplayPanel.logEntryCache.delete(match.logRecord.idx);
                });

                const insertIndex = insertSorted(record, displayedLogs, (a, b) => a.idx - b.idx);
                // TODO: what if autoscrolling is changed mid-filter?
                // TODO: if the selection is changed mid-filter, we get screen flickering, and then the selection is reset back to the previous selection if it was found, which might not be desirable
                if(!this.autoscroll) {
                    // set the selection to the correct log
                    if(!selectionFound) {
                        if(selectedLog && selectedLog.idx === record.idx) {
                            this.logDisplayPanel.selectionIndex = insertIndex;
                            this.logDisplayPanel.selectionScrollPosition = selectedLogScrollPosition;
                            selectionFound = true;
                        }
                    }
                    else if(insertIndex <= this.logDisplayPanel.selectionIndex) {
                        this.logDisplayPanel.selectionIndex++;
                    }

                    // scroll
                    if(!selectionFound) {
                        this.logDisplayPanel.scrollToLogFromBottom(this.logDisplayPanel.logs.length - 1);
                    }
                    else {
                        // selection has been found, keep it on screen
                        this.logDisplayPanel.scrollToMaximizeLog(this.logDisplayPanel.selectionIndex);
                        this.logDisplayPanel.scrollAlignBottom();
                    }
                }
            })
            // TODO: this is ridiculous
            // auditTime(1000/60),
            // tap(() => drawLogs()),

            // publish((published) => merge(
            //     interval(1000/60).pipe(takeUntil(concat(published, of(true)))),
            //     published)),
            // auditTime(1000/60),
            // tap(() => drawQueryResult()),
        ).subscribe({
            next: () => {
                this.logDisplayPanel.markDirty();
                this.queryResultsPanel.markDirty();
                this.redrawEventsSubject.next(null);
            },
            complete: () => {
                this.spinnerIndex = -1;
                this.logDisplayPanel.markDirty();
                this.queryResultsPanel.markDirty();
                this.redrawEventsSubject.next(null);
            }
        });

        return this.filterSubscription;
    }
}

// TODO: use binary search
function insertSorted<T>(t: T, arr: Array<T>, comparator: (a: T, b: T) => number): number {
    for(let i = 0; i < arr.length; i++) {
        const result = comparator(arr[i], t);
        if(result >= 0) {
            arr.splice(i, 0, t);
            return i;
        }
    }

    arr.push(t);
    return arr.length - 1;
}
