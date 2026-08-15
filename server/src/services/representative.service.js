import { pool } from '../config/db.js';
import { logger } from '../utils/logger.js';
import { logAudit } from './audit.service.js';

/**
 * Elected-representative resolution.
 *
 * Deterministic, database-backed, NEVER AI-guessed. The responsible ward is
 * found with official ward boundary polygons first (point-in-polygon); only if
 * no polygon matches do we fall back to locality circles — always gated by the
 * municipality corporation (PMC vs PCMC) so a representative can never leak
 * across jurisdictions.
 *
 * Resolution reasons:
 *   - OK                     — ward + current representative(s) matched
 *   - WARD_NOT_FOUND         — no boundary and no locality circle covers the point
 *   - WARD_NOT_MAPPED        — locality found but no ward registry row yet
 *   - WARD_AMBIGUOUS         — multiple wards cover the point (refuse to guess)
 *   - CORPORATION_MISMATCH   — the point lies inside wards of different
 *                              corporations (or locality jurisdiction disagrees)
 *   - NO_REPRESENTATIVE      — ward exists but has no representatives assigned
 *   - REPRESENTATIVE_INACTIVE— ward has reps but none are current
 *   - X_NOT_VERIFIED         — reps mapped but no admin-verified X account yet,
 *                              so escalation is not allowed
 */

const AMBIGUITY_MARGIN_M = 150;

export const RESOLUTION_REASONS = Object.freeze([
  'OK',
  'WARD_NOT_FOUND',
  'WARD_NOT_MAPPED',
  'WARD_AMBIGUOUS',
  'CORPORATION_MISMATCH',
  'NO_REPRESENTATIVE',
  'REPRESENTATIVE_INACTIVE',
  'X_NOT_VERIFIED',
]);

export const TAG_RULE_SELECTED = 'TAG_SELECTED_REPRESENTATIVE';
export const TAG_RULE_ALL = 'TAG_ALL_WARD_REPRESENTATIVES';
export const DEFAULT_TAG_RULE = TAG_RULE_SELECTED;

/** Which representatives get @mentioned in an escalation post (admin-configurable). */
export async function getEscalationTagRule() {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'escalation_tag_rule'`,
    );
    return rows[0]?.value === TAG_RULE_ALL ? TAG_RULE_ALL : DEFAULT_TAG_RULE;
  } catch {
    return DEFAULT_TAG_RULE;
  }
}

export async function setEscalationTagRule(value, { actorId = null } = {}) {
  if (![TAG_RULE_ALL, TAG_RULE_SELECTED].includes(value)) {
    throw new Error('Invalid escalation tag rule');
  }
  const { rows } = await pool.query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ('escalation_tag_rule', $1, $2, now())
     ON CONFLICT (key) DO UPDATE SET
       value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING *`,
    [value, actorId],
  );
  await logAudit({
    actorId,
    action: 'settings.escalation_tag_rule_updated',
    entityType: 'app_setting',
    entityId: 'escalation_tag_rule',
    details: { value },
  });
  return rows[0];
}

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

