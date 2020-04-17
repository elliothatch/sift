import {Readable} from 'stream';
import * as fuzzysort from 'fuzzysort';

import { EMPTY, from, merge, Observable, of } from 'rxjs';
import { map, mergeMap } from 'rxjs/operators';

import { Parse } from './query';

/** an index into the `logs` array */
export type LogIdx = number;
/** fully qualified propery name (period-seperated) */
export type PropertyId = string;

export interface LogRecord {
    log: any;
    idx: LogIdx;
}

export interface LogValueMap {
    value: any;
    // preparedValue: fuzzysort.Prepared;
    property: PropertyId;
    idx: LogIdx;
}

export interface Filter {
    match: Parse.Expression.MATCH[];
    exclude: Parse.Expression.MATCH[];
}

export interface ResultSet {
    /** dictionary that stores fuzzysort match information about each log. used for text highlighting */
    matches: Map<LogIdx, {
        property: fuzzysort.Result[];
        value: fuzzysort.Result[];
    }>;

    /** the following properties are indexes for logs found in the matches dictionary */
    propertyIndex:  Map<PropertyId, LogIdx[]>;
    properties: PropertyId[];

    // TODO: fuzzysort match.target might always be a string, breaking this association
    valueIndex: Map<any, LogIdx[]>;
    values: any[];
}

export class LogDb {
    /** this array contains all the logs, */
    public logs: LogRecord[];
    public propertyIndex:  {[flatPropertyName: string]: LogIdx[]};

    public allProperties: PropertyId[];
    public allValues: LogValueMap[]; // TODO: we should probably combine identical values into a single entry in the array, which lists all logs that contain this exact value
    public fuzzysortThreshold: number;

    public resultSet: ResultSet;

    constructor() {
        this.logs = [];
        this.propertyIndex = {};
        this.allProperties = [];
        this.allValues = [];
        this.fuzzysortThreshold = -100;
    }

    /** parses a raw string, then records it in the database and indexes it */
    public ingest(line: string) {

        const record = {
            log: parseLog(line),
            idx: this.logs.length,
        };
        this.logs.push(record);

        const indexResults = this.indexLog(record, record.log);
        // filterSingleLog(queryTextBuffer.getText(), logOffset, indexResults.properties, indexResults.values);
    }

    protected indexLog(record: LogRecord, logValue: any, propertyPrefixes?: string[]): void {
        // TODO: index arrays and object values themselves, rather than just their children (support query specific values in array, object structures
        if(!propertyPrefixes) {
            propertyPrefixes = [];
        }

        // index property
        const propertyId: PropertyId = propertyPrefixes.join('.');

        if(!this.propertyIndex[propertyId]) {
            this.allProperties.push(propertyId);
            this.propertyIndex[propertyId] = [];
        }

        this.propertyIndex[propertyId].push(record.idx);

        // index values
        const values = [];
        if(Array.isArray(logValue)) {
            logValue.forEach((v) => {
                const value =
                    v === null? 'null':
                    v === undefined? 'undefined':
                    v.toString();

                values.push({
                    value,
                    property: propertyId,
                    idx: record.idx,
                });
            });
        }
        else if (typeof logValue !== 'object' || logValue == undefined) {
            const value =
                logValue === null? 'null':
                logValue === undefined? 'undefined':
                logValue.toString();

            values.push({
                value,
                property: propertyId,
                idx: record.idx,
            });
        }
        else { // is object
            Object.keys(logValue).forEach((p) => {
                this.indexLog(record, logValue[p], propertyPrefixes!.concat([p]));
            });
        }

        this.allValues.push(...values);
    }

