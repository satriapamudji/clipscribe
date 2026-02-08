/* global navigator */
const DEFAULT_SUMMARY_MODEL = "openrouter/free";
const FREE_OPENROUTER_MODELS = [
  DEFAULT_SUMMARY_MODEL,
  "meta-llama/llama-3.1-70b-instruct:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
  "google/gemma-3-27b-it:free",
  "google/gemma-3-12b-it:free",
  "qwen/qwen-2.5-72b-instruct:free"
];
const DEFAULT_DEEPGRAM_MODELS = [
  "nova-3",
  "nova-2",
  "nova-2-general",
  "nova-2-meeting",
  "nova-2-phonecall",
  "nova-2-video",
  "nova-2-conversationalai"
];

const state = {
  settings: null,
  folders: [],
  sources: [],
  runtimeHealth: null,
  selectedFolderId: null,
  selectedSessionId: null,
  activeView: "capture",
  captureSubView: "setup",
  detailSubView: "timeline",
  settingsSubView: "health",
  transcriptionSubView: "providers",
  sourcePickerOpen: false,
  sourceFilter: "all",
  sourceSearch: "",
  defaultSourceSearch: "",
  sessionSearch: "",
  sessionStatusFilter: "all",
  lastTestClip: null,
  usageBreakdown: null,
  usageLoading: false,
  usageError: "",
  summaryGenerating: false,
  summaryProgress: null,
  deepgramModels: [...DEFAULT_DEEPGRAM_MODELS],
  deepgramModelsLoading: false,
  deepgramModelsStatus: "",
  deepgramRateSuggestion: 0.0043,
  openRouterModels: [...FREE_OPENROUTER_MODELS],
  openRouterModelsLoading: false,
  openRouterModelsStatus: "",
  openRouterUsage: null,
  openRouterUsageError: "",
  openRouterUsageLoading: false
};

const els = {
  folderList: document.getElementById("folder-list"),
  sessionsList: document.getElementById("sessions-list"),
  sessionsHeading: document.getElementById("sessions-heading"),
  sourceList: document.getElementById("source-list"),
  detailChunks: document.getElementById("detail-chunks"),
  detailEvents: document.getElementById("detail-events"),
  detailMeta: document.getElementById("detail-meta"),
  detailEstimate: document.getElementById("detail-estimate"),
  detailSummaryPanel: document.getElementById("detail-summary-panel"),
  detailSummaryMeta: document.getElementById("detail-summary-meta"),
  detailSummaryText: document.getElementById("detail-summary-text"),
  detailSpeakers: document.getElementById("detail-speakers"),
  workspaceTitle: document.getElementById("workspace-title"),
  workspaceSubtitle: document.getElementById("workspace-subtitle"),
  shortcutHints: document.getElementById("shortcut-hints"),
  activeStatus: document.getElementById("active-status"),
  sessionFolderContext: document.getElementById("session-folder-context"),
  flowStepSession: document.getElementById("flow-step-session"),
  flowStepSources: document.getElementById("flow-step-sources"),
  flowStepRecording: document.getElementById("flow-step-recording"),
  sessionTitle: document.getElementById("session-title"),
  chunkSeconds: document.getElementById("chunk-seconds"),
  toast: document.getElementById("toast"),
  navCaptureBtn: document.getElementById("nav-capture-btn"),
  navSettingsBtn: document.getElementById("nav-settings-btn"),
  captureView: document.getElementById("capture-view"),
  settingsView: document.getElementById("settings-view"),
  captureTabSetup: document.getElementById("capture-tab-setup"),
  captureTabSessions: document.getElementById("capture-tab-sessions"),
  captureTabTranscript: document.getElementById("capture-tab-transcript"),
  detailTabTranscript: document.getElementById("detail-tab-transcript"),
  detailTabSummary: document.getElementById("detail-tab-summary"),
  detailTabTimeline: document.getElementById("detail-tab-timeline"),
  detailTabTimelineCount: document.getElementById("detail-tab-timeline-count"),
  captureSetupPanel: document.getElementById("capture-setup-panel"),
  captureSessionsPanel: document.getElementById("capture-sessions-panel"),
  captureTranscriptPanel: document.getElementById("capture-transcript-panel"),
  detailTranscriptPane: document.getElementById("detail-transcript-pane"),
  detailSummaryPane: document.getElementById("detail-summary-pane"),
  detailEventsPane: document.getElementById("detail-events-pane"),
  settingsTabHealth: document.getElementById("settings-tab-health"),
  settingsTabDefaults: document.getElementById("settings-tab-defaults"),
  settingsTabTranscription: document.getElementById("settings-tab-transcription"),
  settingsHealthPanel: document.getElementById("settings-health-panel"),
  settingsDefaultsPanel: document.getElementById("settings-defaults-panel"),
  settingsTranscriptionPanel: document.getElementById("settings-transcription-panel"),
  transcriptionTabProviders: document.getElementById("transcription-tab-providers"),
  transcriptionTabUsage: document.getElementById("transcription-tab-usage"),
  transcriptionProvidersPane: document.getElementById("transcription-providers-pane"),
  transcriptionUsagePane: document.getElementById("transcription-usage-pane"),
  sourcePickerToggle: document.getElementById("source-picker-toggle"),
  testSelectedSourceBtn: document.getElementById("test-selected-source-btn"),
  sourcePickerPanel: document.getElementById("source-picker-panel"),
  setupActionHint: document.getElementById("setup-action-hint"),
  sourceSearch: document.getElementById("source-search"),
  defaultSourceSearch: document.getElementById("default-source-search"),
  sourceFilterPills: document.getElementById("source-filter-pills"),
  selectedSourcesSummary: document.getElementById("selected-sources-summary"),
  sourceTestFeedback: document.getElementById("source-test-feedback"),
  sourceTestResult: document.getElementById("source-test-result"),
  sourceTestQuality: document.getElementById("source-test-quality"),
  sourceTestWave: document.getElementById("source-test-wave"),
  playLastTestBtn: document.getElementById("play-last-test-btn"),
  recordBtn: document.getElementById("record-btn"),
  pauseBtn: document.getElementById("pause-btn"),
  resumeBtn: document.getElementById("resume-btn"),
  stopBtn: document.getElementById("stop-btn"),
  copyAllBtn: document.getElementById("copy-all-btn"),
  openTranscriptBtn: document.getElementById("open-transcript-btn"),
  generateSummaryBtn: document.getElementById("generate-summary-btn"),
  renameSessionBtn: document.getElementById("rename-session-btn"),
  deleteSessionBtn: document.getElementById("delete-session-btn"),
  newFolderBtn: document.getElementById("new-folder-btn"),
  newFolderName: document.getElementById("new-folder-name"),
  deleteFolderBtn: document.getElementById("delete-folder-btn"),
  selectedFolderHint: document.getElementById("selected-folder-hint"),
  refreshSourcesBtn: document.getElementById("refresh-sources-btn"),
  startFromSetupBtn: document.getElementById("start-from-setup-btn"),
  applySourcesBtn: document.getElementById("apply-sources-btn"),
  chunkSecondsSettings: document.getElementById("chunk-seconds-settings"),
  deepgramApiKey: document.getElementById("deepgram-api-key"),
  deepgramProjectId: document.getElementById("deepgram-project-id"),
  deepgramModel: document.getElementById("deepgram-model"),
  refreshDeepgramModelsBtn: document.getElementById("refresh-deepgram-models-btn"),
  deepgramModelsStatus: document.getElementById("deepgram-models-status"),
  preprocessProfile: document.getElementById("preprocess-profile"),
  preprocessTimeoutMs: document.getElementById("preprocess-timeout-ms"),
  openrouterApiKey: document.getElementById("openrouter-api-key"),
  openrouterModel: document.getElementById("openrouter-model"),
  openrouterModelCustom: document.getElementById("openrouter-model-custom"),
  refreshOpenRouterModelsBtn: document.getElementById("refresh-openrouter-models-btn"),
  openRouterModelsStatus: document.getElementById("openrouter-models-status"),
  refreshOpenRouterUsageBtn: document.getElementById("refresh-openrouter-usage-btn"),
  openRouterUsageSummary: document.getElementById("openrouter-usage-summary"),
  openRouterUsageList: document.getElementById("openrouter-usage-list"),
  estimatedSttUsdPerMin: document.getElementById("estimated-stt-usd-per-min"),
  estimatedSttHint: document.getElementById("estimated-stt-hint"),
  saveSettingsBtn: document.getElementById("save-settings-btn"),
  detailGenerateSummaryBtn: document.getElementById("detail-generate-summary-btn"),
  detailCopySummaryBtn: document.getElementById("detail-copy-summary-btn"),
  refreshUsageBtn: document.getElementById("refresh-usage-btn"),
  usageStartDate: document.getElementById("usage-start-date"),
  usageEndDate: document.getElementById("usage-end-date"),
  usageGrouping: document.getElementById("usage-grouping"),
  usageSummary: document.getElementById("usage-summary"),
  usageList: document.getElementById("usage-list"),
  defaultSourceList: document.getElementById("default-source-list"),
  saveDefaultSourcesBtn: document.getElementById("save-default-sources-btn"),
  healthNative: document.getElementById("health-native"),
  healthFfmpeg: document.getElementById("health-ffmpeg"),
  healthAudio: document.getElementById("health-audio"),
  healthDeepgram: document.getElementById("health-deepgram"),
  setupNextStep: document.getElementById("setup-next-step"),
  detectFfmpegBtn: document.getElementById("detect-ffmpeg-btn"),
  repairNativeBtn: document.getElementById("repair-native-btn"),
  sessionsSearch: document.getElementById("sessions-search"),
  sessionsStatusFilter: document.getElementById("sessions-status-filter")
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

let refreshInFlight = false;
let refreshQueued = false;
let sessionUpdateTimer = null;
let pendingSessionUpdateId = null;
let sourceTestAudio = null;
let liveDurationTimer = null;
let sourceTestAnalysisToken = 0;

function safeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function friendlyError(errorLike) {
  const message = String(errorLike?.message || errorLike || "Unknown error.");
  if (message.toLowerCase().includes("wasapi")) {
    return "WASAPI capture is unavailable in this FFmpeg build. Pick a DirectShow source or run Auto-detect FFmpeg.";
  }
  if (message.toLowerCase().includes("output loopback")) {
    return "Output device loopback is unavailable. Repair native modules and restart the app.";
  }
  if (message.toLowerCase().includes("node_module_version")) {
    return "Native module mismatch detected. Click 'Repair Native Modules' and restart.";
  }
  if (message.toLowerCase().includes("compiled against a different node.js version")) {
    return "Native module ABI mismatch. Run repair-native, then restart the app.";
  }
  if (message.toLowerCase().includes("openrouter api key is missing")) {
    return "OpenRouter API key is missing. Add it in Transcription Settings to generate summaries.";
  }
  if (message.toLowerCase().includes("openrouter error 401")) {
    return "OpenRouter authentication failed. Check your OpenRouter API key.";
  }
  if (message.toLowerCase().includes("openrouter error 402")) {
    return `OpenRouter rejected the request for billing/credit reasons. Use a free model such as ${DEFAULT_SUMMARY_MODEL}.`;
  }
  if (message.toLowerCase().includes("openrouter models error")) {
    return "Could not load free model list from OpenRouter. Check internet connectivity and try again.";
  }
  if (message.toLowerCase().includes("openrouter key error 401")) {
    return "OpenRouter usage check failed: invalid API key.";
  }
  if (message.toLowerCase().includes("openrouter key error 403")) {
    return "OpenRouter usage check failed: this key cannot read usage metadata.";
  }
  if (message.toLowerCase().includes("openrouter returned an empty summary")) {
    return `The model returned no visible text (likely output token exhaustion). Auto-fallback is enabled; try Regenerate once. If it persists, use ${DEFAULT_SUMMARY_MODEL}.`;
  }
  if (message.toLowerCase().includes("deepgram error") && message.toLowerCase().includes("/v1/models")) {
    return "Could not sync Deepgram models. Check API key/network and try again.";
  }
  if (message.toLowerCase().includes("usage/breakdown")) {
    return "Deepgram usage query was rejected. Try grouping=none, clear Project ID, and keep a short recent date range, then refresh again.";
  }
  if (message.toLowerCase().includes("unique")) {
    return "That folder name already exists. Choose a different name.";
  }
  return message;
}

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  els.toast.style.background = isError ? "#991b1b" : "#111827";
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 2500);
}

function formatSeconds(sec) {
  const total = Math.max(0, Math.floor(Number(sec || 0)));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  return [hh, mm, ss].map((n) => String(n).padStart(2, "0")).join(":");
}

function formatShortClock(sec) {
  const total = Math.max(0, Math.floor(Number(sec || 0)));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  if (hh > 0) {
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function countWords(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) {
    return 0;
  }
  return cleaned.split(/\s+/).filter(Boolean).length;
}

function getSpeakerIdsFromText(text) {
  const source = String(text || "");
  const ids = new Set();
  const regex = /\bSpeaker\s+(\d+):/g;
  let match = regex.exec(source);
  while (match) {
    const id = Number.parseInt(match[1], 10);
    if (Number.isInteger(id) && id >= 0) {
      ids.add(id);
    }
    match = regex.exec(source);
  }
  return [...ids].sort((a, b) => a - b);
}

function getSpeakerIdsFromChunks(chunks) {
  const ids = new Set();
  for (const chunk of chunks || []) {
    for (const id of getSpeakerIdsFromText(chunk?.text || "")) {
      ids.add(id);
    }
  }
  return [...ids].sort((a, b) => a - b);
}

function buildSpeakerAliasMap(events) {
  const map = {};
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
      delete map[speakerId];
      continue;
    }
    map[speakerId] = alias;
  }
  return map;
}

function applySpeakerAliasesToText(text, aliasMap) {
  const source = String(text || "");
  if (!source) {
    return "";
  }
  return source.replace(/\bSpeaker\s+(\d+):/g, (full, idText) => {
    const id = Number.parseInt(String(idText), 10);
    if (!Number.isInteger(id) || id < 0) {
      return full;
    }
    const alias = String(aliasMap?.[id] || "").trim();
    return alias ? `${alias}:` : full;
  });
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
      return {
        kind: "raw",
        raw
      };
    }

    const start = normalizeClockToken(timedMatch[1]);
    const end = normalizeClockToken(timedMatch[2]);
    const trailing = String(timedMatch[3] || "").trim();
    const speakerMatch = trailing.match(/^([^:]{1,80}):\s*(.*)$/);
    if (!speakerMatch) {
      return {
        kind: "timed",
        range: `[${start}-${end}]`,
        speaker: "",
        content: trailing
      };
    }
    return {
      kind: "timed",
      range: `[${start}-${end}]`,
      speaker: String(speakerMatch[1] || "").trim(),
      content: String(speakerMatch[2] || "").trim()
    };
  });
}

