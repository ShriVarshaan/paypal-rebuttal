import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  transpilePackages: ["@rebuttal/core"],
  poweredByHeader: false,
  webpack(config) {
    // Core follows NodeNext and writes local TypeScript imports with their
    // emitted `.js` extension. Resolve those specifiers back to workspace
    // source while Next compiles the package for the browser.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };

    return config;
  },
};

export default nextConfig;
