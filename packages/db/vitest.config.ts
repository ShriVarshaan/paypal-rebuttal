import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["@rebuttal/testkit/global-setup"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
