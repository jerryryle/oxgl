# backend-selection Specification

## Purpose
Defines how oxgl chooses the ANGLE rendering backend for a new context — a platform GPU backend or the SwiftShader software renderer — including the automatic fallback, the environment-variable override, and how failures are reported.

## Requirements

### Requirement: Platform GPU backends
A GPU backend SHALL be the ANGLE backend native to the platform, using a hardware device: Vulkan on Linux, Metal on macOS, D3D11 on Windows, or on Linux the OpenGL ES backend ("OpenGL ES backend on Linux"). A CPU-based driver SHALL NOT count as a GPU backend. That includes a software Vulkan implementation, and a GL driver whose renderer names llvmpipe, softpipe, swrast or a software rasterizer.

#### Scenario: GPU backend uses hardware
- **WHEN** a context is created with `backend: 'gpu'` on a machine with a supported GPU
- **THEN** the context renders through that platform's GPU backend on a hardware device

#### Scenario: Software Vulkan driver is not a GPU
- **WHEN** the only Vulkan device on a Linux machine is a CPU implementation
- **THEN** `backend: 'gpu'` fails as if no GPU were present

#### Scenario: GL driver on a CPU is not a GPU
- **WHEN** the WebGL 2 request on the Pi reaches the OpenGL ES backend and Mesa falls back to llvmpipe, for example under `LIBGL_ALWAYS_SOFTWARE=1`
- **THEN** `backend: 'gpu'` throws `OXGL_GPU_UNAVAILABLE` whose message contains the refused renderer string, which names llvmpipe, and no context is returned

#### Scenario: GPU unreachable for the user
- **WHEN** `createContext({ width: 4, height: 4, webgl2: true, backend: 'gpu' })` runs on the Pi as a user outside the `render` group, with Mesa's lavapipe Vulkan driver installed (`mesa-vulkan-drivers`), as on the observed board
- **THEN** it throws `OXGL_GPU_UNAVAILABLE` whose message contains the CPU renderer it refused, and no context is returned

### Requirement: OpenGL ES backend on Linux
On Linux, a request SHALL use ANGLE's OpenGL ES backend on the system's EGL driver, through EGL's surfaceless platform (`EGL_MESA_platform_surfaceless`), when the Vulkan display opened, was not rejected as a CPU, and offers no OpenGL ES 3.0 config. The Vulkan display SHALL then serve no context. Whether it offers OpenGL ES 3.0 SHALL be determined once, when it is opened.

#### Scenario: WebGL 2 on a GPU whose Vulkan driver gives OpenGL ES 2.0 only
- **WHEN** `createContext({ width: 64, height: 64, webgl2: true, backend: 'gpu', attributes: { antialias: false } })` runs on a Raspberry Pi 5 with Mesa's V3D GL driver installed and the user in the `render` group
- **THEN** a WebGL 2 context is returned whose `GL_RENDERER` names V3D and names neither Vulkan nor llvmpipe, and `RED_BITS`, `GREEN_BITS`, `BLUE_BITS` and `ALPHA_BITS` are each `8`

#### Scenario: Antialiased WebGL 2 through the OpenGL ES backend
- **WHEN** the same call is made with `antialias: true`
- **THEN** `getParameter(SAMPLES)` is `4` and `getContextAttributes().antialias` is `true`

#### Scenario: WebGL 1 on a GPU whose Vulkan driver gives OpenGL ES 2.0 only
- **WHEN** `createContext({ width: 4, height: 4, backend: 'gpu' })` runs on the same machine
- **THEN** the context's `GL_RENDERER` names V3D and does not name Vulkan

#### Scenario: WebGL 1 without the OpenGL ES backend
- **WHEN** the same call runs on the same machine without Mesa's EGL, or with Mesa's GL driver falling back to llvmpipe
- **THEN** `OXGL_GPU_UNAVAILABLE` is thrown, and with `backend: 'auto'` the context's `GL_RENDERER` names SwiftShader