function buildChunkTextMarkup(text) {
  const rows = parseTranscriptDisplayRows(text);
  const hasTimed = rows.some((row) => row.kind === "timed");
  if (!hasTimed) {
    return `<div class="chunk-text-plain">${safeText(text)}</div>`;
  }

  const html = rows
    .map((row) => {
      if (row.kind !== "timed") {
        const raw = String(row.raw || "").trim();
        return `<div class="chunk-line raw"><span class="chunk-line-content">${safeText(raw)}</span></div>`;
      }
      const speaker = String(row.speaker || "").trim();
      const content = String(row.content || "").trim();
      const speakerHtml = speaker
        ? `<span class="chunk-line-speaker">${safeText(speaker)}:</span>`
        : '<span class="chunk-line-speaker"></span>';
      return `
        <div class="chunk-line">
          <span class="chunk-line-range">${safeText(row.range || "")}</span>
          ${speakerHtml}
          <span class="chunk-line-content">${safeText(content)}</span>
        </div>
      `;
    })
    .join("");

  return `<div class="chunk-lines">${html}</div>`;
}

function unwrapMarkdownCodeFence(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return "";
  }
  const fenced = raw.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? String(fenced[1] || "").trim() : raw;
}

function markdownToPlainText(text) {
  const unfenced = unwrapMarkdownCodeFence(text);
  if (!unfenced) {
    return "";
  }
  return unfenced
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[(.*?)\]\([^)]+\)/g, "$1")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function sanitizeExternalUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) {
    return "";
  }
  if (/^https?:\/\//i.test(raw) || /^mailto:/i.test(raw)) {
    return raw;
  }
  return "";
}

function renderInlineMarkdown(text) {
  const raw = String(text || "");
  if (!raw) {
    return "";
  }
  const codeTokens = [];
  let html = safeText(raw);

  html = html.replace(/`([^`]+)`/g, (_m, codeText) => {
    const token = `@@CODE_${codeTokens.length}@@`;
    codeTokens.push(`<code>${codeText}</code>`);
    return token;
  });

  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
    const safeHref = sanitizeExternalUrl(href);
    if (!safeHref) {
      return label;
    }
    return `<a href="${safeText(safeHref)}" target="_blank" rel="noreferrer noopener">${label}</a>`;
  });

  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  html = html.replace(/@@CODE_(\d+)@@/g, (_m, idxText) => {
    const idx = Number.parseInt(String(idxText), 10);
    return codeTokens[idx] || "";
  });

  return html;
}

function markdownToSafeHtml(text) {
  const source = unwrapMarkdownCodeFence(text).replace(/\r/g, "").trim();
  if (!source) {
    return "";
  }
  const lines = source.split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = String(lines[i] || "");
    const trimmed = line.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = Math.min(6, Math.max(1, headingMatch[1].length));
      blocks.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(String(lines[i]).replace(/^\s*[-*+]\s+/, "").trim());
        i += 1;
      }
      blocks.push(`<ul>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(String(lines[i]).replace(/^\s*\d+[.)]\s+/, "").trim());
        i += 1;
      }
      blocks.push(`<ol>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ol>`);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(String(lines[i]).replace(/^\s*>\s?/, "").trim());
        i += 1;
      }
      blocks.push(`<blockquote>${quoteLines.map((row) => renderInlineMarkdown(row)).join("<br />")}</blockquote>`);
      continue;
    }

    const paragraph = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i].trim()) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i])
    ) {
      paragraph.push(String(lines[i]).trim());
      i += 1;
    }
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
  }

  return blocks.join("");
}

function stripSummarySectionTitle(line) {
  const stripped = String(line || "").replace(/^#{1,6}\s*/g, "").trim();
  const match = stripped.match(
    /^(executive summary|key points|decisions|action items|open questions|next steps)\s*[:\-]?\s*$/i
  );
  if (!match) {
    return stripped;
  }
  const normalized = String(match[1] || "").toLowerCase();
  if (normalized === "executive summary") return "Executive Summary";
  if (normalized === "key points") return "Key Points";
  if (normalized === "decisions") return "Decisions";
  if (normalized === "action items") return "Action Items";
  if (normalized === "open questions") return "Open Questions";
  if (normalized === "next steps") return "Next Steps";
  return stripped;
}

function normalizeSummaryTextForUi(summaryText) {
  const plain = markdownToPlainText(summaryText);
  if (!plain) {
    return "";
  }
  const lines = plain.split(/\r?\n/).map((line) => line.trimEnd());
  const normalized = [];
  for (const line of lines) {
    const cleaned = stripSummarySectionTitle(line);
    if (!cleaned) {
      normalized.push("");
      continue;
    }
    normalized.push(cleaned);
  }
  return normalized
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractExecutiveSummaryPreview(summaryText) {
  const plain = markdownToPlainText(summaryText);
  if (!plain) {
    return "";
  }
  const normalized = plain.replace(/\r/g, "").trim();
  const sectionMatch = normalized.match(
    /(?:^|\n)\s*executive summary\s*[:\-]?\s*([\s\S]*?)(?:\n\s*(?:key points|decisions|action items|open questions|next steps)\s*[:\-]?\s*|$)/i
  );
  const source = sectionMatch ? String(sectionMatch[1] || "") : normalized;
  const flattened = source
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !/^meeting notes\b/i.test(line))
    .join(" ");
  if (!flattened) {
    return "";
  }
  const sentenceMatch = flattened.match(/^(.{1,190}?[.!?])(?:\s|$)/);
  return (sentenceMatch ? sentenceMatch[1] : flattened).trim();
}

function toObjectiveSessionBlurb(text) {
  let value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) {
    return "";
  }
  value = value
    .replace(
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(discuss(?:ed|es)?|talk(?:ed|s)? about|shared|reflect(?:ed|s) on|explain(?:ed|s)?|describe(?:d|s)?|mention(?:ed|s)?)\s+/i,
      "Discussion covered "
    )
    .replace(/^(He|She|They|We|I)\s+/i, "")
    .replace(/^\s*(This session|The session)\s+/i, "")
    .trim();

  if (!/^(Focus:|Discussion covered)/i.test(value)) {
    value = `Focus: ${value.charAt(0).toLowerCase()}${value.slice(1)}`;
  }
  return value;
}

function buildSessionSummaryPreview(session) {
  const brief = String(session?.summary_brief_text || "").replace(/\s+/g, " ").trim();
  if (brief) {
    return brief;
  }
  const previewFromSummary = extractExecutiveSummaryPreview(session?.summary_text || "");
  const hasSummaryAutomation = Boolean(String(state.settings?.openrouter_api_key || "").trim());
  if (previewFromSummary) {
    const candidate = toObjectiveSessionBlurb(previewFromSummary).replace(/\s+/g, " ").trim();
    const sentences = candidate.match(/[^.!?]+[.!?]+/g);
    if (Array.isArray(sentences) && sentences.length >= 2) {
      return `${sentences[0].trim()} ${sentences[1].trim()}`.trim();
    }
    return candidate;
  }
  if (session?.status === "recording" || session?.status === "paused") {
    return "Focus: recording in progress. Objective summary will be generated after stop.";
  }
  if (session?.status === "stopped") {
    return hasSummaryAutomation
      ? "Focus: summary is pending and will be generated automatically."
      : "Focus: set OpenRouter API key in Settings to enable auto-summary.";
  }
  return "Focus: session summary not available yet.";
}

function formatPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return null;
  }
  return `${Math.round(num * 100)}%`;
}

function formatCurrency(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return "$0.00";
  }
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
}

function formatUsdPrecise(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return "$0.0000";
  }
  return `$${num.toFixed(4)}`;
}

function formatDateInputValue(dateLike) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getDisplayRecordedSeconds(session) {
  if (!session) {
    return 0;
  }
  const base = Number(session.recorded_seconds || 0);
  if (session.status !== "recording") {
    return base;
  }
  const updatedAtMs = Date.parse(session.updated_at || session.started_at || "");
  if (!Number.isFinite(updatedAtMs)) {
    return base;
  }
  const elapsed = Math.max(0, (Date.now() - updatedAtMs) / 1000);
  return base + elapsed;
}

function filePathToUrl(filePath) {
  const raw = String(filePath || "").trim();
  if (!raw) {
    return "";
  }
  const normalized = raw.replace(/\\/g, "/");
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return encodeURI(`file:///${normalized}`);
  }
  if (normalized.startsWith("/")) {
    return encodeURI(`file://${normalized}`);
  }
  return encodeURI(`file:///${normalized}`);
}

function base64ToArrayBuffer(base64) {
  const normalized = String(base64 || "").trim();
  if (!normalized) {
    return new ArrayBuffer(0);
  }
  const binary = window.atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function resizeCanvasToDisplaySize(canvas) {
  if (!canvas) {
    return { width: 0, height: 0 };
  }
  const dpr = window.devicePixelRatio || 1;
  const displayWidth = Math.max(1, Math.floor((canvas.clientWidth || canvas.width || 1) * dpr));
  const displayHeight = Math.max(1, Math.floor((canvas.clientHeight || canvas.height || 1) * dpr));
  if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
    canvas.width = displayWidth;
    canvas.height = displayHeight;
  }
  return { width: displayWidth, height: displayHeight };
}

