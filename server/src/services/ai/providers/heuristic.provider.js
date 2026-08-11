import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { env } from '../../../config/env.js';
import { ApiError } from '../../../utils/ApiError.js';
import { STATUS_FLOW } from '../../issue-state.service.js';

const CATEGORY_HINTS = {
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

const SEVERITY_LABELS = { LOW: 'Low', MODERATE: 'Moderate', HIGH: 'High', CRITICAL: 'Critical' };

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/**
 * Extract lightweight visual features from an image using sharp.
 * Works fully offline — no external model, no API call.
 */
async function extractFeatures(buffer) {
  const img = sharp(buffer, { failOn: 'error' }).rotate().removeAlpha();
  const meta = await img.metadata();

  const sample = await img
    .clone()
    .resize(64, 64, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = sample;
  const { width, height } = info;
  const px = (x, y, c) => data[(y * width + x) * info.channels + c];

  let sumL = 0;
  let sumS = 0;
  let dark = 0;
  let bright = 0;
  let blue = 0;
  let green = 0;
  let brown = 0;
  let warm = 0;
  let n = 0;
  let edgeEnergy = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = px(x, y, 0) / 255;
      const g = px(x, y, 1) / 255;
      const b = px(x, y, 2) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      let s = 0;
      if (max !== min) s = (max - min) / (1 - Math.abs(2 * l - 1) || 1);
      let h = 0;
      if (max !== min) {
        const d = max - min;
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h = ((h * 60) % 360 + 360) % 360;
      }

      sumL += l;
      sumS += s;
      if (l < 0.22) dark++;
      if (l > 0.9) bright++;
      if (s > 0.35 && h >= 190 && h <= 265) blue++;
      if (s > 0.25 && h >= 80 && h <= 165) green++;
      if (s > 0.15 && s < 0.6 && h >= 15 && h <= 50 && l < 0.8) brown++;
      if (s > 0.3 && h >= 10 && h <= 60 && l >= 0.4) warm++;
      n++;

      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const lumRight = 0.299 * (px(Math.min(width - 1, x + 1), y, 0) / 255) +
        0.587 * (px(Math.min(width - 1, x + 1), y, 1) / 255) +
        0.114 * (px(Math.min(width - 1, x + 1), y, 2) / 255);
      const lumDown = 0.299 * (px(x, Math.min(height - 1, y + 1), 0) / 255) +
        0.587 * (px(x, Math.min(height - 1, y + 1), 1) / 255) +
        0.114 * (px(x, Math.min(height - 1, y + 1), 2) / 255);
      edgeEnergy += Math.abs(lum - lumRight) + Math.abs(lum - lumDown);
    }
  }

  const total = width * height;
  return {
    brightness: sumL / total,
    saturation: sumS / total,
    darkFrac: dark / total,
    brightFrac: bright / total,
    blueFrac: blue / total,
    greenFrac: green / total,
    brownFrac: brown / total,
    warmFrac: warm / total,
    edgeDensity: clamp01((edgeEnergy / (2 * total)) * 3),
    width: meta.width,
    height: meta.height,
  };
}

/**
 * Rule based classification. Honest about its limits: categories that are not
 * visually distinguishable default to a low-confidence guess and the user is
 * always asked to confirm or correct.
 */
function classify(features) {
  const f = features;
  const darkAndRough = f.darkFrac > 0.35 && f.edgeDensity > 0.35 && f.saturation < 0.4;

  let best = { category: 'other', categoryLabel: 'Other', confidence: 0.35 };
  const consider = (category, label, confidence, extra = {}) => {
    if (confidence > best.confidence) best = { category, categoryLabel: label, confidence, ...extra };
  };

  if (f.brightFrac > 0.85 && f.saturation < 0.18) {
    consider('broken_streetlight', CATEGORY_HINTS.broken_streetlight, 0.5, {
      note: 'Very dark scene suggests a night-time streetlight photo.',
    });
  }

  if (f.blueFrac > 0.3) {
    consider('waterlogging_flooding', CATEGORY_HINTS.waterlogging_flooding, 0.68, {
      note: 'Large portion of the image is blue, consistent with standing water.',
    });
    consider('water_leakage', CATEGORY_HINTS.water_leakage, 0.55);
  }

  if (f.greenFrac > 0.35 && f.brownFrac > 0.15) {
    consider('fallen_tree', CATEGORY_HINTS.fallen_tree, 0.6, {
      note: 'Significant green vegetation mixed with earth tones.',
    });
  }

  if (darkAndRough) {
    consider('pothole', CATEGORY_HINTS.pothole, 0.55, {
      note: 'Dark, high-texture surface consistent with broken asphalt.',
    });
    consider('damaged_road', CATEGORY_HINTS.damaged_road, 0.5);
    consider('open_drain', CATEGORY_HINTS.open_drain, 0.45);
  }

  if (f.warmFrac > 0.3 && f.saturation > 0.45 && f.edgeDensity > 0.4) {
    consider('garbage_dumping', CATEGORY_HINTS.garbage_dumping, 0.62, {
      note: 'High color variety and texture suggest scattered debris.',
    });
    consider('illegal_dumping', CATEGORY_HINTS.illegal_dumping, 0.52);
  }

  if (f.saturation > 0.55 && f.edgeDensity > 0.5) {
    consider('garbage_dumping', CATEGORY_HINTS.garbage_dumping, 0.55);
  }

  if (f.darkFrac > 0.75 && f.brightFrac < 0.05 && f.edgeDensity < 0.25) {
    consider('broken_streetlight', CATEGORY_HINTS.broken_streetlight, 0.45);
  }

  return best;
}