#### Scenario: Sampler array indexed by a loop variable
- **WHEN** a WebGL 1 fragment shader on the same machine with Mesa's EGL samples `uniform sampler2D uni[2]` as `uni[i]` in a `for` loop over `i`
- **THEN** it renders the sampled colors and the process is unaffected (cf. Khronos `conformance/glsl/bugs/sampler-array-using-loop-index.html`)

#### Scenario: Vulkan with OpenGL ES 3.0 keeps Vulkan
- **WHEN** a WebGL 2 context is created with `backend: 'gpu'` on a Linux machine whose Vulkan display offers an OpenGL ES 3.0 config
- **THEN** the context renders through Vulkan and the system EGL library is never opened

### Requirement: Software backend
`backend: 'software'` SHALL create the context on SwiftShader through ANGLE, and SHALL work on machines with no GPU and no GPU drivers installed. SwiftShader SHALL be built with high-precision texture filtering (`SWIFTSHADER_HIGH_PRECISION_FILTERING`), as Chromium builds it, so that filtered sampling of normalized fixed-point textures matches Chrome's software renderer.

#### Scenario: Forced software on a GPU machine
- **WHEN** `backend: 'software'` is used on a machine that has a GPU
- **THEN** the context renders with SwiftShader, not the GPU

#### Scenario: Linear filtering of a white texel is exact
- **WHEN** a software context samples a 1×1 `RGBA`/`UNSIGNED_BYTE` texture holding `[255, 255, 255, 255]` with `LINEAR` filtering in a fragment shader
- **THEN** the sampled red component compares equal to `1.0`, and Khronos `conformance/uniforms/uniform-default-values.html` passes on WebGL 1 and WebGL 2

### Requirement: Automatic selection with fallback
`backend: 'auto'` (the default) SHALL first attempt the platform GPU backend and, if display initialization or context creation fails for any reason, SHALL create the context on SwiftShader instead. A GPU failure that is followed by a successful fallback SHALL NOT be reported as an error.

#### Scenario: No GPU available
- **WHEN** `createContext({ width: 4, height: 4 })` runs on a machine with no usable GPU
- **THEN** a context is returned that renders with SwiftShader, and `getError()` returns `NO_ERROR`

#### Scenario: GPU available
- **WHEN** `backend: 'auto'` is used on a machine with a usable GPU
- **THEN** the context renders through the GPU backend

### Requirement: GPU unavailable error
When `backend: 'gpu'` is requested (by option or override) and no GPU backend can create the context, `createContext` SHALL throw an `Error` with `code` `'OXGL_GPU_UNAVAILABLE'` whose message names each GPU backend attempted (`Vulkan`, `OpenGL ES`, `Metal` or `D3D11`) and the cause of each failure. It SHALL NOT fall back to software.

#### Scenario: Forced GPU without a GPU
- **WHEN** `backend: 'gpu'` is used on a machine with no usable GPU
- **THEN** an `Error` with `code === 'OXGL_GPU_UNAVAILABLE'` is thrown

#### Scenario: Both Linux GPU backends named
- **WHEN** a WebGL 2 request with `backend: 'gpu'` on a Linux machine reaches the OpenGL ES backend and it fails, for example because `libEGL.so.1` is not installed
- **THEN** the message names `Vulkan` with the cause "offers OpenGL ES 2.0 only" and `OpenGL ES` with its own cause

### Requirement: OXGL_BACKEND environment override
If `OXGL_BACKEND` in the calling thread's `process.env` (main thread or worker) is set to `auto`, `gpu`, or `software` at the time `createContext` is called, that value SHALL be used instead of the `backend` option. An empty or unset variable SHALL have no effect. Any other value, apart from "Test-only OXGL_BACKEND value", SHALL cause `createContext` to throw an `Error` with `code` `'OXGL_INVALID_BACKEND'` naming the variable and its value.

