import { chromium } from "playwright";

function escapeHtml(value: string) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildPdfHtml({
  title,
  bodyHtml,
  branding,
}: {
  title: string;
  bodyHtml: string;
  branding?: {
    mode?: "none" | "header_footer" | "letterhead";
    headerImageUrl?: string;
    footerImageUrl?: string;
    letterheadImageUrl?: string;
    signatureImageUrl?: string;
    headerHeightPx?: number;
    footerHeightPx?: number;
    letterheadHeightPx?: number;
    lockBranding?: boolean;
  } | null;
}) {
  const safeTitle = escapeHtml(title || "Draft");

  const headerImage =
    branding?.mode === "header_footer" && branding?.headerImageUrl
      ? `<div class="doc-header"><img class="doc-branding-image" src="${branding.headerImageUrl}" alt="" /></div>`
      : "";

  const footerImage =
    branding?.mode === "header_footer" && branding?.footerImageUrl
      ? `<div class="doc-footer"><img class="doc-branding-image" src="${branding.footerImageUrl}" alt="" /></div>`
      : "";

  const letterheadImage =
    branding?.mode === "letterhead" && branding?.letterheadImageUrl
      ? `<div class="doc-header"><img class="doc-branding-image doc-letterhead-image" src="${branding.letterheadImageUrl}" alt="" /></div>`
      : "";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <style>
    @page {
      size: A4;
      margin: 22mm 16mm 22mm 16mm;
    }

    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #1e293b;
      font-family: "Times New Roman", Times, serif;
      font-size: 12pt;
      line-height: 1.45;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    body {
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

    .doc-header {
      margin-bottom: 14pt;
    }

    .doc-footer {
      margin-top: 18pt;
    }

    .doc-branding-image {
      display: block;
      width: 100%;
      max-width: 100%;
      object-fit: contain;
    }

    .doc-letterhead-image {
      margin-bottom: 6pt;
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

    a {
      color: #2563eb;
      text-decoration: underline;
    }

    blockquote {
      border-left: 4px solid #cbd5e1;
      margin: 12pt 0;
      padding-left: 12px;
      color: #475569;
    }
  </style>
</head>
<body>
  <div class="doc-shell">
    ${letterheadImage}
    ${headerImage}
    <div class="doc-body">
      ${bodyHtml || "<p></p>"}
    </div>
    ${footerImage}
  </div>
</body>
</html>`;
}

export async function generateDraftPdfBuffer({
  title,
  bodyHtml,
  branding,
}: {
  title: string;
  bodyHtml: string;
  branding?: any;
}) {
  const html = buildPdfHtml({
    title,
    bodyHtml,
    branding,
  });

  const browser = await chromium.launch({
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.emulateMedia({ media: "print" });

    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "22mm",
        right: "16mm",
        bottom: "22mm",
        left: "16mm",
      },
    });
  } finally {
    await browser.close();
  }
}