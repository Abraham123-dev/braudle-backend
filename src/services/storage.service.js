import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

/**
 * Generates a presigned URL for uploading a single file directly to R2
 */
export const getPresignedPutUrl = async (key, contentType) => {
  const command = new PutObjectCommand({
    Bucket: env.cfR2.bucket,
    Key: key,
    ContentType: contentType,
  });

  // Signed URL expires in 15 minutes (900 seconds)
  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });
  return uploadUrl;
};

/**
 * Initiates a multipart upload on R2
 */
export const initiateMultipartUpload = async (key, contentType) => {
  const command = new CreateMultipartUploadCommand({
    Bucket: env.cfR2.bucket,
    Key: key,
    ContentType: contentType,
  });

  const response = await s3Client.send(command);
  return response.UploadId;
};

/**
 * Generates a presigned URL for a specific part of a multipart upload
 */
export const getPresignedUploadPartUrl = async (key, uploadId, partNumber) => {
  const command = new UploadPartCommand({
    Bucket: env.cfR2.bucket,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });

  // Signed URL expires in 15 minutes (900 seconds)
  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });
  return uploadUrl;
};

/**
 * Completes a multipart upload on R2
 */
export const completeMultipartUpload = async (key, uploadId, parts) => {
  const command = new CompleteMultipartUploadCommand({
    Bucket: env.cfR2.bucket,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: parts, // Array of { PartNumber, ETag }
    },
  });

  const response = await s3Client.send(command);
  
  const publicDomain = env.cfR2.publicUrl.replace(/^https?:\/\//, '');
  return `https://${publicDomain}/${key}`;
};

/**
 * Aborts a multipart upload on R2
 */
export const abortMultipartUpload = async (key, uploadId) => {
  const command = new AbortMultipartUploadCommand({
    Bucket: env.cfR2.bucket,
    Key: key,
    UploadId: uploadId,
  });

  await s3Client.send(command);
};