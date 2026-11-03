# Spec Delta

## ADDED Requirements

### Requirement: The page says what it shows
The page SHALL say what oxgl is and what the page shows, and SHALL link to the oxgl repository, to both expectations files, and to the oxgl commit whose CI run produced the results. It SHALL name the oxgl version released from those results when there is one, when the results were produced (the newest report's timestamp), the conformance suite commit and the pinned three.js release.

#### Scenario: A reader arrives from a link
- **WHEN** someone opens the page without knowing oxgl
- **THEN** its opening text says what oxgl is and what the table shows, and links to `https://github.com/oxgl-js/oxgl`

#### Scenario: Results commit
- **WHEN** the page was built from a CI run that tested oxgl commit `b31fde2`
- **THEN** the page names `b31fde2` and links to it in the repository, not the conformance suite's or three.js's commit

#### Scenario: Deployed with a release
- **WHEN** the page is built for the release of `0.2.3` from the reports of the run that tested it
- **THEN** its opening text names version `0.2.3` and links to the `v0.2.3` GitHub Release

#### Scenario: Preview from a pull request
- **WHEN** the page is built from a pull request's `full-ci` run, which releases nothing
- **THEN** it names no version

## REMOVED Requirements

### Requirement: The page explains itself
**Reason**: The page is now always built from the reports of the commit it's deployed for, so naming a separate page commit when the two differ can't happen, and the page also names the release it shows.
**Migration**: See "The page says what it shows". The `--page-commit` option of `scripts/results-page.mjs` goes away.
