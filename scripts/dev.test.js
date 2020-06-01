#!/usr/bin/env node
const freshlog = require('freshlog');
const rxjs = require('rxjs');

const logMode = 1;
const logDelay = 5;
const initialTreeDepth = 3;

const messageNouns = [
	'query',
	'request',
	'permissions',
	'record',
	'profile',
	'user',
];

const messageVerbs = [
	'started',
	'complete',
	'failed',
	'granted',
	'entered',
	'scanned',
	'ignored'
];

var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function randomString(length) {
	let result = '';
	for ( var i = 0; i < length; i++ ) {
		result += characters.charAt(Math.floor(Math.random() * characters.length));
	}
	return result;
}

function generateRandomTree(depth) {
	if(depth < 0) {
		return undefined;
	}

	return {
		data: Math.floor(Math.random() * 10000000),
		name: randomString(Math.floor(Math.random() * 8)),
		depth,
		special: depth%3 === 0? true: undefined,
		left: generateRandomTree(depth - 1 - Math.floor(Math.random()*2)),
		right: generateRandomTree(depth - 1 - Math.floor(Math.random()*2))
	};
}

function generateRandomArray(items) {
	const arr = [];
	for(let i = 0; i < items; i++) {
		arr.push({
			entryId: randomString(12),
		});
	}
}

rxjs.timer(0, logDelay).subscribe((x) => {
	if(logMode === 0) {
		freshlog.Log.info(
			'hi' + String.fromCharCode(65+((x*3)%26)).repeat(4) + String.fromCharCode(65+(((x+1)*5)%26)).repeat(4),
			{
				[String.fromCharCode(85+(x%7))]: x,
				a: x*x,
				b: String.fromCharCode(65+(x%10),65+(x%10),65+(x%10)),
				storage: {
					food: Math.random(),
					water: Math.random(),
					cornstarch: Math.random(),
				}
			}
		);
		return;
	}
	const rand1 = Math.random();
	let level = 'info';
	if(rand1 < 0.01) {
		level = 'error';
	}
	else if(rand1 < 0.03) {
		level = 'warn';
	}

	const message = messageNouns[Math.floor(Math.random()*messageNouns.length)] + ' ' + messageVerbs[Math.floor(Math.random()*messageVerbs.length)] + ` '${randomString(Math.floor(Math.random() * 12))}'` ;
	freshlog.Log[level](
		message,
		{
			tree: generateRandomTree(initialTreeDepth),
			record: {
				owner: {
					id: Math.floor(Math.random()*8),
					firstname: randomString(Math.floor(Math.random()*8)),
					lastname: randomString(Math.floor(Math.random()*12)),
				},
				entries: generateRandomArray(Math.floor(Math.random()*5)),
			},
			man: {
				name: 'bob',
				roadsWalkedDown: Math.floor(Math.random()*10000),
				[randomString(10)]: messageNouns[Math.floor(Math.random()*messageNouns.length)] 
			}
		}
	);
});
// console.log('hello');
// console.error('exiting');
// throw new Error('error: exiting process');

