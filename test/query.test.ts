import { Lexer, Parser, Parse } from '../src/query';

function valueExpr(v: any): Parse.Expression.VALUE {
    return {
        eType: 'VALUE',
        value: v,
    };
}

const queries: Array<{input: string, expected: Parse.Expression[]}> = [{
    input: 'error',
    expected: [valueExpr('error')],
}, {
    input: 'level:',
    expected: [{
        eType: 'MATCH_PROPERTY',
        property: valueExpr('level'),
    }],
}, {
    input: ':error',
    expected: [{
        eType: 'MATCH_VALUE',
        value: valueExpr('error'),
    }],
}, {
    input: 'level:error',
    expected: [{
        eType: 'MATCH',
        property: valueExpr('level'),
        value: valueExpr('error'),
    }],
}, {
    input: 'error,warn',
    expected: [{
        eType: 'AND',
        lhs: valueExpr('error'),
        rhs: valueExpr('warn'),
    }],
}, {
    input: 'level:error,warn',
    expected: [{
        eType: 'AND',
        lhs: {
            eType: 'MATCH',
            property: valueExpr('level'),
            value: valueExpr('error'),
        },
        rhs: valueExpr('warn'),
    }],
// }, {
    // input: 'error ',
    // expected: {eType: 'MATCH', property: 'level', value: 'error'},
}];

beforeEach(() => {
});

describe('query', () => {
    queries.forEach(({input, expected}) => {
        test(input, () => {
            const parser = new Parser();
            const expr = parser.parse(input);
            expect(expr).toEqual(expected);
        });
    });
});

