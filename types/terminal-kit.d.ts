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

    type Buffer = ScreenBuffer | TextBuffer;

    class ScreenBuffer {
        public dst: Buffer | Terminal;
        public x: number;
        public y: number;

        constructor(options: any);

        public clear(): void;
        public draw(): void;
        public drawCursor(): void;
        public fill(options?: Partial<{attr: Attributes, char: string, region: RectObject}>): void;
        public moveTo(x: number, y: number): void;
        public resize(fromRect: RectObject | {
            xmin: number;
            xmax: number;
            ymin: number;
            ymax: number;
        }): void;
    }

    class TextBuffer {
        public dst: ScreenBuffer;
        public x: number;
        public y: number;

        constructor(options: any);

        public draw(): void;
        public drawCursor(): void;

        public getText(): string;
        public getHidden(): boolean;
        public setHidden(state: any): void;
        public getContentSize(): {width: number; height: number};
        public moveUp(): void;
        public moveDown(): void;
        public moveLeft(): void;
        public moveRight(): void;
        public moveForward(justSkipNullCells: boolean): void;
        public moveBackward(justSkipNullCells: boolean): void;
        public moveToStartOfWord(): void;
        public moveToEndOfWord(): void;
        public moveToEndOfLine(): void;
        public moveInBound(ignoreCx: boolean): void;
        public insert(text: string, attr?: Attributes): void;
        public delete(n?: number): void;
        public backDelete(n?: number): void;
        public newLine(): void;
    }
}
