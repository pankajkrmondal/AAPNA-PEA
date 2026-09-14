import { Router } from 'express';
import { dashboard, dataQuality, exportExcel } from '../controllers/dashboard.controller.js';
import { authenticate, requireModule } from '../middleware/auth.js';

const router = Router();

router.use(authenticate, requireModule('dashboard'));

router.get('/', dashboard);
router.get('/data-quality', dataQuality);
router.get('/export', exportExcel);

export default router;
