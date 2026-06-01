/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @f1/shared ships TypeScript source (no build step), so Next must transpile it.
  transpilePackages: ["@f1/shared"],
  // @f1/shared uses NodeNext-style ".js" extensions in its TS source. The
  // webpack builder needs to rewrite those to the real ".ts" files (esbuild /
  // vite, used by infra + vitest, already do this). Hence the webpack builder.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
