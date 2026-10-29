# Spec Delta

## Purpose

Covers how a WebGL context lists and enables extensions (WebGL 1.0 §5.14.14), and the behaviour of each extension oxgl supports.

## ADDED Requirements

### Requirement: Extension queries
`getSupportedExtensions()` SHALL return a new array of the names of the extensions oxgl supports for the context's WebGL version. `getExtension(name)` SHALL return the extension object for a supported name, compared ASCII case-insensitively (WebGL 1.0 §5.14.14), and `null` for any other name. No extension is supported until a later change adds one.

#### Scenario: No extensions yet
- **WHEN** `getSupportedExtensions()` and `getExtension('OES_texture_float')` are called on a new context
- **THEN** they return an empty array and `null`, and `getError()` returns `NO_ERROR` (cf. Khronos `conformance/extensions/get-extension.html`)

#### Scenario: Missing argument
- **WHEN** `getExtension()` is called with no arguments
- **THEN** a `TypeError` is thrown

### Requirement: Extension queries on a lost context
On a lost or destroyed context, `getSupportedExtensions()` and `getExtension(name)` SHALL return `null` without generating an error (WebGL 1.0 §5.14).

#### Scenario: After destroy
- **WHEN** a context is destroyed and `getSupportedExtensions()` is called
- **THEN** it returns `null`
