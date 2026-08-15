import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import {
  resolveRepresentativeForPoint,
  listRepresentatives,
  createRepresentative,
  updateRepresentative,
  setRepresentativeVerified,
  listWards,
  createWard,
  updateWard,
  listCorporations,
  getEscalationTagRule,
  setEscalationTagRule,
  setWardBoundaryFromGeoJSON,
  getWardById,
} from '../services/representative.service.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const latLng = z.array(z.number()).length(2);
const ring = z.array(latLng).min(3);
const boundarySchema = z.union([
  z.array(ring).min(1), // rings: [ [ [lat,lng], ... ], ... ]
  z.object({
    type: z.literal('Polygon'),
    coordinates: z.array(z.array(z.array(z.number())).min(1)).min(1),
  }),
  z.object({
    type: z.literal('MultiPolygon'),
    coordinates: z.array(z.array(z.array(z.array(z.number())).min(1)).min(1)).min(1),
  }),
]);

export const representativeSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(200),
  designation: z.string().trim().max(200).optional().or(z.literal('')),
  constituency: z.string().trim().max(200).optional().or(z.literal('')),
  corporationId: z.string().uuid().optional().nullable(),
  party: z.string().trim().max(100).optional().or(z.literal('')),
  seat: z.string().trim().max(20).optional().or(z.literal('')),
  official_x_username: z.string().trim().max(60).optional().or(z.literal('')),
  official_x_user_id: z.string().trim().max(100).optional().or(z.literal('')),
  x_profile_url: z.string().trim().max(500).optional().or(z.literal('')),
  x_verified_by_admin: z.boolean().optional(),
  data_source: z.string().trim().max(200).optional().or(z.literal('')),
  source_url: z.string().trim().max(500).optional().or(z.literal('')),
  active_from: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional().nullable().or(z.literal('')),
  active_until: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional().nullable().or(z.literal('')),
  is_current: z.boolean().optional(),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
});

const wardSchema = z.object({
  city: z.string().trim().min(2, 'City is required').max(200),
  ward_number: z.string().trim().min(1, 'Ward number is required').max(50),
  ward_name: z.string().trim().max(200).optional().or(z.literal('')),
  corporationId: z.string().uuid().optional().nullable(),
  boundaryLocalityId: z.string().uuid().optional().nullable(),
  representativeId: z.string().uuid().optional().nullable(),
  source: z.string().trim().max(200).optional().or(z.literal('')),
  boundary: boundarySchema.optional().nullable(),
  isActive: z.boolean().optional(),
});

/** Public: resolve the elected representative for a map point. No auth needed. */
export const resolveRepresentative = asyncHandler(async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw ApiError.badRequest('Valid lat/lng query parameters are required');
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw ApiError.badRequest('Invalid coordinates');
  }
  res.json(await resolveRepresentativeForPoint(lat, lng));
});

export const adminListRepresentatives = asyncHandler(async (req, res) => {
  const includeInactive = req.query.includeInactive === 'true';
  res.json({ representatives: await listRepresentatives({ includeInactive }) });
});

export const adminCreateRepresentative = asyncHandler(async (req, res) => {
  const parsed = representativeSchema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Invalid representative data', parsed.error.issues);
  const rep = await createRepresentative(parsed.data, { createdBy: req.user.id });
  res.status(201).json({ representative: rep });
});

export const adminUpdateRepresentative = asyncHandler(async (req, res) => {
  const parsed = representativeSchema.partial().safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Invalid representative data', parsed.error.issues);
  const rep = await updateRepresentative(req.params.id, parsed.data, { actorId: req.user.id });
  if (!rep) throw ApiError.notFound('Representative not found');
  res.json({ representative: rep });
});

export const adminVerifyRepresentativeX = asyncHandler(async (req, res) => {
  const verified = z.boolean().safeParse(req.body.verified);
  if (!verified.success) throw ApiError.badRequest('`verified` boolean is required');
  const rep = await setRepresentativeVerified(req.params.id, verified.data, { actorId: req.user.id });
  if (!rep) throw ApiError.notFound('Representative not found');
  res.json({ representative: rep });
});

export const adminListWards = asyncHandler(async (_req, res) => {
  res.json({ wards: await listWards() });
});

export const adminCreateWard = asyncHandler(async (req, res) => {
  const parsed = wardSchema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Invalid ward data', parsed.error.issues);
  const ward = await createWard(parsed.data, { actorId: req.user.id });
  res.status(201).json({ ward });
});

export const adminUpdateWard = asyncHandler(async (req, res) => {
  const parsed = wardSchema.partial().safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Invalid ward data', parsed.error.issues);
  const ward = await updateWard(req.params.id, parsed.data, { actorId: req.user.id });
  if (!ward) throw ApiError.notFound('Ward not found');
  res.json({ ward });
});

export const adminListCorporations = asyncHandler(async (_req, res) => {
  res.json({ corporations: await listCorporations() });
});

export const adminGetEscalationTagRule = asyncHandler(async (_req, res) => {
  res.json({ key: 'escalation_tag_rule', value: await getEscalationTagRule() });
});

export const adminSetEscalationTagRule = asyncHandler(async (req, res) => {
  const parsed = z.object({ value: z.enum(['TAG_SELECTED_REPRESENTATIVE', 'TAG_ALL_WARD_REPRESENTATIVES']) }).safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Invalid tag rule', parsed.error.issues);
  const setting = await setEscalationTagRule(parsed.data.value, { actorId: req.user.id });
  res.json({ key: setting.key, value: setting.value });
});

export const adminSetWardBoundaryGeoJSON = asyncHandler(async (req, res) => {
  const parsed = z.object({ geojson: boundarySchema }).safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Invalid boundary GeoJSON', parsed.error.issues);
  const ward = await getWardById(req.params.id);
  if (!ward) throw ApiError.notFound('Ward not found');
  await setWardBoundaryFromGeoJSON(ward.id, parsed.data.geojson);
  res.json({ ward: await getWardById(ward.id), message: 'Ward boundary updated' });
});