    public filter(query: Parse.Expression, searchSet?: ResultSet): ResultSet {
        if(!searchSet) {
            searchSet = this.searchSet;
        }

        switch(query.eType) {
            case 'VALUE':
                return this.filter({
                        eType: 'OR',
                    lhs: {
                        eType: 'MATCH',
                        mType: 'PROPERTY',
                        property: query,
                    },
                    rhs: {
                        eType: 'MATCH',
                        mType: 'VALUE',
                        value: query,
                    }
                }, searchSet);
            case 'EXCLUDE':
                return this.fitler({
                    eType: 'AND',
                    lhs: {
                        eType: 'MATCH',
                        mType: 'PROPERTY',
                        property: query,
                    },
                    rhs: {
                        eType: 'MATCH',
                        mType: 'VALUE',
                        property: query
                    }
                }, searchSet);
            case 'MATCH':
                return this.filterMatch(query, searchSet);
            case 'AND':
                // return the intersection of results
                return this.filterMatch(query.rhs, this.filterMatch(query.lhs, searchSet);
            case 'OR': {
                const lhsResultSet = this.filterMatch(query.lhs, searchSet);
                const rhsResultSet = this.filterMatch(query.rhs, searchSet);
                // TODO: return the union of results
                return searchSet;
            }
            default:
                throw new Error(`Unrecognized expression: ${query}`);
        }
    }

    // filter MATCH steps
    // for each MATCH in the filter, in the remaining result set:
    // 1. evaluate FULL MATCHES that may include exclude clauses, and PROPERTY and VALUE matches that do not contain an exclude
    // 2. evaluate PROPERTY and VALUE matches that contain an EXCLUDE.
    public filterMatch(match: Parse.Expression.MATCH, searchSet: ResultSet): Observable<ResultSet> {
        if((match.mType === 'FULL' || match.mType === 'PROPERTY')
            && match.property.eType !== 'EXCLUDE') {
            // search by property index
            return from(fuzzysort.goAsync(match.property, searchSet.propertyNames, {
                // limit: 100,
                threshold: this.fuzzysortThreshold,
            })).pipe(
                map((propertyMatches) => {
                    return propertyMatches.reduce((resultSet, propertyMatch) => {
                        searchSet.propertyIndex[propertyMatch.target].forEach((logIdx) => {
                            if(match.mType === 'FULL') {
                                const log = this.logs[logIdx];
                                const value = getProperty(log, propertyMatch.target);
                                const valueMatch = fuzzysort.go(match.value, [value], {threshold: this.fuzzysortThreshold});
                                if((match.value.eType === 'EXCLUDE' && valueMatch.length > 0)
                                    || (match.value.eType !== 'EXCLUDE' && valueMatch.length === 0)) {
                                    // no match
                                    return;
                                }
                                else {
                                    // matched property and value
                                    // add value to the index and matches
                                    // TODO: there's a lot of repetition here
                                    // I think we should be able to reorder these things so we only have to set "matches" once
                                    let resultMatch = resultSet.matches.get(logIdx);
                                    if(!resultMatch) {
                                        resultMatch = {
                                            property: [],
                                            value: [],
                                        };
                                    }
                                    resultMatch.value.push(propertyMatch);
                                    resultSet.matches.set(logIdx, resultMatch);

                                    let resultValueIndex = resultSet.valueIndex.get(value);
                                    if(!resultValueIndex) {
                                        resultValueIndex = [];
                                        values.push(value);
                                    }

                                    resultValueIndex.push(logIdx);
                                    resultSet.valueIndex.set(value, resultValueIndex);
                                }
                            }

                            let resultMatch = resultSet.matches.get(logIdx);
                            if(!resultMatch) {
                                resultMatch = {
                                    property: [],
                                    value: [],
                                };
                            }

                            // property match! add proeprty to index and matches
                            resultMatch.property.push(propertyMatch);
                            resultSet.matches.set(logIdx, resultMatch);

                            let resultPropertyIndex = resultSet.propertyIndex.get(propertyMatch.target);
                            if(!resultPropertyIndex) {
                                resultPropertyIndex = [];
                                properties.push(propertyMatch.target);
                            }

                            resultPropertyIndex.push(logIdx);
                            resultSet.propertyIndex.set(propertyMatch.target, resultPropertyIndex);
                        });

                    }, {
                        matches: new Map(),
                        propertyIndex: new Map(),
                        properties: [],
                        valueIndex: new Map(),
                        values: []
                    } as ResultSet);
                })
            );
        }
        else if((match.mType === 'FULL' || match.mType === 'VALUE')
            && match.value.eType !== 'EXCLUDE') {
            // search by value index
        }
        else if(match.mType === 'FULL') {
            // both fields are excluded
            // this query doesn't make any sense, don't do anything
            return of(searchSet);
        }
        else if(match.mType === 'PROPERTY') {
            // must be an exclude property
        }
        else if(match.mType === 'VALUE') {
            // must be an exclude value
        }
    }


            return from(fuzzysort.goAsync(match.property, resultSet.propertyNames, {
                // limit: 100,
                threshold: this.fuzzysortThreshold,
            })).pipe(
                mergeMap((propertyMatches) => {
                    return merge(propertyMatches.map((propertyMatch) => {
                        const log = this.logs[this.propertyIndex[propertyMatch.target]];
                        const value = getProperty(log, propertyMatch.target);
                        if(match.mType === 'FULL') {
                            if(match.value.eType === 'VALUE') {
                            const valueMatch = fuzzysort.go(match.value, [value], {threshold: this.fuzzysortThreshold});
                            if(valueMatch.length === 0) {
                                // the value did not match the queried value
                                return EMPTY;
                            }
                        }

                            return {
                                expr: match,
                                matchResult: propertyMatch,
                                property: propertyMatch.target,
                                value,
                                log,
                            };
                        }));
                    })
                );

            switch(match.mType) {
                case 'FULL':
                case 'PROPERTY':
                case 'VALUE':
                    return from(fuzzysort.goAsync(match.value, this.allValues, {
                        key: 'value',
                        limit: 100,
                        threshold: this.fuzzysortThreshold,
                    })).pipe(
                        mergeMap((valueMatches) => {
                            return merge(valueMatches.map((valueMatch) => {
                                const target: LogValueMap = valueMatch.target;
                                const log = this.logs[valueMatch.target.idx];

                                return {
                                    expr: match,
                                    matchResult: valueMatch,
                                    property: target.property,
                                    value: target.value,
                                    log,
                                };
                            }));
                        })
                    );
                case 'ALL':
                    return EMPTY; // TODO: should just return all the results i guess
            }
        }));

        // cull matches that are excluded
        
        return matchedLogs;
    }

    // meta-filter steps:
    // 1. create a result set that contains all logs
    // 2. 
    // 1. create a FILTER object for each OR statement. each FILTER includes all the MATCHES AND statements
    // 2. perform filter MATCH action on all FILTERS
    // 3. return the union of all FILTERS
    //
    // filter MATCH steps
    // for each MATCH in the filter, in the remaining result set:
    // 1. evaluate FULL MATCHES that may include exclude clauses, and PROPERTY and VALUE matches that do not contain an exclude
    // 2. evaluate PROPERTY and VALUE matches that contain an EXCLUDE.

    public filter(f: Filter): Observable<{match: fuzzysort.Result, log: LogRecord}> {
        // TODO: add ability to cancel searches
        // TODO: there are problems with this currently:
        // right now we're trying to match liberally, then prune matches with an EXCLUDE pass.
        // but does it make more sense to e.g. EXCLUDE a match from the first pass if it is of the form !property:value -- rather than finding all matches for VALUE, then 
        //  yeah that doesn't work, because the expression will be MATCH (EXLUDE PROP, VALUE)--thus giving us a "FULL"  match  which doesn't work with the current expression format
        //  still--it would be simplest if we still did it in two passes I think, just need to carry enough information through the first pass. making sense of a query to convert it to another kind will take a bit of work
        
        // find all matches
        let matchedLogs: Observable<{match: fuzzysort.Result, log: LogRecord}> = merge(f.match.map((match) => {
            switch(match.mType) {
                case 'FULL':
                case 'PROPERTY':
                    return from(fuzzysort.goAsync(match.property, this.allProperties, {
                        limit: 100,
                        threshold: this.fuzzysortThreshold,
                    })).pipe(
                        mergeMap((propertyMatches) => {
                            return merge(propertyMatches.map((propertyMatch) => {
                                const log = this.logs[this.propertyIndex[propertyMatch.target]];
                                const value = getProperty(log, propertyMatch.target);
                                if(match.mType === 'FULL') {
                                    const valueMatch = fuzzysort.go(match.value, [value], {threshold: this.fuzzysortThreshold});
                                    if(valueMatch.length === 0) {
                                        // the value did not match the queried value
                                        return EMPTY;
                                    }
                                }

                                return {
                                    expr: match,
                                    matchResult: propertyMatch,
                                    property: propertyMatch.target,
                                    value,
                                    log,
                                };
                            }));
                        })
                    );
                case 'VALUE':
                    return from(fuzzysort.goAsync(match.value, this.allValues, {
                        key: 'value',
                        limit: 100,
                        threshold: this.fuzzysortThreshold,
                    })).pipe(
                        mergeMap((valueMatches) => {
                            return merge(valueMatches.map((valueMatch) => {
                                const target: LogValueMap = valueMatch.target;
                                const log = this.logs[valueMatch.target.idx];

                                return {
                                    expr: match,
                                    matchResult: valueMatch,
                                    property: target.property,
                                    value: target.value,
                                    log,
                                };
                            }));
                        })
                    );
                case 'ALL':
                    return EMPTY; // TODO: should just return all the results i guess
            }
        }));

        // cull matches that are excluded
        
        return matchedLogs;
    }
}

