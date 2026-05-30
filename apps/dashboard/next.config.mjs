/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @f1/shared ships TypeScript source (no build step), so Next must transpile it.
  transpilePackages: ["@f1/shared"],
};

export default nextConfig;
