#!/usr/bin/env node
const readline = require('readline');
const colors = require('colors/safe');
const child_process = require('child_process');
const Path = require('path');

const fuzzysort = require('fuzzysort');
const termkit = require('terminal-kit');

const levelColors = {
    info: 'bold',
    warn: 'yellow',
    error: 'red',
};

// TODO: help page
// TODO: infintie scroll. store scroll position data separately from terminal-kit. only print lines that are visible on the screen
// TODO: command to display and fuzzy search all properties and values
// TODO: query history
// TODO: improved status display
// TODO: make fuzzyfind async, display spinner

const freshr = child_process.spawn(
    'node',
    [Path.join(__dirname, '..', 'demo', 'server', 'build', 'index.js'), '--', ...process.argv.slice(1)]);
    // [Path.join(__dirname, 'dev.test.js'), '--', ...process.argv.slice(1)]);

let freshrRunning = true;

// process.stdin.pipe(freshr.stdin);
// freshr.stderr.pipe(process.stderr);

const freshrLogs = readline.createInterface({
    input: freshr.stdout,
    output: process.stdout,
    terminal: false
});

const freshrErrors = readline.createInterface({
    input: freshr.stderr,
    output: process.stderr,
    terminal: false
});

const term = termkit.terminal;
term.fullscreen(true);
term.grabInput();

const screenBuffer = new termkit.ScreenBuffer({
	dst: term,
	x: 1,
	y: 1,
});

const resultsPanelBuffer = new termkit.ScreenBuffer({
	dst: screenBuffer,
	height: screenBuffer.height - 2,
});

const queryPanelBuffer = new termkit.ScreenBuffer({
	dst: screenBuffer,
	y: screenBuffer.height - 1,
	height: 1
});

const gutterBufferWidth = 5;

const resultsBuffer = new termkit.TextBuffer({
	dst: resultsPanelBuffer,
	x: 5,
	y: 0,
	width: resultsPanelBuffer.width - gutterBufferWidth,
	// height: screenBuffer.height - 2,
	forceInBound: true,
});

const gutterBuffer = new termkit.TextBuffer({
	dst: resultsPanelBuffer,
	x: 0,
	y: 0,
	width: gutterBufferWidth,
	// height: screenBuffer.height - 2,
});

const statusBuffer = new termkit.TextBuffer({
	dst: screenBuffer,
	x: 2,
	y: screenBuffer.height - 2,
	width: screenBuffer.width - 2,
	height: 1,
});

// const queryTextBufferWidth = 30;
const queryTextBuffer = new termkit.TextBuffer({
	dst: queryPanelBuffer,
	x: 2,
	// width: queryTextBufferWidth,
});

// const parsedQueryTextBuffer = new termkit.TextBuffer({
// 	dst: queryPanelBuffer,
// 	x: 2 + queryTextBufferWidth,
// 	width: queryPanelBuffer.width - (2+queryTextBufferWidth),
// });

function draw() {
	queryTextBuffer.draw();
	// parsedQueryTextBuffer.draw();
	queryPanelBuffer.draw();
	screenBuffer.draw();

	queryTextBuffer.drawCursor();
	// parsedQueryTextBuffer.drawCursor();
	queryPanelBuffer.drawCursor();
	screenBuffer.drawCursor();
}

queryPanelBuffer.put({
	x: 0,
	y: 0,
	// attr: {},
}, '>');
queryTextBuffer.moveTo(0, 0);
draw();

const displayOptions = {
	json: false,
};

