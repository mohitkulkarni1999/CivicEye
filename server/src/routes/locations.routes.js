import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { reverseGeocode } from '../services/geo.service.js';
import {
  findLocality,
  findNearestLocality,
  getLocalityById,
  identifyLocalityOfficial,
  listLocalities,
  LOCALITY_TYPE_LABELS,
} from '../services/locality.service.js';

const router = Router();

// GET /api/locations/reverse?lat=..&lng=.. — reverse geocode a point to an address
router.get(
  '/reverse',
  asyncHandler(async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'lat and lng query params are required' });
    }
    const geo = await reverseGeocode(lat, lng);
    const locality = await findLocality(lat, lng);
    const nearest = locality || (await findNearestLocality(lat, lng));
    res.json({
      address:
        geo.address.startsWith('Near ') && nearest?.name
          ? `${nearest.name} area`
          : geo.address,
      area: locality?.name || geo.area || nearest?.name || '',
      landmark:
        geo.landmark ||
        (nearest?.ward_no && !geo.area ? `${nearest.name} — Ward ${nearest.ward_no}` : ''),
      city: locality?.city || geo.city || nearest?.city || '',
      locality: locality
        ? {
            id: locality.id,
            name: locality.name,
            slug: locality.slug,
            type: locality.type,
            ward_no: locality.ward_no,
          }
        : nearest
          ? {
              id: nearest.id,
              name: nearest.name,
              slug: nearest.slug,
              type: nearest.type,
              ward_no: nearest.ward_no,
              approximate: true,
            }
          : null,
      source: geo.source,
    });
  }),
);

// GET /api/locations — list all localities (public)
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const locations = await listLocalities();
    res.json({
      locations: locations.map((l) => ({
        id: l.id,
        name: l.name,
        slug: l.slug,
        city: l.city,
        area: l.area,
        lat: l.lat,
        lng: l.lng,
        radius_m: l.radius_m,
        type: l.type,
        type_label: LOCALITY_TYPE_LABELS[l.type] || l.type,
        ward_no: l.ward_no,
        officer_name: l.officer_name,
        officer_role: l.officer_role,
        officer_party: l.officer_party,
      })),
    });
  }),
);

// GET /api/locations/lookup?lat=..&lng=.. — find the locality containing a point
router.get(
  '/lookup',
  asyncHandler(async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'lat and lng query params are required' });
    }
    const loc = await findLocality(lat, lng);
    if (!loc) return res.json({ match: null });
    const { officer_phone, ...match } = loc;
    res.json({ match: { ...match, type_label: LOCALITY_TYPE_LABELS[loc.type] || loc.type } });
  }),
);

// GET /api/locations/:id/official — who leads this area (GPT/DB lookup, cached)
router.get(
  '/:id/official',
  asyncHandler(async (req, res) => {
    const loc = await getLocalityById(req.params.id);
    if (!loc) return res.status(404).json({ error: 'Locality not found' });
    const result = await identifyLocalityOfficial(loc, { userId: req.user?.id || null });
    res.json({
      locality: {
        id: result.id,
        name: result.name,
        slug: result.slug,
        type: result.type,
        type_label: LOCALITY_TYPE_LABELS[result.type] || result.type,
        city: result.city,
        area: result.area,
      },
      official: result.official,
      ai: result.ai,
    });
  }),
);

export default router;
