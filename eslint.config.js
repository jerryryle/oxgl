import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // test/fixtures/dom-types/ imports the built dist/, which lint runs without;
  // pixel-readback.test.mjs type-checks it after the build.
  { ignores: ['dist/', 'target/', 'node_modules/', 'openspec/', '.claude/', '.cache/', 'test/fixtures/conformance/suite/', 'test/fixtures/threejs/release/', 'test/fixtures/dom-types/'] },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
);