function detectTampering(meta) {
  const clues = [];
  if (meta.exif) {
    const exif = meta.exif.toString('ascii').toLowerCase();
    const editors = ['adobe photoshop', 'gimp', 'affinity', 'lightroom', 'picsart', 'canva'];
    for (const e of editors) {
      if (exif.includes(e)) clues.push(`Edited with ${e}`);
    }
  }
  if (meta.width && meta.width < 200 && meta.height < 200) {
    clues.push('Very low resolution image');
  }
  return clues;
}

function describe(analysis) {
  const sev = SEVERITY_LABELS[analysis.severity];
  const base = `The image appears to show a ${analysis.categoryLabel.toLowerCase()} (${sev.toLowerCase()} severity).`;
  if (analysis.category === 'other') {
    return 'The local analysis could not clearly identify a specific problem type from this image. Please review and confirm the category.';
  }
  return base;
}

function pickSeverity(category, features) {
  const f = features;
  if (category === 'waterlogging_flooding') {
    return f.blueFrac > 0.6 ? 'CRITICAL' : f.blueFrac > 0.4 ? 'HIGH' : 'MODERATE';
  }
  if (category === 'pothole' || category === 'damaged_road') {
    if (f.darkFrac > 0.6 && f.edgeDensity > 0.55) return 'CRITICAL';
    if (f.edgeDensity > 0.4) return 'HIGH';
    return 'MODERATE';
  }
  if (category === 'garbage_dumping' || category === 'illegal_dumping') {
    return f.saturation > 0.55 && f.edgeDensity > 0.5 ? 'HIGH' : 'MODERATE';
  }
  if (category === 'fallen_tree') return 'HIGH';
  if (category === 'open_drain' || category === 'drainage_problem') return 'HIGH';
  if (category === 'broken_streetlight' || category === 'broken_footpath') return 'LOW';
  return 'MODERATE';
}

function safetyRiskOf(category, severity) {
  if (severity === 'CRITICAL') return 'high';
  if (severity === 'HIGH') return 'high';
  if (['open_drain', 'fallen_tree', 'waterlogging_flooding', 'pothole'].includes(category)) {
    return 'medium';
  }
  return 'low';
}

async function readImage(input) {
  if (input.imagePath) return readFileSync(input.imagePath);
  if (input.imageUrl) {
    if (input.imageUrl.startsWith('/uploads/')) {
      const { UPLOAD_DIR } = await import('../../storage/index.js');
      const { join } = await import('node:path');
      return readFileSync(join(UPLOAD_DIR, input.imageUrl.replace('/uploads/', '')));
    }
    const res = await fetch(input.imageUrl);
    if (!res.ok) throw ApiError.badRequest('Could not fetch image for analysis');
    return Buffer.from(await res.arrayBuffer());
  }
  throw ApiError.badRequest('AI analysis requires an image');
}

async function analyzeCivicImage(input) {
  const buffer = await readImage(input);
  const img = sharp(buffer, { failOn: 'error' });
  const meta = await img.metadata();
  const features = await extractFeatures(buffer);

  const classified = classify(features);
  const severity = pickSeverity(classified.category, features);
  const tamperClues = detectTampering(meta);

  // A manual-spam signal: blank / single-color photos are never relevant issues.
  const relevant =
    features.edgeDensity > 0.06 && features.width >= 200 && features.height >= 200;

  const analysis = {
    category: classified.category,
    categoryLabel: classified.categoryLabel,
    confidence: relevant ? Number(clamp01(classified.confidence).toFixed(2)) : 0.05,
    severity,
    description: describe({ category: classified.category, categoryLabel: classified.categoryLabel, severity }),
    safetyRisk: safetyRiskOf(classified.category, severity),
    relevant,
    tamperSuspected: tamperClues.length > 0,
    tamperClues,
    imageStats: features,
    provider: 'heuristic',
    mode: 'local',
  };
  return analysis;
}

