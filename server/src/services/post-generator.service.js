import { env } from '../config/env.js';

/**
 * Deterministic X post builder. No AI, no guesswork.
 *
 * Safety rules (the important part):
 *   - Citizen text is scrubbed of @mentions, URLs, e-mails and phone numbers so
 *     a report can never be turned into spam, doxxing or third-party promotion.
 *   - The ONLY @mention allowed is the representative's admin-verified X handle.
 *   - The ONLY hashtags are the fixed platform ones below.
 *   - The post always fits X's 280-character limit.
 */

export const POST_LIMIT = 280;
export const HASHTAGS = '#CivicEye #Nagarsevak';
const SUMMARY_BUDGET = 200;

const URL_RE = /https?:\/\/\S+/gi;
const MENTION_RE = /@[A-Za-z0-9_]{1,15}\b/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/gi;
// Loose phone matcher: at least 8 digits, may include +, spaces, () and -.
const PHONE_RE = /(?:\+?\d[\d\s()-]{6,}\d)/g;
const HASHTAG_RE = /#[A-Za-z0-9_]+/g;
const EMOJI_OR_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

/** Strip anything a citizen could use to hijack a post's intent. */
export function cleanCitizenText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(URL_RE, '')
    .replace(EMAIL_RE, '')
    .replace(PHONE_RE, '')
    .replace(MENTION_RE, '')
    .replace(HASHTAG_RE, '')
    .replace(EMOJI_OR_CONTROL, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

/** Deterministic one-line summary from the title, falling back to description. */
export function summarizeIssue(issue) {
  const title = cleanCitizenText(issue?.title);
  if (title) return title;
  const desc = cleanCitizenText(issue?.description);
  return desc || 'Civic issue reported';
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

/**
 * Build the X post for an issue.
 *
 * @param {object} params
 * @param {object} params.issue        Full issue row
 * @param {object|null} params.category Category row (name)
 * @param {object|null} params.ward     Ward row (ward_number)
 * @param {object|null} params.representative  Picked representative (primary)
 * @param {string[]} [params.mentions] Admin-verified X handles to @mention
 *        (computed by representative resolution + escalation tag rule). Only
 *        these handles are ever allowed into a post.
 * @param {'report'|'resolution'} [params.postType] Type of post
 * @param {object|null} [params.resolution] Resolution context for resolution posts
 */
export function generateXPost({ issue, category, ward, representative, representatives = [], mentions = [], postType = 'report', resolution = null }) {
  const mentionUsernames = [...new Set(
    (mentions || [])
      .map((m) => (m || '').trim().replace(/^@/, ''))
      .filter(Boolean),
  )];
  const mention =
    postType === 'report' && mentionUsernames.length
      ? `${mentionUsernames.map((u) => `@${u}`).join(' ')} `
      : '';
  const categoryName = category?.name || '';
  const areaParts = [issue.area, issue.city].filter(Boolean);
  const areaLine = [...new Set(areaParts)].join(', ');
  const wardLabel = ward?.ward_number ? ward.ward_number.replace(/^ward\s*/i, '') : '';
  const wardLine = wardLabel ? ` Ward ${wardLabel}.` : '.';
  const issueUrl = `${env.clientUrl}/issue/${issue.public_id}`;

  let core;
  if (postType === 'resolution') {
    const summary = truncate(summarizeIssue(issue), SUMMARY_BUDGET);
    const by = resolution?.updatedBy
      ? ` ${truncate(cleanCitizenText(resolution.updatedBy), 60)}.`
      : '';
    core = `${summary}${by} The issue is resolved.`;
  } else {
    const summary = truncate(summarizeIssue(issue), SUMMARY_BUDGET);
    core = `${summary}.${wardLine} Reported via CivicEye.`;
  }

  // Compose: mention + core + location + id + url + hashtags
  let text = `${mention}${core} ${areaLine}. Issue #${issue.public_id}. ${issueUrl} ${HASHTAGS}`.trim();

  // If the category makes sense to include and we still have room, insert it.
  if (categoryName) {
    const withCategory = `${mention}${categoryName}: ${core} ${areaLine}. Issue #${issue.public_id}. ${issueUrl} ${HASHTAGS}`.trim();
    if (withCategory.length <= POST_LIMIT) text = withCategory;
  }

  if (text.length > POST_LIMIT) {
    // Tighten by shrinking the summary to fit. The fixed parts are non-negotiable.
    const fixed = `${mention}${areaLine}. Issue #${issue.public_id}. ${issueUrl} ${HASHTAGS}`.trim();
    const remainder = POST_LIMIT - fixed.length - 2; // 2 for separator spacing
    const summary = truncate(summarizeIssue(issue), Math.max(10, remainder));
    const prefix = categoryName ? `${categoryName}: ` : '';
    text = `${mention}${prefix}${summary}. ${fixed}`.trim();
    if (text.length > POST_LIMIT) {
      // Extremely defensive: hard-slice and clean up the tail.
      text = truncate(text, POST_LIMIT);
    }
  }

  return {
    text,
    charCount: text.length,
    fits: text.length <= POST_LIMIT,
    mentions: mentionUsernames,
    hashtags: HASHTAGS,
    postType,
  };
}

/** The x.com compose URL with the post prefilled (manual share mode). */
export function buildXShareUrl(text) {
  const params = new URLSearchParams({ text });
  return `https://x.com/intent/tweet?${params.toString()}`;
}
