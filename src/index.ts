import * as Path from 'path';
import { createInterface, Interface } from 'readline';

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

import { concat, merge, fromEvent, race, Subscription, interval } from 'rxjs';
import { map, skip, tap, debounceTime, throttleTime, publish, filter } from 'rxjs/operators';

import { Display } from './display';
import { Panel } from './panel';
import { LogDb, LogRecord, LogIndex, ResultSet, FilterMatch } from './logdb';
import { Parse, Parser } from './query';
/*
const AlertColors: {[level: string]: AlertColor } = {};

enum AlertColors {
    info= 'bold',
    warn= 'yellow',
    error= 'red',
}
*/

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

// process.stdout.pipe(process.stdin);
// const stdoutInterface = createInterface({input: process.stdout});
// stdoutInterface.on('line', (line) => {
    // exitLogs.push({level: 'info', message: line});
// });


// process.stdin.pipe(freshr.stdin);
// freshr.stderr.pipe(process.stderr);

/*
const logStream = readline.createInterface({
    input: freshr.stdout,
    output: process.stdout,
    terminal: false
});

const errorStream = readline.createInterface({
    input: freshr.stderr,
    output: process.stderr,
    terminal: false
});
*/

const display = new Display();
display.init();

const logdb = new LogDb();
const parser = new Parser();

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
            drawQueryResult();
        }
        // else if(name === 'UP') {
        // }
        // else if(name === 'DOWN') {
        // }{
        //
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


/*
const testLogs = [
`{"level":"info","message":0,"U":"abcdef","a":0,"b":"AAA","timestamp":"2020-04-23T13:16:40.555Z"}`,
`{"level":"warn","message":1,"V":"abcdef","a":1,"b":"BBB","timestamp":"2020-04-23T13:16:40.570Z"}`,
`{"level":"info","message":2,"W":"abcdef","a":4,"b":"CCC","timestamp":"2020-04-23T13:16:40.580Z"}`,
`{"level":"info","message":3,"X":"abcdef","a":9,"b":"DDD","timestamp":"2020-04-23T13:16:40.590Z"}`,
`{"level":"info","message":4,"Y":"abcdef","a":16,"b":"EEE","timestamp":"2020-04-23T13:16:40.601Z"}`,
`{"level":"info","message":5,"Z":"abcdef","a":25,"b":"FFF","timestamp":"2020-04-23T13:16:40.611Z"}`,
`{"level":"info","message":6,"[":"abcdef","a":36,"b":"GGG","timestamp":"2020-04-23T13:16:40.621Z"}`,
`{"level":"info","message":7,"U":"abcdef","a":49,"b":"HHH","timestamp":"2020-04-23T13:16:40.632Z"}`,
`{"level":"error","message":8,"V":"abcdef","a":64,"b":"III","timestamp":"2020-04-23T13:16:40.642Z"}`,
`{"level":"warn","message":9,"W":"abcdef","a":81,"b":"JJJ","timestamp":"2020-04-23T13:16:40.653Z"}`,
`{"level":"error","message":10,"X":"abcdef","a":100,"b":"AAA","timestamp":"2020-04-23T13:16:40.663Z"}`,
`{"level":"info","message":11,"Y":"abcdef","a":121,"b":"BBB","timestamp":"2020-04-23T13:16:40.674Z"}`,
];

testLogs.forEach((line) => {
    logdb.ingest(line);
});
*/

let expr: Parse.Expression[] = [];

const logDisplayPanel = display.logDisplayPanel;
// const logDisplayPanel: Panel.LogDisplay = display.logPanel.children![0] as Panel.LogDisplay;
logDisplayPanel.logs = logdb.logs;

const testProcess = process.argv.length <= 2?
    createProcess('node', [Path.join(__dirname, '..', '..', 'scripts', 'dev.test.js')]):
    createProcess(process.argv[2], process.argv.slice(3));
// const testProcess = createProcess('node', [Path.join(__dirname, '..', '..', 'scripts', 'dev.test.js')]);

// logdb.logSubject.subscribe({
    // next: (record) => 
// });

testProcess.stderrInterface.on('line', (line) => {
    
});

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
    throttleTime(1000/60),
    tap(() => drawQueryResult())
).subscribe({
    next: (record) => {
        drawLogs();
        drawQueryResult();
    },
    complete: () => {
        drawLogs();
        drawQueryResult();
    },
    error: (error) => {
        if(error.message === 'max logs') {
            // do nothing
            drawLogs();
            drawQueryResult();
        }
        else  {
            throw error;
        }
    }
});

        /*
        logdb.filter(expr[0], {
            matches: new Map(),
            index: LogIndex.addLogRecord(record, {
                propertyIndex: new Map(),
                properties: [],
                valueIndex: new Map(),
                values: []
            }),
        }).subscribe({
            next: (results) => {
                if(results.index.properties.length > 0 || results.index.values.length > 0) {
                    logDisplayPanel.logs.push(record);
                    if(resultSet && logDisplayPanel.matches) {
                        resultSet = ResultSet.union(resultSet, results);
                        logDisplayPanel.matches = resultSet.matches;
                    }
                }
            }
        });
        */
    // }
    // TODO: add scrolling, add indicator for number of new logs since manual scrolling enabled
