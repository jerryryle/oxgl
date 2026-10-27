// Writes THIRD_PARTY_NOTICES: the license texts of every third-party component
// bundled into the package. With --check, fails instead if the file is stale.
//
// Rust crates come from cargo-about (configured by about.toml). ANGLE bundle
// components are appended here once the angle-acquisition change lands.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const OUTPUT = 'THIRD_PARTY_NOTICES';
const HEADER = `oxgl third-party notices

oxgl is licensed under the BSD 3-Clause License (see LICENSE). It bundles the
third-party components listed below, each under its own license.
`;

const crates = execFileSync('cargo', ['about', 'generate', '--locked', '--fail', 'about.hbs'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
const notices = `${HEADER}\n${crates.trim()}\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(OUTPUT, 'utf8');
  } catch {
    // A missing file is stale too.
  }
  if (current !== notices) {
    console.error(`${OUTPUT} is out of date; run \`npm run notices\` and commit the result.`);
    process.exit(1);
  }
} else {
  writeFileSync(OUTPUT, notices);
}
