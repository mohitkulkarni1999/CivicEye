import { env } from '../../../config/env.js';
import { ApiError } from '../../../utils/ApiError.js';
import { logger } from '../../../utils/logger.js';

const SYSTEM_ANALYZE = `You are CivicEye's civic issue image analyst. Analyze the attached photograph of a real-world civic problem.
Return STRICT JSON only, no markdown, with exactly this shape:
{
  "category": one of ["pothole","damaged_road","garbage_dumping","overflowing_garbage_bin","broken_streetlight","open_drain","drainage_problem","water_leakage","broken_footpath","damaged_traffic_signal","fallen_tree","illegal_dumping","waterlogging_flooding","public_toilet_problem","other"],
  "confidence": 0.0 to 1.0,
  "severity": "LOW" | "MODERATE" | "HIGH" | "CRITICAL",
  "description": "one short sentence describing what is visible",
  "safetyRisk": "low" | "medium" | "high",
  "relevant": true or false,
  "tamperSuspected": true or false
}`;

const SYSTEM_VERIFY = `You are CivicEye's repair verification analyst. You are given a BEFORE photo and an AFTER photo of a civic issue.
Return STRICT JSON only, no markdown, exactly this shape:
{
  "repairLikelyCompleted": true or false,
  "confidence": 0.0 to 1.0,
  "remainingProblem": "short note on what, if anything, still looks damaged",
  "summary": "one short sentence"
}`;

const SYSTEM_MODERATE = `You are CivicEye's community moderator. Review the given civic-app text for inappropriate content.
Return STRICT JSON only, no markdown, exactly this shape:
{
  "score": 0.0 to 1.0,
  "toxicity": 0.0 to 1.0,
  "spam": 0.0 to 1.0,
  "profanity": 0.0 to 1.0,
  "reason": "one short reason"
}
Higher score means the content is more likely to need moderator attention.`;

const SYSTEM_TRIAGE = `You are CivicEye's officer triage assistant. Given a civic issue and the available departments, recommend the best routing and a draft public update.
Return STRICT JSON only, no markdown, exactly this shape:
{
  "suggestedDepartment": "exact department name from the provided list, or empty string",
  "suggestedStatus": "VERIFIED | ASSIGNED | IN_PROGRESS",
  "priorityRationale": "one short sentence",
  "draftUpdate": "one short draft official update for the public timeline",
  "confidence": 0.0 to 1.0
}`;

const SYSTEM_SUMMARY = `You are CivicEye's city data summarizer. Convert the list of data-derived civic insights into a short natural-language brief for citizens.
Rules: use ONLY the facts in the insights; never invent numbers.
Return STRICT JSON only, no markdown, exactly this shape:
{
  "summary": "2-4 sentence city brief"
}`;

const SYSTEM_QUERY = `You are CivicEye's search assistant. Convert a citizen's natural language search into structured civic filters.
Pick the category ONLY from the provided list of slugs; leave empty if none match.
Return STRICT JSON only, no markdown, exactly this shape:
{
  "category": "matching category slug or empty string",
  "severity": "LOW | MODERATE | HIGH | CRITICAL or empty string",
  "area": "area name if mentioned, else empty string",
  "status": "open | resolved | assigned or empty string",
  "timeframeDays": 0 to 365, or 0 if not mentioned,
  "keywords": ["search keywords as an array"]
}`;

const SYSTEM_DIGEST = `You are CivicEye's notification summarizer. Turn the user's recent notifications into a short digest.
Return STRICT JSON only, no markdown, exactly this shape:
{
  "digest": "2-5 sentence digest summarizing what changed",
  "highlights": ["1-3 short headline items"]
}`;

const SYSTEM_CHAT = `You are CivicEye's civic assistant. Answer ONLY from the provided context (real issue data, FAQ, and app facts).
If the answer is not in the context, say you don't have that information and suggest a way to find it. Never invent facts, numbers, or report statuses.
Return STRICT JSON only, no markdown, exactly this shape:
{
  "reply": "your answer",
  "sources": ["optional short source labels"]
}`;

