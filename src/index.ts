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
				display.terminal.fullscreen(false);
				process.exit();
			// }
        }
		else if(name === 'BACKSPACE') {
			display.queryPanel.buffer.backDelete(1);
			// filterLogs(queryTextBuffer.getText());
			Panel.draw(display.queryPanel);
		}
		else if(name === 'DELETE') {
			display.queryPanel.buffer.delete(1);
			// filterLogs(queryTextBuffer.getText());
			Panel.draw(display.queryPanel);
		}
        else if(data.isCharacter) {
            display.queryPanel.buffer.insert(name);
            Panel.draw(display.queryPanel);
            // TODO: create special class/functions LogPanel, that allow adding/removing/setting logs, scrolling, and display options like expanded
            // try {
            const expr = parser.parse(display.queryPanel.buffer.getText());
            logdb.filter(expr[0]).subscribe({
                next: (results) => {
                },
                error: (err) => {
                    display.terminal.fullscreen(false);
                    console.error(err);
                }
            });
            // }
        }
    }
	catch(err) {
		display.terminal.fullscreen(false);
        console.error(err);
        // freshr.kill();
	}
});

display.draw();

// const targetProcess = createProcess(process.argv[2], process.argv.slice(3));
// targetProcess.stdoutInterface.on('line', (line) => {
    // logdb.ingest(line);
// });

