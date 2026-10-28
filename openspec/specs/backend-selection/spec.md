# backend-selection Specification

## Purpose
Defines how oxgl chooses the ANGLE rendering backend for a new context — a platform GPU backend or the SwiftShader software renderer — including the automatic fallback, the environment-variable override, and how failures are reported.

## Requirements

### Requirement: Platform GPU backends
A GPU backend SHALL be the ANGLE backend native to the platform: Vulkan on Linux, Metal on macOS, D3D11 on Windows, using a hardware device. A CPU-based driver (for example a software Vulkan implementation) SHALL NOT count as a GPU backend.

#### Scenario: GPU backend uses hardware
- **WHEN** a context is created with `backend: 'gpu'` on a machine with a supported GPU
- **THEN** the context renders through that platform's GPU backend on a hardware device

#### Scenario: Software Vulkan driver is not a GPU
- **WHEN** the only Vulkan device on a Linux machine is a CPU implementation
- **THEN** `backend: 'gpu'` fails as if no GPU were present

### Requirement: Software backend
`backend: 'software'` SHALL create the context on SwiftShader through ANGLE, and SHALL work on machines with no GPU and no GPU drivers installed.

#### Scenario: Forced software on a GPU machine
- **WHEN** `backend: 'software'` is used on a machine that has a GPU
- **THEN** the context renders with SwiftShader, not the GPU

### Requirement: Automatic selection with fallback
`backend: 'auto'` (the default) SHALL first attempt the platform GPU backend and, if display initialization or context creation fails for any reason, SHALL create the context on SwiftShader instead. A GPU failure that is followed by a successful fallback SHALL NOT be reported as an error.

#### Scenario: No GPU available
- **WHEN** `createContext({ width: 4, height: 4 })` runs on a machine with no usable GPU
- **THEN** a context is returned that renders with SwiftShader, and `getError()` returns `NO_ERROR`

#### Scenario: GPU available
- **WHEN** `backend: 'auto'` is used on a machine with a usable GPU
- **THEN** the context renders through the GPU backend

### Requirement: GPU unavailable error
When `backend: 'gpu'` is requested (by option or override) and no GPU backend can create the context, `createContext` SHALL throw an `Error` with `code` `'OXGL_GPU_UNAVAILABLE'` whose message names the attempted backend and the underlying cause. It SHALL NOT fall back to software.

#### Scenario: Forced GPU without a GPU
- **WHEN** `backend: 'gpu'` is used on a machine with no usable GPU
- **THEN** an `Error` with `code === 'OXGL_GPU_UNAVAILABLE'` is thrown

### Requirement: OXGL_BACKEND environment override
If `OXGL_BACKEND` in the calling thread's `process.env` (main thread or worker) is set to `auto`, `gpu`, or `software` at the time `createContext` is called, that value SHALL be used instead of the `backend` option. An empty or unset variable SHALL have no effect. Any other value SHALL cause `createContext` to throw an `Error` with `code` `'OXGL_INVALID_BACKEND'` naming the variable and its value.

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
Once the GPU backend fails to initialize, including a CPU-only device rejection, it SHALL be treated as unavailable for the rest of the process. A failure to create one GPU context (normal use can cause one, such as running out of GPU memory) SHALL fail only that call.

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
