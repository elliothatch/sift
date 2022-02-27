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

        this.display.terminal.on('key', (name: any, matches: any, data: any) => {
            const handler = this.handlers[this.mode];
            if(handler.bindings[name]) {
                handler.bindings[name].fn();
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
    }

    export interface Action {
        description: string;
        fn: () => void;
    }

    export interface Handler {
        /** bindings handles a single keypress */
        bindings: {[key: string]: Action};
        /** if no binding is defined for the pressed key, fallback is called with args directly from terminal.on('key') */
        fallback?: (name: any, matches: any, data: any) => void;
    }
}
