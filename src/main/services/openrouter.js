const fs = require("node:fs");
const path = require("node:path");

const OPENROUTER_API_ROOT = "https://openrouter.ai/api/v1";
const DEFAULT_SUMMARY_MODEL = "openrouter/free";
const ROUTER_FALLBACK_MODEL = "openrouter/free";
const EMPTY_RETRY_MODEL = DEFAULT_SUMMARY_MODEL;
const OPENROUTER_RAW_LOG_PATH = path.join(process.cwd(), "app-data", "openrouter-raw.log");

function buildTranscriptWindow(text, maxChars = 90000) {
  const raw = String(text || "").trim();
  if (!raw) {
    return "";
  }
  const limit = Math.max(6000, Number(maxChars || 90000));
  if (raw.length <= limit) {
    return raw;
  }
  const half = Math.floor(limit / 2);
  const head = raw.slice(0, half);
  const tail = raw.slice(raw.length - half);
  return `${head}\n\n...[transcript truncated for context window]...\n\n${tail}`;
}

function isLikelyReasoningModel(model) {
  const value = String(model || "").toLowerCase();
  return (
    value.includes("r1") ||
    value.includes("reason") ||
    value.includes("o1") ||
    value.includes("o3")
  );
}

function isReasoningMandatoryError(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("reasoning is mandatory") ||
    text.includes("cannot be disabled") ||
    text.includes("must be enabled")
  );
}

function isStructuredOutputUnsupportedError(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("response_format") ||
    text.includes("structured output") ||
    text.includes("structured_outputs") ||
    text.includes("json schema")
  );
}

function buildJsonObjectResponseFormat() {
  return { type: "json_object" };
}

function getFirstFinishReason(json) {
  return String(json?.choices?.[0]?.finish_reason || "").trim().toLowerCase();
}

