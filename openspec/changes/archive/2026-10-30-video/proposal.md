# Proposal

## Why

About 180 Khronos pages upload video frames. With no video decoder, the runner failed every video load, so those pages skipped their video cases and passed without testing anything, and three pages that need a playing video failed. oxgl already takes frames from a host's decoder hook, so the runner can supply them with ffmpeg.

## What Changes

- **oxgl**: a video element's upload asks the host's internal image decoder for its current frame, and uploads 0×0 only when there is none.
- **Runner**:
  - Media elements load, play and report their video's size and duration (`conformance/video.mjs`). ffprobe reads the metadata, applying rotation as browsers do, and ffmpeg decodes frames as RGBA8, once per half second of media time.
  - `canPlayType` answers "maybe" for video types, `play()` resolves once the video has loaded, `requestVideoFrameCallback` calls back on the next frame, and a source that does not decode fires `error` and rejects `play()`.
  - Videos and ImageBitmaps drawn into 2D canvases draw their pixels, and `createImageBitmap` takes videos.
- **ffmpeg required**: `npm run conformance` refuses to run without ffmpeg and ffprobe, as it does without the canvas package. Without them the video pages would skip and pass, and runs would not match the expectations.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `conformance-testing`, `textures`.

## Impact

- `src/context.ts`, `conformance/{page,run,video}.mjs`, test fixtures (a 609-byte WebM). ffmpeg becomes a prerequisite for conformance runs, not for oxgl. No ABI change.
