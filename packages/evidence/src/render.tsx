import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CoverLetter } from "./templates/cover-letter.js";
import { Exhibit } from "./templates/exhibits.js";
import { printStyles } from "./templates/styles.js";
import type { PackExhibit, PackInput, TimelineRow } from "./types.js";

function documentHtml(title: string, body: React.ReactElement): string {
  const markup = renderToStaticMarkup(body);
  const safeTitle = title.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${safeTitle}</title><style>${printStyles}</style></head><body>${markup}</body></html>`;
}

export function renderCoverHtml(input: PackInput, exhibits: PackExhibit[], timeline: TimelineRow[]): string {
  return documentHtml(
    `Seller response ${input.paypalDisputeId}`,
    <CoverLetter exhibits={exhibits} input={input} timeline={timeline} />,
  );
}

export function renderExhibitHtml(exhibit: PackExhibit, input: PackInput, image: string | null): string {
  return documentHtml(
    `Exhibit ${exhibit.exhibitId}`,
    <Exhibit exhibit={exhibit} image={image} input={input} />,
  );
}
