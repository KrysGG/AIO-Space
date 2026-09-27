import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/out/**', '**/release/**', '**/node_modules/**', '**/vendor/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'error',
        { selector: "Property[key.name='nodeIntegration'][value.value=true]", message: 'nodeIntegration must stay false. See docs/SECURITY.md.' },
        { selector: "Property[key.name='contextIsolation'][value.value=false]", message: 'contextIsolation must stay true. See docs/SECURITY.md.' },
        { selector: "Property[key.name='sandbox'][value.value=false]", message: 'sandbox must stay true. See docs/SECURITY.md.' },
        { selector: "Property[key.name='webSecurity'][value.value=false]", message: 'webSecurity must stay true. See docs/SECURITY.md.' }
      ]
    }
  },
  {
    // Build scripts run by electron-builder in Node (CommonJS).
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'writable', exports: 'writable', console: 'readonly', __dirname: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
  }
);
