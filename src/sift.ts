import { from, Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

import { Display } from './display';
import { LogStream } from './logstream';
import { LogStreamPanel } from './logstreampanel';
import { Input } from './input';
import { Command } from './commandpanel';

const SIFT_VERSION = 'v1.1.4';

export class Sift {
    public display: Display;
    public input: Input;
    public logStreams: {stream: LogStream, panel: LogStreamPanel}[];

    public exitLogs: Array<{level?: string, message: any}> = [];
    public siftLogStream: LogStream;
    public siftLogStreamPanel: LogStreamPanel;
    public siftLogsSubject: Subject<string>;

    public currentLogStreamPanel: LogStreamPanel;
    protected queryChangedSubject: Subject<LogStreamPanel>;

    protected textPromptOnSubmit?: (text: string) => void;
    protected textPromptOnCancel?: () => void;

    constructor() {
        this.display = new Display();
        this.display.init();

        process.on('exit', () => this.display.shutdown());

        this.siftLogsSubject = new Subject();
        this.siftLogStream = LogStream.fromObservable('sift', this.siftLogsSubject.asObservable());
        this.siftLogStreamPanel = new LogStreamPanel(this.display.logPanel.buffer, {
            name: `sift-logstreampanel`,
            width: 1,
            height: 1,
            flex: {
                width: true,
                height: true,
            },
        }, this.siftLogStream);

        this.display.showLogStreamPanel(this.siftLogStreamPanel);
        this.display.selectLogStreamPanel(0);

        this.logStreams = [
            {stream: this.siftLogStream, panel: this.siftLogStreamPanel},
        ];

        this.currentLogStreamPanel = this.siftLogStreamPanel;

        this.input = new Input(this.display, {
            [Input.Mode.Query]: {
                bindings: this.bindings[Input.Mode.Query],
                fallback: this.handleQueryInput,
            },
            [Input.Mode.Command]: {
                bindings: this.bindings[Input.Mode.Command],
                fallback: this.handleCommandInput,
            },
            [Input.Mode.Filter]: {
                bindings: this.bindings[Input.Mode.Filter],
                fallback: this.handleFilterInput,
            },
            [Input.Mode.Format]: {
                bindings: this.bindings[Input.Mode.Format]
            },
            [Input.Mode.Text]: {
                bindings: this.bindings[Input.Mode.Text],
                fallback: this.handleTextInput,
            }
        });

        this.siftLogsSubject.next(`sift ${SIFT_VERSION}`);
        this.siftLogsSubject.next(''),
        this.siftLogsSubject.next('Elliot Hatch 2023'),
        this.siftLogsSubject.next('sift is open source. https://github.com/elliothatch/sift'),
        this.siftLogsSubject.next(''),
        this.siftLogsSubject.next('Welcome to sift, the interactive log filter.'),
        this.siftLogsSubject.next('Type \\s to spawn a process.'),
        this.siftLogsSubject.next('Type \\? to display help.'),
        this.siftLogsSubject.next(''),
        this.siftLogsSubject.next('Command line usage:'),
        this.siftLogsSubject.next('sift <exec> [...params]'),

        this.display.draw();

        this.queryChangedSubject = new Subject();
        this.queryChangedSubject.pipe(
            debounceTime(150),
        ).subscribe((logStreamPanel) => {
                logStreamPanel.setQuery((logStreamPanel.queryPromptInputPanel.buffer as any).getText());
            });

        this.display.commandPanel.setCommands(this.commands);

        this.display.filterPanel.setRule('e', {
            enabled: false,
            name: 'Error',
            query: 'level:error'
        });
        this.display.filterPanel.setRule('w', {
            enabled: false,
            name: 'Warning',
            query: 'level:warn'
        });
        this.display.filterPanel.setRule('i', {
            enabled: false,
            name: 'Info',
            query: 'level:info'
        });
        this.display.filterPanel.setRule('t', {
            enabled: false,
            name: 'Trace',
            query: 'level:trace'
        });

        this.display.formatPanel.insertRule({
            enabled: false,
            format: {
                property: 'timestamp',
                attributes: {dim: true},
                prefix: '[',
                suffix: ']',
            }
        });
        this.display.formatPanel.insertRule({
            enabled: true,
            format: {
                property: 'level',
                attributes: {dim: true},
                prefix: '[',
                suffix: ']',
            }
        });

        this.display.formatPanel.insertRule({
            enabled: true,
            format: {
                property: 'message',
            }
        });

    }

    public spawnProcess(exec: string, args?: string[]) {
        // TODO: error handling
        const stream = LogStream.fromProcess(exec, args);
        const panel = new LogStreamPanel(this.display.logPanel.buffer, {
            name: `log.logStream.${this.display.logPanel.children.length}`,
            width: 1,
            height: 1,
            flex: {
                width: true,
                height: true,
            },
        }, stream);

        panel.logDisplayPanel.logFormat.format = this.display.formatPanel.rules.filter((rule) => rule.enabled).map((rule) => rule.format);

        this.display.showLogStreamPanel(panel);
        panel.options.drawCursor = true;

        this.logStreams.push({stream, panel});

        // select the new log stream, which will be at the end
        this.display.selectLogStreamPanel(this.display.logStreamPanels.length - 1);
        this.currentLogStreamPanel = panel;

        if(this.display.logStreamPanels.length === 2 && this.display.logStreamPanels[0].panel === this.siftLogStreamPanel) {
            // hide the startup screen/debug panel when spawning the first process
            this.display.hideLogStreamPanel(this.siftLogStreamPanel);
        }
    }

    public terminateProcess(logStream: LogStream<LogStream.Source.Process>) {
        if(logStream.source.running) {
            logStream.logdb.ingest(JSON.stringify({
                level: 'sift',
                message: `Sending SIGTERM to child process "${logStream.source.process.spawnfile}" (${logStream.source.process.pid})`,
                timestamp: new Date().toISOString(),
            }));
            logStream.source.process.kill();
        }
    }

    public close() {
        this.display.shutdown();
        this.logStreams.forEach(({stream, panel}) => {
            if(stream.source.sType === 'process' && stream.source.running) {
                stream.source.process.kill();
            }
        });

        this.exitLogs.forEach(({level, message}) => {
            if(level === 'error') {
                console.error(message);
            }
            else {
                console.log(message);
            }
        });
        process.exit();
    }

    protected updateFilterPanel(logStreamPanel: LogStreamPanel) {
        Object.values(this.display.filterPanel.rules).forEach((rule) => {
            rule.enabled = false;
        });
        Object.entries(logStreamPanel.filterRules).forEach(([key, rule]) => {
            const globalRule = this.display.filterPanel.rules[key];
            // if the rule hasn't been edited, update its enabled state
            // this probably isn't necessary
            if(globalRule && rule.query === globalRule.query) {
                globalRule.enabled = rule.enabled;
            }
        });

        this.display.filterPanel.markDirty();
    }

    public onQueryChanged() {
        this.currentLogStreamPanel.queryPromptInputPanel.markDirty();
        this.display.draw();
        this.queryChangedSubject.next(this.currentLogStreamPanel);
    }

    public promptTextInput(label: string, onSubmit: (text: string) => void, onCancel?: () => void, startingText?: string) {
        const labelText = label + ': ';
        this.display.textLabelPanel.options.width = labelText.length;
        this.display.hideQueryKeyPanel();
        this.display.showTextPanel();

        (this.display.textInputPanel.buffer as any).moveTo(startingText?.length || 0);
        (this.display.textInputPanel.buffer as any).setText(startingText || '');

        (this.display.textLabelPanel.buffer as any).moveTo(0,0);
        (this.display.textLabelPanel.buffer as any).setText(labelText);

        this.display.textLabelPanel.markDirty();
        this.display.textLabelPanel.markDirty();

        this.textPromptOnSubmit = onSubmit;
        this.textPromptOnCancel = onCancel;

        this.input.mode = Input.Mode.Text;
        this.display.draw();
    }


    public actions = {
        [Input.Mode.Query]: asActions({
            'closeLogStream': {
                description: 'Close log stream or exit. If the stream is a running process, it is sent a SIGTERM signal. If the process is already ended, close the log window. If there are no more log windows, exit sift',
                fn: () => {
                    const runningProcesses = this.logStreams.reduce((count, stream) => {
                        if(stream.stream.source.sType === 'process' && stream.stream.source.running) {
                            count++;
                        }
                        return count;
                    }, 0);

                    if(runningProcesses === 0 && this.display.logStreamPanels.length <= 1) {
                        this.close();
                    }
                    else {
                        const logSource = this.currentLogStreamPanel.logStream.source;
                        if(logSource.sType === 'process') {
                            if(logSource.running) {
                                this.terminateProcess(this.currentLogStreamPanel.logStream as LogStream<LogStream.Source.Process>);
                                this.display.draw();
                            }
                            else {
                                this.display.hideLogStreamPanel(this.currentLogStreamPanel);
                                // TODO: CRASHES if there is a process running in a closed panel and we closed the last visible panel.
                                this.currentLogStreamPanel = this.display.logStreamPanels[this.display.logStreamPanelIndex].panel;
                                // THE SOLUTION BELOW IS NOT GREAT. DOESN'T ACTUALLY WORK SINCE WE LEAVE THE LOG STREAMS IN THE LIST WHEN PANEL IS CLOSED
                                // WHAT IF YOU WANT TO VIEW A PROCESS THAT STOPPED. MAYBE WE SHOULD SHOW A PROCESS LIST AS THE FINAL SCREEN BEFORE SHUTDOWN?
                                // if(this.display.logStreamPanels.length > 0) {
                                    // this.currentLogStreamPanel = this.display.logStreamPanels[this.display.logStreamPanelIndex].panel;
                                // }
                                // else {
                                    // // there are no more visible panels, show the panel for the last hidden log stream
                                    // this.display.showLogStreamPanel(this.logStreams[this.logStreams.length - 1].panel);
                                // }
                                this.display.draw();
                            }
                        }
                        else {
                            if(logSource.subscription && this.currentLogStreamPanel.logStream !== this.siftLogStream) {
                                logSource.subscription.unsubscribe();
                                logSource.subscription = undefined
                                this.currentLogStreamPanel.logStream.logsSubject.next(
                                    this.currentLogStreamPanel.logStream.logdb.ingest(JSON.stringify({
                                    level: 'sift',
                                    message: `Unsubscribing...`,
                                    timestamp: new Date().toISOString(),
                                    }))
                                );
                                this.currentLogStreamPanel.logStream.logsSubject.next(
                                    this.currentLogStreamPanel.logStream.logdb.ingest(JSON.stringify({
                                    level: 'sift',
                                    message: `Press CTRL_C to close`,
                                    timestamp: new Date().toISOString(),
                                    }))
                                );
                                this.currentLogStreamPanel.markDirty();
                                this.display.draw();
                            }
                            else {
                                this.display.hideLogStreamPanel(this.currentLogStreamPanel);
                                this.currentLogStreamPanel = this.display.logStreamPanels[this.display.logStreamPanelIndex].panel;
                                this.display.draw();
                            }
                        }
                    }
                }
            },
            'selectPanelLeft': {
                description: 'Move panel selection left',
                fn: () => {
                    this.display.selectLogStreamPanel((this.display.logStreamPanelIndex - 1 + this.display.logStreamPanels.length) % this.display.logStreamPanels.length);
                    this.currentLogStreamPanel = this.display.logStreamPanels[this.display.logStreamPanelIndex].panel;
                    this.display.draw();
                }
            },
            'selectPanelRight': {
                description: 'Move panel selection right',
                fn: () => {
                    this.display.selectLogStreamPanel((this.display.logStreamPanelIndex + 1) % this.display.logStreamPanels.length);
                    this.currentLogStreamPanel = this.display.logStreamPanels[this.display.logStreamPanelIndex].panel;

                    this.display.draw();
                }
            },
            'toggleSelection': {
                description: 'Expand or condense the selected log',
                fn: () => {
                    this.currentLogStreamPanel.logDisplayPanel.toggleExpandSelection();
                    this.currentLogStreamPanel.logDisplayPanel.scrollToMaximizeLog(this.currentLogStreamPanel.logDisplayPanel.selectionIndex);
                    this.currentLogStreamPanel.autoscroll = false;
                    this.currentLogStreamPanel.queryResultsPanel.markDirty();
                    this.display.draw();
                }
            },
            'moveSelectionUp': {
                description: 'Move selection up one log',
                fn: () => {
                    this.currentLogStreamPanel.logDisplayPanel.moveSelectionUp(1);
                    this.currentLogStreamPanel.logDisplayPanel.scrollToSelection();
                    this.currentLogStreamPanel.autoscroll = false;
                    this.currentLogStreamPanel.queryResultsPanel.markDirty();
                    this.display.draw();
                }
            },
            'moveSelectionDown': {
                description: 'Move selection down one log',
                fn: () => {
                    this.currentLogStreamPanel.logDisplayPanel.moveSelectionDown(1);
                    this.currentLogStreamPanel.logDisplayPanel.scrollToSelection();
                    this.currentLogStreamPanel.autoscroll = false;
                    this.currentLogStreamPanel.queryResultsPanel.markDirty();
                    this.display.draw();
                }
            },
            'scrollUp': {
                description: 'Scroll display up',
                fn: () => {
                    this.currentLogStreamPanel.logDisplayPanel.scrollUp(1);
                    const bottomPosition = this.currentLogStreamPanel.logDisplayPanel.getBottomPosition();
                    if(bottomPosition && this.currentLogStreamPanel.logDisplayPanel.selectionIndex > bottomPosition.entryIndex) {
                        this.currentLogStreamPanel.logDisplayPanel.moveSelectionUp(1);
                    }
                    this.display.draw();
                }
            },
            'scrollDown': {
                description: 'Scroll display down',
                fn: () => {
                    this.currentLogStreamPanel.logDisplayPanel.scrollDown(1);
                    if(this.currentLogStreamPanel.logDisplayPanel.selectionIndex < this.currentLogStreamPanel.logDisplayPanel.scrollLogIndex) {
                        this.currentLogStreamPanel.logDisplayPanel.moveSelectionDown(1);
                    }
                    this.display.draw();
                }
            },
            'scrollLeft': {
                description: 'Scroll display to the left',
                fn: () => {
                    this.currentLogStreamPanel.logDisplayPanel.scrollLeft(5);
                    this.display.draw();
                }
            },
            'scrollRight': {
                description: 'Scroll display to the right',
                fn: () => {
                    this.currentLogStreamPanel.logDisplayPanel.scrollRight(5);
                    this.display.draw();
                }
            },
            'pageUp': {
                description: 'Move selection up one page (20 logs)',
                fn: () => {
                    this.currentLogStreamPanel.logDisplayPanel.moveSelectionUp(20);
                    this.currentLogStreamPanel.logDisplayPanel.scrollToSelection();
                    this.currentLogStreamPanel.autoscroll = false;
                    this.currentLogStreamPanel.queryResultsPanel.markDirty();
                    this.display.draw();
                }
            },
            'pageDown': {
                description: 'Move selection down one page (20 logs)',
                fn: () => {
                    this.currentLogStreamPanel.logDisplayPanel.moveSelectionDown(20);
                    this.currentLogStreamPanel.logDisplayPanel.scrollToSelection();
                    this.currentLogStreamPanel.autoscroll = false;
                    this.currentLogStreamPanel.queryResultsPanel.markDirty();
                    this.display.draw();
                }
            },
            'scrollStart': {
                description: 'Scroll to first log',
                fn: () => {
                    this.currentLogStreamPanel.logDisplayPanel.selectLog(0);
                    this.currentLogStreamPanel.logDisplayPanel.scrollToSelection();
                    this.currentLogStreamPanel.autoscroll = false;
                    this.currentLogStreamPanel.queryResultsPanel.markDirty();
                    this.display.draw();
                }
            }, 
            'scrollEnd': {
                description: 'Scroll to last log and enables autoscroll',
                fn: () => {
                    this.currentLogStreamPanel.logDisplayPanel.selectLog(this.currentLogStreamPanel.logDisplayPanel.logs.length - 1);
                    this.currentLogStreamPanel.logDisplayPanel.scrollToSelection();
                    this.currentLogStreamPanel.autoscroll = true;
                    this.currentLogStreamPanel.queryResultsPanel.markDirty();
                    this.display.draw();
                }
            }, 
            'queryCursorLeft': {
                description: 'Move query cursor left',
                fn: () => {
                    this.currentLogStreamPanel.queryPromptInputPanel.buffer.moveBackward(false);
                    this.currentLogStreamPanel.queryPromptInputPanel.markDirty();
                    this.display.draw();
                }
            },
            'queryCursorRight': {
                description: 'Move query cursor right',
                fn: () => {
                    if((this.currentLogStreamPanel.queryPromptInputPanel.buffer as any).cx < this.currentLogStreamPanel.queryPromptInputPanel.buffer.getText().length) {
                        this.currentLogStreamPanel.queryPromptInputPanel.buffer.moveForward(false);

                        this.currentLogStreamPanel.queryPromptInputPanel.markDirty();
                        this.display.draw();
                    }
                }
            },
            'backspace': {
                description: 'Back delete the query',
                fn: () => {
                    this.currentLogStreamPanel.queryPromptInputPanel.buffer.backDelete(1);
                    this.onQueryChanged();
                }
            },
            'delete': {
                description: 'Forward delete the query',
                fn: () => {
                    this.currentLogStreamPanel.queryPromptInputPanel.buffer.delete(1);
                    this.onQueryChanged();
                }
            },
            'clearQuery': {
                description: 'Clear the query',
                fn: () => {
                    (this.currentLogStreamPanel.queryPromptInputPanel.buffer as any).setText('');
                    (this.currentLogStreamPanel.queryPromptInputPanel.buffer as any).moveTo(0, 0);
                    // don't wait for debounce
                    this.currentLogStreamPanel.queryPromptInputPanel.markDirty();
                    this.display.draw();
                    this.currentLogStreamPanel.setQuery((this.currentLogStreamPanel.queryPromptInputPanel.buffer as any).getText());
                }
            },
            'fuzzyThresholdBroaden': {
                description: 'Increase fuzzy matching threshold, broadening results.',
                fn: () => {
                    this.currentLogStreamPanel.increaseFuzzyThreshold();
                    this.display.draw();
                }
            },
            'fuzzyThresholdNarrow': {
                description: 'Decrease fuzzy matching threshold, narrowing results.',
                fn: () => {
                    this.currentLogStreamPanel.decreaseFuzzyThreshold();
                    this.display.draw();
                }
            },
        }),
        [Input.Mode.Command]: asActions({
            'enterCommandMode': {
                description: 'Display the command panel',
                fn: () => {
                    this.input.mode = Input.Mode.Command;
                    this.display.showCommandPanel();
                    this.display.hideQueryKeyPanel();
                    this.display.draw();
                }
            },
            'exitCommandMode': {
                description: 'Exit Command mode and return to Query mode',
                fn: () => {
                    this.input.mode = Input.Mode.Query;
                    this.display.hideCommandPanel();
                    this.display.showQueryKeyPanel();
                    this.display.draw();
                }
            // commands
            },
            'insertBackslash': {
                description: 'insert \\',
                fn: (key, matches, data) => {
                    this.actions[Input.Mode.Command].exitCommandMode.fn(key, matches, data);
                    this.currentLogStreamPanel.queryPromptInputPanel.buffer.insert(key);
                    this.onQueryChanged();
                }
            },
            'closeWindow': {
                description: 'close the current log panel',
                fn: (key, matches, data) => {
                    if(this.display.logStreamPanels.length > 1) {
                        this.display.hideLogStreamPanel(this.currentLogStreamPanel);
                        this.currentLogStreamPanel = this.display.logStreamPanels[this.display.logStreamPanelIndex].panel;
                    }

                    this.actions[Input.Mode.Command].exitCommandMode.fn(key, matches, data);
                }
            },
            'gotoLog': {
                description: 'goto log',
                fn: (key, matches, data) => {
                    this.display.hideCommandPanel();
                    this.promptTextInput('goto log index',
                        (text) => {
                            const logIndex = parseInt(text);
                            if(isFinite(logIndex) && logIndex >= 0) {
                                this.currentLogStreamPanel.autoscroll = false;
                                this.currentLogStreamPanel.logDisplayPanel.selectLogIdx(logIndex);
                                this.currentLogStreamPanel.logDisplayPanel.scrollToMaximizeLog(this.currentLogStreamPanel.logDisplayPanel.selectionIndex);

                                // this.input.mode = Input.Mode.Query;
                                // (this.display.terminal as any).hideCursor(false);
                                this.display.draw();
                            }
                        }
                    );
                }
            },
            'spawnProcess': {
                description: 'spawn process',
                fn: () => {
                    this.display.hideCommandPanel();
                    this.promptTextInput('spawn process', (text) => {
                        if(text.length > 0) {
                            this.spawnProcess(text);
                        }
                        this.display.draw();
                    });
                }
            },
            'splitWindowVertical': {
                description: 'vertically split the current log panel',
                fn: (key, matches, data) => {
                    const stream = this.currentLogStreamPanel.logStream;
                    const panel = new LogStreamPanel(this.display.logPanel.buffer, {
                        name: `log.logStream.${this.display.logPanel.children.length}`,
                        width: 1,
                        height: 1,
                        flex: {
                            width: true,
                            height: true,
                        },
                    }, stream);

                    this.display.showLogStreamPanel(panel);
                    panel.options.drawCursor = true;

                    this.logStreams.push({stream, panel});

                    // select the new log stream, which will be at the end
                    this.display.selectLogStreamPanel(this.display.logStreamPanels.length - 1);
                    this.currentLogStreamPanel = panel;

                    this.actions[Input.Mode.Command].exitCommandMode.fn(key, matches, data);
                }
            },
            'displayHelp': {
                description: 'display help',
                fn: (key, matches, data) => {

                    const helpText: Array<string | {level: string, message: string}> = [
                        {level: 'sift', message: `sift ${SIFT_VERSION}`},
                        {level: 'sift', message: ''},
                        {level: 'sift', message: 'Elliot Hatch 2023'},
                        {level: 'sift', message: 'sift is open source. https://github.com/elliothatch/sift'},
                        '',
                        'Welcome to sift, the interactive log filter.',
                        'Spawn a process to inspect by typing \\s',
                        'You can also spawn a process directly from the command line:',
                        '   sift <exec> [...params]',
                        '',
                        'Scroll through logs using the ARROW KEYS.',
                        'To expand the full contents of a log, select it with the ARROW KEYS and press ENTER.',
                        'Selecting a log pauses log stream auto-scrolling. Press END to jump to the most recent log and resume auto-scrolling.',
                        'You can view all key bindings at the bottom of this help page.',
                        '',
                        {level: 'sift', message: 'Query Language'},
                        'Sift uses a simple query language to find and filter JSON formatted logs.',
                        '',
                        'To search all keys and values, just start typing your search.',
                        '   > error',
                        '(matches objects with "error" as a key or value)',
                        '',
                        'You can find logs matching a specific key-value pair by separating the key and value with a colon (:).',
                        '"key:value"',
                        '   > level:error',
                        '(matches all objects with the key "level" whose value matches the string "error")',
                        '',
                        'You can also type the colon but leave off the key or value to do a partial search.',
                        '"key:" or ":value"',
                        '   > level:',
                        '(matches all objects with the key "level")',
                        '   > :error',
                        '(matches all objects with the value "error" on any property)',
                        '',
                        'To search specific keys within an object, use dot notation.',
                        '   > node.data',
                        '(matches all objects with the "node" key whose value is an object with the property "data")',
                        '',
                        'Dot notation works to any depth, and can be combined with a colon to match a specific value.',
                        '   > node.data.id:42',
                        '',
                        {level: 'sift', message: 'Operators'},
                        'More complex queries can be created with unary and binary operators.',
                        '',
                        '   " " (space): Logical AND. Example: "error critical"',
                        '   "," (comma): Logical OR. Example: "error,warn"',
                        '   The AND operator (space) takes precedence over the OR operator (comma), meaning queries are always written in disjunctive normal form. Example: "error critical,status failed" means "(error && critical) || (status && failed)".',
                        '   "!" (exclamation point): Exclude',
                        '      "!key:value": matches objects with "value", excluding values associated with "key". Example: "!timestamp:2020" returns logs with a value matching "2020" only if the property for that value does not match "timestamp".',
                        '      "key:!value": matches objects with "key" property, if the value of "key" doesn\'t match "value". Example: "error:!connection" returns logs with a property matching "error" only if the value associated with that property does not match "connection".',
                        '',
                        'You can also surround part of a query with quotation marks (") to search for a literal string, in case you want to search for a string containing sift operators. This is currently buggy and doesn\'t work if your query contains more than one quoted string.',
                        '',
                        {level: 'sift', message: 'Fuzzy Matching'},
                        'All queries are matched using a case-insensitive fuzzy string matching algorithm.',
                        'The algorithm is provided by the farzher/fuzzysort library (https://github.com/farzher/fuzzysort/).',
                        'Non-string datatypes are interpreted as strings during the filtering process.',
                        '',
                        'When you enter a query, each matching property and value across all logs is assigned a score based on how closely it matches the query.',
                        'Logs are only displayed if their score exceeds the fuzzy matching threshold.',
                        '',
                        'There are times when the default threshold may be too strict or too permissive for your query.',
                        'You can decrease the threshold to narrow your search by pressing SHIFT_PAGE_DOWN, or broaden your search with SHIFT_PAGE_UP.',
                        '',
                        'The selected threshold is indicated by the bar left of the matches counter. When the bar is full, your query will match the maximum number of logs.',
                        'The bar changes color to indicate that the threshold has been changed from the default value.',
                        '',
                        {level: 'sift', message: 'Command Mode'},
                        'Many features of sift are accessed through Command Mode.',
                        'Open the command panel by pressing \\, then press the key associated with an option to select it.',
                        'If you wish to enter a backslash into your query, type \\ as your selection.',
                        'You can return to Query Mode at any time by pressing ESCAPE or CTRL_C',
                        '',
                        {level: 'sift', message: 'Filter Mode'},
                        'In Filter Mode you can create and toggle persistent filters that are applied as additional AND rules to your query.',
                        'To enable or disable a filter, press the key associated with the filter.',
                        'To create a filter or edit an existing filter, hold SHIFT and press the key for the filter you wish to edit, then enter a name and query.',
                        'Saved filters are not persisted between sessions.',
                        '',
                        {level: 'sift', message: 'Formatting Mode'},
                        'Formatting mode lets you control the data that is displayed on unexpanded logs.',
                        'Use the ARROW KEYS to select a formatting rule and press ENTER to enable or disable it.',
                        'Timestamps are hidden by default.',
                        'Formatting options are not persisted between sessions and cannot be edited at this time.',
                        '',
                        {level: 'sift', message: 'Log Streams'},
                        'When you spawn a process in sift, its STDOUT and STDERR file descriptors are captured, line-by-line into an in-memory log stream.',
                        'Currently, Sift only supports line-separated JSON as input. Inputs that fail to parse as JSON are converted into a JSON object with the structure:',
                        '{',
                        '   "level": "info",',
                        '   "message": "[INPUT]"',
                        '}',
                        '',
                        'Logs ingested from STDERR are always assigned the level "error", and may override the original value of "level".',
                        '',
                        'As each log is ingested, it is assigned a unique "Log Index", which is visible in the left column of the log display.',
                        'You can jump to a specific log index by typing \\g and entering a log number.',
                        '',
                        {level: 'sift', message: 'Windows'},
                        'Each log stream can be displayed in one or more split windows.',
                        'Spawning a process always opens a new window. You can kill a running process by pressing CTRL_C.',
                        'Pressing CTRL_C on a process that has already terminated closes the window.',
                        '',
                        'Split a log stream into an additional window with the \\v command.',
                        'Each window has its own query, filters, and formatting rules.',
                        'Type \\c to close a split window without terminating the process.',
                        '',
                        {level: 'sift', message: 'Key Bindings'},
                        ...Object.entries(this.bindings).reduce((text, [mode, bindings]) => {
                            text.push(`${Input.Mode[parseInt(mode) as Input.Mode]}:`)
                            Object.entries(bindings).forEach(([key, action]) => {
                                text.push(`   ${key + ' '.repeat(16 - key.length)} ${action.description}`);
                            });
                            return text;
                        }, [] as string[]),
                    ];
                    const logStream = LogStream.fromObservable('sift help',
                        from(helpText)
                    );
                    const panel = new LogStreamPanel(this.display.logPanel.buffer, {
                        name: `sift-help`,
                        width: 1,
                        height: 1,
                        flex: {
                            width: true,
                            height: true,
                        },
                    }, logStream);

                    this.display.showLogStreamPanel(panel);
                    this.display.selectLogStreamPanel(this.display.logStreamPanels.length - 1);
                    this.currentLogStreamPanel = panel;
                    this.actions[Input.Mode.Command].exitCommandMode.fn(key, matches, data);

                    if(this.display.logStreamPanels.length === 2 && this.display.logStreamPanels[0].panel === this.siftLogStreamPanel) {
                        // hide the startup screen/debug panel when displaying help
                        this.display.hideLogStreamPanel(this.siftLogStreamPanel);
                    }

                    this.display.draw();
                }
            }
        }),
        [Input.Mode.Filter]: asActions({
            'enterFilterMode': {
                description: 'Enter filter mode',
                fn: () => {
                    this.input.mode = Input.Mode.Filter;
                    this.display.hideCommandPanel();
                    this.display.hideQueryKeyPanel();
                    this.updateFilterPanel(this.currentLogStreamPanel);
                    this.display.showFilterPanel();
                    this.display.draw();
                }
            },
            'exitFilterMode': {
                description: 'Exit Filter mode and return to Query mode',
                fn: () => {
                    this.input.mode = Input.Mode.Query;
                    this.display.hideFilterPanel();
                    this.display.showQueryKeyPanel();
                    this.display.draw();
                }
            },
            'selectPanelLeft': {
                description: 'Move window selection left',
                fn: (key, matches, data) => {
                    this.actions[Input.Mode.Query].selectPanelLeft.fn(key, matches, data);
                    this.updateFilterPanel(this.currentLogStreamPanel);
                    this.display.draw();
                }
            },
            'selectPanelRight': {
                description: 'Move window selection right',
                fn: (key, matches, data) => {
                    this.actions[Input.Mode.Query].selectPanelRight.fn(key, matches, data);
                    this.updateFilterPanel(this.currentLogStreamPanel);
                    this.display.draw();
                }
            }
        }),
        [Input.Mode.Format]: asActions({
            'enterFormatMode': {
                description: 'Enter message formatting mode',
                fn: () => {
                    this.input.mode = Input.Mode.Format;
                    this.display.hideCommandPanel();
                    this.display.hideQueryKeyPanel();
                    this.display.showFormatPanel();
                    this.display.draw();
                }
            },
            'exitFormatMode': {
                description: 'Exit Format mode and return to Query mode',
                fn: () => {
                    this.input.mode = Input.Mode.Query;
                    this.display.hideFormatPanel();
                    this.display.showQueryKeyPanel();
                    this.display.draw();
                }
            },
            'moveFormatSelectionUp': {
                description: 'Move format mode cursor up',
                fn: () => {
                    this.display.formatPanel.moveSelectionUp()
                    this.display.draw()
                }
            },
            'moveFormatSelectionDown': {
                description: 'Move format mode cursor down',
                fn: () => {
                    this.display.formatPanel.moveSelectionDown()
                    this.display.draw()
                }
            },
            'toggleFormatEnabled': {
                description: 'Toggle format rule on/off',
                fn: () => {
                    this.display.formatPanel.toggleSelectionEnabled()

                    const format = this.display.formatPanel.rules.filter((rule) => rule.enabled).map((rule) => rule.format);
                    this.display.logStreamPanels.forEach((logStreamPanel) => {
                        logStreamPanel.panel.logDisplayPanel.logFormat.format = format;
                        logStreamPanel.panel.logDisplayPanel.logEntryCache.clear();
                        logStreamPanel.panel.logDisplayPanel.markDirty();
                    });

                    this.display.draw()
                }
            }
        }),
        [Input.Mode.Text]: asActions({
            'submitText': {
                description: 'Submit the text input and close the prompt',
                fn: () => {
                    this.display.hideTextPanel();
                    this.display.showQueryKeyPanel();
                    // default to query mode. onSubmit may override this
                    this.input.mode = Input.Mode.Query;
                    (this.display.terminal as any).hideCursor(false);
                    if(this.textPromptOnSubmit) {
                        this.textPromptOnSubmit(this.display.textInputPanel.buffer.getText());
                    }
                    else {
                        this.display.draw();
                    }
                }
            },
            'cancelText': {
                description: 'Cancel text input and close the prompt',
                fn: () => {
                    this.display.hideTextPanel();
                    this.display.showQueryKeyPanel();
                    // default to query mode. onCancel may override this
                    this.input.mode = Input.Mode.Query;
                    (this.display.terminal as any).hideCursor(false);
                    if(this.textPromptOnCancel) {
                        this.textPromptOnCancel();
                    }
                    else {
                        this.display.draw();
                    }
                }
            },
            'textCursorLeft': {
                description: 'Move text cursor left',
                fn: () => {
                    this.display.textInputPanel.buffer.moveBackward(false);
                    this.display.textInputPanel.markDirty();
                    this.display.draw();
                }
            },
            'textCursorRight': {
                description: 'Move text cursor right',
                fn: () => {
                    if((this.display.textInputPanel.buffer as any).cx < this.display.textInputPanel.buffer.getText().length) {
                        this.display.textInputPanel.buffer.moveForward(false);

                        this.display.textInputPanel.markDirty();
                        this.display.draw();
                    }
                }
            },
            'backspace': {
                description: 'Back delete the text',
                fn: () => {
                    this.display.textInputPanel.buffer.backDelete(1);
                    this.display.textInputPanel.markDirty();
                    this.display.draw();
                }
            },
            'delete': {
                description: 'Forward delete the text',
                fn: () => {
                    this.display.textInputPanel.buffer.delete(1);
                    this.display.textInputPanel.markDirty();
                    this.display.draw();
                }
            },
        }),
    };

    public bindings: {[mode in Input.Mode]: {[key: string]: Input.Action}} = {
        [Input.Mode.Query]: {
            'CTRL_C': this.actions[Input.Mode.Query].closeLogStream,
            'CTRL_LEFT': this.actions[Input.Mode.Query].selectPanelLeft,
            'CTRL_H': this.actions[Input.Mode.Query].selectPanelLeft,
            'CTRL_RIGHT': this.actions[Input.Mode.Query].selectPanelRight,
            'CTRL_L': this.actions[Input.Mode.Query].selectPanelRight,

            'ENTER': this.actions[Input.Mode.Query].toggleSelection,
            'KP_ENTER': this.actions[Input.Mode.Query].toggleSelection,
            'UP': this.actions[Input.Mode.Query].moveSelectionUp,
            'DOWN': this.actions[Input.Mode.Query].moveSelectionDown,
            'LEFT': this.actions[Input.Mode.Query].scrollLeft,
            'RIGHT': this.actions[Input.Mode.Query].scrollRight,
            'PAGE_UP': this.actions[Input.Mode.Query].pageUp,
            'PAGE_DOWN': this.actions[Input.Mode.Query].pageDown,
            'HOME': this.actions[Input.Mode.Query].scrollStart,
            'END': this.actions[Input.Mode.Query].scrollEnd,

            'SHIFT_LEFT': this.actions[Input.Mode.Query].queryCursorLeft,
            'SHIFT_RIGHT': this.actions[Input.Mode.Query].queryCursorRight,
            // 'SHIFT_UP': this.actions[Input.Mode.Query].queryHistoryBack,
            // 'SHIFT_DOWN': this.actions[Input.Mode.Query].queryHistoryForward,
            'SHIFT_PAGE_UP': this.actions[Input.Mode.Query].fuzzyThresholdBroaden,
            'SHIFT_PAGE_DOWN': this.actions[Input.Mode.Query].fuzzyThresholdNarrow,
            'CTRL_E': this.actions[Input.Mode.Query].scrollDown,
            'CTRL_Y': this.actions[Input.Mode.Query].scrollUp,
            'BACKSPACE': this.actions[Input.Mode.Query].backspace,
            'DELETE': this.actions[Input.Mode.Query].delete,
            'ESCAPE': this.actions[Input.Mode.Query].clearQuery,
            '\\': this.actions[Input.Mode.Command].enterCommandMode,
        },
        [Input.Mode.Command]: {
            'CTRL_C': this.actions[Input.Mode.Command].exitCommandMode,
            'ESCAPE': this.actions[Input.Mode.Command].exitCommandMode,
            'BACKSPACE': this.actions[Input.Mode.Command].exitCommandMode,

            'ENTER': this.actions[Input.Mode.Query].toggleSelection,
            'KP_ENTER': this.actions[Input.Mode.Query].toggleSelection,
            'UP': this.actions[Input.Mode.Query].moveSelectionUp,
            'DOWN': this.actions[Input.Mode.Query].moveSelectionDown,
            'LEFT': this.actions[Input.Mode.Query].scrollLeft,
            'RIGHT': this.actions[Input.Mode.Query].scrollRight,
            'PAGE_UP': this.actions[Input.Mode.Query].pageUp,
            'PAGE_DOWN': this.actions[Input.Mode.Query].pageDown,
            'HOME': this.actions[Input.Mode.Query].scrollStart,
            'END': this.actions[Input.Mode.Query].scrollEnd,
        },
        [Input.Mode.Filter]: {
            'CTRL_C': this.actions[Input.Mode.Filter].exitFilterMode,
            'ESCAPE': this.actions[Input.Mode.Filter].exitFilterMode,
            'BACKSPACE': this.actions[Input.Mode.Filter].exitFilterMode,
            'CTRL_LEFT': this.actions[Input.Mode.Filter].selectPanelLeft,
            'CTRL_H': this.actions[Input.Mode.Filter].selectPanelLeft,
            'CTRL_RIGHT': this.actions[Input.Mode.Filter].selectPanelRight,
            'CTRL_L': this.actions[Input.Mode.Filter].selectPanelRight,

            'ENTER': this.actions[Input.Mode.Query].toggleSelection,
            'KP_ENTER': this.actions[Input.Mode.Query].toggleSelection,
            'UP': this.actions[Input.Mode.Query].moveSelectionUp,
            'DOWN': this.actions[Input.Mode.Query].moveSelectionDown,
            'LEFT': this.actions[Input.Mode.Query].scrollLeft,
            'RIGHT': this.actions[Input.Mode.Query].scrollRight,
            'PAGE_UP': this.actions[Input.Mode.Query].pageUp,
            'PAGE_DOWN': this.actions[Input.Mode.Query].pageDown,
            'HOME': this.actions[Input.Mode.Query].scrollStart,
            'END': this.actions[Input.Mode.Query].scrollEnd,
        },
        [Input.Mode.Format]: {
            'CTRL_C': this.actions[Input.Mode.Format].exitFormatMode,
            'ESCAPE': this.actions[Input.Mode.Format].exitFormatMode,
            'BACKSPACE': this.actions[Input.Mode.Format].exitFormatMode,
            'UP': this.actions[Input.Mode.Format].moveFormatSelectionUp,
            'DOWN': this.actions[Input.Mode.Format].moveFormatSelectionDown,
            'ENTER': this.actions[Input.Mode.Format].toggleFormatEnabled,
            'KP_ENTER': this.actions[Input.Mode.Format].toggleFormatEnabled,
        },
        [Input.Mode.Text]: {
            'CTRL_C': this.actions[Input.Mode.Text].cancelText,
            'ESCAPE': this.actions[Input.Mode.Text].cancelText,
            'ENTER': this.actions[Input.Mode.Text].submitText,
            'KP_ENTER': this.actions[Input.Mode.Text].submitText,
            'LEFT': this.actions[Input.Mode.Text].textCursorLeft,
            'RIGHT': this.actions[Input.Mode.Text].textCursorRight,
            'BACKSPACE': this.actions[Input.Mode.Text].backspace,
            'DELETE': this.actions[Input.Mode.Text].delete,
        }
    };

    /** commands listed in the command panel. they are displayed in array order */
    public commands: Command[] = [{
            key: '\\',
            action: this.actions[Input.Mode.Command].insertBackslash,
        }, {
            key: 'f',
            action: this.actions[Input.Mode.Filter].enterFilterMode,
        }, {
            key: 'm',
            action: this.actions[Input.Mode.Format].enterFormatMode,
        }, {
            key: 'c',
            action: this.actions[Input.Mode.Command].closeWindow,
        }, {
            key: 'g',
            action: this.actions[Input.Mode.Command].gotoLog,
        }, {
            key: 's',
            action: this.actions[Input.Mode.Command].spawnProcess,
        }, {
            key: 'v',
            action: this.actions[Input.Mode.Command].splitWindowVertical,
        }, {
            key: '?',
            action: this.actions[Input.Mode.Command].displayHelp,
        }];

    protected handleQueryInput = (name: string, matches: string[], data: any) => {
        if(data.isCharacter) {
            this.currentLogStreamPanel.queryPromptInputPanel.buffer.insert(name);
            this.onQueryChanged();
        }
    };

    protected handleCommandInput = (name: string, matches: string[], data: any) => {
        this.display.commandPanel.commands.forEach((command) => {
            if(name === command.key) {
                command.action.fn(name, matches, data);
            }
        });
    };

    protected handleTextInput = (name: string, matches: string[], data: any) => {
        if(data.isCharacter) {
            this.display.textInputPanel.buffer.insert(name);
            this.display.textInputPanel.markDirty();
            this.display.draw();
        }
    };

    protected handleFilterInput = (name: string, matches: string[], data: any) => {
        // TODO: make rules for each logstream independent
        if(data.code >= 97 && data.code <= 122) {
            // lowercase alphabet
            // toggle the filter
            const rule = this.display.filterPanel.rules[name];
            if(rule) {
                rule.enabled = !rule.enabled;
                this.currentLogStreamPanel.filterRules[name] = {...rule};
                this.currentLogStreamPanel.setQuery((this.currentLogStreamPanel.queryPromptInputPanel.buffer as any).getText());

                this.display.filterPanel.markDirty();
                this.display.draw();
            }
        }
        else if(data.code >= 65 && data.code <= 90) {
            // uppercase alphabet
            // edit or create a rule
            const key = name.toLowerCase();
            const onCancel = () => {
                this.input.mode = Input.Mode.Filter;
                (this.display.terminal as any).hideCursor(true);
                this.display.draw();
            };
            const rule = this.display.filterPanel.rules[key];
            if(rule) {
                // edit
                this.promptTextInput(`Edit filter '${key}' (name)`, (filterName) => {
                    if(filterName === '') {
                        onCancel();
                        return;
                    }
                    this.promptTextInput(`Edit filter '${key}' (query)`, (query) => {
                        if(query === '') {
                            onCancel();
                            return;
                        }
                        const rule = {
                            enabled: true,
                            name: filterName,
                            query
                        };
                        this.display.filterPanel.setRule(key, rule);
                        this.input.mode = Input.Mode.Filter;
                        (this.display.terminal as any).hideCursor(true);
                        this.display.filterPanel.markDirty();

                        // we need to update all log stream panels that had this rule applied
                        this.logStreams.forEach((logStream) => {
                            const panelRule = logStream.panel.filterRules[key];
                            if(panelRule && panelRule.enabled) {
                                logStream.panel.filterRules[key] = {...rule};
                                logStream.panel.setQuery((logStream.panel.queryPromptInputPanel.buffer as any).getText());
                                logStream.panel.markDirty();

                            }
                        });

                        this.display.draw();
                    },
                        onCancel,
                        rule.query);
                },
                    onCancel,
                    rule.name,
                );
            }
            else {
                // create
                this.promptTextInput(`New filter '${key}' (name)`, (filterName) => {
                    if(filterName === '') {
                        onCancel();
                        return;
                    }
                    this.promptTextInput(`New filter '${key}' (query)`, (query) => {
                        if(query === '') {
                            onCancel();
                            return;
                        }
                        const rule = {
                            enabled: true,
                            name: filterName,
                            query
                        };
                        this.display.filterPanel.setRule(key, rule);
                        this.input.mode = Input.Mode.Filter;
                        (this.display.terminal as any).hideCursor(true);
                        this.display.filterPanel.markDirty();
                        this.currentLogStreamPanel.filterRules[key] = {...rule};
                        this.currentLogStreamPanel.setQuery((this.currentLogStreamPanel.queryPromptInputPanel.buffer as any).getText());
                        this.display.draw();
                    }, onCancel);
                }, onCancel);
            }
        }
    };
}

// helper function which infers keys and restricts values to Input.Action
// this allows strongly typed action object
function asActions<T>(actions: { [K in keyof T]: Input.Action }) {
    return actions;
}

/*
*
// {
//     const fuzzyThresholdStr = Math.log10(-logdb.fuzzysortThreshold).toString();
//     (display.fuzzyThreshold.buffer as any).setText('');
//     (display.fuzzyThreshold.buffer as any).moveTo(
//         display.fuzzyThreshold.calculatedWidth - fuzzyThresholdStr.length,
//         0
//     );
//     display.fuzzyThreshold.buffer.insert(fuzzyThresholdStr);
//     display.fuzzyThreshold.draw();
// }

        else if(name === 'SHIFT_UP') {
            // logdb.fuzzysortThreshold = Math.floor(logdb.fuzzysortThreshold * 10);
            // const fuzzyThresholdStr = Math.log10(-logdb.fuzzysortThreshold).toString();
			// (display.fuzzyThreshold.buffer as any).setText('');
			// (display.fuzzyThreshold.buffer as any).moveTo(
			    // display.fuzzyThreshold.calculatedWidth - fuzzyThresholdStr.length,
			    // 0
			// );
            // display.fuzzyThreshold.buffer.insert(fuzzyThresholdStr);
            // display.fuzzyThreshold.draw();
            // onQueryChanged();
        }
        else if(name === 'SHIFT_DOWN') {
            // logdb.fuzzysortThreshold = Math.min(-1, logdb.fuzzysortThreshold / 10);
            // const fuzzyThresholdStr = Math.log10(-logdb.fuzzysortThreshold).toString();
			// (display.fuzzyThreshold.buffer as any).setText('');
			// (display.fuzzyThreshold.buffer as any).moveTo(
			    // display.fuzzyThreshold.calculatedWidth - fuzzyThresholdStr.length,
			    // 0
			// );
            // display.fuzzyThreshold.buffer.insert(fuzzyThresholdStr);
            // display.fuzzyThreshold.draw();
            // onQueryChanged();
        }
*
            else if(name === '1') {
                display.filterPanel.rules[0].enabled = !display.filterPanel.rules[0].enabled;
                display.filterPanel.printRules();
                display.filterPanel.redrawChildren();
                display.filterPanel.draw();
                onQueryChanged();
            }
            else if(name === '2') {
                display.filterPanel.rules[1].enabled = !display.filterPanel.rules[1].enabled;
                display.filterPanel.printRules();
                display.filterPanel.redrawChildren();
                display.filterPanel.draw();
                onQueryChanged();
            }
        }
*/

// exitLogs.push({level: 'error', message: err});
// close();
