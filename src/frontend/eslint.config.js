import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import stylistic from '@stylistic/eslint-plugin'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      '@stylistic': stylistic,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // =======================================================================
      // React Rules Overrides
      // =======================================================================

      // Allow setState in effects for valid patterns like auto-connect
      'react-hooks/set-state-in-effect': 'off',

      // Allow unused variables prefixed with underscore
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      // =======================================================================
      // Stylistic Rules - Code Formatting
      // =======================================================================

      // Indentation: 2 spaces
      '@stylistic/indent': ['error', 2],

      // Quotes: single quotes for strings
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],

      // Semicolons: no semicolons (like Prettier's default for modern JS)
      '@stylistic/semi': ['error', 'never'],

      // Trailing commas: ES5 compatible (arrays, objects)
      '@stylistic/comma-dangle': ['error', 'always-multiline'],

      // Max line length: 100 characters
      '@stylistic/max-len': ['warn', { code: 100, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreUrls: true }],

      // Object/array formatting
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/array-bracket-spacing': ['error', 'never'],

      // Arrow functions: parentheses only when needed
      '@stylistic/arrow-parens': ['error', 'as-needed'],

      // JSX formatting
      '@stylistic/jsx-quotes': ['error', 'prefer-double'],
      '@stylistic/jsx-indent-props': ['error', 2],
      '@stylistic/jsx-closing-bracket-location': ['error', 'line-aligned'],
      '@stylistic/jsx-first-prop-new-line': ['error', 'multiline'],
      '@stylistic/jsx-max-props-per-line': ['error', { maximum: 1, when: 'multiline' }],

      // General formatting
      '@stylistic/eol-last': ['error', 'always'],
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0 }],
      '@stylistic/comma-spacing': ['error', { before: false, after: true }],
      '@stylistic/key-spacing': ['error', { beforeColon: false, afterColon: true }],
      '@stylistic/space-before-blocks': 'error',
      '@stylistic/space-infix-ops': 'error',
      '@stylistic/keyword-spacing': ['error', { before: true, after: true }],
      '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
    },
  },
  // Disable react-refresh for test utilities and context files
  {
    files: ['**/test/**', '**/*.test.{ts,tsx}', '**/contexts/**'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
