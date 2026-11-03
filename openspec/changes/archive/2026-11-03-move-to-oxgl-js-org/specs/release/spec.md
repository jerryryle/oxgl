# Spec Delta

## MODIFIED Requirements

### Requirement: Trusted publishing with provenance
The release SHALL authenticate to npm through trusted publishing (OIDC), from a job in the `npm` GitHub environment, which only `main` may deploy to. No npm token SHALL be stored in the repository or its secrets. Every package SHALL be published with a provenance attestation that names the repository, workflow and commit.

#### Scenario: Provenance visible
- **WHEN** a released version is viewed on npmjs.com
- **THEN** its provenance names `oxgl-js/oxgl`, the CI workflow and the commit the version was built from

#### Scenario: No token in the repository
- **WHEN** the repository's and the `npm` environment's secrets are listed
- **THEN** none is an npm token
