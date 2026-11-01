// Shared by frame-waits-for-gpu.html and its worker: queues about 200 ms of
// GPU work in one animation frame, far more than one 16 ms frame on any host,
// then reports whether a fence inserted after it is signaled in the next frame.
function checkFrameWaitsForGpu(gl, requestFrame, report) {
  function shader(type, source) {
    var s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return s;
  }
  var program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, "#version 300 es\nvoid main() { vec2 p = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 4.0 - 1.0; gl_Position = vec4(p, 0.0, 1.0); }"));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, "#version 300 es\nprecision mediump float; out vec4 c; void main() { c = vec4(sin(gl_FragCoord.xy), 0.0, 1.0); }"));
  gl.linkProgram(program);
  gl.useProgram(program);
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  // Calibrate: compile the pipeline with a first draw, then time a batch to
  // its completion and size the frame's work from it.
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.finish();
  var batch = 1000;
  var start = performance.now();
  for (var i = 0; i < batch; ++i) gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.finish();
  var perDraw = Math.max((performance.now() - start) / batch, 0.001);
  var draws = Math.min(Math.ceil(200 / perDraw), 1000000);
  requestFrame(function () {
    for (var i = 0; i < draws; ++i) gl.drawArrays(gl.TRIANGLES, 0, 3);
    var sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    requestFrame(function () {
      report(gl.getSyncParameter(sync, gl.SYNC_STATUS) === gl.SIGNALED);
    });
  });
}