/** All active localities within their radius of (lat,lng), nearest first. */
async function findCandidates(lat, lng) {
  const { rows } = await pool.query(
    `SELECT * FROM locations WHERE is_active = true AND slug NOT LIKE '@%'`,
  );
  const candidates = [];
  for (const loc of rows) {
    const d = distanceMeters(lat, lng, loc.lat, loc.lng);
    if (d <= loc.radius_m) {
      candidates.push({ ...loc, distance: Math.round(d) });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates;
}

/**
 * Wards whose official boundary polygon contains (lat,lng). Polygon matching is
 * the PRIMARY detector; a ward without a corporation assigned is not eligible
 * (a ward must be jurisdiction-gated before it can own representatives).
 */
async function findBoundaryHit(lat, lng) {
  const { rows } = await pool.query(
    `SELECT w.*, c.code AS corporation_code, c.name AS corporation_name
       FROM wards w
       LEFT JOIN corporations c ON c.id = w.corporation_id
      WHERE w.is_active = true
        AND w.corporation_id IS NOT NULL
        AND point_in_ward($1, $2, w.id)`,
    [lat, lng],
  );
  return rows;
}

/** Attach corporation code/name to a raw ward row (when not already joined). */
async function withCorporation(ward) {
  if (!ward) return ward;
  if (ward.corporation_code !== undefined) return ward;
  if (!ward.corporation_id) return { ...ward, corporation_code: '', corporation_name: '' };
  const { rows } = await pool.query('SELECT code, name FROM corporations WHERE id = $1', [
    ward.corporation_id,
  ]);
  return { ...ward, corporation_code: rows[0]?.code || '', corporation_name: rows[0]?.name || '' };
}

export async function getWardByLocality(locality) {
  if (!locality) return null;
  const byBoundary = await pool.query(
    `SELECT * FROM wards WHERE boundary_locality_id = $1 AND is_active = true LIMIT 1`,
    [locality.id],
  );
  if (byBoundary.rows[0]) return byBoundary.rows[0];
  if (locality.ward_no) {
    const byWardNo = await pool.query(
      `SELECT * FROM wards WHERE city = $1 AND ward_number = $2 AND is_active = true LIMIT 1`,
      [locality.city || '', locality.ward_no],
    );
    if (byWardNo.rows[0]) return byWardNo.rows[0];
  }
  return null;
}

export async function getWardById(id) {
  if (!id) return null;
  const { rows } = await pool.query('SELECT * FROM wards WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function getRepresentativeById(id) {
  if (!id) return null;
  const { rows } = await pool.query('SELECT * FROM representatives WHERE id = $1', [id]);
  return rows[0] || null;
}

/** All ward_representatives join rows for a ward (with full rep rows). */
export async function getWardRepresentatives(wardId, { includeInactive = false } = {}) {
  if (!wardId) return [];
  const { rows } = await pool.query(
    `SELECT wr.seat AS seat, wr.is_current AS ward_current, r.*
       FROM ward_representatives wr
       JOIN representatives r ON r.id = wr.representative_id
      WHERE wr.ward_id = $1
      ORDER BY wr.seat = '' ASC, wr.seat ASC, r.name ASC`,
    [wardId],
  );
  return includeInactive ? rows : rows.filter((r) => r.ward_current && r.is_current);
}

export async function listCorporations({ includeInactive = false } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM corporations
      WHERE ($1 = true OR is_active = true)
      ORDER BY code ASC`,
    [includeInactive],
  );
  return rows;
}

function confidenceForDistance(distance, radius) {
  const ratio = distance / Math.max(1, radius);
  if (ratio < 0.5) return 'high';
  if (ratio < 0.9) return 'medium';
  return 'low';
}

function canEscalateRep(r) {
  return !!r.x_verified_by_admin && !!(r.official_x_username || '').trim();
}

function logResolution(lat, lng, result) {
  logger.info('[REP-RESOLUTION]', {
    lat,
    lng,
    reason: result.reason,
    source: result.source,
    confidence: result.confidence,
    corporation: result.corporation?.code || null,
    ward: result.ward ? result.ward.ward_number : null,
    wardName: result.ward ? result.ward.ward_name : null,
    representatives: result.representatives?.map((r) => r.name) || [],
    mentions: result.mentions || [],
  });
  return result;
}

/**
 * Resolve the current elected representative(s) for a point.
 * Never throws — returns a structured result so callers can degrade gracefully.
 */
export async function resolveRepresentativeForPoint(lat, lng) {
  const base = {
    lat,
    lng,
    matched: false,
    canEscalate: false,
    locality: null,
    ward: null,
    corporation: null,
    representatives: [],
    representative: null,
    source: null,
    confidence: 'low',
  };

  // 1) PRIMARY: official ward boundary polygon (point-in-polygon).
  const boundaryHits = await findBoundaryHit(lat, lng);
  let ward = null;
  let source = 'official_boundary';
  let fallbackLocality = null;
  let fallbackDistance = 0;
  let fallbackRadius = 1;

  if (boundaryHits.length === 1) {
    ward = boundaryHits[0];
  } else if (boundaryHits.length > 1) {
    const corps = new Set(boundaryHits.map((w) => w.corporation_id));
    return logResolution(lat, lng, {
      ...base,
      reason: corps.size > 1 ? 'CORPORATION_MISMATCH' : 'WARD_AMBIGUOUS',
      source,
      corporation: corps.size === 1 ? pickCorporation(boundaryHits[0]) : null,
      wards: boundaryHits.map(pickWard),
    });
  }

  // 2) FALLBACK: locality circle within radius (jurisdiction-gated).
  if (!ward) {
    source = 'locality_radius';
    const candidates = await findCandidates(lat, lng);
    if (!candidates.length) {
      return logResolution(lat, lng, { ...base, reason: 'WARD_NOT_FOUND', source: null });
    }
    const best = candidates[0];
    fallbackLocality = pickLocality(best);
    fallbackDistance = best.distance;
    fallbackRadius = best.radius_m;
    ward = await withCorporation(await getWardByLocality(best));

    if (!ward) {
      return logResolution(lat, lng, {
        ...base,
        reason: 'WARD_NOT_MAPPED',
        source,
        locality: fallbackLocality,
        confidence: confidenceForDistance(fallbackDistance, fallbackRadius),
      });
    }

    // Cross-corporation guard: the locality's jurisdiction must agree with the
    // ward's jurisdiction, or we refuse to guess.
    const locCorp = (best.corporation_code || '').trim().toUpperCase();
    if (locCorp && ward.corporation_code && locCorp !== ward.corporation_code) {
      return logResolution(lat, lng, {
        ...base,
        reason: 'CORPORATION_MISMATCH',
        source,
        locality: fallbackLocality,
        ward: pickWard(ward),
        corporation: pickCorporation(ward),
        confidence: 'low',
      });
    }

    // Ambiguity guard: if a *different* active ward is within the margin, refuse.
    for (const cand of candidates.slice(1)) {
      if (cand.distance - best.distance <= AMBIGUITY_MARGIN_M) {
        const otherWard = await getWardByLocality(cand);
        if (otherWard && otherWard.id !== ward.id) {
          return logResolution(lat, lng, {
            ...base,
            reason: 'WARD_AMBIGUOUS',
            source,
            confidence: 'low',
            locality: fallbackLocality,
          });
        }
      } else {
        break;
      }
    }
  }

  const confidence = source === 'official_boundary'
    ? 'high'
    : confidenceForDistance(fallbackDistance, fallbackRadius);
  const wardObj = pickWard(ward);

  // 3) Representatives for the ward (many-to-many; modern wards elect 4 seats).
  const wardCorpId = ward.corporation_id || null;
  const allWardReps = await getWardRepresentatives(ward.id, { includeInactive: true });
  const current = allWardReps.filter(
    (r) =>
      r.ward_current &&
      r.is_current &&
      (!r.corporation_id || !wardCorpId || r.corporation_id === wardCorpId),
  );

  if (!current.length) {
    return logResolution(lat, lng, {
      ...base,
      reason: allWardReps.length ? 'REPRESENTATIVE_INACTIVE' : 'NO_REPRESENTATIVE',
      source,
      confidence,
      locality: fallbackLocality,
      ward: wardObj,
      corporation: pickCorporation(ward),
    });
  }

  const primary = current.find((r) => r.id === ward.representative_id) || current[0];
  const representatives = current.map((r) => ({
    ...pickRepresentative(r),
    seat: r.seat,
    party: r.party,
    ward_id: ward.id,
    canEscalate: canEscalateRep(r),
  }));

  const rule = await getEscalationTagRule();
  const mentionables = current.filter(canEscalateRep);
  const primaryMentionable = mentionables.some((r) => r.id === primary.id);
  const canEscalate = rule === TAG_RULE_ALL ? mentionables.length > 0 : primaryMentionable;
  const mentions =
    rule === TAG_RULE_ALL
      ? mentionables.map((r) => (r.official_x_username || '').trim().replace(/^@/, ''))
      : primaryMentionable
        ? [(primary.official_x_username || '').trim().replace(/^@/, '')]
        : [];

  const result = {
    ...base,
    matched: true,
    canEscalate,
    reason: canEscalate ? 'OK' : 'X_NOT_VERIFIED',
    source,
    confidence,
    locality: fallbackLocality,
    ward: wardObj,
    corporation: pickCorporation(ward),
    representatives,
    representative: {
      ...pickRepresentative(primary),
      seat: primary.seat,
      party: primary.party,
      canEscalate: primaryMentionable,
    },
    mentions,
    tagRule: rule,
  };
  return logResolution(lat, lng, result);
}

function pickLocality(l) {
  if (!l) return null;
  return {
    id: l.id,
    name: l.name,
    city: l.city,
    area: l.area,
    type: l.type,
    ward_no: l.ward_no,
    corporation_code: l.corporation_code || '',
    distance_m: l.distance,
  };
}

export function pickCorporation(c) {
  if (!c) return null;
  return {
    id: c.corporation_id || c.id,
    code: c.corporation_code || c.code || '',
    name: c.corporation_name || c.name || '',
  };
}

function pickWard(w) {
  if (!w) return null;
  return {
    id: w.id,
    city: w.city,
    ward_number: w.ward_number,
    ward_name: w.ward_name,
    number: w.ward_number,
    name: w.ward_name || w.ward_number,
    corporation: w.corporation_id
      ? { id: w.corporation_id, code: w.corporation_code || '', name: w.corporation_name || '' }
      : null,
  };
}

/** Public-safe representative shape (reps carry no secrets, but keep it lean). */
export function pickRepresentative(r) {
  if (!r) return null;
  const username = (r.official_x_username || '').trim().replace(/^@/, '');
  return {
    id: r.id,
    name: r.name,
    designation: r.designation,
    constituency: r.constituency,
    party: r.party,
    seat: r.seat,
    official_x_username: username,
    x_profile_url: r.x_profile_url || (username ? `https://x.com/${username}` : ''),
    x_verified_by_admin: r.x_verified_by_admin,
    data_source: r.data_source,
    source_url: r.source_url,
    is_current: r.is_current,
    active_from: r.active_from,
    active_until: r.active_until,
    last_verified_at: r.last_verified_at,
    notes: r.notes,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Admin CRUD (used by admin routes)
// ---------------------------------------------------------------------------

export async function listRepresentatives({ includeInactive = false } = {}) {
  const { rows } = await pool.query(
    `SELECT r.*, c.code AS corporation_code, c.name AS corporation_name,
            COALESCE(
              (SELECT json_agg(
                        json_build_object('ward_id', w.id, 'city', w.city,
                                          'ward_number', w.ward_number,
                                          'ward_name', w.ward_name,
                                          'seat', wr.seat, 'is_current', wr.is_current)
                      ORDER BY wr.seat = '' ASC, wr.seat ASC)
                 FROM ward_representatives wr JOIN wards w ON w.id = wr.ward_id
                WHERE wr.representative_id = r.id),
              '[]'::json
            ) AS wards
       FROM representatives r
       LEFT JOIN corporations c ON c.id = r.corporation_id
      WHERE ($1 = true OR r.is_current = true)
      ORDER BY r.is_current DESC, r.name ASC`,
    [includeInactive],
  );
  return rows;
}

export async function createRepresentative(fields, { createdBy = null } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO representatives
      (name, designation, constituency, official_x_username, official_x_user_id,
       x_profile_url, x_verified_by_admin, data_source, source_url,
       active_from, active_until, is_current, notes, created_by,
       corporation_id, party, seat)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING *`,
    [
      (fields.name || '').trim(),
      (fields.designation || 'Nagar Sevak (Corporator)').trim(),
      (fields.constituency || '').trim(),
      (fields.official_x_username || '').trim().replace(/^@/, ''),
      (fields.official_x_user_id || '').trim(),
      (fields.x_profile_url || '').trim(),
      !!fields.x_verified_by_admin,
      (fields.data_source || '').trim(),
      (fields.source_url || '').trim(),
      fields.active_from || null,
      fields.active_until || null,
      fields.is_current !== false,
      (fields.notes || '').trim(),
      createdBy,
      fields.corporationId || null,
      (fields.party || '').trim(),
      (fields.seat || '').trim(),
    ],
  );
  await logAudit({
    actorId: createdBy,
    action: 'representative.created',
    entityType: 'representative',
    entityId: rows[0].id,
    details: { name: rows[0].name, official_x_username: rows[0].official_x_username },
  });
  return rows[0];
}

export async function updateRepresentative(id, fields, { actorId = null } = {}) {
  const current = await getRepresentativeById(id);
  if (!current) return null;

  const username = (fields.official_x_username ?? current.official_x_username)
    .trim()
    .replace(/^@/, '');
  const verified = fields.x_verified_by_admin !== undefined
    ? !!fields.x_verified_by_admin
    : current.x_verified_by_admin;

  const { rows } = await pool.query(
    `UPDATE representatives SET
       name = $1, designation = $2, constituency = $3,
       official_x_username = $4, official_x_user_id = $5, x_profile_url = $6,
       x_verified_by_admin = $7, data_source = $8, source_url = $9,
       active_from = $10, active_until = $11, is_current = $12, notes = $13,
       corporation_id = $14, party = $15, seat = $16,
       last_verified_at = CASE WHEN $7 AND x_verified_by_admin = false THEN now()
                               WHEN NOT $7 THEN NULL ELSE last_verified_at END
     WHERE id = $17
     RETURNING *`,
    [
      (fields.name ?? current.name).trim(),
      (fields.designation ?? current.designation).trim(),
      (fields.constituency ?? current.constituency).trim(),
      username,
      (fields.official_x_user_id ?? current.official_x_user_id).trim(),
      (fields.x_profile_url ?? current.x_profile_url).trim(),
      verified,
      (fields.data_source ?? current.data_source).trim(),
      (fields.source_url ?? current.source_url).trim(),
      fields.active_from !== undefined ? fields.active_from : current.active_from,
      fields.active_until !== undefined ? fields.active_until : current.active_until,
      fields.is_current !== undefined ? !!fields.is_current : current.is_current,
      (fields.notes ?? current.notes).trim(),
      fields.corporationId !== undefined ? fields.corporationId : current.corporation_id,
      (fields.party ?? current.party).trim(),
      (fields.seat ?? current.seat).trim(),
      id,
    ],
  );
  await logAudit({
    actorId,
    action: 'representative.updated',
    entityType: 'representative',
    entityId: id,
    details: {
      name: rows[0].name,
      official_x_username: username,
      x_verified_by_admin: verified,
      is_current: rows[0].is_current,
    },
  });
  return rows[0];
}

/** Flip verification status. Sets last_verified_at when verified. */
export async function setRepresentativeVerified(id, verified, { actorId = null } = {}) {
  const { rows } = await pool.query(
    `UPDATE representatives SET
       x_verified_by_admin = $1,
       last_verified_at = CASE WHEN $1 THEN now() ELSE last_verified_at END
     WHERE id = $2
     RETURNING *`,
    [!!verified, id],
  );
  if (rows[0]) {
    await logAudit({
      actorId,
      action: verified ? 'representative.x_verified' : 'representative.x_unverified',
      entityType: 'representative',
      entityId: id,
      details: { name: rows[0].name, official_x_username: rows[0].official_x_username },
    });
  }
  return rows[0] || null;
}

export async function listWards() {
  const { rows } = await pool.query(
    `SELECT w.*, c.code AS corporation_code, c.name AS corporation_name,
            l.name AS locality_name, l.area AS locality_area, l.type AS locality_type,
            r.name AS representative_name, r.official_x_username AS representative_x_username,
            r.x_verified_by_admin AS representative_x_verified, r.is_current AS representative_is_current,
            (SELECT COUNT(*)::int FROM ward_representatives wr
              WHERE wr.ward_id = w.id AND wr.is_current = true) AS representative_count
       FROM wards w
       LEFT JOIN corporations c ON c.id = w.corporation_id
       LEFT JOIN locations l ON l.id = w.boundary_locality_id
       LEFT JOIN representatives r ON r.id = w.representative_id
      ORDER BY w.city ASC, w.ward_number ASC`,
  );
  return rows;
}

export async function createWard(fields, { actorId = null } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO wards (city, ward_number, ward_name, boundary_locality_id, representative_id, corporation_id, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (city, ward_number) DO UPDATE SET
       ward_name = EXCLUDED.ward_name,
       boundary_locality_id = EXCLUDED.boundary_locality_id,
       representative_id = EXCLUDED.representative_id,
       corporation_id = COALESCE(wards.corporation_id, EXCLUDED.corporation_id),
       source = COALESCE(NULLIF(EXCLUDED.source, ''), wards.source),
       is_active = true
     RETURNING *`,
    [
      (fields.city || '').trim(),
      (fields.ward_number || '').trim(),
      (fields.ward_name || '').trim(),
      fields.boundaryLocalityId || null,
      fields.representativeId || null,
      fields.corporationId || null,
      (fields.source || 'seed_approximation').trim(),
    ],
  );
  if (fields.representativeId) {
    await linkRepresentativeToWard(rows[0].id, fields.representativeId);
  }
  if (fields.boundary) {
    await setWardBoundaryFromRings(rows[0].id, fields.boundary);
  }
  await logAudit({
    actorId,
    action: 'ward.upserted',
    entityType: 'ward',
    entityId: rows[0].id,
    details: { city: rows[0].city, ward_number: rows[0].ward_number },
  });
  return rows[0];
}

export async function updateWard(id, fields, { actorId = null } = {}) {
  const current = await getWardById(id);
  if (!current) return null;
  const { rows } = await pool.query(
    `UPDATE wards SET
       city = $1, ward_number = $2, ward_name = $3,
       boundary_locality_id = $4, representative_id = $5, is_active = $6,
       corporation_id = $7, source = $8
     WHERE id = $9
     RETURNING *`,
    [
      (fields.city ?? current.city).trim(),
      (fields.ward_number ?? current.ward_number).trim(),
      (fields.ward_name ?? current.ward_name).trim(),
      fields.boundaryLocalityId !== undefined ? fields.boundaryLocalityId : current.boundary_locality_id,
      fields.representativeId !== undefined ? fields.representativeId : current.representative_id,
      fields.isActive !== undefined ? !!fields.isActive : current.is_active,
      fields.corporationId !== undefined ? fields.corporationId : current.corporation_id,
      (fields.source !== undefined ? fields.source : current.source || 'seed_approximation').trim(),
      id,
    ],
  );
  if (fields.representativeId) {
    await linkRepresentativeToWard(id, fields.representativeId);
  }
  if (fields.boundary) {
    await setWardBoundaryFromRings(id, fields.boundary);
  }
  await logAudit({
    actorId,
    action: 'ward.updated',
    entityType: 'ward',
    entityId: id,
    details: { city: rows[0].city, ward_number: rows[0].ward_number },
  });
  return rows[0];
}

/** Link a representative to a ward (many-to-many) and mark it as the primary. */
export async function linkRepresentativeToWard(wardId, representativeId) {
  if (!wardId || !representativeId) return;
  await pool.query(
    `INSERT INTO ward_representatives (ward_id, representative_id, seat, is_current)
     VALUES ($1, $2, '', true)
     ON CONFLICT (ward_id, representative_id) DO UPDATE SET is_current = true`,
    [wardId, representativeId],
  );
}

/** Replace a ward's boundary with rings of [lat,lng] vertices (outer + holes). */
export async function setWardBoundaryFromRings(wardId, rings) {
  if (!wardId || !Array.isArray(rings) || !rings.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM ward_boundaries WHERE ward_id = $1', [wardId]);
    let seq = 0;
    for (let ringIdx = 0; ringIdx < rings.length; ringIdx++) {
      const ring = rings[ringIdx];
      if (!Array.isArray(ring) || ring.length < 3) continue;
      const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
        ? ring
        : [...ring, ring[0]];
      for (const [lat, lng] of closed) {
        await client.query(
          `INSERT INTO ward_boundaries (ward_id, ring_idx, seq, lat, lng)
           VALUES ($1, $2, $3, $4, $5)`,
          [wardId, ringIdx, seq++, lat, lng],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Accept a GeoJSON Polygon/MultiPolygon boundary and store its rings. */
export async function setWardBoundaryFromGeoJSON(wardId, geojson) {
  if (!geojson || !geojson.type) throw new Error('Invalid boundary GeoJSON');
  const rings = [];
  const pushRings = (type, coordinates) => {
    if (type === 'Polygon') {
      for (const ring of coordinates) rings.push(ring.map(([lng, lat]) => [lat, lng]));
    } else if (type === 'MultiPolygon') {
      for (const poly of coordinates) {
        for (const ring of poly) rings.push(ring.map(([lng, lat]) => [lat, lng]));
      }
    }
  };
  pushRings(geojson.type, geojson.coordinates);
  if (!rings.length) throw new Error('Boundary GeoJSON must be a Polygon or MultiPolygon');
  await setWardBoundaryFromRings(wardId, rings);
}
