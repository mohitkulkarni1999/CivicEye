import { env } from '../../../config/env.js';
import { ApiError } from '../../../utils/ApiError.js';

export async function putObject({ buffer, filename, mime }) {
  if (!env.s3Endpoint || !env.s3Bucket || !env.s3AccessKey || !env.s3SecretKey) {
    throw ApiError.internal('S3 driver requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY');
  }
  throw ApiError.internal(
    'S3 storage requires the @aws-sdk/client-s3 dependency. Install it or use the local driver.',
  );
}
