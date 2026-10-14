import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', 'public/master', 'playwright-report', 'test-results', 'work', 'private', 'coverage'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // 日本語の表示文言では全角スペースで区切ることがある
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true, skipJSXText: true }],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'e2e/**/*.ts', '*.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    extends: [js.configs.recommended],
  },
);
