import * as Path from 'path';
import { createInterface, Interface } from 'readline';

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

import { Display } from './display';
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

// const targetProcess = createProcess(process.argv[1], process.argv.slice(2));

const display = new Display();
display.init();

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
    }
	catch(err) {
		display.terminal.fullscreen(false);
        console.error(err);
        // freshr.kill();
	}
});

display.draw();
