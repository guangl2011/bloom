import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Docker deploy target: emits a self-contained server for the compose stack.
  output: 'standalone',
}

export default nextConfig
