import { Router } from 'express';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validate.js';
import { listUploadsQuerySchema } from '../schemas/uploads.js';
import { receiveSingleFile } from '../services/receiveSingleFile.js';
import { TMP_DIR } from '../services/uploadStorage.js';
import * as uploadService from '../services/upload.service.js';

export const uploadsRouter = Router();

// Every upload route needs a logged-in user.
uploadsRouter.use(requireAuth);

// requireAuth (above) runs first: an unauthenticated request is rejected
// before a single byte of the file is read or stored.
uploadsRouter.post('/', async (req, res) => {
  const received = await receiveSingleFile(req, { maxBytes: env.UPLOAD_MAX_BYTES, tmpDir: TMP_DIR });
  const upload = await uploadService.createUpload(req.user.id, received);
  res.status(201).json({ upload });
});

uploadsRouter.get('/', validateQuery(listUploadsQuerySchema), async (req, res) => {
  res.json(await uploadService.listUploads(req.user.id, req.validatedQuery));
});

uploadsRouter.get('/:id', async (req, res) => {
  const upload = await uploadService.getUpload(req.user.id, req.params.id);
  res.json({ upload });
});
