## ADDED Requirements

### Requirement: Canvas sources ignore the read buffer
An oxgl context's canvas used as a `TexImageSource` SHALL supply its drawing buffer's color whatever read buffer that context selected with WebGL 2's `readBuffer`.

#### Scenario: Canvas whose read buffer is NONE
- **WHEN** WebGL 2 context A clears to blue and calls `readBuffer(NONE)` with its drawing buffer bound, and context B uploads `A.canvas`
- **THEN** B's texture samples blue
