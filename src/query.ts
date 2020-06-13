import * as fuzzysort from 'fuzzysort';

// TODO: fix bug with evaluation
// MATCH FULL -- property:!value
// does not exclude logs where value matches the property-value pair

export interface Query {
    property?: string;
    excludeProperty: boolean;
    value: string;
    excludeValue: boolean;
}

export namespace Lex {
}

export interface TokenDefinition {
    tType: string;
    pattern: RegExp;
}
const tokenDefinitions: TokenDefinition[] = [{
    // tType: 'UNDEFINED',
    // pattern: /undefined/y,
// }, {
    // tType: 'NULL',
    // pattern: /null/y,
// }, {
    // tType: 'BOOLEAN',
    // pattern: /(true)|(false)/y,
// }, {
    // TODO: BUG: the lexer is greedy and will match too much if the query contains more than one pair of quotation marks. may just have to adjust which regex match is returned
    tType: 'QUOTED_STR',
    pattern: /\".*\"/y,
}, {
    // tType: 'NUMBER',
    // pattern: /[+-]?\d+(\.\d+)?/y,
    /*
}, {
    tType: 'OBJECT_BEGIN',
    pattern: /{/y,
}, {
    tType: 'OBJECT_SEP',
    pattern: /,/y,
}, {
    tType: 'OBJECT_END',
    pattern: /}/y,
    */
// }, {
//     tType: 'LESS_THAN_EQ',
//     pattern: /<=/y,
// }, {
//     tType: 'GREATER_THAN_EQ',
//     pattern: />=/y,
// }, {
//     tType: 'LESS_THAN',
//     pattern: /</y,
// }, {
//     tType: 'GREATER_THAN',
//     pattern: />/y,
// }, {
    tType: 'AND',
    pattern: / /y,
}, {
    tType: 'OR',
    pattern: /,/y,
}, {
    tType: 'EXCLUDE',
    pattern: /\!/y,
}, {
    tType: 'MATCH_SEP',
    pattern: /:/y,
}, {
    tType: 'STRING',
    pattern: /[^!:, ]+/y,
}];

export interface Token {
    tType: string;
    idx: number;
    value: string;
}

export function* Lexer(query: string) {
    let charIdx = 0;
    while(charIdx < query.length) {
        let token: Token | undefined;
        for(const rule of tokenDefinitions) {
            rule.pattern.lastIndex = charIdx;
            const matches = rule.pattern.exec(query);
            if(matches && matches.index == charIdx) {
                charIdx = matches.index + matches[0].length;
                token = {
                    tType: rule.tType,
                    idx: matches.index,
                    value: matches[0],
                };
                break;
            }
        }

        if(token) {
            yield token;
        }
        else {
            return;
            // throw new Error(`LEXER: String does not match any known token patterns: ${query.substring(charIdx)}`);
        }
    }
    /*
    let charIdx = 0;
    while(charIdx < query.length) {
        let token: Token | undefined;
        for(const rule of tokenDefinitions) {
            rule.pattern.lastIndex = charIdx;
            const matches = rule.pattern.exec(query);
            if(matches && matches.index == charIdx) {
                charIdx = matches.index;
                token = {
                    tType: rule.tType,
                    idx: matches.index,
                    value: matches[0],
                };
                break;
            }
        }

        if(token) {
            yield token;
        }
        else {
            throw new Error(`LEXER: String does not match any known token patterns: ${query.substring(charIdx)}`);
        }

    }
    */
    /*
    yield {
        tType: 'STRING',
        idx: 0,
        value: 'hello'
    };
    */
}

export namespace Parse {
    export type Expression =
          Expression.VALUE
        | Expression.MATCH
        | Expression.AND
        | Expression.OR
        | Expression.EXCLUDE;

    export namespace Expression {

        export interface VALUE {
            eType: 'VALUE';
            value: any;
        }

        export type MATCH =
              MATCH.FULL_MATCH
            | MATCH.PROPERTY_MATCH
            | MATCH.VALUE_MATCH
            | MATCH.ALL_MATCH;

        export namespace MATCH {
            export interface BASE_MATCH {
                eType: 'MATCH';
            }

            export interface FULL_MATCH extends BASE_MATCH {
                mType: 'FULL';
                property: VALUE | EXCLUDE;
                value: VALUE | EXCLUDE;
            }
            /** e.g. 'prop:', filters to objects with matching property */
            export interface PROPERTY_MATCH extends BASE_MATCH {
                mType: 'PROPERTY';
                property: VALUE | EXCLUDE;
            }

