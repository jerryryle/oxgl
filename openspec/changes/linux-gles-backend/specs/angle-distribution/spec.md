## MODIFIED Requirements

### Requirement: Backends enabled per platform
Every bundle SHALL include SwiftShader (via ANGLE's Vulkan backend). The Linux bundles (x64 and arm64) SHALL also enable ANGLE's Vulkan backend for hardware devices and ANGLE's OpenGL ES backend (`angle_enable_gl = true`) on the system's EGL driver. The macOS bundle SHALL enable its Metal backend, and the Windows bundles (x64 and arm64) their D3D11 backend. The macOS and Windows bundles SHALL NOT enable ANGLE's GL backend.

#### Scenario: Software backend available everywhere
- **WHEN** an EGL display is requested with the Vulkan platform type and SwiftShader device type from any platform bundle
- **THEN** display initialization succeeds on a machine with no GPU

#### Scenario: Platform GPU backend compiled in
- **WHEN** the build-info of each bundle is read
- **THEN** it shows Vulkan and GL enabled on both Linux bundles, Metal enabled and GL disabled on macOS, and D3D11 enabled and GL disabled on both Windows bundles

#### Scenario: OpenGL ES display on Mesa's surfaceless platform
- **WHEN** an EGL display is requested from a Linux bundle with the OpenGL ES platform type and native platform type `EGL_PLATFORM_SURFACELESS_MESA`, on a machine with Mesa's EGL installed
- **THEN** display initialization succeeds and an OpenGL ES 3.0 context can be created and made current without a surface

### Requirement: No window-system dependency
Bundled libraries SHALL load and create contexts without a window system. The Linux libraries SHALL NOT have link-time dependencies on X11, Wayland, GBM, libdrm, or any system EGL or GL library, and no platform SHALL require a display or session to be present. The system EGL library (`libEGL.so.1`) SHALL be opened only at run time, when an OpenGL ES display is initialized, so loading a bundle and using its Vulkan or SwiftShader displays SHALL work on a machine with no system EGL or GL libraries.

#### Scenario: Linux libraries have no X11 linkage
- **WHEN** the dynamic dependencies of the Linux bundle's libraries are listed
- **THEN** none of `libX11`, `libxcb`, or `libwayland-client` appear

#### Scenario: Linux libraries link no system graphics library
- **WHEN** the dynamic dependencies of the Linux bundle's libraries are listed
- **THEN** none of `libEGL.so.1`, `libGL`, `libGLESv2.so.2`, `libgbm` or `libdrm` appear, and only glibc's libraries, `libgcc_s` and `libm` remain

#### Scenario: Headless host
- **WHEN** a SwiftShader display is initialized on a Linux host with no `DISPLAY` or `WAYLAND_DISPLAY` set
- **THEN** initialization succeeds

#### Scenario: No Mesa installed
- **WHEN** oxgl is imported on a Linux machine with no system EGL or GL libraries, and Vulkan and SwiftShader contexts are created
- **THEN** both are created and render, and no attempt is made to open `libEGL.so.1`
