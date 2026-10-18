// Renders the eval run as Markdown and as a standalone HTML page (plan Day 16).

export interface Table {
  head: string[];
  rows: (string | number)[][];
}
export interface Section {
  title: string;
  text?: string[];
  tables?: { caption?: string; table: Table }[];
}
export interface Report {
  title: string;
  generatedAt: string;
  headline: string[];
  sections: Section[];
}

export const usd = (cents: number) =>
  `${cents < 0 ? "−" : ""}$${Math.abs(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
export const num = (x: number | null, d = 3) => (x === null || Number.isNaN(x) ? "—" : x.toFixed(d));

function mdTable(t: Table): string {
  const esc = (v: string | number) => String(v).replace(/\|/g, "\\|");
  return [
    `| ${t.head.map(esc).join(" | ")} |`,
    `|${t.head.map(() => "---").join("|")}|`,
    ...t.rows.map((r) => `| ${r.map(esc).join(" | ")} |`),
  ].join("\n");
}

export function toMarkdown(r: Report): string {
  const out = [
    `# ${r.title}`,
    "",
    `_Generated ${r.generatedAt} by \`pnpm eval\`._`,
    "",
    ...r.headline.map((h) => `- **${h}**`),
    "",
  ];
  for (const s of r.sections) {
    out.push(`## ${s.title}`, "");
    for (const p of s.text ?? []) out.push(p, "");
    for (const t of s.tables ?? []) {
      if (t.caption) out.push(`**${t.caption}**`, "");
      out.push(mdTable(t.table), "");
    }
  }
  return out.join("\n");
}

const h = (s: string | number) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const inline = (s: string) =>
  h(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

export function toHtml(r: Report): string {
  const sections = r.sections
    .map(
      (s) =>
        `<section><h2>${h(s.title)}</h2>${(s.text ?? []).map((p) => `<p>${inline(p)}</p>`).join("")}${(
          s.tables ?? []
        )
          .map(
            (t) =>
              `<div class="tw">${t.caption ? `<p class="cap">${inline(t.caption)}</p>` : ""}<table><thead><tr>${t.table.head.map((c) => `<th>${h(c)}</th>`).join("")}</tr></thead><tbody>${t.table.rows
                .map((row) => `<tr>${row.map((c) => `<td>${inline(String(c))}</td>`).join("")}</tr>`)
                .join("")}</tbody></table></div>`,
          )
          .join("")}</section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rebuttal eval report</title>
<style>
:root{--bg:#fff;--fg:#1a1d21;--muted:#5d6670;--line:#e3e6ea;--accent:#0b5cad;--card:#f6f8fa}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--fg:#e6e8eb;--muted:#9aa3ad;--line:#2a2f35;--accent:#6aa9ff;--card:#1b1f24}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:36px 0 10px;border-bottom:1px solid var(--line);padding-bottom:6px}
.meta{color:var(--muted);margin:0 0 18px}
.headline{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px 18px;margin:0;list-style:none}
.headline li{margin:4px 0;font-weight:600}
.tw{overflow-x:auto;margin:10px 0 18px}.cap{font-weight:600;margin:6px 0}
table{border-collapse:collapse;min-width:100%;font-variant-numeric:tabular-nums;font-size:14px}
th,td{border-bottom:1px solid var(--line);padding:6px 10px;text-align:left;white-space:nowrap}
th{color:var(--muted);font-weight:600}td:not(:first-child){text-align:right}
code{background:var(--card);padding:1px 4px;border-radius:4px}
</style></head>
<body><main><h1>${h(r.title)}</h1><p class="meta">Generated ${h(r.generatedAt)} by <code>pnpm eval</code></p>
<ul class="headline">${r.headline.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>
${sections}
</main></body></html>
`;
}
