import { Router } from 'express';
import multer from 'multer';
import { authenticate, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { adminController } from '../controllers/admin.controller.js';

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

export default router;
