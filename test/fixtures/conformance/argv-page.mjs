// A page child that reports its arguments and Node options as its outcome's
// message, for the pool's own tests.
process.send?.({ type: 'outcome', outcome: 'PASS', message: JSON.stringify({ args: process.argv.slice(2), execArgv: process.execArgv }) }, () => process.exit(0));
