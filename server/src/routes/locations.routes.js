import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { reverseGeocode } from '../services/geo.service.js';
import {
  findLocality,
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
    // ONLY a circle that actually contains the point is a real locality match.
    // The nearest-locality fallback is deliberately NOT used here: assigning a
    // point to the nearest seeded locality regardless of jurisdiction is what
    // caused Warje (PMC) to show Karve Nagar's Ward 10 / Neeta Gupte.
    const locality = await findLocality(lat, lng);
    res.json({
      address: geo.address,
      area: locality?.name || geo.area || '',
      landmark:
        geo.landmark ||
        (locality?.ward_no && !geo.area ? `${locality.name} — Ward ${locality.ward_no}` : ''),
      city: locality?.city || geo.city || '',
      locality: locality
        ? {
            id: locality.id,
            name: locality.name,
            slug: locality.slug,
            type: locality.type,
            ward_no: locality.ward_no,
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

// GET /api/locations/lookup?lat=..&lng=.. — find the locality containing a point.
// No nearest-locality fallback (see /reverse): out-of-circle points are null.
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
