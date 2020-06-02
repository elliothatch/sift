// Type definitions for dsjslib
// Definitions by: Elliot Hatch <https://github.com/elliothatch>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

declare module 'dsjslib' {

    export type userCompareFn<T> = (a: T, b: T) => number;

    export class SkipList<K,V> {

        public top_: any;

        constructor(compareFn?: userCompareFn<K>);

        public delete(key: K): void;
        public entrySet: Array<{key: K, value: V}>;
        public get(key: K): {key: K, value: V} | null;
        public put(key: K, value: V): SkipList<K,V>;
        
    }
}
