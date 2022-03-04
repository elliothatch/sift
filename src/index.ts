import { Sift } from './sift';

const sift = new Sift();

if(process.argv.length > 2) {
    sift.spawnProcess(process.argv[2], process.argv.slice(3));
    sift.display.hideLogStreamPanel(sift.siftLogStreamPanel);
    sift.display.draw();
}