#### Scenario: Override forces software
- **WHEN** `OXGL_BACKEND=software` and `createContext({ width: 4, height: 4, backend: 'gpu' })` is called
- **THEN** a SwiftShader context is returned and no GPU initialization is attempted

#### Scenario: Override read per call
- **WHEN** `process.env.OXGL_BACKEND` is changed between two `createContext` calls
- **THEN** each call uses the value current at that call

#### Scenario: Override set inside a worker
- **WHEN** a worker thread sets `process.env.OXGL_BACKEND = 'software'` and calls `createContext({ width: 4, height: 4, backend: 'gpu' })`
- **THEN** a SwiftShader context is returned

#### Scenario: Invalid override value
- **WHEN** `OXGL_BACKEND=vulkan` and `createContext` is called
- **THEN** an `Error` with `code === 'OXGL_INVALID_BACKEND'` is thrown, mentioning `OXGL_BACKEND` and `vulkan`

### Requirement: Test-only OXGL_BACKEND value
In an addon built with the Cargo feature `test-gles`, and only there, `OXGL_BACKEND` SHALL also accept the value `gles`. It makes every request, WebGL 1 and WebGL 2, use only ANGLE's OpenGL ES backend on Linux, with no CPU-renderer check and no fallback. Released packages SHALL NOT be built with that feature.

#### Scenario: Test-only value rejected by a release build
- **WHEN** `OXGL_BACKEND=gles` and `createContext` is called with the published package
- **THEN** an `Error` with `code === 'OXGL_INVALID_BACKEND'` is thrown, mentioning `OXGL_BACKEND` and `gles`

#### Scenario: Test-only value on Mesa's llvmpipe
- **WHEN** an addon built with `test-gles` runs on a Linux x64 machine with Mesa's EGL and llvmpipe and no GPU, with `OXGL_BACKEND=gles`, and `createContext({ width: 4, height: 4, webgl2: true })` is called
- **THEN** a context is returned whose `GL_RENDERER` names llvmpipe and OpenGL ES

### Requirement: Display reuse and isolation
Selecting a GPU backend SHALL NOT modify process-global state visible to other code in the host process (for example environment variables, the working directory, or the system Vulkan loader configuration). Repeated context creation on the same backend SHALL reuse the initialized backend rather than re-initializing it per context.

#### Scenario: Environment untouched
- **WHEN** contexts are created on every available backend
- **THEN** `process.env` is identical before and after

### Requirement: SwiftShader initialization side effects
SwiftShader SHALL be initialized at most once per process, at the first context that uses it, never at import, so GPU-only applications are unaffected.

Accepted trade-off (known issue, upstream ANGLE): that step briefly sets `VK_ICD_FILENAMES` and, on Linux and Windows, the working directory. A thread using either at that moment can crash the process, an explicit exception to the crash rule.

#### Scenario: Import touches nothing
- **WHEN** the package is imported and only GPU contexts are created
- **THEN** ANGLE never initializes SwiftShader in the process

### Requirement: GPU initialization failure is remembered for the process
Once a GPU backend's display fails to initialize, it SHALL be treated as unavailable for the rest of the process. That covers every GPU display, and a rejection of a CPU device or renderer. A failure to create one GPU context (normal use can cause one, such as running out of GPU memory) SHALL fail only that call.

Accepted trade-off: after a transient initialization failure such as a driver reset, `'auto'` renders with SwiftShader and `'gpu'` throws until the process restarts.

#### Scenario: No retry after a GPU initialization failure
- **WHEN** GPU initialization has failed once in the process and `createContext` is called again with `backend: 'auto'`
- **THEN** a SwiftShader context is returned without another GPU initialization attempt

#### Scenario: Forced GPU after an initialization failure
- **WHEN** GPU initialization has failed once in the process and `createContext` is called with `backend: 'gpu'`
- **THEN** an `Error` with `code === 'OXGL_GPU_UNAVAILABLE'` is thrown without another GPU initialization attempt

