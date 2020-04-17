import * as fuzzysort from 'fuzzysort';

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
    tType: 'UNDEFINED',
    pattern: /undefined/y,
}, {
    tType: 'NULL',
    pattern: /null/y,
}, {
    tType: 'BOOLEAN',
    pattern: /(true)|(false)/y,
}, {
    tType: 'QUOTED_STR',
    pattern: /".*"/y,
// }, {
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
}, {
    tType: 'LESS_THAN_EQ',
    pattern: /<=/y,
}, {
    tType: 'GREATER_THAN_EQ',
    pattern: />=/y,
}, {
    tType: 'LESS_THAN',
    pattern: /</y,
}, {
    tType: 'GREATER_THAN',
    pattern: />/y,
}, {
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
            if(matches) {
            }
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
            lhs?: MATCH | VALUE;
            rhs?: MATCH | VALUE;
        }
        export interface OR {
            eType: 'OR';
            lhs?: MATCH | VALUE;
            rhs?: MATCH | VALUE;
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
        this.stack.push(expr);
        return expr;
    }

    public parseExpression(token: Token): Parse.Expression {
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
                    value: token.value.substring(1, -1),
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
                let lhs: Parse.Expression.VALUE | Parse.Expression.MATCH | undefined;
                if(this.stack.length > 0) {
                    let prevExpr = this.stack[this.stack.length - 1];
                    if(prevExpr.eType === 'VALUE' || prevExpr.eType === 'MATCH') {
                        lhs = prevExpr;
                        this.stack.pop();
                    }
                }

                let rhs = this.nextExpression();
                if(rhs && (rhs.eType === 'VALUE' || rhs.eType === 'MATCH')) {
                    this.stack.pop();
                }
                else {
                    rhs = undefined;
                }

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

/*
function parseQuery(query: string): Query {
    const queryParts = query.split(':');
    const output: Query = {
        // property:
    };
    if(queryParts[0].length > 0) {
        if(queryParts[0][0] === '!') {
            output.excludeProperty = true;
            output.property = queryParts[0].substring(1);
        }
        else {
            output.excludeProperty = false;
            output.property = queryParts[0];
        }
    }

    if(queryParts.length > 1 && queryParts[1].length > 0) {
        if(queryParts[1][0] === '!') {
            output.excludeValue = true;
            output.value = queryParts[1].substring(1);
        }
        else {
            output.excludeValue = false;
            output.value = queryParts[1];
        }
    }
    return output;
}

function findMatchingLogs(query, searchProperties, searchValues) {
    const queries = query.split(',').map((q) => q.split('&'));

    const matchResultSets = queries.map((orQuery) => {
        const andMatches = orQuery.filter((andQuery) => andQuery.length > 0 && andQuery !== ':').map((andQuery) => {
            return findMatchingLogsSingleQuery(andQuery, searchProperties, searchValues);
        });
        // NOTE: we calculate an AND query by performing all searches on all logs, then finding the intersection of those result sets. it may be beneficial to instead perform each subsequent AND query on the already filtered result set.

        const andMatchesIntersection = {};
        if(andMatches.length > 0) {
            Object.keys(andMatches[0]).forEach((logOffset) => {
                const logOffsetMatches = andMatches.filter((andMatch) => andMatch[logOffset]);
                if(logOffsetMatches.length === andMatches.length) {
                    andMatchesIntersection[logOffset] = {
                        log: andMatches[0][logOffset].log,
                        propertySearchResults: andMatches.reduce((arr, andMatch) => arr.concat(andMatch[logOffset].propertySearchResults), []),
                        valueSearchResults: andMatches.reduce((arr, andMatch) => arr.concat(andMatch[logOffset].valueSearchResults), []),
                    };
                }
            });
        }

        return andMatchesIntersection;
    });


    // calculate union of result sets
    const matchResults = matchResultSets.reduce((allResults, nextResults) => {
        Object.keys(nextResults).forEach((logOffset) => {
            if(!allResults[logOffset]) {
                allResults[logOffset] = nextResults[logOffset];
            }
            else {
                allResults[logOffset].propertySearchResults.push(...nextResults[logOffset].propertySearchResults);
                allResults[logOffset].valueSearchResults.push(...nextResults[logOffset].valueSearchResults);
            }
        });
        return allResults;
    }, {});

    return Object.keys(matchResults).map((logOffset)=> parseInt(logOffset)).sort((a, b) => (a - b)).map((logOffset) => ({
        ...matchResults[logOffset],
        offset: logOffset
    }));
}

const fuzzysortThreshold = -100;
function findMatchingLogsSingleQuery(query, searchProperties, searchValues) {
    // a de-duped index of logs, with all fuzzysort results that contained that log
    // key: logOffset, value: { log: object, results: object[] }
    const matchResults = {};

    const q = parseQuery(query);

    // fuzzy find matching documents
    let propertyResults;
    if(q.property && !q.excludeProperty) {
        propertyResults = fuzzysort.go(q.property, searchProperties, {
            limit: 100,
            threshold: fuzzysortThreshold
        });
    }

    let valueResults;
    if(q.value && !q.excludeValue) {
        let filteredLogValues = searchValues;
        if(q.property && !q.excludeProperty) {
            // only search for values set on matched properties
            filteredLogValues = filteredLogValues.filter((logValue) => propertyResults.find((propertyResult) => propertyResult.target === logValue.property));
        }

        valueResults = fuzzysort.go(q.value, filteredLogValues, {
            key: 'value',
            limit: 100,
            threshold: fuzzysortThreshold,
        });
    }

    // add results to output
    if(q.value && !q.excludeValue) {
        valueResults.forEach((result) => {
            const logOffset = result.obj.logOffset;
            if(q.excludeProperty) {
                // don't include documents that matched the value search but were in an excluded property
                const propMatch = fuzzysort.go(q.property, [result.obj.property], {threshold: fuzzysortThreshold});
                if(propMatch.length > 0) {
                    return;
                }
            }

            if(!matchResults[logOffset]) {
                matchResults[logOffset] = {
                    log: logs[logOffset].log,
                    propertySearchResults: [],
                    valueSearchResults: []
                };
            }
            matchResults[logOffset].valueSearchResults.push(result);
        });
    }

    if(q.property && !q.excludeProperty) {
        propertyResults.forEach((result) => {
            logIndex[result.target].forEach((logOffset) => {
                if(q.excludeValue) {
                    const value = getProperty(logs[logOffset].log, result.target);
                    // don't include documents that matched the property search but matched an excluded value
                    const valueMatch = fuzzysort.go(q.value, [value], {threshold: fuzzysortThreshold});
                    if(valueMatch.length > 0) {
                        return;
                    }
                }
                if(!matchResults[logOffset]) {
                    if(q.value && !q.excludeValue) {
                        // when filtering by property and value, only include results that were already found in the value search
                        // this gives us propety highlighting information for those logs
                        return;
                    }
                    matchResults[logOffset] = {
                        log: logs[logOffset].log,
                        propertySearchResults: [],
                        valueSearchResults: []
                    };
                }
                matchResults[logOffset].propertySearchResults.push(result);
            });
        });
    }

    return matchResults;
}

function filterLogs(query) {
    const matchedLogs = query.length > 0 && query !== ':'? 
        findMatchingLogs(query, this.allProperties, this.allValues):
        logs.map((log, i) => ({log: log.log, offset: i, propertySearchResults: [], valueSearchResults: []}));
}
*/

/** Gets a property from an object if it exists. Supports nested properties
 * @argument obj - root object
 * @argument propertyName - name of the property to retrieved. Nested properties are specified with dot notation ('a.b.c')
 */
/*
export function getProperty(obj, propertyName) {
    if(!obj) {
        return undefined;
    }

    const properties = propertyName.split('.');
    const value = obj[properties[0]];
    if(properties.length === 1) {
        return value;
    }

    return getProperty(value, properties.slice(1).join('.'));
}

*/
