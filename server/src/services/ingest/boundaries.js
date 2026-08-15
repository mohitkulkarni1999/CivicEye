/**
 * Best-effort ward polygon fetch from OpenStreetMap (Overpass API).
 *
 * In the OSM India convention, municipal wards are `admin_level=10` and the
 * municipal body itself is `admin_level=8`. Ward relation names/refs usually
 * encode the ward number (e.g. "Ward 32", ref=32).
 *
 * Polygons are applied ONLY to wards that already exist in our registry (matched
 * by ward number) — we never fabricate a ward. Any polygon we cannot attribute
 * to an existing ward is reported as unmatched and ignored, so the locality
 * circle fallback keeps working. OSM is crowdsourced and incomplete; treat this
 * as an optional enrichment, never as a source of truth for winners.
 */
import { pool } from '../../config/db.js';
import { logger } from '../../utils/logger.js';
import { setWardBoundaryFromRings } from '../representative.service.js';

const OVERPASS_ENDPOINT = process.env.OVERPASS_ENDPOINT || 'https://overpass-api.de/api/interpreter';

export function wardNumberFromTags(tags = {}) {
  const ref = Number.parseInt(tags.ref, 10);
  if (Number.isFinite(ref) && ref >= 1 && ref <= 1000) return String(ref);
  const name = tags['name:en'] || tags.name || '';
  const m = String(name).match(/ward\s*(?:no\.?|number)?\s*[:#-]?\s*(\d{1,3})/i);
  if (m) return String(Number.parseInt(m[1], 10));
  const digit = String(name).match(/\b(\d{1,3})\b/);
  if (digit) return String(Number.parseInt(digit[1], 10));
  return null;
}

export async function fetchWardBoundariesFromOverpass({ cityName, corporationCode }) {
  const escaped = String(cityName || '').replace(/[\\"]/g, '\\$&');
  const query = `
    [out:json][timeout:90];
    area["name"="${escaped}"]["admin_level"="8"]->.a;
    (
      rel["boundary"="administrative"]["admin_level"="10"](area.a);
    );
    out geom;`;

  const res = await fetch(OVERPASS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(100_000),
  });
  if (!res.ok) {
    throw new Error(`Overpass request failed: HTTP ${res.status}`);
  }
  const data = await res.json();

  const fetched = new Map(); // wardNumber -> rings[[lat,lng],...]
  for (const el of data.elements || []) {
    if (!Array.isArray(el.geometry) || el.geometry.length < 3) continue;
    const wardNumber = wardNumberFromTags(el.tags);
    if (!wardNumber) continue;
    const ring = el.geometry.map((g) => [Number(g.lat), Number(g.lon)]);
    if (!fetched.has(wardNumber)) fetched.set(wardNumber, []);
    fetched.get(wardNumber).push(ring);
  }

  const { rows } = await pool.query(
    `SELECT w.id, w.ward_number
       FROM wards w
       JOIN corporations c ON c.id = w.corporation_id
      WHERE c.code = $1`,
    [corporationCode],
  );
  const byNumber = new Map(rows.map((w) => [String(w.ward_number), w.id]));

  let applied = 0;
  const unmatched = [];
  const notes = [];
  for (const [wardNumber, rings] of fetched) {
    const wardId = byNumber.get(wardNumber);
    if (!wardId) {
      unmatched.push(wardNumber);
      continue;
    }
    await setWardBoundaryFromRings(wardId, rings);
    applied++;
  }
  if (!applied && fetched.size === 0) notes.push('No OSM ward boundaries found for this city.');
  logger.info({ corporationCode, fetched: fetched.size, applied, unmatched }, '[INGEST] OSM boundaries');
  return { fetched: fetched.size, applied, unmatched, notes };
}
