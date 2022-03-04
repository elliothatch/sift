import { Display } from './display';

export class Input {
    public display: Display;

    public handlers: {[mode in Input.Mode]: Input.Handler};
    public mode: Input.Mode = Input.Mode.Query;

    // TODO: we want to generalize all query commands to act on the current panel
    // it may be prudent to have a "top-level" manager for tracking all log streams, rather than fetching them out of the panels themselves
    constructor(display: Display, handlers: {[mode in Input.Mode]: Input.Handler}) {
        this.display = display;
        this.handlers = handlers;

        this.display.terminal.on('key', (name: string, matches: string[], data: any) => {
            const handler = this.handlers[this.mode];
            // exceptions: some keys match multiple combinations. if the terminal is able to distinguish the key combination, it will be available in matches.
            // here we override name if there is a more specific match available we want to use
            if(name === 'BACKSPACE' && matches.includes('CTRL_H')) {
                name = 'CTRL_H';
            }
            if(handler.bindings[name]) {
                handler.bindings[name].fn(name, matches, data);
            }
            else if(handler.fallback) {
                handler.fallback(name, matches, data);
            }
        });
    }
}

export namespace Input {
    export enum Mode {
        Query,
        Command,
        Filter,
        Text,
    }

    export interface Action {
        description: string;
        fn: (key: any, matches: any, data: any) => void;
    }

    export interface Handler {
        /** bindings handles a single keypress */
        bindings: {[key: string]: Action};
        /** if no binding is defined for the pressed key, fallback is called with args directly from terminal.on('key') */
        fallback?: (name: string, matches: string[], data: any) => void;
    }
}