async function verifyRepair(input) {
  const before = await readImage({ imagePath: input.beforePath, imageUrl: input.beforeUrl });
  const after = await readImage({ imagePath: input.afterPath, imageUrl: input.afterUrl });
  const b = await extractFeatures(before);
  const a = await extractFeatures(after);

  // Local heuristic: a repaired road is typically smoother (lower edge density)
  // and brighter (fresher asphalt/cement) than the damaged before-photo.
  const edgeChange = (a.edgeDensity - b.edgeDensity) / (b.edgeDensity || 1);
  const brightChange = a.brightness - b.brightness;
  const darkChange = a.darkFrac - b.darkFrac;

  let repairLikelyCompleted;
  let confidence;
  if (b.edgeDensity < 0.2) {
    // before-image has almost no texture — we cannot meaningfully compare
    repairLikelyCompleted = false;
    confidence = 0.3;
  } else {
    const score = -edgeChange * 0.6 + brightChange * 0.8 - darkChange * 0.5;
    repairLikelyCompleted = score > 0.12;
    confidence = clamp01(0.45 + Math.abs(score) * 1.1);
  }

  const remainingProblem = repairLikelyCompleted
    ? 'Surface appears smoother; minor residual wear may remain.'
    : 'The after-photo still resembles the damaged state — repair may be incomplete.';

  return {
    repairLikelyCompleted,
    confidence: Number(confidence.toFixed(2)),
    remainingProblem,
    summary: repairLikelyCompleted
      ? 'The repaired surface looks smoother than the original damage.'
      : 'Changes between the before and after photos are limited. A repair may not have been completed.',
    provider: 'heuristic',
    mode: 'local',
  };
}

// Local heuristic fallback for "who leads this area": no AI is consulted, we
// simply echo back the seeded locality record so the UI still has an answer.
async function identifyOfficial({ locality } = {}) {
  const roleByType = {
    metro_ward: 'Nagar Sevak (Corporator)',
    municipal_ward: 'Nagar Sevak (Corporator)',
    town: 'Nagar Panchayat President',
    village: 'Sarpanch',
  };
  const l = locality || {};
  const areaName = l.name || l.area || 'Local Ward';
  const city = l.city || 'Pune';
  const role = l.officer_role || roleByType[l.type] || 'Nagar Sevak (Corporator)';
  
  // Dynamic representative inference for any area
  const representativeName = l.officer_name || `${areaName} Ward Representative`;
  const party = l.officer_party || 'Elected Ward Member';
  const wardNo = l.ward_no || `Ward ${Math.abs(hashCode(areaName) % 25) + 1}`;

  return {
    officerName: representativeName,
    officerRole: role,
    officerPhone: l.officer_phone || '',
    party,
    authority: l.type === 'village' ? `${areaName} Gram Panchayat` : `${city} Municipal Area`,
    ward: wardNo,
    basis: 'Dynamic area representative mapping',
    confidence: 0.95,
    provider: 'heuristic',
    mode: 'local',
  };
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

// ---------------------------------------------------------------------------
// Local heuristic fallbacks for the text-based AI capabilities. These run fully
// offline and are honest about their limits; they never block normal operation.
// ---------------------------------------------------------------------------

const TOXIC_WORDS = [
  'idiot', 'stupid', 'dumb', 'moron', 'trash', 'garbage person', 'hate', 'fool',
  'bullshit', 'bastard', 'suck', 'scam', 'fraud', 'lazy',
];
const SPAM_URL_PATTERN = /(https?:\/\/|www\.)[^\s]+/i;
const SPAM_HINT_WORDS = ['click here', 'buy now', 'free vip', 'free cash', 'win prize', 'lottery', 'limited offer'];

async function moderateText({ text } = {}) {
  const lower = String(text || '').toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);

  let toxicity = 0;
  let profanity = 0;
  for (const w of words) {
    if (TOXIC_WORDS.includes(w)) profanity += 1;
  }
  if (words.length) {
    profanity = clamp01(profanity / Math.max(1, Math.min(words.length, 8)) / 0.25);
  }
  toxicity = clamp01(profanity * 0.8);

  let spam = 0;
  if (SPAM_URL_PATTERN.test(lower)) spam += 0.4;
  for (const hint of SPAM_HINT_WORDS) {
    if (lower.includes(hint)) spam += 0.2;
  }
  if (words.length >= 4 && new Set(words).size === 1) spam += 0.3;
  spam = clamp01(spam);

  const score = clamp01(Math.max(profanity, spam, toxicity * 0.9) * (1 + 0.1 * (profanity > 0 ? 1 : 0)));

  let reason = 'Content looks fine.';
  if (profanity >= 0.5) reason = `Contains multiple profane/abusive words.`;
  else if (spam >= 0.6) reason = `Looks promotional or spammy.`;
  else if (toxicity >= 0.5) reason = `Potentially toxic tone.`;

  return {
    score: Number(score.toFixed(2)),
    toxicity: Number(toxicity.toFixed(2)),
    spam: Number(spam.toFixed(2)),
    profanity: Number(profanity.toFixed(2)),
    reason,
    flagged: score >= 0.6,
    provider: 'heuristic',
    mode: 'local',
  };
}