const SYSTEM_OFFICIAL = `You are CivicEye's "who leads this area" assistant. Given a locality in India (Pune region), identify the elected representative / official responsible for that area, based on the type of local government:
- metro_ward (Municipal Corporation, e.g. Pune Municipal Corporation) -> Nagar Sevak / Corporator of that ward
- municipal_ward (Municipal Council, e.g. Pimpri-Chinchwad) -> Nagar Sevak / Corporator of that ward
- town (Nagar Panchayat) -> Chairperson / President of the Nagar Panchayat
- village (Gram Panchayat) -> Sarpanch of the Gram Panchayat
Return STRICT JSON only, no markdown, exactly this shape:
{
  "officerName": "full name",
  "officerRole": "official designation, e.g. Nagar Sevak (Corporator), Ward 9",
  "officerPhone": "public contact number if reliably known, else empty string",
  "party": "political party name if known, else empty string",
  "authority": "governing body name, e.g. Pune Municipal Corporation",
  "ward": "ward / GP name",
  "basis": "one short sentence explaining the basis (e.g. municipal ward map / GP boundary)",
  "confidence": 0.0 to 1.0
}`;

const CATEGORY_LABELS = {
  pothole: 'Pothole',
  damaged_road: 'Damaged Road',
  garbage_dumping: 'Garbage Dumping',
  overflowing_garbage_bin: 'Overflowing Garbage Bin',
  broken_streetlight: 'Broken Streetlight',
  open_drain: 'Open Drain',
  drainage_problem: 'Drainage Problem',
  water_leakage: 'Water Leakage',
  broken_footpath: 'Broken Footpath',
  damaged_traffic_signal: 'Damaged Traffic Signal',
  fallen_tree: 'Fallen Tree',
  illegal_dumping: 'Illegal Dumping',
  waterlogging_flooding: 'Waterlogging/Flooding',
  public_toilet_problem: 'Public Toilet Problem',
  other: 'Other',
};

function dataUrl(buf) {
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

function parseJson(text) {
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('Provider returned invalid JSON');
  }
}

async function callText(system, userText, { maxTokens = 500 } = {}) {
  if (!env.openaiApiKey) {
    throw ApiError.internal('OpenAI provider selected but OPENAI_API_KEY is not set');
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: env.openaiModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userText },
      ],
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    logger.error('OpenAI text error', res.status, text.slice(0, 400));
    throw ApiError.internal('AI provider request failed');
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '';
  return parseJson(raw);
}

async function analyzeCivicImage({ imagePath, imageUrl, imageBuffer }) {
  if (!env.openaiApiKey) {
    throw ApiError.internal('OpenAI provider selected but OPENAI_API_KEY is not set');
  }
  let buffer = imageBuffer;
  if (!buffer) {
    if (imagePath) {
      const { readFileSync } = await import('node:fs');
      buffer = readFileSync(imagePath);
    } else if (imageUrl?.startsWith('/uploads/')) {
      const { join } = await import('node:path');
      const { UPLOAD_DIR } = await import('../../storage/index.js');
      const { readFileSync } = await import('node:fs');
      buffer = readFileSync(join(UPLOAD_DIR, imageUrl.replace('/uploads/', '')));
    }
  }
  if (!buffer) throw ApiError.badRequest('No image supplied to AI analysis');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: env.openaiModel,
      messages: [
        { role: 'system', content: SYSTEM_ANALYZE },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this photograph.' },
            { type: 'image_url', image_url: { url: dataUrl(buffer) } },
          ],
        },
      ],
      max_tokens: 600,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error('OpenAI analyze error', res.status, text.slice(0, 400));
    throw ApiError.internal('AI provider request failed');
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '';
  const parsed = parseJson(raw);

  const category = CATEGORY_LABELS[parsed.category] ? parsed.category : 'other';
  return {
    category,
    categoryLabel: CATEGORY_LABELS[category],
    confidence: clampNum(parsed.confidence),
    severity: normalizeSeverity(parsed.severity),
    description: String(parsed.description || ''),
    safetyRisk: normalizeRisk(parsed.safetyRisk),
    relevant: Boolean(parsed.relevant),
    tamperSuspected: Boolean(parsed.tamperSuspected),
    provider: 'openai',
    mode: 'vision',
  };
}

