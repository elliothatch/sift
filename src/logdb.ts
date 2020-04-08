import {Readable} from 'stream';
import * as fuzzysort from 'fuzzysort';

/** an index into the `logs` array */
export type LogIdx = number;
/** fully qualified propery name (period-seperated) */
export type PropertyId = string;

export interface LogRecord {
    log: any;
    idx: LogIdx;
}

export class LogDb {
    /** this array contains all the logs, */
    public logs: LogRecord[];
    public propertyIndex:  {[flatPropertyName: string]: LogIdx[]};

    public allProperties: PropertyId[];
    public allValues: any[];

    constructor() {
        this.logs = [];
        this.propertyIndex = {};
        this.allProperties = [];
        this.allValues = [];
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
