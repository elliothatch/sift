import * as Path from 'path';
import { createInterface, Interface } from 'readline';

import { spawn, ChildProcess } from 'child_process';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

import { of, EMPTY, concat, merge, fromEvent, race, Subscription, interval, Subject } from 'rxjs';
import { mergeMap, map, skip, tap, debounceTime, auditTime, publish, filter, take, takeUntil, delay } from 'rxjs/operators';

import { Display } from './display';
import { Panel } from './panel';
import { LogDb, LogRecord, LogIndex, ResultSet, FilterMatch } from './logdb';
import { Parse, Parser } from './query';
import { Command } from './commandpanel';
import { LogStream } from './logstream';

const exitLogs: Array<{level?: string, message: any}> = [];

if(process.argv.length <= 2) {
    console.log('Usage: sift <exec> [...execParams]');
    process.exit();
}


const display = new Display();
display.init();

const logdb = new LogDb();
const parser = new Parser();

const processStream = LogStream.fromProcess(process.argv[2], process.argv.slice(3));
const processLogStreamPanel = display.addLogStreamPanel(processStream);
processLogStreamPanel.options.drawCursor = true;

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

display.commandPanel.setCommands([{
    key: '\\',
    description: 'insert \\',
    action: (key, matches, data) => {
        exitCommandMode();
        processLogStreamPanel.queryPromptInputPanel.buffer.insert(key);
        processLogStreamPanel.queryPromptInputPanel.draw();
        onQueryChanged();
    }
}, {
    key: 'f',
    description: 'filter',
    action: (key, matches, data) => {
        exitCommandMode();
        enterFilterMode();
    }
}]);

display.filterPanel.setRules([{
    enabled: false,
    name: 'Error',
    query: 'level:error'
}, {
    enabled: false,
    name: 'Warning',
    query: 'level:warn'
}]);

enum CommandMode {
    QUERY,
    COMMAND,
    FILTER,
};

let commandMode: CommandMode = CommandMode.QUERY;

const drawLogs = () => {
    processLogStreamPanel.logDisplayPanel.print();
    processLogStreamPanel.printQueryResults();
    processLogStreamPanel.redrawChildren();
    processLogStreamPanel.draw();
};

processLogStreamPanel.redrawEvents.subscribe(() => {
    processLogStreamPanel.redrawChildren();
    processLogStreamPanel.draw();
});


