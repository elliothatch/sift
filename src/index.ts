import * as Path from 'path';
import { createInterface, Interface } from 'readline';

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

import { of, EMPTY, concat, merge, fromEvent, race, Subscription, interval, Subject } from 'rxjs';
import { mergeMap, map, skip, tap, debounceTime, auditTime, publish, filter, take, takeUntil, delay } from 'rxjs/operators';
import { SkipList } from 'dsjslib';

import { Display } from './display';
import { Panel } from './panel';
import { LogDb, LogRecord, LogIndex, ResultSet, FilterMatch } from './logdb';
import { Parse, Parser } from './query';

const exitLogs: Array<{level?: string, message: any}> = [];

interface Process {
    process: ChildProcessWithoutNullStreams;
    running: boolean;
    stdoutInterface: Interface;
    stderrInterface: Interface;
}

function createProcess(execPath: string, params: string[]): Process {
    const targetProcess = spawn(execPath, params);
    return {
        process: targetProcess,
        running: true,
        stdoutInterface: createInterface({input: targetProcess.stdout}),
        stderrInterface: createInterface({input: targetProcess.stderr}),
    };
}

const display = new Display();
display.init();

const logdb = new LogDb();
const parser = new Parser();


let cursorPause = -1;

display.terminal.on('key', (name: any, matches: any, data: any) => {
	try {
		if(name === 'CTRL_C') {
			// if(process.running) {
				// freshr.kill();
			// }
			// else {
			// }
			close();
        }
		else if(name === 'BACKSPACE') {
			display.queryPanel.buffer.backDelete(1);
			// filterLogs(queryTextBuffer.getText());
			display.queryPanel.draw();
			onQueryChanged();
		}
		else if(name === 'DELETE') {
			display.queryPanel.buffer.delete(1);
			// filterLogs(queryTextBuffer.getText());
			display.queryPanel.draw();
			onQueryChanged();
		}
		else if(name === 'TAB') {
		    // TODO: make this per-panel based on focus
		    display.logDisplayPanel.expandedView = !display.logDisplayPanel.expandedView;
		    display.logDisplayPanel.logEntryCache.clear();
            // display.logDisplayPanel.print(0);
            drawLogs();
        }
        else if(name === 'UP') {
            if(cursorPause < 0) {
                cursorPause = display.logDisplayPanel.logs.length - 2;
            }
            else if(cursorPause > 0) {
                cursorPause--;
            }
            drawLogs();
        }
        else if(name === 'DOWN') {
            cursorPause = -1;
            drawLogs();
        }
		else if(name === 'ESCAPE') {
			display.queryPanel.buffer.backDelete((display.queryPanel.buffer as any).cx);
			display.queryPanel.draw();
			onQueryChanged();
        }
        else if(data.isCharacter) {
            display.queryPanel.buffer.insert(name);
            display.queryPanel.draw();
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

let expr: Parse.Expression[] = [];

const logDisplayPanel = display.logDisplayPanel;
logDisplayPanel.logs = logdb.logs;

const testProcess = process.argv.length <= 2?
    createProcess('node', [Path.join(__dirname, '..', '..', 'scripts', 'dev.test.js')]):
    createProcess(process.argv[2], process.argv.slice(3));

merge(
    fromEvent<string>(testProcess.stdoutInterface, 'line').pipe(map((line) => logdb.ingest(line))),
    fromEvent<string>(testProcess.stderrInterface, 'line').pipe(map((line) => logdb.ingest(line, 'error'))),
).pipe(
    // true return = redraw
    tap((record) => {
        if(logDisplayPanel.logs === logdb.logs || expr.length === 0) {
            return;
        }

        const matches = logdb.matchLog(expr[0], record);

        if(matches.length > 0) {
            logDisplayPanel.logs.push(record);
            if(logDisplayPanel.resultSet) {
                matches.forEach((match) => ResultSet.addMatch(match, logDisplayPanel.resultSet!));
            }
        }
    }),
).subscribe({
    next: (record) => {
        drawLogs();
        drawQueryResult();
    },
    complete: () => {
        // drawLogs();
        // drawQueryResult();
    },
});

const spinner = ['\\', '|', '/', '--'];
let spinnerEnabled = false;
let spinnerIndex = 0;

let blockDrawLog = false;

let filterSubscription: Subscription | undefined = undefined;

const queryChangedSubject = new Subject();
function onQueryChanged() {
    queryChangedSubject.next();
}

const queryUpdateDelay = 100;

queryChangedSubject.pipe(
    debounceTime(150),
    tap(() => {
        const query = display.queryPanel.buffer.getText();
        try {
            expr = parser.parse(query);
        }
        catch(err) {
            // TODO: show user reason their query is invalid
            return;
        }

        if(filterSubscription) {
            filterSubscription.unsubscribe();
            filterSubscription = undefined;
            spinnerEnabled = false;
        }

        logDisplayPanel.resultSet = undefined;

        logDisplayPanel.logEntryCache.clear();

        if(expr.length === 0) {
            logDisplayPanel.logs = logdb.logs;
            drawLogs();
            drawQueryResult();
            return;
        }

        spinnerEnabled = true;
        blockDrawLog = true;
        drawQueryResult();

        /** store logs in reverse order so we can easily iterate from the latest entry */
        // const displayedLogs: SkipList<LogIdx, LogRecord> = new SkipList((a: number, b: number) => b - a);
        const displayedLogs: LogRecord[] = [];
        logDisplayPanel.logs = displayedLogs;


        filterSubscription = merge(
            logdb.filterAll(expr[0]),
            // below prevents annoying visual flicker when starting search
            interval(1000/60).pipe(take(1), tap(() => blockDrawLog = false), mergeMap(() => EMPTY)),
        ).pipe(
            tap(({record, matches, resultSet}) => {
                if(!logDisplayPanel.resultSet) {
                    logDisplayPanel.resultSet = resultSet;
                }
                insertSorted(record, displayedLogs, (a, b) => a.idx - b.idx);
            }),
            // TODO: this is ridiculous
            auditTime(1000/60),
            tap(() => drawLogs()),

            publish((published) => merge(
                interval(1000/60).pipe(takeUntil(concat(published, of(true)))),
                published)),
            auditTime(1000/60),
            tap(() => drawQueryResult()),
        ).subscribe({
            next: () => {
                // drawLogs();
                // drawQueryResult();
            },
            complete: () => {
                spinnerEnabled = false;
                drawLogs();
                drawQueryResult();
            },
        });
    })
).subscribe({
    next: () => {
    }
});

const drawLogsLimiter = new Subject();

drawLogsLimiter.pipe(
    auditTime(1000/60),
    filter(() => !blockDrawLog)
).subscribe({
    next: () => {
        if(cursorPause < 0) {
            logDisplayPanel.printFromBottom(logDisplayPanel.logs.length - 1);
        }
        else {
            logDisplayPanel.printFromBottom(cursorPause);
        }
        logDisplayPanel.redrawChildren();
        logDisplayPanel.draw();
    }
})

function drawLogs() {
    drawLogsLimiter.next();
}

const drawQueryResultLimiter = new Subject();

drawQueryResultLimiter.pipe(
    auditTime(1000/60)
).subscribe({
    next: () => {
        (display.queryResults.buffer as any).setText('');
        if(spinnerEnabled) {
            (display.queryResults.buffer as any).moveTo(0, 0);
            display.queryResults.buffer.insert(spinner[spinnerIndex]);
            spinnerIndex = (spinnerIndex + 1) % spinner.length;
        }
        (display.queryResults.buffer as any).moveTo(2, 0);
        display.queryResults.buffer.insert(`${logDisplayPanel.logs.length}/${logdb.logs.length}`);

        display.queryResults.draw();
    }
});

function drawQueryResult() {
    drawQueryResultLimiter.next();
}

function close() {
    display.terminal.fullscreen(false);
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
