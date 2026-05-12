import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '**/dist/**',
      '.types/**',
      '.atm/**',
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

