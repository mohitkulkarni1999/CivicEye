import sharp from 'sharp';
import { ApiError } from '../utils/ApiError.js';
import { storageService } from '../services/storage/index.js';
import { query } from '../config/db.js';
import { randomBytes } from 'node:crypto';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const MAGIC = [
  { bytes: [0xff, 0xd8, 0xff], mime: 'image/jpeg' },
  { bytes: [0x89, 0x50, 0x4e, 0x47], mime: 'image/png' },
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: 'image/webp' },
];

export function sniffMime(buffer) {
  for (const sig of MAGIC) {
    if (sig.bytes.every((b, i) => buffer[i] === b)) return sig.mime;
  }
  return null;
}

export function isImageFile(file) {
  if (!file) return false;
  if (!file.mimetype || !file.mimetype.startsWith('image/')) return false;
  return sniffMime(file.buffer) !== null;
}

export function toGray8({ data, width, height }) {
  return new Uint8Array(data.subarray(0, width * height));
}

export function computeDHash(gray, width, height) {
  const SIZE = 9; // produces 64-bit hash
  const small = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
  const stepX = Math.max(1, Math.floor(width / SIZE));
  const stepY = Math.max(1, Math.floor(height / SIZE));
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = 0; dy < stepY; dy++) {
        for (let dx = 0; dx < stepX; dx++) {
          const px = Math.min(width - 1, x * stepX + dx);
          const py = Math.min(height - 1, y * stepY + dy);
          sum += gray[py * width + px];
          count++;
        }
      }
      small[y][x] = sum / count;
    }
  }
  let hash = '';
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE - 1; x++) {
      hash += small[y][x] > small[y][x + 1] ? '1' : '0';
    }
  }
  return BigInt('0b' + hash);
}

export function hammingDistance(a, b) {
  const d = a ^ b;
  return d.toString(2).replace(/0/g, '').length;
}

async function processImage(buffer, mime) {
  const image = sharp(buffer, { failOn: 'error' });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw ApiError.badRequest('Could not read image dimensions');
  }

  const pipeline = sharp(buffer, { failOn: 'error' }).rotate().removeAlpha();

  const resized = await pipeline
    .clone()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  const thumb = await pipeline
    .clone()
    .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer();

  const gray = await sharp(resized).grayscale().raw().toBuffer({ resolveWithObject: true });

  return {
    full: resized,
    thumb,
    width: metadata.width,
    height: metadata.height,
    mime,
    gray: toGray8({ data: gray.data, width: gray.info.width, height: gray.info.height }),
    gwidth: gray.info.width,
    gheight: gray.info.height,
  };
}

export function imageUploadPipeline(fieldName, maxCount = 6) {
  return async (req, _res, next) => {
    try {
      const files = Array.isArray(req.files)
        ? (req.files || []).filter(Boolean)
        : (req.files?.[fieldName] || []).filter(Boolean);
      if (!files.length) return next();

      const results = [];
      for (const file of files) {
        if (!isImageFile(file)) {
          throw ApiError.badRequest('Only JPEG, PNG or WebP images are allowed');
        }
        const processed = await processImage(file.buffer, sniffMime(file.buffer));
        const filename = randomBytes(12).toString('hex');
        const stored = await storageService.save({
          buffer: processed.full,
          filename,
          mime: processed.mime,
        });
        const thumbStored = await storageService.save({
          buffer: processed.thumb,
          filename: `${filename}_thumb`,
          mime: processed.mime,
        });
        const hash = computeDHash(processed.gray, processed.gwidth, processed.gheight);

        const { rows } = await query(
          `INSERT INTO uploads (user_id, url, thumb_url, mime, size_bytes, width, height, perceptual_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, url, thumb_url, width, height, size_bytes, perceptual_hash`,
          [
            req.user?.id || null,
            stored.url,
            thumbStored.url,
            processed.mime,
            processed.full.length,
            processed.width,
            processed.height,
            hash.toString(16),
          ],
        );
        results.push(rows[0]);
      }
      req[`${fieldName}Uploads`] = results;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export async function fetchUploadedImage(id, userId = null) {
  const { rows } = await query(
    `SELECT * FROM uploads WHERE id = $1 AND (expires_at > now() OR user_id = $2)`,
    [id, userId],
  );
  return rows[0] || null;
}
