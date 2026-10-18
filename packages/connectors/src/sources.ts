import { createEasyPostSource, createOfflineEasyPostSource } from "./easypost.js";
import type { EvidenceSource } from "./types.js";

/** Every connector the `case.gather` job runs. Add new sources here. */
export function defaultSources(env: NodeJS.ProcessEnv = process.env): EvidenceSource[] {
  const offline = env["SIMULATOR"] === "1" || !env["EASYPOST_API_KEY"];
  return [
    offline ? createOfflineEasyPostSource() : createEasyPostSource({ apiKey: env["EASYPOST_API_KEY"]! }),
  ];
}
