// Unpacks the tarballs a CI build job packed into dist/, so the test jobs run
// exactly the files the release publishes (openspec continuous-integration,
// "Each platform is built once per run"): the @oxgl-js/oxgl tarball's dist/,
// then the host's platform tarball's addon, ANGLE libraries and notices.
//
//     node scripts/unpack-packages.mjs <dir-with-tarballs>
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MAIN = /^oxgl-js-oxgl-(.+)\.tgz$/;

/**
 * Extracts `tarball` into a new temporary directory and returns its `package/`.
 * The archive goes to `tar` on standard input, so `tar` gets no path: GNU tar,
 * first on PATH on the Windows runners, reads `C:\…` as a remote host.
 */
function extract(tarball, scratch) {
  const into = mkdtempSync(join(scratch, 'x-'));
  const result = spawnSync('tar', ['-xzf', '-'], { cwd: into, input: readFileSync(tarball), stdio: ['pipe', 'inherit', 'inherit'] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`unpack: tar exited with ${String(result.status)} for ${tarball}`);
  return join(into, 'package');
}

/** Unpacks the main and the host's platform tarball from `from` into `dist`, which must not exist yet. */
export async function unpackPackages(from, dist, host = process) {
  if (existsSync(dist)) throw new Error(`unpack: ${dist} already exists`);
  const files = readdirSync(from);
  const mains = files.filter((file) => MAIN.test(file));
  if (mains.length !== 1) throw new Error(`unpack: expected one oxgl-js-oxgl-<version>.tgz in ${from}, found ${String(mains.length)}`);
  const version = MAIN.exec(mains[0])[1];

  const scratch = mkdtempSync(join(tmpdir(), 'oxgl-unpack-'));
  try {
    cpSync(join(extract(join(from, mains[0]), scratch), 'dist'), dist, { recursive: true });
    // The platform name comes from the code that will load the addon. A file
    // URL, since import() of a bare Windows path (C:\…) fails.
    const { platformString } = await import(pathToFileURL(join(dist, 'resolve-native.js')).href);
    const platform = platformString(host.platform, host.arch);
    const name = `oxgl-js-${platform}-${version}.tgz`;
    if (!files.includes(name)) throw new Error(`unpack: ${name} not found in ${from}`);
    const pkg = extract(join(from, name), scratch);
    for (const file of [`oxgl.${platform}.node`, 'angle', 'THIRD_PARTY_NOTICES']) {
      if (!existsSync(join(pkg, file))) throw new Error(`unpack: ${name} has no ${file}`);
      cpSync(join(pkg, file), join(dist, file), { recursive: true });
    }
    console.log(`unpack: ${mains[0]} and ${name} into ${dist}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const from = process.argv[2];
  if (!from) {
    console.error('usage: node scripts/unpack-packages.mjs <dir-with-tarballs>');
    process.exit(2);
  }
  await unpackPackages(resolve(from), fileURLToPath(new URL('../dist', import.meta.url)));
}
