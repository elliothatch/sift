import * as fuzzysort from 'fuzzysort';

import { concat, EMPTY, Observable, Subject } from 'rxjs';
import { delay } from 'rxjs/operators';

import { Parse } from './query';

/** an index into the `logs` array */
export type LogIdx = number;
/** fully qualified propery name (period-seperated) */
export type PropertyId = string;

export interface LogRecord {
    idx: LogIdx;
    log: any;
    index: LogRecord.Index;
}

export namespace LogRecord {
    export interface Index {
        properties: Set<PropertyId>;
        values: Map<any, Set<PropertyId>>;
    }

    export function index(logValue: any, propertyPrefixes?: string[], idx?: Index): Index {
        if(!propertyPrefixes) {
            propertyPrefixes = [];
        }

        if(!idx) {
            idx = {
                properties: new Set(),
                values: new Map(),
            }
        }

        const propertyId: PropertyId = propertyPrefixes.join('.');

        // index property
        idx.properties.add(propertyId);

        // index values
        if(Array.isArray(logValue)) {
            logValue.forEach((v, i) => {
                // index with just the property so we get broad matches on this property
                // nevermind, fuzzy match makes this work when including the index
                // index(v, propertyPrefixes!.concat([]), idx!);
                index(v, propertyPrefixes!.concat([i.toString()]), idx!);
            });
        }
        else if (typeof logValue !== 'object' || logValue == undefined) {
            const value =
                logValue === null? 'null':
                logValue === undefined? 'undefined':
                logValue.toString();

                let valueProperties = idx!.values.get(value);
                if(!valueProperties) {
                    valueProperties = new Set();
                }

                valueProperties.add(propertyId);
                idx!.values.set(value, valueProperties);
        }
        else { // is object
            Object.keys(logValue).forEach((p) => {
                index(logValue[p], propertyPrefixes!.concat([p]), idx!);
            });
        }

        return idx;
    }
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

// redelcare types we need from fuzzysort, because I can't access the types directly
export namespace Fuzzysort {
    export interface Result {
        readonly score: number;
        readonly target: string;
        readonly indexes: number[];
    }
}

export interface LogIndex {
    /** the properties/values sets this value is also used as the key into the index for that type */
    propertyIndex:  Map<PropertyId, Set<LogIdx>>;
    properties: PropertyId[];

    // TODO: fuzzysort match.target might always be a string.
    valueIndex: Map<any, Map<LogIdx, Set<PropertyId>>>;
    values: any[];
}

export namespace LogIndex {
    export function addLogRecord(record: LogRecord, logIndex: LogIndex): LogIndex {
        record.index.properties.forEach((property) => {
            addProperty(record.idx, property, logIndex);
        });

        record.index.values.forEach((propertySet, value) => {
            propertySet.forEach((property) => {
                addValue(record.idx, value, property, logIndex);
            });
        });

        return logIndex;
    }
    export function addProperty(logIdx: LogIdx, property: PropertyId, logIndex: LogIndex): LogIndex {
        let propertyLogs = logIndex.propertyIndex.get(property);
        if(!propertyLogs) {
            propertyLogs = new Set();
            logIndex.properties.push(property);
        }

        propertyLogs.add(logIdx);
        logIndex.propertyIndex.set(property, propertyLogs);

        return logIndex;
    }

    export function addValue(logIdx: LogIdx, value: any, property: PropertyId, logIndex: LogIndex): LogIndex {
        // TODO: convert value to string?
        let valueLogs = logIndex.valueIndex.get(value);
        if(!valueLogs) {
            valueLogs = new Map();
            logIndex.values.push(value);
        }

        let logProperties = valueLogs.get(logIdx);
        if(!logProperties) {
            logProperties = new Set();
        }

        logProperties.add(property);
        valueLogs.set(logIdx, logProperties);
        logIndex.valueIndex.set(value, valueLogs);

        return logIndex;
    }

