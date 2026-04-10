import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
function pxToTwip(px) {
    return Math.round(px * 15);
}
function resolveHtmlToDocx() {
    const loaded = require("@turbodocx/html-to-docx");
    const candidate = loaded?.default ??
        loaded?.HTMLtoDOCX ??
        loaded;
    if (typeof candidate !== "function") {
        throw new Error("DOCX export library could not be resolved on the server.");
    }
    return candidate;
}
function buildDocxCss() {
    return `
    body {
      font-family: "Times New Roman", Times, serif;
      font-size: 12pt;
      line-height: 1.45;
      color: #1e293b;
      background: #ffffff;
      margin: 0;
      padding: 0;
    }

    .doc-shell,
    .doc-body {
      width: 100%;
    }

    .doc-title {
      margin: 0 0 18pt;
      font-size: 20pt;
      line-height: 1.25;
      font-weight: 700;
      text-align: center;
      color: #0f172a;
    }

    .doc-section-title {
      margin: 18pt 0 8pt;
      font-size: 14pt;
      line-height: 1.3;
      font-weight: 700;
      color: #0f172a;
    }

    .doc-subsection-title {
      margin: 14pt 0 6pt;
      font-size: 12pt;
      line-height: 1.3;
      font-weight: 700;
      color: #0f172a;
    }

    h1, h2, h3, h4, h5, h6 {
      font-family: "Times New Roman", Times, serif;
      color: #0f172a;
    }

    h1 { font-size: 20pt; margin: 0 0 12pt; line-height: 1.25; }
    h2 { font-size: 14pt; margin: 18pt 0 8pt; line-height: 1.3; }
    h3 { font-size: 12pt; margin: 14pt 0 6pt; line-height: 1.3; }
    h4 { font-size: 11pt; margin: 12pt 0 6pt; line-height: 1.3; }

    p {
      margin: 0 0 8pt;
      line-height: 1.45;
    }

    ul, ol {
      margin: 0 0 8pt 24px;
      padding: 0;
      line-height: 1.45;
    }

    li {
      margin: 0 0 4pt;
      line-height: 1.45;
    }

    li p {
      margin: 0;
      line-height: 1.45;
    }

    a {
      color: #2563eb;
      text-decoration: underline;
    }

    table {
      border-collapse: collapse;
      width: 100%;
      margin: 12pt 0;
      table-layout: fixed;
    }

    td, th {
      border: 1px solid #cbd5e1;
      padding: 8px 10px;
      vertical-align: top;
      line-height: 1.35;
    }

    blockquote {
      border-left: 4px solid #cbd5e1;
      margin: 12pt 0;
      padding-left: 12px;
      color: #475569;
    }

    .doc-branding-block {
      width: 100%;
    }

    .doc-branding-image {
      display: block;
      width: 100%;
      max-width: 100%;
      object-fit: contain;
    }
  `;
}
function buildDocxBodyHtml(bodyHtml) {
    return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>${buildDocxCss()}</style>
  </head>
  <body>
    <div class="doc-shell">
      <div class="doc-body">
        ${bodyHtml || "<p></p>"}
      </div>
    </div>
  </body>
</html>`;
}
function buildDocxHeaderFooterHtml(branding) {
    if (!branding || branding.mode === "none") {
        return {
            headerHtml: null,
            footerHtml: null,
            headerHeightPx: 110,
            footerHeightPx: 90,
        };
    }
    const headerHeightPx = Number(branding.headerHeightPx || 110);
    const footerHeightPx = Number(branding.footerHeightPx || 90);
    const letterheadHeightPx = Number(branding.letterheadHeightPx || 130);
    if (branding.mode === "letterhead") {
        const headerHtml = branding.letterheadImageUrl
            ? `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;">
    <div class="doc-branding-block" style="width:100%;">
      <img
        src="${branding.letterheadImageUrl}"
        alt=""
        style="display:block;width:100%;max-width:100%;height:${letterheadHeightPx}px;object-fit:contain;"
      />
    </div>
  </body>
</html>`
            : null;
        return {
            headerHtml,
            footerHtml: null,
            headerHeightPx: letterheadHeightPx,
            footerHeightPx,
        };
    }
    const headerHtml = branding.headerImageUrl
        ? `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;">
    <div class="doc-branding-block" style="width:100%;">
      <img
        src="${branding.headerImageUrl}"
        alt=""
        style="display:block;width:100%;max-width:100%;height:${headerHeightPx}px;object-fit:contain;"
      />
    </div>
  </body>
</html>`
        : null;
    const footerHtml = branding.footerImageUrl
        ? `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;">
    <div class="doc-branding-block" style="width:100%;">
      <img
        src="${branding.footerImageUrl}"
        alt=""
        style="display:block;width:100%;max-width:100%;height:${footerHeightPx}px;object-fit:contain;"
      />
    </div>
  </body>
</html>`
        : null;
    return {
        headerHtml,
        footerHtml,
        headerHeightPx,
        footerHeightPx,
    };
}
async function normalizeToBuffer(data) {
    if (Buffer.isBuffer(data)) {
        return data;
    }
    if (data instanceof ArrayBuffer) {
        return Buffer.from(data);
    }
    return Buffer.from(await data.arrayBuffer());
}
export async function generateDraftDocxBuffer({ title, bodyHtml, branding, }) {
    const HtmlToDocx = resolveHtmlToDocx();
    const { headerHtml, footerHtml, headerHeightPx, footerHeightPx } = buildDocxHeaderFooterHtml(branding);
    const html = buildDocxBodyHtml(bodyHtml);
    const result = await HtmlToDocx(html, headerHtml, {
        title: title || "Draft",
        font: "Times New Roman",
        fontSize: 24,
        pageSize: {
            width: 11909,
            height: 16834,
        },
        table: {
            row: {
                cantSplit: true,
            },
        },
        header: Boolean(headerHtml),
        headerType: "default",
        footer: Boolean(footerHtml),
        footerType: "default",
        pageNumber: false,
        margins: {
            top: headerHtml ? pxToTwip(headerHeightPx + 28) : 1440,
            right: 1440,
            bottom: footerHtml ? pxToTwip(footerHeightPx + 28) : 1440,
            left: 1440,
            header: 720,
            footer: 720,
        },
    }, footerHtml);
    return await normalizeToBuffer(result);
}
//# sourceMappingURL=docxExport.js.map