import { pool } from '../config/db.js';
import { aiService } from './ai/index.js';
import { logger } from '../utils/logger.js';

export const LOCALITY_TYPE_LABELS = {
  metro_ward: 'Municipal Corporation Ward',
  municipal_ward: 'Municipal Council Ward',
  town: 'Nagar Panchayat',
  village: 'Gram Panchayat (Village)',
};

// Distance in metres between two lat/lng points (haversine)
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Find the locality whose centre is nearest to (lat,lng) and within its radius.
// Reverse-geocode cache rows (slug "@lat,lng") are excluded — they are not real
// administrative localities.
export async function findLocality(lat, lng) {
  const { rows } = await pool.query(
    `SELECT * FROM locations WHERE is_active = true AND slug NOT LIKE '@%'`,
  );
  let best = null;
  for (const loc of rows) {
    const d = distanceMeters(lat, lng, loc.lat, loc.lng);
    if (d <= loc.radius_m && (!best || d < best.distance)) {
      best = { ...loc, distance: Math.round(d) };
    }
  }
  return best;
}

// Fallback: nearest seeded locality regardless of radius, so area/city still
// resolve for points that fall just outside a seeded ward boundary.
export async function findNearestLocality(lat, lng) {
  const { rows } = await pool.query(
    `SELECT * FROM locations WHERE is_active = true AND slug NOT LIKE '@%'`,
  );
  let best = null;
  for (const loc of rows) {
    const d = distanceMeters(lat, lng, loc.lat, loc.lng);
    if (!best || d < best.distance) best = { ...loc, distance: Math.round(d) };
  }
  return best;
}

// Fetch a locality by id (raw row)
export async function getLocalityById(id) {
  if (!id) return null;
  const { rows } = await pool.query('SELECT * FROM locations WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function listLocalities() {
  const { rows } = await pool.query(
    `SELECT id, name, slug, city, area, lat, lng, radius_m, type, ward_no,
            officer_name, officer_role, officer_phone, officer_party, is_active
       FROM locations ORDER BY is_active DESC, name ASC`,
  );
  return rows;
}

// Identify the official who leads a locality.
// Uses the configured AI provider (GPT/Gemini) for accuracy, with a fallback
// to the seeded locality record when a vision provider is unavailable.
// Results are cached back into the locations row + logged to ai_analysis.
export async function identifyLocalityOfficial(locality, { userId = null, force = false } = {}) {
  if (!locality) return null;

  const l = locality;
  let result = null;
  const isRealLookup = aiService.providerName !== 'heuristic';

  if (isRealLookup) {
    try {
      result = await aiService.identifyOfficial({ locality: l });
    } catch (err) {
      logger.warn('Official lookup via AI failed, falling back to seeded record:', err.message);
    }
  }

  if (!result) {
    // Heuristic / failed AI: fall back to whatever is stored on the locality.
    result = {
      officerName: l.officer_name || '',
      officerRole: l.officer_role || '',
      officerPhone: l.officer_phone || '',
      party: l.officer_party || '',
      authority: l.type === 'village' ? `${l.name || ''} Gram Panchayat` : l.city,
      ward: l.ward_no || '',
      basis: 'Seeded locality record (no live AI provider configured)',
      confidence: l.officer_name ? 0.9 : 0.2,
      provider: 'heuristic',
      mode: 'local',
    };
  }

  const officerName = result.officerName || l.officer_name || '';
  const officerRole = result.officerRole || l.officer_role || '';
  const officerPhone = result.officerPhone || l.officer_phone || '';
  const officerParty = result.party || l.officer_party || '';

  const { rows } = await pool.query(
    `UPDATE locations
        SET officer_name = $1, officer_role = $2, officer_phone = $3,
            officer_party = $4,
            ward_no = CASE WHEN $5 <> '' THEN $5 ELSE ward_no END
      WHERE id = $6
      RETURNING *`,
    [officerName, officerRole, officerPhone, officerParty, result.ward || '', l.id],
  );
  const updated = rows[0];

  try {
    await pool.query(
      `INSERT INTO ai_analysis (user_id, kind, provider, model, result, confidence)
       VALUES ($1, 'official_lookup', $2, $3, $4, $5)`,
      [
        userId,
        result.provider,
        isRealLookup ? aiService.providerName : null,
        JSON.stringify({ ...result, locality: { id: l.id, name: l.name, slug: l.slug } }),
        result.confidence ?? 0,
      ],
    );
  } catch (err) {
    logger.warn('Could not record official_lookup analysis:', err.message);
  }

  return {
    ...updated,
    official: {
      officerName: updated.officer_name,
      officerRole: updated.officer_role,
      officerParty: updated.officer_party,
      authority: result.authority || updated.city,
      ward: updated.ward_no || result.ward || '',
      basis: result.basis || '',
      confidence: result.confidence ?? 0,
      provider: result.provider,
      mode: result.mode || (isRealLookup ? 'vision' : 'local'),
    },
    ai: isRealLookup,
  };
}
