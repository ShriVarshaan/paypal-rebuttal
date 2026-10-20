import type { ListingSnapshot } from "@rebuttal/core";
import React from "react";

export interface ListingViewProps {
  snapshot: ListingSnapshot;
  mode?: "current" | "historical";
  assetBaseUrl?: string;
}

function assetUrl(src: string, base?: string): string {
  if (!base || /^(?:https?:|data:|file:)/.test(src)) return src;
  return `${base.replace(/\/$/, "")}/${src.replace(/^\//, "")}`;
}

function attributeLabel(key: string): string {
  return key.replaceAll("_", " ");
}

export function ListingView({ snapshot, mode = "current", assetBaseUrl }: ListingViewProps) {
  const hero = snapshot.assets.find((asset) => asset.role === "hero") ?? snapshot.assets[0];
  const price = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: snapshot.currency,
  }).format(snapshot.priceCents / 100);

  return (
    <article className="ff-listing" data-renderer-version={snapshot.rendererVersion}>
      <div className="ff-listing__frame">
        <p className="ff-listing__eyebrow">
          <span>Fern &amp; Field Goods</span>
          <span className="ff-listing__badge">
            {mode === "historical" ? `Archived listing · revision ${snapshot.revision}` : "Current listing"}
          </span>
        </p>
        <div className="ff-listing__grid">
          <div className="ff-listing__media">
            {hero ? (
              <img className="ff-listing__image" src={assetUrl(hero.src, assetBaseUrl)} alt={hero.alt} />
            ) : (
              <div className="ff-listing__empty">No listing image</div>
            )}
          </div>
          <div className="ff-listing__content">
            <h1 className="ff-listing__title">{snapshot.title}</h1>
            <p className="ff-listing__price">{price}</p>
            <p className="ff-listing__description">{snapshot.description}</p>
            <div className="ff-listing__rule" />
            <dl className="ff-listing__facts">
              {Object.entries(snapshot.attributes).map(([key, value]) => (
                <div className="ff-listing__fact" key={key}>
                  <dt>{attributeLabel(key)}</dt>
                  <dd>
                    {typeof value === "string" || typeof value === "number" ? value : JSON.stringify(value)}
                  </dd>
                </div>
              ))}
            </dl>
            {mode === "historical" ? (
              <p className="ff-listing__note">
                This archived page is rendered only from the immutable listing snapshot captured at purchase
                time.
              </p>
            ) : null}
            <p className="ff-listing__stamp">
              Captured {new Date(snapshot.capturedAt).toISOString()} · {snapshot.rendererVersion}
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}
