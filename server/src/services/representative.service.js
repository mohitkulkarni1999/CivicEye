import { pool } from '../config/db.js';
import { logAudit } from './audit.service.js';

/**
 * Elected-representative resolution.
 *
 * Deterministic, database-backed, NEVER AI-guessed:
 *   point (lat,lng) -> localities within radius (sorted by distance)
 *   -> best locality -> ward (boundary_locality_id, else city + ward_no)
 *   -> representative (is_current only)
 *
 * Confidence gating:
 *   - WARD_AMBIGUOUS   — two different wards are within the ambiguity margin,
 *                        so we refuse to guess.
 *   - WARD_NOT_MAPPED  — locality found but no ward registry row yet.
 *   - NO_REPRESENTATIVE — ward exists but has no representative assigned.
 *   - REPRESENTATIVE_INACTIVE — representative exists but is_current = false.
 *   - X_NOT_VERIFIED   — representative mapped but their X account has not been
 *                        verified by an admin, so no escalation is allowed.
 */

const AMBIGUITY_MARGIN_M = 150;

export const RESOLUTION_REASONS = Object.freeze([
  'OK',
  'WARD_NOT_FOUND',
  'WARD_NOT_MAPPED',
  'WARD_AMBIGUOUS',
  'NO_REPRESENTATIVE',
  'REPRESENTATIVE_INACTIVE',
  'X_NOT_VERIFIED',
]);

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

function confidenceForDistance(distance, radius) {
  const ratio = distance / Math.max(1, radius);
  if (ratio < 0.5) return 'high';
  if (ratio < 0.9) return 'medium';
  return 'low';
}

/**
 * Resolve the current elected representative for a point.
 * Never throws — returns a structured result so callers can degrade gracefully.
 */
export async function resolveRepresentativeForPoint(lat, lng) {
  const base = { lat, lng, matched: false, canEscalate: false, locality: null, ward: null, representative: null };

  const candidates = await findCandidates(lat, lng);
  if (!candidates.length) {
    return { ...base, reason: 'WARD_NOT_FOUND' };
  }

  const best = candidates[0];
  const ward = await getWardByLocality(best);
  if (!ward) {
    return {
      ...base,
      reason: 'WARD_NOT_MAPPED',
      locality: pickLocality(best),
    };
  }

  // Ambiguity guard: if a *different* active ward is within the margin, refuse.
  for (const cand of candidates.slice(1)) {
    if (cand.distance - best.distance <= AMBIGUITY_MARGIN_M) {
      const otherWard = await getWardByLocality(cand);
      if (otherWard && otherWard.id !== ward.id) {
        return {
          ...base,
          reason: 'WARD_AMBIGUOUS',
          confidence: 'low',
          locality: pickLocality(best),
        };
      }
    } else {
      break;
    }
  }

  const representative = ward.representative_id
    ? await getRepresentativeById(ward.representative_id)
    : null;
  if (!representative) {
    return {
      ...base,
      reason: 'NO_REPRESENTATIVE',
      confidence: confidenceForDistance(best.distance, best.radius_m),
      locality: pickLocality(best),
      ward: pickWard(ward),
    };
  }
  if (!representative.is_current) {
    return {
      ...base,
      reason: 'REPRESENTATIVE_INACTIVE',
      confidence: confidenceForDistance(best.distance, best.radius_m),
      locality: pickLocality(best),
      ward: pickWard(ward),
    };
  }

  const xVerified =
    representative.x_verified_by_admin && !!representative.official_x_username.trim();

  return {
    ...base,
    matched: true,
    canEscalate: xVerified,
    reason: xVerified ? 'OK' : 'X_NOT_VERIFIED',
    confidence: confidenceForDistance(best.distance, best.radius_m),
    locality: pickLocality(best),
    ward: pickWard(ward),
    representative: pickRepresentative(representative),
  };
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
    distance_m: l.distance,
  };
}

function pickWard(w) {
  if (!w) return null;
  return { id: w.id, city: w.city, ward_number: w.ward_number, ward_name: w.ward_name };
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
// Admin CRUD (used by admin.controller)
// ---------------------------------------------------------------------------

export async function listRepresentatives({ includeInactive = false } = {}) {
  const { rows } = await pool.query(
    `SELECT r.*, w.id AS ward_id, w.city AS ward_city, w.ward_number, w.ward_name
       FROM representatives r
       LEFT JOIN wards w ON w.representative_id = r.id
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
       active_from, active_until, is_current, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
       last_verified_at = CASE WHEN $7 AND x_verified_by_admin = false THEN now()
                               WHEN NOT $7 THEN NULL ELSE last_verified_at END
     WHERE id = $14
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
    `SELECT w.*, l.name AS locality_name, l.area AS locality_area, l.type AS locality_type,
            r.name AS representative_name, r.official_x_username AS representative_x_username,
            r.x_verified_by_admin AS representative_x_verified, r.is_current AS representative_is_current
       FROM wards w
       LEFT JOIN locations l ON l.id = w.boundary_locality_id
       LEFT JOIN representatives r ON r.id = w.representative_id
      ORDER BY w.city ASC, w.ward_number ASC`,
  );
  return rows;
}

export async function createWard(fields, { actorId = null } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO wards (city, ward_number, ward_name, boundary_locality_id, representative_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (city, ward_number) DO UPDATE SET
       ward_name = EXCLUDED.ward_name,
       boundary_locality_id = EXCLUDED.boundary_locality_id,
       representative_id = EXCLUDED.representative_id,
       is_active = true
     RETURNING *`,
    [
      (fields.city || '').trim(),
      (fields.ward_number || '').trim(),
      (fields.ward_name || '').trim(),
      fields.boundaryLocalityId || null,
      fields.representativeId || null,
    ],
  );
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
       boundary_locality_id = $4, representative_id = $5, is_active = $6
     WHERE id = $7
     RETURNING *`,
    [
      (fields.city ?? current.city).trim(),
      (fields.ward_number ?? current.ward_number).trim(),
      (fields.ward_name ?? current.ward_name).trim(),
      fields.boundaryLocalityId !== undefined ? fields.boundaryLocalityId : current.boundary_locality_id,
      fields.representativeId !== undefined ? fields.representativeId : current.representative_id,
      fields.isActive !== undefined ? !!fields.isActive : current.is_active,
      id,
    ],
  );
  await logAudit({
    actorId,
    action: 'ward.updated',
    entityType: 'ward',
    entityId: id,
    details: { city: rows[0].city, ward_number: rows[0].ward_number },
  });
  return rows[0];
}
