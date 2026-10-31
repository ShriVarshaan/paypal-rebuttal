import React from "react";
import { evidenceTypeLabel, formatDate, formatMoney, maskIp, templateKind } from "../model.js";
import type { PackExhibit, PackInput } from "../types.js";

type Data = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" && v ? v : v == null ? "—" : String(v));
const list = (v: unknown): Data[] => (Array.isArray(v) ? (v as Data[]) : []);
const yesNo = (v: unknown): string => (v === true ? "Yes" : v === false ? "No" : "Not available");

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <table className="facts">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th scope="row">{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Address({ title, value, tone }: { title: string; value: Data | null; tone?: "match" | "mismatch" }) {
  const lines = value
    ? [
        value["address_line_1"] ?? value["line1"] ?? value["street1"],
        value["address_line_2"] ?? value["line2"],
        [value["admin_area_2"] ?? value["city"], value["admin_area_1"] ?? value["state"]]
          .filter(Boolean)
          .join(", "),
        [value["postal_code"] ?? value["zip"], value["country_code"] ?? value["country"]]
          .filter(Boolean)
          .join(" "),
      ].filter((l) => typeof l === "string" && l)
    : [];
  return (
    <div className={`box ${tone ?? ""}`}>
      <div className="label">{title}</div>
      {lines.length ? (
        lines.map((l, i) => <div key={i}>{String(l)}</div>)
      ) : (
        <div className="muted">Not recorded</div>
      )}
    </div>
  );
}

const postal = (v: Data | null | undefined): string | null => {
  const p = v?.["postal_code"] ?? v?.["zip"];
  return typeof p === "string" && p ? p.replace(/\s+/g, "").toUpperCase().slice(0, 5) : null;
};

function Tracking({ data, input }: { data: Data; input: PackInput }) {
  const deliveredTo = (data["deliveredTo"] as Data | null) ?? null;
  const orderAddress =
    (input.transactionContext?.order?.shipping?.address as Data | null | undefined) ?? null;
  const shipTo: Data | null =
    orderAddress ?? (data["shippingPostalCode"] ? { postal_code: data["shippingPostalCode"] } : null);
  const a = postal(deliveredTo);
  const b = postal(shipTo);
  const match = a && b ? a === b : null;
  return (
    <>
      <Facts
        rows={[
          ["Carrier", str(data["carrier"])],
          ["Tracking number", <span className="mono">{str(data["trackingCode"])}</span>],
          ["Current status", str(data["status"])],
          ["Delivered at", formatDate(data["deliveredAt"])],
          [
            "Signature",
            data["signedBy"] ? `Signed by ${str(data["signedBy"])}` : "Not required / not recorded",
          ],
          ["Carrier tracking page", <span className="mono">{str(data["publicUrl"])}</span>],
        ]}
      />
      <h3>Delivery address compared with the order</h3>
      <div className="side-by-side avoid-break">
        <Address
          title="Order ships to"
          value={shipTo}
          tone={match === null ? undefined : match ? "match" : "mismatch"}
        />
        <Address
          title="Carrier delivered to"
          value={deliveredTo}
          tone={match === null ? undefined : match ? "match" : "mismatch"}
        />
      </div>
      <p className="verdict">
        {match === null
          ? "Postal codes could not be compared."
          : match
            ? `Postal codes match (${a}).`
            : `Postal codes differ (${b} ordered, ${a} delivered).`}
      </p>
      <h3>Carrier scan history</h3>
      <table>
        <thead>
          <tr>
            <th style={{ width: "30%" }}>Date (UTC)</th>
            <th style={{ width: "20%" }}>Status</th>
            <th>Detail</th>
            <th style={{ width: "22%" }}>Location</th>
          </tr>
        </thead>
        <tbody>
          {list(data["events"]).map((e, i) => {
            const loc = (e["location"] as Data | null) ?? null;
            return (
              <tr key={i}>
                <td className="mono">{formatDate(e["at"])}</td>
                <td>{str(e["status"])}</td>
                <td>{str(e["message"])}</td>
                <td>{loc ? [loc["city"], loc["state"], loc["zip"]].filter(Boolean).join(", ") : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function Listing({ data, image }: { data: Data; image: string | null }) {
  const price = data["price"] as { cents?: number; currency?: string } | undefined;
  return (
    <>
      <Facts
        rows={[
          ["Listing title", str(data["title"])],
          [
            "Listing version",
            `Revision ${str(data["revision"])}, published ${formatDate(data["snapshotPublishedAt"] ?? data["capturedAt"])}`,
          ],
          ["Order placed", formatDate(data["orderedAt"])],
          [
            "Price at purchase",
            price?.cents != null && price.currency ? formatMoney(price.cents, price.currency) : "—",
          ],
          ["Screenshot captured", formatDate(data["screenshotCapturedAt"])],
        ]}
      />
      <p className="muted">
        This is the listing as it was live when the buyer ordered. It was published before the order and is
        stored as an unchangeable revision.
      </p>
      <h3>Description at purchase</h3>
      <p className="pre">{str(data["description"])}</p>
      {image ? (
        <>
          <h3>Screenshot of the listing page at purchase</h3>
          <img alt="Listing page as shown at purchase" className="screenshot" src={image} />
        </>
      ) : (
        <p className="muted">
          A screenshot was not available; the structured listing record above is reproduced instead.
        </p>
      )}
    </>
  );
}

function ListingDiff({ data }: { data: Data }) {
  const before = (data["originalSnapshot"] as Data) ?? {};
  const after = (data["currentSnapshot"] as Data) ?? {};
  const changed = new Set(list(data["changedFields"]).map(String));
  const row = (field: string, label: string) => (
    <tr key={field}>
      <th scope="row">{label}</th>
      <td className={`pre ${changed.has(field) ? "diff-old" : ""}`}>{str(before[field])}</td>
      <td className={`pre ${changed.has(field) ? "diff-new" : ""}`}>{str(after[field])}</td>
    </tr>
  );
  return (
    <>
      <p>
        The listing was edited after this order. The buyer purchased revision {str(before["revision"])}; the
        store now shows revision {str(after["revision"])}. The buyer&apos;s purchase is governed by the
        earlier version.
      </p>
      <table>
        <thead>
          <tr>
            <th style={{ width: "16%" }}>Field</th>
            <th>
              At purchase (rev. {str(before["revision"])}, {formatDate(before["capturedAt"], false)})
            </th>
            <th>
              Current (rev. {str(after["revision"])}, {formatDate(after["capturedAt"], false)})
            </th>
          </tr>
        </thead>
        <tbody>
          {row("title", "Title")}
          {row("description", "Description")}
        </tbody>
      </table>
    </>
  );
}

const FLAGGED = new Set(["admits_receipt", "threatening", "asks_refund"]);
const FLAG_TEXT: Record<string, string> = {
  admits_receipt: "Buyer confirms receipt",
  threatening: "Threat or abuse",
  asks_refund: "Asks for refund",
};

function Messages({ data }: { data: Data }) {
  const messages = list(data["messages"]);
  return (
    <>
      <Facts
        rows={[
          ["Messages", String(messages.length)],
          ["Seller replied", yesNo(data["sellerReplied"])],
          [
            "First seller reply",
            typeof data["firstSellerReplyHours"] === "number"
              ? `${Math.round(data["firstSellerReplyHours"] as number)} hour(s) after the buyer wrote`
              : "—",
          ],
        ]}
      />
      <p className="muted">
        Highlighted rows were flagged by the seller&apos;s message review. Text is reproduced verbatim.
      </p>
      <table>
        <thead>
          <tr>
            <th style={{ width: "24%" }}>Date (UTC)</th>
            <th style={{ width: "12%" }}>From</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {messages.map((m, i) => {
            const label = (m["classification"] as { label?: string } | undefined)?.label;
            const flagged = label && FLAGGED.has(label);
            return (
              <tr className={flagged ? "flag" : undefined} key={i}>
                <td className="mono">{formatDate(m["at"])}</td>
                <td>{str(m["from"]).toLowerCase()}</td>
                <td className="pre">
                  {str(m["text"])}
                  {flagged ? <span className="tag">{FLAG_TEXT[label!]}</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function AccessLog({ data }: { data: Data }) {
  return (
    <>
      <Facts
        rows={[
          ["Accesses after purchase", str(data["accessCount"])],
          ["First access", formatDate(data["firstAccessAt"])],
          ["Accessed after purchase", yesNo(data["accessedAfterPurchase"])],
          ["Access IP matches checkout IP", yesNo(data["ipMatchesCheckout"])],
        ]}
      />
      <table>
        <thead>
          <tr>
            <th style={{ width: "32%" }}>Date (UTC)</th>
            <th>Action</th>
            <th style={{ width: "26%" }}>IP (masked)</th>
            <th style={{ width: "20%" }}>Device</th>
          </tr>
        </thead>
        <tbody>
          {list(data["events"]).map((e, i) => (
            <tr key={i}>
              <td className="mono">{formatDate(e["at"])}</td>
              <td>{str(e["action"]).replaceAll("_", " ")}</td>
              <td className="mono">{maskIp(e["ip"])}</td>
              <td>{str(e["device"] ?? e["userAgent"])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Order({ data }: { data: Data }) {
  const currency = typeof data["currency"] === "string" ? data["currency"] : "USD";
  const items = list(data["items"]);
  return (
    <>
      <Facts
        rows={[
          ["Order", <span className="mono">{str(data["orderId"])}</span>],
          ["Invoice", <span className="mono">{str(data["invoiceNumber"])}</span>],
          ["PayPal capture", <span className="mono">{str(data["paypalCaptureId"])}</span>],
          ["Placed", formatDate(data["placedAt"])],
          [
            "Order total",
            typeof data["totalCents"] === "number"
              ? formatMoney(data["totalCents"] as number, currency)
              : "—",
          ],
        ]}
      />
      <h3>Items</h3>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th style={{ width: "18%" }}>SKU</th>
            <th style={{ width: "10%" }}>Qty</th>
            <th style={{ width: "18%" }}>Unit price</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i}>
              <td>
                {str(item["name"])}
                {item["digital"] ? <span className="tag">Digital</span> : null}
              </td>
              <td className="mono">{str(item["sku"])}</td>
              <td>{str(item["quantity"] ?? 1)}</td>
              <td>
                {typeof item["unitPriceCents"] === "number"
                  ? formatMoney(item["unitPriceCents"] as number, currency)
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {list(data["shipments"]).length ? (
        <>
          <h3>Shipments</h3>
          <table>
            <thead>
              <tr>
                <th>Carrier</th>
                <th>Tracking number</th>
                <th>Status</th>
                <th>Shipped</th>
                <th>Delivered</th>
              </tr>
            </thead>
            <tbody>
              {list(data["shipments"]).map((s, i) => (
                <tr key={i}>
                  <td>{str(s["carrier"])}</td>
                  <td className="mono">{str(s["trackingNumber"])}</td>
                  <td>{str(s["status"])}</td>
                  <td className="mono">{formatDate(s["shippedAt"])}</td>
                  <td className="mono">{formatDate(s["deliveredAt"])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </>
  );
}

function ReturnPolicy({ data }: { data: Data }) {
  return (
    <>
      <Facts
        rows={[
          [
            "Return window",
            typeof data["returnWindowDays"] === "number" ? `${data["returnWindowDays"]} days` : "—",
          ],
          ["Published", formatDate(data["publishedAt"])],
          ["Shown at", <span className="mono">{str(data["url"])}</span>],
        ]}
      />
      <h3>Policy text as published</h3>
      <p className="pre">{str(data["text"])}</p>
    </>
  );
}

function Generic({ data }: { data: Data }) {
  const rows = Object.entries(data)
    .filter(([k, v]) => k !== "kind" && (typeof v !== "object" || v === null))
    .map(([k, v]): [string, React.ReactNode] => [
      k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
      typeof v === "string" && !Number.isNaN(Date.parse(v)) && /\d{4}-\d{2}-\d{2}T/.test(v)
        ? formatDate(v)
        : str(v),
    ]);
  return rows.length ? <Facts rows={rows} /> : <p className="muted">No structured fields.</p>;
}

function CheckoutRisk({ data }: { data: Data }) {
  return (
    <Facts
      rows={[
        ["Billing address verification (AVS)", yesNo(data["avsMatch"])],
        ["Card security code (CVV)", yesNo(data["cvvMatch"])],
        ["Checkout IP seen on buyer's earlier orders", yesNo(data["ipMatch"])],
        ["Checkout device seen on buyer's earlier orders", yesNo(data["deviceMatch"])],
      ]}
    />
  );
}

function BuyerHistory({ data }: { data: Data }) {
  return (
    <Facts
      rows={[
        ["Earlier orders by this buyer", str(data["priorOrders"])],
        ["Earlier disputes by this buyer", str(data["priorDisputes"])],
        [
          "Account age at purchase",
          typeof data["accountAgeDays"] === "number" ? `${data["accountAgeDays"]} days` : "—",
        ],
      ]}
    />
  );
}

export function Exhibit({
  exhibit,
  input,
  image,
}: {
  exhibit: PackExhibit;
  input: PackInput;
  image: string | null;
}) {
  const { evidence } = exhibit;
  const data = evidence.data;
  const body = (() => {
    switch (templateKind(evidence)) {
      case "carrier_tracking":
        return <Tracking data={data} input={input} />;
      case "listing_snapshot":
        return <Listing data={data} image={image} />;
      case "listing_diff":
        return <ListingDiff data={data} />;
      case "message_thread":
        return <Messages data={data} />;
      case "access_log":
        return <AccessLog data={data} />;
      case "order":
        return <Order data={data} />;
      case "return_policy":
        return <ReturnPolicy data={data} />;
      case "checkout_risk":
        return <CheckoutRisk data={data} />;
      case "buyer_history":
        return <BuyerHistory data={data} />;
      default:
        return (
          <>
            {image ? <img alt={evidence.title} className="screenshot" src={image} /> : null}
            <Generic data={data} />
          </>
        );
    }
  })();
  return (
    <article>
      <div className="exhibit-bar">
        <span className="id">Exhibit {exhibit.exhibitId}</span>
        <span className="muted">
          {evidenceTypeLabel(evidence.type)} · dispute {input.paypalDisputeId}
        </span>
      </div>
      <h1>{exhibit.heading}</h1>
      <p className="muted">{exhibit.summary}</p>
      {body}
      <p className="footnote">
        Source: {evidence.source} · record {evidence.title} · retrieved {formatDate(evidence.capturedAt)}
      </p>
    </article>
  );
}
