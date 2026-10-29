# Spec Delta

## ADDED Requirements

### Requirement: Closure-loaded scripts run in browser order
When a page loads scripts through the Closure Library's uncompiled loader (`goog.require` in `closure-library/closure/goog/base.js`, as every `deqp/` page does), each file the loader imports SHALL run before the import returns, dependencies first, as a script written with `document.write` during parsing runs in a browser (HTML Standard §8.4.3). Each imported file SHALL fail on its own, as a failed or throwing script does in a browser.

#### Scenario: deqp namespace defined before the page uses it
- **WHEN** a page calls `goog.require('functional.gles3.es3fAttribLocationTests')` from a `<head>` script and calls that namespace's `run` from a later `<body>` script (Khronos `deqp/functional/gles3/attriblocation.html`)
- **THEN** the `<body>` script finds the namespace defined and the page goes on to create its context, instead of throwing `ReferenceError: functional is not defined`

#### Scenario: Error in an imported file
- **WHEN** one file the loader imports throws at its top level and the page expects to pass
- **THEN** that error is recorded as the page's escaped error with the imported file named in it, the files imported after it still run, and the page is judged as any page with an escaped error is

#### Scenario: Imported file missing
- **WHEN** the dependency table names a file that does not exist under the suite root, or one on another origin
- **THEN** the file is not run, the namespaces it would provide stay undefined, and the page fails from its own scripts rather than with a harness error