    export function union(lhs: LogIndex, rhs: LogIndex): LogIndex {
        const result: LogIndex = {
            propertyIndex: new Map(),
            properties: [],
            valueIndex: new Map(),
            values: [],
        };

        for(const [property, logs] of lhs.propertyIndex) {
            result.propertyIndex.set(property, new Set(logs));
        }

        for(const [property, logs] of rhs.propertyIndex) {
            let propertyLogs = result.propertyIndex.get(property);
            if(!propertyLogs) {
                propertyLogs = new Set();
            }

            logs.forEach((log) => {
                propertyLogs!.add(log);
            });
            result.propertyIndex.set(property, propertyLogs);
        }

        // TODO: set union could be optimized
        result.properties = Array.from(new Set([...lhs.properties, ...rhs.properties]));

        for(const [value, logs] of lhs.valueIndex) {
            const newLogs = new Map();
            result.valueIndex.set(value, newLogs);
            for(const [logIdx, properties] of logs) {
                newLogs.set(logIdx, new Set(properties));
            }
        }

        for(const [value, logs] of rhs.valueIndex) {
            let valueLogs = result.valueIndex.get(value);
            if(!valueLogs) {
                valueLogs = new Map();
            }

            for(const [logIdx, properties] of logs) {
                let logProperties = valueLogs.get(logIdx);
                if(!logProperties) {
                    logProperties = new Set();
                }

                properties.forEach((property) => {
                    logProperties!.add(property);
                });

                valueLogs.set(logIdx, logProperties);
            }

            result.valueIndex.set(value, valueLogs);
        }

        // TODO: set union could be optimized
        result.values = Array.from(new Set([...lhs.values, ...rhs.values]));

        return result;
    }

}

export interface FilterMatch {
    record: LogRecord;
    matches: ResultSet.Match[];
    resultSet: ResultSet;
}

export interface ResultSet {
    /** dictionary that stores fuzzysort match information about each log. used for text highlighting */
    matches: ResultSet.MatchMap;
    index: LogIndex;
}

export namespace ResultSet {
    export type MatchMap = Map<LogIdx, {
        property: Match[];
        value: Match[];
    }>;

    export interface Match {
        logRecord: LogRecord;
        property?: {
            name: PropertyId;
            fuzzyResult: FuzzyResult;
        }
        value?: {
            property: PropertyId;
            value: any;
            fuzzyResult: FuzzyResult;
        }
    }

    export interface FuzzyResult {
        indexes: number[];
        score: number;
    }

    export function addMatch(match: Match, resultSet: ResultSet, skipIndex?: boolean): ResultSet {
        let resultMatch = resultSet.matches.get(match.logRecord.idx);
        if(!resultMatch) {
            resultMatch = {
                property: [],
                value: [],
            };
            resultSet.matches.set(match.logRecord.idx, resultMatch);
        }

        if(match.property) {
            resultMatch.property.push(match);
        }

        if(match.value) {
            resultMatch.value.push(match);
        }

        if(skipIndex) {
            LogIndex.addLogRecord(match.logRecord, resultSet.index);
        }

        return resultSet;
    }

    export function union(lhs: ResultSet, rhs: ResultSet): ResultSet {
        const result: ResultSet = {
            matches: new Map(),
            index: LogIndex.union(lhs.index, rhs.index),
        };

        for(const [logIdx, {property, value}] of lhs.matches) {
            result.matches.set(logIdx, {
                property: property.slice(),
                value: value.slice(),
            });
        }

        for(const [logIdx, {property, value}] of rhs.matches) {
            let matches = result.matches.get(logIdx);
            if(!matches) {
                matches = {
                    property: [],
                    value: [],
                };
            }

            // TODO: we may be duplicating match results here
            matches.property.push(...property);
            matches.value.push(...value);
            result.matches.set(logIdx, matches);
        }

        return result;
    }
}

export class LogDb {
    /** this array contains all the logs, */
    public logs: LogRecord[];
    public logIndex: LogIndex;

    public fuzzysortThreshold: number;

    public logSubject: Subject<LogRecord>;
    // public maxLogEntries = 1000000;

    constructor() {
        this.logs = [];
        this.logIndex = {
            propertyIndex: new Map(),
            properties: [],
            valueIndex: new Map(),
            values: [],
        };
        this.fuzzysortThreshold = -100;

        this.logSubject = new Subject();
    }

    /** parses a raw string, then records it in the database and indexes it */
    public ingest(line: string, level?: string): LogRecord {
        // if(this.logs.length > this.maxLogEntries) {
            // throw new Error('max logs');
        // }

        const log = parseLog(line);
        if(level) {
            (log as any).level = level;
        }
        const record = {
            log, 
            idx: this.logs.length,
            index: LogRecord.index(log),
        };

        this.logs.push(record);

        LogIndex.addLogRecord(record, this.logIndex);

        this.logSubject.next(record);
        return record;
    }

