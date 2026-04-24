/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@app/shared'],
  experimental: {
    typedRoutes: false,
  },
  output: 'standalone',
};

export default nextConfig;