#### Scenario: Context failure is not remembered
- **WHEN** creating a GPU context fails (for example out of GPU memory) and `createContext` is called again with `backend: 'gpu'`
- **THEN** the GPU backend is tried again for the new context

#### Scenario: OpenGL ES display failure remembered
- **WHEN** the OpenGL ES display has failed to initialize once, and another WebGL 2 context is requested with `backend: 'auto'` on a Linux machine whose Vulkan display offers OpenGL ES 2.0 only
- **THEN** a SwiftShader context is returned, and neither display is opened again

#### Scenario: Context failure on OpenGL ES does not divert to Vulkan
- **WHEN** the OpenGL ES display opened on a GPU, and creating a WebGL 1 context on it fails (for example out of GPU memory)
- **THEN** the call fails, naming `OpenGL ES`, and no context is created on Vulkan

#### Scenario: Out of memory on Vulkan does not divert to OpenGL ES
- **WHEN** the Vulkan display offers OpenGL ES 3.0 and creating a WebGL 2 context on it fails
- **THEN** the OpenGL ES backend is not tried

### Requirement: Browser behaviour on the OpenGL ES backend
A context on the Linux OpenGL ES backend SHALL behave as on the other backends: WebGL validation and `getError` (WebGL 1.0 §5.14.3), robust resource initialization (WebGL 1.0 §4.1), context loss through `WEBGL_lose_context`, `destroy()`, `encodePNG`, and texture uploads from `ImageData`-shaped objects and 2D canvases.

#### Scenario: The Node test suite on the OpenGL ES backend
- **WHEN** `npm test` runs with an addon built with `test-gles`, `OXGL_BACKEND=gles` and Mesa's llvmpipe
- **THEN** every test passes or skips with a stated reason, as with `OXGL_BACKEND=software`

#### Scenario: Contexts on two threads
- **WHEN** a context on the OpenGL ES backend is in use on the main thread, and a worker creates a context with the same `backend`
- **THEN** the worker's context renders on the same backend, and neither context is lost (cf. Khronos `conformance/offscreencanvas/offscreencanvas-transfer-image-bitmap.html`)

#### Scenario: Instance divisors past V3D's limit
- **WHEN** a WebGL 2 draw on V3D through this backend, instanced or through `WEBGL_multi_draw`, uses an attribute with a divisor above 65535 and 65536 or more instances, and that fetch would pass the end of its buffer
- **THEN** `INVALID_OPERATION` is generated, nothing is read past the buffer, and `getVertexAttrib` reports the divisor that was set (cf. Khronos `conformance2/rendering/instanced-rendering-large-divisor.html`, which stays failing, as V3D applies a divisor of at most 65535)

#### Scenario: Reading a norm16 color buffer
- **WHEN** a context on the OpenGL ES backend calls `readPixels(0, 0, 1, 1, RGBA, UNSIGNED_SHORT, pixels)` with an `RG16_EXT` framebuffer bound
- **THEN** the color is returned, no error is generated and the context is not lost (cf. Khronos `conformance2/extensions/ext-texture-norm16.html`)

#### Scenario: Robust initialization on V3D
- **WHEN** a WebGL 2 context on the Pi's OpenGL ES backend reads back a new texture through a framebuffer, a new renderbuffer, and a new buffer through `getBufferSubData`
- **THEN** every byte is `0` (cf. Khronos `conformance/misc/uninitialized-test.html`, `conformance2/misc/uninitialized-test-2.html`)

### Requirement: Truthful capabilities on the OpenGL ES backend
On the Linux OpenGL ES backend, `getSupportedExtensions` SHALL list only extensions that `getExtension` then enables, and `getContextAttributes()` and the `*_BITS` and `SAMPLES` parameters SHALL describe the drawing buffer actually allocated (WebGL 1.0 §5.2, §5.14.14).

#### Scenario: Attributes match the allocated buffer
- **WHEN** WebGL 2 contexts on the OpenGL ES backend are created with `antialias: false` and with `antialias: true`
- **THEN** `getContextAttributes()` reports `antialias` as `getParameter(SAMPLES) > 0`, and the color, depth and stencil bits match the attributes reported (cf. Khronos `conformance/context/context-attributes-alpha-depth-stencil-antialias.html`)

