# Spec Delta

## ADDED Requirements

### Requirement: Pages run in parallel
The conformance command SHALL accept an option setting how many pages run at once, defaulting to the number of CPUs available to the process (at least one).

#### Scenario: Default parallelism
- **WHEN** a developer runs the command without the parallelism option on a machine where 4 CPUs are available to the process
- **THEN** up to 4 pages run at once, and the report records 4 as the number of pages run in parallel
