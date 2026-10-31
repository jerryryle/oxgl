// Scratch: runs the abort.html fixture alone with a long limit and prints its record.
import { resolve } from 'node:path';
import { runConformance } from './conformance/run.mjs';
import { parseExpectations } from './conformance/expectations.mjs';
const started = performance.now();
const { report } = await runConformance({
  root: resolve('test/fixtures/conformance/suite'),
  pages: new Map([['webgl1', ['abort.html']]]),
  expectations: parseExpectations(''),
  commit: 'probe', timeoutS: 120, jobs: 1,
  script: resolve('test/fixtures/conformance/faulty-page.mjs'),
  reportPath: resolve('probe-report.json'), expectationsPath: resolve('probe-expectations.txt'),
  log: () => {},
});
const page = report.suites.webgl1.pages[0];
console.log(`${page.outcome} after ${page.durationMs} ms (wall ${Math.round(performance.now() - started)} ms): ${String(page.message).slice(0, 2000)}`);