// });

// display.logDisplayPanel.printFromBottom(display.logDisplayPanel.logs.length-1);
            // display.logDisplayPanel.print(0);
// logDisplayPanel.print(0);

// logDisplayPanel.redrawChildren();
// logDisplayPanel.draw();
const spinner = ['\\', '|', '/', '--'];
let spinnerEnabled = false;
let spinnerIndex = 0;

let filterSubscription: Subscription | undefined = undefined;
function onQueryChanged() {
    const query = display.queryPanel.buffer.getText();
    try {
        expr = parser.parse(query);
    }
    catch(err) {
        // TODO: show user reason their query is invalid
    }

    if(filterSubscription) {
        filterSubscription.unsubscribe();
        filterSubscription = undefined;
    }

    logDisplayPanel.resultSet = undefined;

    logDisplayPanel.logEntryCache.clear();

    if(expr.length === 0) {
        logDisplayPanel.logs = logdb.logs;
        drawLogs();
        drawQueryResult();
        return;
    }

    const displayedLogs: LogRecord[] = [];
    logDisplayPanel.logs = displayedLogs;


    spinnerEnabled = true;
    filterSubscription = logdb.filterAll(expr[0]).pipe(
        tap(({record, matches, resultSet}) => {
            if(!logDisplayPanel.resultSet) {
                logDisplayPanel.resultSet = resultSet;
            }

            // displayedLogs.push(record);
            insertSorted(record, displayedLogs, (a, b) => a.idx - b.idx);

            // TODO: don't redraw when we don't need to
            // logDisplayPanel.printFromBottom(displayedLogs.length - 1);

            // logDisplayPanel.redrawChildren();
            // logDisplayPanel.draw();
            // results.matches.forEach((matches, logIdx) => displayedLogs.push(logdb.logs[logIdx]));
        }),
        publish((published) => race(concat(interval(100), published), published.pipe(skip(logDisplayPanel.calculatedHeight)))),
        throttleTime(1000/60)
        // publish((published) => race(published.pipe(debounceTime(1000/60)), published.pipe(skip(1))))
    ).subscribe({
        next: () => {
            drawLogs();
            drawQueryResult();
        },
        complete: () => {
            spinnerEnabled = false;
            drawLogs();
            drawQueryResult();
        },
    });



    /*
    if(expr.length > 0) {
        exitLogs.push({message: expr[0]});
        logdb.filter(expr[0]).subscribe({
            next: (results) => {
                resultSet = results;
                // javascript please add an ordered set to the std library
                if(results.matches.size === 0 && results.index.properties.length > 0) {
                    // this is bad and confusing, but some queries that match ALL logs
                    // return a resultSet with 0 matches. this is because there is no highlight data
                    // (e.g. because an empty search ":" has nothing to "match")
                    // you can tell it's not actually an empty result set because the index is populated
                    logDisplayPanel.matches = undefined;
                    logDisplayPanel.logs = logdb.logs;
                }
                else {
                    const displayedLogs: LogRecord[] = [];
                    results.matches.forEach((matches, logIdx) => displayedLogs.push(logdb.logs[logIdx]));
                    displayedLogs.sort((a, b) => a.idx - b.idx);
                    logDisplayPanel.matches = results.matches;
                    logDisplayPanel.logs = displayedLogs;
                }
                // logDisplayPanel.print(0);
                display.logDisplayPanel.printFromBottom(display.logDisplayPanel.logs.length-1);
                logDisplayPanel.redrawChildren();
                logDisplayPanel.draw();
            },
            error: (err) => {
                exitLogs.push({level: 'error', message: err});
                close();
            }
        });
    }
    else {
        logDisplayPanel.logs = logdb.logs;
        logDisplayPanel.matches = undefined;
        display.logDisplayPanel.printFromBottom(display.logDisplayPanel.logs.length-1);
        // logDisplayPanel.print(0);
    }
    */

    // logDisplayPanel.redrawChildren();
    // logDisplayPanel.draw();

    // (display.queryResults.buffer as any).setText('');
    // (display.queryResults.buffer as any).moveTo(0, 0);
    // display.queryResults.buffer.insert(`${logDisplayPanel.logs.length}/${logdb.logs.length}`);

    // display.queryResults.draw();
}

function drawLogs() {
    logDisplayPanel.printFromBottom(logDisplayPanel.logs.length - 1);
    logDisplayPanel.redrawChildren();
    logDisplayPanel.draw();
}

function drawQueryResult() {
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



// exitLogs.push({message: display.queryResults.calculatedWidth});
// exitLogs.push({message: (display.queryResults.buffer as any).width});

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

// const targetProcess = createProcess(process.argv[2], process.argv.slice(3));
// targetProcess.stdoutInterface.on('line', (line) => {
    // logdb.ingest(line);
// });

