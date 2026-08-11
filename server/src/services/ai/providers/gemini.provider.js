import { env } from '../../../config/env.js';
import { ApiError } from '../../../utils/ApiError.js';
import { logger } from '../../../utils/logger.js';

const PROMPT_ANALYZE = `You are CivicEye's civic issue image analyst. Analyze the photograph.
Reply with STRICT JSON only (no markdown) of the shape:
{"category":"pothole","confidence":0.9,"severity":"CRITICAL","description":"...","safetyRisk":"high","relevant":true,"tamperSuspected":false}
category must be one of: pothole, damaged_road, garbage_dumping, overflowing_garbage_bin, broken_streetlight, open_drain, drainage_problem, water_leakage, broken_footpath, damaged_traffic_signal, fallen_tree, illegal_dumping, waterlogging_flooding, public_toilet_problem, other.
severity: LOW|MODERATE|HIGH|CRITICAL. safetyRisk: low|medium|high.`;

const PROMPT_VERIFY = `You are CivicEye's repair verification analyst. First image is BEFORE, second is AFTER.
Reply with STRICT JSON only (no markdown) of the shape:
{"repairLikelyCompleted":true,"confidence":0.9,"remainingProblem":"...","summary":"..."}`;

const PROMPT_OFFICIAL = `You are CivicEye's "who leads this area" assistant. Given a locality in India (Pune region), identify the elected representative / official responsible for that area, based on the type of local government:
- metro_ward (Municipal Corporation, e.g. Pune Municipal Corporation) -> Nagar Sevak / Corporator of that ward
- municipal_ward (Municipal Council, e.g. Pimpri-Chinchwad) -> Nagar Sevak / Corporator of that ward
- town (Nagar Panchayat) -> Chairperson / President of the Nagar Panchayat
- village (Gram Panchayat) -> Sarpanch of the Gram Panchayat
Reply with STRICT JSON only (no markdown) of the shape:
{"officerName":"full name","officerRole":"official designation","officerPhone":"public contact if reliably known else empty string","party":"political party name if known else empty string","authority":"governing body","ward":"ward / GP name","basis":"one short sentence","confidence":0.9}`;

const PROMPT_MODERATE = `You are CivicEye's community moderator. Review the civic-app text for inappropriate content.
Reply with STRICT JSON only (no markdown) of the shape:
{"score":0.0,"toxicity":0.0,"spam":0.0,"profanity":0.0,"reason":"short reason"}
Higher score means more likely to need moderator attention.`;

const PROMPT_TRIAGE = `You are CivicEye's officer triage assistant. Given a civic issue and the available departments, recommend the best routing and a draft public update.
Reply with STRICT JSON only (no markdown) of the shape:
{"suggestedDepartment":"exact department name from the provided list or empty string","suggestedStatus":"VERIFIED | ASSIGNED | IN_PROGRESS","priorityRationale":"one short sentence","draftUpdate":"one short draft official update","confidence":0.9}`;

const PROMPT_SUMMARY = `You are CivicEye's city data summarizer. Convert data-derived civic insights into a short natural-language brief for citizens.
Rules: use ONLY the facts in the insights; never invent numbers.
Reply with STRICT JSON only (no markdown) of the shape:
{"summary":"2-4 sentence city brief"}`;

const PROMPT_QUERY = `You are CivicEye's search assistant. Convert a citizen's natural language search into structured civic filters.
Pick the category ONLY from the provided list of slugs; leave empty if none match.
Reply with STRICT JSON only (no markdown) of the shape:
{"category":"matching slug or empty string","severity":"LOW|MODERATE|HIGH|CRITICAL or empty string","area":"area name or empty string","status":"open|resolved|assigned or empty string","timeframeDays":0,"keywords":["keywords"]}`;

const PROMPT_DIGEST = `You are CivicEye's notification summarizer. Turn the user's recent notifications into a short digest.
Reply with STRICT JSON only (no markdown) of the shape:
{"digest":"2-5 sentence digest","highlights":["1-3 short headlines"]}`;

const PROMPT_CHAT = `You are CivicEye's civic assistant. Answer ONLY from the provided context (real issue data, FAQ, and app facts).
If the answer is not in the context, say you don't have that information and suggest a way to find it. Never invent facts, numbers, or report statuses.
Reply with STRICT JSON only (no markdown) of the shape:
{"reply":"your answer","sources":["optional source labels"]}`;

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
  const cleaned = String(text || '').replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Invalid provider response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function readBuffer(input) {
  if (input.imageBuffer) return input.imageBuffer;
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { UPLOAD_DIR } = await import('../../storage/index.js');
  if (input.imagePath) return readFileSync(input.imagePath);
  if (input.imageUrl?.startsWith('/uploads/')) {
    return readFileSync(join(UPLOAD_DIR, input.imageUrl.replace('/uploads/', '')));
  }
  return null;
}

