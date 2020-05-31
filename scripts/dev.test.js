#!/usr/bin/env node
const freshlog = require('freshlog');
const rxjs = require('rxjs');

rxjs.timer(0, 20).subscribe(
	x => freshlog.Log.info(
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
	)
);
// console.log('hello');
// console.error('exiting');
// throw new Error('error: exiting process');

