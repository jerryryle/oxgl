## ADDED Requirements

### Requirement: Cross-origin document images are refused
Uploading a document image (an object with `naturalWidth` and an `ownerDocument`) whose URL has another origin than its document's, and that was not requested with CORS (`crossOrigin` unset), SHALL throw a `SecurityError` `DOMException` and upload nothing (WebGL 1.0 §4.2). `data:` and `blob:` URLs SHALL count as same-origin. A document without a string `URL` SHALL have no origins, and its images SHALL be accepted.

#### Scenario: Image from another origin
- **WHEN** `texImage2D` is given an image at `http://b.test/x.png` whose document is `http://a.test/page.html`
- **THEN** a `SecurityError` is thrown (cf. Khronos `conformance/textures/misc/origin-clean-conformance.html`)

#### Scenario: Same-origin, data URL and CORS images
- **WHEN** `texImage2D` is given a relative URL, an `http://a.test/` URL, a `data:` URL, or an `http://b.test/` image with `crossOrigin` set
- **THEN** each upload succeeds
