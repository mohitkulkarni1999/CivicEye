import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const R = 6371000;

export function haversine(lat1, lng1, lat2, lng2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const distanceInMeters = haversine;

export function bboxToRect(lat, lng, radiusM) {
  const latKm = radiusM / 111320;
  const lngKm = radiusM / (111320 * Math.cos((lat * Math.PI) / 180) || 1);
  return {
    minLat: lat - latKm,
    maxLat: lat + latKm,
    minLng: lng - lngKm,
    maxLng: lng + lngKm,
  };
}

export function buildBBoxClause(lat, lng, radiusM) {
  const { minLat, maxLat, minLng, maxLng } = bboxToRect(lat, lng, radiusM);
  return {
    sql: '(lat BETWEEN $::minLat:: AND $::maxLat::) AND (lng BETWEEN $::minLng:: AND $::maxLng::)',
    params: { minLat, maxLat, minLng, maxLng },
  };
}

const CACHE_TTL_DAYS = 30;

const OVERPASS_MIRRORS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

/**
 * Find the nearest named road/highway around a point via Overpass (OSM).
 * Used only as a landmark fallback when Nominatim finds no road/amenity at the
 * exact coordinate. Results are cached alongside the reverse-geocode row.
 */
async function findNearbyRoad(lat, lng) {
  const q = `[out:json][timeout:8];(way(around:500,${lat},${lng})["highway"]["name"];);out tags geom 20;`;
  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(`${mirror}?data=${encodeURIComponent(q)}`, {
        headers: { 'User-Agent': 'CivicEye/1.0 (dev)' },
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      let best = { name: '', dist: Infinity };
      for (const e of data.elements || []) {
        const name = e.tags?.name;
        if (!name || !e.tags?.highway) continue;
        let d = Infinity;
        for (const g of e.geometry || []) {
          const dd = haversine(lat, lng, g.lat, g.lon);
          if (dd < d) d = dd;
        }
        if (d < best.dist) best = { name, dist: d };
      }
      if (best.name) return best.name;
    } catch (err) {
      logger.warn('Overpass nearby road lookup failed', err.message);
    }
  }
  return '';
}

/**
 * Reverse geocode a coordinate to an address string.
 * Uses OSM Nominatim when enabled; falls back to coordinate-based label.
 * Results are cached in the locations table.
 */
export async function reverseGeocode(lat, lng) {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const { rows } = await pool.query(
    `SELECT id, name, area, city, landmark FROM locations
      WHERE slug = $1 AND is_active = true`,
    [`@${key}`],
  );
  if (rows[0]) {
    // '-' = previously resolved with genuinely no landmark; serve cached (empty)
    // without re-running external lookups. Stale coords-fallback rows
    // ("Near 18.57, 73.81") and pre-Overpass rows (empty landmark) fall through
    // so the next lookup refreshes them with real data.
    if (rows[0].landmark && rows[0].landmark !== '-') {
      return {
        address: rows[0].name,
        area: rows[0].area,
        city: rows[0].city,
        landmark: rows[0].landmark,
        source: 'cache',
      };
    }
    if (rows[0].landmark === '-') {
      return {
        address: rows[0].name,
        area: rows[0].area,
        city: rows[0].city,
        landmark: '',
        source: 'cache',
      };
    }
  }

  if (!env.nominatimEnabled) {
    return {
      address: `Near ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      area: '',
      city: '',
      landmark: '',
      source: 'coords',
    };
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'CivicEye/1.0 (dev)' } });
    if (res.ok) {
      const data = await res.json();
      const city =
        data.address?.city || data.address?.town || data.address?.village || data.address?.state || '';
      const area = data.address?.suburb || data.address?.neighbourhood || data.address?.road || '';
      const shortAddress = [
        data.address?.road,
        data.address?.suburb || data.address?.neighbourhood,
        data.address?.city || data.address?.town || data.address?.village,
      ]
        .filter(Boolean)
        .join(', ');
      const address = shortAddress || data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      let landmark =
        data.address?.amenity ||
        data.address?.building ||
        data.address?.shop ||
        data.address?.tourism ||
        data.address?.railway ||
        data.address?.craft ||
        '';
      if (!landmark && data.address?.road && data.address?.road !== area) {
        landmark = data.address?.road;
      }
      if (!landmark) {
        landmark = await findNearbyRoad(lat, lng);
      }
      const state = data.address?.state || '';
      await pool.query(
        `INSERT INTO locations (name, slug, city, area, landmark, lat, lng, radius_m)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name, area = EXCLUDED.area, city = EXCLUDED.city, landmark = EXCLUDED.landmark`,
        [address, `@${key}`, city || state, area, landmark || '-', lat, lng, 500],
      );
      return { address, area, city: city || state, landmark, source: 'nominatim' };
    }
  } catch (err) {
    logger.warn('Nominatim reverse geocode failed', err.message);
  }

  return {
    address: `Near ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    area: '',
    city: '',
    landmark: '',
    source: 'coords',
  };
}

export function computeAreaBounds(lat, lng) {
  const r = 2000;
  return bboxToRect(lat, lng, r);
}
