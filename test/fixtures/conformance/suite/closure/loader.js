// Minimal stand-in for Closure's uncompiled loader (closure-library's
// base.js): goog.require imports the files goog.deps names, dependencies
// first and each once, through CLOSURE_IMPORT_SCRIPT if it is set and
// document.write otherwise, as goog.importScript_ does.
var goog = { deps: {}, written: {} };
goog.require = function (name) {
  var dep = goog.deps[name];
  dep.requires.forEach(goog.require);
  var src = new URL(dep.src, location.href).href;
  if (goog.written[src]) return;
  var importScript = window.CLOSURE_IMPORT_SCRIPT || function (url) {
    document.write('<script src="' + url + '"></' + 'script>');
    return true;
  };
  if (importScript(src)) goog.written[src] = true;
};