async function callGemini(prompt, parts) {
  if (!env.geminiApiKey) {
    throw ApiError.internal('Gemini provider selected but GEMINI_API_KEY is not set');
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`;
  const contentParts = [{ text: prompt }, ...(parts || []).map((b) => ({ inline_data: { mime_type: 'image/jpeg', data: b.toString('base64') } }))];
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: contentParts }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    logger.error('Gemini error', res.status, text.slice(0, 400));
    throw ApiError.internal('AI provider request failed');
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  return parseJson(text);
}

const clampNum = (v) => Math.max(0, Math.min(1, Number(v) || 0));

async function analyzeCivicImage(input) {
  const buffer = await readBuffer(input);
  if (!buffer) throw ApiError.badRequest('No image supplied to AI analysis');
  const parsed = await callGemini(PROMPT_ANALYZE, [buffer]);
  const category = CATEGORY_LABELS[parsed.category] ? parsed.category : 'other';
  return {
    category,
    categoryLabel: CATEGORY_LABELS[category],
    confidence: clampNum(parsed.confidence),
    severity: ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'].includes(parsed.severity) ? parsed.severity : 'MODERATE',
    description: String(parsed.description || ''),
    safetyRisk: ['low', 'medium', 'high'].includes(parsed.safetyRisk) ? parsed.safetyRisk : 'low',
    relevant: Boolean(parsed.relevant),
    tamperSuspected: Boolean(parsed.tamperSuspected),
    provider: 'gemini',
    mode: 'vision',
  };
}

async function verifyRepair(input) {
  const before = await readBuffer({ ...input, imagePath: input.beforePath, imageUrl: input.beforeUrl });
  const after = await readBuffer({ ...input, imagePath: input.afterPath, imageUrl: input.afterUrl });
  if (!before || !after) throw ApiError.badRequest('Both before and after images are required');
  const parsed = await callGemini(PROMPT_VERIFY, [before, after]);
  return {
    repairLikelyCompleted: Boolean(parsed.repairLikelyCompleted),
    confidence: clampNum(parsed.confidence),
    remainingProblem: String(parsed.remainingProblem || ''),
    summary: String(parsed.summary || ''),
    provider: 'gemini',
    mode: 'vision',
  };
}

async function identifyOfficial(input) {
  const locality = input.locality || {};
  const userText = [
    `Locality: ${locality.name || '?'}`,
    `Type: ${locality.type || 'metro_ward'}`,
    locality.ward_no ? `Ward / GP: ${locality.ward_no}` : null,
    `City: ${locality.city || 'Pune'}`,
    `State: Maharashtra, India`,
  ]
    .filter(Boolean)
    .join('\n');
  const parsed = await callGemini(`${PROMPT_OFFICIAL}\n\nWho leads this area?\n${userText}`);
  return {
    officerName: String(parsed.officerName || '').trim(),
    officerRole: String(parsed.officerRole || '').trim(),
    officerPhone: String(parsed.officerPhone || '').trim(),
    party: String(parsed.party || '').trim(),
    authority: String(parsed.authority || '').trim(),
    ward: String(parsed.ward || '').trim(),
    basis: String(parsed.basis || '').trim(),
    confidence: clampNum(parsed.confidence),
    provider: 'gemini',
    mode: 'text',
  };
}

async function moderateText({ text, context }) {
  const parsed = await callGemini(
    `${PROMPT_MODERATE}\n\nContext: ${context || 'issue comment'}\nContent:\n"""\n${String(text || '').slice(0, 2000)}\n"""`,
  );
  const score = clampNum(parsed.score);
  return {
    score,
    toxicity: clampNum(parsed.toxicity),
    spam: clampNum(parsed.spam),
    profanity: clampNum(parsed.profanity),
    reason: String(parsed.reason || ''),
    flagged: score >= 0.6,
    provider: 'gemini',
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
    `Available departments: ${deptNames}`,
  ].join('\n');
  const parsed = await callGemini(`${PROMPT_TRIAGE}\n\n${userText}`);
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
    provider: 'gemini',
    mode: 'text',
  };
}

async function summarizeInsights({ insights }) {
  const items = (insights || [])
    .map((ins, i) => `${i + 1}. ${ins.headline} — ${ins.detail}`)
    .join('\n');
  const parsed = await callGemini(`${PROMPT_SUMMARY}\n\nCity insights:\n${items}`);
  return {
    summary: String(parsed.summary || '').trim(),
    provider: 'gemini',
    mode: 'text',
  };
}

async function parseQuery({ q, categories }) {
  const slugList = (categories || []).map((c) => `${c.name} -> ${c.slug}`).join(', ') || 'none';
  const parsed = await callGemini(
    `${PROMPT_QUERY}\n\nAvailable categories:\n${slugList}\n\nSearch: "${String(q || '').slice(0, 300)}"`,
  );
  return {
    category: String(parsed.category || '').trim(),
    severity: ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'].includes(parsed.severity) ? parsed.severity : null,
    area: String(parsed.area || '').trim(),
    status: ['open', 'resolved', 'assigned'].includes(parsed.status) ? parsed.status : null,
    timeframeDays: Math.max(0, Math.min(365, Number(parsed.timeframeDays) || 0)),
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).filter(Boolean) : [],
    provider: 'gemini',
    mode: 'text',
  };
}

async function generateDigest({ items }) {
  const lines = (items || []).map((n) => `- [${n.type}] ${n.title}: ${n.body}`).join('\n');
  const parsed = await callGemini(`${PROMPT_DIGEST}\n\nRecent notifications:\n${lines}`);
  return {
    digest: String(parsed.digest || '').trim(),
    highlights: Array.isArray(parsed.highlights) ? parsed.highlights.map(String).filter(Boolean) : [],
    provider: 'gemini',
    mode: 'text',
  };
}

async function respond({ query, context }) {
  const ctx = (context || [])
    .map((c) => (c.section ? `## ${c.section}\n${c.content}` : c.content))
    .join('\n\n');
  const parsed = await callGemini(
    `${PROMPT_CHAT}\n\nContext:\n${String(ctx).slice(0, 4000)}\n\nQuestion: ${String(query || '').slice(0, 500)}`,
  );
  return {
    reply: String(parsed.reply || '').trim(),
    sources: Array.isArray(parsed.sources) ? parsed.sources.map(String).filter(Boolean) : [],
    provider: 'gemini',
    mode: 'text',
  };
}

export const geminiProvider = {
  name: 'gemini',
  label: 'Google Gemini vision model',
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