    // BUG: full match doesn't dowrk
    // BUG: full match with child property doesn't actually check value side of match
    public matchLog(query: Parse.Expression, record: LogRecord): ResultSet.Match[] {
        switch(query.eType) {
            case 'VALUE':
                // filtering on just a VALUE expression searches the term as a property OR value
                return this.matchLog({
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
                }, record);
            case 'EXCLUDE':
                // filtering on just an EXCLUDE expression excludes matches in the property AND value fields
                return this.matchLog({
                    eType: 'AND',
                    lhs: {
                        eType: 'MATCH',
                        mType: 'PROPERTY',
                        property: query,
                    },
                    rhs: {
                        eType: 'MATCH',
                        mType: 'VALUE',
                        value: query
                    }
                }, record);
            case 'MATCH':
                return this.evaluateMatch(query, record);
            case 'AND': {
                const lhsMatches = query.lhs?
                    this.matchLog(query.lhs, record):
                    [];

                const rhsMatches = query.rhs?
                    this.matchLog(query.rhs, record):
                    [];

                if(lhsMatches.length == 0 || rhsMatches.length == 0) {
                    return [];
                }

                return lhsMatches.concat(rhsMatches);
            }
            case 'OR': {
                const lhsMatches = query.lhs?
                    this.matchLog(query.lhs, record):
                    [];

                const rhsMatches = query.rhs?
                    this.matchLog(query.rhs, record):
                    [];

                return lhsMatches.concat(rhsMatches);
            }
            default:
                throw new Error(`Unrecognized expression: ${query}`);
        }
    }

    public evaluateMatch(matchQuery: Parse.Expression.MATCH, record: LogRecord): ResultSet.Match[] {
        if((matchQuery.mType === 'FULL' || matchQuery.mType === 'PROPERTY')
            && matchQuery.property.eType !== 'EXCLUDE') {
            return this.matchFullOrProperty(matchQuery, record);
        }
        else if((matchQuery.mType === 'FULL' || matchQuery.mType === 'VALUE')
            && matchQuery.value.eType !== 'EXCLUDE') {
            return this.matchFullOrValue(matchQuery, record);
        }
        else if(matchQuery.mType === 'FULL' || matchQuery.mType === 'ALL') {
            // both fields are excluded or match all
            return [{logRecord: record}];
        }
        else if(matchQuery.mType === 'PROPERTY') {
            return this.matchExcludeProperty(matchQuery, record);
        }
        else if(matchQuery.mType === 'VALUE') {
            return this.matchExcludeValue(matchQuery, record);
        }
        else {
            throw new Error(`evaluateMatch: unhandled match query: ${matchQuery}`);
        }
    }


    public matchFullOrProperty(matchQuery: Parse.Expression.MATCH.FULL_MATCH | Parse.Expression.MATCH.PROPERTY_MATCH, record: LogRecord): ResultSet.Match[] {
            // search by property index
            const matches: ResultSet.Match[] = [];
            for(let property of record.index.properties.values()) {
                const searchProperty = (matchQuery.property as Parse.Expression.VALUE).value;
                const propertyMatch = fuzzysort.single(searchProperty, property);
                if(!propertyMatch || propertyMatch.score < this.fuzzysortThreshold) continue;

                // TODO: match properties more precisely. fuzzy search means that we always match all the children of a property as well which isn't really what we want
                // redo the match just with the final part so we only include highlight results for the exact property, and not all its parents
                // const searchPropertyParts = searchProperty.split('.');
                // const propertyParts = property.split('.');
                // const propertyHighlightMatch = fuzzysort.single(searchPropertyParts[searchPropertyParts.length - 1], propertyParts[propertyParts.length - 1]);

                // if(!propertyHighlightMatch || propertyHighlightMatch.score < this.fuzzysortThreshold) continue;
                let match: ResultSet.Match = {
                    logRecord: record,
                    property: {
                        name: propertyMatch.target,
                        // copy the results so fuzzysort doesn't reuse the array and remove highlight data
                        fuzzyResult: {
                            indexes: propertyMatch.indexes.slice(),
                            // indexes: propertyHighlightMatch.indexes.slice(),
                            score: propertyMatch.score
                        }
                    }
                };

                if(matchQuery.mType === 'FULL') {
                    const value = getProperty(record.log, propertyMatch.target);
                    const searchValue = matchQuery.value.eType === 'VALUE'?
                        matchQuery.value.value:
                        matchQuery.value.expr.value;

                    let valueMatch = fuzzysort.single(searchValue, value.toString());
                    if(!valueMatch || valueMatch.score < this.fuzzysortThreshold) {
                        valueMatch = null;
                    }

                    if(matchQuery.value.eType === 'EXCLUDE') {
                        if(valueMatch) {
                            // no match
                            continue;
                        }
                    }
                    else if(valueMatch) {
                        match.value = {
                            property: propertyMatch.target,
                            value,
                            // copy the results so fuzzysort doesn't reuse the array and remove highlight data
                            fuzzyResult: {
                                indexes: valueMatch.indexes.slice(),
                                score: valueMatch.score
                            }
                        };
                    }
                    else {
                        continue;
                    }
                }

                matches.push(match);
            }

            return matches;
    }

