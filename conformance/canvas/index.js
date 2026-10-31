'use strict';

// jsdom and the conformance runner load `canvas`, the node-canvas API. This
// package gives them @napi-rs/canvas, which installs from prebuilt binaries on
// every target, through its node-canvas compatibility module.
const canvas = require('@napi-rs/canvas/node-canvas');
const { CanvasRenderingContext2D } = require('@napi-rs/canvas/js-binding');

// jsdom assigns the element to `context.canvas`, which node-canvas allows and
// @napi-rs/canvas, with a getter only, rejects. An assigned value wins.
const descriptor = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'canvas');
if (descriptor?.get === undefined) {
  throw new Error('@napi-rs/canvas no longer has a CanvasRenderingContext2D canvas getter; update conformance/canvas');
}
const assigned = new WeakMap();
Object.defineProperty(CanvasRenderingContext2D.prototype, 'canvas', {
  ...descriptor,
  get() {
    return assigned.has(this) ? assigned.get(this) : descriptor.get.call(this);
  },
  set(value) {
    assigned.set(this, value);
  },
});

module.exports = canvas;
