import { pool } from '../config/db.js';
import { haversine } from './geo.service.js';

/**
 * Duplicate issue detection.
 * Combines location proximity, category match and image perceptual similarity
 * into an explainable duplicate score.
 */
export class DuplicateDetector {
  static WEIGHTS = { location: 0.4, category: 0.3, image: 0.2, time: 0.1 };

  /**
   * @param {object} input
   * @param {number} input.lat
   * @param {number} input.lng
   * @param {string} [input.categoryId]
   * @param {string[]} [input.perceptualHashes] hex hashes of the uploaded images
   * @returns {Promise<{ matches: Array<object> }>}
   */
  static async check({ lat, lng, categoryId, perceptualHashes = [] }) {
    const { rows } = await pool.query(
      `SELECT i.id, i.public_id, i.title, i.lat, i.lng, i.category_id, i.status,
              i.reported_at, i.is_demo, c.slug AS category_slug, c.name AS category_name,
              (SELECT COUNT(*)::int FROM issue_confirmations x WHERE x.issue_id = i.id) AS confirmations,
              (SELECT url FROM issue_images x WHERE x.issue_id = i.id AND x.is_primary) AS cover_url,
              (SELECT url FROM issue_images x WHERE x.issue_id = i.id AND x.is_primary) AS cover_thumb
         FROM issues i
         JOIN categories c ON c.id = i.category_id
        WHERE i.status NOT IN ('REJECTED')
          AND i.is_hidden = false
          AND haversine(i.lat, i.lng, $1, $2) < 2500
        ORDER BY haversine(i.lat, i.lng, $1, $2) ASC
        LIMIT 30`,
      [lat, lng],
    );

    const matches = [];
    for (const issue of rows) {
      const locDist = haversine(lat, lng, issue.lat, issue.lng);
      const locationSimilarity = Math.max(0, Math.round((1 - locDist / 2500) * 100));

      const categorySimilarity = categoryId
        ? issue.category_id === categoryId ? 100 : 0
        : 50;

      let imageSimilarity = 0;
      if (perceptualHashes.length) {
        const { rows: imgRows } = await pool.query(
          'SELECT perceptual_hash FROM issue_images WHERE issue_id = $1 AND perceptual_hash IS NOT NULL',
          [issue.id],
        );
        const existing = imgRows.map((r) => r.perceptual_hash);
        if (existing.length) {
          const { hammingDistance } = await import('../middleware/upload.js');
          let best = 0;
          for (const h of perceptualHashes) {
            const a = BigInt('0x' + h);
            for (const eh of existing) {
              const b = BigInt('0x' + eh);
              const dist = hammingDistance(a, b);
              best = Math.max(best, Math.round((1 - dist / 64) * 100));
            }
          }
          imageSimilarity = best;
        }
      }

      const ageDays = Math.ceil((new Date() - new Date(issue.reported_at)) / 86400000);
      const timeSimilarity = Math.max(0, Math.round(100 - ageDays * 4));

      const duplicateProbability = Math.round(
        locationSimilarity * DuplicateDetector.WEIGHTS.location +
          categorySimilarity * DuplicateDetector.WEIGHTS.category +
          imageSimilarity * DuplicateDetector.WEIGHTS.image +
          timeSimilarity * DuplicateDetector.WEIGHTS.time,
      );

      matches.push({
        issueId: issue.id,
        publicId: issue.public_id,
        title: issue.title,
        status: issue.status,
        category: issue.category_name,
        categorySlug: issue.category_slug,
        distance: Math.round(locDist),
        confirmations: issue.confirmations,
        coverThumb: issue.cover_thumb || issue.cover_url,
        isDemo: issue.is_demo,
        reportedAt: issue.reported_at,
        similarity: {
          location: locationSimilarity,
          category: categorySimilarity,
          image: imageSimilarity,
          time: timeSimilarity,
          total: duplicateProbability,
        },
      });
    }

    matches.sort((a, b) => b.similarity.total - a.similarity.total);
    return { matches: matches.slice(0, 5) };
  }

  static async recordAnalysis({ userId, kind, result, confidence }) {
    await pool.query(
      `INSERT INTO ai_analysis (user_id, kind, result, provider, confidence)
       VALUES ($1, $2, $3, 'duplicate-detector', $4)`,
      [userId || null, kind, JSON.stringify(result), confidence],
    );
  }
}