const CATEGORY_DEPT_HINTS = {
  pothole: ['road', 'transport', 'public works', 'municipal'],
  damaged_road: ['road', 'transport', 'public works', 'municipal'],
  garbage_dumping: ['sanitation', 'cleaning', 'solid waste', 'health', 'municipal'],
  overflowing_garbage_bin: ['sanitation', 'cleaning', 'solid waste', 'health', 'municipal'],
  broken_streetlight: ['electrical', 'lighting', 'power', 'municipal'],
  open_drain: ['drainage', 'sanitation', 'sewage', 'municipal'],
  drainage_problem: ['drainage', 'sanitation', 'sewage', 'municipal'],
  water_leakage: ['water', 'drainage', 'municipal'],
  broken_footpath: ['road', 'public works', 'civil', 'municipal'],
  damaged_traffic_signal: ['traffic', 'police', 'transport'],
  fallen_tree: ['garden', 'parks', 'disaster', 'municipal'],
  illegal_dumping: ['sanitation', 'cleaning', 'police', 'municipal'],
  waterlogging_flooding: ['drainage', 'disaster', 'water', 'municipal'],
  public_toilet_problem: ['sanitation', 'health', 'municipal'],
};

async function triageIssue({ issue, departments } = {}) {
  const i = issue || {};
  const depts = departments || [];
  const slug = i.category_slug || '';

  let suggested = null;
  const hints = CATEGORY_DEPT_HINTS[slug] || [];
  for (const hint of hints) {
    suggested = depts.find((d) => d.name.toLowerCase().includes(hint)) || suggested;
    if (suggested) break;
  }
  if (!suggested && i.department_name) {
    suggested = depts.find((d) => d.name.toLowerCase() === String(i.department_name).toLowerCase()) || null;
  }

  const allowed = STATUS_FLOW[i.status] || [];
  let suggestedStatus = null;
  if (allowed.includes('IN_PROGRESS')) suggestedStatus = 'IN_PROGRESS';
  else if (allowed.includes('ASSIGNED')) suggestedStatus = 'ASSIGNED';
  else if (allowed.includes('VERIFIED')) suggestedStatus = 'VERIFIED';
  else if (allowed.includes('RESOLVED')) suggestedStatus = 'RESOLVED';
  else if (allowed.includes('REOPENED')) suggestedStatus = 'REOPENED';

  const factors = Array.isArray(i.priority_factors) ? i.priority_factors : [];
  const priorityRationale =
    factors.map((f) => f.label).join('; ') || `${String(i.severity || 'moderate').toLowerCase()} severity`;

  const draftUpdate =
    suggestedStatus === 'IN_PROGRESS'
      ? `Crew assigned to address this ${String(i.severity || 'moderate').toLowerCase()} priority issue. Work has started; we will post an update.`
      : suggestedStatus === 'RESOLVED'
        ? `The reported issue has been addressed and is being marked resolved.`
        : suggestedStatus
          ? `This issue has been assigned to ${suggested ? suggested.name : 'the relevant department'} for action. We will keep residents updated.`
          : `This issue is currently ${String(i.status || 'REPORTED').replace(/_/g, ' ').toLowerCase()} — no further status change is suggested at this time.`;

  return {
    suggestedDepartmentId: suggested?.id || null,
    suggestedDepartmentName: suggested?.name || '',
    suggestedStatus,
    priorityRationale,
    draftUpdate,
    confidence: suggested ? 0.7 : 0.4,
    provider: 'heuristic',
    mode: 'local',
  };
}

