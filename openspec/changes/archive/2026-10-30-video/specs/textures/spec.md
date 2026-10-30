## ADDED Requirements

### Requirement: Video frames from the host
Uploading a video element SHALL upload the frame the host's internal image decoder returns for it, and SHALL upload 0×0, as a video without data does in browsers, when there is no decoder or it returns none.

#### Scenario: Decoded video
- **WHEN** a host's decoder returns a 16×8 frame for a playing video, and the video is uploaded
- **THEN** the texture is 16×8 with that frame's pixels (cf. Khronos `conformance/textures/video/tex-2d-rgba-rgba-unsigned_byte.html`)