function normalizeInlineText(value, maxChars = 340) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars - 1).trim()}...`;
}

function redactAuthorization(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (!raw.toLowerCase().startsWith("bearer ")) {
    return raw;
  }
  const token = raw.slice(7).trim();
  if (token.length <= 10) {
    return "Bearer ***";
  }
  return `Bearer ${token.slice(0, 6)}...${token.slice(-4)}`;
}

function tryStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function appendOpenRouterRawLog(entry) {
  try {
    fs.mkdirSync(path.dirname(OPENROUTER_RAW_LOG_PATH), { recursive: true });
    fs.appendFileSync(
      OPENROUTER_RAW_LOG_PATH,
      `${tryStringify({ at: new Date().toISOString(), ...entry })}\n`,
      "utf8"
    );
  } catch (_) {
    // best-effort logging only
  }
}

async function fetchOpenRouterJson({
  operation,
  url,
  method = "POST",
  apiKey = "",
  headers = {},
  body = null,
  signal
}) {
  const requestHeaders = {
    Accept: "application/json",
    ...headers
  };
  if (apiKey) {
    requestHeaders.Authorization = `Bearer ${apiKey}`;
  }

  const requestBody =
    body == null ? "" : typeof body === "string" ? body : JSON.stringify(body);
  const loggedHeaders = { ...requestHeaders };
  if (loggedHeaders.Authorization) {
    loggedHeaders.Authorization = redactAuthorization(loggedHeaders.Authorization);
  }

  appendOpenRouterRawLog({
    phase: "request",
    operation: String(operation || "").trim() || "unknown",
    url: String(url || ""),
    method: String(method || "POST").toUpperCase(),
    headers: loggedHeaders,
    body: requestBody
  });

  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: requestBody || undefined,
    signal
  });
  const rawText = await response.text();
  appendOpenRouterRawLog({
    phase: "response",
    operation: String(operation || "").trim() || "unknown",
    url: String(url || ""),
    status: Number(response.status || 0),
    ok: Boolean(response.ok),
    body: rawText
  });

  let json = {};
  if (rawText) {
    try {
      json = JSON.parse(rawText);
    } catch (_) {
      appendOpenRouterRawLog({
        phase: "parse_error",
        operation: String(operation || "").trim() || "unknown",
        url: String(url || ""),
        message: "Response body is not valid JSON."
      });
    }
  }
  return { response, json, rawText };
}

function uniqNonEmpty(values) {
  const list = Array.isArray(values) ? values : [];
  const out = [];
  for (const raw of list) {
    const value = String(raw || "").trim();
    if (!value) {
      continue;
    }
    if (!out.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
      out.push(value);
    }
  }
  return out;
}

function buildSummaryPrompt({ sessionTitle, transcriptText }) {
  return [
    `Session title: ${sessionTitle || "Untitled Session"}`,
    "",
    "Transcript:",
    transcriptText
  ].join("\n");
}

function buildBriefPrompt({ sessionTitle, transcriptText, summaryText }) {
  return [
    `Session title: ${sessionTitle || "Untitled Session"}`,
    "",
    "Full summary:",
    String(summaryText || "").trim() || "Not available.",
    "",
    "Transcript excerpt:",
    buildTranscriptWindow(transcriptText, 12000)
  ].join("\n");
}

function buildLocalFallbackSummary(transcriptText) {
  const source = String(transcriptText || "");
  const textOnly = source
    .split(/\r?\n/)
    .map((line) => line.replace(/^\[[^\]]+\]\s*/g, "").trim())
    .filter(Boolean);
  const excerpt = textOnly.slice(0, 4).join(" ").slice(0, 280).trim();
  return [
    "## Executive Summary",
    excerpt
      ? `Automated model output was unavailable. Transcript excerpt: ${excerpt}`
      : "Automated model output was unavailable for this transcript.",
    "",
    "## Key Points",
    "- Not stated",
    "",
    "## Decisions",
    "- Not stated",
    "",
    "## Action Items",
    "- Owner: Unspecified - Follow up and regenerate summary if needed.",
    "",
    "## Open Questions",
    "- Not stated",
    "",
    "## Next Steps",
    "- Review transcript and regenerate summary."
  ].join("\n");
}

function buildLocalFallbackBrief(summaryText, transcriptText) {
  const summaryPlain = extractCompletionText({
    choices: [{ message: { content: String(summaryText || "") } }]
  }).replace(/\s+/g, " ").trim();
  if (summaryPlain) {
    const sentenceMatch = summaryPlain.match(/^[^.!?]+[.!?]/);
    return (sentenceMatch ? sentenceMatch[0] : summaryPlain).slice(0, 220).trim();
  }
  const transcriptPlain = String(transcriptText || "")
    .replace(/^\[[^\]]+\]\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!transcriptPlain) {
    return "Focus: session summary not available yet.";
  }
  return `Focus: ${transcriptPlain.slice(0, 180).trim()}...`;
}

function extractTextFromContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const direct = [];
    for (const key of ["text", "content", "output_text", "value"]) {
      if (typeof content[key] === "string" && content[key].trim()) {
        direct.push(content[key]);
      }
    }
    return direct.join("\n").trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (!item || typeof item !== "object") {
        return "";
      }
      if (typeof item.text === "string") {
        return item.text;
      }
      if (typeof item.content === "string") {
        return item.content;
      }
      return "";
    })
    .join("\n");
}

function extractCompletionText(json) {
  const choices = Array.isArray(json?.choices) ? json.choices : [];
  const parts = [];

  for (const choice of choices) {
    const msg = choice?.message || {};
    const direct = extractTextFromContent(msg.content);
    if (direct) {
      parts.push(direct);
    }
    if (typeof choice?.text === "string" && choice.text.trim()) {
      parts.push(choice.text);
    }
  }

  if (typeof json?.output_text === "string" && json.output_text.trim()) {
    parts.push(json.output_text);
  }

  return parts.join("\n").trim();
}

function isZeroPrice(value) {
  const num = Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(num)) {
    return false;
  }
  return Math.abs(num) < 1e-12;
}

async function getCurrentKeyInfo({ apiKey, timeoutMs = 20000 } = {}) {
  const key = String(apiKey || "").trim();
  if (!key) {
    throw new Error("OpenRouter API key is missing.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { response, json } = await fetchOpenRouterJson({
      operation: "key-info",
      url: `${OPENROUTER_API_ROOT}/key`,
      method: "GET",
      apiKey: key,
      signal: controller.signal
    });
    if (!response.ok) {
      const msg = String(
        json?.error?.message || json?.message || response.statusText || "OpenRouter key request failed."
      );
      throw new Error(`OpenRouter key error ${response.status}: ${msg}`);
    }
    const data = json?.data || {};
    return {
      label: String(data?.label || "").trim(),
      limit: Number(data?.limit),
      usage: Number(data?.usage),
      limit_remaining: Number(data?.limit_remaining),
      is_free_tier: Boolean(data?.is_free_tier),
      rate_limit: data?.rate_limit || null
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function listFreeModels({ timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { response, json } = await fetchOpenRouterJson({
      operation: "list-free-models",
      url: `${OPENROUTER_API_ROOT}/models`,
      method: "GET",
      signal: controller.signal
    });
    if (!response.ok) {
      const msg = String(
        json?.error?.message || json?.message || response.statusText || "OpenRouter models request failed."
      );
      throw new Error(`OpenRouter models error ${response.status}: ${msg}`);
    }
    const rows = Array.isArray(json?.data) ? json.data : [];
    const ids = rows
      .map((row) => ({
        id: String(row?.id || "").trim(),
        name: String(row?.name || "").trim(),
        pricing: row?.pricing || {}
      }))
      .filter((row) => row.id)
      .filter((row) => {
        const lowerId = row.id.toLowerCase();
        const lowerName = row.name.toLowerCase();
        if (lowerId === "openrouter/free") {
          return true;
        }
        if (row.id.endsWith(":free")) {
          return true;
        }
        const zeroCost =
          isZeroPrice(row.pricing?.prompt) &&
          isZeroPrice(row.pricing?.completion) &&
          isZeroPrice(row.pricing?.request || 0);
        if (!zeroCost) {
          return false;
        }
        // Keep unsuffixed free options that OpenRouter surfaces as free in-model metadata.
        return (
          lowerName.includes("(free)") ||
          lowerName.includes("free models router") ||
          lowerId.startsWith("openrouter/")
        );
      })
      .map((row) => row.id)
      .filter((id, index, list) => list.indexOf(id) === index)
      .sort((a, b) => a.localeCompare(b));

    return {
      models: ids,
      fetched_at: new Date().toISOString()
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function requestSummaryOnce({
  apiKey,
  model,
  sessionTitle,
  boundedTranscript,
  timeoutMs,
  retryHint = "",
  maxTokens = 1200
}) {
  async function requestWithReasoningMode(disableReasoning = true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const payload = {
        model: String(model || DEFAULT_SUMMARY_MODEL).trim(),
        temperature: 0.2,
        max_completion_tokens: maxTokens,
        max_tokens: maxTokens,
        messages: [
          {
            role: "system",
            content:
              "You are a meeting-notes assistant. Summarize transcripts faithfully and do not hallucinate. Output valid Markdown only. Use EXACTLY these level-2 headings in this order: '## Executive Summary', '## Key Points', '## Decisions', '## Action Items', '## Open Questions', '## Next Steps'. Use bullet lists for all sections except Executive Summary (2-4 sentences). Do not output code fences. Do not wrap headings in bold. If evidence is missing, write 'Not stated'. Keep action items concise with owner if explicit, otherwise owner='Unspecified'."
          },
          {
            role: "user",
            content: buildSummaryPrompt({
              sessionTitle,
              transcriptText: boundedTranscript
            })
          },
          ...(retryHint
            ? [
                {
                  role: "user",
                  content: retryHint
                }
              ]
            : [])
        ]
      };
      if (disableReasoning) {
        payload.reasoning = {
          effort: "none",
          exclude: true
        };
      }
      const { response, json } = await fetchOpenRouterJson({
        operation: disableReasoning ? "summary:disable-reasoning" : "summary:reasoning-enabled",
        url: `${OPENROUTER_API_ROOT}/chat/completions`,
        method: "POST",
        apiKey,
        headers: {
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/satriapamudji/clipscribe",
          "X-Title": "ClipScribe Desktop"
        },
        body: payload,
        signal: controller.signal
      });
      if (!response.ok) {
        const msg = String(
          json?.error?.message || json?.message || response.statusText || "OpenRouter request failed."
        );
        throw new Error(`OpenRouter error ${response.status}: ${msg}`);
      }

      return {
        json,
        summary: extractCompletionText(json),
        model: String(json?.model || model || DEFAULT_SUMMARY_MODEL),
        finishReason: String(json?.choices?.[0]?.finish_reason || "")
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  try {
    return await requestWithReasoningMode(true);
  } catch (error) {
    if (!isReasoningMandatoryError(error?.message)) {
      throw error;
    }
    return requestWithReasoningMode(false);
  }
}

async function summarizeTranscript({
  apiKey,
  model = DEFAULT_SUMMARY_MODEL,
  sessionTitle,
  transcriptText,
  timeoutMs = 60000
}) {
  const key = String(apiKey || "").trim();
  if (!key) {
    throw new Error("OpenRouter API key is missing. Add it in Transcription Settings.");
  }
  const boundedTranscript = buildTranscriptWindow(transcriptText, 90000);
  if (!boundedTranscript) {
    throw new Error("No transcript text available to summarize.");
  }

  const requestedModelRaw = String(model || "").trim();
  const requestedModel =
    !requestedModelRaw || requestedModelRaw === ROUTER_FALLBACK_MODEL
      ? DEFAULT_SUMMARY_MODEL
      : requestedModelRaw;
  const primaryModel = isLikelyReasoningModel(requestedModel)
    ? DEFAULT_SUMMARY_MODEL
    : requestedModel;
  const fallbackModel =
    primaryModel === ROUTER_FALLBACK_MODEL ? null : ROUTER_FALLBACK_MODEL;

  let first;
  try {
    first = await requestSummaryOnce({
      apiKey: key,
      model: primaryModel,
      sessionTitle,
      boundedTranscript,
      timeoutMs,
      maxTokens: 1400
    });
  } catch (error) {
    if (!fallbackModel) {
      throw error;
    }
    const message = String(error?.message || "");
    if (!/OpenRouter error (400|404|422):/i.test(message)) {
      throw error;
    }
    first = await requestSummaryOnce({
      apiKey: key,
      model: fallbackModel,
      sessionTitle,
      boundedTranscript,
      timeoutMs,
      maxTokens: 1400
    });
  }

  if (first.summary) {
    return {
      summary: first.summary,
      model: first.model
    };
  }

  const compactTranscript = buildTranscriptWindow(transcriptText, 14000);
  const retryModels = [
    EMPTY_RETRY_MODEL,
    fallbackModel,
    first.model || primaryModel
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => !isLikelyReasoningModel(item))
    .filter((item, index, list) => list.indexOf(item) === index);

  let lastAttempt = first;
  for (const retryModel of retryModels) {
    const second = await requestSummaryOnce({
      apiKey: key,
      model: retryModel,
      sessionTitle,
      boundedTranscript: compactTranscript,
      timeoutMs,
      maxTokens: 800,
      retryHint:
        "Your previous response was empty. Return a concise, non-empty meeting summary in plain text with the required section headings."
    });
    lastAttempt = second;
    if (second.summary) {
      return {
        summary: second.summary,
        model: second.model
      };
    }
  }

  const reason = lastAttempt.finishReason || first.finishReason;
  return {
    summary: buildLocalFallbackSummary(transcriptText),
    model: `local-fallback${reason ? ` (after empty model output: ${reason})` : ""}`
  };
}

async function summarizeSessionBrief({
  apiKey,
  model = DEFAULT_SUMMARY_MODEL,
  sessionTitle,
  transcriptText,
  summaryText,
  timeoutMs = 45000
}) {
  const key = String(apiKey || "").trim();
  if (!key) {
    return buildLocalFallbackBrief(summaryText, transcriptText);
  }
  const requestedModelRaw = String(model || "").trim();
  const requestedModel =
    !requestedModelRaw || requestedModelRaw === ROUTER_FALLBACK_MODEL
      ? DEFAULT_SUMMARY_MODEL
      : requestedModelRaw;
  const primaryModel = isLikelyReasoningModel(requestedModel)
    ? DEFAULT_SUMMARY_MODEL
    : requestedModel;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    async function requestBrief(disableReasoning = true) {
      const payload = {
        model: primaryModel,
        temperature: 0.1,
        max_completion_tokens: 180,
        max_tokens: 180,
        messages: [
          {
            role: "system",
            content:
              "Write exactly two concise sentences describing what the session is about in objective language. Do not use markdown, bullets, or speaker names unless necessary."
          },
          {
            role: "user",
            content: buildBriefPrompt({ sessionTitle, transcriptText, summaryText })
          }
        ]
      };
      if (disableReasoning) {
        payload.reasoning = { effort: "none", exclude: true };
      }
      const { response, json } = await fetchOpenRouterJson({
        operation: disableReasoning ? "brief:disable-reasoning" : "brief:reasoning-enabled",
        url: `${OPENROUTER_API_ROOT}/chat/completions`,
        method: "POST",
        apiKey: key,
        headers: {
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/satriapamudji/clipscribe",
          "X-Title": "ClipScribe Desktop"
        },
        body: payload,
        signal: controller.signal
      });
      if (!response.ok) {
        const msg = String(
          json?.error?.message || json?.message || response.statusText || "OpenRouter request failed."
        );
        throw new Error(`OpenRouter error ${response.status}: ${msg}`);
      }
      return json;
    }
    let json;
    try {
      json = await requestBrief(true);
    } catch (error) {
      if (!isReasoningMandatoryError(error?.message)) {
        return buildLocalFallbackBrief(summaryText, transcriptText);
      }
      json = await requestBrief(false);
    }
    const brief = extractCompletionText(json).replace(/\s+/g, " ").trim();
    if (brief) {
      const sentences = brief.match(/[^.!?]+[.!?]+/g);
      if (Array.isArray(sentences) && sentences.length >= 2) {
        return `${sentences[0].trim()} ${sentences[1].trim()}`.trim();
      }
      return brief;
    }
    return buildLocalFallbackBrief(summaryText, transcriptText);
  } catch (_) {
    return buildLocalFallbackBrief(summaryText, transcriptText);
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonObjectFromText(text) {
  const source = String(text || "").trim();
  if (!source) {
    return null;
  }
  const candidates = [source];
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced && fenced[1]) {
    candidates.push(String(fenced[1]).trim());
  }
  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(source.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (_) {
      // try next
    }
  }
  return null;
}

function buildLocalPlan(question) {
  const raw = String(question || "").trim();
  const lower = raw.toLowerCase();
  const speakerMatches = raw.match(/\b([A-Z][a-zA-Z0-9_-]{1,30})\b/g) || [];
  const speakerHints = speakerMatches
    .filter((token) => !["What", "When", "Where", "Why", "How", "Who", "Could", "Would", "Should"].includes(token))
    .slice(0, 3);
  let intent = "general";
  if (/\b(decision|decide|decided)\b/.test(lower)) {
    intent = "decision";
  } else if (/\b(action item|todo|next step|follow up)\b/.test(lower)) {
    intent = "action_items";
  } else if (/\b(summary|summarize|recap|overview)\b/.test(lower)) {
    intent = "summary";
  } else if (/\b(what|anything|all|everything)\b[\s\S]{0,24}\b(say|said)\b/.test(lower)) {
    intent = "speaker_quote";
  }
  let timelineScope = "any";
  if (/\b(end|later|recent|last)\b/.test(lower)) {
    timelineScope = "recent";
  } else if (/\b(begin|start|early|first)\b/.test(lower)) {
    timelineScope = "start";
  } else if (/\bmiddle|mid\b/.test(lower)) {
    timelineScope = "middle";
  }
  return {
    intent,
    rewritten_query: raw,
    speaker_hints: uniqNonEmpty(speakerHints),
    topic_hints: [],
    timeline_scope: timelineScope,
    answer_style: "paragraph"
  };
}

function normalizePlanResult(plan, question) {
  const fallback = buildLocalPlan(question);
  if (!plan || typeof plan !== "object") {
    return fallback;
  }
  const intent = String(plan.intent || "").trim().toLowerCase();
  const timelineScope = String(plan.timeline_scope || "").trim().toLowerCase();
  const answerStyle = String(plan.answer_style || "").trim().toLowerCase();
  return {
    intent: intent || fallback.intent,
    rewritten_query: String(plan.rewritten_query || "").trim() || fallback.rewritten_query,
    speaker_hints: uniqNonEmpty(plan.speaker_hints).slice(0, 5),
    topic_hints: uniqNonEmpty(plan.topic_hints).slice(0, 8),
    timeline_scope: ["any", "start", "middle", "recent"].includes(timelineScope)
      ? timelineScope
      : fallback.timeline_scope,
    answer_style: ["paragraph", "bullets", "brief"].includes(answerStyle)
      ? answerStyle
      : fallback.answer_style
  };
}

function hasValidPlanPayload(plan) {
  if (!plan || typeof plan !== "object") {
    return false;
  }
  const rewritten = String(plan.rewritten_query || "").trim();
  const intent = String(plan.intent || "").trim();
  return Boolean(rewritten && intent);
}

function hasValidChatPayload(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return false;
  }
  if (typeof parsed.answer_markdown !== "string") {
    return false;
  }
  if (!Array.isArray(parsed.citations)) {
    return false;
  }
  return true;
}

function extractAnswerFromUnexpectedPayload(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return "";
  }
  const directKeys = [
    "answer",
    "summary",
    "executive_summary",
    "text",
    "content"
  ];
  for (const key of directKeys) {
    if (typeof parsed[key] === "string" && parsed[key].trim()) {
      return normalizeInlineText(parsed[key], 900);
    }
  }
  if (Array.isArray(parsed.key_points) && parsed.key_points.length > 0) {
    const points = parsed.key_points
      .map((item) => normalizeInlineText(item, 180))
      .filter(Boolean)
      .slice(0, 3);
    if (points.length > 0) {
      return `Closest points: ${points.join(" | ")}`;
    }
  }
  return "";
}

function compactChatHistory(history, maxItems = 4) {
  return (Array.isArray(history) ? history : [])
    .map((item) => ({
      role: String(item?.role || "").trim().toLowerCase(),
      content: normalizeInlineText(item?.content, 420)
    }))
    .filter((item) => (item.role === "user" || item.role === "assistant") && item.content)
    .slice(-Math.max(0, Number(maxItems || 0)));
}

async function planSessionQuestion({
  apiKey,
  model = DEFAULT_SUMMARY_MODEL,
  sessionTitle,
  question,
  timeoutMs = 25000
}) {
  const key = String(apiKey || "").trim();
  const rawQuestion = String(question || "").trim();
  if (!key || !rawQuestion) {
    return buildLocalPlan(rawQuestion);
  }
  const requestedModelRaw = String(model || "").trim();
  const requestedModel =
    !requestedModelRaw || requestedModelRaw === ROUTER_FALLBACK_MODEL
      ? DEFAULT_SUMMARY_MODEL
      : requestedModelRaw;
  const primaryModel = isLikelyReasoningModel(requestedModel)
    ? DEFAULT_SUMMARY_MODEL
    : requestedModel;

  async function requestPlan({
    disableReasoning = true,
    includeResponseFormat = true,
    maxTokens = 420,
    retryHint = ""
  } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const payload = {
        model: primaryModel,
        temperature: 0,
        max_completion_tokens: maxTokens,
        max_tokens: maxTokens,
        messages: [
          {
            role: "system",
            content:
              "You are a query planner for transcript QA retrieval. Return STRICT JSON with keys: intent, rewritten_query, speaker_hints (array), topic_hints (array), timeline_scope (any|start|middle|recent), answer_style (paragraph|bullets|brief). Do not answer the user question. No markdown. No prose."
          },
          {
            role: "user",
            content: [
              `Session title: ${sessionTitle || "Untitled Session"}`,
              `Question: ${rawQuestion}`,
              "Return only JSON."
            ].join("\n")
          },
          ...(retryHint
            ? [
                {
                  role: "user",
                  content: retryHint
                }
              ]
            : [])
        ]
      };
      if (includeResponseFormat) {
        payload.response_format = buildJsonObjectResponseFormat();
      }
      if (disableReasoning) {
        payload.reasoning = { effort: "none", exclude: true };
      } else {
        payload.reasoning = { effort: "low" };
      }
      const { response, json } = await fetchOpenRouterJson({
        operation: disableReasoning ? "planner:disable-reasoning" : "planner:reasoning-enabled",
        url: `${OPENROUTER_API_ROOT}/chat/completions`,
        method: "POST",
        apiKey: key,
        headers: {
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/satriapamudji/clipscribe",
          "X-Title": "ClipScribe Desktop"
        },
        body: payload,
        signal: controller.signal
      });
      if (!response.ok) {
        const msg = String(
          json?.error?.message || json?.message || response.statusText || "OpenRouter request failed."
        );
        if (
          includeResponseFormat &&
          (response.status === 400 || response.status === 422) &&
          isStructuredOutputUnsupportedError(msg)
        ) {
          return requestPlan({
            disableReasoning,
            includeResponseFormat: false,
            maxTokens,
            retryHint
          });
        }
        throw new Error(`OpenRouter error ${response.status}: ${msg}`);
      }
      return json;
    } finally {
      clearTimeout(timeout);
    }
  }

  try {
    let first;
    try {
      first = await requestPlan({ disableReasoning: true });
    } catch (error) {
      if (!isReasoningMandatoryError(error?.message)) {
        throw error;
      }
      first = await requestPlan({ disableReasoning: false });
    }
    let parsed = parseJsonObjectFromText(extractCompletionText(first));
    if (hasValidPlanPayload(parsed)) {
      return normalizePlanResult(parsed, rawQuestion);
    }

    const second = await requestPlan({
      disableReasoning: false,
      maxTokens: 620,
      retryHint:
        "Your previous output was invalid or empty. Return a single JSON object with keys: intent, rewritten_query, speaker_hints, topic_hints, timeline_scope, answer_style."
    });
    parsed = parseJsonObjectFromText(extractCompletionText(second));
    if (!hasValidPlanPayload(parsed) && getFirstFinishReason(second) === "length") {
      const third = await requestPlan({
        disableReasoning: false,
        includeResponseFormat: false,
        maxTokens: 760,
        retryHint:
          "Do not include chain-of-thought. Return a compact JSON object only. Do not output any explanation."
      });
      parsed = parseJsonObjectFromText(extractCompletionText(third));
    }
    return normalizePlanResult(parsed, rawQuestion);
  } catch (_) {
    return buildLocalPlan(rawQuestion);
  }
}

function normalizeChatCitation(rawCitation, allowedById) {
  if (!rawCitation) {
    return null;
  }
  if (typeof rawCitation === "string") {
    const lineId = rawCitation.trim().toLowerCase();
    const match = allowedById.get(lineId);
    if (!match) {
      return null;
    }
    return {
      line_id: match.line_id,
      chunk_index: Number(match.chunk_index || 0),
      start_sec: Number(match.start_sec || 0),
      end_sec: Number(match.end_sec || 0),
      speaker: String(match.speaker || "").trim(),
      text: String(match.text || "").trim()
    };
  }
  if (typeof rawCitation !== "object") {
    return null;
  }
  const lineId = String(
    rawCitation.line_id ||
      rawCitation.lineId ||
      rawCitation.id ||
      rawCitation.ref ||
      ""
  )
    .trim()
    .toLowerCase();
  if (!lineId) {
    return null;
  }
  const match = allowedById.get(lineId);
  if (!match) {
    return null;
  }
  return {
    line_id: match.line_id,
    chunk_index: Number(match.chunk_index || 0),
    start_sec: Number(match.start_sec || 0),
    end_sec: Number(match.end_sec || 0),
    speaker: String(match.speaker || "").trim(),
    text: String(match.text || "").trim()
  };
}

function tokenizeForSearch(text) {
  return String(text || "")
    .toLowerCase()
    .match(/[a-z0-9]{2,}/g) || [];
}

function scoreLineForQuestion(line, questionTokens, rawQuestion) {
  const haystack = `${String(line?.speaker || "").toLowerCase()} ${String(line?.text || "").toLowerCase()}`;
  let score = 0;
  if (rawQuestion && haystack.includes(rawQuestion)) {
    score += 8;
  }
  const speakerName = String(line?.speaker || "").trim().toLowerCase();
  if (speakerName && rawQuestion && rawQuestion.includes(speakerName)) {
    score += 12;
  }
  for (const token of questionTokens) {
    if (haystack.includes(token)) {
      score += 2;
    }
  }
  const asksWhatSaid = /\b(what|which)\b[\s\S]{0,30}\b(say|said)\b/i.test(String(rawQuestion || ""));
  if (asksWhatSaid && String(line?.speaker || "").trim()) {
    score += 1;
  }
  return score;
}

function buildEvidenceFallbackAnswer(question, normalizedLines) {
  const source = Array.isArray(normalizedLines) ? normalizedLines : [];
  if (source.length === 0) {
    return null;
  }
  const rawQuestion = String(question || "").trim().toLowerCase();
  const tokens = tokenizeForSearch(rawQuestion);
  const ranked = source
    .map((line, index) => ({
      ...line,
      __idx: index,
      __score: scoreLineForQuestion(line, tokens, rawQuestion)
    }))
    .sort((a, b) => {
      if (b.__score !== a.__score) {
        return b.__score - a.__score;
      }
      return a.__idx - b.__idx;
    });

  let selected = ranked.filter((row) => row.__score > 0).slice(0, 4);
  if (selected.length === 0) {
    selected = ranked.slice(Math.max(0, ranked.length - 3));
  }
  if (selected.length === 0) {
    return null;
  }

  const citations = selected.map((line) => ({
    line_id: line.line_id,
    chunk_index: Number(line.chunk_index || 0),
    start_sec: Number(line.start_sec || 0),
    end_sec: Number(line.end_sec || 0),
    speaker: String(line.speaker || "").trim(),
    text: String(line.text || "").trim()
  }));

  const bySpeaker = new Map();
  for (const line of citations) {
    const key = String(line.speaker || "").trim() || "Speaker";
    bySpeaker.set(key, (bySpeaker.get(key) || 0) + 1);
  }
  const topSpeaker = [...bySpeaker.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  const snippets = citations
    .map((line) => String(line.text || "").replace(/\s+/g, " ").trim().slice(0, 220))
    .filter(Boolean);

  const quoted = snippets.slice(0, 3).map((snippet) => `"${snippet}"`).join(" ");
  const lead = topSpeaker && topSpeaker !== "Speaker"
    ? `Closest transcript evidence suggests ${topSpeaker} said:`
    : "Closest transcript evidence suggests:";

  return {
    answer: [
      "I couldn't match your wording exactly.",
      `${lead} ${quoted}`.trim()
    ].join("\n\n"),
    citations
  };
}

async function answerSessionQuestion({
  apiKey,
  model = DEFAULT_SUMMARY_MODEL,
  sessionTitle,
  question,
  contextLines,
  history = [],
  timeoutMs = 60000
}) {
  const key = String(apiKey || "").trim();
  if (!key) {
    throw new Error("OpenRouter API key is missing. Add it in Transcription Settings.");
  }
  const prompt = String(question || "").trim();
  if (!prompt) {
    throw new Error("Question is required.");
  }
  const normalizedLines = (Array.isArray(contextLines) ? contextLines : [])
    .map((line) => ({
      line_id: String(line?.line_id || "").trim(),
      chunk_index: Number(line?.chunk_index || 0),
      start_sec: Number(line?.start_sec || 0),
      end_sec: Number(line?.end_sec || 0),
      speaker: String(line?.speaker || "").trim(),
      text: String(line?.text || "").trim()
    }))
    .filter((line) => line.line_id && line.text);
  if (normalizedLines.length === 0) {
    throw new Error("No transcript context is available for this question.");
  }

  const allowedById = new Map(
    normalizedLines.map((line) => [String(line.line_id).toLowerCase(), line])
  );
  const contextBlock = normalizedLines
    .map((line) => {
      const speakerPart = line.speaker ? `${line.speaker}: ` : "";
      return `[${line.line_id}] [${line.start_sec.toFixed(2)}-${line.end_sec.toFixed(
        2
      )}] ${speakerPart}${line.text}`;
    })
    .join("\n");

  const recentHistory = compactChatHistory(history, 4);

  const requestedModelRaw = String(model || "").trim();
  const requestedModel =
    !requestedModelRaw || requestedModelRaw === ROUTER_FALLBACK_MODEL
      ? DEFAULT_SUMMARY_MODEL
      : requestedModelRaw;
  const primaryModel = isLikelyReasoningModel(requestedModel)
    ? DEFAULT_SUMMARY_MODEL
    : requestedModel;
  const fallbackModel =
    primaryModel === ROUTER_FALLBACK_MODEL ? null : ROUTER_FALLBACK_MODEL;

  async function requestAnswer(modelId) {
    async function runSingleAttempt({
      disableReasoning = true,
      includeResponseFormat = true,
      maxTokens = 980,
      retryHint = ""
    } = {}) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const payload = {
          model: modelId,
          temperature: 0.15,
          max_completion_tokens: maxTokens,
          max_tokens: maxTokens,
          messages: [
            {
              role: "system",
              content:
                "You are a transcript-grounded assistant. Use ONLY the provided transcript lines. Do not invent facts. Return STRICT JSON with keys: answer_markdown (string) and citations (array). citations MUST be an array of objects each containing line_id. Style: default to 1-2 concise paragraphs in plain markdown prose. Do NOT include timestamps/line IDs inside answer_markdown unless user explicitly asks for them. Keep quoted snippets short. If unsupported, set answer_markdown to 'Not found in this session transcript.' and citations to []. No markdown code fences. No extra keys."
            },
            ...(recentHistory.length > 0
              ? [
                  {
                    role: "system",
                    content: `Conversation history (compressed):\n${recentHistory
                      .map((item) => `${item.role}: ${item.content}`)
                      .join("\n")}`
                  }
                ]
              : []),
            {
              role: "user",
              content: [
                `Session title: ${sessionTitle || "Untitled Session"}`,
                "",
                `Question: ${prompt}`,
                "",
                "Allowed transcript lines:",
                contextBlock,
                "",
                "Return only JSON."
              ].join("\n")
            },
            ...(retryHint
              ? [
                  {
                    role: "user",
                    content: retryHint
                  }
                ]
              : [])
          ]
        };
        if (includeResponseFormat) {
          payload.response_format = buildJsonObjectResponseFormat();
        }
        if (disableReasoning) {
          payload.reasoning = { effort: "none", exclude: true };
        } else {
          payload.reasoning = { effort: "low" };
        }
        const { response, json } = await fetchOpenRouterJson({
          operation: disableReasoning ? "chat:disable-reasoning" : "chat:reasoning-enabled",
          url: `${OPENROUTER_API_ROOT}/chat/completions`,
          method: "POST",
          apiKey: key,
          headers: {
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/satriapamudji/clipscribe",
            "X-Title": "ClipScribe Desktop"
          },
          body: payload,
          signal: controller.signal
        });
        if (!response.ok) {
          const msg = String(
            json?.error?.message || json?.message || response.statusText || "OpenRouter request failed."
          );
          if (
            includeResponseFormat &&
            (response.status === 400 || response.status === 422) &&
            isStructuredOutputUnsupportedError(msg)
          ) {
            return runSingleAttempt({
              disableReasoning,
              includeResponseFormat: false,
              maxTokens,
              retryHint
            });
          }
          throw new Error(`OpenRouter error ${response.status}: ${msg}`);
        }
        return json;
      } finally {
        clearTimeout(timeout);
      }
    }

    const attempts = [
      {
        disableReasoning: true,
        includeResponseFormat: true,
        maxTokens: 980,
        retryHint: ""
      },
      {
        disableReasoning: false,
        includeResponseFormat: true,
        maxTokens: 1240,
        retryHint:
          "Your previous output was invalid. Return ONLY one JSON object with keys answer_markdown and citations. citations must only reference allowed line_id values."
      },
      {
        disableReasoning: false,
        includeResponseFormat: false,
        maxTokens: 1280,
        retryHint:
          "Final retry: output only compact JSON with exactly answer_markdown and citations. No prose outside JSON."
      }
    ];

    let lastJson = null;
    let lastParsed = null;
    let lastText = "";
    for (const attempt of attempts) {
      let json;
      try {
        json = await runSingleAttempt(attempt);
      } catch (error) {
        if (!isReasoningMandatoryError(error?.message)) {
          throw error;
        }
        json = await runSingleAttempt({ ...attempt, disableReasoning: false });
      }
      lastJson = json;
      lastText = extractCompletionText(json);
      lastParsed = parseJsonObjectFromText(lastText);
      if (hasValidChatPayload(lastParsed)) {
        return {
          json,
          parsed: lastParsed,
          completionText: lastText
        };
      }
      if (lastText.trim() && getFirstFinishReason(json) !== "length") {
        break;
      }
    }
    return {
      json: lastJson || {},
      parsed: lastParsed,
      completionText: lastText
    };
  }

  let result;
  try {
    result = await requestAnswer(primaryModel);
  } catch (error) {
    const message = String(error?.message || "");
    if (!fallbackModel || !/OpenRouter error (400|404|422):/i.test(message)) {
      throw error;
    }
    result = await requestAnswer(fallbackModel);
  }

  const completionText = String(result?.completionText || "").trim();
  const parsed = result?.parsed && typeof result.parsed === "object"
    ? result.parsed
    : parseJsonObjectFromText(completionText);
  const rawAnswer = hasValidChatPayload(parsed)
    ? parsed.answer_markdown
    : (
        extractAnswerFromUnexpectedPayload(parsed) ||
        normalizeInlineText(completionText, 900)
      );
  const citations = (Array.isArray(parsed?.citations) ? parsed.citations : [])
    .map((item) => normalizeChatCitation(item, allowedById))
    .filter(Boolean)
    .slice(0, 8);

  const answer = String(rawAnswer || "").trim() || "Not found in this session transcript.";
  const explicitNotFound = /^not found in this session transcript\.?$/i.test(answer);
  const fallback = buildEvidenceFallbackAnswer(prompt, normalizedLines);
  const selectedModel = String(
    result?.json?.model || primaryModel || DEFAULT_SUMMARY_MODEL
  ).trim();
  if (citations.length === 0 && fallback) {
    if (explicitNotFound) {
      return {
        answer: fallback.answer,
        citations: fallback.citations,
        model: `${selectedModel} + local-evidence-fallback`
      };
    }
    return {
      answer,
      citations: fallback.citations,
      model: `${selectedModel} + local-citation-backfill`
    };
  }
  return {
    answer,
    citations,
    model: selectedModel
  };
}

module.exports = {
  summarizeTranscript,
  summarizeSessionBrief,
  planSessionQuestion,
  answerSessionQuestion,
  listFreeModels,
  getCurrentKeyInfo
};
