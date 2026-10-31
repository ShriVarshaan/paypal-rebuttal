import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// API_URL and API_TOKEN live in the root .env; server routes need them to reach the api.
// Variables already set in the environment win.
const rootEnv = resolve(import.meta.dirname, "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

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
