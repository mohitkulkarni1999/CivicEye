import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = join(__dirname, '..', '..', 'uploads');

export const PUBLIC_UPLOAD_BASE = '/uploads';

function extForMime(mime) {
  const ext = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'audio/mp4': '.m4a',
    'audio/m4a': '.m4a',
    'audio/mpeg': '.mp3',
    'audio/webm': '.webm',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
  }[mime || ''];
  return ext || `.${(mime || 'bin').split('/')[1] || 'bin'}`;
}

export const storageService = {
  async save({ buffer, filename, mime }) {
    if (env.storageDriver === 's3') {
      if (!env.s3Bucket || !env.s3Endpoint) {
        throw ApiError.internal('S3 storage selected but not configured');
      }
      const { putObject } = await import('./drivers/s3.driver.js');
      return putObject({ buffer, filename, mime });
    }
    if (env.storageDriver === 'supabase') {
      const { putObject } = await import('./drivers/supabase.driver.js');
      return putObject({ buffer, filename, mime });
    }
    // local driver
    const dir = join(UPLOAD_DIR, new Date().toISOString().slice(0, 10));
    mkdirSync(dir, { recursive: true });
    const ext = extForMime(mime);
    const key = `${dir.replace(/\\/g, '/')}/${filename}${ext}`;
    const absPath = join(dir, `${filename}${ext}`);
    writeFileSync(absPath, buffer);
    return { url: `${PUBLIC_UPLOAD_BASE}/${key.split('/uploads/')[1]}` };
  },

  async delete(_url) {
    // Local deletion is optional; files are small for a dev environment.
    logger.debug('Storage delete skipped (local driver)');
  },
};
