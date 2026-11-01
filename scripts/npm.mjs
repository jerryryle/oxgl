// Runs npm without a shell. On Windows `npm` is a .cmd script, which only a
// shell can start, and passing arguments through one leaves them unquoted
// (Node's DEP0190); so there npm's own CLI script runs on this Node instead.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

/** `execFileSync` for npm with `args` and `options`. */
export function npm(args, options) {
  if (process.platform !== 'win32') return execFileSync('npm', args, options);
  const cli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return execFileSync(process.execPath, [cli, ...args], options);
}
