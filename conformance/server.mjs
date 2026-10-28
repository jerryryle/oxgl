// Static HTTP server over the suite root, bound to loopback on an ephemeral
// port, so pages get same-origin XHR and iframes as in a browser.
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.vert': 'text/plain; charset=utf-8',
  '.frag': 'text/plain; charset=utf-8',
  '.glsl': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.ogv': 'video/ogg',
  '.wasm': 'application/wasm',
};

/** Starts serving `root`; resolves to `{ origin, close }`. */
export async function startServer(root) {
  const base = resolve(root);
  const server = createServer((req, res) => {
    const file = resolveFile(base, req.url ?? '/');
    if (file === undefined) {
      res.writeHead(403).end();
      return;
    }
    let stats;
    try {
      stats = statSync(file);
    } catch {
      stats = undefined;
    }
    if (!stats?.isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': stats.size,
    });
    if (req.method === 'HEAD') res.end();
    // A read failing after the stat fails this request, not the run.
    else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', done);
  });
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((done) => server.close(() => done(undefined))),
  };
}

/** The file under `base` a request URL names, or undefined when it is outside `base` or malformed. */
function resolveFile(base, url) {
  let path;
  try {
    path = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  } catch {
    return undefined;
  }
  const file = resolve(base, `.${path}`);
  const rel = relative(base, file);
  if (rel.startsWith('..') || isAbsolute(rel) || path.includes('\0')) return undefined;
  return file;
}
