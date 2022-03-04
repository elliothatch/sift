import {Terminal, Buffer, ScreenBuffer, TextBuffer} from 'terminal-kit';

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

/** a panel is a UI element that may contain child panels
* panels are automatically laid out in column or row order, and can be resized dynamically by setting the flex option
* each panel has a "draw" function and an optional "render" function
* "render" does the work of putting text into the panel
* "draw" calls "render" on itself if it is marked dirty, then recursively calls "draw" on all its dirty children and then copies the contents of the dirty child into its buffer by "drawToParent(false)"
* thus, calling "draw" on the root panel causes all panels to be re-rendered if necessary, and proegates the updated ui to the terminal.
* "render" is called before "draw" so that a panel may directly modify the contents of its children in render, and still have those changes propegated to its buffer. sometimes this is more convenient than writing a "render" function for every child in the panel. when directly modifying children, it is necessary to mark the children as dirty in the "render" call
*/
export abstract class Panel<T extends Buffer> {
    public options: Panel.Options;
    public buffer: T;

    /** calculated width or height of 0 means the dimension hasn't been calculated yet */
    public calculatedHeight: number;
    public calculatedWidth: number;

    public parent?: Panel<Buffer>;
    public children: Panel<Buffer>[];

    /* renders the contents of the panel. automatically called on draw if dirty === true */
    public render?: () => void;
    /** indicates that the panel is "dirty" and should be re-rendered */
    private dirty: boolean = true;
    private childrenDirty: boolean = true;

    constructor(options: Panel.Options, buffer: T, render?: () => void) {
        this.options = options;
        this.buffer = buffer;
        this.render = render;

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

        this.children.splice(childIndex, 1);
        child.parent = undefined;

        // child.getScreenBuffer().dst = undefined;

        return true;
    };

    /** returns the screen buffer if it is one, or the dst buffer of a TextBuffer */
    public abstract getScreenBuffer(): ScreenBuffer;

    public draw(): void {
        if(this.dirty) {
            if(this.render) {
                this.render();
            }
            this.dirty = false;
        }
        if(this.childrenDirty) {
            this.children.forEach((child) => {
                if(child.dirty || child.childrenDirty) {
                    child.draw();
                    child.drawToParent(false);
                }
            });
            this.childrenDirty = false;
        }
    }

    /** mostly used internally, or to draw to the top-level terminal screen */
    public drawToParent(recursive: boolean): void {
        this.buffer.draw();
        if(this.options.drawCursor) {
            this.buffer.drawCursor();
        }

        if(recursive && this.parent) {
            this.parent.drawToParent(recursive);
        }
    }

    public markDirty(): void {
        this.dirty = true;
        if(this.parent) {
            this.parent.markDirtyChildren();
        }
    }

    /** indicates that children are dirty and should be checked on the next draw call, even if this panel itself does not need to be rerendered. prevents redundant render calls. might not really be necessary */
    public markDirtyChildren(): void {
        this.childrenDirty = true;
        if(this.parent) {
            this.parent.markDirtyChildren();
        }
    }

    /** recalculate the size of a panel and its children. mark all as dirty */
    public resize(): void {
        if(!this.options.flex || !this.options.flex.width) {
            this.calculatedWidth = this.options.width;
        }

        if(!this.options.flex || !this.options.flex.height) {
            this.calculatedHeight = this.options.height;
        }

        // if(this.calculatedHeight === 0 || this.calculatedWidth === 0) {
            // throw new Error(`Panel.resize: panel '${this.options.name}' has flex '${JSON.stringify(this.options.flex)}', but does not have its own width/height calculated. Ensure resize() has been drawn on the parent of '${this.options.name}', or disable flex on this panel`);
        // }

        this.getScreenBuffer().resize({
            x: 0,
            y: 0,
            width: this.calculatedWidth!,
            height: this.calculatedHeight!,
        });

        this.dirty = true;

        if(this.buffer instanceof TextBuffer) {
            // TODO: fix terminal kit type definitions
            (this.buffer as any).width = this.calculatedWidth;
            (this.buffer as any).height = this.calculatedHeight;
        }

        if(this.children.length > 0) {
            this.childrenDirty = true;
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
    constructor(dst: Buffer | Terminal, options: Panel.Options, render?: () => void) {
        super(options, new ScreenBuffer({
            dst,
            width: options.width,
            height: options.height,
        }), render);
    }

    public getScreenBuffer(): ScreenBuffer {
        return this.buffer;
    }

}

export class TextPanel extends Panel<TextBuffer> {
    public screenBuffer: ScreenBuffer;
    constructor(dst: Buffer | Terminal, options: Panel.Options, render?: () => void) {
        const screenBuffer = new ScreenBuffer({
            dst,
            width: options.width,
            height: options.height,
        });

        super(options, new TextBuffer({
            dst: screenBuffer,
            width: options.width,
            height: options.height,
        }), render);

        this.screenBuffer = screenBuffer;
    }

    public draw() {
        super.draw();

        // draw from textbuffer to screenbuffer
        this.buffer.draw();
        if(this.options.drawCursor) {
            this.buffer.drawCursor();
        }
    }

    public drawToParent(recursive: boolean) {
        this.screenBuffer.draw();
        if(this.options.drawCursor) {
            this.screenBuffer.drawCursor();
        }

        if(recursive && this.parent) {
            this.parent.drawToParent(recursive);
        }
    }

    public getScreenBuffer(): ScreenBuffer {
        return this.screenBuffer;
    }
}