async function verifyRepair(input) {
  if (!env.openaiApiKey) {
    throw ApiError.internal('OpenAI provider selected but OPENAI_API_KEY is not set');
  }
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { UPLOAD_DIR } = await import('../../storage/index.js');
  const readImg = (p, u) =>
    u?.startsWith('/uploads/')
      ? readFileSync(join(UPLOAD_DIR, u.replace('/uploads/', '')))
      : p
        ? readFileSync(p)
        : null;

  const before = readImg(input.beforePath, input.beforeUrl);
  const after = readImg(input.afterPath, input.afterUrl);
  if (!before || !after) throw ApiError.badRequest('Both before and after images are required');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: env.openaiModel,
      messages: [
        { role: 'system', content: SYSTEM_VERIFY },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Compare these photos. BEFORE first, AFTER second.' },
            { type: 'image_url', image_url: { url: dataUrl(before) } },
            { type: 'image_url', image_url: { url: dataUrl(after) } },
          ],
        },
      ],
      max_tokens: 500,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error('OpenAI verify error', res.status, text.slice(0, 400));
    throw ApiError.internal('AI provider request failed');
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '';
  const parsed = parseJson(raw);

  return {
    repairLikelyCompleted: Boolean(parsed.repairLikelyCompleted),
    confidence: clampNum(parsed.confidence),
    remainingProblem: String(parsed.remainingProblem || ''),
    summary: String(parsed.summary || ''),
    provider: 'openai',
    mode: 'vision',
  };
}

async function identifyOfficial(input) {
  if (!env.openaiApiKey) {
    throw ApiError.internal('OpenAI provider selected but OPENAI_API_KEY is not set');
  }

  const locality = input.locality || {};
  const userText = [
    `Locality: ${locality.name || '?'}`,
    `Type: ${locality.type || 'metro_ward'}`,
    locality.ward_no ? `Ward / GP: ${locality.ward_no}` : null,
    `City: ${locality.city || 'Pune'}`,
    `State: Maharashtra, India`,
    `Approximate location: ${locality.lat?.toFixed?.(4) ?? ''}, ${locality.lng?.toFixed?.(4) ?? ''}`,
  ]
    .filter(Boolean)
    .join('\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: env.openaiModel,
      messages: [
        { role: 'system', content: SYSTEM_OFFICIAL },
        { role: 'user', content: `Who leads this area?\n\n${userText}` },
      ],
      max_tokens: 300,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error('OpenAI official lookup error', res.status, text.slice(0, 400));
    throw ApiError.internal('AI provider request failed');
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '';
  const parsed = parseJson(raw);

  return {
    officerName: String(parsed.officerName || '').trim(),
    officerRole: String(parsed.officerRole || '').trim(),
    officerPhone: String(parsed.officerPhone || '').trim(),
    party: String(parsed.party || '').trim(),
    authority: String(parsed.authority || '').trim(),
    ward: String(parsed.ward || '').trim(),
    basis: String(parsed.basis || '').trim(),
    confidence: clampNum(parsed.confidence),
    provider: 'openai',
    mode: 'text',
  };
}

async function moderateText({ text, context }) {
  const parsed = await callText(
    SYSTEM_MODERATE,
    `Context: ${context || 'issue comment'}\n\nContent:\n"""\n${String(text || '').slice(0, 2000)}\n"""`,
    { maxTokens: 300 },
  );
  const score = clampNum(parsed.score);
  return {
    score,
    toxicity: clampNum(parsed.toxicity),
    spam: clampNum(parsed.spam),
    profanity: clampNum(parsed.profanity),
    reason: String(parsed.reason || ''),
    flagged: score >= 0.6,
    provider: 'openai',
    mode: 'text',
  };
}

async function triageIssue({ issue, departments }) {
  const deptNames = (departments || []).map((d) => d.name).join(', ') || 'none listed';
  const userText = [
    `Title: ${issue.title || ''}`,
    `Category: ${issue.category_name || issue.category_slug || ''}`,
    `Description: ${String(issue.description || '').slice(0, 500)}`,
    `Severity: ${issue.severity || ''}`,
    `Area: ${issue.area || ''}`,
    `Status: ${issue.status || ''}`,
    `Priority score: ${issue.priority_score ?? ''}`,
    `Priority factors: ${JSON.stringify(issue.priority_factors || [])}`,
    `Available departments: ${deptNames}`,
  ].join('\n');
  const parsed = await callText(SYSTEM_TRIAGE, userText, { maxTokens: 400 });
  const suggestedName = String(parsed.suggestedDepartment || '').trim();
  const suggested = (departments || []).find(
    (d) => d.name.toLowerCase() === suggestedName.toLowerCase(),
  );
  return {
    suggestedDepartmentId: suggested?.id || null,
    suggestedDepartmentName: suggestedName,
    suggestedStatus: ['VERIFIED', 'ASSIGNED', 'IN_PROGRESS'].includes(parsed.suggestedStatus)
      ? parsed.suggestedStatus
      : null,
    priorityRationale: String(parsed.priorityRationale || '').trim(),
    draftUpdate: String(parsed.draftUpdate || '').trim(),
    confidence: clampNum(parsed.confidence),
    provider: 'openai',
    mode: 'text',
  };
}

async function summarizeInsights({ insights }) {
  const items = (insights || [])
    .map(
      (ins, i) =>
        `${i + 1}. ${ins.headline} — ${ins.detail} (evidence: ${JSON.stringify(ins.evidence || {})})`,
    )
    .join('\n');
  const parsed = await callText(SYSTEM_SUMMARY, `City insights:\n${items}`, { maxTokens: 400 });
  return {
    summary: String(parsed.summary || '').trim(),
    provider: 'openai',
    mode: 'text',
  };
}

async function parseQuery({ q, categories }) {
  const slugList = (categories || []).map((c) => `${c.name} -> ${c.slug}`).join(', ') || 'none';
  const parsed = await callText(
    SYSTEM_QUERY,
    `Available categories:\n${slugList}\n\nSearch: "${String(q || '').slice(0, 300)}"`,
    { maxTokens: 300 },
  );
  return {
    category: String(parsed.category || '').trim(),
    severity: ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'].includes(parsed.severity) ? parsed.severity : null,
    area: String(parsed.area || '').trim(),
    status: ['open', 'resolved', 'assigned'].includes(parsed.status) ? parsed.status : null,
    timeframeDays: Math.max(0, Math.min(365, Number(parsed.timeframeDays) || 0)),
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).filter(Boolean) : [],
    provider: 'openai',
    mode: 'text',
  };
}

