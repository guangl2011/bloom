import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Docker deploy target: emits a self-contained server for the compose stack.
  output: 'standalone',
  // Workspace packages export TS sources; without transpiling, the standalone
  // server would try to require .ts files at runtime.
  transpilePackages: ['@bloom/interfaces'],
}

export default nextConfig
