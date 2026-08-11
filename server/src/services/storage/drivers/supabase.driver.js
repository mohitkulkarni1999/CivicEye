import { env } from '../../../config/env.js';
import { ApiError } from '../../../utils/ApiError.js';

export async function putObject({ buffer, filename, mime }) {
  if (!env.supabaseUrl || !env.supabaseServiceKey) {
    throw ApiError.internal('Supabase storage requires SUPABASE_URL and SUPABASE_SERVICE_KEY');
  }

  // Upload to the "uploads" bucket
  const uploadUrl = `${env.supabaseUrl}/storage/v1/object/uploads/${filename}`;
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.supabaseServiceKey}`,
      'Content-Type': mime || 'application/octet-stream',
    },
    body: buffer,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw ApiError.internal(`Supabase upload failed: ${errorText}`);
  }

  // Return the public URL for the uploaded file
  return {
    url: `${env.supabaseUrl}/storage/v1/object/public/uploads/${filename}`,
  };
}