/** turn a raw string into a json object
 * */
function parseLog(line: string): object {
    let log: any;
    try {
        log = JSON.parse(line);
    }
    catch(e) {
        // TODO: try to parse well known logstring formats
        log = {
            level: 'info',
            message: line
        };
    }

    return log;
}

function parseErrorLog(line: string) {
    const log = {
        level: line.match(/warn/i)? 'warn': 'error',
        message: line,
    };
    return log;
}

/** Gets a property from an object if it exists. Supports nested properties
 * @argument obj - root object
 * @argument propertyName - name of the property to retrieved. Nested properties are specified with dot notation ('a.b.c')
 */
function getProperty(obj: object, propertyId: PropertyId) {
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

/*
function filterSingleLog(query, logOffset, properties, values) {
    const matchedLogs = query.length > 0 && query !== ':'? 
        findMatchingLogs(query, properties, values).filter((l) => l.offset === logOffset):
        [{log: logs[logOffset].log, offset: logOffset, propertySearchResults: [], valueSearchResults: []}];

    matchedLogs.forEach((logMatch) => {
        printLog(logMatch);
    });

    const resultsLineOffset = logs.length;

    resultsBuffer.y = -resultsBuffer.cy + screenBuffer.height - 2 ;
    gutterBuffer.y = -gutterBuffer.cy + screenBuffer.height - 2 ;

    if(query.length === 0) {
        statusBuffer.backDelete(statusBuffer.cx);
        statusBuffer.insert(`${logs.length}/${logs.length}`);
    }

    // resultsBuffer.setText(matchedLogs.join('\n'));
    drawResults();
}
*/

/*
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
*/

/** Gets a property from an object if it exists. Supports nested properties
 * @argument obj - root object
 * @argument propertyName - name of the property to retrieved. Nested properties are specified with dot notation ('a.b.c')
 */
/*
function filterLogs(query) {
    const matchedLogs = query.length > 0 && query !== ':'? 
        findMatchingLogs(query, this.allProperties, this.allValues):
        logs.map((log, i) => ({log: log.log, offset: i, propertySearchResults: [], valueSearchResults: []}));
}

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