async function generateDigest({ items }) {
  const lines = (items || [])
    .map((n) => `- [${n.type}] ${n.title}: ${n.body}`)
    .join('\n');
  const parsed = await callText(SYSTEM_DIGEST, `Recent notifications:\n${lines}`, { maxTokens: 400 });
  return {
    digest: String(parsed.digest || '').trim(),
    highlights: Array.isArray(parsed.highlights) ? parsed.highlights.map(String).filter(Boolean) : [],
    provider: 'openai',
    mode: 'text',
  };
}

async function respond({ query, context }) {
  const ctx = (context || [])
    .map((c) => (c.section ? `## ${c.section}\n${c.content}` : c.content))
    .join('\n\n');
  const parsed = await callText(
    SYSTEM_CHAT,
    `Context:\n${String(ctx).slice(0, 4000)}\n\nQuestion: ${String(query || '').slice(0, 500)}`,
    { maxTokens: 600 },
  );
  return {
    reply: String(parsed.reply || '').trim(),
    sources: Array.isArray(parsed.sources) ? parsed.sources.map(String).filter(Boolean) : [],
    provider: 'openai',
    mode: 'text',
  };
}

const clampNum = (v) => Math.max(0, Math.min(1, Number(v) || 0));
const normalizeSeverity = (v) =>
  ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'].includes(v) ? v : 'MODERATE';
const normalizeRisk = (v) => (['low', 'medium', 'high'].includes(v) ? v : 'low');

export const openaiProvider = {
  name: 'openai',
  label: 'OpenAI vision model',
  analyzeCivicImage,
  verifyRepair,
  identifyOfficial,
  moderateText,
  triageIssue,
  summarizeInsights,
  parseQuery,
  generateDigest,
  respond,
};
