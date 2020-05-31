import * as Path from 'path';
import { createInterface, Interface } from 'readline';

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

import { Display } from './display';
import { Panel } from './panel';
import { LogDb, LogRecord, LogIndex, ResultSet } from './logdb';
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
			onQueryChanged(display.queryPanel.buffer.getText());
		}
		else if(name === 'DELETE') {
			display.queryPanel.buffer.delete(1);
			// filterLogs(queryTextBuffer.getText());
			display.queryPanel.draw();
			onQueryChanged(display.queryPanel.buffer.getText());
		}
		else if(name === 'TAB') {
		    // TODO: make this per-panel based on focus
		    display.logDisplayPanel.expandedView = !display.logDisplayPanel.expandedView;
		    display.logDisplayPanel.logEntryCache.clear();
            display.logDisplayPanel.printFromBottom(display.logDisplayPanel.logs.length-1);
            // display.logDisplayPanel.print(0);
		    display.logDisplayPanel.redrawChildren();
		    display.logDisplayPanel.draw();
        }
        else if(data.isCharacter) {
            display.queryPanel.buffer.insert(name);
            display.queryPanel.draw();
            // TODO: create special class/functions LogPanel, that allow adding/removing/setting logs, scrolling, and display options like expanded
            // try {
			onQueryChanged(display.queryPanel.buffer.getText());
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
let resultSet: ResultSet | undefined;

const logDisplayPanel = display.logDisplayPanel;
// const logDisplayPanel: Panel.LogDisplay = display.logPanel.children![0] as Panel.LogDisplay;
logDisplayPanel.logs = logdb.logs;

const testProcess = createProcess('node', [Path.join(__dirname, '..', '..', 'scripts', 'dev.test.js')]);


testProcess.stdoutInterface.on('line', (line) => {
    const record = logdb.ingest(line);
    if(logDisplayPanel.logs !== logdb.logs) {
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
    }
    // TODO: add scrolling, add indicator for number of new logs since manual scrolling enabled
    display.logDisplayPanel.printFromBottom(display.logDisplayPanel.logs.length-1);
    logDisplayPanel.redrawChildren();
    logDisplayPanel.draw();
});

// display.logDisplayPanel.printFromBottom(display.logDisplayPanel.logs.length-1);
            // display.logDisplayPanel.print(0);
// logDisplayPanel.print(0);

// logDisplayPanel.redrawChildren();
// logDisplayPanel.draw();

function onQueryChanged(query: string) {
    try {
        expr = parser.parse(query);
    }
    catch(err) {
        // TODO: show user reason their query is invalid
    }
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

    logDisplayPanel.redrawChildren();
    logDisplayPanel.draw();

    (display.queryResults.buffer as any).setText('');
    (display.queryResults.buffer as any).moveTo(0, 0);
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

// const targetProcess = createProcess(process.argv[2], process.argv.slice(3));
// targetProcess.stdoutInterface.on('line', (line) => {
    // logdb.ingest(line);
// });

