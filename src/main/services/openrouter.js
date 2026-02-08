const OPENROUTER_API_ROOT = "https://openrouter.ai/api/v1";
const DEFAULT_SUMMARY_MODEL = "openrouter/free";
const ROUTER_FALLBACK_MODEL = "openrouter/free";
const EMPTY_RETRY_MODEL = DEFAULT_SUMMARY_MODEL;

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
    const response = await fetch(`${OPENROUTER_API_ROOT}/key`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });
    const json = await response.json().catch(() => ({}));
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
    const response = await fetch(`${OPENROUTER_API_ROOT}/models`, {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      signal: controller.signal
    });
    const json = await response.json().catch(() => ({}));
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
        pricing: row?.pricing || {}
      }))
      .filter((row) => row.id)
      .filter((row) => {
        if (row.id.endsWith(":free")) {
          return true;
        }
        return (
          isZeroPrice(row.pricing?.prompt) &&
          isZeroPrice(row.pricing?.completion) &&
          isZeroPrice(row.pricing?.request || 0)
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${OPENROUTER_API_ROOT}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/satriapamudji/clipscribe",
        "X-Title": "ClipScribe Desktop"
      },
      body: JSON.stringify({
        model: String(model || DEFAULT_SUMMARY_MODEL).trim(),
        temperature: 0.2,
        max_completion_tokens: maxTokens,
        max_tokens: maxTokens,
        reasoning: {
          effort: "none",
          exclude: true
        },
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
      }),
      signal: controller.signal
    });

    const json = await response.json().catch(() => ({}));
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
    const response = await fetch(`${OPENROUTER_API_ROOT}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/satriapamudji/clipscribe",
        "X-Title": "ClipScribe Desktop"
      },
      body: JSON.stringify({
        model: primaryModel,
        temperature: 0.1,
        max_completion_tokens: 180,
        max_tokens: 180,
        reasoning: { effort: "none", exclude: true },
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
      }),
      signal: controller.signal
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return buildLocalFallbackBrief(summaryText, transcriptText);
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

module.exports = {
  summarizeTranscript,
  summarizeSessionBrief,
  listFreeModels,
  getCurrentKeyInfo
};