    public matchFullOrValue(matchQuery: Parse.Expression.MATCH.FULL_MATCH | Parse.Expression.MATCH.VALUE_MATCH, record: LogRecord): ResultSet.Match[] {
        // search by property index
        const matches: ResultSet.Match[] = [];
        for(let [value, properties] of record.index.values.entries()) {
            const valueMatch = fuzzysort.single((matchQuery.value as Parse.Expression.VALUE).value, value);
            if(!valueMatch || valueMatch.score < this.fuzzysortThreshold) continue;

            for(let property of properties) {
                let match: ResultSet.Match = {
                    logRecord: record,
                    value: {
                        property,
                        value: valueMatch.target,
                        // copy the results so fuzzysort doesn't reuse the array and remove highlight data
                        fuzzyResult: {
                            indexes: valueMatch.indexes.slice(),
                            score: valueMatch.score
                        }
                    }
                };

                if(matchQuery.mType === 'FULL') {
                    const searchProperty = matchQuery.property.eType === 'VALUE'?
                        matchQuery.property.value:
                        matchQuery.property.expr.value;

                    let propertyMatch = fuzzysort.single(searchProperty, property);
                    if(!propertyMatch || propertyMatch.score < this.fuzzysortThreshold) {
                        propertyMatch = null;
                    }

                    if(matchQuery.property.eType === 'EXCLUDE') {
                        if(propertyMatch) {
                            // no match
                            continue;
                        }
                    }
                    else if(propertyMatch) {
                        match.property = {
                            name: property,
                            // copy the results so fuzzysort doesn't reuse the array and remove highlight data
                            fuzzyResult: {
                                indexes: propertyMatch.indexes.slice(),
                                score: propertyMatch.score
                            }
                        };
                    }
                }

                matches.push(match);
            }
        }
        return matches;
    }

    public matchExcludeProperty(matchQuery: Parse.Expression.MATCH.PROPERTY_MATCH, record: LogRecord): ResultSet.Match[] {
        for(let property of record.index.properties.values()) {
            const propertyMatch = fuzzysort.single((matchQuery.property as Parse.Expression.EXCLUDE).expr.value, property);
            if(propertyMatch && propertyMatch.score >= this.fuzzysortThreshold) {
                return [];
            }
        }

        return [{
            logRecord: record,
        }];
    }

    /** return an empty match if the log matches the value */
    public matchExcludeValue(matchQuery: Parse.Expression.MATCH.VALUE_MATCH, record: LogRecord): ResultSet.Match[] {
        for(let [value, propertySet] of record.index.values.entries()) {
            const valueMatch = fuzzysort.single((matchQuery.value as Parse.Expression.EXCLUDE).expr.value, value);
            if(valueMatch && valueMatch.score >= this.fuzzysortThreshold) {
                return [];
            }
        }

        return [{
            logRecord: record,
        }];
    }

    public filterAll(query: Parse.Expression): Observable<FilterMatch> {
        const filteredResultSet: ResultSet = {
            matches: new Map(),
            index: {
                propertyIndex:  new Map(),
                properties: [],
                valueIndex: new Map(),
                values: [],
            }
        };

        const _this = this;
        function batchFilter(startIndex: number, batchSize: number): Observable<FilterMatch> {
            return concat(
                new Observable<FilterMatch>((subscriber) => {
                    for(let i = 0; i < batchSize; i++) {
                        const index = startIndex - i;
                        if(index < 0) {
                            break;
                        }

                        const record = _this.logs[index];
                        const matches = _this.matchLog(query, record);
                        matches.forEach((match) => ResultSet.addMatch(match, filteredResultSet, true))

                        if(matches.length === 0) {
                            continue;
                        }

                        subscriber.next({
                            record,
                            matches,
                            resultSet: filteredResultSet
                        });
                    }

                    subscriber.complete();
                }).pipe(delay(0)), // allow interruption
                startIndex - batchSize >= 0?
                    batchFilter(startIndex - batchSize, batchSize):
                    EMPTY
            );
        }

        // batched to allow interruption during large searches
        //TODO: is batch scaling really doing anything?
        const batchSize = Math.max(150, Math.min(1000, Math.floor(this.logs.length * 0.05)));
        return batchFilter(this.logs.length - 1, batchSize);
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

    // if the root log is parsable as json, but is not an object, wrap it in an object
    // TODO: maybe we should deal with this in the display instead of messing with inputs
    if(typeof log !== 'object' || log == null) {
        return {
            level: 'info',
            message: log
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
export function getProperty(obj: {[property: string]: any}, property: PropertyId): any {
    if(!obj) {
        return undefined;
    }

    const properties = property.split('.');
    const value = obj[properties[0]];
    if(properties.length === 1) {
        return value;
    }

    return getProperty(value, properties.slice(1).join('.'));
}