#### Scenario: Every reported extension enables
- **WHEN** `getExtension(name)` is called for each name `getSupportedExtensions()` returns on the OpenGL ES backend
- **THEN** each returns a non-null object (cf. Khronos `conformance/extensions/get-extension.html`)

### Requirement: One Vulkan device per process on Linux
On Linux, where the Vulkan GPU and SwiftShader share one ANGLE display, the first of them to initialize on an accepted device SHALL hold it for the process. A later request for the other SHALL fail with a message naming the backend in use, not render on the held device. `'auto'` SHALL treat a refused GPU as unavailable.

Accepted trade-off: a Linux process cannot render on a Vulkan GPU and on SwiftShader at once.

#### Scenario: Software after a Vulkan GPU context
- **WHEN** a context has been created with `backend: 'gpu'` on a Linux machine whose Vulkan GPU offers OpenGL ES 3.0, and `createContext({ width: 4, height: 4, backend: 'software' })` is called
- **THEN** an `Error` with `code === 'OXGL_CONTEXT_CREATION_FAILED'` is thrown whose message names the Vulkan GPU in use, and no context is returned

#### Scenario: GPU after a software context
- **WHEN** a context has been created with `backend: 'software'` on a Linux machine with a Vulkan GPU, and `createContext({ width: 4, height: 4, backend: 'gpu' })` is called
- **THEN** an `Error` with `code === 'OXGL_GPU_UNAVAILABLE'` is thrown whose message names SwiftShader in use, and `backend: 'auto'` returns a SwiftShader context

#### Scenario: WebGL 2 without Mesa's EGL on the Pi
- **WHEN** Mesa's EGL is not installed on the Pi and `createContext({ width: 4, height: 4, webgl2: true })` is called
- **THEN** the context's `GL_RENDERER` names SwiftShader

### Requirement: A GPU display rejected as a CPU holds nothing
A platform GPU display (Vulkan, Metal or D3D11) whose renderer is rejected as a CPU, or a Vulkan display offering OpenGL ES 2.0 only, SHALL be terminated once that is recorded, so that it holds no device and SwiftShader can initialize afterwards. An OpenGL ES display with a CPU renderer shares no device with SwiftShader and MAY be kept.

#### Scenario: Software after an OpenGL ES backend context
- **WHEN** a context has been created with `backend: 'gpu'` on a Raspberry Pi 5, through the OpenGL ES backend, and `createContext({ width: 4, height: 4, backend: 'software' })` is called
- **THEN** the second context's `GL_RENDERER` names SwiftShader

#### Scenario: Software after a Vulkan device rejected as a CPU
- **WHEN** the only Vulkan device on a Linux machine is Mesa's lavapipe, a context is created with `backend: 'auto'`, and then another with `backend: 'software'`
- **THEN** both contexts' `GL_RENDERER` names SwiftShader, not llvmpipe

### Requirement: Threads don't share a Metal display
On macOS, each thread creating GPU contexts SHALL use an ANGLE display of its own, since ANGLE's Metal backend shares its command queue and state caches across a display's contexts without a lock. A display SHALL be reused by a later thread once its thread and contexts are gone, so that their number follows the peak number of threads.

#### Scenario: Threads drawing at once
- **WHEN** several workers on macOS with `backend: 'gpu'` each clear a context to their own colors in a loop and read them back
- **THEN** every read returns that thread's latest color, no context is lost and the process doesn't crash

#### Scenario: A context left unflushed
- **WHEN** a main-thread context on macOS has cleared without a read, and a worker creates a context
- **THEN** a later read on the main thread returns the main thread's color

#### Scenario: Short-lived workers
- **WHEN** workers on macOS start, create and destroy a context, and exit, one after another
- **THEN** the number of displays and the process's memory stay flat
