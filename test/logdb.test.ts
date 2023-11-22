import {Observable, concat} from 'rxjs';
import {toArray, tap, count} from 'rxjs/operators';

import { LogDb } from '../src/logdb';
import { Parser } from '../src/query';

// ((a, b) => a - b)
function sortedUnion<T>(lhs: Array<T>, rhs: Array<T>, compareFn?: (a: T, b: T) => number): Array<T> {
    return Array.from(new Set([...lhs, ...rhs])).sort(compareFn);
}

function intersection<T>(lhs: Array<T>, rhs: Array<T>): Array<T> {
    return lhs.filter((index) => rhs.includes(index));
}

function testQuery(query: string, logdb: LogDb, expected: number[]) {
    test(query, () => {
        const expectedMatches = new Set(expected);

        const expr = parser.parse(query);
        expect(expr.length).toBe(1);
        

        return logdb.filterAll(expr[0], -500).pipe(
            toArray(),
            tap((results) => {
                const resultIdxs = results.map((result) => result.record.idx).sort((a, b) => a - b);
                expect(resultIdxs).toEqual(expected);
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
            const andQueries = [
                ['a', 'a'],
                ['a', 'b'],
                ['a', 'z'],
                ['a', 'y'],

                ['a:a', 'b:b'],
            ];

            andQueries.forEach((queryParts) => {
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

        describe('query: OR', () => {
            const orQueries = [
                ['a', 'a'],
                ['a', 'b'],
                ['a', 'z'],
                ['a', 'y'],

                ['a:a', 'b:b'],
            ];

            orQueries.forEach((queryParts) => {
                testQuery(
                    queryParts.join(','),
                    logdb, 
                    queryParts.reduce((arr, q) => !arr?
                        expected[q]:
                        sortedUnion(arr, expected[q], (a, b) => a - b)
                    , undefined as number[] | undefined)!
                );
            });
        });

        const excludeExpected: any = {
            '!a': [3],
            '!b': [1],
            '!z': [0, 2, 3],
            '!y': [0, 1, 2],

            '!a:': [2, 3],
            '!b:': [0, 1],
            '!z:': [0, 1, 2, 3],
            '!y:': [0, 1, 2, 3],

            ':!a': [0, 1, 3],
            ':!b': [1, 2, 3],
            ':!z': [0, 2, 3],
            ':!y': [0, 1, 2],

            '!a:a': [2],
            '!a:b': [],
            '!a:z': [],
            '!a:y': [3],

            '!b:a': [],
            '!b:b': [0],
            '!b:z': [1],
            '!b:y': [],

            'a:!a': [0, 1],
            'a:!b': [1],
            'a:!z': [0],
            'a:!y': [0, 1],

            'b:!a': [3],
            'b:!b': [2, 3],
            'b:!z': [2, 3],
            'b:!y': [2],
        };

        describe('query: EXCLUDE', () => {
            Object.keys(excludeExpected).forEach((query) => {
                testQuery(query, logdb, excludeExpected[query]);
            });
        });

        //TODO: expand tests with variety of inputs, structured data, duplicate logs, different data types
        //TODO: add structured lookup tests/dot (.) operator
        //TODO: add tests with multiple AND/OR operators
    });
});
