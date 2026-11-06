# Upstream reports to file

Defects found while bringing up ANGLE's OpenGL ES backend on Mesa, written so
that each can be filed as it stands. None is filed yet. `angle/README.md`
lists what oxgl works around; this file holds the evidence.

Environment for every entry unless it says otherwise:

- ANGLE `751417514a52` (`chromium/8103`), as `angle-8103.2`, a WebGL-compatible
  context on `EGL_PLATFORM_ANGLE_TYPE_OPENGLES_ANGLE` with
  `EGL_PLATFORM_SURFACELESS_MESA`.
- Raspberry Pi 5, Debian 13, Mesa 26.2.2, `V3D 7.1.10.2` (GL) and V3DV (Vulkan).
- `linux/arm64` `ubuntu:24.04`, Mesa 25.2.8, llvmpipe (LLVM 20.1.2).

| Report | Project | Effect | In oxgl |
| --- | --- | --- | --- |
| [V3D transform feedback offset](#mesa-v3d-overlapping-instanced-transform-feedback) | Mesa | Wrong data | Accepted |
| [V3DV sampler array crash](#mesa-v3dv-segfault-on-a-sampler-array-indexed-by-a-loop-variable) | Mesa, ANGLE | Process crash | Avoided: no contexts on ES 2.0-only Vulkan |
| [`generateMipmap` on float](#angle-generatemipmap-on-an-unsized-float-texture-loses-the-context) | ANGLE | Context loss | Worked around |
| [norm16 read workaround](#angle-norm16-read-workaround-loses-the-context-on-mesa) | ANGLE | Context loss | Feature disabled |
| [`drawRangeElements` range](#angle-drawrangeelements-passes-an-untrusted-range-to-the-driver) | ANGLE | Out-of-bounds read | Worked around |
| [V3D instance divisor clamp](#mesa-v3d-instance-divisors-above-65535-read-out-of-bounds) | Mesa | Out-of-bounds read | Read closed; page still fails |
| [V3D stale invalidate flag](#mesa-v3d-drops-a-color-buffer-after-an-invalidate) | Mesa | Wrong rendering | Worked around |
| [V3D sRGB mipmaps](#mesa-v3d-filters-srgb-mipmaps-in-encoded-space) | Mesa | Wrong colors | Worked around for 2D textures; the spec allows the rest |
| [V3D resolve ignores readers](#mesa-v3d-multisample-resolve-overtakes-draws-that-read-its-destination) | Mesa | Wrong rendering | Worked around |
| [Native context per thread](#angle-the-gl-backend-allows-contexts-on-one-thread-only) | ANGLE | Second thread can't create a context | Worked around |
| [Native context leak](#angle-a-native-context-leaks-when-its-last-thread-exits) | ANGLE | Leak in the workaround above | Patched in `angle-8103.3`; fixed upstream, not in a Chrome release yet |
| [Metal stale reads across threads](#angle-metal-reads-stale-pixels-when-threads-share-a-display) | ANGLE | Wrong pixels | Avoided: a display per thread |
| [Metal crash across threads](#angle-metal-crashes-when-threads-share-a-display) | ANGLE | Process crash | Avoided: a display per thread |
| [Parallel compile extension](#angle-khr_parallel_shader_compile-is-exposed-without-parallelism) | ANGLE | Extension does nothing | Worked around |
| [llvmpipe clip distances](#mesa-llvmpipe-clips-with-disabled-clip-distances) | Mesa | Wrong rendering, llvmpipe only | Worked around |

## Mesa: V3D overlapping instanced transform feedback

**Where to file:** Mesa, `broadcom` label.

**Summary:** two instanced draws inside one transform feedback overlap. After
the first draw, the buffer position appears to advance by one vertex rather
than one per instance. That is inferred from the output; the Mesa source has
not been read.

**Expected and actual,** with one float varying `a * 2 + gl_InstanceID * 10`,
`a` = 1 and two `glDrawArraysInstanced(GL_POINTS, 0, 1, 4)` calls:

| Driver | Buffer |
| --- | --- |
| Expected, and llvmpipe | `2 12 22 32 2 12 22 32` |
| V3D | `2 2 12 22 32 0 0 0` |

**Reproducer:** plain EGL and GLES 3, with no ANGLE:

```c
const char *vs = "#version 300 es\n"
                 "in float a; out float o;\n"
                 "void main() { o = a * 2. + float(gl_InstanceID) * 10.; }";
// Link with glTransformFeedbackVaryings(p, 1, &"o", GL_INTERLEAVED_ATTRIBS).
// Bind a 16-byte attribute buffer holding 1, 2, 3, 4 to `a`, and a zeroed
// 64-byte GL_TRANSFORM_FEEDBACK_BUFFER.
glEnable(GL_RASTERIZER_DISCARD);
glBeginTransformFeedback(GL_POINTS);
glDrawArraysInstanced(GL_POINTS, 0, 1, 4);
glDrawArraysInstanced(GL_POINTS, 0, 1, 4);
glEndTransformFeedback();
// Map the buffer and print it.
```

**Khronos test:** `conformance2/transform_feedback/too-small-buffers.html`, the
"multiple draws success case" with `drawArraysInstanced four instances`. A
single instanced draw, and two non-instanced draws, are correct.

**Safety:** no out-of-bounds write was seen, since the position falls short.

**In oxgl:** accepted. Working around it would mean splitting transform
feedback, for an uncommon draw pattern.

## Mesa: V3DV segfault on a sampler array indexed by a loop variable

**Where to file:** both Mesa (`broadcom` label) and ANGLE. Either fix removes
the crash.

**Summary:** with `shaderSampledImageArrayDynamicIndexing = false`, ANGLE still
emits a non-constant index into a sampler array, which is invalid Vulkan. V3DV
then segfaults at draw time instead of failing to compile.

**Reproducer:** a WebGL 1 context on V3DV (`EGL_PLATFORM_ANGLE_TYPE_VULKAN_ANGLE`):

```glsl
precision mediump float;
uniform sampler2D uni[2];
void main() {
  vec4 c = vec4(0.);
  for (int i = 0; i < 2; ++i) { c += texture2D(uni[i], vec2(.5)); }
  gl_FragColor = c;
}
```

GLSL ES 1.00 Appendix A allows this index, because a loop index is a
constant-index-expression. Compiling and linking succeed, and the first draw
crashes. Constant indices, such as `uni[0]` and `uni[1]`, work.

**Khronos test:** `conformance/glsl/bugs/sampler-array-using-loop-index.html`.

**Backtrace,** with Mesa's debug symbols:

```text
#0 v3dv_descriptor_map_get_descriptor (index=1) at ../src/broadcom/vulkan/v3dv_descriptor_set.c:82
#1 v3dv_descriptor_map_get_texture_bo
#2 write_tmu_p0
#3 v3dv_write_uniforms_wg_offsets
#5 update_gfx_uniform_state
#6 v3dv_cmd_buffer_emit_pre_draw
#8 v3dv_CmdDraw
```

**Cause:** in `lower_tex_src` (`src/broadcom/vulkan/v3dv_pipeline.c`), a
non-constant index adds one descriptor map entry for the whole array, at array
index 0. At the crash, `map->num_desc` is 1 and `map->array_size[0]` is 2. Once
the loop unrolls, the shader asks for texture index 1, which has no entry, so
`set_number` reads as 0, that set is unbound, and it is dereferenced as null.

**For ANGLE:** `vk_renderer.cpp` enables the feature only when the device has
it, but the translator still emits the index. It could lower such an index for
such a device, or refuse the program.

**In oxgl:** on a Vulkan GPU with OpenGL ES 2.0 only, no context uses Vulkan, so
this can't be reached.

## ANGLE: generateMipmap on an unsized float texture loses the context

**Where to file:** ANGLE, GL backend.

**Summary:** `ValidateGenerateMipmapBase` accepts every unsized format, so a
WebGL 1 `RGBA`/`FLOAT` texture reaches a driver that can't filter it. The driver
returns `GL_INVALID_OPERATION` (OpenGL ES 3.0.6 §3.8.10), and ANGLE turns that
into a context loss, where the call should simply generate the error.

**Reproducer:** a WebGL 1 context on V3D, which has no `OES_texture_float_linear`:

```js
gl.getExtension('OES_texture_float');
gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(4));
gl.generateMipmap(gl.TEXTURE_2D); // Loses the context.
```

To reach the same path on llvmpipe, hide the extension with
`MESA_EXTENSION_OVERRIDE=-GL_OES_texture_float_linear`. oxgl's test does this, but
not against an unpatched ANGLE path, so confirm the loss there before filing.

**Khronos test:** `conformance/extensions/oes-texture-float-linear.html`.

**Suggested fix:** in the validation, or in `TextureGL::generateMipmap`, refuse
a format the driver can't filter when it has no sized color-renderable and
filterable form. A plain check of `filterable` isn't enough: it follows the
WebGL extension state, and other backends generate these mipmaps themselves.

**In oxgl:** `Context::generate_mipmap` generates `INVALID_OPERATION` on this
backend. `LUMINANCE` float has no channel size to read, so it is told by its
memory size, through `GL_ANGLE_memory_size`. `RGB` float is refused even on a
driver with `OES_texture_float_linear`, as llvmpipe refuses it, not being
color-renderable.

## ANGLE: norm16 read workaround loses the context on Mesa

**Where to file:** ANGLE, GL backend.

**Summary:** `readPixelsUsingImplementationColorReadFormatForNorm16` is enabled
on every non-Intel OpenGL ES 3.1 driver with `GL_EXT_texture_norm16`. It assumes
that a driver's own read format for `RG16` is `RG`. Mesa's is `RGBA`, so
`glReadPixels` with `GL_RG` fails with `GL_INVALID_OPERATION` (0x502), and ANGLE
turns that into a context loss on a legal call.

**Reproducer:** a WebGL 2 context:

```js
const ext = gl.getExtension('EXT_texture_norm16');
gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
gl.texImage2D(gl.TEXTURE_2D, 0, ext.RG16_EXT, 1, 1, 0, gl.RG, gl.UNSIGNED_SHORT, null);
gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D,
                        gl.getParameter(gl.TEXTURE_BINDING_2D), 0);
gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_SHORT, new Uint16Array(4)); // Loses the context.
```

**Evidence:** plain Mesa reports `RED`/`UNSIGNED_SHORT` for `R16` and
`RGBA`/`UNSIGNED_SHORT` for `RG16` and `RGBA16`, and reads all three correctly
as `RGBA`/`UNSIGNED_SHORT` on V3D and llvmpipe. With the feature disabled, the
Khronos page passes on both.

**Khronos test:** `conformance2/extensions/ext-texture-norm16.html`.

**Suggested fix:** in `GetReadPixelsFormat`, use the attachment's format only if
it matches `GL_IMPLEMENTATION_COLOR_READ_FORMAT`, or disable the feature on Mesa.

**In oxgl:** the OpenGL ES display disables the feature with
`EGL_FEATURE_OVERRIDES_DISABLED_ANGLE`.

## ANGLE: drawRangeElements passes an untrusted range to the driver

**Where to file:** ANGLE, GL backend. Mesa is within OpenGL ES here, because
indices outside the range give undefined results (OpenGL ES 3.0.6 §2.9.3).

**Summary:** `ContextGL::drawRangeElements` passes `start` and `end` to the
driver. ANGLE's Vulkan, Metal and D3D11 backends ignore them. WebGL 2 requires
either range checking or discarding them. llvmpipe trusts the range, subtracts
`start` from each index, and reads out of bounds.

**Reproducer:** a WebGL 2 context on llvmpipe, with a vec2 attribute over a
10-vertex buffer and a point-size shader:

```js
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([4, 0, 2, 6, 7, 5, 1, 8, 3, 9]), gl.STATIC_DRAW);
gl.drawRangeElements(gl.POINTS, 5, 5, 5, gl.UNSIGNED_SHORT, 0);
```

Index 4 minus `start` wraps to 65535. Whether it crashes depends on the heap, so
a run gives a SIGSEGV or an image mismatch.

**Backtrace:** `try_setup_point` (`lp_setup_point.c:335`), `lp_setup_draw_elements`,
`draw_pt_emit`, `llvmpipe_draw_vbo`, `_mesa_validated_drawrangeelements`,
`rx::ContextGL::drawRangeElements`. There, `v0` is `vertex_buffer + 65535 * 48`.

**Khronos tests:** `deqp/functional/gles3/draw/draw_range_elements.html` and
`deqp/functional/gles3/draw/random.html`, whose indices fall outside the range.

**Suggested fix:** call `drawElements` from `ContextGL::drawRangeElements`.

**In oxgl:** `drawRangeElements` calls `drawElements` after its `end < start`
check, which WebGL 2.0, "Writing to the drawing buffer", allows.

## Mesa: V3D instance divisors above 65535 read out of bounds

**Where to file:** Mesa, `broadcom` label. Report it as a robustness issue, and
consider a private report first, since the reach below isn't established.

**Summary:** `v3dx_state.c` clamps `instance_divisor` to
`V3D_MAX_VERTEX_ATTRIB_DIVISOR` (0xffff) without any error. The attribute index
then advances every 65535 instances, not every N, so a draw reads attributes the
application never asked for. ANGLE doesn't range-check a robust context, and
`attr.maximum_index` is 0xffffff, so nothing bounds the fetch.

**Expected and actual,** through WebGL 2 on V3D, with a 4-byte attribute buffer
holding red, and the last instance read back:

| Divisor | Instances | Result |
| --- | --- | --- |
| 65536 | 65535 | `255,0,0,255`, correct |
| 65536 | 65536 | `1,0,0,0`, not in the buffer |
| 131072 | 65536 | `1,0,0,0`, not in the buffer |

Plain Mesa also picks the wrong element on V3D at divisors 65536 and 131072, and
llvmpipe is correct.

**Khronos test:** `conformance2/rendering/instanced-rendering-large-divisor.html`.

**Reach:** reads inside the buffer's own object (at least 4 KiB) are shown.
Reading up to 12 KiB past it, between live 8 KiB buffers holding a pattern,
returned only zeros, so crossing into another buffer object wasn't shown. Larger
offsets weren't tried, to avoid a GPU reset. Whether they reach other objects, or
other processes' objects, is open.

**In oxgl:** WebGL 2 draws of more than 65535 instances, including multi-draws,
are range-checked with the divisor V3D applies, so the read is closed. A large
enough buffer still advances early, so the Khronos page keeps failing.

## Mesa: V3D drops a color buffer after an invalidate

**Where to file:** Mesa, `broadcom` label.

**Summary:** `v3d_invalidate_resource` sets `rsc->invalidated`, which is consumed
only by the first job after a framebuffer change. If an application invalidates
color and repaints without changing framebuffers, the flag stays set, for any
number of frames. The next job after a framebuffer bind then skips the color
load and discards what the attachment holds. The stale-flag mechanism is read
from the source; the failure is reproduced below.

**Reproducer:** plain EGL and GLES 3, with no ANGLE. `f` is an FBO with `RGBA8`
and `DEPTH24_STENCIL8` renderbuffers, and `s` is another FBO using the same
depth-stencil:

```c
quad(red);
glInvalidateFramebuffer(GL_FRAMEBUFFER, 1, (GLenum[]){GL_COLOR_ATTACHMENT0});
quad(green);
glReadPixels(...);            // 0,255,0,255: correct.
glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT | GL_STENCIL_BUFFER_BIT);
quad(red);
glBindFramebuffer(GL_FRAMEBUFFER, s);
glClear(GL_DEPTH_BUFFER_BIT | GL_STENCIL_BUFFER_BIT);
glBindFramebuffer(GL_FRAMEBUFFER, f);
glEnable(GL_BLEND);
glBlendFunc(GL_ONE, GL_ONE);
quad(blue);
glReadPixels(...);            // V3D: 0,0,255,255. Expected 255,0,255,255, as on llvmpipe.
```

**Khronos test:** `deqp/functional/gles3/fboinvalidate/default.html`,
`render_depth_stencil`, which needs `render_color` to run first on the context.
ANGLE triggers it through `setNeedInitOnInvalidation`, whose robust init binds a
scratch framebuffer.

**Suggested fix:** clear `rsc->invalidated` when a job writes the resource.
The driconf `ignore_discard_framebuffer=true` passes the page.

**In oxgl:** `invalidateFramebuffer` drops valid color attachments on this backend.

## Mesa: V3D filters sRGB mipmaps in encoded space

**Where to file:** Mesa, `broadcom` label. OpenGL ES may leave the filter
unspecified, so check the spec text first; the Khronos WebGL test requires a
linear-space result.

**Summary:** `v3d_generate_mipmap` sends the chain to the TFU, which box-filters
the stored bytes with no sRGB decode or encode.

**Reproducer:** plain EGL and GLES 3. A 2×2 `SRGB8_ALPHA8` white and black
checkerboard, `glGenerateMipmap`, then level 1 read through an FBO, gives encoded
`128,128,128,255`, where about 188 is expected.

**Khronos test:** `conformance2/textures/misc/tex-srgb-mipmap.html`.

**Suggested fix:** have `v3d_generate_mipmap` return false for sRGB formats.
ANGLE's `decodeEncodeSRGBForGenerateMipmap` passes the page, for 2D textures only.

**In oxgl:** that feature is enabled on this backend, so cube maps and 2D arrays
still filter in encoded space on V3D. ES 3.0.6 §3.8.10.5 requires no particular
filter, so that stays.

## Mesa: V3D multisample resolve overtakes draws that read its destination

**Where to file:** Mesa, `broadcom` label.

**Summary:** `v3d_blit` flushes the jobs that write the blit's destination, not
the jobs that read it. A queued draw that samples a texture, followed by a
multisample resolve into that texture, samples the new contents. Blits and
copies between single-sampled surfaces aren't affected. The cause is read from
the source; the failure is reproduced below.

**Reproducer,** through WebGL 2 on V3D, for `RGBA8` and `RGBA16F`:

```js
resolve(green);                 // clear a 4x framebuffer, blit it into texture t
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
draw(sampling(t));              // queued, not flushed
resolve(red);                   // the same blit, now with red
gl.readPixels(...);             // V3D: 255,0,0,255. Expected 0,255,0,255.
```

A `gl.flush()` before the second resolve gives the expected result. three.js's
`webgl_mirror` shows it: a `Reflector` rendered twice in a frame shows the second
rendering in the first one's draws.

**Suggested fix:** have `v3d_blit` also flush the jobs that read the destination.

**In oxgl:** `blitFramebuffer` flushes first on this backend.

## ANGLE: the GL backend allows contexts on one thread only

**Where to file:** ANGLE, GL backend. This may be a known limit rather than a bug.

**Summary:** without a virtualization group, every context shares one native
EGL context, which can be current on one thread. A second thread's
`eglMakeCurrent` fails with `EGL_BAD_ACCESS` (0x3002). With
`EGL_CONTEXT_VIRTUALIZATION_GROUP_ANGLE` per thread, both threads render.

**In oxgl:** each thread gets its own group on this display. Before that, `'gpu'`
threw in the second thread, and `'auto'` gave it SwiftShader. A live context on the
main thread plus one in a worker reproduces it.

**Khronos test:** `conformance/offscreencanvas/offscreencanvas-transfer-image-bitmap.html`.

## ANGLE: a native context leaks when its last thread exits

**Don't file this.** ANGLE commit 6b3dcfc640 ("Move makeCurrent before
destroyContext to GL backend", landed 2026-11-05) fixes it upstream, as part of a
refactor. As of 2026-11-06, Chrome stable, beta and dev don't include that commit.

**Summary:** with a virtualization group per thread, a thread that ends after
destroying its last context leaks one Mesa context, about 2 MB. ANGLE makes the
native context current to tear it down, then `destroyNativeContext` calls
`eglDestroyContext` while it's still current. Mesa defers deletion to the unbind,
and the thread exits instead. 100 thread cycles took the heap from 3.6 MB to
102 MB, and plain Mesa with threads stays flat.

**In oxgl:** `angle-8103.3` carries `angle-gl-destroy-native-context.patch`, which
unbinds the context first, until a pin includes the upstream commit. On the Pi it
cut the loss from 1.97 MB per worker cycle to 0.037 MB of RSS growth.

## ANGLE: KHR_parallel_shader_compile is exposed without parallelism

**Where to file:** ANGLE, GL backend. Low priority.

**Summary:** ANGLE exposes the extension when the driver has
`glMaxShaderCompilerThreadsKHR`, but compiles synchronously on the GL backend,
and Mesa finishes before returning. The Khronos page sizes its shader by timing
`LINK_STATUS`, gets 0 ms, and quadruples the source until one call takes 127 s,
past the harness's 60 s idle limit.

**Khronos test:** `conformance/extensions/khr-parallel-shader-compile.html`.

**In oxgl:** `disableNativeParallelCompile` hides the extension, and the page passes.

## Mesa: llvmpipe clips with disabled clip distances

**Where to file:** Mesa, `gallium`/`llvmpipe` label.

**Summary:** `draw_llvm.c` clips by every clip distance the shader writes, ignoring
`clip_plane_enable`, so a disabled distance still clips. Reproduced on Mesa 25.2.8
and 26.2.2. The code to fix:

```c
if (num_written_clipdistance && !clip_user) {
   clip_user = true;
   ucp_enable = (1 << num_written_clipdistance) - 1;
}
```

**Khronos test:** `conformance2/extensions/webgl-clip-cull-distance.html`.

**In oxgl:** `emulateClipDistanceState` is enabled, and oxgl uses llvmpipe only in
its test job.

## ANGLE: Metal reads stale pixels when threads share a display

**Where to file:** ANGLE, Metal backend. The code is unchanged on ANGLE `main`.

**Summary:** all contexts on one `EGLDisplay` share one `mtl::CommandQueue`, but
each records its own command buffer. `mCompletedBufferSerial` and
`mCommittedBufferSerial` are high-water marks, which assumes serials finish in
order. When another thread's buffer N+1 completes, this thread's open buffer N
counts as complete, so `readPixels` doesn't flush it and returns old contents,
with no error.

**Reproducer:** on one display, thread A clears without a read or flush, thread
B creates a context, then thread A clears and reads. Two threads looping clear
and read also get stale pixels. `glFlush` on thread A avoids it and recovers.

**Suggested fix:** track completion per serial. A tested patch cleared the stale
reads in a C stress run.

**In oxgl:** each thread uses its own display, through a pool of native display
keys, which avoids both this and the crash below. With the patch alone, the crash
remains.

## ANGLE: Metal crashes when threads share a display

**Where to file:** ANGLE, Metal backend.

**Summary:** `mtl::StateCache` is an unlocked per-display `HashMap`, so threads
drawing on one display race on it. A four-thread stress run segfaulted the process
about 1 run in 50 (3 of 150). `RenderUtils` is also per-display and unlocked, and
hasn't been audited.

**In oxgl:** avoided the same way as the stale pixels.

## Fixed upstream: nothing to file

`gl-scissor-test.html` (a scissored multisampled draw) and
`blitframebuffer-filter-outofbounds.html` fail on llvmpipe in Mesa 25.2.8, and
pass in 26.2.2. CI's Ubuntu 24.04 has the older one. oxgl enables
`clipSrcRegionForBlitFramebuffer` for the blit.

## Not understood

`occlusion-query-scissor.html` fails only on x64 under Docker's emulation, where
the query undercounts, and passes on arm64 with Mesa 25.2.8 and 26.2.2. A plain
Mesa probe on x64 hasn't been run, so ANGLE isn't excluded.
