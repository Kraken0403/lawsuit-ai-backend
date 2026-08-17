import { createRequire } from "node:module";
import { chromium } from "playwright";
import prisma from "../lib/prisma.js";
import { CANONICAL_CASEFINDER_CSS } from "./canonicalCasefinderCss.js";
import { CANONICAL_CASEFINDER_HIGHLIGHT_CSS } from "./canonicalCasefinderHighlightCss.js";
import {
  fetchCaseReferencesHtmlFromSql,
  fetchFullCaseHtmlFromSql,
} from "./sqlCaseService.js";

const require = createRequire(import.meta.url);
const htmlDocx = require("html-docx-js") as {
  asBlob: (html: string) => Blob | Buffer | ArrayBuffer;
};

const DEFAULT_CASEFINDER_WEB_URL = "https://beta2.lawsuitcasefinder.com";
const DEFAULT_CASEFINDER_PDF_URL =
  "https://puppetapi.lawsuitcasefinder.com/api/getPDFbyURL";
const LEGACY_IMAGE_ORIGIN = "http://www.levonstechnologies.com";
const CASEFINDER_IMAGE_ORIGIN = "https://images.lawsuitcasefinder.com";

type CaseExportSource = {
  caseId: string;
  html: string;
  licensedTo: string;
  filename: string;
};

export type CaseOutputOptions = {
  includeCasesCitedIn?: boolean;
  includeOtherCases?: boolean;
  includeHighlightedWords?: boolean;
};

type NormalizedCaseOutputOptions = Required<CaseOutputOptions>;

type PdfPayload = {
  height: number;
  format: "A4";
  content: string;
  emulateMedia: "print";
  sendmail: false;
  displayHeaderFooter: true;
  headerTemplate: string;
  footerTemplate: string;
  margin: {
    top: string;
    bottom: string;
    right: string;
    left: string;
  };
  printBackground: true;
  waitFor: number;
};

let casefinderLogoPromise: Promise<string> | null = null;

