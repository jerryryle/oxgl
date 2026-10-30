// Micro- and scene-level benchmarks: `npm run bench` (after `npm run build`).
// Each case reports operations per second (or MB/s) over a fixed time
// budget, after a warm-up, on the backend OXGL_BACKEND selects. Numbers are
// for comparing builds on one machine, not across machines.
import * as THREE from 'three';
import { createContext } from '../dist/index.js';

const BUDGET_MS = Number(process.env.OXGL_BENCH_MS ?? 1000);

/** Runs `step` repeatedly for the budget; returns calls per second. */
function measure(step, finish = () => {}) {
  // Warm up for a fifth of the budget: the first draws of a pipeline
  // include the backend's shader and pipeline compilation.
  const warm = performance.now();
  while (performance.now() - warm < BUDGET_MS / 5) {
    for (let i = 0; i < 10; i++) step();
    finish();
  }
  let calls = 0;
  const start = performance.now();
  let now = start;
  while (now - start < BUDGET_MS) {
    for (let i = 0; i < 100; i++) step();
    calls += 100;
    finish();
    now = performance.now();
  }
  return (calls * 1000) / (now - start);
}

const results = [];
function report(name, value, unit) {
  results.push({ name, value: Math.round(value * 10) / 10, unit });
  console.log(`${name.padEnd(44)} ${value.toFixed(1).padStart(12)} ${unit}`);
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  return p;
}

const gl = createContext({ width: 256, height: 256, webgl2: true, attributes: { antialias: false } });
const finishGl = () => gl.finish();

// Per-call overhead of trivial state calls (JS conversion + native hop).
report('enable/disable (state call)', measure(() => gl.enable(gl.BLEND)), 'calls/s');
report('getError', measure(() => gl.getError()), 'calls/s');
report('uniform4f', (() => {
  const p = program(gl, '#version 300 es\nin vec4 a; void main() { gl_Position = a; }', '#version 300 es\nprecision mediump float; uniform vec4 c; out vec4 o; void main() { o = c; }');
  gl.useProgram(p);
  const loc = gl.getUniformLocation(p, 'c');
  return measure(() => gl.uniform4f(loc, 1, 0, 0, 1));
})(), 'calls/s');

// Small draws: the cost a scene with many objects pays per object.
{
  const p = program(gl, '#version 300 es\nin vec2 a; void main() { gl_Position = vec4(a * 0.01, 0, 1); }', '#version 300 es\nprecision mediump float; out vec4 o; void main() { o = vec4(1); }');
  gl.useProgram(p);
  const b = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  report('drawArrays (1 small triangle)', measure(() => gl.drawArrays(gl.TRIANGLES, 0, 3), finishGl), 'draws/s');
  const data = new Float32Array([0, 0, 1, 0, 0, 1]);
  report('bufferSubData (24 B) + drawArrays', measure(() => {
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }, finishGl), 'pairs/s');
}

// Bulk transfers.
{
  const size = 1 << 20;
  const bytes = new Uint8Array(size);
  const b = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, size, gl.DYNAMIC_DRAW);
  report('bufferSubData 1 MiB', (measure(() => gl.bufferSubData(gl.ARRAY_BUFFER, 0, bytes), finishGl) * size) / 1e6, 'MB/s');
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  const pixels = new Uint8Array(512 * 512 * 4);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  report('texSubImage2D 512x512 RGBA8', (measure(() => gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 512, gl.RGBA, gl.UNSIGNED_BYTE, pixels), finishGl) * pixels.length) / 1e6, 'MB/s');
  const out = new Uint8Array(256 * 256 * 4);
  report('readPixels 256x256 RGBA8', (measure(() => gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, out)) * out.length) / 1e6, 'MB/s');
}
gl.destroy();

// three.js: many meshes (per-object overhead) and one heavy lit mesh.
function threeScene(meshes, segments) {
  const ctx = createContext({ width: 256, height: 256, webgl2: true, attributes: { antialias: false } });
  const renderer = new THREE.WebGLRenderer({ canvas: ctx.canvas, context: ctx });
  renderer.setSize(256, 256, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.DirectionalLight(0xffffff, 2), new THREE.AmbientLight(0xffffff, 0.3));
  const geometry = new THREE.SphereGeometry(0.05, segments, segments / 2);
  const material = new THREE.MeshStandardMaterial({ color: 0x3388ff });
  for (let i = 0; i < meshes; i++) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(((i % 32) / 16) - 1, (Math.floor(i / 32) / 16) - 1, 0);
    scene.add(mesh);
  }
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 5;
  const frame = () => renderer.render(scene, camera);
  const fps = measure(frame, () => ctx.finish()) ;
  renderer.dispose();
  ctx.destroy();
  return fps;
}
report('three.js 1000 meshes (frames)', threeScene(1000, 8), 'frames/s');
report('three.js 1 mesh, 128x64 segments (frames)', threeScene(1, 128), 'frames/s');

if (process.env.OXGL_BENCH_JSON) console.log(JSON.stringify(results));
