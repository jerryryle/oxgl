# Design

## Decisions

### GL decides when a deleted shader or program is gone

`deleteShader` and `deleteProgram` call GL at once, as before, but `oxgl-core` keeps the object's slot when GL still reports it (`glIsShader`/`glIsProgram`), in a short list of flagged keys. The list is swept, dropping slots GL has freed, where GL can free them: after `detachShader`, `useProgram` and a program's deletion. Name reuse is not possible before the sweep, since GL frees the name only at those calls. The JS layer, which marks objects deleted, asks native code whether a deleted shader or program is still alive before rejecting it; that query only runs for deleted objects. This replaces the JS-only deferral of program deletion added for deqp's `lifetime.delete_used`.

### Checks that Chromium makes before GL

The bound-texture check, the location link check and the color-attachment maximum are made in `oxgl-core` before the GL call. Each applies only to targets the call takes, so an invalid target still gets GL's `INVALID_ENUM`. The color-attachment check also prevents a second, different error from the attachment query `attach` makes after the GL call.

### Safety rules

No new `unsafe` beyond two `value_calls!` entries (`glIsShader`, `glIsProgram`); no panics; the flagged list holds slotmap keys only.
