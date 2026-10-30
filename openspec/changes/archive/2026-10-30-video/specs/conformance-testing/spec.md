## REMOVED Requirements

### Requirement: Unsupported media fails promptly
**Reason**: Video now plays through ffmpeg ("Video plays through ffmpeg").
**Migration**: None; pages that load video run their video cases.

## ADDED Requirements

### Requirement: Video plays through ffmpeg
Video elements in a page SHALL load, play and report their size, duration and current time, decoded by ffmpeg with rotation applied. `canPlayType` SHALL answer "maybe" for video types, `play()` SHALL resolve once the video has loaded, and `requestVideoFrameCallback` SHALL call back on the next frame. A source that does not decode SHALL fire `error` and reject `play()` promptly.

#### Scenario: Video in a 2D canvas and an ImageBitmap
- **WHEN** a page draws a playing video into a 2D canvas, or creates an ImageBitmap from it
- **THEN** the current frame is drawn, or held (cf. Khronos `conformance/textures/image_bitmap_from_video/tex-2d-rgba-rgba-unsigned_byte.html`)

#### Scenario: Missing video
- **WHEN** a page sets a `<video>` source that does not exist and calls `play()`
- **THEN** `error` fires and `play()` rejects with `NotSupportedError` well before the time limit

#### Scenario: Texture upload from a video
- **WHEN** a page plays a red-above-green video and uploads it with `texImage2D`
- **THEN** the texture's top rows are red and its bottom rows green (cf. Khronos `conformance/textures/video/tex-2d-rgba-rgba-unsigned_byte.html`)

#### Scenario: Rotated video
- **WHEN** a page uploads a video with rotation metadata
- **THEN** the frame uploads upright (cf. Khronos `conformance/textures/misc/video-rotation.html`)

### Requirement: The runner requires ffmpeg
The runner SHALL refuse to run pages when `ffmpeg` or `ffprobe` cannot be run, reporting a runner error that names them, instead of running video pages that would skip their video cases.

#### Scenario: ffmpeg missing
- **WHEN** `npm run conformance` runs and `ffprobe -version` fails
- **THEN** the run stops before any page with an error naming ffmpeg, and no page outcome is recorded
