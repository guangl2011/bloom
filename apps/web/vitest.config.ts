import { defineConfig } from 'vitest/config'

/**
 * Web-only test config: component tests run in jsdom with React 19.
 * Root `pnpm test` chains this after the node-environment suites.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['**/*.test.{ts,tsx}'],
  },
})
