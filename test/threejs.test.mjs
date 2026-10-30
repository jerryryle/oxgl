// three.js renders through oxgl: scenes, textures, render targets,
// instancing, shadows and context loss, checked by reading pixels back.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

import * as THREE from 'three';
import { createContext } from 'oxgl';

const SIZE = 64;

/** A WebGL 2 context and a three.js renderer drawing to it. */
function setup(options = {}) {
  const gl = createContext({ width: SIZE, height: SIZE, webgl2: true, attributes: { antialias: false } });
  const renderer = new THREE.WebGLRenderer({ canvas: gl.canvas, context: gl, ...options });
  renderer.setSize(SIZE, SIZE, false);
  return { gl, renderer };
}

/** The RGBA pixel at (x, y) of the bound framebuffer, y up. */
function pixel(gl, x, y) {
  const out = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return [...out];
}

function near(actual, expected, tolerance = 2) {
  assert.ok(
    actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance),
    `${JSON.stringify(actual)} is not within ${String(tolerance)} of ${JSON.stringify(expected)}`,
  );
}

/** An orthographic camera looking down -z at the unit square. */
function orthoCamera() {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 5;
  return camera;
}

function finish(gl, renderer) {
  assert.equal(gl.getError(), gl.NO_ERROR);
  renderer.dispose();
  gl.destroy();
}

test('a basic material fills the view', () => {
  const { gl, renderer } = setup();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0000ff);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
  plane.position.x = -0.5;
  scene.add(plane);
  renderer.render(scene, orthoCamera());
  near(pixel(gl, 8, 32), [255, 0, 0, 255]);
  near(pixel(gl, 56, 32), [0, 0, 255, 255]);
  finish(gl, renderer);
});

test('a lit standard material', () => {
  const { gl, renderer } = setup();
  const scene = new THREE.Scene();
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(0, 0, 1);
  scene.add(light, new THREE.AmbientLight(0xffffff, 0.2));
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 32, 16),
    new THREE.MeshStandardMaterial({ color: 0x00ff00, roughness: 0.5, metalness: 0 }),
  );
  scene.add(sphere);
  renderer.render(scene, orthoCamera());
  const [r, g, b, a] = pixel(gl, 32, 32);
  // Green, lightened by the white specular highlight and sRGB output.
  assert.ok(g > 200 && g > r + 100 && g > b + 100 && a === 255, `center ${String([r, g, b, a])}`);
  // The rim facing away from the light is darker than the center.
  assert.ok(pixel(gl, 32, 60)[1] < g);
  near(pixel(gl, 1, 1), [0, 0, 0, 0]);
  finish(gl, renderer);
});

test('a data texture with nearest filtering', () => {
  const { gl, renderer } = setup();
  const data = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
  const texture = new THREE.DataTexture(data, 2, 2);
  texture.magFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: texture })));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.render(scene, orthoCamera());
  // DataTexture rows start at the bottom (flipY is false).
  near(pixel(gl, 8, 8), [255, 0, 0, 255]);
  near(pixel(gl, 56, 8), [0, 255, 0, 255]);
  near(pixel(gl, 8, 56), [0, 0, 255, 255]);
  near(pixel(gl, 56, 56), [255, 255, 255, 255]);
  finish(gl, renderer);
});

test('a half-float render target read back', () => {
  const { gl, renderer } = setup();
  const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0.25, 0.5, 0.75);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setRenderTarget(target);
  renderer.render(scene, orthoCamera());
  const out = new Uint16Array(4 * 4 * 4);
  renderer.readRenderTargetPixels(target, 0, 0, 4, 4, out);
  const first = [...out.slice(0, 4)].map((h) => THREE.DataUtils.fromHalfFloat(h));
  near(first.map((v) => v * 100), [25, 50, 75, 100], 1);
  renderer.setRenderTarget(null);
  target.dispose();
  finish(gl, renderer);
});

test('a render target used as a texture', () => {
  const { gl, renderer } = setup();
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const target = new THREE.WebGLRenderTarget(16, 16);
  const inner = new THREE.Scene();
  inner.background = new THREE.Color(1, 1, 0);
  renderer.setRenderTarget(target);
  renderer.render(inner, orthoCamera());
  renderer.setRenderTarget(null);
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: target.texture })));
  renderer.render(scene, orthoCamera());
  near(pixel(gl, 32, 32), [255, 255, 0, 255]);
  target.dispose();
  finish(gl, renderer);
});

test('instanced meshes', () => {
  const { gl, renderer } = setup();
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial(), 2);
  const matrix = new THREE.Matrix4();
  mesh.setMatrixAt(0, matrix.makeTranslation(-0.5, 0, 0));
  mesh.setMatrixAt(1, matrix.makeTranslation(0.5, 0, 0));
  mesh.setColorAt(0, new THREE.Color(1, 0, 0));
  mesh.setColorAt(1, new THREE.Color(0, 1, 0));
  const scene = new THREE.Scene();
  scene.add(mesh);
  renderer.render(scene, orthoCamera());
  near(pixel(gl, 16, 32), [255, 0, 0, 255]);
  near(pixel(gl, 48, 32), [0, 255, 0, 255]);
  near(pixel(gl, 32, 32), [0, 0, 0, 0]);
  finish(gl, renderer);
});

test('shadow maps', () => {
  const { gl, renderer } = setup();
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap;
  const scene = new THREE.Scene();
  const light = new THREE.DirectionalLight(0xffffff, 3);
  // From the right: the blocker's shadow falls left of it, around x = 0.
  light.position.set(2, 0, 5);
  light.castShadow = true;
  Object.assign(light.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.1, far: 10 });
  scene.add(light);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  ground.receiveShadow = true;
  scene.add(ground);
  // A box: three.js renders the back faces of single-sided meshes into the
  // shadow map, which a plane facing the light does not have.
  const blocker = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  blocker.position.set(0.5, 0, 1);
  blocker.castShadow = true;
  scene.add(blocker);
  renderer.render(scene, orthoCamera());
  const lit = pixel(gl, 8, 32);
  const shadowed = pixel(gl, 28, 32);
  assert.ok(lit[0] > 200, `lit ${String(lit)}`);
  assert.ok(shadowed[0] < lit[0] / 2, `shadowed ${String(shadowed)}`);
  finish(gl, renderer);
});

test('a raw GLSL 3 shader material', () => {
  const { gl, renderer } = setup();
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: 'in vec3 position; void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader:
      'precision highp float; uniform vec3 tint; out vec4 color; void main() { color = vec4(tint * (gl_FragCoord.x < 32.0 ? 1.0 : 0.5), 1.0); }',
    uniforms: { tint: { value: new THREE.Vector3(1, 0.5, 0) } },
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  renderer.render(scene, orthoCamera());
  near(pixel(gl, 8, 8), [255, 128, 0, 255]);
  near(pixel(gl, 56, 8), [128, 64, 0, 255]);
  finish(gl, renderer);
});

test('context loss and restore through the renderer', async () => {
  const { gl, renderer } = setup();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xff0000);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.render(scene, orthoCamera());
  near(pixel(gl, 32, 32), [255, 0, 0, 255]);
  renderer.forceContextLoss();
  await once(gl.canvas, 'webglcontextlost');
  renderer.forceContextRestore();
  await once(gl.canvas, 'webglcontextrestored');
  scene.background = new THREE.Color(0x00ff00);
  renderer.render(scene, orthoCamera());
  near(pixel(gl, 32, 32), [0, 255, 0, 255]);
  finish(gl, renderer);
});
