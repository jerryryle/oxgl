// Appends a WebGL canvas of `width × height` to `parent` and clears it to
// `color` (0–1 floats, as stored, not premultiplied) when the frame is released.
export function clear(parent, width, height, color, attributes = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  parent.appendChild(canvas);
  const gl = canvas.getContext('webgl', attributes);
  requestAnimationFrame(() => {
    gl.clearColor(...color);
    gl.clear(gl.COLOR_BUFFER_BIT);
  });
}