display.terminal.on('key', (name: any, matches: any, data: any) => {
	try {
	    if(commandMode === CommandMode.COMMAND) {
	        // top level command mode
	        if(name === 'CTRL_C' || name === 'ESCAPE' || name === 'BACKSPACE') {
	            exitCommandMode();
            }
            else {
                display.commandPanel.commands.forEach((command) => {
                    if(name === command.key) {
                        command.action(name, matches, data);
                    }
                });
            }
        }
        else if(commandMode === CommandMode.FILTER) {
	        if(name === 'CTRL_C' || name === 'ESCAPE' || name === 'BACKSPACE') {
	            exitFilterMode();
            }
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
		else if(name === 'CTRL_C') {
			if(processStream.source.running) {
                processStream.logdb.ingest(JSON.stringify({level: 'warn', message: `Sending SIGTERM to child process "${processStream.source.process.spawnfile}" (${processStream.source.process.pid})`}));
			    processLogStreamPanel.logStream.source.process.kill();
            }
            else {
                close();
            }
        }
		else if(name === '\\') {
            enterCommandMode();
        }
		else if(name === 'BACKSPACE') {
			processLogStreamPanel.queryPromptInputPanel.buffer.backDelete(1);
			// filterLogs(queryTextBuffer.getText());
			processLogStreamPanel.queryPromptInputPanel.draw();
			onQueryChanged();
		}
		else if(name === 'DELETE') {
			processLogStreamPanel.queryPromptInputPanel.buffer.delete(1);
			// filterLogs(queryTextBuffer.getText());
			processLogStreamPanel.queryPromptInputPanel.draw();
			onQueryChanged();
		}
		else if(name === 'TAB') {
		    // TODO: make this per-panel based on focus
		    // processLogStreamPanel.logDisplayPanel.expandedView = !processLogStreamPanel.logDisplayPanel.expandedView;
		    // processLogStreamPanel.logDisplayPanel.logEntryCache.clear();
            // processLogStreamPanel.logDisplayPanel.print(0);
            drawLogs();
        }
        else if(name === 'PAGE_UP') {
            processLogStreamPanel.logDisplayPanel.moveSelectionUp(20);
            processLogStreamPanel.logDisplayPanel.scrollToSelection();
            processLogStreamPanel.autoscroll = false;
            drawLogs();
        }
        else if(name === 'UP') {
            processLogStreamPanel.logDisplayPanel.moveSelectionUp(1);
            processLogStreamPanel.logDisplayPanel.scrollToSelection();
            processLogStreamPanel.autoscroll = false;
            drawLogs();
        }
        else if(name === 'PAGE_DOWN') {
            processLogStreamPanel.logDisplayPanel.moveSelectionDown(20);
            processLogStreamPanel.logDisplayPanel.scrollToSelection();
            processLogStreamPanel.autoscroll = false;
            drawLogs();
        }
        else if(name === 'DOWN') {
            processLogStreamPanel.logDisplayPanel.moveSelectionDown(1);
            processLogStreamPanel.logDisplayPanel.scrollToSelection();
            processLogStreamPanel.autoscroll = false;
            drawLogs();
        }
        else if(name === 'HOME') {
            processLogStreamPanel.logDisplayPanel.selectLog(0);
            processLogStreamPanel.logDisplayPanel.scrollToSelection();
            processLogStreamPanel.autoscroll = false;
            drawLogs();
        }
        else if(name === 'END') {
            processLogStreamPanel.logDisplayPanel.selectLog(processLogStreamPanel.logDisplayPanel.logs.length - 1);
            processLogStreamPanel.logDisplayPanel.scrollToSelection();
            processLogStreamPanel.autoscroll = true;
            drawLogs();
        }
        else if(name === 'ENTER') {
            processLogStreamPanel.logDisplayPanel.toggleExpandSelection();
            processLogStreamPanel.logDisplayPanel.scrollToMaximizeLog(processLogStreamPanel.logDisplayPanel.selectionIndex);
            processLogStreamPanel.autoscroll = false;
            drawLogs();
        }
        else if(name === 'LEFT') {
            processLogStreamPanel.queryPromptInputPanel.buffer.moveBackward(false);
            processLogStreamPanel.queryPromptInputPanel.draw();
        }
        else if(name === 'RIGHT') {
            if((processLogStreamPanel.queryPromptInputPanel.buffer as any).cx < processLogStreamPanel.queryPromptInputPanel.buffer.getText().length) {
                processLogStreamPanel.queryPromptInputPanel.buffer.moveForward(false);
                processLogStreamPanel.queryPromptInputPanel.draw();
            }
        }
		else if(name === 'ESCAPE') {

            (processLogStreamPanel.queryPromptInputPanel.buffer as any).setText('');
            (processLogStreamPanel.queryPromptInputPanel.buffer as any).moveTo(0, 0);
			processLogStreamPanel.queryPromptInputPanel.draw();
			onQueryChanged();
        }
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
        else if(data.isCharacter) {
            processLogStreamPanel.queryPromptInputPanel.buffer.insert(name);
            processLogStreamPanel.queryPromptInputPanel.draw();
            // TODO: create special class/functions LogPanel, that allow adding/removing/setting logs, scrolling, and display options like expanded
            // try {
			onQueryChanged();
            // }
        }
    }
	catch(err) {
        exitLogs.push({level: 'error', message: err});
        close();
        // freshr.kill();
	}
});

display.draw();

const queryChangedSubject = new Subject();
function onQueryChanged() {
    queryChangedSubject.next(null);
}

queryChangedSubject.pipe(
    debounceTime(150),
).subscribe({
    next: () => {
        processLogStreamPanel.setQuery((processLogStreamPanel.queryPromptInputPanel.buffer as any).getText());
    }
});

function close() {
    display.terminal.fullscreen(false);
    processLogStreamPanel.logStream.source.process.kill();
    exitLogs.forEach(({level, message}) => {
        if(level === 'error') {
            console.error(message);
        }
        else {
            console.log(message);
        }
    });
    process.exit();
}

function enterCommandMode() {
    commandMode = CommandMode.COMMAND;
    display.showCommandPanel();
}

function exitCommandMode() {
    commandMode = CommandMode.QUERY;
    display.hideCommandPanel();
}

function enterFilterMode() {
    commandMode = CommandMode.FILTER;
    display.showFilterPanel();
}

function exitFilterMode() {
    commandMode = CommandMode.QUERY;
    display.hideFilterPanel();
}
