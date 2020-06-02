import {Readable} from 'stream';
import * as fuzzysort from 'fuzzysort';

import { concat, EMPTY, from, merge, Observable, Subject, of, forkJoin, timer, defer } from 'rxjs';
import { map, mergeMap, filter, toArray, tap, delay } from 'rxjs/operators';

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
        // TODO: index arrays and object values themselves, rather than just their children (support query specific values in array, object structures
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
            logValue.forEach((v) => {
                const value =
                    v === null? 'null':
                    v === undefined? 'undefined':
                    v.toString();

                let valueProperties = idx!.values.get(value);
                if(!valueProperties) {
                    valueProperties = new Set();
                }

                valueProperties.add(propertyId);
                idx!.values.set(value, valueProperties);
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
            fuzzyResult: Fuzzysort.Result;
        }
        value?: {
            property: PropertyId;
            value: any;
            fuzzyResult: Fuzzysort.Result;
        }
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
        // filterSingleLog(queryTextBuffer.getText(), logOffset, indexResults.properties, indexResults.values);

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
            throw new Error(`filterMatch: unhandled match query: ${matchQuery}`);
        }
    }


    public matchFullOrProperty(matchQuery: Parse.Expression.MATCH.FULL_MATCH | Parse.Expression.MATCH.PROPERTY_MATCH, record: LogRecord): ResultSet.Match[] {
            // search by property index
            const matches: ResultSet.Match[] = [];
            for(let property of record.index.properties.values()) {
                const propertyMatch = fuzzysort.single((matchQuery.property as Parse.Expression.VALUE).value, property);
                if(!propertyMatch || propertyMatch.score < this.fuzzysortThreshold) continue;

                let match: ResultSet.Match = {
                    logRecord: record,
                    property: {
                        name: propertyMatch.target,
                        fuzzyResult: propertyMatch,
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
                            fuzzyResult: valueMatch,
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
                        fuzzyResult: valueMatch,
                    }
                };

                if(matchQuery.mType === 'FULL') {
                    const searchProperty = matchQuery.value.eType === 'VALUE'?
                        matchQuery.value.value:
                        matchQuery.value.expr.value;

                    let propertyMatch = fuzzysort.single(searchProperty, property);
                    if(!propertyMatch || propertyMatch.score < this.fuzzysortThreshold) {
                        propertyMatch = null;
                    }

                    if(matchQuery.value.eType === 'EXCLUDE') {
                        if(propertyMatch) {
                            // no match
                            continue;
                        }
                    }
                    else if(propertyMatch) {
                        match.property = {
                            name: property,
                            fuzzyResult: propertyMatch,
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
                return [{
                    logRecord: record,
                }];
            }
        }

        return [];
    }

    /** return an empty match if the log matches the value */
    public matchExcludeValue(matchQuery: Parse.Expression.MATCH.VALUE_MATCH, record: LogRecord): ResultSet.Match[] {
        for(let [value, properties] of record.index.properties.values()) {
            const valueMatch = fuzzysort.single((matchQuery.value as Parse.Expression.EXCLUDE).expr.value, value);
            if(valueMatch && valueMatch.score >= this.fuzzysortThreshold) {
                return [{
                    logRecord: record,
                }];
            }
        }

        return [];
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

    public filterOne(query: Parse.Expression, record: LogRecord): Observable<ResultSet> {
        const searchSet = {
            matches: new Map(),
            index: {
                propertyIndex: new Map(),
                properties: [],
                valueIndex: new Map(),
                values: [],
            }
        };

        LogIndex.addLogRecord(record, searchSet.index);
        return this.filter(query, searchSet);
    }

    // TODO: return an observable of Result instead of resultset, so we can stream each match in as its found. this requires knowing that there are no more AND clauses that a particular log might be filtered by. generally a different approach to how we handle query execution, and will require some reworking
    // TODO: we need to change how the logs are added to the result set.
    // filtering large amounts of logs becomes extremely slow 
    public filter(query: Parse.Expression, searchSet?: ResultSet): Observable<ResultSet> {
        if(!searchSet) {
            searchSet = {
                matches: new Map(),
                index: this.logIndex,
            };
        }

        switch(query.eType) {
            case 'VALUE':
                // filtering on just a VALUE expression searches the term as a property OR value
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
                // filtering on just an EXCLUDE expression excludes matches in the property AND value fields
                return this.filter({
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
                }, searchSet);
            case 'MATCH':
                return this.filterMatch(query, searchSet);
            case 'AND':
                // return the intersection of results
                return query.lhs?
                    this.filter(query.lhs, searchSet):
                    of(searchSet)
                .pipe(
                    mergeMap((resultSet) => {
                        return query.rhs?
                            this.filter(query.rhs, resultSet):
                            of(resultSet);
                    })
                );
            case 'OR': {
                // return the union of results
                const lhsResultSet = query.lhs?
                    this.filter(query.lhs, searchSet):
                    of(searchSet);
                const rhsResultSet = query.rhs?
                    this.filter(query.rhs, searchSet):
                    of(searchSet);

                return forkJoin(lhsResultSet, rhsResultSet).pipe(
                    map(([lhs, rhs]) => {
                        if(lhs === rhs) {
                            return lhs;
                        }

                        return ResultSet.union(lhs, rhs);
                    })
                );
            }
            default:
                throw new Error(`Unrecognized expression: ${query}`);
        }
    }

    // filter MATCH steps
    // for each MATCH in the filter, in the remaining result set:
    // 1. evaluate FULL MATCHES that may include exclude clauses, and PROPERTY and VALUE matches that do not contain an exclude
    // 2. evaluate PROPERTY and VALUE matches that contain an EXCLUDE.
    public filterMatch(matchQuery: Parse.Expression.MATCH, searchSet: ResultSet): Observable<ResultSet> {
        let matches: Observable<ResultSet.Match>;
        if(matchQuery.mType === 'ALL') {
            return of(searchSet);
        }
        else if((matchQuery.mType === 'FULL' || matchQuery.mType === 'PROPERTY')
            && matchQuery.property.eType !== 'EXCLUDE') {
            // search by property index
            matches = from(fuzzysort.goAsync(matchQuery.property.value, searchSet.index.properties, {
                // limit: 100,
                threshold: this.fuzzysortThreshold,
            })).pipe(
                mergeMap(from),
                mergeMap((propertyMatch) => {
                    const matchedLogs = searchSet.index.propertyIndex.get(propertyMatch.target);
                    if(!matchedLogs) {
                        throw new Error(`filterMatch: The property '${propertyMatch.target}' was matched by fuzzysort, but was not found in the index. This should not happen, and means the index got into an invalid state due to a bug.`);
                    }

                    const matches = Array.from(matchedLogs).map((logIdx) => {
                        const log = this.logs[logIdx];
                        let match: ResultSet.Match = {
                            logRecord: log,
                            property: {
                                name: propertyMatch.target,
                                fuzzyResult: propertyMatch,
                            }
                        };

                        if(matchQuery.mType === 'FULL') {
                            const value = getProperty(log, propertyMatch.target);
                            const searchValue = matchQuery.value.eType === 'VALUE'?
                                matchQuery.value.value:
                                matchQuery.value.expr.value;
                            const valueMatch = fuzzysort.go(searchValue, [value], {threshold: this.fuzzysortThreshold});
                            if(matchQuery.value.eType === 'EXCLUDE') {
                                if(valueMatch.length > 0) {
                                    // no match
                                    return;
                                }
                            }
                            else if(valueMatch.length > 0) {
                                match.value = {
                                    property: propertyMatch.target,
                                    value,
                                    fuzzyResult: valueMatch[0],
                                };
                            }
                        }

                        return match;
                    }).filter((match): match is ResultSet.Match => match != undefined);

                    return from(matches);
                })
            );
        }
        else if((matchQuery.mType === 'FULL' || matchQuery.mType === 'VALUE')
            && matchQuery.value.eType !== 'EXCLUDE') {
            // search by value index
            matches = from(fuzzysort.goAsync(matchQuery.value.value, searchSet.index.values, {
                // limit: 100,
                threshold: this.fuzzysortThreshold,
            })).pipe(
                mergeMap(from),
                mergeMap((valueMatch) => {
                    const matchedLogs = searchSet.index.valueIndex.get(valueMatch.target);
                    if(!matchedLogs) {
                        throw new Error(`filterMatch: The value '${valueMatch.target}' was matched by fuzzysort, but was not found in the index. This should not happen, and means the index got into an invalid state due to a bug.`);
                    }

                    const matches = Array.from(matchedLogs).reduce((logMatches, [logIdx, propertySet]) => {
                        const newLogMatches = Array.from(propertySet).map((property) => {
                            let match: ResultSet.Match = {
                                logRecord: this.logs[logIdx],
                                value: {
                                    property,
                                    value: valueMatch.target,
                                    fuzzyResult: valueMatch,
                                }
                            };

                            if(matchQuery.mType === 'FULL') {
                                const searchProperty = matchQuery.property.eType === 'VALUE'?
                                    matchQuery.property.value:
                                    matchQuery.property.expr.value;

                                const propertyMatch = fuzzysort.go(searchProperty, [property], {threshold: this.fuzzysortThreshold});
                                if(matchQuery.property.eType === 'EXCLUDE') {
                                    if(propertyMatch.length > 0) {
                                        // no match
                                        return;
                                    }
                                }
                                else if(propertyMatch.length > 0) {
                                    match.property = {
                                        name: property,
                                        fuzzyResult: propertyMatch[0],
                                    };
                                }
                            }

                            return match;
                        }).filter((match): match is ResultSet.Match => match != undefined);

                        logMatches.push(...newLogMatches);
                        return logMatches;
                    }, [] as ResultSet.Match[]);

                    return from(matches);
                })
            );
        }
        else if(matchQuery.mType === 'FULL') {
            // both fields are excluded
            // this query doesn't make any sense, don't do anything
            return of(searchSet);
        }
        else if(matchQuery.mType === 'PROPERTY') {
            // must be an exclude property
            matches = from(fuzzysort.goAsync((matchQuery.property as Parse.Expression.EXCLUDE).expr.value, searchSet.index.properties, {
                // limit: 100,
                threshold: this.fuzzysortThreshold,
            })).pipe(
                mergeMap((propertyMatches) => {
                    const excludes = propertyMatches.reduce((excludes, propertyMatch) => {
                        const matchedLogs = searchSet.index.propertyIndex.get(propertyMatch.target);
                        if(!matchedLogs) {
                            throw new Error(`filterMatch: The property '${propertyMatch.target}' was matched by fuzzysort, but was not found in the index. This should not happen, and means the index got into an invalid state due to a bug.`);
                        }

                        matchedLogs.forEach((logIdx) => {
                            excludes.add(logIdx);
                        });

                        return excludes;
                    }, new Set<LogIdx>());

                    const matches: ResultSet.Match[] = [];
                    for(let i = 0; i < this.logs.length; i++) {
                        const log = this.logs[i];
                        if(!excludes.has(log.idx)) {
                            matches.push({
                                logRecord: log,
                            });
                        }
                    }

                    return from(matches);
                }),
            );
        }
        else if(matchQuery.mType === 'VALUE') {
            // must be an exclude value
            matches = from(fuzzysort.goAsync((matchQuery.value as Parse.Expression.EXCLUDE).expr.value, searchSet.index.values, {
                // limit: 100,
                threshold: this.fuzzysortThreshold,
            })).pipe(
                mergeMap((valueMatches) => {
                    const excludes = valueMatches.reduce((excludes, valueMatch) => {
                        const matchedLogs = searchSet.index.valueIndex.get(valueMatch.target);
                        if(!matchedLogs) {
                            throw new Error(`filterMatch: The value '${valueMatch.target}' was matched by fuzzysort, but was not found in the index. This should not happen, and means the index got into an invalid state due to a bug.`);
                        }

                        for(const logIdx of matchedLogs.keys()) {
                            excludes.add(logIdx);
                        }

                        return excludes;
                    }, new Set<LogIdx>());

                    const matches: ResultSet.Match[] = [];
                    for(let i = 0; i < this.logs.length; i++) {
                        const log = this.logs[i];
                        if(!excludes.has(log.idx)) {
                            matches.push({
                                logRecord: log,
                            });
                        }
                    }

                    return from(matches);
                }),
            );
        }
        else {
            throw new Error(`filterMatch: unhandled match query: ${matchQuery}`);
        }

        return matches.pipe(
            toArray(),
            map((matches) => {
                return matches.reduce((resultSet, match) => {
                    return ResultSet.addMatch(match, resultSet);
                }, {
                    matches: new Map(),
                    index: {
                        propertyIndex:  new Map(),
                        properties: [],
                        valueIndex: new Map(),
                        values: [],
                    }
                } as ResultSet);
            })
        );
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

    /*
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
    */
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
function getProperty(obj: {[property: string]: any}, property: PropertyId): any {
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