term.on('key', (name, matches, data) => {
	try {
		if(name === 'CTRL_C') {
			if(freshrRunning) {
				freshr.kill();
			}
			else {
				term.fullscreen(false);
				process.exit();
			}
		}

		// if(name === 'UP') {
		// }
		// else if(name === 'DOWN') {
		// }
		if(name === 'LEFT') {
			queryTextBuffer.moveBackward();
			draw();
		}
		else if(name === 'RIGHT') {
			// term.getCursorLocation().then(({x, y}) => {
				if(queryTextBuffer.cx <= queryTextBuffer.getContentSize().width) {
					queryTextBuffer.moveForward();
					draw();
				}
			// });
		}
		else if(name === 'TAB') {
			displayOptions.json = !displayOptions.json;
			filterLogs(queryTextBuffer.getText());
		}
		else if(name === 'HOME') {
			resultsBuffer.y = 0;
			gutterBuffer.y = 0;
			drawResults();
		}
		else if(name === 'END') {
			resultsBuffer.y = -resultsBuffer.cy + screenBuffer.height - 2;
			gutterBuffer.y = -gutterBuffer.cy + screenBuffer.height - 2;
			drawResults();
		}
		else if(name === 'PAGE_UP') {
			resultsBuffer.y = Math.min(resultsBuffer.y + 12, 0);
			gutterBuffer.y = Math.min(gutterBuffer.y+12, 0);
			drawResults();
		}
		else if(name === 'PAGE_DOWN') {
			resultsBuffer.y = Math.max(resultsBuffer.y - 12, -resultsBuffer.cy + screenBuffer.height - 2);
			gutterBuffer.y = Math.max(gutterBuffer.y-12, -gutterBuffer.cy + screenBuffer.height - 2);
			resultsPanelBuffer.fill({char: ' '});
			drawResults();
		}
		else if(name === 'ESCAPE') {
			queryTextBuffer.backDelete(queryTextBuffer.cx);
			filterLogs(queryTextBuffer.getText());
			draw();
		}
		else if(name === 'BACKSPACE') {
			queryTextBuffer.backDelete(1);
			filterLogs(queryTextBuffer.getText());
			draw();
		}
		else if(name === 'DELETE') {
			queryTextBuffer.delete(1);
			filterLogs(queryTextBuffer.getText());
			draw();
		}
		else if(data.isCharacter) {
			queryTextBuffer.insert(name);
			filterLogs(queryTextBuffer.getText());
			draw();
		}
	}
	catch(err) {
		term.fullscreen(false);
        console.error(err);
        freshr.kill();
	}
});

/** Interactive log filtering
 * typing automatically starts the filtering. ex:
 *     format: property-selector:value-selector
 *
 *     property (level): shows all logs containing "property" at any nesting
 *     'property ('level): shows all logs containing "property" at top level
 *     property:value (level:info): shows all logs where "property" at any nesting has value that fuzzy matches "value"
 *     property:'value (level:'info): shows all logs where "property" at any testing has value that substring matches "value"
 *     'property:value ('level:info): shows all logs where "property" at top level has value that fuzzy-matches "value"
 *     property.child (error.stack): shows all logs containing "property" at any nesting with "child" property, edge
 *     'property.child ('error.stack): shows all logs containing "property" at top level with "child" property
 *     !property:value (!timestamp:2019): exclude property from being considered in value search. logs containing this property may still be shown
 *     property:!value (level:!trace): exclude documents where "value" matches the searched property's value
 */

/** array of { log: object, index: */
const logs = [];

/** maps all properties to a flattened index. values are arrays of indexes into the logs array */
const logIndex = {};


const indexProperties = [];

/** array of objects for each unique value in the logs, along with property and origin info
 *  - value (string): value string we are searching
 *  - property (string): id of properties this value appears in
 */
const logValues = [];

freshr.on('close', (code, signal) => {
	freshrRunning = false;
	parseLog(JSON.stringify({
		level: 'warn',
		message: 'Process exited. Press CTRL_C to exit.',
		code,
		signal
	}) + '\n');
});

freshrLogs.on('error', (err) => {
	parseLog(JSON.stringify({
		level: 'error',
		message: 'Process exited with error. Press CTRL_C to exit.',
		error: err
	}) + '\n');
});

function parseLog(line) {
    try {
    	let log;
    	try {
			log = JSON.parse(line);
		}
		catch(e) {
			log = {
				level: 'info',
				message: line
			};
		}
		/*
		const originalLog = Object.assign({}, log); // this copy is safe as long as we only modify the top level for printing purposes

        // we don't care about some fields when pretty printing
        delete log.pid;
        var output = '';
        if(log.message) {
            output += log.message;
        }
        if(log.level) {
            output = '[' + log.level + '] ' + output;
            var color = levelColors[log.level];
            if(color) {
                // color the level name and message
                output = term[color]().str(output);
            }
        }
        // prefix with dim timestamp
        if(log.timestamp) {
            output = term.dim().str(('[' + log.timestamp + ']')) + output;
        }

        // add the other fields as formatted json
        delete log.level;
        delete log.message;
        delete log.timestamp;
        if(Object.keys(log).length > 0) {
            output += '\n' + term.dim().str(JSON.stringify(log, null, 4));
        }
        // console.log(output);

		*/
		const logOffset = logs.length;
		logs.push({
			log,
		});

		const indexResults = indexLog(log, logOffset);
		filterSingleLog(queryTextBuffer.getText(), logOffset, indexResults.properties, indexResults.values);
		// filterLogs(queryTextBuffer.getText());
		// const findPropertyResults = fuzzysort.go('level', indexProperties, {
		// 	limit: 100,
		// 	threshold: -10000
		// });

		// const findValueResults = fuzzysort.go('commonjs', logValues, {
		// 	key: 'value',
		// 	limit: 100,
		// 	threshold: -10000,
		// });
		// console.log(findPropertyResults.length, findValueResults.length);
		// findPropertyResults.forEach((result) => {
		// 	logIndex[result.target].forEach((logOffset) => {
		// 		console.log(logs[logOffset].output);
		// 	});
		// });
		// findValueResults.forEach((result) => {
			// logIndex[result.obj.property].forEach((logOffset) => {
				// console.log(logs[logOffset].output);
			// });
		// });

    }
    catch(err) {
		term.fullscreen(false);
        console.error(err);
        freshr.kill();
    }
}

