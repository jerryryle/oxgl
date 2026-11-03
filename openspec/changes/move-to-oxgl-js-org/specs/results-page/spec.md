# Spec Delta

## MODIFIED Requirements

### Requirement: The page explains itself
The page SHALL say what oxgl is and what the page shows, and SHALL link to the oxgl repository, to both expectations files, and to the oxgl commit whose CI run produced the results, naming the page's own commit too when it differs. It SHALL name when the results were produced (the newest report's timestamp), the conformance suite commit and the pinned three.js release.

#### Scenario: A reader arrives from a link
- **WHEN** someone opens the page without knowing oxgl
- **THEN** its opening text says what oxgl is and what the table shows, and links to `https://github.com/oxgl-js/oxgl`

#### Scenario: Republished from earlier results
- **WHEN** a page-only change at commit `c0ffee1` rebuilds the page from the reports of a run on commit `b31fde2`
- **THEN** the page names `b31fde2` as the commit its results come from, and says the page itself was built at `c0ffee1`

#### Scenario: Results commit
- **WHEN** the page was built from a CI run that tested oxgl commit `b31fde2`
- **THEN** the page names `b31fde2` and links to it in the repository, not the conformance suite's or three.js's commit