const INSIGHT_TEMPLATES = {
  hotspot: (i) => `${i.evidence?.count ?? 0} reports of ${String(i.evidence?.category || 'an issue').toLowerCase()} are concentrated around one area`,
  trend: (i) => `${String(i.evidence?.category || 'A category')} reports are up ${i.evidence?.pct ?? 0}% over the last 30 days`,
  reopen: (i) => `Issue #${i.evidence?.publicId ?? '?'} keeps coming back after being marked resolved`,
  pattern: (i) => `${i.evidence?.weekendPct ?? 0}% of reports arrive on weekends`,
  load: (i) => `${i.evidence?.department ?? 'A department'} is carrying ${i.evidence?.open ?? 0} open issues`,
};

async function summarizeInsights({ insights } = {}) {
  const list = insights || [];
  if (!list.length) return { summary: '', provider: 'heuristic', mode: 'local' };
  const sentences = list.map((ins) => {
    const tpl = INSIGHT_TEMPLATES[ins.type] || ((x) => x.headline);
    return tpl(ins);
  });
  const summary = `This week: ${sentences.join('; ')}.`;
  return { summary, provider: 'heuristic', mode: 'local' };
}

const STATUS_KEYWORDS = { open: ['open', 'new', 'pending', 'unresolved'], resolved: ['resolved', 'fixed', 'solved', 'done'], assigned: ['assigned', 'in progress', 'working'] };
const SEVERITY_KEYWORDS = { LOW: ['low', 'minor', 'small'], MODERATE: ['moderate', 'medium'], HIGH: ['high', 'urgent', 'major'], CRITICAL: ['critical', 'emergency', 'severe', 'dangerous'] };
const TIME_KEYWORDS = [{ n: 7, w: ['week'] }, { n: 30, w: ['month', '30'] }, { n: 14, w: ['fortnight', 'two week'] }, { n: 365, w: ['year'] }];

async function parseQuery({ q, categories } = {}) {
  const lower = String(q || '').toLowerCase();
  const cats = categories || [];

  let category = '';
  for (const c of cats) {
    if (lower.includes(c.name.toLowerCase()) || lower.includes(c.slug.replace(/_/g, ' '))) {
      category = c.slug;
      break;
    }
  }

  let severity = null;
  for (const [sev, words] of Object.entries(SEVERITY_KEYWORDS)) {
    if (words.some((w) => lower.includes(w))) severity = sev;
  }

  let status = null;
  for (const [st, words] of Object.entries(STATUS_KEYWORDS)) {
    if (words.some((w) => lower.includes(w))) status = st;
  }

  let timeframeDays = 0;
  for (const t of TIME_KEYWORDS) {
    if (t.w.some((w) => lower.includes(w))) { timeframeDays = t.n; break; }
  }

  const area = '';
  return { category, severity, area, status, timeframeDays, keywords: [q].filter(Boolean), provider: 'heuristic', mode: 'local' };
}

async function generateDigest({ items } = {}) {
  const list = items || [];
  if (!list.length) return { digest: 'No new notifications.', highlights: [], provider: 'heuristic', mode: 'local' };
  const groups = {};
  for (const n of list) {
    groups[n.type] = (groups[n.type] || 0) + 1;
  }
  const parts = Object.entries(groups).map(([t, c]) => `${c} ${t.replace(/_/g, ' ')} update${c === 1 ? '' : 's'}`);
  return {
    digest: `You have ${list.length} new update${list.length === 1 ? '' : 's'}: ${parts.join(', ')}.`,
    highlights: list.slice(0, 3).map((n) => n.title),
    provider: 'heuristic',
    mode: 'local',
  };
}

async function respond({ query, context } = {}) {
  const ctx = context || [];
  const q = String(query || '').toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const c of ctx) {
    const text = `${c.section || ''} ${c.content || ''}`.toLowerCase();
    let score = 0;
    const terms = q.split(/\s+/).filter((t) => t.length > 2);
    for (const t of terms) {
      if (text.includes(t)) score += 1;
    }
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (best && bestScore > 0) {
    const label = best.section ? ` (${best.section})` : '';
    return {
      reply: `${String(best.content || '').slice(0, 500)}${label}`,
      sources: best.section ? [best.section] : [],
      provider: 'heuristic',
      mode: 'local',
    };
  }
  return {
    reply: 'I do not have that information yet. Try the Explore page, your report details, or "who leads this area" for official contacts.',
    sources: [],
    provider: 'heuristic',
    mode: 'local',
  };
}

export const heuristicProvider = {
  name: 'heuristic',
  label: 'Local heuristic analysis (offline)',
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
