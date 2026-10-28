// Minimal stand-in for the suite's js-test-pre.js: reports through
// window.parent.webglTestHarness exactly as js-test-pre.js does.
var harness = window.parent.webglTestHarness;
function testPassed(msg) { harness.reportResults(location.pathname, true, msg); }
function testFailed(msg) { harness.reportResults(location.pathname, false, msg); }
function finishTest() { harness.notifyFinished(location.pathname); }
