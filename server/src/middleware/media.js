import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpeg from 'fluent-ffmpeg';
import { randomBytes } from 'node:crypto';
import { ApiError } from '../utils/ApiError.js';
import { storageService } from '../services/storage/index.js';
import { query } from '../config/db.js';
import { logger } from '../utils/logger.js';

export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const VIDEO_MIMES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/3gpp',
]);
const AUDIO_MIMES = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/m4a',
  'audio/webm',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/opus',
  'audio/aac',
]);

export function classifyMedia(file) {
  const m = file?.mimetype || '';
  if (m.startsWith('video/') && VIDEO_MIMES.has(m)) return 'video';
  if (m.startsWith('audio/') && AUDIO_MIMES.has(m)) return 'audio';
  return null;
}

function probe(path) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(path, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

function transcode(inputPath, outputPath, setup) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(inputPath);
    setup(cmd);
    cmd
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(new Error(err.message)));
    cmd.save(outputPath);
  });
}

async function transcodeVideo(inputPath) {
  const tmp = mkdtempSync(join(tmpdir(), 'ce-video-'));
  const out = join(tmp, 'out.mp4');
  const poster = join(tmp, 'poster.jpg');
  try {
    await transcode(inputPath, out, (cmd) => {
      cmd
        .videoCodec('libx264')
        .outputOptions([
          '-vf',
          'scale=w=min(iw\\,1280):h=min(ih\\,720):force_original_aspect_ratio=decrease',
          '-crf',
          '28',
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          '+faststart',
        ])
        .audioCodec('aac')
        .audioBitrate('128k')
        .format('mp4');
    });
    const posterOk = await transcode(inputPath, poster, (cmd) => {
      cmd
        .inputOptions(['-ss', '0'])
        .frames(1)
        .outputOptions(['-vf', 'scale=w=640:h=360:force_original_aspect_ratio=decrease', '-q:v', '3'])
        .format('image2');
    });
    const video = readFileSync(out);
    const thumb = readFileSync(poster);
    rmSync(tmp, { recursive: true, force: true });
    return { video, thumb, posterOk: !!posterOk };
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

async function transcodeAudio(inputPath) {
  const tmp = mkdtempSync(join(tmpdir(), 'ce-audio-'));
  const out = join(tmp, 'out.m4a');
  try {
    await transcode(inputPath, out, (cmd) => {
      cmd
        .outputOptions(['-vn'])
        .audioCodec('aac')
        .audioBitrate('96k')
        .format('mp4');
    });
    const audio = readFileSync(out);
    rmSync(tmp, { recursive: true, force: true });
    return audio;
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

function writeTemp(file) {
  const dir = mkdtempSync(join(tmpdir(), 'ce-media-'));
  const ext = `.${(file.originalname || file.mimetype).split('.').pop() || 'bin'}`.toLowerCase();
  const path = join(dir, `input${ext}`);
  writeFileSync(path, file.buffer);
  return { dir, path };
}

export function mediaUploadPipeline(fieldName, maxCount = 4) {
  return async (req, _res, next) => {
    try {
      const files = Array.isArray(req.files)
        ? (req.files || []).filter(Boolean)
        : (req.files?.[fieldName] || []).filter(Boolean);
      if (!files.length) return next();

      const results = [];
      for (const file of files.slice(0, maxCount)) {
        const kind = classifyMedia(file);
        if (!kind) {
          throw ApiError.badRequest(
            'Only video (mp4/webm/mov/avi) or audio (m4a/webm/ogg/mp3/wav) files are supported',
          );
        }
        if (kind === 'video' && file.size > MAX_VIDEO_BYTES) {
          throw ApiError.badRequest('Video must be 100MB or smaller');
        }
        if (kind === 'audio' && file.size > MAX_AUDIO_BYTES) {
          throw ApiError.badRequest('Audio must be 25MB or smaller');
        }

        const tmp = writeTemp(file);
        let duration = 0;
        let width = 0;
        let height = 0;
        try {
          const meta = await probe(tmp.path);
          duration = Number(meta.format?.duration || 0);
          const vstream = (meta.streams || []).find(
            (s) => s.codec_type === 'video' && (s.width || 0) > 0,
          );
          if (vstream) {
            width = vstream.width || 0;
            height = vstream.height || 0;
          }
        } catch (err) {
          rmSync(tmp.dir, { recursive: true, force: true });
          throw ApiError.badRequest('Could not read the media file — it may be corrupt');
        }

        const filename = randomBytes(12).toString('hex');
        let url = '';
        let thumbUrl = '';
        let mime = '';
        let sizeBytes = 0;
        try {
          if (kind === 'video') {
            const { video, thumb } = await transcodeVideo(tmp.path);
            mime = 'video/mp4';
            sizeBytes = video.length;
            const stored = await storageService.save({ buffer: video, filename, mime });
            const thumbStored = await storageService.save({
              buffer: thumb,
              filename: `${filename}_poster`,
              mime: 'image/jpeg',
            });
            url = stored.url;
            thumbUrl = thumbStored.url;
          } else {
            const audio = await transcodeAudio(tmp.path);
            mime = 'audio/mp4';
            sizeBytes = audio.length;
            const stored = await storageService.save({ buffer: audio, filename, mime });
            url = stored.url;
          }

          const original = await storageService.save({
            buffer: file.buffer,
            filename: `${filename}_original`,
            mime: file.mimetype,
          });

          const { rows } = await query(
            `INSERT INTO uploads
               (user_id, url, thumb_url, mime, size_bytes, width, height, original_url, original_mime, media_duration, transcode_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'done')
             RETURNING id, url, thumb_url, mime, size_bytes, width, height, original_url, original_mime, media_duration`,
            [
              req.user?.id || null,
              url,
              thumbUrl,
              mime,
              sizeBytes,
              width,
              height,
              original.url,
              file.mimetype,
              duration,
            ],
          );
          results.push(rows[0]);
        } catch (err) {
          logger.warn('Media transcode/store failed', err.message);
          throw ApiError.badRequest(
            `Could not transcode ${kind === 'video' ? 'video' : 'audio'} — the file may be unsupported`,
          );
        } finally {
          rmSync(tmp.dir, { recursive: true, force: true });
        }
      }
      req[`${fieldName}Uploads`] = results;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
