// The page child with fault hooks for the harness's own tests: pages can
// call abortProcess() to abort now, or abortAtExit() / hangAtExit() to abort
// or hang after their outcome is sent, while the runner tears down. They can
// also force a collection (collectGarbage()) and count live native contexts
// (liveContexts()).
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { main } from '../../../conformance/page.mjs';
import { native } from '../../../dist/native.js';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc');

let atExit;
await main({
  beforeParse(window) {
    window.abortProcess = () => process.abort();
    window.abortAtExit = () => {
      atExit = 'abort';
    };
    window.hangAtExit = () => {
      atExit = 'hang';
    };
    window.collectGarbage = async () => {
      gc();
      // Finalization callbacks run on a later task.
      await new Promise((resolve) => setImmediate(resolve));
    };
    window.liveContexts = () => native.liveContexts();
  },
  beforeExit() {
    if (atExit === 'abort') process.abort();
    // eslint-disable-next-line no-empty -- a deliberate hang
    if (atExit === 'hang') for (;;) {}
  },
});
