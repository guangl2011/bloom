import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/**/src/**/*.test.ts',
      'services/**/src/**/*.test.ts',
      'adapters/**/src/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
  },
})
