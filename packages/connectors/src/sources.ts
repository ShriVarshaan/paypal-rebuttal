import { createEasyPostSource, createOfflineEasyPostSource } from "./easypost.js";
import { createHttpStoreClient, loadFixtureStore, type StoreClient } from "./store/client.js";
import { createAccountSource, createDownloadLogSource, createMessagesSource } from "./store-sources.js";
import type { EvidenceSource } from "./types.js";

/**
 * The store the connectors read: the demo store's API when STORE_API_URL is set, otherwise
 * the fixture store (fixtures/store/store.json) that matches the simulator's disputes.
 */
export function defaultStore(env: NodeJS.ProcessEnv = process.env): StoreClient {
  const url = env["STORE_API_URL"];
  if (url && env["SIMULATOR"] !== "1") {
    return createHttpStoreClient({
      baseUrl: url,
      ...(env["STORE_API_TOKEN"] ? { token: env["STORE_API_TOKEN"] } : {}),
    });
  }
  return loadFixtureStore();
}

/** Every connector the `case.gather` job runs. Add new sources here. */
export function defaultSources(env: NodeJS.ProcessEnv = process.env): EvidenceSource[] {
  const offline = env["SIMULATOR"] === "1" || !env["EASYPOST_API_KEY"];
  const store = defaultStore(env);
  return [
    offline ? createOfflineEasyPostSource() : createEasyPostSource({ apiKey: env["EASYPOST_API_KEY"]! }),
    createMessagesSource(store),
    createDownloadLogSource(store),
    createAccountSource(store),
  ];
}
