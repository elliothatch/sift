import * as Path from 'path';
import { createInterface, Interface } from 'readline';

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

import { Display } from './display';
import { Panel } from './panel';
import { LogDb } from './logdb';
import { Parser } from './query';
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
		}
		else if(name === 'DELETE') {
			display.queryPanel.buffer.delete(1);
			// filterLogs(queryTextBuffer.getText());
			display.queryPanel.draw();
		}
		else if(name === 'TAB') {
		    // TODO: make this per-panel based on focus
		    display.logDisplayPanel.expandedView = !display.logDisplayPanel.expandedView;
            display.logDisplayPanel.print(0);
		    display.logDisplayPanel.redrawChildren();
		    display.logDisplayPanel.draw();
        }
        else if(data.isCharacter) {
            display.queryPanel.buffer.insert(name);
            display.queryPanel.draw();
            // TODO: create special class/functions LogPanel, that allow adding/removing/setting logs, scrolling, and display options like expanded
            // try {
            const expr = parser.parse(display.queryPanel.buffer.getText());
            logdb.filter(expr[0]).subscribe({
                next: (results) => {
                },
                error: (err) => {
                    exitLogs.push({level: 'error', message: err});
                    close();
                }
            });
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

const testLogs = [
`{"level":"info","message":0,"U":"abcdef","a":0,"b":"AAA","timestamp":"2020-04-23T13:16:40.555Z"}`,
`{"level":"info","message":1,"V":"abcdef","a":1,"b":"BBB","timestamp":"2020-04-23T13:16:40.570Z"}`,
`{"level":"info","message":2,"W":"abcdef","a":4,"b":"CCC","timestamp":"2020-04-23T13:16:40.580Z"}`,
`{"level":"info","message":3,"X":"abcdef","a":9,"b":"DDD","timestamp":"2020-04-23T13:16:40.590Z"}`,
`{"level":"info","message":4,"Y":"abcdef","a":16,"b":"EEE","timestamp":"2020-04-23T13:16:40.601Z"}`,
`{"level":"info","message":5,"Z":"abcdef","a":25,"b":"FFF","timestamp":"2020-04-23T13:16:40.611Z"}`,
`{"level":"info","message":6,"[":"abcdef","a":36,"b":"GGG","timestamp":"2020-04-23T13:16:40.621Z"}`,
`{"level":"info","message":7,"U":"abcdef","a":49,"b":"HHH","timestamp":"2020-04-23T13:16:40.632Z"}`,
`{"level":"info","message":8,"V":"abcdef","a":64,"b":"III","timestamp":"2020-04-23T13:16:40.642Z"}`,
`{"level":"info","message":9,"W":"abcdef","a":81,"b":"JJJ","timestamp":"2020-04-23T13:16:40.653Z"}`,
`{"level":"info","message":10,"X":"abcdef","a":100,"b":"AAA","timestamp":"2020-04-23T13:16:40.663Z"}`,
`{"level":"info","message":11,"Y":"abcdef","a":121,"b":"BBB","timestamp":"2020-04-23T13:16:40.674Z"}`,
];

testLogs.forEach((line) => {
    logdb.ingest(line);
});

const logDisplayPanel = display.logDisplayPanel;
// const logDisplayPanel: Panel.LogDisplay = display.logPanel.children![0] as Panel.LogDisplay;
logDisplayPanel.logs = logdb.logs;

logDisplayPanel.print(0);

logDisplayPanel.redrawChildren();
logDisplayPanel.draw();


exitLogs.push({message: display.queryResults.calculatedWidth});
exitLogs.push({message: (display.queryResults.buffer as any).width});

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

