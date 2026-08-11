import multer from 'multer';

export const multerImages = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 8,
    fields: 20,
  },
});

export const multerMedia = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 4,
    fields: 20,
  },
});
