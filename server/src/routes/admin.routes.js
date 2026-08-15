import { Router } from 'express';
import multer from 'multer';
import { authenticate, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { escalateLimiter } from '../middleware/rateLimit.js';
import { adminController } from '../controllers/admin.controller.js';
import {
  adminListRepresentatives,
  adminCreateRepresentative,
  adminUpdateRepresentative,
  adminVerifyRepresentativeX,
  adminListWards,
  adminCreateWard,
  adminUpdateWard,
  adminListCorporations,
  adminGetEscalationTagRule,
  adminSetEscalationTagRule,
  adminSetWardBoundaryGeoJSON,
} from '../controllers/representative.controller.js';
import {
  listEscalationsAdmin,
  approveEscalationAction,
  rejectEscalationAction,
  publishEscalationAction,
  retryEscalationAction,
  updateEscalationTextAction,
} from '../controllers/escalation.controller.js';
import { adminListIngestSources, adminRunIngest } from '../controllers/ingest.controller.js';

const router = Router();

router.use(authenticate, requireRole('admin'));

const multerCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 },
});

router.get('/users', asyncHandler(adminController.listUsers));
router.patch('/users/:id', asyncHandler(adminController.updateUser));

router.get('/resolved-issues', asyncHandler(adminController.listResolvedIssues));
router.post('/issues/:id/resolution-photo', asyncHandler(adminController.addResolutionPhoto));

router.get('/officers', asyncHandler(adminController.listOfficers));
router.post('/officers', asyncHandler(adminController.createOfficer));
router.patch('/officers/:id', asyncHandler(adminController.updateOfficer));

router.get('/categories', asyncHandler(adminController.listCategories));
router.post('/categories', asyncHandler(adminController.createCategory));
router.patch('/categories/:id', asyncHandler(adminController.updateCategory));

router.post('/departments', asyncHandler(adminController.createDepartment));
router.patch('/departments/:id', asyncHandler(adminController.updateDepartment));

router.get('/moderation/reports', asyncHandler(adminController.listModerationReports));
router.patch('/moderation/reports/:id', asyncHandler(adminController.resolveModerationReport));
router.post('/issues/:id/hide', asyncHandler(adminController.hideIssue));
router.post('/issues/:id/reject', asyncHandler(adminController.rejectIssue));

router.post('/issues/import', multerCsv.single('file'), asyncHandler(adminController.importIssuesCsv));

router.get('/analytics', asyncHandler(adminController.getAnalytics));
router.get('/ai-config', asyncHandler(adminController.getAiConfig));
router.patch('/ai-config', asyncHandler(adminController.updateAiConfig));

router.get('/locations', asyncHandler(adminController.listLocations));
router.post('/locations', asyncHandler(adminController.manageLocation));

// Elected representatives
router.get('/representatives', asyncHandler(adminListRepresentatives));
router.post('/representatives', asyncHandler(adminCreateRepresentative));
router.patch('/representatives/:id', asyncHandler(adminUpdateRepresentative));
router.post('/representatives/:id/verify-x', asyncHandler(adminVerifyRepresentativeX));

// Municipal corporations
router.get('/corporations', asyncHandler(adminListCorporations));

// Escalation behaviour
router.get('/settings/escalation-tag-rule', asyncHandler(adminGetEscalationTagRule));
router.put('/settings/escalation-tag-rule', asyncHandler(adminSetEscalationTagRule));

// Wards
router.get('/wards', asyncHandler(adminListWards));
router.post('/wards', asyncHandler(adminCreateWard));
router.patch('/wards/:id', asyncHandler(adminUpdateWard));
router.post('/wards/:id/boundary', asyncHandler(adminSetWardBoundaryGeoJSON));

// Automatic official-source ingestion (state election commission data)
router.get('/ingest/sources', asyncHandler(adminListIngestSources));
router.post('/ingest/run', escalateLimiter, asyncHandler(adminRunIngest));

// X escalations
router.get('/escalations', asyncHandler(listEscalationsAdmin));
router.post('/escalations/:id/approve', escalateLimiter, asyncHandler(approveEscalationAction));
router.post('/escalations/:id/reject', escalateLimiter, asyncHandler(rejectEscalationAction));
router.post('/escalations/:id/publish', escalateLimiter, asyncHandler(publishEscalationAction));
router.post('/escalations/:id/retry', escalateLimiter, asyncHandler(retryEscalationAction));
router.post('/escalations/:id/text', escalateLimiter, asyncHandler(updateEscalationTextAction));

export default router;
