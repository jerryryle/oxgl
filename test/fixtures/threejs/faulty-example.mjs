// The example child with fault hooks for the runner's own tests: pages can
// call abortProcess() to abort the process now; runnerRejection() to leave a
// rejection of this process's own realm unhandled outside any page code, as a
// runner bug would; nodeError(depth) to throw an error of this process's
// realm under page code, `depth` Node-side frames below it, as jsdom or the
// canvas package does; and fireJsdomLoad()
// to fire window load again the way jsdom does internally.
import { createRequire } from 'node:module';

import { main } from '../../../threejs/example.mjs';

const { fireAnEvent } = createRequire(import.meta.url)('jsdom/lib/jsdom/living/helpers/events.js');

/** The hooks both fault children give pages. */
export function faultHooks(window) {
  window.abortProcess = () => process.abort();
  window.runnerRejection = () => {
    setTimeout(() => void Promise.reject(new Error('a runner bug')), 0);
  };
  window.nodeError = (depth = 0) => {
    const descend = (level) => {
      if (level === 0) throw new Error('thrown by a Node-side library');
      descend(level - 1);
    };
    descend(depth);
  };
  // jsdom fires load at the window with the document as its target.
  window.fireJsdomLoad = () => fireAnEvent('load', window, undefined, {}, true);
}

if (import.meta.main) await main({ beforeParse: faultHooks });