freshrLogs.on('line', function(line) {
	parseLog(line);
});

freshrErrors.on('line', function(line) {
    try {
		const log = {
			level: line.match(/warn/i)? 'warn': 'error',
			message: line,
		};
		const logOffset = logs.length;
		logs.push({
			log,
		});

		const indexResults = indexLog(log, logOffset);
		filterSingleLog(queryTextBuffer.getText(), logOffset, indexResults.properties, indexResults.values);
    }
    catch(err) {
		term.fullscreen(false);
        console.error(err);
        freshr.kill();
    }
});

function indexLog(log, logOffset, propertyPrefixes) {
	if(!propertyPrefixes) {
		propertyPrefixes = [];
	}

	const properties = [];
	const values = []; 

	if (typeof log !== 'object' || !log) {
		// index property
		const propertyId = propertyPrefixes.join('.');
		if(!logIndex[propertyId]) {
			indexProperties.push(propertyId);
			logIndex[propertyId] = [];
		}
		properties.push(propertyId);
		logIndex[propertyId].push(logOffset);

		// index value
		if(Array.isArray(log)) {
			log.forEach((v) => {
				const value =
					v === null? 'null':
					v === undefined? 'undefined':
					v.toString();

				values.push({
					value,
					property: propertyId,
					logOffset
				});
			});
		}
		else {
			const value =
				log === null? 'null':
				log === undefined? 'undefined':
				log.toString();
				
			values.push({
				value,
				property: propertyId,
				logOffset
			});
		}

		// indexProperties.push(...properties);
		// logValues.push(...values);
		return {
			properties,
			values
		};
	}

	const fields = Object.keys(log).reduce((obj, p) => {
		const results = indexLog(log[p], logOffset, propertyPrefixes.concat([p]));
		obj.properties.push(...results.properties);
		obj.values.push(...results.values);
		return obj;
	}, {properties: [], values: []});

	logValues.push(...fields.values);
	return fields;
}

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

/** Gets a property from an object if it exists. Supports nested properties
 * @argument obj - root object
 * @argument propertyName - name of the property to retrieved. Nested properties are specified with dot notation ('a.b.c')
 */
