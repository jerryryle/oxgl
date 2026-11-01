## ADDED Requirements

### Requirement: Same line endings on every host
The repository SHALL declare in `.gitattributes` that text files are stored and checked out with LF line endings, so a checkout's text files, including test fixtures, are byte-identical on every host. Git's own detection decides which files are text; binary files SHALL be left unchanged.

#### Scenario: Fixture read on Windows
- **WHEN** the repository is cloned on Windows with Git's default `core.autocrlf=true` and the suite-server test reads `served.txt` through the suite server
- **THEN** it receives `served\n`, as on Linux and macOS
