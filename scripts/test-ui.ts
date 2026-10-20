import { spawn } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "@rebuttal/paypal";

const root = findRepoRoot();
const vitest = join(root, "node_modules", "vitest", "vitest.mjs");
const child = spawn(process.execPath, [vitest, "run", "packages/connectors/src/storefront-capture.test.ts"], {
  cwd: root,
  env: { ...process.env, RUN_REAL_BROWSER: "1" },
  stdio: "inherit",
  windowsHide: true,
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