function getProperty(obj, propertyName) {
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

function parseQuery(query) {
	const queryParts = query.split(':');
	const output = {};
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

function filterLogs(query) {
	const matchedLogs = query.length > 0 && query !== ':'? 
		findMatchingLogs(query, indexProperties, logValues):
		logs.map((log, i) => ({log: log.log, offset: i, propertySearchResults: [], valueSearchResults: []}));
	// const matchedLogs = query.length === 0? 
	// logs.slice(-logLimit).map((log, i) => ({log: log.log, offset: Math.max(0, logs.length - logLimit) + i, propertySearchResults: [], valueSearchResults: []})):
	// findMatchingLogs(query, indexProperties, logValues).slice(-logLimit);

	// if(query.length > 0) {
	// debugger;
	// }

	// parsedQueryTextBuffer.backDelete(parsedQueryTextBuffer.cx);
	// parsedQueryTextBuffer.insert(`${queryParts[0]}`, {color: 'red'});

	// parsedQueryTextBuffer.moveRight();
	// parsedQueryTextBuffer.insert(`${queryParts[1]}`, {color: 'blue'});

	// const matchedLogs = query.length !== 0 && query !== ':'?
	// 	Array.from(logOffsets.values()).sort().slice(-logLimit).map((logOffset) => ({log: logs[logOffset].log, offset: logOffset})):
	// 	logs.slice(-logLimit).map((log, i) => ({log: log.log, offset: Math.max(0, logs.length - logLimit) + i}));

	statusBuffer.backDelete(statusBuffer.cx);
	if(query.length === 0) {
		statusBuffer.insert(`${logs.length}/${logs.length}`);
	}
	else {
		statusBuffer.insert(`${matchedLogs.length}/${logs.length}`);
		/*
		if(findPropertyResults) {
			statusBuffer.moveRight();
			statusBuffer.insert(`${findPropertyResults.length}`, {color: 'red'});
		}
		if(findValueResults) {
			statusBuffer.moveRight();
			statusBuffer.insert(`${findValueResults.length}`, {color: 'blue'});
		}
		*/
	}
	resultsPanelBuffer.fill({char: ' '});
	resultsBuffer.moveTo(0, 0);
	// resultsBuffer.setText('');
	gutterBuffer.moveTo(0, 0);
	// gutterBuffer.setText('');
	// resultsBuffer.buffer[0] = [];
	// resultsBuffer.buffer.length = 1;
	// gutterBuffer.buffer[0] = [];
	// gutterBuffer.buffer.length = 1;

	// only print recent logs
	const logLimit = displayOptions.json? 100: 1000;

	matchedLogs.slice(-logLimit).forEach((logMatch) => {
		printLog(logMatch);
	});

	const resultsLineOffset = logs.length;

	resultsBuffer.y = -resultsBuffer.cy + screenBuffer.height - 2 ;
	gutterBuffer.y = -gutterBuffer.cy + screenBuffer.height - 2 ;

	// resultsBuffer.setText(matchedLogs.join('\n'));
	drawResults();

	// resultsBuffer.draw();
	// statusBuffer.draw();
	// gutterBuffer.draw();
	// screenBuffer.draw();

	// resultsBuffer.drawCursor();
	// screenBuffer.drawCursor();
	// gutterBuffer.drawCursor();
	// screenBuffer.drawCursor();

	// queryTextBuffer.drawCursor();
	// screenBuffer.drawCursor();
}

function drawResults() {
	resultsBuffer.draw({
		dstClipRect: new termkit.Rect({
			xmin: 0,
			xmax: resultsBuffer.width,
			ymin: 0,
			ymax: screenBuffer.height - 3
		})
	});

	gutterBuffer.draw({
		dstClipRect: new termkit.Rect({
			xmin: 0,
			xmax: gutterBuffer.width,
			ymin: 0,
			ymax: screenBuffer.height - 3
		})
	});
	resultsPanelBuffer.draw();
	statusBuffer.draw();
	screenBuffer.draw();
}

function printLog({log, offset, propertySearchResults, valueSearchResults}) {
	let color = levelColors[log.level];
	// resultsBuffer.insert(offset.toString(), {color, dim: true});
	if((offset+1) % 10 === 0) {
		gutterBuffer.insert((offset+1).toString(), {color: 'blue'});
	}
	else {
		gutterBuffer.insert((offset+1).toString());
	}

	// prefix with dim timestamp
	if(log.timestamp) {

		const matchingValueResults = valueSearchResults.filter((valueResult) => valueResult.target === log.timestamp);
		const highlightIndexes = matchingValueResults.length > 0? matchingValueResults[0].indexes: [];
		resultsBuffer.insert('[', {color, dim: true});
		printHighlightedResult(log.timestamp, highlightIndexes, {color, dim: true}, {color: 'blue'});
		resultsBuffer.insert(']', {color, dim: true});
		// resultsBuffer.insert(`[${log.timestamp}]`, {color, dim: true});
	}

	if(log.level) {
		const matchingValueResults = valueSearchResults.filter((valueResult) => valueResult.target === log.level);
		const highlightIndexes = matchingValueResults.length > 0? matchingValueResults[0].indexes: [];
		resultsBuffer.insert('[', {color, dim: true});
		printHighlightedResult(log.level, highlightIndexes, {color, dim: true}, {color: 'blue'});
		resultsBuffer.insert(']', {color, dim: true});
		// resultsBuffer.insert(`[${log.level}] `, {color, dim: true});
	}

	if(log.message) {
		const matchingValueResults = valueSearchResults.filter((valueResult) => valueResult.target === log.message);
		const highlightIndexes = matchingValueResults.length > 0? matchingValueResults[0].indexes: [];
		printHighlightedResult(`${log.message}`, highlightIndexes, {color}, {color: 'blue'});
		// resultsBuffer.insert(`${log.message}`, {color});
	}

	const logJson = Object.assign({}, log); // this copy is safe as long as we only modify the top level for printing purposes

	// don't include some fields in json printout
	delete logJson.level;
	delete logJson.message;
	delete logJson.pid;
	delete logJson.timestamp;

	if(displayOptions.json && Object.keys(logJson).length > 0) {
		resultsBuffer.newLine();
		gutterBuffer.newLine();
		const jsonLineCount = printLogJson({log: logJson, propertySearchResults, valueSearchResults});
		// const logJsonStr = JSON.stringify(logJson, null, 4);
		// resultsBuffer.insert(logJsonStr, {dim: true});

		// const jsonLineCount = logJsonStr.split('\n').length - 1;
		for(let i = 0; i < jsonLineCount; i++) {
			gutterBuffer.newLine();
		}
	}
	resultsBuffer.newLine();
	gutterBuffer.newLine();
}

const jsonIndentStr = ' '.repeat(4);
function printLogJson({log, propertySearchResults, valueSearchResults}, propertyPath) {
	let linesPrinted = 0;
	if(!propertyPath) {
		propertyPath = [];
	}

	const style = {dim: true};

	if(typeof log === 'undefined') {
		log = 'undefined';
	}

	if(log === null) {
		log = 'null';
	}

	if(typeof log === 'string' || typeof log === 'number') {
		const isString = typeof log === 'string';
		if(isString) {
			resultsBuffer.insert('"', style);
		}

		const matchingValueResults = valueSearchResults.filter((valueResult) => valueResult.target === log.toString());
		const highlightIndexes = matchingValueResults.length > 0? matchingValueResults[0].indexes: [];
		printHighlightedResult(log.toString(), highlightIndexes, style, {color: 'blue'});

		if(isString) {
			resultsBuffer.insert('"', style);
		}
	}
	else if(Array.isArray(log)) {
		resultsBuffer.insert('[', style);
		if(log.length > 0) {
			resultsBuffer.newLine();
			linesPrinted++;
		}
		log.forEach((value, index) => {
			resultsBuffer.insert(jsonIndentStr.repeat(propertyPath.length + 1), style);

			linesPrinted += printLogJson({
				log: value,
				propertySearchResults,
				valueSearchResults,
			}, propertyPath.concat([index.toString()]));

			if(index < log.length - 1) {
				resultsBuffer.insert(',', style);
				resultsBuffer.newLine();
				linesPrinted++;
			}
			else if(log.length > 0) {
				resultsBuffer.newLine();
				linesPrinted++;
				resultsBuffer.insert(jsonIndentStr.repeat(propertyPath.length), style);
			}
		});
		resultsBuffer.insert(']', style);
	}
	else if(typeof log === 'object') {
		resultsBuffer.insert('{', style);
		resultsBuffer.newLine();
		linesPrinted++;
		Object.keys(log).forEach((prop, index) => {
			const value = log[prop];

			let propertyIdPrefix = propertyPath.join('.');
			if(propertyPath.length !== 0) {
				propertyIdPrefix += '.';
			}

			const propertyId = propertyIdPrefix + prop;
			const matchingPropertyResults = propertySearchResults.filter((propertyResult) => propertyResult.target.split('.')[propertyPath.length] === prop);

			// indent
			resultsBuffer.insert(jsonIndentStr.repeat(propertyPath.length + 1), style);

			// print property
			resultsBuffer.insert('"', style);
			if(matchingPropertyResults.length === 0) {
				resultsBuffer.insert(prop, style);
			}
			else {
				const highlightIndex = matchingPropertyResults[0].indexes.map((i) => i - propertyIdPrefix.length).filter((i) => i >= 0 && i < prop.length);
				printHighlightedResult(prop, highlightIndex, style, {color: 'red'});
			}
			resultsBuffer.insert('": ', style);

			// print value
			linesPrinted += printLogJson({
				log: value,
				propertySearchResults,
				valueSearchResults,
			}, propertyPath.concat([prop]));

			if(index < Object.keys(log).length - 1) {
				resultsBuffer.insert(',', style);
			}
			resultsBuffer.newLine();
			linesPrinted++;
		});
		resultsBuffer.insert(jsonIndentStr.repeat(propertyPath.length), style);
		resultsBuffer.insert('}', style);
	}

	return linesPrinted;
}

function printHighlightedResult(str, highlightIndexes, style, highlightStyle) {
	for(let i = 0; i < str.length; i++) {
		if(highlightIndexes.includes(i)) {
			resultsBuffer.insert(str[i], highlightStyle);
		}
		else {
			resultsBuffer.insert(str[i], style);
		}
	}
}
