import { resolve } from "node:path";
import { createEasyPostSource, createOfflineEasyPostSource } from "./easypost.js";
import { createHttpStoreClient, loadFixtureStore, type StoreClient } from "./store/client.js";
import {
  createAccountSource,
  createDownloadLogSource,
  createMessagesSource,
  type MessageClassifier,
} from "./store-sources.js";
import { createStorefrontCaptureService } from "./storefront-capture.js";
import { createStorefrontSource } from "./storefront.js";
import type { EvidenceSource } from "./types.js";

/**
 * The store the connectors read: the demo store's API when STORE_API_URL is set, otherwise
 * the fixture store (fixtures/store/store.json) that matches the simulator's disputes.
 */
export function defaultStore(env: NodeJS.ProcessEnv = process.env): StoreClient {
  const url = env["STORE_API_URL"];
  const selection = env["STORE_SOURCE"] ?? "auto";
  if (!["auto", "fixtures", "http"].includes(selection)) throw new Error(`Invalid STORE_SOURCE=${selection}`);
  if (selection === "http" && !url) throw new Error("STORE_SOURCE=http requires STORE_API_URL");
  if (selection !== "fixtures" && url && (selection === "http" || env["SIMULATOR"] !== "1")) {
    return createHttpStoreClient({
      baseUrl: url,
      ...(env["STORE_API_TOKEN"] ? { token: env["STORE_API_TOKEN"] } : {}),
    });
  }
  return loadFixtureStore();
}

/** Every connector the `case.gather` job runs. Add new sources here. */
export function defaultSources(
  env: NodeJS.ProcessEnv = process.env,
  opts: { classifyMessages?: MessageClassifier } = {},
): EvidenceSource[] {
  const offline = env["SIMULATOR"] === "1" || !env["EASYPOST_API_KEY"];
  const store = defaultStore(env);
  const fixtureMode =
    (env["STORE_SOURCE"] ?? "auto") === "fixtures" ||
    !env["STORE_API_URL"] ||
    ((env["STORE_SOURCE"] ?? "auto") === "auto" && env["SIMULATOR"] === "1");
  const capture = createStorefrontCaptureService({
    mode: fixtureMode ? "fixture" : "http",
    storageDir: resolve(env["EVIDENCE_STORAGE_DIR"] ?? "storage/evidence"),
    assetsDir: resolve(env["STORE_ASSETS_DIR"] ?? "apps/demo-store/public"),
    ...(env["STORE_WEB_URL"] ? { webUrl: env["STORE_WEB_URL"] } : {}),
  });
  return [
    offline ? createOfflineEasyPostSource() : createEasyPostSource({ apiKey: env["EASYPOST_API_KEY"]! }),
    createMessagesSource(store, undefined, opts.classifyMessages),
    createDownloadLogSource(store),
    createAccountSource(store),
    createStorefrontSource(store, { capture }),
  ];
}
