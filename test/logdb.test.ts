import { LogDb } from '../src/logdb';
import { Parser } from '../src/query';

const logs = [
    {
        level: 'info',
        name: 'elliot',
        a: 1,
        b: 'two',
        c: {
            c1: 'c-c1',
            c2: 'c-c2',
        }
    }, 
    {
        level: 'info',
        name: 'elliot',
        b: 't',
    },
    {
        level: 'info',
        name: 'noah',
        b: 'tw',
    },
    {
        level: 'info',
        name: 'noah',
        b: 'twixt',
    },
    {
        level: 'info',
        name: 'noah',
        b: 'boot',
    },
    {
        level: 'info',
        name: 'noah',
        b: 'shazam',
    }
];

let parser: Parser;

beforeEach(() => {
    parser = new Parser();
});

describe('logdb', () => {
    test('filter', (done) => {
        const logdb = new LogDb();
        logs.forEach((log) => {
            logdb.ingest(JSON.stringify(log));
        });

        console.log(logdb.logs);
        logdb.filter(parser.parse('tw')[0]).subscribe({
            next: (results) => {
                console.log(results);
                results.matches.forEach((match, logIdx) => {
                    console.log(logIdx);
                    console.log(match.property);
                    console.log(match.value);
                });
            },
            complete: () => done(),
        });
    });
    // describe('filter', () => {
        // queries.forEach(({input, expected}) => {
            // test(input, () => {
                // const parser = new Parser();
                // const expr = parser.parse(input);
                // expect(expr).toEqual(expected);
            // });
        // });
    // });
});

