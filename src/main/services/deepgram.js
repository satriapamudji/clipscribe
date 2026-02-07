const fs = require("node:fs");

const DEEPGRAM_API_ROOT = "https://api.deepgram.com/v1";
const USAGE_GROUPINGS = new Set([
  "accessor",
  "endpoint",
  "feature_set",
  "models",
  "method",
  "tags",
  "deployment"
]);

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildListenUrl(model) {
  const url = new URL(`${DEEPGRAM_API_ROOT}/listen`);
  url.searchParams.set("model", model || "nova-3");
  url.searchParams.set("punctuate", "true");
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("utterances", "true");
  url.searchParams.set("paragraphs", "true");
  return url.toString();
}

async function requestJson({
  apiKey,
  url,
  method = "GET",
  headers = {},
  body = undefined,
  timeoutMs = 30000
}) {
  if (!apiKey) {
    throw new Error("Deepgram API key is missing.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Token ${apiKey}`,
        ...headers
      },
      body,
      signal: controller.signal
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = json?.err_msg || json?.message || response.statusText;
      throw new Error(`Deepgram error ${response.status}: ${msg} (${url})`);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizeUsageGrouping(value) {
  const text = String(value || "").trim().toLowerCase();
  return USAGE_GROUPINGS.has(text) ? text : "";
}

function buildUsageBreakdownUrl({
  projectId,
  start,
  end,
  grouping,
  endpoint
}) {
  const url = new URL(
    `${DEEPGRAM_API_ROOT}/projects/${encodeURIComponent(projectId)}/usage/breakdown`
  );
  if (start) {
    url.searchParams.set("start", start);
  }
  if (end) {
    url.searchParams.set("end", end);
  }
  if (grouping) {
    url.searchParams.set("grouping", grouping);
  }
  if (endpoint) {
    url.searchParams.set("endpoint", endpoint);
  }
  return url.toString();
}

function extractTranscriptionMeta(json) {
  const alt = json?.results?.channels?.[0]?.alternatives?.[0] || {};
  const utterances = Array.isArray(json?.results?.utterances)
    ? json.results.utterances
    : [];
  const paragraphs = Array.isArray(alt?.paragraphs?.paragraphs)
    ? alt.paragraphs.paragraphs
    : [];
  const words = Array.isArray(alt?.words) ? alt.words : [];
  const requestId = json?.metadata?.request_id || "";
  const modelInfo = json?.metadata?.model_info || {};
  const modelName = Object.values(modelInfo)[0]?.name || "";
  return {
    transcript: String(alt?.transcript || "").trim(),
    confidence: toNumber(alt?.confidence),
    request_id: requestId,
    duration_sec: toNumber(json?.metadata?.duration),
    model_name: modelName,
    word_count: words.length,
    utterances: utterances.map((item) => ({
      start: toNumber(item?.start),
      end: toNumber(item?.end),
      confidence: toNumber(item?.confidence),
      speaker: Number.isFinite(Number(item?.speaker)) ? Number(item.speaker) : null,
      transcript: String(item?.transcript || "").trim()
    })),
    paragraphs: paragraphs.map((item) => ({
      start: toNumber(item?.start),
      end: toNumber(item?.end),
      speaker: Number.isFinite(Number(item?.speaker)) ? Number(item.speaker) : null,
      transcript: String(
        item?.sentences?.map((sentence) => sentence?.text || "").join(" ") ||
          item?.transcript ||
          ""
      ).trim()
    }))
  };
}

async function transcribePreRecorded({
  apiKey,
  model,
  filePath,
  timeoutMs = 30000
}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Chunk file not found: ${filePath}`);
  }
  const audioData = fs.readFileSync(filePath);
  const json = await requestJson({
    apiKey,
    url: buildListenUrl(model),
    method: "POST",
    headers: {
      "Content-Type": "audio/wav"
    },
    body: audioData,
    timeoutMs
  });
  return extractTranscriptionMeta(json);
}

async function listProjects(apiKey) {
  const json = await requestJson({
    apiKey,
    url: `${DEEPGRAM_API_ROOT}/projects`,
    method: "GET",
    timeoutMs: 20000
  });
  const projects = Array.isArray(json?.projects) ? json.projects : [];
  return projects.map((project) => ({
    project_id: String(project?.project_id || ""),
    name: String(project?.name || "")
  }));
}

async function getUsageBreakdown({
  apiKey,
  projectId,
  start,
  end,
  grouping = "",
  endpoint = "listen"
}) {
  const requestedProjectId = String(projectId || "").trim();
  const requestedGrouping = normalizeUsageGrouping(grouping);
  const normalizedStart = normalizeDate(start);
  const normalizedEnd = normalizeDate(end);
  const safeEndpoint = String(endpoint || "").trim() || "listen";

  let dateStart = normalizedStart;
  let dateEnd = normalizedEnd;
  if (dateStart && dateEnd && dateStart > dateEnd) {
    const tmp = dateStart;
    dateStart = dateEnd;
    dateEnd = tmp;
  }

  const projects = await listProjects(apiKey);
  if (projects.length === 0) {
    throw new Error("No Deepgram projects available for this API key.");
  }
  const projectCandidates = [];
  if (requestedProjectId) {
    const match = projects.find((project) => project.project_id === requestedProjectId);
    if (match) {
      projectCandidates.push(match);
    } else {
      projectCandidates.push({ project_id: requestedProjectId, name: "" });
    }
  }
  for (const project of projects) {
    if (!projectCandidates.some((item) => item.project_id === project.project_id)) {
      projectCandidates.push(project);
    }
  }

  // Try strict query first, then progressively relax to avoid 400s from unsupported filters/groupings.
  const queryCandidates = [
    { start: dateStart, end: dateEnd, grouping: requestedGrouping, endpoint: safeEndpoint },
    { start: dateStart, end: dateEnd, grouping: requestedGrouping, endpoint: "" },
    { start: dateStart, end: dateEnd, grouping: "", endpoint: safeEndpoint },
    { start: dateStart, end: dateEnd, grouping: "", endpoint: "" },
    { start: "", end: "", grouping: requestedGrouping, endpoint: safeEndpoint },
    { start: "", end: "", grouping: requestedGrouping, endpoint: "" },
    { start: "", end: "", grouping: "", endpoint: "" }
  ];

  let json = null;
  let resolvedProjectId = "";
  let resolvedProjectName = "";
  let lastError = null;
  for (const project of projectCandidates) {
    for (const candidate of queryCandidates) {
      try {
        json = await requestJson({
          apiKey,
          url: buildUsageBreakdownUrl({
            projectId: project.project_id,
            start: candidate.start,
            end: candidate.end,
            grouping: candidate.grouping,
            endpoint: candidate.endpoint
          }),
          method: "GET",
          timeoutMs: 30000
        });
        resolvedProjectId = project.project_id;
        resolvedProjectName = project.name || "";
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (json) {
      break;
    }
  }

  if (!json) {
    throw lastError || new Error("Unable to load Deepgram usage breakdown.");
  }

  const rows = Array.isArray(json?.results) ? json.results : [];
  const summary = rows.reduce(
    (acc, row) => {
      acc.hours += toNumber(row?.hours);
      acc.total_hours += toNumber(row?.total_hours);
      acc.agent_hours += toNumber(row?.agent_hours);
      acc.tokens_in += toNumber(row?.tokens_in);
      acc.tokens_out += toNumber(row?.tokens_out);
      acc.tts_characters += toNumber(row?.tts_characters);
      acc.requests += toNumber(row?.requests);
      return acc;
    },
    {
      hours: 0,
      total_hours: 0,
      agent_hours: 0,
      tokens_in: 0,
      tokens_out: 0,
      tts_characters: 0,
      requests: 0
    }
  );

  return {
    project_id: resolvedProjectId,
    project_name: resolvedProjectName,
    start: String(json?.start || dateStart || ""),
    end: String(json?.end || dateEnd || ""),
    resolution: json?.resolution || null,
    summary,
    results: rows
  };
}

module.exports = {
  transcribePreRecorded,
  getUsageBreakdown
};
