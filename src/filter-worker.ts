import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

import { LogDb, LogRecord, LogIndex, ResultSet, FilterMatch } from './logdb';
import { Parse };

const expr: Parse.Expression;

/** returns the index of the closest match
 * if there are duplicate entries, order between the duplicates is undefined */
function binarySearch<T>(
    arr: Array<T>,
    target: T,
    comparator: (a: T, b: T) => number,
    start?: number,
    end?: number
): number {

    start = start != null? start: 0;
    end = end != null? end: arr.length - 1;

    const mid = Math.floor((start + end)/2);
    const comparison = comparator(arr[mid], t);

    if(end === start + 1) {
        return end;
    }
    if(comparison === 0) {
        return mid;
    }
    if(comparison < 0) {
        return binarySearch(arr, target, mid, end);
    }
    if(comparison > 0) {
        return binarySearch(arr, target, start, mid);
    }
}

function insertSorted<T>(t: T, arr: Array<T>, comparator: (a: T, b: T) => number): number {
    for(let i = 0; i < arr.length; i++) {
        const result = comparator(arr[i], t);
        if(result >= 0) {
            arr.splice(i, 0, t);
            return i;
        }
    }

    arr.push(t);
    return arr.length - 1;
}


// function createfilterWorker(script): {
// }

// logdb.filterAll(expr).pipe({
//

if(!isMainThread) {
    const filteredLogs: LogRecord[] = [];

    workerData.logdb.filterAll(workerData.expr).pipe(
        map(({record, matches, resultSet}) => {
            insertSorted(record, displayedLogs, (a, b) => a.idx - b.idx);

            return
        }),
        tap(parentPort.postMessage),
    );


    workerData
}
