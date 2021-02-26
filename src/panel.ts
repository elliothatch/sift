import {Attributes, Terminal, Buffer, ScreenBuffer, TextBuffer} from 'terminal-kit';

import {LogRecord, LogIdx, PropertyId, ResultSet} from './logdb';

export namespace Panel {
    export interface Options {
        /** name used for identification in error messages */
        name?: string;
        width: number;
        height: number;
        /** if true, width/height is used as a grow factor to fill remaining space */
        flex?: {
            width?: boolean;
            height?: boolean;
        };
        /** if true, children will be rendered left-to-right instead of top-to-bottom */
        flexCol?: boolean;
        drawCursor?: boolean;
    }
}

export abstract class Panel<T extends Buffer> {
    public options: Panel.Options;
    public buffer: T;

    /** calculated width or height of 0 means the dimension hasn't been calculated yet */
    public calculatedHeight: number;
    public calculatedWidth: number;

    public parent?: Panel<Buffer>;
    public children: Panel<Buffer>[];

    constructor(options: Panel.Options, buffer: T) {
        this.options = options;
        this.buffer = buffer;

        this.calculatedWidth = 0;
        this.calculatedHeight = 0;
        this.children = [];
    }

    public addChild(child: Panel<Buffer>): void {
        this.children.push(child);
        child.parent = this;
        child.getScreenBuffer().dst = this.getScreenBuffer();
    };

    /**
     * removes the panel from list of children, if found.
     * draw() must not be called on the child until it is added as a child to another panel, or the screenbuffer dst is set to a valid buffer or terminal
     */
    public removeChild(child: Panel<Buffer>): boolean {
        const childIndex = this.children.findIndex((t) => t === child);
        if(childIndex === -1) {
            return false;
        }

        this.children.splice(childIndex);
        child.parent = undefined;

        // child.getScreenBuffer().dst = undefined;

        return true;
    };

    /** returns the screen buffer if it is one, or the dst buffer of a TextBuffer */
    public abstract getScreenBuffer(): ScreenBuffer;

    /** draw the panel itself, but don't propegate the changes up the parent chain
     * the changes may not be visible until the dst chain has been drawn */
    public drawSelf(): void {
        this.buffer.draw();
        if(this.options.drawCursor) {
            this.buffer.drawCursor();
        }
    }

    /** draw the buffer and all its parents */
    public draw() {
        this.drawSelf();
        let parent = this.parent;
        while(parent) {
            parent.drawSelf();
            parent = parent.parent;
        }
        /*
        let currentBuffer = this.buffer;
        while(currentBuffer && currentBuffer instanceof ScreenBuffer || currentBuffer instanceof TextBuffer) {
            currentBuffer.draw();
            currentBuffer.drawCursor();
            currentBuffer = currentBuffer.dst as ScreenBuffer;
        }
        */
    }

    /** draw all children in a post-DFS order */
    public redrawChildren(): void {
        this.children.forEach((child) => child.redrawChildren());
        this.drawSelf();
    }

    /** recalculate the size of a panel and its children */
    public resize(): void {
        if(!this.options.flex || !this.options.flex.width) {
            this.calculatedWidth = this.options.width;
        }

        if(!this.options.flex || !this.options.flex.height) {
            this.calculatedHeight = this.options.height;
        }

        if(this.calculatedHeight === 0 || this.calculatedWidth === 0) {
            throw new Error(`Panel.resize: panel '${this.options.name}' has flex '${JSON.stringify(this.options.flex)}', but does not have its own width/height calculated. Ensure resize() has been drawn on the parent of '${this.options.name}', or disable flex on this panel`);
        }

        this.getScreenBuffer().resize({
            x: 0,
            y: 0,
            width: this.calculatedWidth!,
            height: this.calculatedHeight!,
        });

        if(this.buffer instanceof TextBuffer) {
            // TODO: fix terminal kit type definitions
            (this.buffer as any).width = this.calculatedWidth;
            (this.buffer as any).height = this.calculatedHeight;
        }

        if(this.children.length > 0) {
            const flexChildren: Panel<Buffer>[] = [];
            const fixedChildren: Panel<Buffer>[] = [];
            this.children.forEach((child) => {
                if((this.options.flexCol && child.options.flex && child.options.flex.width)
                    || !this.options.flexCol && child.options.flex && child.options.flex.height) {
                    flexChildren.push(child);
                }
                else {
                    fixedChildren.push(child);
                }
            });

            const fixedSize = fixedChildren.reduce(
                (sum, child) => sum + (this.options.flexCol? child.options.width: child.options.height),
                0
            );

            const flexSize = 
                (this.options.flexCol? this.calculatedWidth || 0 : this.calculatedHeight || 0)
                - fixedSize;
            const flexGrowSum = flexChildren.reduce(
                (sum, child) => sum + (this.options.flexCol? child.options.width: child.options.height),
                0
            );

            // resize the children
            let position = 0;

            this.children.forEach((child) => {
                const screenBuffer = child.getScreenBuffer();
                if(this.options.flexCol) {
                    child.calculatedWidth = child.options.flex && child.options.flex.width?
                        Math.round(flexSize * (child.options.width / flexGrowSum)):
                        child.options.width;

                    child.calculatedHeight = child.options.flex && child.options.flex.height?
                        this.calculatedHeight:
                        child.options.height;

                    screenBuffer.x = position;
                    screenBuffer.y = 0;
                    position += child.calculatedWidth;
                }
                else {
                    child.calculatedHeight = child.options.flex && child.options.flex.height?
                        Math.round(flexSize * (child.options.height / flexGrowSum)):
                        child.options.height;
                    child.calculatedWidth = child.options.flex && child.options.flex.width?
                        this.calculatedWidth:
                        child.options.width;

                    screenBuffer.x = 0;
                    screenBuffer.y = position;
                    position += child.calculatedHeight;
                }

                child.resize();
            });
        }
    }
}

export class ScreenPanel extends Panel<ScreenBuffer> {
    constructor(dst: Buffer | Terminal, options: Panel.Options) {
        super(options, new ScreenBuffer({
            dst,
            width: options.width,
            height: options.height,
        }));
    }

    public getScreenBuffer(): ScreenBuffer {
        return this.buffer;
    }
}

export class TextPanel extends Panel<TextBuffer> {
    public screenBuffer: ScreenBuffer;
    constructor(dst: Buffer | Terminal, options: Panel.Options) {
        const screenBuffer = new ScreenBuffer({
            dst,
            width: options.width,
            height: options.height,
        });

        super(options, new TextBuffer({
            dst: screenBuffer,
            width: options.width,
            height: options.height,
        }));

        this.screenBuffer = screenBuffer;
    }

    public drawSelf(): void {
        super.drawSelf();

        this.screenBuffer.draw();
        if(this.options.drawCursor) {
            this.screenBuffer.drawCursor();
        }
    }

    public getScreenBuffer(): ScreenBuffer {
        return this.screenBuffer;
    }
}
