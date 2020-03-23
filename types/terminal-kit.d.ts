// Type definitions for terminal-kit
// Project: https://github.com/cronvel/terminal-kit
// Definitions by: Elliot Hatch <https://github.com/elliothatch>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

declare module 'terminal-kit' {
    var terminal: Terminal;

    class Terminal {
        public width: number;
        public height: number;

        public on(event: string, callback: Function): void
        public fullscreen(options: boolean | object): void;
        public processExit(code: number): void;
        public grabInput(options: boolean | object, safeCallback?: Function): void;
    }

    type Attributes = Partial<{
        color: number | string;
        defaultColor: boolean;
        bgColor: number | string;
        bgDefaultColor: boolean;
        bold: boolean;
        dim: boolean;
        italic: boolean;
        underline: boolean;
        blink: boolean;
        inverse: boolean;
        hidden: boolean;
        strike: boolean;
        transparency: boolean;
        fgTransparency: boolean;
        bgTransparency: boolean;
        styleTransparency: boolean;
        charTransparency: boolean;
    }>;

    export interface RectObject {
        width: number;
        height: number;
        x: number;
        y: number;
    }

    class ScreenBuffer {
        public dst: Terminal | ScreenBuffer;
        public x: number;
        public y: number;

        constructor(options: any);

        public clear(): void;
        public draw(): void;
        public drawCursor(): void;
        public fill(options?: Partial<{attr: Attributes, char: string, region: RectObject}>): void;
        public resize(fromRect: RectObject | {
            xmin: number;
            xmax: number;
            ymin: number;
            ymax: number;
        }): void;
    }

    class TextBuffer extends ScreenBuffer {
        constructor(options: any);
    }
}