function compact(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeOutputOptions(
  options: CaseOutputOptions = {}
): NormalizedCaseOutputOptions {
  return {
    includeCasesCitedIn: options.includeCasesCitedIn === true,
    includeOtherCases: options.includeOtherCases === true,
    includeHighlightedWords: options.includeHighlightedWords === true,
  };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getCasefinderWebUrl() {
  return compact(process.env.CASEFINDER_WEB_URL || DEFAULT_CASEFINDER_WEB_URL).replace(
    /\/+$/,
    ""
  );
}

function getCasefinderPdfUrl() {
  return compact(process.env.CASEFINDER_PDF_URL || DEFAULT_CASEFINDER_PDF_URL);
}

function normalizeCasefinderHtml(html: string) {
  return String(html || "")
    .split(LEGACY_IMAGE_ORIGIN)
    .join(CASEFINDER_IMAGE_ORIGIN);
}

function stripHtml(value: string) {
  return String(value || "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCitation(html: string) {
  const match = String(html || "").match(
    /<p\b[^>]*class\s*=\s*(?:["'][^"']*\bcitations\b[^"']*["']|citations\b)[^>]*>([\s\S]*?)<\/p>/i
  );

  if (!match?.[1]) return "";

  return stripHtml(match[1]).replace(/^Citation\s*:\s*/i, "").trim();
}

function safeFilename(value: string, fallback: string) {
  const cleaned = compact(value)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 140);

  return cleaned || fallback;
}

function attachmentHeader(filename: string, extension: "pdf" | "docx") {
  const basename = safeFilename(filename, "Case");
  const ascii = basename.replace(/[^\x20-\x7E]/g, "_");
  const encoded = encodeURIComponent(`${basename}.${extension}`);

  return `attachment; filename="${ascii}.${extension}"; filename*=UTF-8''${encoded}`;
}

async function getCasefinderLogoDataUrl() {
  if (!casefinderLogoPromise) {
    casefinderLogoPromise = (async () => {
      const response = await fetch(
        `${getCasefinderWebUrl()}/assets/image/logo.png`,
        { signal: AbortSignal.timeout(20_000) }
      );

      if (!response.ok) {
        throw Object.assign(
          new Error(`Casefinder logo could not be loaded (${response.status}).`),
          { status: 502 }
        );
      }

      const contentType = response.headers.get("content-type") || "image/png";
      const buffer = Buffer.from(await response.arrayBuffer());

      if (!contentType.toLowerCase().startsWith("image/") || !buffer.length) {
        throw Object.assign(new Error("Casefinder logo response was not an image."), {
          status: 502,
        });
      }

      return `data:${contentType};base64,${buffer.toString("base64")}`;
    })().catch((error) => {
      casefinderLogoPromise = null;
      throw error;
    });
  }

  return casefinderLogoPromise;
}

async function loadCaseExportSource(
  caseId: string,
  userId: string,
  options: NormalizedCaseOutputOptions
): Promise<CaseExportSource> {
  const normalizedCaseId = compact(caseId);
  if (!/^\d+$/.test(normalizedCaseId)) {
    throw Object.assign(new Error("Invalid case ID."), { status: 400 });
  }

  let sqlCase;

  try {
    sqlCase = await fetchFullCaseHtmlFromSql(normalizedCaseId);
  } catch (error: any) {
    if (/No SQL case found/i.test(String(error?.message || ""))) {
      throw Object.assign(new Error("Case document was not found."), {
        status: 404,
      });
    }
    throw error;
  }

  if (!sqlCase.jtext.trim()) {
    throw Object.assign(new Error("The case document is empty."), {
      status: 422,
    });
  }

  if (sqlCase.ftype && sqlCase.ftype.toLowerCase() !== ".htm") {
    throw Object.assign(
      new Error(`Unsupported case document format: ${sqlCase.ftype}`),
      { status: 422 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, name: true, email: true },
  });

  let html = normalizeCasefinderHtml(sqlCase.jtext);

  if (options.includeCasesCitedIn || options.includeOtherCases) {
    const references = await fetchCaseReferencesHtmlFromSql(normalizedCaseId);
    const referenceHtml = normalizeCasefinderHtml(references.html);

    if (referenceHtml) {
      const referenceContainer = `<div id="dvCaseCitedDtl" class="acrefdetails">${referenceHtml}</div>`;
      const existingContainer = /<div\b[^>]*\bid\s*=\s*["']?dvCaseCitedDtl["']?[^>]*>[\s\S]*?<\/div>/i;

      if (existingContainer.test(html)) {
        html = html.replace(existingContainer, referenceContainer);
      } else {
        const lastRuleIndex = html.toLowerCase().lastIndexOf("<hr");
        html =
          lastRuleIndex >= 0
            ? `${html.slice(0, lastRuleIndex)}${referenceContainer}${html.slice(lastRuleIndex)}`
            : `${html}${referenceContainer}`;
      }
    }
  }

  const citation = extractCitation(html);

  return {
    caseId: sqlCase.caseId,
    html,
    licensedTo:
      compact(user?.username) || compact(user?.name) || compact(user?.email) || "Lawsuit AI user",
    filename: safeFilename(citation, `Case-${sqlCase.caseId}`),
  };
}

function buildOutputContent(
  source: CaseExportSource,
  options: NormalizedCaseOutputOptions
) {
  const webUrl = getCasefinderWebUrl();
  const content = options.includeHighlightedWords
    ? source.html
    : source.html
        .replace(/(<b\b[^>]*class\s*=\s*["']?highlight[^>]*?)\s+style\s*=\s*(?:"[^"]*"|'[^']*')/gi, "$1")
        .replace(/highlight/g, "highlight1");
  const css = options.includeHighlightedWords
    ? CANONICAL_CASEFINDER_HIGHLIGHT_CSS
    : CANONICAL_CASEFINDER_CSS;
  const referenceRules = [
    !options.includeCasesCitedIn
      ? ".acrefdetails > p:first-child { display:none !important; }"
      : "",
    !options.includeOtherCases
      ? ".acrefdetails > p:nth-child(n+2) { display:none !important; }"
      : "",
  ].join("\n");

  return `<html><head><meta charset="utf-8"><style>${css}
* { -webkit-print-color-adjust: exact !important; color-adjust: exact !important; print-color-adjust: exact !important; }
body:before { content:""; display:block; position:fixed; left:0; top:0; width:100%; height:100%; z-index:-10;
background:url('${webUrl}/assets/img/backgroundlogo.jpg') no-repeat center center;
-webkit-background-size:cover; background-size:cover; }
div > p.advocate > a { display:none !important; }
#dvExpandLink { display:none !important; }
.hn { white-space:pre-line !important; text-align:justify !important; }
${referenceRules}
.judgtitle > .highlight1 { font-weight:bold !important; }
</style></head>
<body style="font-family:verdana; font-size:16px;">${content}</body></html>`;
}

function buildHeaderTemplate(licensedTo: string, logoDataUrl: string) {
  return `<table style="width:100%"><tr style="vertical-align:text-bottom;"><td>
<table align="left" width="50%" style="margin-top:19px"><tbody><tr><td style="font-size:11px;"> Licensed to : ${escapeHtml(
    licensedTo
  )} <br> </td></tr></tbody></table>
<table align="right" width="50%"><tbody><tr><td style="text-align:right;font-size:11px;padding-right:.5rem;">
<img src="${logoDataUrl}" alt="law" style="height:30px;"><br>
<a href="https://www.lawsuitcasefinder.com">www.lawsuitcasefinder.com</a></td></tr></tbody></table>
</td></tr><tr><td><hr></td></tr></table>`;
}

const FOOTER_TEMPLATE = `<div style="width:100%"><hr/><table style="width:100%"><tr style="vertical-align:text-bottom;">
<td><table align="right" width="70%"><tbody><tr style="vertical-align:text-bottom;">
<td style="padding-right:.5rem!important;float:right;font-size:9px;">
Page <span class="pageNumber"></span> of <span class="totalPages"></span>
</td></tr></tbody></table></td></tr><tr><td></td></tr></table></div>`;

async function buildPdfPayload(
  source: CaseExportSource,
  options: NormalizedCaseOutputOptions
): Promise<PdfPayload> {
  const logo = await getCasefinderLogoDataUrl();

  return {
    height: 0,
    format: "A4",
    content: buildOutputContent(source, options),
    emulateMedia: "print",
    sendmail: false,
    displayHeaderFooter: true,
    headerTemplate: buildHeaderTemplate(source.licensedTo, logo),
    footerTemplate: FOOTER_TEMPLATE,
    margin: { top: "100px", bottom: "60px", right: "35px", left: "35px" },
    printBackground: true,
    waitFor: 0,
  };
}

function getRemotePdfHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/pdf,application/octet-stream",
  };

  const authorization = compact(process.env.CASEFINDER_PDF_AUTHORIZATION);
  const apiKey = compact(process.env.CASEFINDER_PDF_API_KEY);

  if (authorization) headers.Authorization = authorization;
  if (apiKey) headers["x-api-key"] = apiKey;

  return headers;
}

async function renderPdfRemotely(payload: PdfPayload) {
  const response = await fetch(getCasefinderPdfUrl(), {
    method: "POST",
    headers: getRemotePdfHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(
      `Casefinder PDF service returned ${response.status}${detail ? `: ${detail}` : ""}`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    throw new Error("Casefinder PDF service returned an empty file");
  }
  if (buffer.subarray(0, 4).toString("ascii") !== "%PDF") {
    throw new Error("Casefinder PDF service did not return a valid PDF file");
  }

  return buffer;
}

async function waitForDocumentImages(page: any) {
  await page.evaluate(async () => {
    const images = Array.from(document.images);
    await Promise.all(
      images.map((image) => {
        if (image.complete) return Promise.resolve();
        return new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
          setTimeout(resolve, 15_000);
        });
      })
    );
  });
}

async function renderPdfLocally(payload: PdfPayload) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(payload.content, { waitUntil: "networkidle" });
    await page.emulateMedia({ media: payload.emulateMedia });
    await waitForDocumentImages(page);

    return await page.pdf({
      format: payload.format,
      displayHeaderFooter: payload.displayHeaderFooter,
      headerTemplate: payload.headerTemplate,
      footerTemplate: payload.footerTemplate,
      margin: payload.margin,
      printBackground: payload.printBackground,
    });
  } finally {
    await browser.close();
  }
}

async function renderCasePdf(payload: PdfPayload) {
  const mode = compact(process.env.CASEFINDER_PDF_MODE || "remote_with_fallback").toLowerCase();

  if (mode === "local") {
    return renderPdfLocally(payload);
  }

  try {
    return await renderPdfRemotely(payload);
  } catch (error) {
    if (mode === "remote") throw error;
    console.warn("[case-export] Remote Casefinder PDF render failed; using local Chromium.", error);
    return renderPdfLocally(payload);
  }
}

async function normalizeDocxResult(result: Blob | Buffer | ArrayBuffer) {
  if (Buffer.isBuffer(result)) return result;
  if (result instanceof ArrayBuffer) return Buffer.from(result);
  return Buffer.from(await result.arrayBuffer());
}

function buildDocxHtml(source: CaseExportSource, css: string) {
  const webUrl = getCasefinderWebUrl();
  const content = source.html
    .replace("</p><br>", "</p>")
    .replace(/\n/g, "<br>\n");

  return `<html><head><meta charset="utf-8"><style>
* { -webkit-print-color-adjust:exact !important; color-adjust:exact !important; print-color-adjust:exact !important; }
body:before { content:""; display:block; position:fixed; left:0; top:0; width:100%; height:100%;
background:url('${webUrl}/assets/img/backgroundlogo.jpg') no-repeat center center;
-webkit-background-size:cover; background-size:cover; }
</style><style>${css}</style><style>.customindex{display:none !important;}.hn{white-space:pre-line !important;}</style></head>
<body style="font-family:verdana; font-size:16px;">${content}</body></html>`;
}

export async function exportCasePdf(
  caseId: string,
  userId: string,
  rawOptions: CaseOutputOptions = {}
) {
  const options = normalizeOutputOptions(rawOptions);
  const source = await loadCaseExportSource(caseId, userId, options);
  const payload = await buildPdfPayload(source, options);
  const buffer = await renderCasePdf(payload);

  return {
    buffer,
    filename: source.filename,
    contentDisposition: attachmentHeader(source.filename, "pdf"),
  };
}

export async function exportCaseDocx(caseId: string, userId: string) {
  const source = await loadCaseExportSource(
    caseId,
    userId,
    normalizeOutputOptions()
  );
  const result = htmlDocx.asBlob(
    buildDocxHtml(source, CANONICAL_CASEFINDER_CSS)
  );
  const buffer = await normalizeDocxResult(result);

  return {
    buffer,
    filename: source.filename,
    contentDisposition: attachmentHeader(source.filename, "docx"),
  };
}

export async function buildCasePrintDocument(
  caseId: string,
  userId: string,
  rawOptions: CaseOutputOptions = {}
) {
  const options = normalizeOutputOptions(rawOptions);
  const source = await loadCaseExportSource(caseId, userId, options);
  const logo = await getCasefinderLogoDataUrl();
  const output = buildOutputContent(source, options);
  const bodyMatch = output.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const styleMatch = output.match(/<style>([\s\S]*?)<\/style>/i);
  const body = bodyMatch?.[1] || source.html;
  const styles = styleMatch?.[1] || CANONICAL_CASEFINDER_CSS;

  return {
    filename: source.filename,
    html: `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
      source.filename
    )}</title><style>${styles}
body { font-family:verdana; text-align:justify; font-size:15px; }
.casefinder-print-license { display:flex; align-items:flex-end; width:100%; }
.casefinder-print-license__user { width:60%; margin-top:26px; }
.casefinder-print-license__brand { width:40%; text-align:right; }
.casefinder-print-license__brand img { height:40px; max-width:200px; object-fit:contain; }
@media print { .casefinder-print-license { break-inside:avoid; } }
</style></head><body><div class="casefinder-print-license"><div class="casefinder-print-license__user">Licensed to : ${escapeHtml(
      source.licensedTo
    )}</div><div class="casefinder-print-license__brand"><img src="${logo}" alt="LawSuit CaseFinder"><br><a href="https://www.lawsuitcasefinder.com">www.lawsuitcasefinder.com</a></div></div><hr>${body}</body></html>`,
  };
}
