import {Observable, concat} from 'rxjs';
import {tap, count} from 'rxjs/operators';

import { LogDb } from '../src/logdb';
import { Parser } from '../src/query';

// ((a, b) => a - b)
function sortedUnion<T>(lhs: Array<T>, rhs: Array<T>, compareFn: (a: T, b: T) => number): Array<T> {
    return Array.from(new Set([...lhs, ...rhs])).sort(compareFn);
}

function intersection<T>(lhs: Array<T>, rhs: Array<T>): Array<T> {
    return lhs.filter((index) => rhs.includes(index));
}

function testQuery(query: string, logdb: LogDb, expected: number[]) {
    test(query, () => {
        const expectedMatches = new Set(expected);
        console.log

        const expr = parser.parse(query);
        if(query === 'a:a b:b') {
            console.log(expr);
        }
        expect(expr.length).toBe(1);
        

        return logdb.filterAll(expr[0]).pipe(
            tap((match) => {
                const idx = match.record.idx;
                expect(expectedMatches.has(idx)).toBeTruthy();
                expectedMatches.delete(idx);
            }),
            count(),
            tap((c) => {
                expect(c).toBe(expected.length);
            })
        ).toPromise();
    });
}

let parser: Parser;

beforeEach(() => {
    parser = new Parser();
});

describe('logdb', () => {
    describe('filterAll', () => {
        const logs = [
            {a: 'b'},
            {a: 'z'},
            {b: 'a'},
            {b: 'y'},
        ];
        const logdb = new LogDb();
        const records = logs.map((log) => logdb.ingest(JSON.stringify(log)));

        const expected: any = {
            'a': [0, 1, 2],
            'b': [0, 2, 3],
            'z': [1],
            'y': [3],

            'a:': [0, 1],
            'b:': [2, 3],
            'z:': [],
            'y:': [],

            ':a': [2],
            ':b': [0],
            ':z': [1],
            ':y': [3],

            'a:a': [],
            'a:b': [0],
            'a:z': [1],
            'a:y': [],

            'b:a': [2],
            'b:b': [],
            'b:z': [],
            'b:y': [3],
        };

        describe('query: MATCH', () => {
            Object.keys(expected).forEach((query) => {
                testQuery(query, logdb, expected[query]);
            });
        });

        describe('query: AND', () => {
            const expectedAnd = [
                ['a', 'a'],
                ['a', 'b'],
                ['a', 'z'],
                ['a', 'y'],

                ['a:a', 'b:b'],
            ];

            expectedAnd.forEach((queryParts) => {
                testQuery(
                    queryParts.join(' '),
                    logdb, 
                    queryParts.reduce((arr, q) => !arr?
                        expected[q]:
                        intersection(arr, expected[q])
                    , undefined as number[] | undefined)!
                );
            });
        });
    });
});
