import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { heuristicProvider } from './providers/heuristic.provider.js';
import { openaiProvider } from './providers/openai.provider.js';
import { geminiProvider } from './providers/gemini.provider.js';

const providers = {
  heuristic: heuristicProvider,
  openai: openaiProvider,
  gemini: geminiProvider,
};

function getProvider() {
  const selected = env.aiProvider || 'heuristic';
  const provider = providers[selected];
  if (!provider) {
    logger.warn(`Unknown AI provider "${selected}", falling back to heuristic`);
    return providers.heuristic;
  }
  return provider;
}

/**
 * Run a provider method, falling back to the offline heuristic provider when the
 * configured provider fails (quota, network, key missing). This keeps the app
 * functional and "suggest only" — degraded results are logged, never blocking.
 */
async function callProvider(method, args) {
  const provider = getProvider();
  if (provider.name === 'heuristic' || !heuristicProvider[method]) {
    return provider[method](...args);
  }
  try {
    return await provider[method](...args);
  } catch (err) {
    logger.warn(
      `AI provider ${provider.name}.${method} failed (${err.message || 'error'}) — using heuristic fallback`,
    );
    return heuristicProvider[method](...args);
  }
}

export const aiService = {
  /** The configured provider name (e.g. 'heuristic' | 'openai' | 'gemini') */
  get providerName() {
    return getProvider().name;
  },

  get label() {
    return getProvider().label;
  },

  /**
   * Analyze a civic issue image.
   * @param {{ imagePath?: string, imageUrl?: string, imageId?: string }} input
   * @returns {Promise<import('./types.js').ImageAnalysis>}
   */
  async analyzeCivicImage(input) {
    return callProvider('analyzeCivicImage', [input]);
  },

  /**
   * Compare a before and after photo for a repair verification.
   * @param {{ beforePath?: string, afterPath?: string }} input
   * @returns {Promise<import('./types.js').RepairVerification>}
   */
  async verifyRepair(input) {
    return callProvider('verifyRepair', [input]);
  },

  /**
   * Compute a perceptual hash for an image file (used for duplicate detection).
   */
  async perceptualHash(imagePath) {
    return getProvider().perceptualHash ? getProvider().perceptualHash(imagePath) : null;
  },

  /**
   * Identify the elected official / representative who leads a locality.
   * @param {{ locality: object }} input
   * @returns {Promise<import('./types.js').OfficialLookup>}
   */
  async identifyOfficial(input) {
    return callProvider('identifyOfficial', [input]);
  },

  /**
   * Score text for toxicity / spam / abuse (moderation triage).
   * @param {{ text: string, context?: string }} input
   * @returns {Promise<import('./types.js').ModerationScore>}
   */
  async moderateText(input) {
    return callProvider('moderateText', [input]);
  },

  /**
   * Suggest department, status, and a draft update for an officer.
   * @param {{ issue: object, departments: object[] }} input
   * @returns {Promise<import('./types.js').TriageSuggestion>}
   */
  async triageIssue(input) {
    return callProvider('triageIssue', [input]);
  },

  /**
   * Summarize data-driven civic insights into a natural-language brief.
   * @param {{ insights: object[] }} input
   * @returns {Promise<import('./types.js').InsightSummary>}
   */
  async summarizeInsights(input) {
    return callProvider('summarizeInsights', [input]);
  },

  /**
   * Convert a natural-language search into structured filters.
   * @param {{ q: string, categories?: object[] }} input
   * @returns {Promise<import('./types.js').QueryParse>}
   */
  async parseQuery(input) {
    return callProvider('parseQuery', [input]);
  },

  /**
   * Summarize a user's recent notifications.
   * @param {{ items: object[] }} input
   * @returns {Promise<import('./types.js').NotificationDigest>}
   */
  async generateDigest(input) {
    return callProvider('generateDigest', [input]);
  },

  /**
   * Answer a citizen / officer question using provided context.
   * @param {{ query: string, context?: object[] }} input
   * @returns {Promise<import('./types.js').ChatReply>}
   */
  async respond(input) {
    return callProvider('respond', [input]);
  },
};
