import type { ListingSnapshot } from "@rebuttal/core";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ListingView } from "./listing.js";
import { listingStyles } from "./styles.js";

export interface RenderListingOptions {
  mode?: "current" | "historical";
  assetBaseUrl?: string;
}

/** Node-only entry point used by offline Playwright evidence capture. */
export function renderListingDocument(snapshot: ListingSnapshot, options: RenderListingOptions = {}): string {
  const markup = renderToStaticMarkup(
    <ListingView snapshot={snapshot} mode={options.mode} assetBaseUrl={options.assetBaseUrl} />,
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeTitle(snapshot.title)}</title><style>${listingStyles}</style></head><body style="margin:0">${markup}</body></html>`;
}

function escapeTitle(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
