import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${env.cfR2.accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.cfR2.accessKey,
    secretAccessKey: env.cfR2.secretKey,
  },
});

/**
 * Sanitizes a filename for safe storage
 * Converts "My Notes.pdf" to "my-notes.pdf"
 */
export const sanitizeFilename = (filename) => {
  const sanitized = filename
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')           // Replace spaces with hyphens
    .replace(/[^\w.-]/g, '')        // Remove non-alphanumeric characters except . and -
    .replace(/-+/g, '-')           // Collapse multiple hyphens
    .replace(/^-+|-+$/g, '');       // Trim leading/trailing hyphens

  return sanitized || 'file';
};

export const uploadToR2 = async (buffer, key, contentType) => {
  // Normalize the public URL by removing any protocol if present in the env var
  // This prevents URLs like https://https://files.com
  const publicDomain = env.cfR2.publicUrl.replace(/^https?:\/\//, '');

  const command = new PutObjectCommand({
    Bucket: env.cfR2.bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3Client.send(command);
  return `https://${publicDomain}/${key}`;
};

export const downloadFromR2 = async (key) => {
  const command = new GetObjectCommand({
    Bucket: env.cfR2.bucket,
    Key: key,
  });

  const response = await s3Client.send(command);
  
  // Convert stream to Buffer for easier consumption in workers
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

export const deleteFromR2 = async (key) => {
  const command = new DeleteObjectCommand({
    Bucket: env.cfR2.bucket,
    Key: key,
  });

  await s3Client.send(command);
};