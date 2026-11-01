importScripts("gpu-wait.js");
var gl = new OffscreenCanvas(512, 512).getContext("webgl2");
checkFrameWaitsForGpu(gl, requestAnimationFrame, function (done) {
  postMessage(done);
  close();
});
