import { spawn, ChildProcess } from 'child_process';
import { createInterface, Interface } from 'readline';
import { of, merge, fromEvent, Observable, Subject } from 'rxjs';
import { map } from 'rxjs/operators';

import { LogDb, LogRecord } from './logdb';

export class LogStream<T extends LogStream.Source<K> = LogStream.Source<any>, K = T extends LogStream.Source<infer U>? U: never> {
    /** list of raw input strings from log source */
    public buffer: string[];
    public logdb: LogDb;
    public source: T;

    /** emits each log after it is parsed and ingested */
    public logsObservable: Observable<LogRecord>;
    protected logsSubject: Subject<LogRecord>;

    constructor(source: T) {
        this.buffer = [];
        this.logdb = new LogDb();
        this.source = source;

        this.logsSubject = new Subject();
        this.logsObservable = this.logsSubject.asObservable();
    }

    public static fromProcess(execPath: string, params: string[]): LogStream<LogStream.Source.Process > {
        const targetProcess = spawn(execPath, params);
        const source: LogStream.Source.Process = {
            sType: 'process',
            process: targetProcess,
            running: true,
            stdoutInterface: createInterface({input: targetProcess.stdout}),
            stderrInterface: createInterface({input: targetProcess.stderr}),
        };

        const logStream =  new LogStream<LogStream.Source.Process>(source);

        merge(
            fromEvent<string>(source.stdoutInterface, 'line').pipe(
                map((line) => {
                    logStream.buffer.push(line);
                    return logStream.logdb.ingest(line);
                })),
            fromEvent<string>(source.stderrInterface, 'line').pipe(
                map((line) => {
                    logStream.buffer.push(line);
                    return logStream.logdb.ingest(line, 'error');
                })),
        ).subscribe({
                next: (record) => {
                    logStream.logsSubject.next(record);
                },
                error: (error) => {
                    // TODO: show these logs in a separate "sift messages" panel
                    const record = logStream.logdb.ingest(JSON.stringify({
                        level: 'error',
                        message: error.message,
                        error: exposeError(error)
                    }));

                    logStream.logsSubject.next(record);
                }
        });

        targetProcess.on('exit', (code, signal) => {
            source.running = false;
            // TODO: show these logs in a separate "sift messages" panel
            logStream.logdb.ingest(JSON.stringify({
                level: 'warn',
                message: `Child source "${targetProcess.spawnfile}" (${targetProcess.pid}) exited with ${code != null? 'code "' + code + '"': 'signal "' + signal + '"'}`
            }));
            logStream.logdb.ingest(JSON.stringify({
                level: 'warn', message: `Press CTRL_C to close sift`
            }));
        });

        return logStream;
    }

    public static fromObservable<T>(name: string, observable: Observable<T>): LogStream<LogStream.Source<T>, T> {
        const source: LogStream.Source.ObservableSource<T> = {
            sType: 'observable',
            name,
            observable
        };

        const logStream = new LogStream(source);

        observable.subscribe({
            next: (data) => {
                if(typeof data === 'string') {
                    const record = logStream.logdb.ingest(data);
                    logStream.logsSubject.next(record);
                }
                else if(typeof data === 'object') {
                    const record = logStream.logdb.ingest(JSON.stringify(exposeError(data as unknown as object)));
                    logStream.logsSubject.next(record);
                }
                else {
                    const record = logStream.logdb.ingest(`${data}`);
                    logStream.logsSubject.next(record);
                }
            },
            error: (error) => {
                // TODO: show these logs in a separate "sift messages" panel
                const record = logStream.logdb.ingest(JSON.stringify({
                    level: 'error',
                    message: error.message,
                    error: exposeError(error)
                }));

                logStream.logsSubject.next(record);
            }
        });

        return logStream;
    }

    public dumpToFile(path: string): Observable<boolean>  {
        return of(false);
    }
}

export namespace LogStream {
    export type Source<T = any> = Source.ObservableSource<T> | Source.Process;
    export namespace Source {
        export interface ObservableSource<T> {
            sType: 'observable';
            name: string;
            observable: Observable<T>;
        }
        export interface Process {
            sType: 'process';
            process: ChildProcess;
            running: boolean;
            stdoutInterface: Interface;
            stderrInterface: Interface;
        }
    }
}

/** ensures message and stack are stringified on the error object */
function exposeError<T extends object>(data: T) {
    if (typeof data !== 'object' || !data) {
        return data;
    }

    Object.keys(data).forEach((p) => exposeError((data as any)[p]));

    if(data instanceof Error) {
        Object.defineProperty(data, 'message', {enumerable: true});
        Object.defineProperty(data, 'stack', {enumerable: true});
        return Object.assign(data, {errorType: data.constructor.name});
    }

    return data;
}
