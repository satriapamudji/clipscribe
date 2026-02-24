const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");

let mainWindow = null;
let services = null;
const startupLogPath = path.join(process.cwd(), "app-data", "startup.log");
const openRouterRawLogPath = path.join(process.cwd(), "app-data", "openrouter-raw.log");
let recoveredRendererOnce = false;

function sanitizeExportFileStem(value) {
  const raw = String(value || "").trim() || "session";
  const cleaned = raw
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const truncated = cleaned.length > 72 ? cleaned.slice(0, 72).trim() : cleaned;
  return truncated || "session";
}

function ensureUniquePath(targetPath) {
  const resolved = path.resolve(String(targetPath || "").trim());
  if (!resolved) {
    return targetPath;
  }
  if (!fs.existsSync(resolved)) {
    return resolved;
  }
  const dir = path.dirname(resolved);
  const ext = path.extname(resolved);
  const base = path.basename(resolved, ext);
  for (let i = 2; i <= 200; i += 1) {
    const candidate = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return resolved;
}

function normalizeClockToken(token) {
  const raw = String(token || "").trim();
  const parts = raw.split(":").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) {
    return raw;
  }
  if (parts.length === 2) {
    const [mm, ss] = parts;
    return `00:${mm.padStart(2, "0")}:${ss.padStart(2, "0")}`;
  }
  const [hh, mm, ss] = parts;
  return `${hh.padStart(2, "0")}:${mm.padStart(2, "0")}:${ss.padStart(2, "0")}`;
}

function parseTranscriptDisplayRows(text) {
  const lines = String(text || "").split(/\r?\n/);
  return lines.map((line) => {
    const raw = String(line || "");
    const timedMatch = raw.match(/^\[(.+?)\s*-\s*(.+?)\]\s*(.*)$/);
    if (!timedMatch) {
      return { kind: "raw", raw };
    }

    const start = normalizeClockToken(timedMatch[1]);
    const end = normalizeClockToken(timedMatch[2]);
    const trailing = String(timedMatch[3] || "").trim();
    const speakerMatch = trailing.match(/^([^:]{1,80}):\s*(.*)$/);
    if (!speakerMatch) {
      return { kind: "timed", range: `[${start} - ${end}]`, speaker: "", content: trailing };
    }
    return {
      kind: "timed",
      range: `[${start} - ${end}]`,
      speaker: String(speakerMatch[1] || "").trim(),
      content: String(speakerMatch[2] || "").trim()
    };
  });
}

function buildSpeakerAliasMap(events) {
  const aliasMap = {};
  for (const event of events || []) {
    if (String(event?.event_type || "") !== "speaker_alias") {
      continue;
    }
    const speakerId = Number.parseInt(String(event?.payload?.speaker_id), 10);
    if (!Number.isInteger(speakerId) || speakerId < 0) {
      continue;
    }
    const alias = String(event?.payload?.alias || "").trim();
    if (!alias) {
      delete aliasMap[speakerId];
    } else {
      aliasMap[speakerId] = alias;
    }
  }
  return aliasMap;
}

function applySpeakerAliases(text, aliasMap) {
  const source = String(text || "");
  if (!source) {
    return "";
  }
  return source.replace(/\bSpeaker\s+(\d+):/g, (full, idText) => {
    const speakerId = Number.parseInt(String(idText), 10);
    if (!Number.isInteger(speakerId) || speakerId < 0) {
      return full;
    }
    const alias = String(aliasMap?.[speakerId] || "").trim();
    return alias ? `${alias}:` : full;
  });
}

function escapeMarkdownCell(value) {
  return String(value || "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function unwrapMarkdownCodeFence(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 3) {
    return trimmed;
  }
  const last = lines[lines.length - 1].trim();
  if (last !== "```") {
    return trimmed;
  }
  return lines.slice(1, -1).join("\n").trim();
}

function applyInlineMarkdownLite(escapedText) {
  const input = String(escapedText || "");
  return input
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function renderMarkdownLiteToHtml(markdownText) {
  const raw = unwrapMarkdownCodeFence(markdownText);
  const lines = String(raw || "").split(/\r?\n/);

  const out = [];
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };

  for (const line of lines) {
    const trimmed = String(line || "").trimEnd();
    const stripped = trimmed.trim();
    if (!stripped) {
      closeLists();
      out.push('<div class="md-gap"></div>');
      continue;
    }

    const headingMatch = stripped.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      closeLists();
      const level = headingMatch[1].length;
      const text = applyInlineMarkdownLite(escapeHtml(headingMatch[2] || ""));
      if (level === 1) {
        out.push(`<h3 class="md-h3">${text}</h3>`);
      } else if (level === 2) {
        out.push(`<h4 class="md-h4">${text}</h4>`);
      } else {
        out.push(`<h5 class="md-h5">${text}</h5>`);
      }
      continue;
    }

    const ulMatch = stripped.match(/^[-*]\s+(.*)$/);
    if (ulMatch) {
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        out.push('<ul class="md-ul">');
        inUl = true;
      }
      const item = applyInlineMarkdownLite(escapeHtml(ulMatch[1] || ""));
      out.push(`<li>${item}</li>`);
      continue;
    }

    const olMatch = stripped.match(/^\d+\.\s+(.*)$/);
    if (olMatch) {
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        out.push('<ol class="md-ol">');
        inOl = true;
      }
      const item = applyInlineMarkdownLite(escapeHtml(olMatch[1] || ""));
      out.push(`<li>${item}</li>`);
      continue;
    }

    closeLists();
    const text = applyInlineMarkdownLite(escapeHtml(stripped)).replace(/\r?\n/g, "<br>");
    out.push(`<p class="md-p">${text}</p>`);
  }

  closeLists();

  const html = out
    .join("\n")
    .replace(/(<div class="md-gap"><\/div>\s*){3,}/g, '<div class="md-gap"></div>\n');
  return html.trim();
}

