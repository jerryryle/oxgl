// Shader, program and geometry helpers for the rendering test suites.

export const VERTEX = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';
export const FRAGMENT = 'precision mediump float; uniform vec4 c; void main() { gl_FragColor = c; }';

/** Compiles a shader, throwing with its log on failure. */
export function shader(gl, type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

/** Links a program from sources, throwing with its log on failure. */
export function program(gl, vertex = VERTEX, fragment = FRAGMENT) {
  const p = gl.createProgram();
  gl.attachShader(p, shader(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(p, shader(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

/** A buffer of two full-viewport triangles at attribute `p`, returned bound. */
export function quad(gl, p) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const location = gl.getAttribLocation(p, 'p');
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  return buffer;
}

/** Sets the program's `c` uniform. */
export function color(gl, p, rgba) {
  gl.uniform4fv(gl.getUniformLocation(p, 'c'), rgba);
}
