# Spec Delta

## ADDED Requirements

### Requirement: Closure-loaded scripts run in browser order
When a page loads scripts through the Closure Library's uncompiled loader (`goog.require` in `closure-library/closure/goog/base.js`, as every `deqp/` page does), each file the loader imports SHALL run before the import returns, dependencies first, as a script written with `document.write` during parsing runs in a browser (HTML Standard §8.4.3). An import requested after the document has loaded SHALL throw, as Closure's own `document.write` loader does.

#### Scenario: deqp namespace defined before the page uses it
- **WHEN** a page calls `goog.require('functional.gles3.es3fAttribLocationTests')` from a `<head>` script and calls that namespace's `run` from a later `<body>` script (Khronos `deqp/functional/gles3/attriblocation.html`)
- **THEN** the `<body>` script finds the namespace defined and the page goes on to create its context, instead of throwing `ReferenceError: functional is not defined`

#### Scenario: Require after load
- **WHEN** a page calls `goog.require` for a file not yet loaded from a timer that runs after the document's `load` event
- **THEN** the call throws as it does in a browser, the file is not run, and the error is recorded as the page's escaped error

### Requirement: Closure-loaded scripts fail on their own
An uncaught error in a file the Closure loader imports SHALL be recorded as the page's escaped error (Escaped script errors) and SHALL NOT stop the remaining imports. A file the loader names that is missing, outside the suite root or on another origin SHALL NOT be run.

#### Scenario: Error in an imported file
- **WHEN** one file the loader imports throws at its top level and the page expects to pass
- **THEN** that error is recorded as the page's escaped error with the imported file named in it, the files imported after it still run, and the page is judged as any page with an escaped error is

#### Scenario: Imported file missing
- **WHEN** the dependency table names a file that does not exist under the suite root, or one on another origin
- **THEN** the file is not run, the namespaces it would provide stay undefined, and the page fails from its own scripts rather than with a harness error
