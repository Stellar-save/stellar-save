/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Disable SWC native binary — avoids the 34 MB @next/swc-win32-x64-msvc download.
  // Uses Babel transform instead, which is slower but avoids the binary download.
  experimental: {
    forceSwcTransforms: false,
  },
}

export default nextConfig