            /** e.g. ':value', filters to matching value for any property */
            export interface VALUE_MATCH extends BASE_MATCH {
                mType: 'VALUE';
                value: VALUE | EXCLUDE;
            }
            /* a lone semicolon is valid, it just doesn't do anything */
            export interface ALL_MATCH extends BASE_MATCH {
                mType: 'ALL';
            }
        }
        export interface AND {
            eType: 'AND';
            lhs?: Expression;
            rhs?: Expression;
        }
        export interface OR {
            eType: 'OR';
            lhs?: Expression;
            rhs?: Expression;
        }
        export interface EXCLUDE {
            eType: 'EXCLUDE';
            expr: VALUE;
        }
    }
}

export class Parser {
    public lexer: Generator<Token> | undefined;
    public stack: Parse.Expression[];

    constructor() {
        this.stack = [];
    }

    /** returns the parsed expression.
     * if the array contains more than one entry, the parser
     * was provided an incomplete expression */
    public parse(query: string): Parse.Expression[] {
        this.stack = [];

        this.lexer = Lexer(query);
        let expr = this.nextExpression();
        while(expr) {
            expr = this.nextExpression();
        }

        return this.stack;
    }

    public nextExpression(): Parse.Expression | undefined {
        const token = this.lexer!.next();
        if(token.done) {
            return undefined;
        }

        const expr = this.parseExpression(token.value);
        if(expr) {
            this.stack.push(expr);
        }

        return expr;
    }

    public parseExpression(token: Token): Parse.Expression | undefined {
        switch(token.tType) {
            /** literal string, surrounded by quotation marks */
            case 'UNDEFINED':
                return {
                    eType: 'VALUE',
                    value: undefined,
                };
            case 'NULL':
                return {
                    eType: 'VALUE',
                    value: null,
                };
            case 'BOOLEAN':
                return {
                    eType: 'VALUE',
                    value: token.value === 'true'? true: false,
                };
            case 'QUOTED_STR':
                return {
                    eType: 'VALUE',
                    value: token.value.substring(1, token.value.length - 1),
                };
            case 'NUMBER':
                return {
                    eType: 'VALUE',
                    value: parseFloat(token.value),
                };
            case 'STRING':
                return {
                    eType: 'VALUE',
                    value: token.value,
                };
            case 'MATCH_SEP': {
                let lhs: Parse.Expression.VALUE | Parse.Expression.EXCLUDE | undefined;
                if(this.stack.length > 0) {
                    let prevExpr = this.stack[this.stack.length - 1];
                    if(prevExpr.eType === 'VALUE' || prevExpr.eType === 'EXCLUDE') {
                        lhs = prevExpr;
                        this.stack.pop();
                    }
                }

                let rhs = this.nextExpression();
                if(rhs && (rhs.eType === 'VALUE' || rhs.eType === 'EXCLUDE')) {
                    this.stack.pop();
                }
                else {
                    rhs = undefined;
                }


                if(lhs && rhs) {
                    return {
                        eType: 'MATCH',
                        mType: 'FULL',
                        property: lhs,
                        value: rhs,
                    };
                }
                else if(lhs) {
                    return {
                        eType: 'MATCH',
                        mType: 'PROPERTY',
                        property: lhs,
                    };
                }
                else if(rhs) {
                    return {
                        eType: 'MATCH',
                        mType: 'VALUE',
                        value: rhs,
                    };
                }

                return {
                    eType: 'MATCH',
                    mType: 'ALL',
                };
            }
            case 'EXCLUDE': {
                const expr = this.nextExpression();
                if(!expr) {
                    throw new Error(`EXCLUDE must be followed by a VALUE`);
                }
                if(expr.eType !== 'VALUE') {
                    throw new Error(`Cannot EXCLUDE expression '${expr.eType}'`);
                }

                this.stack.pop();

                return {
                    eType: 'EXCLUDE',
                    expr,
                };
            }
            case 'AND':
            case 'OR': {
                let lhs: Parse.Expression | undefined;
                if(this.stack.length > 0) {
                    let prevExpr = this.stack[this.stack.length - 1];
                    lhs = prevExpr;
                    this.stack.pop();
                }

                let nextExpr: Parse.Expression | undefined = this.nextExpression();

                while(nextExpr) {
                    if(token.tType === 'AND' && nextExpr.eType === 'OR') {
                        // reorder AST into dijunctive form (OR of ANDS)
                        const result = {
                            eType: token.tType,
                            lhs,
                            rhs: nextExpr.lhs
                        };

                        nextExpr.lhs = result;
                        // return undefined so this isn't added to the stack
                        return undefined;
                    }
                    nextExpr = this.nextExpression();
                }

                const rhs  = this.stack.pop()

                return {
                    eType: token.tType,
                    lhs,
                    rhs,
                };
            }
            default:
                throw new Error(`UNRECOGNIZED TOKEN '${token}'`);
        }
    }
}
