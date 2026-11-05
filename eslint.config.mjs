import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/coverage/**', '**/*.config.js'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Azure-port design test (spec D4): cloud SDK imports are confined to the
    // deploy adapter. Everything else goes through interfaces, so a provider
    // change is a new adapter implementation — never an import elsewhere.
    files: ['**/*.{ts,tsx,js,jsx,mjs}'],
    ignores: ['adapters/adapter-deploy/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@google-cloud/*', 'googleapis', 'google-auth-library', '@google-ai/*', 'firebase', '@azure/*', '@azure'],
              message:
                'Cloud SDK imports are confined to adapters/adapter-deploy — go through an interface or add a provider adapter (Azure-port design test, spec D4).',
            },
          ],
        },
      ],
    },
  },
)
