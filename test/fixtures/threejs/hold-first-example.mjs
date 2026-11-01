// The example child with the load-event hold registered before the shim's
// load-once guard, the other order from the runner's, and the fault hooks.
import { main } from '../../../threejs/example.mjs';

import { faultHooks } from './faulty-example.mjs';

await main({ holdFirst: true, beforeParse: faultHooks });
