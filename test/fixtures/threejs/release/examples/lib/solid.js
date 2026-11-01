// Fills a WebGL canvas the size of the window with the fixtures' color,
// rgb(0, 128, 255), when the frame is released, or at once.
export function solid({ animate = true, width = window.innerWidth, height = window.innerHeight, color = [0, 0.5, 1, 1] } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  document.body.appendChild(canvas);
  const gl = canvas.getContext('webgl');
  const draw = () => {
    gl.clearColor(...color);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };
  if (animate) requestAnimationFrame(draw);
  else draw();
  return gl;
}