function filterPdfSummarySections(markdownText) {
  const text = unwrapMarkdownCodeFence(markdownText);
  const lines = String(text || "").split(/\r?\n/);
  const keptSections = [];
  let current = null;

  const shouldKeepHeading = (headingText) => {
    const normalized = String(headingText || "")
      .toLowerCase()
      .replace(/[`*_:#-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return (
      normalized.startsWith("executive summary") ||
      normalized.startsWith("exec summary") ||
      normalized.startsWith("decisions") ||
      normalized.startsWith("action items")
    );
  };

  const flushCurrent = () => {
    if (!current || !current.keep) {
      current = null;
      return;
    }
    const content = current.lines.join("\n").trim();
    if (content) {
      keptSections.push(content);
    }
    current = null;
  };

  for (const line of lines) {
    const headingMatch = String(line || "").match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushCurrent();
      current = {
        keep: shouldKeepHeading(headingMatch[2]),
        lines: [String(line || "")]
      };
      continue;
    }
    if (!current) {
      continue;
    }
    current.lines.push(String(line || ""));
  }
  flushCurrent();

  if (keptSections.length > 0) {
    return keptSections.join("\n\n").trim();
  }

  return String(text || "").trim();
}

function formatRecordedDurationForExport(secondsValue) {
  const totalSeconds = Number(secondsValue || 0);
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "0s";
  }
  if (totalSeconds < 60) {
    const rounded = Math.round(totalSeconds * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}s`;
  }

  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function formatTimestampForExport(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function buildSessionTranscriptExportHtml(detail, options) {
  const session = detail?.session || null;
  if (!session) {
    throw new Error("Session not found.");
  }

  const includeMeta = options?.include_meta !== false;
  const includeSummary = Boolean(options?.include_summary);
  const applyAliases = options?.apply_speaker_aliases !== false;

  const aliasMap = buildSpeakerAliasMap(detail.events || []);
  const chunkTexts = (detail.chunks || [])
    .map((chunk) => {
      const text = String(chunk?.text || "").trim();
      if (!text) {
        return null;
      }
      return applyAliases ? applySpeakerAliases(text, aliasMap) : text;
    })
    .filter(Boolean);

  if (chunkTexts.length === 0) {
    throw new Error("No transcript text available yet for this session.");
  }

  const title = String(session.title || "Untitled Session").trim() || "Untitled Session";
  const startedAt = formatTimestampForExport(session.started_at || "");
  const endedAt = formatTimestampForExport(session.ended_at || "");
  const recordedSeconds = Number(session.recorded_seconds || 0);
  const summaryText = String(session.summary_text || "").trim();
  const pdfSummaryText = filterPdfSummarySections(summaryText);
  const exportedAt = formatTimestampForExport(new Date().toISOString());

  const transcriptItemsHtml = [];
  for (const chunkText of chunkTexts) {
    const rows = parseTranscriptDisplayRows(chunkText);
    for (const row of rows) {
      if (row.kind === "timed") {
        const contentText = String(row.content || "").trim();
        if (!contentText) {
          continue;
        }
        const safeContent = escapeHtml(contentText).replace(/\r?\n/g, "<br>");
        const safeSpeaker = escapeHtml(row.speaker || "");
        transcriptItemsHtml.push(`
          <article class="entry">
            <div class="entry-rail">
              <div class="entry-time"><span class="range">${escapeHtml(row.range || "")}</span></div>
            </div>
            <div class="entry-body">
              <div class="entry-text">${
                safeSpeaker
                  ? `<span class="entry-speaker-inline">${safeSpeaker}</span><span class="entry-speaker-sep">:</span> `
                  : ""
              }${safeContent}</div>
            </div>
          </article>
        `);
        continue;
      }
      const raw = String(row.raw || "").trim();
      if (!raw) {
        continue;
      }
      const safeRaw = escapeHtml(raw).replace(/\r?\n/g, "<br>");
      transcriptItemsHtml.push(`
        <article class="entry entry-raw">
          <div class="entry-body">${safeRaw}</div>
        </article>
      `);
    }
  }

  const metaChips = [];
  if (includeMeta) {
    if (startedAt) {
      metaChips.push(`<span class="chip"><strong>Started</strong> ${escapeHtml(startedAt)}</span>`);
    }
    if (endedAt) {
      metaChips.push(`<span class="chip"><strong>Ended</strong> ${escapeHtml(endedAt)}</span>`);
    }
    metaChips.push(
      `<span class="chip"><strong>Recorded</strong> ${escapeHtml(formatRecordedDurationForExport(recordedSeconds))}</span>`
    );
  }

  const summaryHtml =
    includeSummary && pdfSummaryText
      ? `
        <section class="section summary-section">
          <div class="section-head">
            <h2>Summary</h2>
          </div>
          <div class="summary">${renderMarkdownLiteToHtml(pdfSummaryText)}</div>
        </section>
      `
      : "";
  const transcriptSectionClass = summaryHtml
    ? "section transcript-section transcript-section--new-page"
    : "section transcript-section";
  const exportedOnHtml =
    includeMeta && exportedAt
      ? `<div class="header-exported"><strong>Exported on</strong> ${escapeHtml(exportedAt)}</div>`
      : "";

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light; }
      @page {
        size: A4 portrait;
        margin: 11mm 12mm 12mm;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body {
        font-family: "Aptos", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        color: #10223d;
        background: #ffffff;
        line-height: 1.4;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .page {
        padding: 10px 0 0;
      }
      header {
        border: 1px solid #dce7f6;
        border-radius: 14px;
        background:
          linear-gradient(180deg, #f8fbff 0%, #fdfefe 100%);
        padding: 14px 16px 12px;
        margin-bottom: 14px;
      }
      .header-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }
      h1 {
        font-family: "Georgia", "Times New Roman", serif;
        margin: 0 0 4px;
        font-size: 22px;
        letter-spacing: 0.01em;
        word-break: break-word;
        line-height: 1.15;
      }
      .brand {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        font-family: "Segoe UI", "Aptos", Arial, sans-serif;
        font-size: 11.5px;
        color: #33527d;
      }
      .brand-badge {
        display: inline-flex;
        align-items: center;
        padding: 3px 8px 4px;
        border: 1px solid #d6e4f7;
        border-radius: 999px;
        background: #ffffff;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        font-size: 11px;
      }
      .header-exported {
        margin-top: 2px;
        font-family: "Segoe UI", "Aptos", Arial, sans-serif;
        font-size: 11px;
        color: #5f789c;
        text-align: right;
        white-space: nowrap;
      }
      .header-exported strong {
        color: #2d4f7f;
        font-weight: 600;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 10px;
      }
      .chip {
        display: inline-flex;
        gap: 6px;
        align-items: baseline;
        padding: 5px 9px;
        border: 1px solid #dbe6f5;
        border-radius: 10px;
        background: #ffffff;
        font-family: "Segoe UI", "Aptos", Arial, sans-serif;
        font-size: 11.5px;
        color: #2f4f7f;
      }
      .chip strong {
        font-weight: 700;
        color: #173a69;
      }
      .section { margin-top: 14px; }
      .section-head {
        display: flex;
        align-items: baseline;
        justify-content: flex-start;
        gap: 12px;
        margin-bottom: 8px;
      }
      h2 {
        margin: 0;
        font-family: "Segoe UI", "Aptos", Arial, sans-serif;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: #355a8c;
      }
      .summary {
        border: 1px solid #dce7f6;
        border-radius: 12px;
        background:
          linear-gradient(180deg, #fbfdff 0%, #ffffff 100%);
        padding: 12px 14px;
        font-family: "Aptos", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        font-size: 12.5px;
        line-height: 1.42;
        color: #142845;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.8);
      }
      .summary .md-gap { height: 7px; }
      .summary .md-p { margin: 0; }
      .summary .md-h3, .summary .md-h4, .summary .md-h5 {
        margin: 10px 0 6px;
        color: #173a69;
        letter-spacing: 0.01em;
        font-family: "Segoe UI", "Aptos", Arial, sans-serif;
      }
      .summary .md-h3 { font-size: 13.5px; text-transform: none; }
      .summary .md-h4 { font-size: 12.5px; text-transform: none; }
      .summary .md-h5 { font-size: 12px; text-transform: none; }
      .summary .md-ul, .summary .md-ol {
        margin: 8px 0 0 16px;
        padding: 0;
      }
      .summary li { margin: 3px 0; }
      .summary .md-h3:first-child,
      .summary .md-h4:first-child,
      .summary .md-h5:first-child {
        margin-top: 0;
      }
      .summary code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
        font-size: 11px;
        padding: 1px 5px;
        border: 1px solid #d8e4f6;
        border-radius: 8px;
        background: #ffffff;
      }
      .transcript-frame {
        background: #ffffff;
      }
      .transcript-head {
        display: grid;
        grid-template-columns: 170px minmax(0, 1fr);
        gap: 0;
        border-bottom: 1px solid #dce7f6;
        background: linear-gradient(180deg, #f8fbff 0%, #f4f9ff 100%);
        font-family: "Segoe UI", "Aptos", Arial, sans-serif;
        color: #355a8c;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
      }
      .transcript-head > div {
        padding: 8px 10px;
      }
      .transcript-head > div:first-child {
        border-right: 1px solid #e4edf9;
      }
      .transcript-list {
        display: block;
      }
      .entry {
        display: grid;
        grid-template-columns: 170px minmax(0, 1fr);
        gap: 0;
        page-break-inside: avoid;
        break-inside: avoid;
      }
      .entry + .entry {
        border-top: 1px solid #edf3fb;
      }
      .entry:nth-child(even) {
        background: #fbfdff;
      }
      .entry-rail {
        padding: 8px 10px;
        border-right: 1px solid #edf3fb;
        background:
          linear-gradient(180deg, rgba(247,251,255,0.9) 0%, rgba(255,255,255,0.92) 100%);
      }
      .entry-time {
        display: block;
        width: 100%;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
        font-size: 11.25px;
        color: #274a79;
        line-height: 1.25;
        white-space: nowrap;
        letter-spacing: 0;
      }
      .range { font-variant-numeric: tabular-nums; }
      .entry-speaker-inline {
        font-family: inherit;
        font-size: inherit;
        line-height: inherit;
        font-weight: 700;
        letter-spacing: 0;
        color: #173a69;
        text-transform: none;
        white-space: nowrap;
      }
      .entry-speaker-sep {
        display: inline-block;
        margin-right: 4px;
        font-family: inherit;
        font-size: inherit;
        line-height: inherit;
        font-weight: 700;
        color: #406997;
      }
      .entry-body {
        padding: 8px 12px;
      }
      .entry-text {
        font-family: "Aptos", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        font-size: 12.4px;
        line-height: 1.46;
        color: #132744;
        overflow-wrap: anywhere;
        word-break: normal;
        hyphens: auto;
      }
      .entry-raw {
        grid-template-columns: minmax(0, 1fr);
        background: #fffdf7;
      }
      .entry-raw .entry-body {
        font-family: "Segoe UI", "Aptos", Arial, sans-serif;
        font-size: 12px;
        font-weight: 600;
        color: #604d1a;
        border-left: 3px solid #f2d38a;
        margin: 8px 10px;
        padding: 6px 10px;
        background: #fffaf0;
        border-radius: 8px;
      }
      .footer {
        margin-top: 12px;
        padding-top: 8px;
        border-top: 1px solid #e8eef7;
        font-family: "Segoe UI", "Aptos", Arial, sans-serif;
        font-size: 11px;
        color: #60789c;
      }
      @media print {
        .page { padding: 6px 0 0; }
        header {
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .summary-section {
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .summary {
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .transcript-section--new-page {
          page-break-before: always;
          break-before: page;
        }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <header>
        <div class="header-top">
          <div class="brand">
            <span class="brand-badge">ClipScribe</span>
          </div>
          ${exportedOnHtml}
        </div>
        <h1>${escapeHtml(title)}</h1>
        ${metaChips.length ? `<div class="chips">${metaChips.join("")}</div>` : ""}
      </header>

      ${summaryHtml}

      <section class="${transcriptSectionClass}">
        <div class="section-head">
          <h2>Transcript</h2>
        </div>
        <div class="transcript-frame">
          <div class="transcript-head" aria-hidden="true">
            <div>Time</div>
            <div>Transcript</div>
          </div>
          <div class="transcript-list">
            ${transcriptItemsHtml.join("")}
          </div>
        </div>
      </section>

      <div class="footer">Exported from ClipScribe Desktop</div>
    </div>
  </body>
</html>
  `.trim();
}

function buildSessionTranscriptExport(detail, options) {
  const session = detail?.session || null;
  if (!session) {
    throw new Error("Session not found.");
  }

  const format = String(options?.format || "md").trim().toLowerCase();
  const includeMeta = options?.include_meta !== false;
  const includeSummary = Boolean(options?.include_summary);
  const applyAliases = options?.apply_speaker_aliases !== false;

  const aliasMap = buildSpeakerAliasMap(detail.events || []);
  const chunkTexts = (detail.chunks || [])
    .map((chunk) => {
      const text = String(chunk?.text || "").trim();
      if (!text) {
        return null;
      }
      return applyAliases ? applySpeakerAliases(text, aliasMap) : text;
    })
    .filter(Boolean);

  if (chunkTexts.length === 0) {
    throw new Error("No transcript text available yet for this session.");
  }

  const title = String(session.title || "Untitled Session").trim() || "Untitled Session";
  const startedAt = String(session.started_at || "").trim();
  const endedAt = String(session.ended_at || "").trim();
  const exportedAt = new Date().toISOString();

  if (format === "pdf") {
    const html = buildSessionTranscriptExportHtml(detail, options);
    return { ext: "pdf", kind: "pdf", html };
  }

  if (format === "json") {
    const payload = {
      exported_at: exportedAt,
      session: detail.session,
      chunks: detail.chunks,
      events: detail.events,
      chat_messages: detail.chat_messages,
      transcript_text: chunkTexts.join(os.EOL + os.EOL)
    };
    return { ext: "json", content: JSON.stringify(payload, null, 2) + os.EOL };
  }

  if (format === "txt") {
    const headerLines = [];
    if (includeMeta) {
      headerLines.push(title);
      if (startedAt) {
        headerLines.push(`Started: ${startedAt}`);
      }
      if (endedAt) {
        headerLines.push(`Ended: ${endedAt}`);
      }
      headerLines.push(`Exported: ${exportedAt}`);
      headerLines.push("");
    }
    if (includeSummary) {
      const summary = String(session.summary_text || "").trim();
      if (summary) {
        headerLines.push("Summary:");
        headerLines.push(summary);
        headerLines.push("");
      }
    }
    return { ext: "txt", content: [...headerLines, ...chunkTexts].join(os.EOL + os.EOL) + os.EOL };
  }

  const lines = [];
  lines.push(`# ${title}`);
  if (includeMeta) {
    lines.push("");
    lines.push("- Export: ClipScribe Desktop");
    if (startedAt) {
      lines.push(`- Started: ${startedAt}`);
    }
    if (endedAt) {
      lines.push(`- Ended: ${endedAt}`);
    }
    lines.push(`- Exported: ${exportedAt}`);
  }

  const summaryText = String(session.summary_text || "").trim();
  if (includeSummary && summaryText) {
    lines.push("");
    lines.push("## Summary");
    lines.push("");
    lines.push(summaryText);
  }

  lines.push("");
  lines.push("## Transcript");
  lines.push("");
  lines.push("| Time | Speaker | Text |");
  lines.push("| --- | --- | --- |");

  for (const chunkText of chunkTexts) {
    const rows = parseTranscriptDisplayRows(chunkText);
    for (const row of rows) {
      if (row.kind === "timed") {
        const content = String(row.content || "").trim();
        if (!content) {
          continue;
        }
        lines.push(
          `| ${escapeMarkdownCell(row.range)} | ${escapeMarkdownCell(row.speaker)} | ${escapeMarkdownCell(content)} |`
        );
        continue;
      }
      const raw = String(row.raw || "").trim();
      if (!raw) {
        continue;
      }
      lines.push(`|  |  | ${escapeMarkdownCell(raw)} |`);
    }
  }

  return { ext: "md", content: lines.join("\n") + "\n" };
}

function logStartup(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.mkdirSync(path.dirname(startupLogPath), { recursive: true });
    fs.appendFileSync(startupLogPath, line, "utf8");
  } catch (_) {
    // ignore file logging failures
  }
  if (process.env.CLIPSCRIBE_DEBUG_STARTUP === "1") {
    try {
      console.log(message);
    } catch (_) {
      // ignore console logging failures
    }
  }
}

if (process.platform === "win32") {
  // Some Windows environments block Chromium sandbox IPC/ACL operations.
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
  app.commandLine.appendSwitch("disable-breakpad");
  app.commandLine.appendSwitch("disable-direct-composition");
  app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
}

function pickWritableRuntimeRoot() {
  const localAppData = process.env.LOCALAPPDATA || "";
  const roamingAppData = (() => {
    try {
      return app.getPath("appData");
    } catch (_) {
      return "";
    }
  })();
  const candidates = [
    path.join(localAppData, "ClipScribe", "runtime"),
    path.join(roamingAppData, "ClipScribe", "runtime"),
    path.join(process.cwd(), "app-data", "runtime")
  ].filter((value) => String(value || "").trim());

  for (const root of candidates) {
    try {
      fs.mkdirSync(root, { recursive: true });
      const probe = path.join(root, ".write-probe");
      fs.writeFileSync(probe, "ok", "utf8");
      fs.unlinkSync(probe);
      return root;
    } catch (_) {
      // Try next candidate.
    }
  }
  return path.join(process.cwd(), "app-data", "runtime");
}

function configureElectronPaths() {
  const runtimeRoot = pickWritableRuntimeRoot();
  logStartup(`Runtime root selected: ${runtimeRoot}`);
  const userDataPath = path.join(runtimeRoot, "electron-user-data");
  const crashDumpsPath = path.join(runtimeRoot, "crashDumps");
  const logsPath = path.join(runtimeRoot, "logs");
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.mkdirSync(crashDumpsPath, { recursive: true });
    fs.mkdirSync(logsPath, { recursive: true });
    app.setPath("userData", userDataPath);
    app.setPath("crashDumps", crashDumpsPath);
    app.setAppLogsPath(logsPath);
    logStartup(
      `Electron paths configured: userData=${userDataPath} crashDumps=${crashDumpsPath}`
    );
  } catch (error) {
    logStartup(
      `Could not configure custom Electron runtime paths: ${
        error?.message || String(error)
      }`
    );
  }
}

if (process.env.CLIPSCRIBE_SKIP_RUNTIME_PATHS === "1") {
  logStartup("Skipping custom Electron runtime path configuration.");
} else {
  configureElectronPaths();
}

logStartup(
  `Env: ELECTRON_RUN_AS_NODE=${process.env.ELECTRON_RUN_AS_NODE || ""} ELECTRON_NO_ATTACH_CONSOLE=${
    process.env.ELECTRON_NO_ATTACH_CONSOLE || ""
  } CHROME_DEVEL_SANDBOX=${process.env.CHROME_DEVEL_SANDBOX || ""}`
);

function findInPathWindows(binName) {
  const result = spawnSync("where", [binName], {
    shell: true,
    encoding: "utf8"
  });
  if (result.status !== 0 || !result.stdout) {
    return null;
  }
  const line = result.stdout.split(/\r?\n/).map((row) => row.trim()).find(Boolean);
  return line || null;
}

function searchFileBfs(rootDir, fileName, maxDepth = 4) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return null;
  }
  const queue = [{ dir: rootDir, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current.dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
        return full;
      }
      if (entry.isDirectory() && current.depth < maxDepth) {
        queue.push({ dir: full, depth: current.depth + 1 });
      }
    }
  }
  return null;
}

function detectFfmpegPaths() {
  const ffmpegPathFromPath = findInPathWindows("ffmpeg.exe");
  const ffprobePathFromPath = findInPathWindows("ffprobe.exe");
  if (ffmpegPathFromPath && ffprobePathFromPath) {
    return {
      ffmpeg_path: ffmpegPathFromPath,
      ffprobe_path: ffprobePathFromPath
    };
  }

  const local = process.env.LOCALAPPDATA || "";
  const common = [
    path.join("C:\\ffmpeg", "bin"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "ffmpeg", "bin"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "ffmpeg", "bin"),
    path.join(process.env.USERPROFILE || "", "scoop", "apps", "ffmpeg", "current", "bin"),
    path.join(local, "Programs", "ffmpeg", "bin")
  ];
  for (const dir of common) {
    const ffmpegPath = path.join(dir, "ffmpeg.exe");
    const ffprobePath = path.join(dir, "ffprobe.exe");
    if (fs.existsSync(ffmpegPath) && fs.existsSync(ffprobePath)) {
      return {
        ffmpeg_path: ffmpegPath,
        ffprobe_path: ffprobePath
      };
    }
  }

  const wingetRoot = path.join(local, "Microsoft", "WinGet", "Packages");
  const wingetFfmpeg = searchFileBfs(wingetRoot, "ffmpeg.exe", 5);
  const wingetFfprobe = searchFileBfs(wingetRoot, "ffprobe.exe", 5);
  if (wingetFfmpeg && wingetFfprobe) {
    return {
      ffmpeg_path: wingetFfmpeg,
      ffprobe_path: wingetFfprobe
    };
  }

  return null;
}

function runRepairNative() {
  const result = spawnSync("npm", ["run", "rebuild:native"], {
    cwd: process.cwd(),
    shell: true,
    encoding: "utf8"
  });
  const fullOutput = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  if (result.status === 0) {
    return {
      ok: true,
      message: "Native modules rebuilt successfully."
    };
  }

  if (
    /EBUSY|operation not permitted|resource busy or locked/i.test(fullOutput) &&
    /better-sqlite3|better_sqlite3|node-gyp/i.test(fullOutput)
  ) {
    return {
      ok: false,
      code: "module_locked",
      message:
        "Repair could not run while native modules are in use. Close ClipScribe, then run: npm run rebuild:native"
    };
  }

  if (/gyp ERR|node-gyp|msbuild/i.test(fullOutput)) {
    return {
      ok: false,
      code: "build_tooling",
      message:
        "Native rebuild failed (node-gyp/toolchain). Install Windows C++ Build Tools, then run: npm run rebuild:native"
    };
  }

  const firstLine = fullOutput.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "Unknown error";
  return {
    ok: false,
    code: "unknown",
    message: `Repair failed: ${firstLine}`
  };
}

function sendUpdate(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function initServices() {
  const { initDatabase } = require("./services/database");
  const { createRepository } = require("./services/repository");
  const { createSettingsService } = require("./services/settings");
  const { createTranscriptionWorker } = require("./services/transcription");
  const { getUsageBreakdown, listSttModels } = require("./services/deepgram");
  const {
    summarizeTranscript,
    summarizeSessionBrief,
    planSessionQuestion,
    answerSessionQuestion,
    listFreeModels,
    getCurrentKeyInfo
  } = require("./services/openrouter");
  const { createRecordingService } = require("./services/recording");

  const appDataRoot = path.join(process.cwd(), "app-data");
  fs.mkdirSync(appDataRoot, { recursive: true });
  const dbPath = path.join(appDataRoot, "clipscribe.sqlite");
  const settingsPath = path.join(appDataRoot, "settings.json");
  const storageRoot = path.join(appDataRoot, "storage");
  fs.mkdirSync(storageRoot, { recursive: true });

  const db = initDatabase(dbPath);
  const repo = createRepository(db);
  repo.ensureDefaultFolder();

  const settingsService = createSettingsService({
    settingsPath,
    fallbackStorageRoot: storageRoot
  });

  const eventSink = {
    onSessionUpdated(sessionId) {
      sendUpdate("app:session-updated", { sessionId });
    },
    onGlobalUpdated() {
      sendUpdate("app:global-updated", { at: new Date().toISOString() });
    },
    onSummaryProgress(payload) {
      sendUpdate("app:summary-progress", payload || {});
    }
  };

  const transcriptionWorker = createTranscriptionWorker({
    repo,
    settingsService,
    eventSink
  });
  const recordingService = createRecordingService({
    repo,
    settingsService,
    transcriptionWorker,
    eventSink,
    summaryService: {
      summarizeTranscript,
      summarizeSessionBrief,
      planSessionQuestion,
      answerSessionQuestion
    }
  });

  recordingService.recoverInterruptedSessions();
  transcriptionWorker.start();

  services = {
    db,
    repo,
    settingsService,
    transcriptionWorker,
    recordingService,
    deepgramUsage: getUsageBreakdown,
    deepgramListModels: listSttModels,
    openrouterListFreeModels: listFreeModels,
    openrouterKeyInfo: getCurrentKeyInfo
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.webContents.on("did-finish-load", () => {
    logStartup("renderer did-finish-load");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, code, description, validatedURL, isMainFrame) => {
      logStartup(
        `renderer did-fail-load code=${code} description=${description} url=${validatedURL} mainFrame=${isMainFrame}`
      );
    }
  );
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logStartup(
      `renderer render-process-gone reason=${details?.reason || ""} exitCode=${
        details?.exitCode ?? ""
      }`
    );
    // Recover once so a transient renderer crash doesn't look like app won't open.
    if (!recoveredRendererOnce) {
      recoveredRendererOnce = true;
      try {
        createWindow();
      } catch (_) {
        // ignore
      }
    }
  });
  mainWindow.on("closed", () => {
    logStartup("main window closed");
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

function registerIpc() {
  function safeHandle(channel, handler) {
    ipcMain.handle(channel, async (event, payload) => {
      try {
        return await handler(event, payload);
      } catch (error) {
        const message = error?.message || String(error);
        console.error(`[IPC:${channel}]`, message);
        throw new Error(message);
      }
    });
  }

  safeHandle("app:bootstrap", async () => {
    const { recordingService, settingsService } = services;
    const [sources, foldersWithSessions, runtimeHealth] = await Promise.all([
      recordingService.listSources().catch(() => []),
      Promise.resolve(recordingService.listFoldersWithSessions()),
      recordingService.getRuntimeHealth()
    ]);
    return {
      settings: settingsService.getSettings(),
      sources,
      folders: foldersWithSessions,
      runtime_health: runtimeHealth
    };
  });

  safeHandle("settings:get", async () => {
    return services.settingsService.getSettings();
  });

  safeHandle("settings:update", async (_, partial) => {
    const updated = services.settingsService.updateSettings(partial || {});
    sendUpdate("app:global-updated", { at: new Date().toISOString() });
    return updated;
  });

  safeHandle("settings:auto-detect-ffmpeg", async () => {
    const found = detectFfmpegPaths();
    if (!found) {
      throw new Error("Could not auto-detect FFmpeg/FFprobe. Use CLI: clipscribe ffmpeg-detect.");
    }
    const updated = services.settingsService.updateSettings(found);
    sendUpdate("app:global-updated", { at: new Date().toISOString() });
    return updated;
  });

  safeHandle("settings:pick-export-output-dir", async (event) => {
    const dialogWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const current = services.settingsService.getSettings();
    const defaultPath = String(current.export_output_dir || current.storage_root || "").trim();
    const result = await dialog.showOpenDialog(dialogWindow, {
      title: "Choose Export Folder",
      defaultPath: defaultPath || undefined,
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    const picked = String(result.filePaths[0] || "").trim();
    if (!picked) {
      return { ok: false, canceled: true };
    }
    const updated = services.settingsService.updateSettings({ export_output_dir: picked });
    sendUpdate("app:global-updated", { at: new Date().toISOString() });
    return { ok: true, settings: updated };
  });

  safeHandle("app:repair-native", async () => {
    return runRepairNative();
  });

  safeHandle("deepgram:usage-breakdown", async (_, payload) => {
    const settings = services.settingsService.getSettings();
    const apiKey = settings.deepgram_api_key;
    if (!apiKey) {
      throw new Error("Deepgram API key is missing. Set it in Transcription Settings.");
    }
    try {
      const usage = await services.deepgramUsage({
        apiKey,
        projectId: String(payload?.projectId || settings.deepgram_project_id || "").trim(),
        start: String(payload?.start || "").trim(),
        end: String(payload?.end || "").trim(),
        grouping: String(payload?.grouping || "").trim(),
        endpoint: "listen"
      });
      return { ok: true, usage };
    } catch (error) {
      const message = String(error?.message || error || "");
      const lower = message.toLowerCase();
      if (lower.includes("deepgram error 403") && lower.includes("required scope")) {
        return {
          ok: false,
          code: "forbidden_scope",
          message:
            "This API key can transcribe audio but cannot read usage data. Create/use a key with usage:read scope for this project."
        };
      }
      if (lower.includes("deepgram error 400")) {
        return {
          ok: false,
          code: "bad_request",
          message:
            "Deepgram usage query was rejected. Try grouping=none and a short recent date range."
        };
      }
      throw error;
    }
  });

  safeHandle("deepgram:list-models", async () => {
    const settings = services.settingsService.getSettings();
    const apiKey = String(settings?.deepgram_api_key || "").trim();
    return services.deepgramListModels({ apiKey });
  });

  safeHandle("openrouter:list-free-models", async () => {
    return services.openrouterListFreeModels();
  });

  safeHandle("openrouter:key-info", async () => {
    const settings = services.settingsService.getSettings();
    const apiKey = String(settings?.openrouter_api_key || "").trim();
    if (!apiKey) {
      return {
        ok: false,
        code: "missing_key",
        message: "OpenRouter API key is missing."
      };
    }
    try {
      const key = await services.openrouterKeyInfo({ apiKey });
      return { ok: true, key };
    } catch (error) {
      const message = String(error?.message || error || "");
      const lower = message.toLowerCase();
      if (lower.includes("openrouter key error 401")) {
        return {
          ok: false,
          code: "unauthorized",
          message: "OpenRouter API key is invalid."
        };
      }
      if (lower.includes("openrouter key error 403")) {
        return {
          ok: false,
          code: "forbidden",
          message:
            "This OpenRouter key cannot read account usage metadata. Use a key with usage visibility."
        };
      }
      throw error;
    }
  });

  safeHandle("openrouter:raw-log-info", async () => {
    return {
      path: openRouterRawLogPath,
      exists: fs.existsSync(openRouterRawLogPath)
    };
  });

  safeHandle("openrouter:open-raw-log", async () => {
    fs.mkdirSync(path.dirname(openRouterRawLogPath), { recursive: true });
    if (!fs.existsSync(openRouterRawLogPath)) {
      fs.writeFileSync(openRouterRawLogPath, "", "utf8");
    }
    const openError = await shell.openPath(openRouterRawLogPath);
    if (openError) {
      throw new Error(`Could not open raw log file: ${openError}`);
    }
    return {
      ok: true,
      path: openRouterRawLogPath
    };
  });

  safeHandle("folders:create", async (_, name) => {
    const folder = services.repo.createFolder(name);
    sendUpdate("app:global-updated", { at: new Date().toISOString() });
    return folder;
  });

  safeHandle("folders:delete", async (_, folderId) => {
    services.repo.deleteFolder(folderId);
    sendUpdate("app:global-updated", { at: new Date().toISOString() });
    return { ok: true };
  });

  safeHandle("sessions:start", async (_, payload) => {
    const session = await services.recordingService.startSession(payload || {});
    sendUpdate("app:global-updated", { at: new Date().toISOString() });
    return session;
  });

  safeHandle("sessions:pause", async (_, sessionId) => {
    await services.recordingService.pauseSession(sessionId);
    return services.recordingService.getSessionDetail(sessionId);
  });

  safeHandle("sessions:resume", async (_, sessionId) => {
    await services.recordingService.resumeSession(sessionId);
    return services.recordingService.getSessionDetail(sessionId);
  });

  safeHandle("sessions:stop", async (_, sessionId) => {
    await services.recordingService.stopSession(sessionId);
    sendUpdate("app:global-updated", { at: new Date().toISOString() });
    return services.recordingService.getSessionDetail(sessionId);
  });

  safeHandle("sessions:detail", async (_, sessionId) => {
    return services.recordingService.getSessionDetail(sessionId);
  });

  safeHandle("sessions:export-transcript", async (event, payload) => {
    const sessionId = String(payload?.sessionId || "").trim();
    if (!sessionId) {
      throw new Error("sessionId is required.");
    }
    const options = payload?.options && typeof payload.options === "object" ? payload.options : {};

    const detail = services.recordingService.getSessionDetail(sessionId);
    const session = detail?.session || null;
    if (!session) {
      throw new Error("Session not found.");
    }

    const settings = services.settingsService.getSettings();
    const combinedOptions = {
      format: options.format ?? settings.export_format,
      include_meta: options.include_meta ?? settings.export_include_meta,
      include_summary: options.include_summary ?? settings.export_include_summary,
      apply_speaker_aliases:
        options.apply_speaker_aliases ?? settings.export_apply_speaker_aliases,
      output_dir: options.output_dir ?? settings.export_output_dir
    };

    const built = buildSessionTranscriptExport(detail, combinedOptions);
    const ext = String(built?.ext || "md").replace(/^\./, "") || "md";
    const dialogWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;

    const startedDate = String(session.started_at || "")
      .slice(0, 10)
      .replace(/[^0-9-]/g, "");
    const stem = sanitizeExportFileStem(session.title || "session");
    const suggestedName = startedDate
      ? `${stem} - ${startedDate} - transcript.${ext}`
      : `${stem} - transcript.${ext}`;
    const outputDir = String(combinedOptions.output_dir || "").trim();

    const filters = (() => {
      if (ext === "txt") {
        return [{ name: "Text", extensions: ["txt"] }];
      }
      if (ext === "pdf") {
        return [{ name: "PDF", extensions: ["pdf"] }];
      }
      if (ext === "json") {
        return [{ name: "JSON", extensions: ["json"] }];
      }
      return [{ name: "Markdown", extensions: ["md"] }];
    })();

    if (outputDir) {
      fs.mkdirSync(outputDir, { recursive: true });
      let outPath = ensureUniquePath(path.join(outputDir, suggestedName));
      if (!path.extname(outPath)) {
        outPath = `${outPath}.${ext}`;
      }

      if (built?.kind === "pdf") {
        const html = String(built?.html || "").trim();
        if (!html) {
          throw new Error("Missing PDF content.");
        }

        const tmpFileName = `clipscribe-export-${Date.now()}-${process.pid}-${Math.floor(Math.random() * 1e9)}.html`;
        const tmpPath = path.join(os.tmpdir(), tmpFileName);
        fs.writeFileSync(tmpPath, html, "utf8");

        const exportWindow = new BrowserWindow({
          show: false,
          width: 1100,
          height: 800,
          backgroundColor: "#ffffff",
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
          }
        });

        try {
          await exportWindow.loadFile(tmpPath);
          const pdfBuffer = await exportWindow.webContents.printToPDF({
            printBackground: true,
            preferCSSPageSize: true,
            margins: {
              top: 0.6,
              bottom: 0.7,
              left: 0.6,
              right: 0.6
            }
          });
          fs.writeFileSync(outPath, pdfBuffer);
        } finally {
          try {
            exportWindow.destroy();
          } catch (_) {
            // ignore window teardown failures
          }
          try {
            if (fs.existsSync(tmpPath)) {
              fs.unlinkSync(tmpPath);
            }
          } catch (_) {
            // ignore temp cleanup failures
          }
        }
      } else {
        fs.writeFileSync(outPath, String(built.content || ""), "utf8");
      }

      return { ok: true, path: outPath, used_default_dir: true };
    }

    const defaultDir = String(session.session_dir || "").trim() || settings.storage_root || process.cwd();
    const defaultPath = path.join(defaultDir, suggestedName);

    const result = await dialog.showSaveDialog(dialogWindow, {
      title: "Export Transcript",
      defaultPath,
      filters
    });

    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }

    let outPath = String(result.filePath || "").trim();
    if (!outPath) {
      return { ok: false, canceled: true };
    }
    if (!path.extname(outPath)) {
      outPath = `${outPath}.${ext}`;
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    if (built?.kind === "pdf") {
      const html = String(built?.html || "").trim();
      if (!html) {
        throw new Error("Missing PDF content.");
      }

      const tmpFileName = `clipscribe-export-${Date.now()}-${process.pid}-${Math.floor(Math.random() * 1e9)}.html`;
      const tmpPath = path.join(os.tmpdir(), tmpFileName);
      fs.writeFileSync(tmpPath, html, "utf8");

      const exportWindow = new BrowserWindow({
        show: false,
        width: 1100,
        height: 800,
        backgroundColor: "#ffffff",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false
        }
      });

      try {
        await exportWindow.loadFile(tmpPath);
        const pdfBuffer = await exportWindow.webContents.printToPDF({
          printBackground: true,
          preferCSSPageSize: true,
          margins: {
            top: 0.6,
            bottom: 0.7,
            left: 0.6,
            right: 0.6
          }
        });
        fs.writeFileSync(outPath, pdfBuffer);
      } finally {
        try {
          exportWindow.destroy();
        } catch (_) {
          // ignore window teardown failures
        }
        try {
          if (fs.existsSync(tmpPath)) {
            fs.unlinkSync(tmpPath);
          }
        } catch (_) {
          // ignore temp cleanup failures
        }
      }
    } else {
      fs.writeFileSync(outPath, String(built.content || ""), "utf8");
    }
    return { ok: true, path: outPath };
  });

  safeHandle("sessions:get", async (_, sessionId) => {
    return services.repo.getSession(sessionId);
  });

  safeHandle("sessions:move", async (_, { sessionId, folderId }) => {
    return services.recordingService.moveSession(sessionId, folderId);
  });

  safeHandle("sessions:rename", async (_, { sessionId, title }) => {
    const renamed = services.recordingService.renameSession(sessionId, title);
    sendUpdate("app:global-updated", { at: new Date().toISOString() });
    return renamed;
  });

  safeHandle("sessions:generate-summary", async (_, sessionId) => {
    return services.recordingService.generateSessionSummary(sessionId);
  });

  safeHandle("sessions:chat", async (_, payload) => {
    const sessionId = String(payload?.sessionId || "").trim();
    const question = String(payload?.question || "");
    return services.recordingService.askSessionChat(sessionId, question);
  });

  safeHandle("sessions:set-speaker-alias", async (_, { sessionId, speakerId, alias }) => {
    return services.recordingService.setSpeakerAlias(sessionId, speakerId, alias);
  });

  safeHandle("sessions:delete", async (_, sessionId) => {
    services.recordingService.deleteSession(sessionId);
    sendUpdate("app:global-updated", { at: new Date().toISOString() });
    return { ok: true };
  });

  safeHandle("sessions:change-sources", async (_, { sessionId, selectedSources }) => {
    return services.recordingService.changeSessionSources(sessionId, selectedSources);
  });

  safeHandle("audio:list-sources", async () => {
    return services.recordingService.listSources();
  });

  safeHandle("audio:test-source", async (_, { source, sessionId }) => {
    return services.recordingService.testAudioSource(source, sessionId);
  });

  safeHandle("files:read-binary", async (_, filePath) => {
    const targetPath = String(filePath || "").trim();
    if (!targetPath) {
      throw new Error("File path is required.");
    }
    const resolved = path.resolve(targetPath);
    const raw = fs.readFileSync(resolved);
    return raw.toString("base64");
  });
}

app.whenReady().then(() => {
  logStartup("app.whenReady resolved");
  initServices();
  logStartup("services initialized");
  registerIpc();
  logStartup("ipc registered");
  createWindow();
  logStartup("main window created");
}).catch((error) => {
  const message = error?.stack || error?.message || String(error);
  logStartup(`Startup failure: ${message}`);
  try {
    dialog.showErrorBox(
      "ClipScribe Startup Error",
      `${message}\n\nTry running: npm run rebuild:native`
    );
  } catch (_) {
    // ignore dialog failures in restricted environments
  }
  app.exit(1);
});

process.on("unhandledRejection", (error) => {
  const message = error?.stack || error?.message || String(error);
  logStartup(`Unhandled promise rejection: ${message}`);
});

process.on("uncaughtException", (error) => {
  const message = error?.stack || error?.message || String(error);
  logStartup(`Uncaught exception: ${message}`);
});

app.on("window-all-closed", () => {
  logStartup("window-all-closed");
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  logStartup("before-quit");
  if (services?.transcriptionWorker) {
    services.transcriptionWorker.stop();
  }
});

app.on("child-process-gone", (_event, details) => {
  logStartup(
    `child-process-gone type=${details?.type || ""} reason=${details?.reason || ""} exitCode=${
      details?.exitCode ?? ""
    }`
  );
});
