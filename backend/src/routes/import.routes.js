import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { preview, importExcel } from '../controllers/import.controller.js';
import { authenticate, requireMinRole, requireModule } from '../middleware/auth.js';
import AppError from '../utils/AppError.js';

const router = Router();

// In memory, not on disk: the workbook is parsed once and never needs to
// persist, so there is no upload directory to secure or clean up.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.xlsm'].includes(ext)) return cb(null, true);
    // AppError, not a bare Error: a bare one carries no statusCode, so the
    // global handler would treat "user picked the wrong file" as a 500.
    cb(new AppError(`File type ${ext} is not allowed. Upload an Excel workbook (.xlsx).`, 400));
  },
});

router.use(authenticate);

router.post('/preview', requireMinRole('hr'), upload.single('file'), preview);
router.post('/excel', requireMinRole('admin'), upload.single('file'), importExcel);

export default router;
