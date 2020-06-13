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
    input: 'error:',
    expected: [{
        eType: 'MATCH',
        mType: 'PROPERTY',
        property: valueExpr('error'),
    }],
}, {
    input: ':error',
    expected: [{
        eType: 'MATCH',
        mType: 'VALUE',
        value: valueExpr('error'),
    }],
}, {
    input: 'level:error',
    expected: [{
        eType: 'MATCH',
        mType: 'FULL',
        property: valueExpr('level'),
        value: valueExpr('error'),
    }],
}, {
    input: 'error,warn',
    expected: [{
        eType: 'OR',
        lhs: valueExpr('error'),
        rhs: valueExpr('warn'),
    }],
}, {
    input: 'error,warn,info',
    expected: [{
        eType: 'OR',
        lhs: valueExpr('error'),
        rhs: {
            eType: 'OR',
            lhs: valueExpr('warn'),
            rhs: valueExpr('info'),
        }
    }]
}, {
    input: 'level:error,warn',
    expected: [{
        eType: 'OR',
        lhs: {
            eType: 'MATCH',
            mType: 'FULL',
            property: valueExpr('level'),
            value: valueExpr('error'),
        },
        rhs: valueExpr('warn'),
    }],
}, {
    input: '!error',
    expected: [{
        eType: 'EXCLUDE',
        expr: valueExpr('error'),
    }],
}, {
    input: '!error:',
    expected: [{
        eType: 'MATCH',
        mType: 'PROPERTY',
        property: {
            eType: 'EXCLUDE',
            expr:  valueExpr('error'),
        },
    }],
}, {
    input: ':!error',
    expected: [{
        eType: 'MATCH',
        mType: 'VALUE',
        value: {
            eType: 'EXCLUDE',
            expr: valueExpr('error'),
        },
    }],
}, {
    input: '!timestamp:2020',
    expected: [{
        eType: 'MATCH',
        mType: 'FULL',
        property: {
            eType: 'EXCLUDE',
            expr: valueExpr('timestamp'),
        },
        value: valueExpr('2020'),
    }],
}, {
    input: 'level:!error',
    expected: [{
        eType: 'MATCH',
        mType: 'FULL',
        property: valueExpr('level'),
        value: {
            eType: 'EXCLUDE',
            expr: valueExpr('error'),
        },
    }],
}, {
    input: 'error warn',
    expected: [{
        eType: 'AND',
        lhs: valueExpr('error'),
        rhs: valueExpr('warn'),
    }]
}, {
    input: 'error warn info',
    expected: [{
        eType: 'AND',
        lhs: valueExpr('error'),
        rhs: {
            eType: 'AND',
            lhs: valueExpr('warn'),
            rhs: valueExpr('info'),
        }
    }]
}, {
    input: 'error warn,info trace',
    expected: [{
        eType: 'OR',
        lhs: {
            eType: 'AND',
            lhs: valueExpr('error'),
            rhs: valueExpr('warn'),
        },
        rhs: {
            eType: 'AND',
            lhs: valueExpr('info'),
            rhs: valueExpr('trace'),
        }
    }]
}, {
    input: 'level:error level:warn',
    expected: [{
        eType: 'AND',
        lhs: {
            eType: 'MATCH',
            mType: 'FULL',
            property: valueExpr('level'),
            value: valueExpr('error'),
        },
        rhs: {
            eType: 'MATCH',
            mType: 'FULL',
            property: valueExpr('level'),
            value: valueExpr('warn'),
        }
    }]
}, {
    input: 'level:error level:warn level:info',
    expected: [{
        eType: 'AND',
        lhs: {
            eType: 'MATCH',
            mType: 'FULL',
            property: valueExpr('level'),
            value: valueExpr('error'),
        },
        rhs: {
            eType: 'AND',
            lhs: {
                eType: 'MATCH',
                mType: 'FULL',
                property: valueExpr('level'),
                value: valueExpr('warn'),
            },
            rhs: {
                eType: 'MATCH',
                mType: 'FULL',
                property: valueExpr('level'),
                value: valueExpr('info'),
            }
        }
    }]
}, {
    input: 'level:error level:warn,data:info data:trace',
    expected: [{
        eType: 'OR',
        lhs: {
            eType: 'AND',
            lhs: {
                eType: 'MATCH',
                mType: 'FULL',
                property: valueExpr('level'),
                value: valueExpr('error'),
            },
            rhs: {
                eType: 'MATCH',
                mType: 'FULL',
                property: valueExpr('level'),
                value: valueExpr('warn'),
            },
        },
        rhs: {
            eType: 'AND',
            lhs: {
                eType: 'MATCH',
                mType: 'FULL',
                property: valueExpr('data'),
                value: valueExpr('info'),
            },
            rhs: {
                eType: 'MATCH',
                mType: 'FULL',
                property: valueExpr('data'),
                value: valueExpr('trace'),
            }
        }
    }]
}, {
    input: '!error',
    expected: [{
        eType: 'EXCLUDE',
        expr: valueExpr('error'),
    }]
}, {
    input: '!level:',
    expected: [{
        eType: 'MATCH',
        mType: 'PROPERTY',
        property: {
            eType: 'EXCLUDE',
            expr: valueExpr('level'),
        }
    }],
}, {
    input: ':!error',
    expected: [{
        eType: 'MATCH',
        mType: 'VALUE',
        value: {
            eType: 'EXCLUDE',
            expr: valueExpr('error'),
        }
    }],
}, {
    input: '!level:error',
    expected: [{
        eType: 'MATCH',
        mType: 'FULL',
        property: {
            eType: 'EXCLUDE',
            expr: valueExpr('level'),
        },
        value: valueExpr('error'),
    }],
}, {
    input: 'level:!error',
    expected: [{
        eType: 'MATCH',
        mType: 'FULL',
        property: valueExpr('level'),
        value: {
            eType: 'EXCLUDE',
            expr: valueExpr('error'),
        }
    }],
}];

describe('query', () => {
    describe('parser', () => {
        queries.forEach(({input, expected}) => {
            test(input, () => {
                const parser = new Parser();
                const expr = parser.parse(input);
                expect(expr).toEqual(expected);
            });
        });
    });
});

//TODO: expand tests with variety of inputs, structured data, duplicate logs, different data types

//TODO: add structured lookup tests/dot (.) operator
