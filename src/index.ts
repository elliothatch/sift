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

const exitLogs: Array<{level?: string, message: any}> = [];

interface Process {
    process: ChildProcess;
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

if(process.argv.length <= 2) {
    console.log('Usage: sift <exec> [...execParams]');
    process.exit();
}


const display = new Display();
display.init();

const logdb = new LogDb();
const parser = new Parser();


{
    const fuzzyThresholdStr = Math.log10(-logdb.fuzzysortThreshold).toString();
    (display.fuzzyThreshold.buffer as any).setText('');
    (display.fuzzyThreshold.buffer as any).moveTo(
        display.fuzzyThreshold.calculatedWidth - fuzzyThresholdStr.length,
        0
    );
    display.fuzzyThreshold.buffer.insert(fuzzyThresholdStr);
    display.fuzzyThreshold.draw();
}

let cursorPause = -1;

display.terminal.on('key', (name: any, matches: any, data: any) => {
	try {
		if(name === 'CTRL_C') {
			if(targetProcess.running) {
                logdb.ingest(JSON.stringify({level: 'warn', message: `Sending SIGTERM to child process "${targetProcess.process.spawnfile}" (${targetProcess.process.pid})`}));
			    targetProcess.process.kill();
            }
            else {
                close();
            }
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
        else if(name === 'SHIFT_UP') {
            if(cursorPause < 0) {
                cursorPause = display.logDisplayPanel.logs.length - 22;
            }
            else {
                cursorPause = Math.max(0, cursorPause - 20);
            }
            drawLogs();
        }
        else if(name === 'UP') {
            if(cursorPause < 0) {
                cursorPause = display.logDisplayPanel.logs.length - 2;
            }
            else {
                cursorPause = Math.max(0, cursorPause - 1);
            }
            drawLogs();
        }
        else if(name === 'SHIFT_DOWN') {
            if(cursorPause < 0) {
                cursorPause = display.logDisplayPanel.logs.length - 1;
            }
            else {
                cursorPause = Math.min(display.logDisplayPanel.logs.length - 1, cursorPause + 20);
            }
            drawLogs();
        }
        else if(name === 'DOWN') {
            cursorPause = -1;
            drawLogs();
        }
        else if(name === 'LEFT') {
            display.queryPanel.buffer.moveBackward(false);
            display.queryPanel.draw();
        }
        else if(name === 'RIGHT') {
            if((display.queryPanel.buffer as any).cx < display.queryPanel.buffer.getText().length) {
                display.queryPanel.buffer.moveForward(false);
                display.queryPanel.draw();
            }
        }
		else if(name === 'ESCAPE') {

            (display.queryPanel.buffer as any).setText('');
            (display.queryPanel.buffer as any).moveTo(0, 0);
			display.queryPanel.draw();
			onQueryChanged();
        }
        else if(name === 'PAGE_UP') {
            logdb.fuzzysortThreshold = Math.floor(logdb.fuzzysortThreshold * 10);
            const fuzzyThresholdStr = Math.log10(-logdb.fuzzysortThreshold).toString();
			(display.fuzzyThreshold.buffer as any).setText('');
			(display.fuzzyThreshold.buffer as any).moveTo(
			    display.fuzzyThreshold.calculatedWidth - fuzzyThresholdStr.length,
			    0
			);
            display.fuzzyThreshold.buffer.insert(fuzzyThresholdStr);
            display.fuzzyThreshold.draw();
            onQueryChanged();
        }
        else if(name === 'PAGE_DOWN') {
            logdb.fuzzysortThreshold = Math.min(-1, logdb.fuzzysortThreshold / 10);
            const fuzzyThresholdStr = Math.log10(-logdb.fuzzysortThreshold).toString();
			(display.fuzzyThreshold.buffer as any).setText('');
			(display.fuzzyThreshold.buffer as any).moveTo(
			    display.fuzzyThreshold.calculatedWidth - fuzzyThresholdStr.length,
			    0
			);
            display.fuzzyThreshold.buffer.insert(fuzzyThresholdStr);
            display.fuzzyThreshold.draw();
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

const targetProcess = createProcess(process.argv[2], process.argv.slice(3));

targetProcess.process.on('exit', (code, signal) => {
    targetProcess.running = false;
    // TODO: show these logs in a separate "sift messages" panel
    logdb.ingest(JSON.stringify({level: 'warn', message: `Child process "${targetProcess.process.spawnfile}" (${targetProcess.process.pid}) exited with ${code != null? 'code "' + code + '"': 'signal "' + signal + '"'}`}));
    logdb.ingest(JSON.stringify({level: 'info', message: `Press CTRL_C to close sift`}));
    drawLogs();
    drawQueryResult();
});

merge(
    fromEvent<string>(targetProcess.stdoutInterface, 'line').pipe(map((line) => logdb.ingest(line))),
    fromEvent<string>(targetProcess.stderrInterface, 'line').pipe(map((line) => logdb.ingest(line, 'error'))),
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
    targetProcess.process.kill();
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
