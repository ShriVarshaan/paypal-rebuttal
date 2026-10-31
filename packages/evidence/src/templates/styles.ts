/** Print CSS shared by the cover letter and every exhibit. US Letter, facts-first, no colour reliance. */
export const printStyles = `
@page { size: Letter; margin: 16mm 15mm 18mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #1d2320; }
h1 { font-size: 17pt; line-height: 1.2; margin: 0 0 4pt; letter-spacing: -0.01em; }
h2 { font-size: 11.5pt; margin: 16pt 0 6pt; padding-bottom: 3pt; border-bottom: 1px solid #c9ccc6; }
h3 { font-size: 10.5pt; margin: 10pt 0 4pt; }
p { margin: 0 0 6pt; }
.muted { color: #5b635e; }
.mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; font-size: 9.5pt; }
.label { font-size: 8pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #5b635e; }
.letterhead { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1d2320; padding-bottom: 8pt; margin-bottom: 12pt; }
.letterhead .merchant { font-size: 13pt; font-weight: 700; }
table { width: 100%; border-collapse: collapse; margin: 4pt 0 8pt; page-break-inside: auto; }
tr { page-break-inside: avoid; }
th, td { text-align: left; vertical-align: top; padding: 4pt 6pt; border-bottom: 1px solid #dfe1dc; }
th { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.05em; color: #5b635e; font-weight: 700; background: #f3f4f1; }
table.facts th { width: 34%; text-transform: none; letter-spacing: 0; font-size: 9.5pt; color: #3b423e; background: #f7f8f5; }
.statement { border-left: 3px solid #1f766b; padding: 2pt 0 2pt 10pt; margin: 6pt 0 8pt; }
.statement ol { margin: 6pt 0 0; padding-left: 16pt; }
.statement li { margin-bottom: 4pt; }
.cite { font-family: "SFMono-Regular", Consolas, monospace; font-size: 8.5pt; font-weight: 700; color: #155f56; white-space: nowrap; }
.exhibit-bar { display: flex; justify-content: space-between; align-items: baseline; border: 1.5px solid #1d2320; padding: 6pt 9pt; margin-bottom: 10pt; }
.exhibit-bar .id { font-size: 14pt; font-weight: 800; letter-spacing: 0.02em; }
.side-by-side { display: grid; grid-template-columns: 1fr 1fr; gap: 10pt; }
.box { border: 1px solid #c9ccc6; padding: 7pt 9pt; }
.box.match { border-color: #3f6f46; }
.box.mismatch { border-color: #a33d36; }
.verdict { font-weight: 700; }
.screenshot { display: block; max-width: 100%; max-height: 110mm; width: auto; margin: 0 auto; border: 1px solid #c9ccc6; page-break-inside: avoid; }
.flag { background: #f7efd9; }
.flag td:first-child { box-shadow: inset 3px 0 0 #90651b; }
.tag { display: inline-block; font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid #90651b; color: #6b4a12; padding: 0 4pt; margin-left: 4pt; }
.pre { white-space: pre-wrap; }
.diff-old { background: #f8e9e7; }
.diff-new { background: #e7f0e7; }
.footnote { font-size: 8.5pt; color: #5b635e; margin-top: 12pt; border-top: 1px solid #dfe1dc; padding-top: 6pt; }
.avoid-break { page-break-inside: avoid; }
`;
