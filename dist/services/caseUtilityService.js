import OpenAI from "openai";
import nodemailer from "nodemailer";
import { chromium } from "playwright";
const TRANSLATION_CHAR_LIMIT = 18000;
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY ||
        process.env.LLM_API_KEY ||
        process.env.EMBEDDING_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL ||
        process.env.LLM_BASE_URL ||
        "https://api.openai.com/v1",
});
function escapeHtml(text) {
    return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function sanitizeHtmlForPdf(html) {
    return String(html || "")
        .replace(/<script\b[\s\S]*?<\/script>/gi, "")
        .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
        .replace(/<object\b[\s\S]*?<\/object>/gi, "")
        .replace(/<embed\b[\s\S]*?>/gi, "")
        .replace(/\son\w+="[^"]*"/gi, "")
        .replace(/\son\w+='[^']*'/gi, "")
        .replace(/javascript:/gi, "");
}
function normalizeEmailList(value) {
    const emails = String(value || "")
        .split(/[,\n;]/)
        .map((item) => item.trim())
        .filter(Boolean);
    const invalid = emails.find((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    if (invalid) {
        throw Object.assign(new Error(`Invalid email address: ${invalid}`), {
            status: 400,
        });
    }
    if (!emails.length) {
        throw Object.assign(new Error("At least one recipient email is required."), {
            status: 400,
        });
    }
    return emails;
}
function getSmtpTransporter() {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" ||
        port === 465;
    if (!host) {
        throw Object.assign(new Error("SMTP_HOST is not configured on the backend."), { status: 500 });
    }
    const user = process.env.SMTP_USER || "";
    const pass = process.env.SMTP_PASS || "";
    return nodemailer.createTransport({
        host,
        port,
        secure,
        auth: user && pass ? { user, pass } : undefined,
    });
}
export async function translateLegalText(params) {
    const rawText = String(params.text || "").trim();
    const targetLanguage = String(params.targetLanguage || "").trim() || "Hindi";
    if (!rawText) {
        throw Object.assign(new Error("Text is required for translation."), {
            status: 400,
        });
    }
    const truncated = rawText.length > TRANSLATION_CHAR_LIMIT;
    const text = rawText.slice(0, TRANSLATION_CHAR_LIMIT);
    const response = await openai.chat.completions.create({
        model: process.env.OPENAI_TRANSLATION_MODEL ||
            process.env.OPENAI_ROUTER_MODEL ||
            process.env.LLM_ROUTER_MODEL ||
            "gpt-4.1-mini",
        temperature: 0,
        messages: [
            {
                role: "system",
                content: "You are a legal translation assistant. Translate the provided Indian legal case text accurately. Preserve party names, court names, citations, section numbers, article numbers, dates, legal terms, formatting, and paragraph structure as much as possible. Do not add commentary. Only return the translated text.",
            },
            {
                role: "user",
                content: [
                    `Target language: ${targetLanguage}`,
                    params.sourceLabel ? `Source: ${params.sourceLabel}` : "",
                    "",
                    "Text:",
                    text,
                ]
                    .filter(Boolean)
                    .join("\n"),
            },
        ],
    });
    const translatedText = response.choices?.[0]?.message?.content?.trim() || "";
    return {
        translatedText,
        targetLanguage,
        truncated,
        originalLength: rawText.length,
        translatedLength: translatedText.length,
    };
}
async function buildPdfBuffer(params) {
    const safeTitle = escapeHtml(params.title || "Lawsuit AI Case");
    const safeHtml = sanitizeHtmlForPdf(params.html || "");
    const fallback = escapeHtml(params.plainText || "").replace(/\n/g, "<br />");
    const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <style>
    @page {
      size: A4;
      margin: 22mm 18mm;
    }

    body {
      font-family: "Times New Roman", serif;
      color: #111827;
      line-height: 1.58;
      font-size: 12pt;
      margin: 0;
    }

    h1 {
      font-size: 17pt;
      text-align: center;
      margin: 0 0 18px;
      color: #114C8D;
      text-transform: uppercase;
    }

    h2, h3 {
      color: #0f172a;
      margin: 18px 0 8px;
    }

    p {
      margin: 0 0 10px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    td, th {
      vertical-align: top;
    }

    .case-content {
      width: 100%;
    }

    .case-content * {
      max-width: 100%;
    }

    pre {
      white-space: pre-wrap;
      font-family: "Times New Roman", serif;
      line-height: 1.58;
    }
  </style>
</head>
<body>
  <h1>${safeTitle}</h1>
  <div class="case-content">
    ${safeHtml || `<pre>${fallback}</pre>`}
  </div>
</body>
</html>`.trim();
    const browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    try {
        const page = await browser.newPage();
        await page.setContent(html, {
            waitUntil: "networkidle",
        });
        return await page.pdf({
            format: "A4",
            printBackground: true,
            preferCSSPageSize: true,
        });
    }
    finally {
        await browser.close();
    }
}
export async function sendCasePdfEmail(params) {
    const to = normalizeEmailList(params.to);
    const subject = String(params.subject || "").trim();
    if (!subject) {
        throw Object.assign(new Error("Subject is required."), { status: 400 });
    }
    const transporter = getSmtpTransporter();
    const pdfBuffer = await buildPdfBuffer({
        title: params.title,
        html: params.html,
        plainText: params.plainText,
    });
    const filename = String(params.filename || "")
        .trim()
        .replace(/[^\w\-(). ]+/g, "_")
        .slice(0, 120) || "lawsuit-ai-case.pdf";
    const from = process.env.SMTP_FROM ||
        process.env.SMTP_USER ||
        "Lawsuit AI <no-reply@lawsuit-ai.local>";
    const body = String(params.body || "").trim();
    const info = await transporter.sendMail({
        from,
        to,
        subject,
        text: body || "Please find the attached case PDF.",
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;white-space:pre-wrap;">${escapeHtml(body || "Please find the attached case PDF.")}</div>`,
        attachments: [
            {
                filename,
                content: pdfBuffer,
                contentType: "application/pdf",
            },
        ],
    });
    return {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
    };
}
//# sourceMappingURL=caseUtilityService.js.map