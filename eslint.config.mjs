import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '**/dist/**',
      '.types/**',
      '.atm/**',
      '.atm-temp/**',
      'release/**',
      '.turbo/**',
      'coverage/**',
      'templates/**/*.ts'
    ]
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        sourceType: 'module'
      }
    },
    rules: {
      'no-debugger': 'error',
      'no-duplicate-imports': 'error'
    }
  },
  // any-debt budget (TASK-ATD-0023): warn on new `any` in package runtime
  // sources. Tests and scripts are unbudgeted per `docs/any-debt-budget.md`.
  // The rule is set to 'warn' so existing 700+ sites do not break the build;
  // a future per-package ratchet promotes it to 'error' as those sites are
  // converted.
  {
    files: ['packages/*/src/**/*.ts'],
    ignores: [
      'packages/*/src/**/*.test.ts',
      'packages/*/src/**/__tests__/**'
    ],
    plugins: {
      '@typescript-eslint': tseslint.plugin
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module'
    },
    rules: {
      'no-debugger': 'error',
      'no-duplicate-imports': 'error'
    }
  }
];

