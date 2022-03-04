import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

import { Display } from './display';
import { LogStream } from './logstream';
import { LogStreamPanel } from './logstreampanel';
import { Input } from './input';
import { Command } from './commandpanel';

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
            [Input.Mode.Text]: {
                bindings: this.bindings[Input.Mode.Text],
                fallback: this.handleTextInput,
            }
        });

        this.siftLogsSubject.next('Sift started successfully');

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

    }

    public spawnProcess(exec: string, args: string[]) {
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

        this.display.showLogStreamPanel(panel);
        panel.options.drawCursor = true;

        this.logStreams.push({stream, panel});

        this.display.draw();
    }

    public terimnateProcess(logStream: LogStream<LogStream.Source.Process>) {
        if(logStream.source.running) {
            logStream.logdb.ingest(JSON.stringify({
                level: 'warn',
                message: `Sending SIGTERM to child process "${logStream.source.process.spawnfile}" (${logStream.source.process.pid})`
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

    public onQueryChanged() {
        this.currentLogStreamPanel.queryPromptInputPanel.markDirty();
        this.display.draw();
        this.queryChangedSubject.next(this.currentLogStreamPanel);
    }

    public promptTextInput(label: string, onSubmit: (text: string) => void, onCancel?: () => void, startingText?: string) {
        const labelText = label + ': ';
        this.display.textLabelPanel.options.width = labelText.length;
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
            'terimnateProcessOrClose': {
                description: 'Terminate process. If all processes are terminated, close sift',
                fn: () => {
                    const runningProcesses = this.logStreams.reduce((count, stream) => {
                        if(stream.stream.source.sType === 'process' && stream.stream.source.running) {
                            count++;
                        }
                        return count;
                    }, 0);

                    if(runningProcesses === 0) {
                        this.close();
                    }
                    else {
                        if(this.currentLogStreamPanel.logStream.source.sType === 'process') {
                            this.terimnateProcess(this.currentLogStreamPanel.logStream as LogStream<LogStream.Source.Process>);
                        }
                        else {
                            this.siftLogsSubject.next(`Cannot close sift: ${runningProcesses} processes still running`);
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
                    this.currentLogStreamPanel.queryResultsPanel.markDirty();
                    this.display.draw();
                }
            },
            'scrollUp': {
                description: 'Move selection up one log',
                fn: () => {
                    this.currentLogStreamPanel.logDisplayPanel.moveSelectionUp(1);
                    this.currentLogStreamPanel.logDisplayPanel.scrollToSelection();
                    this.currentLogStreamPanel.autoscroll = false;
                    this.currentLogStreamPanel.queryResultsPanel.markDirty();
                    this.display.draw();
                }
            },
            'scrollDown': {
                description: 'Move selection down one log',
                fn: () => {
                    this.currentLogStreamPanel.logDisplayPanel.moveSelectionDown(1);
                    this.currentLogStreamPanel.logDisplayPanel.scrollToSelection();
                    this.currentLogStreamPanel.autoscroll = false;
                    this.currentLogStreamPanel.queryResultsPanel.markDirty();
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
        }),
        [Input.Mode.Command]: asActions({
            'enterCommandMode': {
                description: 'Display the command pane',
                fn: () => {
                    this.input.mode = Input.Mode.Command;
                    this.display.showCommandPanel();
                    this.display.draw();
                }
            },
            'exitCommandMode': {
                description: 'Exit Command mode and return to Query mode',
                fn: () => {
                    this.input.mode = Input.Mode.Query;
                    this.display.hideCommandPanel();
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

                                this.input.mode = Input.Mode.Query;
                                (this.display.terminal as any).hideCursor(false);
                                this.display.draw();
                            }
                        }
                    );
                }
            }
        }),
        [Input.Mode.Filter]: asActions({
            'enterFilterMode': {
                description: 'Enter filter mode',
                fn: () => {
                    this.input.mode = Input.Mode.Filter;
                    this.display.hideCommandPanel();
                    this.display.showFilterPanel();
                    this.display.draw();
                }
            },
            'exitFilterMode': {
                description: 'Exit Filter mode and return to Query mode',
                fn: () => {
                    this.input.mode = Input.Mode.Query;
                    this.display.hideFilterPanel();
                    this.display.draw();
                }
            }
        }),
        [Input.Mode.Text]: asActions({
            'submitText': {
                description: 'Submit the text input and close the prompt',
                fn: () => {
                    this.display.hideTextPanel();
                    // default to query mode. onSubmit may override this
                    this.input.mode = Input.Mode.Query;
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
                    // default to query mode. onCancel may override this
                    this.input.mode = Input.Mode.Query;
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
                description: 'Forward delete the query',
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
            'CTRL_C': this.actions[Input.Mode.Query].terimnateProcessOrClose,
            'CTRL_LEFT': this.actions[Input.Mode.Query].selectPanelRight,
            'CTRL_RIGHT': this.actions[Input.Mode.Query].selectPanelLeft,
            'ENTER': this.actions[Input.Mode.Query].toggleSelection,
            'KP_ENTER': this.actions[Input.Mode.Query].toggleSelection,
            'UP': this.actions[Input.Mode.Query].scrollUp,
            'DOWN': this.actions[Input.Mode.Query].scrollDown,
            'PAGE_UP': this.actions[Input.Mode.Query].pageUp,
            'PAGE_DOWN': this.actions[Input.Mode.Query].pageDown,
            'HOME': this.actions[Input.Mode.Query].scrollStart,
            'END': this.actions[Input.Mode.Query].scrollEnd,
            'LEFT': this.actions[Input.Mode.Query].queryCursorLeft,
            'RIGHT': this.actions[Input.Mode.Query].queryCursorRight,
            'BACKSPACE': this.actions[Input.Mode.Query].backspace,
            'DELETE': this.actions[Input.Mode.Query].delete,
            'ESCAPE': this.actions[Input.Mode.Query].clearQuery,
            '\\': this.actions[Input.Mode.Command].enterCommandMode,
        },
        [Input.Mode.Command]: {
            'CTRL_C': this.actions[Input.Mode.Command].exitCommandMode,
            'ESCAPE': this.actions[Input.Mode.Command].exitCommandMode,
            'BACKSPACE': this.actions[Input.Mode.Command].exitCommandMode,
        },
        [Input.Mode.Filter]: {
            'CTRL_C': this.actions[Input.Mode.Filter].exitFilterMode,
            'ESCAPE': this.actions[Input.Mode.Filter].exitFilterMode,
            'BACKSPACE': this.actions[Input.Mode.Filter].exitFilterMode,
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
            key: 'g',
            action: this.actions[Input.Mode.Command].gotoLog,
        }];

    protected handleQueryInput = (name: any, matches: any, data: any) => {
        if(data.isCharacter) {
            this.currentLogStreamPanel.queryPromptInputPanel.buffer.insert(name);
            this.onQueryChanged();
        }
    };

    protected handleCommandInput = (name: any, matches: any, data: any) => {
        this.display.commandPanel.commands.forEach((command) => {
            if(name === command.key) {
                command.action.fn(name, matches, data);
            }
        });
    };

    protected handleTextInput = (name: any, matches: any, data: any) => {
        if(data.isCharacter) {
            this.display.textInputPanel.buffer.insert(name);
            this.display.textInputPanel.markDirty();
            this.display.draw();
        }
    };

    protected handleFilterInput = (name: string, matches: any, data: any) => {
        // TODO: make rules for each logstream independent
        if(data.code >= 97 && data.code <= 122) {
            // lowercase alphabet
            // toggle the filter
            const rule = this.display.filterPanel.rules[name];
            if(rule) {
                rule.enabled = !rule.enabled;
                this.display.filterPanel.markDirty();
                this.currentLogStreamPanel.filterRules = Object.values(this.display.filterPanel.rules);
                this.currentLogStreamPanel.setQuery((this.currentLogStreamPanel.queryPromptInputPanel.buffer as any).getText());
                this.display.draw();
            }
        }
        else if(data.code >= 65 && data.code <= 90) {
            // uppercase alphabet
            // edit or create a rule
            const onCancel = () => {
                this.input.mode = Input.Mode.Filter;
                this.display.draw();
            };
            const rule = this.display.filterPanel.rules[name.toLowerCase()];
            if(rule) {
                // edit
                this.promptTextInput(`Edit filter '${name.toLowerCase()}' (name)`, (filterName) => {
                    this.promptTextInput(`Edit filter '${name.toLowerCase()}' (query)`, (query) => {
                        this.display.filterPanel.setRule(name.toLowerCase(), {
                            enabled: true,
                            name: filterName,
                            query
                        });
                        this.input.mode = Input.Mode.Filter;
                        this.display.filterPanel.markDirty();
                        this.currentLogStreamPanel.filterRules = Object.values(this.display.filterPanel.rules);
                        this.currentLogStreamPanel.setQuery((this.currentLogStreamPanel.queryPromptInputPanel.buffer as any).getText());
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
                this.promptTextInput(`New filter '${name.toLowerCase()}' (name)`, (filterName) => {
                    this.promptTextInput(`New filter '${name.toLowerCase()}' (query)`, (query) => {
                        this.display.filterPanel.setRule(name.toLowerCase(), {
                            enabled: true,
                            name: filterName,
                            query
                        });
                        this.input.mode = Input.Mode.Filter;
                        this.display.filterPanel.markDirty();
                        this.currentLogStreamPanel.filterRules = Object.values(this.display.filterPanel.rules);
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