function renderSourceWavePlaceholder(message) {
  const canvas = els.sourceTestWave;
  if (!canvas) {
    return;
  }
  const { width, height } = resizeCanvasToDisplaySize(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx || width <= 0 || height <= 0) {
    return;
  }
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f7fbff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#d5e0f3";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  if (!message) {
    return;
  }
  ctx.fillStyle = "#6e7fa1";
  ctx.font = `${Math.max(11, Math.round(11 * (window.devicePixelRatio || 1)))}px Aptos, Segoe UI, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(message, width / 2, height / 2);
}

function renderSourceWaveform(points) {
  const canvas = els.sourceTestWave;
  if (!canvas) {
    return;
  }
  const { width, height } = resizeCanvasToDisplaySize(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx || width <= 0 || height <= 0) {
    return;
  }
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f7fbff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#d5e0f3";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  const midY = height / 2;
  ctx.strokeStyle = "rgba(110, 128, 160, 0.4)";
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(width, midY);
  ctx.stroke();

  if (!Array.isArray(points) || points.length === 0) {
    return;
  }
  const step = width / points.length;
  const amp = midY * 0.9;
  ctx.strokeStyle = "#0b8c83";
  ctx.lineWidth = Math.max(1, (window.devicePixelRatio || 1) * 0.9);
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const max = Math.max(-1, Math.min(1, Number(point.max || 0)));
    const min = Math.max(-1, Math.min(1, Number(point.min || 0)));
    const x = Math.floor(i * step) + 0.5;
    const yTop = midY - max * amp;
    const yBottom = midY - min * amp;
    ctx.beginPath();
    ctx.moveTo(x, yTop);
    ctx.lineTo(x, yBottom);
    ctx.stroke();
  }
}

function setSourceTestQuality(level, message) {
  els.sourceTestQuality.textContent = message;
  els.sourceTestQuality.classList.remove("ok", "warn", "bad", "pending");
  if (level) {
    els.sourceTestQuality.classList.add(level);
  }
}

function buildWaveformBuckets(channelData, bucketCount) {
  if (!channelData || channelData.length === 0 || bucketCount <= 0) {
    return [];
  }
  const points = [];
  const bucketSize = Math.max(1, Math.floor(channelData.length / bucketCount));
  for (let i = 0; i < bucketCount; i += 1) {
    const start = i * bucketSize;
    if (start >= channelData.length) {
      break;
    }
    const end = Math.min(channelData.length, start + bucketSize);
    let min = 1;
    let max = -1;
    for (let idx = start; idx < end; idx += 1) {
      const sample = channelData[idx];
      if (sample < min) {
        min = sample;
      }
      if (sample > max) {
        max = sample;
      }
    }
    points.push({ min, max });
  }
  return points;
}

function classifySourceSignal({ peak, rms, silenceRatio, clippingRatio }) {
  const peakPct = Math.round(peak * 100);
  const rmsPct = Math.round(rms * 100);
  const silencePct = Math.round(silenceRatio * 100);

  if (peak < 0.012 || rms < 0.004) {
    return {
      level: "bad",
      label: `Signal too low (Peak ${peakPct}%, RMS ${rmsPct}%). Raise source/output volume.`
    };
  }
  if (silenceRatio > 0.96) {
    return {
      level: "bad",
      label: `Mostly silence detected (${silencePct}% silent). Verify selected source.`
    };
  }
  if (clippingRatio > 0.008) {
    return {
      level: "warn",
      label: `Possible clipping detected. Peak ${peakPct}%, RMS ${rmsPct}%.`
    };
  }
  if (rms < 0.014) {
    return {
      level: "warn",
      label: `Signal is a bit quiet. Peak ${peakPct}%, RMS ${rmsPct}%.`
    };
  }
  return {
    level: "ok",
    label: `Signal looks healthy. Peak ${peakPct}%, RMS ${rmsPct}%.`
  };
}

async function analyzeSourceTestClip(filePath) {
  if (!filePath) {
    throw new Error("Missing test file path.");
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) {
    throw new Error("Web Audio API unavailable.");
  }
  const base64 = await window.clipscribe.readFileBase64(filePath);
  const arrayBuffer = base64ToArrayBuffer(base64);
  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    throw new Error("Could not load test audio clip.");
  }
  const audioContext = new Ctx();
  try {
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const channels = decoded.numberOfChannels;
    const sampleCount = decoded.length;
    if (!sampleCount || channels < 1) {
      throw new Error("Decoded test clip is empty.");
    }

    let peak = 0;
    let sumSquares = 0;
    let silentSamples = 0;
    let clippedSamples = 0;
    let totalSamples = 0;
    for (let c = 0; c < channels; c += 1) {
      const data = decoded.getChannelData(c);
      totalSamples += data.length;
      for (let i = 0; i < data.length; i += 1) {
        const sample = data[i];
        const abs = Math.abs(sample);
        if (abs > peak) {
          peak = abs;
        }
        sumSquares += sample * sample;
        if (abs < 0.0015) {
          silentSamples += 1;
        }
        if (abs > 0.995) {
          clippedSamples += 1;
        }
      }
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, totalSamples));
    const silenceRatio = silentSamples / Math.max(1, totalSamples);
    const clippingRatio = clippedSamples / Math.max(1, totalSamples);
    const summary = classifySourceSignal({ peak, rms, silenceRatio, clippingRatio });
    const buckets = buildWaveformBuckets(decoded.getChannelData(0), 220);

    return {
      ...summary,
      waveform: buckets
    };
  } finally {
    try {
      await audioContext.close();
    } catch (_) {
      // ignore close failures
    }
  }
}

async function runSourceTestAnalysis(clip) {
  if (!clip?.path) {
    return;
  }
  const token = ++sourceTestAnalysisToken;
  setSourceTestQuality("pending", "Analyzing signal...");
  renderSourceWavePlaceholder("Analyzing...");
  try {
    const analysis = await analyzeSourceTestClip(clip.path);
    if (token !== sourceTestAnalysisToken || state.lastTestClip?.path !== clip.path) {
      return;
    }
    clip.analysis = analysis;
    renderSourceTestFeedback();
  } catch (error) {
    if (token !== sourceTestAnalysisToken || state.lastTestClip?.path !== clip.path) {
      return;
    }
    const errorMessage =
      error?.message && String(error.message).trim()
        ? String(error.message).trim()
        : "waveform analysis is unavailable.";
    clip.analysis = {
      level: "warn",
      label: `Recorded test clip, but ${errorMessage}`
    };
    renderSourceTestFeedback();
  }
}

function renderSourceTestFeedback() {
  const hasClip = Boolean(state.lastTestClip?.path);
  els.sourceTestFeedback.classList.toggle("hidden", !hasClip);
  if (!hasClip) {
    els.sourceTestResult.textContent = "No test clip yet.";
    setSourceTestQuality("", "No signal data");
    renderSourceWavePlaceholder("Run a source test to preview waveform.");
    els.playLastTestBtn.disabled = true;
    return;
  }
  const duration = formatSeconds(state.lastTestClip.durationSec || 0);
  els.sourceTestResult.textContent = `Last test: ${state.lastTestClip.sourceLabel} (${duration})`;
  if (state.lastTestClip.analysis) {
    setSourceTestQuality(state.lastTestClip.analysis.level, state.lastTestClip.analysis.label);
    renderSourceWaveform(state.lastTestClip.analysis.waveform || []);
  } else {
    setSourceTestQuality("pending", "Analyzing signal...");
    renderSourceWavePlaceholder("Analyzing...");
  }
  els.playLastTestBtn.disabled = false;
}

async function playLastTestClip() {
  const clip = state.lastTestClip;
  if (!clip?.path) {
    showToast("No test clip available yet.", true);
    return false;
  }
  try {
    if (sourceTestAudio) {
      sourceTestAudio.pause();
      sourceTestAudio.currentTime = 0;
    }
    const audio = new Audio(filePathToUrl(clip.path));
    sourceTestAudio = audio;
    await audio.play();
    return true;
  } catch (_) {
    return false;
  }
}

async function replayLastTestClip() {
  const ok = await playLastTestClip();
  if (!ok) {
    showToast("Could not play the test clip. Check your output device.", true);
    return;
  }
  showToast("Playing last test clip...");
}

async function runSourceTest(source, sessionId = null) {
  if (!source) {
    showToast("Select a source to test.", true);
    return;
  }
  showToast(`Testing ${source.label}...`);
  try {
    const result = await window.clipscribe.testSource(source, sessionId);
    const clip = {
      path: result.test_file_path,
      durationSec: Number(result.duration_sec || 0),
      sourceLabel: source.label || "Source"
    };
    state.lastTestClip = clip;
    renderSourceTestFeedback();
    const analysisPromise = runSourceTestAnalysis(clip);
    const played = await playLastTestClip();
    await analysisPromise;
    if (played) {
      showToast(`Test recorded and playing back (${formatSeconds(result.duration_sec || 0)}).`);
      return;
    }
    showToast(`Test recorded (${formatSeconds(result.duration_sec || 0)}). Click Play Last Test.`);
  } catch (error) {
    showToast(friendlyError(error), true);
  }
}

function allSessions() {
  return state.folders.flatMap((folder) => folder.sessions || []);
}

function findFolder(folderId) {
  return state.folders.find((folder) => folder.id === folderId) || null;
}

function findSession(sessionId) {
  return allSessions().find((session) => session.id === sessionId) || null;
}

function findSource(sourceId) {
  return state.sources.find((source) => source.id === sourceId) || null;
}

function getActiveSession() {
  return (
    allSessions().find(
      (session) => session.status === "recording" || session.status === "paused"
    ) || null
  );
}

function getSelectedSessions() {
  const folder = findFolder(state.selectedFolderId);
  return folder ? folder.sessions || [] : [];
}

function filterSessions(sessions) {
  const needle = state.sessionSearch.trim().toLowerCase();
  return sessions.filter((session) => {
    if (state.sessionStatusFilter === "active") {
      if (!(session.status === "recording" || session.status === "paused")) {
        return false;
      }
    } else if (state.sessionStatusFilter === "stopped") {
      if (session.status !== "stopped") {
        return false;
      }
    }

    if (!needle) {
      return true;
    }
    return (
      String(session.title || "").toLowerCase().includes(needle) ||
      String(session.status || "").toLowerCase().includes(needle)
    );
  });
}

function setView(nextView) {
  state.activeView = nextView === "settings" ? "settings" : "capture";
  const isSettings = state.activeView === "settings";
  els.captureView.classList.toggle("hidden", isSettings);
  els.settingsView.classList.toggle("hidden", !isSettings);
  els.navCaptureBtn.classList.toggle("active", !isSettings);
  els.navSettingsBtn.classList.toggle("active", isSettings);
  els.navCaptureBtn.setAttribute("aria-selected", isSettings ? "false" : "true");
  els.navSettingsBtn.setAttribute("aria-selected", isSettings ? "true" : "false");
  els.navCaptureBtn.tabIndex = isSettings ? -1 : 0;
  els.navSettingsBtn.tabIndex = isSettings ? 0 : -1;
}

function setCaptureSubView(nextSubView) {
  const valid = ["setup", "sessions", "transcript"];
  state.captureSubView = valid.includes(nextSubView) ? nextSubView : "setup";
  const isSetup = state.captureSubView === "setup";
  const isSessions = state.captureSubView === "sessions";
  const isTranscript = state.captureSubView === "transcript";

  els.captureSetupPanel.classList.toggle("hidden", !isSetup);
  els.captureSessionsPanel.classList.toggle("hidden", !isSessions);
  els.captureTranscriptPanel.classList.toggle("hidden", !isTranscript);

  els.captureTabSetup.classList.toggle("active", isSetup);
  els.captureTabSessions.classList.toggle("active", isSessions);
  els.captureTabTranscript.classList.toggle("active", isTranscript);

  els.captureTabSetup.setAttribute("aria-selected", isSetup ? "true" : "false");
  els.captureTabSessions.setAttribute("aria-selected", isSessions ? "true" : "false");
  els.captureTabTranscript.setAttribute("aria-selected", isTranscript ? "true" : "false");
}

function setDetailSubView(nextSubView) {
  const valid = ["transcript", "summary", "timeline"];
  state.detailSubView = valid.includes(nextSubView) ? nextSubView : "transcript";
  const isTranscript = state.detailSubView === "transcript";
  const isSummary = state.detailSubView === "summary";
  const isTimeline = state.detailSubView === "timeline";
  if (els.detailTranscriptPane) {
    els.detailTranscriptPane.classList.toggle("hidden", !isTranscript);
  }
  if (els.detailSummaryPane) {
    els.detailSummaryPane.classList.toggle("hidden", !isSummary);
  }
  if (els.detailEventsPane) {
    els.detailEventsPane.classList.toggle("hidden", !isTimeline);
  }
  if (els.detailTabTranscript) {
    els.detailTabTranscript.classList.toggle("active", isTranscript);
    els.detailTabTranscript.setAttribute("aria-selected", isTranscript ? "true" : "false");
  }
  if (els.detailTabSummary) {
    els.detailTabSummary.classList.toggle("active", isSummary);
    els.detailTabSummary.setAttribute("aria-selected", isSummary ? "true" : "false");
  }
  if (els.detailTabTimeline) {
    els.detailTabTimeline.classList.toggle("active", isTimeline);
    els.detailTabTimeline.setAttribute("aria-selected", isTimeline ? "true" : "false");
  }
}

function setSettingsSubView(nextSubView) {
  const valid = ["health", "defaults", "transcription"];
  state.settingsSubView = valid.includes(nextSubView) ? nextSubView : "health";
  const isHealth = state.settingsSubView === "health";
  const isDefaults = state.settingsSubView === "defaults";
  const isTranscription = state.settingsSubView === "transcription";

  els.settingsHealthPanel.classList.toggle("hidden", !isHealth);
  els.settingsDefaultsPanel.classList.toggle("hidden", !isDefaults);
  els.settingsTranscriptionPanel.classList.toggle("hidden", !isTranscription);

  els.settingsTabHealth.classList.toggle("active", isHealth);
  els.settingsTabDefaults.classList.toggle("active", isDefaults);
  els.settingsTabTranscription.classList.toggle("active", isTranscription);

  els.settingsTabHealth.setAttribute("aria-selected", isHealth ? "true" : "false");
  els.settingsTabDefaults.setAttribute("aria-selected", isDefaults ? "true" : "false");
  els.settingsTabTranscription.setAttribute("aria-selected", isTranscription ? "true" : "false");
  if (isTranscription) {
    setTranscriptionSubView(state.transcriptionSubView);
  }
}

function setTranscriptionSubView(nextSubView) {
  const valid = ["providers", "usage"];
  state.transcriptionSubView = valid.includes(nextSubView) ? nextSubView : "providers";
  const isProviders = state.transcriptionSubView === "providers";
  const isUsage = state.transcriptionSubView === "usage";

  if (els.transcriptionProvidersPane) {
    els.transcriptionProvidersPane.classList.toggle("hidden", !isProviders);
  }
  if (els.transcriptionUsagePane) {
    els.transcriptionUsagePane.classList.toggle("hidden", !isUsage);
  }
  if (els.transcriptionTabProviders) {
    els.transcriptionTabProviders.classList.toggle("active", isProviders);
    els.transcriptionTabProviders.setAttribute("aria-selected", isProviders ? "true" : "false");
  }
  if (els.transcriptionTabUsage) {
    els.transcriptionTabUsage.classList.toggle("active", isUsage);
    els.transcriptionTabUsage.setAttribute("aria-selected", isUsage ? "true" : "false");
  }
}

function setSourcePickerOpen(isOpen) {
  state.sourcePickerOpen = Boolean(isOpen);
  els.sourcePickerPanel.classList.toggle("hidden", !state.sourcePickerOpen);
  els.sourcePickerToggle.setAttribute("aria-expanded", state.sourcePickerOpen ? "true" : "false");
  els.sourcePickerToggle.textContent = state.sourcePickerOpen ? "Close Sources" : "Pick Sources";
}

function setHealthCard(element, ok, text, level = "ok") {
  element.textContent = text;
  element.classList.remove("ok", "warn", "bad");
  if (ok) {
    element.classList.add("ok");
  } else {
    element.classList.add(level === "warn" ? "warn" : "bad");
  }
}

function renderHealth() {
  const health = state.runtimeHealth || {};
  setHealthCard(els.healthNative, true, "Native modules: Loaded");
  const ffOk = Boolean(health.ffmpeg_ok && health.ffprobe_ok);
  setHealthCard(
    els.healthFfmpeg,
    ffOk,
    ffOk ? "FFmpeg/FFprobe: Ready" : "FFmpeg/FFprobe: Missing",
    "bad"
  );

  const hasInputBackend = Boolean(
    health.has_dshow ||
    health.has_wasapi ||
    health.has_native_loopback ||
    health.has_wasapi_output_loopback
  );
  const sourceSuffix = Number.isFinite(health.source_count)
    ? ` (${health.source_count} sources)`
    : "";
  const backendParts = [];
  if (health.has_native_loopback) {
    backendParts.push("Native loopback");
  }
  if (health.has_wasapi_output_loopback) {
    backendParts.push("WASAPI output");
  }
  if (health.has_wasapi) {
    backendParts.push("WASAPI");
  }
  if (health.has_dshow) {
    backendParts.push("DirectShow");
  }
  const audioText = hasInputBackend
    ? `Audio: ${backendParts.join(", ")}${sourceSuffix}`
    : "Audio backend: No capture backend available";
  setHealthCard(
    els.healthAudio,
    hasInputBackend,
    audioText,
    health.has_dshow ? "warn" : "bad"
  );

  const hasKey = Boolean(state.settings?.deepgram_api_key);
  setHealthCard(
    els.healthDeepgram,
    hasKey,
    hasKey ? "Deepgram API key: Configured" : "Deepgram API key: Missing",
    "warn"
  );

  if (!ffOk) {
    els.setupNextStep.textContent =
      "Next step: click Auto-Detect FFmpeg. If still missing, run clipscribe ffmpeg-install --yes.";
    return;
  }
  if (!hasInputBackend) {
    els.setupNextStep.textContent = "Next step: your FFmpeg has no supported capture backend. Install a full Windows build with DirectShow support.";
    return;
  }
  if (!hasKey) {
    els.setupNextStep.textContent = "Next step: add your Deepgram API key under Transcription Settings, then save.";
    return;
  }
  els.setupNextStep.textContent = "Ready. Pick sources and press Start.";
}

function renderStatus() {
  const active = getActiveSession();
  if (!active) {
    els.activeStatus.textContent = "Idle";
    return;
  }
  const duration = formatSeconds(getDisplayRecordedSeconds(active));
  els.activeStatus.textContent =
    active.status === "recording"
      ? `Recording ${duration}`
      : `Paused ${duration}`;
}

function renderWorkspaceHeader() {
  const isSettings = state.activeView === "settings";
  if (isSettings) {
    els.workspaceTitle.textContent = "Workspace Settings";
    els.workspaceSubtitle.textContent =
      "Configure capture health, transcription defaults, and source presets.";
    els.shortcutHints.classList.add("hidden");
    return;
  }
  els.workspaceTitle.textContent = "Meeting Capture Workspace";
  els.workspaceSubtitle.textContent =
    "Capture meeting and call audio, then review timestamped transcript chunks for notes, docs, or AI workflows.";
  els.shortcutHints.classList.remove("hidden");
}

function renderFolderContext() {
  const folder = findFolder(state.selectedFolderId);
  const name = folder ? folder.name : "None";
  els.sessionFolderContext.textContent = `Folder: ${name}`;
  els.selectedFolderHint.textContent = folder
    ? `${folder.name} selected`
    : "No folder selected";
}

function renderFolders() {
  els.folderList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const folder of state.folders) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `folder-card${folder.id === state.selectedFolderId ? " active" : ""}`;
    card.dataset.folderId = folder.id;
    card.innerHTML = `
      <div class="folder-card-head">
        <span class="folder-card-name">${safeText(folder.name)}</span>
        <span class="folder-card-count">${(folder.sessions || []).length}</span>
      </div>
    `;

    card.addEventListener("click", () => {
      state.selectedFolderId = folder.id;
      const inFolder = (folder.sessions || []).some((session) => session.id === state.selectedSessionId);
      if (!inFolder) {
        state.selectedSessionId = (folder.sessions || [])[0]?.id || null;
        void renderDetail();
      }
      renderFolders();
      renderSessions();
      renderControls();
      renderFolderContext();
    });
    card.addEventListener("dragover", (event) => {
      event.preventDefault();
      card.classList.add("drop-target");
    });
    card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
    card.addEventListener("drop", async (event) => {
      event.preventDefault();
      card.classList.remove("drop-target");
      const sessionId = event.dataTransfer.getData("text/session-id");
      if (!sessionId) {
        return;
      }
      try {
        await window.clipscribe.moveSession(sessionId, folder.id);
        await queueFullRefresh();
        showToast("Session moved.");
      } catch (error) {
        showToast(friendlyError(error), true);
      }
    });
    fragment.appendChild(card);
  }
  els.folderList.appendChild(fragment);
}

function renderSessions() {
  const folder = findFolder(state.selectedFolderId);
  const allInFolder = getSelectedSessions();
  const sessions = filterSessions(allInFolder);
  if (folder) {
    els.sessionsHeading.textContent = `Sessions - ${folder.name} (${sessions.length}/${allInFolder.length})`;
  } else {
    els.sessionsHeading.textContent = "Sessions";
  }
  els.sessionsList.innerHTML = "";

  if (sessions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted empty-state";
    empty.textContent =
      allInFolder.length === 0
        ? "No sessions in this folder yet."
        : "No sessions match this search/filter.";
    els.sessionsList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const session of sessions) {
    const statusClass = session.status === "recording" || session.status === "paused"
      ? session.status
      : "stopped";
    const card = document.createElement("button");
    card.type = "button";
    card.className = `session-card ${statusClass}${session.id === state.selectedSessionId ? " active" : ""}`;
    card.draggable = true;
    card.dataset.sessionId = session.id;
    card.innerHTML = `
      <span class="session-top">
        <span class="session-title">${safeText(session.title)}</span>
        <span class="status-pill">${safeText(session.status)}</span>
      </span>
      <span class="session-meta-row">
        <span class="session-meta session-date">${dateFormatter.format(new Date(session.started_at))}</span>
        <span class="session-meta-dot">•</span>
        <span class="session-meta session-duration">Duration ${formatSeconds(getDisplayRecordedSeconds(session))}</span>
      </span>
      <span class="session-meta session-preview">${safeText(buildSessionSummaryPreview(session))}</span>
    `;
    card.addEventListener("click", async () => {
      state.selectedSessionId = session.id;
      renderSessions();
      renderControls();
      await renderDetail();
    });
    card.addEventListener("dblclick", async () => {
      state.selectedSessionId = session.id;
      state.captureSubView = "transcript";
      setCaptureSubView(state.captureSubView);
      renderSessions();
      renderControls();
      await renderDetail();
    });
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/session-id", session.id);
      event.dataTransfer.effectAllowed = "move";
    });
    fragment.appendChild(card);
  }
  els.sessionsList.appendChild(fragment);
}

function getCheckedSources() {
  const checks = [...document.querySelectorAll('input[name="source-check"]:checked')];
  const ids = checks.map((item) => item.value);
  return state.sources.filter((source) => ids.includes(source.id));
}

function getCheckedSourcesByName(name) {
  const checks = [...document.querySelectorAll(`input[name="${name}"]:checked`)];
  const ids = checks.map((item) => item.value);
  return state.sources.filter((source) => ids.includes(source.id));
}

function sourceGroupsFrom(sourceList) {
  const groups = [
    {
      key: "system-output",
      title: "System Output",
      rows: sourceList.filter((source) => source.format === "wasapi-loopback-device")
    },
    {
      key: "app-loopback",
      title: "App Loopback",
      rows: sourceList.filter((source) => source.format === "loopback-process")
    },
    {
      key: "system-inputs",
      title: "System Inputs",
      rows: sourceList.filter(
        (source) =>
          source.kind === "system" &&
          source.format !== "wasapi-loopback-device" &&
          source.format !== "loopback-process"
      )
    },
    {
      key: "microphones",
      title: "Microphones",
      rows: sourceList.filter((source) => source.kind !== "system")
    }
  ];
  return groups.filter((group) => group.rows.length > 0);
}

function isExclusiveLoopbackSource(source) {
  return source?.format === "loopback-process" || source?.format === "wasapi-loopback-device";
}

function applyExclusiveSelection(inputName, changedInput, changedSource) {
  if (!changedInput.checked) {
    return;
  }
  const all = [...document.querySelectorAll(`input[name="${inputName}"]`)];
  if (isExclusiveLoopbackSource(changedSource)) {
    for (const input of all) {
      if (input !== changedInput) {
        input.checked = false;
      }
    }
    showToast("Loopback sources currently record one source at a time.");
    return;
  }

  for (const input of all) {
    if (input === changedInput || !input.checked) {
      continue;
    }
    const source = findSource(input.value);
    if (isExclusiveLoopbackSource(source)) {
      input.checked = false;
    }
  }
}

function syncRowSelectionClasses(inputName) {
  const checks = [...document.querySelectorAll(`input[name="${inputName}"]`)];
  for (const input of checks) {
    const row = input.closest(".source-row");
    if (row) {
      row.classList.toggle("selected", input.checked);
    }
  }
}

function renderSourceRows({
  container,
  inputName,
  checkedIds,
  showTestButtons,
  onSelectionChanged,
  sourceFilterKey = "all",
  sourceRows = state.sources,
  testSessionId = null
}) {
  container.innerHTML = "";
  if (!sourceRows.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No audio sources detected. Check Setup Health.";
    container.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  let groups = sourceGroupsFrom(sourceRows);
  if (sourceFilterKey !== "all") {
    groups = groups.filter((group) => group.key === sourceFilterKey);
  }
  if (groups.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No sources in this category.";
    container.appendChild(empty);
    return;
  }
  for (const group of groups) {
    const groupEl = document.createElement("section");
    groupEl.className = "source-group";
    const title = document.createElement("h4");
    title.className = "source-group-title";
    title.textContent = group.title;
    groupEl.appendChild(title);

    for (const source of group.rows) {
      const row = document.createElement("div");
      const checked = checkedIds.has(source.id);
      row.className = `source-row${checked ? " selected" : ""}`;
      row.innerHTML = `
        <div class="source-meta">
          <label class="source-select-label">
            <span class="source-select-line">
              <input type="checkbox" name="${safeText(inputName)}" value="${safeText(source.id)}" ${checked ? "checked" : ""} />
              <span class="source-label-text">${safeText(source.label)}</span>
            </span>
          </label>
          <span class="muted source-meta-line">${safeText(source.kind)} | ${safeText(source.format)}${source.process_id ? ` | PID ${safeText(source.process_id)}` : ""}</span>
        </div>
        <div class="source-actions">
          ${showTestButtons ? `<button data-test-source="${safeText(source.id)}">Test</button>` : ""}
        </div>
      `;
      const sourceCheckbox = row.querySelector(`input[name="${inputName}"]`);
      sourceCheckbox.addEventListener("change", () => {
        applyExclusiveSelection(inputName, sourceCheckbox, source);
        if (typeof onSelectionChanged === "function") {
          onSelectionChanged();
          return;
        }
        syncRowSelectionClasses(inputName);
      });

      if (showTestButtons) {
        const testBtn = row.querySelector("button[data-test-source]");
        testBtn.addEventListener("click", async () => {
          await runSourceTest(source, testSessionId);
        });
      }
      groupEl.appendChild(row);
    }
    fragment.appendChild(groupEl);
  }
  container.appendChild(fragment);
}

function renderSelectedSourcesSummary() {
  const checked = getCheckedSourcesByName("source-check");
  els.selectedSourcesSummary.innerHTML = "";
  if (checked.length === 0) {
    els.selectedSourcesSummary.innerHTML = '<span class="muted">No source selected.</span>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const source of checked) {
    const chip = document.createElement("span");
    chip.className = "selected-chip";
    chip.textContent = source.label;
    fragment.appendChild(chip);
  }
  els.selectedSourcesSummary.appendChild(fragment);
}

function renderSourceFilterPills() {
  if (!els.sourceFilterPills) {
    return;
  }
  const buttons = [...els.sourceFilterPills.querySelectorAll("button[data-source-filter]")];
  for (const button of buttons) {
    button.classList.toggle("active", button.dataset.sourceFilter === state.sourceFilter);
  }
}

function renderCaptureSources() {
  const active = getActiveSession();
  const checkedIds = new Set(
    (active?.selected_sources || state.settings?.default_sources || []).map((source) => source.id)
  );
  const needle = state.sourceSearch.trim().toLowerCase();
  const filteredSources = needle
    ? state.sources.filter((source) => {
      const text = `${source.label || ""} ${source.kind || ""} ${source.format || ""}`.toLowerCase();
      return text.includes(needle);
    })
    : state.sources;

  renderSourceFilterPills();
  if (needle && filteredSources.length === 0) {
    els.sourceList.innerHTML = '<div class="muted">No sources match this search.</div>';
    renderSelectedSourcesSummary();
    renderControls();
    return;
  }
  renderSourceRows({
    container: els.sourceList,
    inputName: "source-check",
    checkedIds,
    showTestButtons: true,
    onSelectionChanged: () => {
      renderSelectedSourcesSummary();
      renderControls();
    },
    sourceFilterKey: state.sourceFilter,
    sourceRows: filteredSources,
    testSessionId: active?.id || null
  });
  renderSelectedSourcesSummary();
  renderControls();
}

function renderDefaultSourceList() {
  const checkedIds = new Set((state.settings?.default_sources || []).map((source) => source.id));
  const needle = state.defaultSourceSearch.trim().toLowerCase();
  const filteredSources = needle
    ? state.sources.filter((source) => {
      const text = `${source.label || ""} ${source.kind || ""} ${source.format || ""}`.toLowerCase();
      return text.includes(needle);
    })
    : state.sources;

  if (needle && filteredSources.length === 0) {
    els.defaultSourceList.innerHTML = '<div class="muted">No default sources match this search.</div>';
    return;
  }

  renderSourceRows({
    container: els.defaultSourceList,
    inputName: "default-source-check",
    checkedIds,
    showTestButtons: true,
    sourceRows: filteredSources,
    testSessionId: null
  });
}

function captureScrollState(container) {
  if (!container) {
    return { top: 0, nearBottom: true };
  }
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const top = Math.max(0, Math.min(container.scrollTop, maxTop));
  const distanceFromBottom = maxTop - top;
  return {
    top,
    nearBottom: distanceFromBottom <= 20
  };
}

function restoreScrollState(container, snapshot, stickToBottom = false) {
  if (!container || !snapshot) {
    return;
  }
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
  if (stickToBottom && snapshot.nearBottom) {
    container.scrollTop = maxTop;
    return;
  }
  container.scrollTop = Math.max(0, Math.min(snapshot.top, maxTop));
}

function getChunkStatusClass(status) {
  const value = String(status || "").toLowerCase();
  if (value === "done") {
    return "done";
  }
  if (value === "processing") {
    return "processing";
  }
  if (value === "failed") {
    return "failed";
  }
  return "queued";
}

function buildChunkMetaSummary(chunk, text) {
  const meta = chunk?.meta || {};
  const durationSec = Math.max(0, Number(chunk?.end_sec || 0) - Number(chunk?.start_sec || 0));
  const wordCount = Number.isFinite(Number(meta.word_count))
    ? Number(meta.word_count)
    : countWords(text);
  const confidenceText = formatPercent(meta.confidence);
  const items = [`${formatShortClock(durationSec)} chunk`, `${wordCount} words`];
  if (confidenceText) {
    items.push(`${confidenceText} confidence`);
  }
  return items;
}

function calculateSessionEstimate(chunks) {
  const doneChunks = (chunks || []).filter((chunk) => String(chunk?.status || "") === "done");
  let totalSeconds = 0;
  let totalWords = 0;
  let confidenceWeighted = 0;
  let confidenceWeight = 0;

  for (const chunk of doneChunks) {
    const startSec = Number(chunk?.start_sec || 0);
    const endSec = Number(chunk?.end_sec || 0);
    const durationSec = Math.max(0, endSec - startSec);
    totalSeconds += durationSec;

    const meta = chunk?.meta || {};
    const chunkText = String(chunk?.text || "");
    const words = Number.isFinite(Number(meta.word_count))
      ? Number(meta.word_count)
      : countWords(chunkText);
    totalWords += words;

    const conf = Number(meta.confidence);
    if (Number.isFinite(conf) && conf > 0) {
      const weight = words > 0 ? words : Math.max(durationSec, 1);
      confidenceWeighted += conf * weight;
      confidenceWeight += weight;
    }
  }

  return {
    transcribed_minutes: totalSeconds / 60,
    total_words: totalWords,
    avg_confidence: confidenceWeight > 0 ? confidenceWeighted / confidenceWeight : null
  };
}

function renderDetailEstimate(chunks) {
  if (!els.detailEstimate) {
    return;
  }
  const estimate = calculateSessionEstimate(chunks || []);
  const confidenceLabel = estimate.avg_confidence
    ? formatPercent(estimate.avg_confidence)
    : "--";
  els.detailEstimate.innerHTML = `
    <div class="estimate-pill">
      <span>Transcribed</span>
      <strong>${estimate.transcribed_minutes.toFixed(2)} min</strong>
    </div>
    <div class="estimate-pill">
      <span>Total Words</span>
      <strong>${Number(estimate.total_words || 0).toLocaleString()}</strong>
    </div>
    <div class="estimate-pill">
      <span>Avg Confidence</span>
      <strong>${safeText(confidenceLabel)}</strong>
    </div>
  `;
}

function getSummaryProgressForSession(sessionId) {
  const progress = state.summaryProgress;
  if (!progress || !sessionId || progress.sessionId !== sessionId) {
    return null;
  }
  return progress;
}

function formatSummaryProgressText(progress) {
  if (!progress) {
    return "";
  }
  const percent = Math.max(0, Math.min(100, Math.round(Number(progress.percent || 0))));
  const message = String(progress.message || "").trim();
  return message ? `${message} ${percent}/100` : `Regenerating ${percent}/100`;
}

function formatSummaryProgressButtonText(progress) {
  const percent = Math.max(0, Math.min(100, Math.round(Number(progress?.percent || 0))));
  return `Regenerating ${percent}/100`;
}

function renderDetailSummary(session) {
  if (!els.detailSummaryPanel || !els.detailSummaryMeta || !els.detailSummaryText) {
    return;
  }
  if (!session) {
    els.detailSummaryPanel.classList.remove("hidden");
    els.detailSummaryMeta.textContent = "";
    els.detailSummaryText.innerHTML =
      '<p class="summary-empty">Select a session to view summary.</p>';
    if (els.detailGenerateSummaryBtn) {
      els.detailGenerateSummaryBtn.disabled = true;
    }
    if (els.detailCopySummaryBtn) {
      els.detailCopySummaryBtn.disabled = true;
    }
    return;
  }

  const stopped = session.status === "stopped";
  const summary = String(session.summary_text || "").trim();
  const displaySummary = unwrapMarkdownCodeFence(summary);
  const model = String(session.summary_model || "").trim();
  const hasSummaryApiKey = Boolean(String(state.settings?.openrouter_api_key || "").trim());
  const summaryProgress = getSummaryProgressForSession(session.id);
  const progressRunning = summaryProgress && summaryProgress.status === "running";
  const progressError = summaryProgress && summaryProgress.status === "error";
  const generatedAt = session.summary_generated_at
    ? dateFormatter.format(new Date(session.summary_generated_at))
    : "";

  els.detailSummaryPanel.classList.remove("hidden");
  if (els.detailGenerateSummaryBtn) {
    const showBusy = state.summaryGenerating || progressRunning;
    els.detailGenerateSummaryBtn.disabled = !stopped || showBusy || !hasSummaryApiKey;
    els.detailGenerateSummaryBtn.textContent = showBusy
      ? formatSummaryProgressButtonText(summaryProgress)
      : "Regenerate";
  }
  if (els.detailCopySummaryBtn) {
    els.detailCopySummaryBtn.disabled = !summary;
  }

  if (!stopped) {
    els.detailSummaryMeta.textContent = "Summary is available after the session is stopped.";
    els.detailSummaryText.innerHTML =
      '<p class="summary-empty">Stop the session to generate an AI summary.</p>';
    return;
  }

  if (displaySummary) {
    const parts = [];
    if (progressRunning) {
      parts.push(formatSummaryProgressText(summaryProgress));
    }
    if (model) {
      parts.push(`Model: ${model}`);
    }
    if (generatedAt) {
      parts.push(`Generated: ${generatedAt}`);
    }
    els.detailSummaryMeta.textContent = parts.join(" | ");
    els.detailSummaryText.innerHTML = markdownToSafeHtml(displaySummary);
    return;
  }

  if (progressRunning) {
    els.detailSummaryMeta.textContent = formatSummaryProgressText(summaryProgress);
  } else if (progressError) {
    els.detailSummaryMeta.textContent = `Last summary attempt failed: ${summaryProgress.message || "Unknown error."}`;
  } else {
    els.detailSummaryMeta.textContent = hasSummaryApiKey
      ? "Summary not available yet."
      : "OpenRouter API key missing.";
  }
  els.detailSummaryText.innerHTML = hasSummaryApiKey
    ? '<p class="summary-empty">Summary is generated automatically after stop.</p>'
    : '<p class="summary-empty">Set OpenRouter API key in Settings to enable automatic summaries.</p>';
}

async function saveSpeakerAlias(sessionId, speakerId, aliasInput, triggerButton, options = {}) {
  const alias = String(aliasInput || "").trim();
  const previousAlias = String(options.previousAlias || "").trim();
  if (alias === previousAlias) {
    return { skipped: true };
  }
  const button = triggerButton || null;
  const buttonText = button ? button.textContent : "";
  if (button) {
    button.disabled = true;
    button.textContent = "Saving...";
  }
  try {
    await window.clipscribe.setSessionSpeakerAlias(sessionId, speakerId, alias);
    await renderDetail();
    showToast(alias ? `Speaker ${speakerId} renamed to "${alias}".` : `Speaker ${speakerId} reset.`);
    return { skipped: false };
  } catch (error) {
    showToast(friendlyError(error), true);
    return { skipped: false, error };
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = buttonText;
    }
  }
}

async function resetAllSpeakerAliases(sessionId, aliasMap, triggerButton) {
  const resetIds = Object.keys(aliasMap || {})
    .map((key) => Number.parseInt(key, 10))
    .filter((id) => Number.isInteger(id) && id >= 0);
  if (resetIds.length === 0) {
    showToast("No speaker aliases to reset.");
    return;
  }
  const button = triggerButton || null;
  const previousText = button ? button.textContent : "";
  if (button) {
    button.disabled = true;
    button.textContent = "Resetting...";
  }
  try {
    for (const speakerId of resetIds) {
      await window.clipscribe.setSessionSpeakerAlias(sessionId, speakerId, "");
    }
    await renderDetail();
    showToast("All speaker aliases reset.");
  } catch (error) {
    showToast(friendlyError(error), true);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previousText;
    }
  }
}

function renderSpeakerAliasPanel(sessionId, speakerIds, aliasMap) {
  if (!els.detailSpeakers) {
    return;
  }
  const ids = [...new Set([...(speakerIds || []), ...Object.keys(aliasMap || {}).map((key) => Number(key))])]
    .filter((id) => Number.isInteger(id) && id >= 0)
    .sort((a, b) => a - b);
  const hasAnyAlias = ids.some((id) => String(aliasMap?.[id] || "").trim());
  if (ids.length === 0) {
    els.detailSpeakers.classList.add("hidden");
    els.detailSpeakers.innerHTML = "";
    return;
  }

  const rows = ids
    .map((speakerId) => {
      const alias = String(aliasMap?.[speakerId] || "");
      return `
        <div class="speaker-alias-row">
          <span class="speaker-alias-label">Speaker ${speakerId}</span>
          <input
            class="speaker-alias-input"
            type="text"
            data-speaker-alias-input="${speakerId}"
            value="${safeText(alias)}"
            placeholder="Name (optional)"
          />
          <button class="speaker-alias-save" type="button" data-speaker-alias-save="${speakerId}">
            ${alias ? "Update" : "Set"}
          </button>
        </div>
      `;
    })
    .join("");

  els.detailSpeakers.classList.remove("hidden");
  els.detailSpeakers.innerHTML = `
    <div class="speaker-alias-head">
      <p class="speaker-alias-title">Speaker Names (Session)</p>
      ${
        hasAnyAlias
          ? '<button id="reset-speaker-aliases-btn" class="speaker-alias-reset" type="button">Reset All</button>'
          : ""
      }
    </div>
    <p class="speaker-alias-note muted">Update applies changes for this session transcript.</p>
    <div class="speaker-alias-list">${rows}</div>
  `;
  const resetButton = els.detailSpeakers.querySelector("#reset-speaker-aliases-btn");
  if (resetButton) {
    resetButton.addEventListener("click", () => {
      void resetAllSpeakerAliases(sessionId, aliasMap, resetButton);
    });
  }

  const saveButtons = els.detailSpeakers.querySelectorAll("[data-speaker-alias-save]");
  for (const button of saveButtons) {
    const speakerId = Number.parseInt(button.dataset.speakerAliasSave, 10);
    const input = els.detailSpeakers.querySelector(
      `input[data-speaker-alias-input="${speakerId}"]`
    );
    if (!input || !Number.isInteger(speakerId)) {
      continue;
    }
    input.dataset.lastSavedAlias = String(aliasMap?.[speakerId] || "").trim();
    button.addEventListener("click", () => {
      void saveSpeakerAlias(sessionId, speakerId, input.value, button, {
        previousAlias: input.dataset.lastSavedAlias
      });
      input.dataset.lastSavedAlias = String(input.value || "").trim();
      if (String(input.dataset.lastSavedAlias || "").trim()) {
        button.textContent = "Update";
      } else {
        button.textContent = "Set";
      }
    });
    input.addEventListener("input", () => {
      const current = String(input.value || "").trim();
      button.textContent = current ? "Update" : "Set";
    });
  }
}

function normalizeTimelineEvents(events) {
  const rows = Array.isArray(events) ? events.slice() : [];
  const normalized = [];
  for (const event of rows) {
    const type = String(event?.event_type || "");
    if (type === "speaker_alias") {
      const speakerId = Number.parseInt(String(event?.payload?.speaker_id), 10);
      const atSec = Number(event?.at_sec || 0);
      const prev = normalized[normalized.length - 1];
      const prevType = String(prev?.event_type || "");
      const prevSpeakerId = Number.parseInt(String(prev?.payload?.speaker_id), 10);
      const prevAtSec = Number(prev?.at_sec || 0);
      if (
        prev &&
        prevType === "speaker_alias" &&
        Number.isInteger(speakerId) &&
        speakerId >= 0 &&
        speakerId === prevSpeakerId &&
        Math.abs(atSec - prevAtSec) < 1
      ) {
        normalized[normalized.length - 1] = event;
        continue;
      }
    }
    normalized.push(event);
  }
  return normalized;
}

function describeTimelineEvent(event) {
  const type = String(event?.event_type || "");
  if (type === "warning" && event?.payload?.message) {
    return {
      tag: "warning",
      tagClass: "warning",
      message: String(event.payload.message || "").trim() || "Warning"
    };
  }
  if (type === "speaker_alias") {
    const speakerId = Number.parseInt(String(event?.payload?.speaker_id), 10);
    const alias = String(event?.payload?.alias || "").trim();
    if (Number.isInteger(speakerId) && speakerId >= 0) {
      return {
        tag: "speaker",
        tagClass: "speaker",
        message: alias
          ? `Speaker ${speakerId} renamed to "${alias}".`
          : `Speaker ${speakerId} name reset.`
      };
    }
    return {
      tag: "speaker",
      tagClass: "speaker",
      message: "Speaker alias updated."
    };
  }
  if (type === "pause") {
    return { tag: "capture", tagClass: "capture", message: "Recording paused." };
  }
  if (type === "resume") {
    return { tag: "capture", tagClass: "capture", message: "Recording resumed." };
  }
  if (type === "stop") {
    return { tag: "capture", tagClass: "capture", message: "Recording stopped." };
  }
  if (type === "interrupted") {
    return {
      tag: "capture",
      tagClass: "capture",
      message: "Session interrupted by app restart."
    };
  }
  if (type === "source_change") {
    const count = Array.isArray(event?.payload?.selected_sources)
      ? event.payload.selected_sources.length
      : 0;
    return {
      tag: "capture",
      tagClass: "capture",
      message: count > 0 ? `Source set updated (${count} selected).` : "Source set updated."
    };
  }
  if (type === "summary_generated") {
    const model = String(event?.payload?.model || "").trim();
    return {
      tag: "event",
      tagClass: "",
      message: model ? `Summary generated (${model}).` : "Summary generated."
    };
  }
  return {
    tag: "event",
    tagClass: "",
    message: type || "event"
  };
}

function renderTimelineCountBadge(count) {
  if (!els.detailTabTimelineCount) {
    return;
  }
  const safeCount = Math.max(0, Number.parseInt(String(count || 0), 10) || 0);
  if (safeCount <= 0) {
    els.detailTabTimelineCount.classList.add("hidden");
    els.detailTabTimelineCount.textContent = "0";
    return;
  }
  els.detailTabTimelineCount.classList.remove("hidden");
  els.detailTabTimelineCount.textContent = String(safeCount);
}

async function renderDetail() {
  const eventScroll = captureScrollState(els.detailEvents);
  const chunkScroll = captureScrollState(els.detailChunks);
  els.detailChunks.innerHTML = "";
  els.detailEvents.innerHTML = "";
  els.detailMeta.textContent = "";
  renderDetailSummary(null);
  if (els.detailSpeakers) {
    els.detailSpeakers.innerHTML = "";
    els.detailSpeakers.classList.add("hidden");
  }
  if (els.detailEstimate) {
    els.detailEstimate.innerHTML = "";
  }
  if (!state.selectedSessionId) {
    renderTimelineCountBadge(0);
    const timelineEmpty = document.createElement("div");
    timelineEmpty.className = "muted";
    timelineEmpty.textContent = "Select a session to view timeline events.";
    els.detailEvents.appendChild(timelineEmpty);
    const transcriptEmpty = document.createElement("div");
    transcriptEmpty.className = "muted";
    transcriptEmpty.textContent = "Select a session to view transcript chunks.";
    els.detailChunks.appendChild(transcriptEmpty);
    return;
  }

  let detail;
  try {
    detail = await window.clipscribe.getSessionDetail(state.selectedSessionId);
  } catch (error) {
    showToast(friendlyError(error), true);
    return;
  }
  const session = detail.session;
  renderDetailSummary(session);
  const speakerAliasMap = buildSpeakerAliasMap(detail.events || []);
  const speakerIds = getSpeakerIdsFromChunks(detail.chunks || []);
  renderSpeakerAliasPanel(session.id, speakerIds, speakerAliasMap);
  els.detailMeta.textContent = `${session.status} | ${formatSeconds(getDisplayRecordedSeconds(session))}`;
  renderDetailEstimate(detail.chunks || []);

  const timelineEvents = normalizeTimelineEvents(detail.events || []);
  renderTimelineCountBadge(timelineEvents.length);

  if (timelineEvents.length === 0) {
    const emptyEvent = document.createElement("div");
    emptyEvent.className = "muted";
    emptyEvent.textContent = "No timeline events yet.";
    els.detailEvents.appendChild(emptyEvent);
  } else {
    for (const event of timelineEvents) {
      const row = document.createElement("div");
      row.className = "event-row";
      const summary = describeTimelineEvent(event);
      row.innerHTML = `
        <div class="event-row-head">
          <span class="event-time">[${safeText(formatSeconds(event.at_sec))}]</span>
          <span class="event-tag ${safeText(summary.tagClass)}">${safeText(summary.tag)}</span>
        </div>
        <p class="event-message">${safeText(summary.message)}</p>
      `;
      els.detailEvents.appendChild(row);
    }
  }

  if ((detail.chunks || []).length === 0) {
    const emptyChunk = document.createElement("div");
    emptyChunk.className = "muted";
    emptyChunk.textContent = "No transcript chunks yet.";
    els.detailChunks.appendChild(emptyChunk);
    restoreScrollState(els.detailEvents, eventScroll, false);
    restoreScrollState(els.detailChunks, chunkScroll, true);
    return;
  }

  for (const chunk of detail.chunks || []) {
    const row = document.createElement("div");
    row.className = "chunk-row";
    const rawText = String(chunk.text || "");
    const aliasedText = applySpeakerAliasesToText(rawText, speakerAliasMap);
    let text = aliasedText;
    if (!text && chunk.status === "processing") {
      text = "(processing...)";
    } else if (!text && chunk.status === "done") {
      text = "(No speech detected in this chunk.)";
    }
    const chunkMetaItems = buildChunkMetaSummary(chunk, rawText)
      .map((item) => `<span class="chunk-badge">${safeText(item)}</span>`)
      .join("");
    const statusClass = getChunkStatusClass(chunk.status);
    row.innerHTML = `
      <div class="chunk-top">
        <div class="chunk-head">
          <span class="chunk-index">Chunk ${chunk.chunk_index}</span>
          <span class="chunk-range">${formatSeconds(chunk.start_sec)} - ${formatSeconds(chunk.end_sec)}</span>
        </div>
        <div class="chunk-actions">
          ${chunkMetaItems}
          <span class="chunk-status ${safeText(statusClass)}">${safeText(chunk.status)}</span>
          <button data-copy-chunk="${safeText(chunk.id)}">Copy</button>
        </div>
      </div>
      <div class="chunk-text">${buildChunkTextMarkup(text)}</div>
    `;
    const copyBtn = row.querySelector("button[data-copy-chunk]");
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(aliasedText || "");
      showToast("Chunk copied.");
    });
    els.detailChunks.appendChild(row);
  }
  restoreScrollState(els.detailEvents, eventScroll, false);
  restoreScrollState(els.detailChunks, chunkScroll, true);
}

function setFlowStepState(stepElement, stateClass) {
  if (!stepElement) {
    return;
  }
  stepElement.classList.remove("active", "complete", "pending");
  stepElement.classList.add(stateClass);
}

function renderSetupFlow() {
  const active = getActiveSession();
  const folder = findFolder(state.selectedFolderId);
  const hasFolder = Boolean(folder);
  const hasTitle = Boolean(String(els.sessionTitle?.value || "").trim());
  const selectedSources = getCheckedSourcesByName("source-check");
  const hasSources = selectedSources.length > 0;

  setFlowStepState(els.flowStepSession, hasFolder ? "complete" : "active");
  setFlowStepState(els.flowStepSources, hasSources ? "complete" : hasFolder ? "active" : "pending");
  setFlowStepState(els.flowStepRecording, active ? "active" : hasSources ? "active" : "pending");

  if (!els.setupActionHint) {
    return;
  }
  if (!hasFolder) {
    els.setupActionHint.textContent = "Select a folder on the left to store this session.";
    return;
  }
  if (!hasSources) {
    els.setupActionHint.textContent = "Pick at least one source to enable Start.";
    return;
  }
  if (active) {
    els.setupActionHint.textContent = "Recording is active. Apply Source Changes updates sources without stopping.";
    return;
  }
  if (!hasTitle) {
    els.setupActionHint.textContent = "Ready to start. Add a session title (optional) to keep your list organized.";
    return;
  }
  els.setupActionHint.textContent = "Ready. Click Start & Open Transcript to begin capture.";
}

function renderControls() {
  const active = getActiveSession();
  const selected = state.selectedSessionId ? findSession(state.selectedSessionId) : null;
  const selectedActive = Boolean(
    selected && (selected.status === "recording" || selected.status === "paused")
  );
  const selectedStopped = Boolean(selected && selected.status === "stopped");
  const selectedSummaryProgress = selected ? getSummaryProgressForSession(selected.id) : null;
  const summaryBusy = Boolean(
    state.summaryGenerating ||
    (selectedSummaryProgress && selectedSummaryProgress.status === "running")
  );
  const folder = findFolder(state.selectedFolderId);
  const setupSelectedSources = getCheckedSourcesByName("source-check");
  const canTestOneSource = setupSelectedSources.length === 1;
  els.recordBtn.disabled = Boolean(active);
  els.pauseBtn.disabled = !active || active.status !== "recording";
  els.resumeBtn.disabled = !active || active.status !== "paused";
  els.stopBtn.disabled = !active;
  els.startFromSetupBtn.disabled = Boolean(active) || !folder || setupSelectedSources.length === 0;
  els.testSelectedSourceBtn.disabled = !canTestOneSource;
  els.playLastTestBtn.disabled = !state.lastTestClip?.path;
  els.applySourcesBtn.disabled = !active;
  els.copyAllBtn.disabled = !selected;
  els.openTranscriptBtn.disabled = !selected;
  if (els.generateSummaryBtn) {
    els.generateSummaryBtn.disabled = !selectedStopped || summaryBusy;
    els.generateSummaryBtn.textContent = summaryBusy
      ? formatSummaryProgressButtonText(selectedSummaryProgress)
      : "Regenerate";
  }
  els.renameSessionBtn.disabled = !selected;
  els.deleteSessionBtn.disabled = !selected || selectedActive;
  els.deleteFolderBtn.disabled = !folder || (folder.sessions || []).length > 0;
  renderSetupFlow();
}

function renderLiveDurationTick() {
  const selected = state.selectedSessionId ? findSession(state.selectedSessionId) : null;
  if (selected) {
    els.detailMeta.textContent = `${selected.status} | ${formatSeconds(getDisplayRecordedSeconds(selected))}`;
  }
  renderStatus();
}

function mergeUniqueModels(models) {
  const incoming = Array.isArray(models) ? models : [];
  const seed = incoming.length > 0 ? incoming : FREE_OPENROUTER_MODELS;
  const unique = [];
  for (const raw of seed) {
    const value = String(raw || "").trim();
    if (!value || unique.includes(value)) {
      continue;
    }
    unique.push(value);
  }
  return unique;
}

function mergeUniqueDeepgramModels(models) {
  const seed = [...DEFAULT_DEEPGRAM_MODELS, ...(models || [])];
  const unique = [];
  for (const raw of seed) {
    const value = String(raw || "").trim();
    if (!value || unique.includes(value)) {
      continue;
    }
    unique.push(value);
  }
  return unique;
}

function getSuggestedDeepgramRate(model) {
  const value = String(model || "").toLowerCase().trim();
  if (!value) {
    return 0.0043;
  }
  if (value.includes("nova-3")) {
    return 0.0043;
  }
  if (value.includes("nova-2")) {
    return 0.0043;
  }
  if (value.includes("enhanced")) {
    return 0.0145;
  }
  if (value.includes("base")) {
    return 0.0125;
  }
  if (value.includes("whisper")) {
    return 0.0048;
  }
  return 0.0043;
}

function ensureDeepgramModelOptions(configuredModel = "") {
  if (!els.deepgramModel) {
    return;
  }
  const knownModels = mergeUniqueDeepgramModels(state.deepgramModels);
  const current = String(els.deepgramModel.value || "").trim();
  const preferred = String(configuredModel || "").trim() || current || "nova-3";
  els.deepgramModel.innerHTML = "";
  for (const modelId of knownModels) {
    const option = document.createElement("option");
    option.value = modelId;
    option.textContent = modelId;
    els.deepgramModel.appendChild(option);
  }
  if (!knownModels.includes(preferred)) {
    const option = document.createElement("option");
    option.value = preferred;
    option.textContent = `${preferred} (Saved)`;
    els.deepgramModel.appendChild(option);
  }
  els.deepgramModel.value = preferred;
}

function getAvailableOpenRouterModels() {
  return mergeUniqueModels(state.openRouterModels);
}

function refreshDeepgramModelsStatusLabel() {
  if (!els.deepgramModelsStatus) {
    return;
  }
  const status = String(state.deepgramModelsStatus || "").trim();
  if (status) {
    els.deepgramModelsStatus.textContent = status;
    return;
  }
  els.deepgramModelsStatus.textContent = "Sync available STT models from Deepgram.";
}

function renderEstimatedRateHint() {
  if (!els.estimatedSttHint || !els.deepgramModel) {
    return;
  }
  const model = String(els.deepgramModel.value || "nova-3").trim();
  const suggested = getSuggestedDeepgramRate(model);
  state.deepgramRateSuggestion = suggested;
  els.estimatedSttHint.textContent =
    `Suggested for ${model}: ${formatUsdPrecise(suggested)} / min (editable).`;
}

function refreshOpenRouterModelsStatusLabel() {
  if (!els.openRouterModelsStatus) {
    return;
  }
  const status = String(state.openRouterModelsStatus || "").trim();
  if (status) {
    els.openRouterModelsStatus.textContent = status;
    return;
  }
  els.openRouterModelsStatus.textContent =
    "Sync all currently free models from OpenRouter API.";
}

function ensureOpenRouterModelOptions(configuredModel = "") {
  if (!els.openrouterModel) {
    return;
  }
  const currentValue = String(els.openrouterModel.value || "").trim();
  const requested = String(configuredModel || "").trim();
  const knownModels = getAvailableOpenRouterModels();
  const preferred = requested || currentValue || DEFAULT_SUMMARY_MODEL;
  const nextValue = knownModels.includes(preferred) ? preferred : "__custom__";

  els.openrouterModel.innerHTML = "";
  for (const modelId of knownModels) {
    const option = document.createElement("option");
    option.value = modelId;
    option.textContent =
      modelId === DEFAULT_SUMMARY_MODEL
        ? `${modelId} (Recommended)`
        : modelId === "openrouter/free"
          ? `${modelId} (Router)`
          : modelId;
    els.openrouterModel.appendChild(option);
  }
  const customOption = document.createElement("option");
  customOption.value = "__custom__";
  customOption.textContent = "Custom model...";
  els.openrouterModel.appendChild(customOption);
  els.openrouterModel.value = nextValue;
}

function setOpenRouterModelControl(configuredModel) {
  if (!els.openrouterModel) {
    return;
  }
  ensureOpenRouterModelOptions(configuredModel);
  const normalized = String(configuredModel || "").trim();
  const effectiveModel = normalized || DEFAULT_SUMMARY_MODEL;
  const isKnown = getAvailableOpenRouterModels().includes(effectiveModel);
  els.openrouterModel.value = isKnown ? effectiveModel : "__custom__";
  if (!els.openrouterModelCustom) {
    return;
  }
  els.openrouterModelCustom.classList.toggle("hidden", isKnown);
  if (!isKnown) {
    els.openrouterModelCustom.value = effectiveModel;
  } else if (!els.openrouterModelCustom.matches(":focus")) {
    els.openrouterModelCustom.value = "";
  }
}

function getSelectedOpenRouterModel() {
  if (!els.openrouterModel) {
    return DEFAULT_SUMMARY_MODEL;
  }
  const selected = String(els.openrouterModel.value || "").trim();
  if (selected !== "__custom__") {
    return selected || DEFAULT_SUMMARY_MODEL;
  }
  const custom = String(els.openrouterModelCustom?.value || "").trim();
  return custom || DEFAULT_SUMMARY_MODEL;
}

function renderSettings() {
  const settings = state.settings || {};
  els.deepgramApiKey.value = settings.deepgram_api_key || "";
  els.deepgramProjectId.value = settings.deepgram_project_id || "";
  ensureDeepgramModelOptions(settings.deepgram_model || "nova-3");
  if (els.refreshDeepgramModelsBtn) {
    els.refreshDeepgramModelsBtn.disabled = state.deepgramModelsLoading;
    els.refreshDeepgramModelsBtn.textContent = state.deepgramModelsLoading
      ? "Syncing..."
      : "Sync Models";
  }
  refreshDeepgramModelsStatusLabel();
  renderEstimatedRateHint();
  els.openrouterApiKey.value = settings.openrouter_api_key || "";
  const configuredModel = String(settings.openrouter_model || "").trim();
  setOpenRouterModelControl(
    !configuredModel
      ? DEFAULT_SUMMARY_MODEL
      : configuredModel
  );
  if (els.refreshOpenRouterModelsBtn) {
    els.refreshOpenRouterModelsBtn.disabled = state.openRouterModelsLoading;
    els.refreshOpenRouterModelsBtn.textContent = state.openRouterModelsLoading
      ? "Syncing..."
      : "Sync Free Models";
  }
  refreshOpenRouterModelsStatusLabel();
  if (els.refreshOpenRouterUsageBtn) {
    els.refreshOpenRouterUsageBtn.disabled = state.openRouterUsageLoading;
    els.refreshOpenRouterUsageBtn.textContent = state.openRouterUsageLoading
      ? "Loading..."
      : "Refresh OpenRouter";
  }
  els.preprocessProfile.value = settings.transcription_preprocess_profile || "fast";
  els.preprocessTimeoutMs.value = String(settings.transcription_preprocess_timeout_ms || 5000);
  els.estimatedSttUsdPerMin.value = String(
    Number.isFinite(Number(settings.estimated_stt_usd_per_min))
      ? Number(settings.estimated_stt_usd_per_min)
      : 0.0043
  );
  renderOpenRouterUsage();
  els.chunkSeconds.value = String(settings.chunk_seconds || 120);
  els.chunkSecondsSettings.value = String(settings.chunk_seconds || 120);
  if (!els.usageStartDate.value || !els.usageEndDate.value) {
    const today = new Date();
    const sevenDaysAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
    els.usageStartDate.value = formatDateInputValue(sevenDaysAgo);
    els.usageEndDate.value = formatDateInputValue(today);
  }
  if (!els.usageGrouping.value) {
    els.usageGrouping.value = "";
  }
}

function renderUsageBreakdown() {
  if (!els.usageSummary || !els.usageList) {
    return;
  }
  if (state.usageError) {
    els.usageSummary.innerHTML = `<div class="muted">${safeText(state.usageError)}</div>`;
    els.usageList.innerHTML = "";
    return;
  }
  const usage = state.usageBreakdown;
  if (!usage) {
    els.usageSummary.innerHTML = '<div class="muted">Usage not loaded yet. Click "Refresh Deepgram".</div>';
    els.usageList.innerHTML = "";
    return;
  }
  const summary = usage.summary || {};
  const totalHours = Number(summary.total_hours || summary.hours || 0);
  const requests = Number(summary.requests || 0);
  const tokensIn = Number(summary.tokens_in || 0);
  const tokensOut = Number(summary.tokens_out || 0);
  const estimatedRate = Number(state.settings?.estimated_stt_usd_per_min || 0);
  const estimatedCost = totalHours * 60 * estimatedRate;
  els.usageSummary.innerHTML = `
    <div class="usage-pill"><span>Total Hours</span><strong>${totalHours.toFixed(2)}</strong></div>
    <div class="usage-pill"><span>Requests</span><strong>${requests.toLocaleString()}</strong></div>
    <div class="usage-pill"><span>Tokens In</span><strong>${tokensIn.toLocaleString()}</strong></div>
    <div class="usage-pill"><span>Tokens Out</span><strong>${tokensOut.toLocaleString()}</strong></div>
    <div class="usage-pill"><span>Estimated Cost</span><strong>${formatCurrency(estimatedCost)}</strong></div>
  `;

  const rows = Array.isArray(usage.results) ? usage.results : [];
  if (rows.length === 0) {
    els.usageList.innerHTML = '<div class="muted">No usage rows returned for this range.</div>';
    return;
  }
  const items = rows.slice(0, 50).map((row) => {
    const labels = [];
    const grouping = row?.grouping && typeof row.grouping === "object" ? row.grouping : {};
    if (grouping?.start && grouping?.end) {
      labels.push(`${grouping.start} -> ${grouping.end}`);
    }
    const groupingKeys = ["endpoint", "method", "accessor", "deployment"];
    for (const key of groupingKeys) {
      if (grouping?.[key]) {
        labels.push(`${key}:${grouping[key]}`);
      }
    }
    const listKeys = ["models", "tags", "feature_set"];
    for (const key of listKeys) {
      const values = Array.isArray(grouping?.[key]) ? grouping[key] : [];
      if (values.length > 0) {
        labels.push(`${key}:${values.join(",")}`);
      }
    }
    const label = labels.filter(Boolean).join(" | ") || "row";
    const rowHours = Number(row?.total_hours || row?.hours || 0);
    const rowRequests = Number(row?.requests || 0);
    const rowEstimatedCost = rowHours * 60 * estimatedRate;
    return `
      <div class="usage-row">
        <span class="usage-row-label">${safeText(label)}</span>
        <span class="usage-row-metric">${rowHours.toFixed(2)}h</span>
        <span class="usage-row-metric">${rowRequests.toLocaleString()} req</span>
        <span class="usage-row-metric">${formatCurrency(rowEstimatedCost)}</span>
      </div>
    `;
  });
  els.usageList.innerHTML = items.join("");
}

function renderOpenRouterUsage() {
  if (!els.openRouterUsageSummary || !els.openRouterUsageList) {
    return;
  }
  const hasKey = Boolean(String(state.settings?.openrouter_api_key || "").trim());
  if (!hasKey) {
    els.openRouterUsageSummary.innerHTML =
      '<div class="muted">Add OpenRouter API key to load usage.</div>';
    els.openRouterUsageList.innerHTML = "";
    return;
  }
  if (state.openRouterUsageLoading) {
    els.openRouterUsageSummary.innerHTML =
      '<div class="muted">Loading OpenRouter usage...</div>';
    return;
  }
  if (state.openRouterUsageError) {
    els.openRouterUsageSummary.innerHTML = `<div class="muted">${safeText(state.openRouterUsageError)}</div>`;
    els.openRouterUsageList.innerHTML = "";
    return;
  }
  const keyInfo = state.openRouterUsage;
  if (!keyInfo) {
    els.openRouterUsageSummary.innerHTML =
      '<div class="muted">Usage not loaded yet. Click "Refresh OpenRouter".</div>';
    els.openRouterUsageList.innerHTML = "";
    return;
  }

  const limit = Number(keyInfo.limit);
  const usage = Number(keyInfo.usage);
  const remaining = Number(keyInfo.limit_remaining);
  const limitText = Number.isFinite(limit) ? formatCurrency(limit) : "No limit";
  const usageText = Number.isFinite(usage) ? formatCurrency(usage) : "--";
  const remainingText = Number.isFinite(remaining) ? formatCurrency(remaining) : "--";
  const rateLimit = keyInfo.rate_limit || {};
  const requestsPerMin = Number(rateLimit.requests || 0);
  const intervalLabel = String(rateLimit.interval || "").trim();
  const updatedAt = keyInfo.fetched_at
    ? dateFormatter.format(new Date(keyInfo.fetched_at))
    : "";

  els.openRouterUsageSummary.innerHTML = `
    <div class="usage-pill"><span>Credit Limit</span><strong>${safeText(limitText)}</strong></div>
    <div class="usage-pill"><span>Used</span><strong>${safeText(usageText)}</strong></div>
    <div class="usage-pill"><span>Remaining</span><strong>${safeText(remainingText)}</strong></div>
    <div class="usage-pill"><span>Key Tier</span><strong>${keyInfo.is_free_tier ? "Free" : "Paid/Custom"}</strong></div>
  `;

  const rows = [];
  if (keyInfo.label) {
    rows.push({ label: "Key label", value: keyInfo.label });
  }
  if (requestsPerMin > 0) {
    rows.push({
      label: "Rate limit",
      value: `${requestsPerMin} requests / ${intervalLabel || "minute"}`
    });
  }
  if (updatedAt) {
    rows.push({ label: "Last refreshed", value: updatedAt });
  }
  rows.push({
    label: "Usage scope",
    value: "Summary generation requests via OpenRouter"
  });

  els.openRouterUsageList.innerHTML = rows
    .map(
      (row) => `
      <div class="usage-row openrouter-usage-row">
        <span class="usage-row-label">${safeText(row.label)}</span>
        <span class="usage-row-metric">${safeText(row.value)}</span>
      </div>
    `
    )
    .join("");
}

function renderSessionFilters() {
  els.sessionsSearch.value = state.sessionSearch;
  els.sessionsStatusFilter.value = state.sessionStatusFilter;
}

function renderSourceSearch() {
  els.sourceSearch.value = state.sourceSearch;
  els.defaultSourceSearch.value = state.defaultSourceSearch;
}

function renderAll() {
  setView(state.activeView);
  setCaptureSubView(state.captureSubView);
  setDetailSubView(state.detailSubView);
  setSettingsSubView(state.settingsSubView);
  setTranscriptionSubView(state.transcriptionSubView);
  renderWorkspaceHeader();
  renderStatus();
  renderHealth();
  renderFolders();
  renderFolderContext();
  renderSessionFilters();
  renderSourceSearch();
  renderSessions();
  renderCaptureSources();
  renderDefaultSourceList();
  renderSourceTestFeedback();
  renderUsageBreakdown();
  renderControls();
  renderSettings();
}

async function refreshGlobal() {
  if (refreshInFlight) {
    refreshQueued = true;
    return;
  }
  refreshInFlight = true;
  try {
    const boot = await window.clipscribe.bootstrap();
    state.settings = boot.settings;
    state.sources = boot.sources || [];
    state.folders = boot.folders || [];
    state.runtimeHealth = boot.runtime_health || null;

    if (!state.selectedFolderId && state.folders.length > 0) {
      state.selectedFolderId = state.folders[0].id;
    }
    if (state.selectedFolderId && !findFolder(state.selectedFolderId) && state.folders.length > 0) {
      state.selectedFolderId = state.folders[0].id;
    }
    if (state.selectedSessionId && !findSession(state.selectedSessionId)) {
      state.selectedSessionId = null;
    }
    if (!state.selectedSessionId && state.selectedFolderId) {
      const folder = findFolder(state.selectedFolderId);
      if ((folder?.sessions || []).length > 0) {
        state.selectedSessionId = folder.sessions[0].id;
      }
    }
    if (state.selectedFolderId && state.selectedSessionId) {
      const folder = findFolder(state.selectedFolderId);
      const inFolder = (folder?.sessions || []).some((session) => session.id === state.selectedSessionId);
      if (!inFolder) {
        state.selectedSessionId = (folder?.sessions || [])[0]?.id || null;
      }
    }

    renderAll();
    await renderDetail();
  } finally {
    refreshInFlight = false;
    if (refreshQueued) {
      refreshQueued = false;
      void refreshGlobal();
    }
  }
}

async function queueFullRefresh() {
  await refreshGlobal();
}

function replaceSessionInState(session) {
  if (!session) {
    return;
  }
  for (const folder of state.folders) {
    const index = (folder.sessions || []).findIndex((item) => item.id === session.id);
    if (index >= 0) {
      folder.sessions[index] = session;
      return;
    }
  }
}

function scheduleSessionRefresh(sessionId) {
  pendingSessionUpdateId = sessionId;
  if (sessionUpdateTimer) {
    return;
  }
  sessionUpdateTimer = setTimeout(async () => {
    sessionUpdateTimer = null;
    const targetId = pendingSessionUpdateId;
    pendingSessionUpdateId = null;
    if (!targetId) {
      return;
    }
    try {
      const latest = await window.clipscribe.getSession(targetId);
      if (latest) {
        replaceSessionInState(latest);
        renderStatus();
        renderSessions();
        renderControls();
      }
      if (state.selectedSessionId === targetId) {
        await renderDetail();
      }
    } catch (_) {
      // fall through to next refresh cycle
    }
  }, 450);
}

async function copyAllTranscript() {
  if (!state.selectedSessionId) {
    return;
  }
  const detail = await window.clipscribe.getSessionDetail(state.selectedSessionId);
  const speakerAliasMap = buildSpeakerAliasMap(detail.events || []);
  const chunksWithText = (detail.chunks || [])
    .filter((chunk) => chunk.text)
    .map(
      (chunk) =>
        `[${formatSeconds(chunk.start_sec)}-${formatSeconds(chunk.end_sec)}]\n${applySpeakerAliasesToText(
          chunk.text,
          speakerAliasMap
        )}`
    );
  if (chunksWithText.length === 0) {
    showToast("No speech transcript text yet. Check source selection or record spoken audio.", true);
    return;
  }
  await navigator.clipboard.writeText(chunksWithText.join("\n\n"));
  showToast("Transcript copied.");
}

async function generateSummaryForSelectedSession() {
  const session = state.selectedSessionId ? findSession(state.selectedSessionId) : null;
  if (!session) {
    return;
  }
  if (session.status !== "stopped") {
    showToast("Summary can be generated only after the session is stopped.", true);
    return;
  }
  state.summaryGenerating = true;
  state.summaryProgress = {
    sessionId: session.id,
    status: "running",
    percent: 0,
    message: "Queued...",
    at: new Date().toISOString()
  };
  renderControls();
  renderDetailSummary(session);
  try {
    await window.clipscribe.generateSessionSummary(session.id);
    await refreshGlobal();
    showToast("Summary generated.");
  } catch (error) {
    state.summaryProgress = {
      sessionId: session.id,
      status: "error",
      percent: 100,
      message: friendlyError(error),
      at: new Date().toISOString()
    };
    showToast(friendlyError(error), true);
  } finally {
    state.summaryGenerating = false;
    renderControls();
    const latest = state.selectedSessionId ? findSession(state.selectedSessionId) : null;
    renderDetailSummary(latest);
  }
}

async function copySessionSummary() {
  const session = state.selectedSessionId ? findSession(state.selectedSessionId) : null;
  if (!session) {
    return;
  }
  const summary = unwrapMarkdownCodeFence(String(session.summary_text || "").trim());
  if (!summary) {
    showToast("No summary available yet.", true);
    return;
  }
  await navigator.clipboard.writeText(summary);
  showToast("Summary copied.");
}

async function renameSelectedSession() {
  const session = state.selectedSessionId ? findSession(state.selectedSessionId) : null;
  if (!session) {
    return;
  }
  const nextTitle = window.prompt("Rename session", session.title || "");
  if (nextTitle === null) {
    return;
  }
  const trimmed = String(nextTitle || "").trim();
  if (!trimmed) {
    showToast("Session title cannot be empty.", true);
    return;
  }
  try {
    const updated = await window.clipscribe.renameSession(session.id, trimmed);
    replaceSessionInState(updated);
    renderSessions();
    renderControls();
    if (state.selectedSessionId === updated.id) {
      await renderDetail();
    }
    showToast("Session renamed.");
  } catch (error) {
    showToast(friendlyError(error), true);
  }
}

async function deleteSelectedSession() {
  const session = state.selectedSessionId ? findSession(state.selectedSessionId) : null;
  if (!session) {
    return;
  }
  if (session.status === "recording" || session.status === "paused") {
    showToast("Stop the session before deleting it.", true);
    return;
  }
  if (!window.confirm(`Delete session "${session.title}"? This removes transcript chunks too.`)) {
    return;
  }
  try {
    await window.clipscribe.deleteSession(session.id);
    state.selectedSessionId = null;
    await refreshGlobal();
    showToast("Session deleted.");
  } catch (error) {
    showToast(friendlyError(error), true);
  }
}

async function startSession() {
  const selectedSources = getCheckedSources();
  if (selectedSources.length === 0) {
    showToast("Select at least one source.", true);
    return;
  }
  try {
    const session = await window.clipscribe.startSession({
      folderId: state.selectedFolderId,
      title: els.sessionTitle.value.trim(),
      chunkSeconds: Number.parseInt(els.chunkSeconds.value, 10),
      selectedSources
    });
    state.selectedSessionId = session.id;
    state.captureSubView = "transcript";
    await refreshGlobal();
    showToast("Recording started.");
  } catch (error) {
    showToast(friendlyError(error), true);
  }
}

async function pauseActive() {
  const active = getActiveSession();
  if (!active) {
    return;
  }
  try {
    await window.clipscribe.pauseSession(active.id);
    await refreshGlobal();
    showToast("Paused.");
  } catch (error) {
    showToast(friendlyError(error), true);
  }
}

async function resumeActive() {
  const active = getActiveSession();
  if (!active) {
    return;
  }
  try {
    await window.clipscribe.resumeSession(active.id);
    await refreshGlobal();
    showToast("Resumed.");
  } catch (error) {
    showToast(friendlyError(error), true);
  }
}

async function stopActive() {
  const active = getActiveSession();
  if (!active) {
    return;
  }
  try {
    await window.clipscribe.stopSession(active.id);
    state.selectedSessionId = active.id;
    await refreshGlobal();
    const hasSummaryAutomation = Boolean(String(state.settings?.openrouter_api_key || "").trim());
    showToast(
      hasSummaryAutomation
        ? "Stopped. Summary is generating in background."
        : "Stopped."
    );
  } catch (error) {
    showToast(friendlyError(error), true);
  }
}

async function applySourceChange() {
  const active = getActiveSession();
  if (!active) {
    return;
  }
  const selectedSources = getCheckedSources();
  if (selectedSources.length === 0) {
    showToast("Select at least one source.", true);
    return;
  }
  try {
    await window.clipscribe.changeSessionSources(active.id, selectedSources);
    await refreshGlobal();
    showToast("Sources updated.");
  } catch (error) {
    showToast(friendlyError(error), true);
  }
}

async function createFolder() {
  const name = String(els.newFolderName.value || "").trim();
  if (!name) {
    showToast("Enter a folder name.", true);
    return;
  }
  try {
    const folder = await window.clipscribe.createFolder(name);
    els.newFolderName.value = "";
    state.selectedFolderId = folder.id;
    state.selectedSessionId = null;
    await refreshGlobal();
    showToast("Folder created.");
  } catch (error) {
    showToast(friendlyError(error), true);
  }
}

async function deleteSelectedFolder() {
  const folder = findFolder(state.selectedFolderId);
  if (!folder) {
    return;
  }
  if ((folder.sessions || []).length > 0) {
    showToast("Move or stop sessions before deleting this folder.", true);
    return;
  }
  if (!window.confirm(`Delete folder "${folder.name}"?`)) {
    return;
  }
  try {
    await window.clipscribe.deleteFolder(folder.id);
    state.selectedFolderId = null;
    state.selectedSessionId = null;
    await refreshGlobal();
    showToast("Folder deleted.");
  } catch (error) {
    showToast(friendlyError(error), true);
  }
}

async function refreshSources() {
  try {
    state.sources = await window.clipscribe.listSources();
    renderCaptureSources();
    renderDefaultSourceList();
    showToast(state.sources.length > 0 ? "Sources refreshed." : "No sources found. Check Setup Health.");
  } catch (error) {
    showToast(friendlyError(error), true);
  }
}

async function saveSettings() {
  try {
    const selectedOpenRouterModel = getSelectedOpenRouterModel();
    state.settings = await window.clipscribe.updateSettings({
      deepgram_api_key: els.deepgramApiKey.value.trim(),
      deepgram_project_id: els.deepgramProjectId.value.trim(),
      deepgram_model: els.deepgramModel.value,
      openrouter_api_key: els.openrouterApiKey.value.trim(),
      openrouter_model: selectedOpenRouterModel,
      transcription_preprocess_profile: els.preprocessProfile.value,
      transcription_preprocess_timeout_ms: Number.parseInt(els.preprocessTimeoutMs.value, 10),
      estimated_stt_usd_per_min: Number.parseFloat(els.estimatedSttUsdPerMin.value),
      chunk_seconds: Number.parseInt(els.chunkSecondsSettings.value, 10)
    });
    els.chunkSeconds.value = String(state.settings.chunk_seconds || 120);
    renderSettings();
    renderHealth();
    void refreshOpenRouterUsage({ silent: true });
    showToast("Settings saved.");
  } catch (error) {
    showToast(friendlyError(error), true);
  }
}

async function refreshOpenRouterModels({ silent = false } = {}) {
  if (!window.clipscribe.listOpenRouterFreeModels) {
    return;
  }
  if (state.openRouterModelsLoading) {
    return;
  }
  state.openRouterModelsLoading = true;
  state.openRouterModelsStatus = "Syncing free models...";
  renderSettings();
  try {
    const payload = await window.clipscribe.listOpenRouterFreeModels();
    const fetchedModels = Array.isArray(payload?.models) ? payload.models : [];
    if (fetchedModels.length > 0) {
      state.openRouterModels = mergeUniqueModels(fetchedModels);
    } else {
      state.openRouterModels = mergeUniqueModels([]);
    }
    const stamp = payload?.fetched_at ? dateFormatter.format(new Date(payload.fetched_at)) : "";
    state.openRouterModelsStatus = stamp
      ? `${state.openRouterModels.length} API free models synced | Updated ${stamp}`
      : `${state.openRouterModels.length} API free models synced.`;
    renderSettings();
    if (!silent) {
      showToast("Free models synced.");
    }
  } catch (error) {
    state.openRouterModels = mergeUniqueModels(state.openRouterModels);
    state.openRouterModelsStatus =
      "Sync failed. Showing cached model list.";
    renderSettings();
    if (!silent) {
      showToast(friendlyError(error), true);
    }
  } finally {
    state.openRouterModelsLoading = false;
    renderSettings();
  }
}

async function refreshDeepgramModels({ silent = false } = {}) {
  if (!window.clipscribe.listDeepgramModels) {
    return;
  }
  if (state.deepgramModelsLoading) {
    return;
  }
  state.deepgramModelsLoading = true;
  state.deepgramModelsStatus = "Syncing Deepgram models...";
  renderSettings();
  try {
    const payload = await window.clipscribe.listDeepgramModels();
    const models = Array.isArray(payload?.models) ? payload.models : [];
    state.deepgramModels = mergeUniqueDeepgramModels(models);
    const stamp = payload?.fetched_at ? dateFormatter.format(new Date(payload.fetched_at)) : "";
    state.deepgramModelsStatus = stamp
      ? `${state.deepgramModels.length} models synced | Updated ${stamp}`
      : `${state.deepgramModels.length} models synced.`;
    ensureDeepgramModelOptions(els.deepgramModel?.value || state.settings?.deepgram_model || "nova-3");
    renderEstimatedRateHint();
    if (!silent) {
      showToast("Deepgram models synced.");
    }
  } catch (error) {
    state.deepgramModelsStatus = "Sync failed. Showing cached model list.";
    if (!silent) {
      showToast(friendlyError(error), true);
    }
  } finally {
    state.deepgramModelsLoading = false;
    renderSettings();
  }
}

async function refreshOpenRouterUsage({ silent = false } = {}) {
  if (!window.clipscribe.getOpenRouterKeyInfo) {
    return;
  }
  if (state.openRouterUsageLoading) {
    return;
  }
  const hasKey = Boolean(String(state.settings?.openrouter_api_key || "").trim());
  if (!hasKey) {
    state.openRouterUsage = null;
    state.openRouterUsageError = "OpenRouter API key is missing.";
    renderOpenRouterUsage();
    return;
  }
  state.openRouterUsageLoading = true;
  state.openRouterUsageError = "";
  renderSettings();
  try {
    const payload = await window.clipscribe.getOpenRouterKeyInfo();
    if (!payload || payload.ok === false) {
      state.openRouterUsage = null;
      state.openRouterUsageError = payload?.message || "Unable to load OpenRouter usage.";
      if (!silent) {
        showToast(state.openRouterUsageError, true);
      }
      return;
    }
    state.openRouterUsage = {
      ...(payload.key || {}),
      fetched_at: new Date().toISOString()
    };
    state.openRouterUsageError = "";
    if (!silent) {
      showToast("OpenRouter usage updated.");
    }
  } catch (error) {
    state.openRouterUsage = null;
    state.openRouterUsageError = friendlyError(error);
    if (!silent) {
      showToast(state.openRouterUsageError, true);
    }
  } finally {
    state.openRouterUsageLoading = false;
    renderSettings();
  }
}

async function refreshUsageBreakdown() {
  if (!els.usageStartDate.value || !els.usageEndDate.value) {
    showToast("Pick both usage start and end dates.", true);
    return;
  }
  if (els.usageStartDate.value > els.usageEndDate.value) {
    showToast("Usage start date must be before end date.", true);
    return;
  }
  state.usageLoading = true;
  if (els.refreshUsageBtn) {
    els.refreshUsageBtn.disabled = true;
    els.refreshUsageBtn.textContent = "Loading...";
  }
  try {
    const payload = {
      start: els.usageStartDate.value,
      end: els.usageEndDate.value,
      grouping: els.usageGrouping.value || "",
      projectId: els.deepgramProjectId.value.trim()
    };
    const result = await window.clipscribe.getDeepgramUsageBreakdown(payload);
    if (result && result.ok === false) {
      state.usageBreakdown = null;
      state.usageError = result.message || "Unable to load usage with this API key.";
      renderUsageBreakdown();
      showToast(state.usageError, true);
      return;
    }
    state.usageError = "";
    state.usageBreakdown = result?.usage || result;
    if (!els.deepgramProjectId.value && state.usageBreakdown?.project_id) {
      els.deepgramProjectId.value = state.usageBreakdown.project_id;
    }
    renderUsageBreakdown();
    showToast("Usage breakdown updated.");
  } catch (error) {
    state.usageBreakdown = null;
    state.usageError = "";
    showToast(friendlyError(error), true);
  } finally {
    state.usageLoading = false;
    if (els.refreshUsageBtn) {
      els.refreshUsageBtn.disabled = false;
      els.refreshUsageBtn.textContent = "Refresh Deepgram";
    }
  }
}

async function saveDefaultSources() {
  try {
    const defaults = getCheckedSourcesByName("default-source-check");
    state.settings = await window.clipscribe.updateSettings({
      default_sources: defaults
    });
    renderDefaultSourceList();
    showToast("Default sources saved.");
  } catch (error) {
    showToast(friendlyError(error), true);
  }
}

async function autoDetectFfmpeg() {
  try {
    state.settings = await window.clipscribe.autoDetectFfmpeg();
    await refreshGlobal();
    showToast("FFmpeg paths detected and saved.");
  } catch (error) {
    showToast(friendlyError(error), true);
  }
}

async function repairNative() {
  try {
    const result = await window.clipscribe.repairNative();
    if (result.ok) {
      showToast("Native modules repaired. Restart app.");
      return;
    }
    const message = result.message || "Repair failed. Close app and run npm run rebuild:native.";
    showToast(message, true);
  } catch (error) {
    showToast(friendlyError(error), true);
  }
}

async function testSelectedSource() {
  const selectedSources = getCheckedSourcesByName("source-check");
  if (selectedSources.length === 0) {
    showToast("Select one source first.", true);
    return;
  }
  if (selectedSources.length > 1) {
    showToast("Pick exactly one source to test.", true);
    return;
  }
  const active = getActiveSession();
  await runSourceTest(selectedSources[0], active?.id || null);
}

async function openSelectedTranscript() {
  const selected = state.selectedSessionId ? findSession(state.selectedSessionId) : null;
  if (!selected) {
    return;
  }
  state.captureSubView = "transcript";
  setCaptureSubView(state.captureSubView);
  renderSessions();
  renderControls();
  await renderDetail();
}

function wireEvents() {
  els.navCaptureBtn.addEventListener("click", () => {
    setView("capture");
    renderWorkspaceHeader();
  });
  els.navSettingsBtn.addEventListener("click", () => {
    setView("settings");
    renderWorkspaceHeader();
  });
  const handleTabKeydown = (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const next = state.activeView === "capture" ? "settings" : "capture";
    setView(next);
    renderWorkspaceHeader();
    if (next === "capture") {
      els.navCaptureBtn.focus();
    } else {
      els.navSettingsBtn.focus();
    }
  };
  els.navCaptureBtn.addEventListener("keydown", handleTabKeydown);
  els.navSettingsBtn.addEventListener("keydown", handleTabKeydown);

  els.captureTabSetup.addEventListener("click", () => setCaptureSubView("setup"));
  els.captureTabSessions.addEventListener("click", () => setCaptureSubView("sessions"));
  els.captureTabTranscript.addEventListener("click", () => setCaptureSubView("transcript"));
  if (els.detailTabTranscript) {
    els.detailTabTranscript.addEventListener("click", () => setDetailSubView("transcript"));
  }
  if (els.detailTabSummary) {
    els.detailTabSummary.addEventListener("click", () => setDetailSubView("summary"));
  }
  if (els.detailTabTimeline) {
    els.detailTabTimeline.addEventListener("click", () => setDetailSubView("timeline"));
  }

  els.settingsTabHealth.addEventListener("click", () => setSettingsSubView("health"));
  els.settingsTabDefaults.addEventListener("click", () => setSettingsSubView("defaults"));
  els.settingsTabTranscription.addEventListener("click", () => setSettingsSubView("transcription"));
  if (els.transcriptionTabProviders) {
    els.transcriptionTabProviders.addEventListener("click", () => setTranscriptionSubView("providers"));
  }
  if (els.transcriptionTabUsage) {
    els.transcriptionTabUsage.addEventListener("click", () => setTranscriptionSubView("usage"));
  }

  els.sourcePickerToggle.addEventListener("click", () => {
    setSourcePickerOpen(!state.sourcePickerOpen);
  });
  els.testSelectedSourceBtn.addEventListener("click", testSelectedSource);
  els.playLastTestBtn.addEventListener("click", replayLastTestClip);
  els.sessionTitle.addEventListener("input", () => {
    renderSetupFlow();
  });
  els.sourceSearch.addEventListener("input", () => {
    state.sourceSearch = els.sourceSearch.value || "";
    renderCaptureSources();
  });
  els.defaultSourceSearch.addEventListener("input", () => {
    state.defaultSourceSearch = els.defaultSourceSearch.value || "";
    renderDefaultSourceList();
  });
  els.recordBtn.addEventListener("click", startSession);
  els.startFromSetupBtn.addEventListener("click", startSession);
  els.pauseBtn.addEventListener("click", pauseActive);
  els.resumeBtn.addEventListener("click", resumeActive);
  els.stopBtn.addEventListener("click", stopActive);
  els.applySourcesBtn.addEventListener("click", applySourceChange);
  els.copyAllBtn.addEventListener("click", copyAllTranscript);
  els.openTranscriptBtn.addEventListener("click", openSelectedTranscript);
  if (els.generateSummaryBtn) {
    els.generateSummaryBtn.addEventListener("click", generateSummaryForSelectedSession);
  }
  if (els.detailGenerateSummaryBtn) {
    els.detailGenerateSummaryBtn.addEventListener("click", generateSummaryForSelectedSession);
  }
  if (els.detailCopySummaryBtn) {
    els.detailCopySummaryBtn.addEventListener("click", copySessionSummary);
  }
  els.renameSessionBtn.addEventListener("click", renameSelectedSession);
  els.deleteSessionBtn.addEventListener("click", deleteSelectedSession);
  els.newFolderBtn.addEventListener("click", createFolder);
  els.deleteFolderBtn.addEventListener("click", deleteSelectedFolder);
  els.refreshSourcesBtn.addEventListener("click", refreshSources);
  els.saveSettingsBtn.addEventListener("click", saveSettings);
  if (els.refreshDeepgramModelsBtn) {
    els.refreshDeepgramModelsBtn.addEventListener("click", () => {
      void refreshDeepgramModels();
    });
  }
  if (els.deepgramModel) {
    els.deepgramModel.addEventListener("change", () => {
      const prev = Number(state.deepgramRateSuggestion || 0);
      const current = Number(els.estimatedSttUsdPerMin.value || 0);
      const next = Number(getSuggestedDeepgramRate(els.deepgramModel.value));
      const shouldAutoApply =
        !Number.isFinite(current) ||
        current <= 0 ||
        Math.abs(current - prev) < 0.000001;
      if (shouldAutoApply) {
        els.estimatedSttUsdPerMin.value = String(next);
      }
      renderEstimatedRateHint();
    });
  }
  if (els.refreshOpenRouterModelsBtn) {
    els.refreshOpenRouterModelsBtn.addEventListener("click", () => {
      void refreshOpenRouterModels();
    });
  }
  if (els.refreshOpenRouterUsageBtn) {
    els.refreshOpenRouterUsageBtn.addEventListener("click", () => {
      void refreshOpenRouterUsage();
    });
  }
  if (els.openrouterModel) {
    els.openrouterModel.addEventListener("change", () => {
      const selected = String(els.openrouterModel.value || "").trim();
      if (!els.openrouterModelCustom) {
        return;
      }
      const showCustom = selected === "__custom__";
      els.openrouterModelCustom.classList.toggle("hidden", !showCustom);
      if (showCustom && !els.openrouterModelCustom.value.trim()) {
        els.openrouterModelCustom.value = DEFAULT_SUMMARY_MODEL;
      }
    });
  }
  els.refreshUsageBtn.addEventListener("click", refreshUsageBreakdown);
  els.saveDefaultSourcesBtn.addEventListener("click", saveDefaultSources);
  els.detectFfmpegBtn.addEventListener("click", autoDetectFfmpeg);
  els.repairNativeBtn.addEventListener("click", repairNative);
  els.newFolderName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void createFolder();
    }
  });
  els.sessionsSearch.addEventListener("input", () => {
    state.sessionSearch = els.sessionsSearch.value || "";
    renderSessions();
    renderControls();
  });
  els.sessionsStatusFilter.addEventListener("change", () => {
    state.sessionStatusFilter = els.sessionsStatusFilter.value || "all";
    renderSessions();
    renderControls();
  });
  if (els.sourceFilterPills) {
    els.sourceFilterPills.addEventListener("click", (event) => {
      const target = event.target;
      if (!target || !target.matches("button[data-source-filter]")) {
        return;
      }
      state.sourceFilter = target.dataset.sourceFilter || "all";
      renderCaptureSources();
    });
  }

  document.addEventListener("click", (event) => {
    if (!state.sourcePickerOpen) {
      return;
    }
    const target = event.target;
    if (els.sourcePickerPanel.contains(target) || els.sourcePickerToggle.contains(target)) {
      return;
    }
    setSourcePickerOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const typing =
      target &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    if (typing) {
      return;
    }

    if (event.key === "Escape") {
      const active = getActiveSession();
      if (!active) {
        return;
      }
      event.preventDefault();
      if (active.status === "recording") {
        void pauseActive();
      } else if (active.status === "paused") {
        void resumeActive();
      }
      return;
    }

    if (event.ctrlKey && event.shiftKey && (event.key === "R" || event.key === "r")) {
      event.preventDefault();
      const active = getActiveSession();
      if (active) {
        void stopActive();
      } else {
        void startSession();
      }
      return;
    }

    if (event.ctrlKey && event.shiftKey && (event.key === "C" || event.key === "c")) {
      event.preventDefault();
      void copyAllTranscript();
    }
  });

  window.clipscribe.onGlobalUpdated(async () => {
    await queueFullRefresh();
  });
  window.clipscribe.onSessionUpdated(({ sessionId }) => {
    scheduleSessionRefresh(sessionId);
  });
  if (window.clipscribe.onSummaryProgress) {
    window.clipscribe.onSummaryProgress((payload) => {
      const sessionId = String(payload?.sessionId || "").trim();
      if (!sessionId) {
        return;
      }
      state.summaryProgress = {
        sessionId,
        status: String(payload?.status || "running").trim() || "running",
        percent: Number(payload?.percent || 0),
        message: String(payload?.message || "").trim(),
        at: String(payload?.at || "").trim()
      };
      if (state.summaryProgress.status === "done" || state.summaryProgress.status === "error") {
        state.summaryGenerating = false;
      }
      renderControls();
      if (state.selectedSessionId === sessionId) {
        const session = findSession(sessionId);
        renderDetailSummary(session);
      }
    });
  }
}

async function init() {
  wireEvents();
  setSourcePickerOpen(false);
  await refreshGlobal();
  void refreshOpenRouterModels({ silent: true });
  void refreshDeepgramModels({ silent: true });
  void refreshOpenRouterUsage({ silent: true });
  if ((state.sources || []).length === 0) {
    await refreshSources();
  }
  if (!liveDurationTimer) {
    liveDurationTimer = setInterval(() => {
      renderLiveDurationTick();
    }, 250);
  }
}

init().catch((error) => {
  showToast(friendlyError(error), true);
});

