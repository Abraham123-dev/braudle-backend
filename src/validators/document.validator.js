import { z } from 'zod';

/**
 * Validator for document upload metadata
 */
export const uploadSchema = z.object({
  title: z.string()
    .min(1, 'Title is required')
    .max(200, 'Title cannot exceed 200 characters'),
  subject: z.string()
    .max(100, 'Subject cannot exceed 100 characters')
    .optional()
    .or(z.literal('')), 
});

export const getPresignedUrlSchema = z.object({
  title: z.string()
    .min(1, 'Title is required')
    .max(200, 'Title cannot exceed 200 characters'),
  subject: z.string()
    .max(100, 'Subject cannot exceed 100 characters')
    .optional()
    .or(z.literal('')),
  filename: z.string()
    .min(1, 'Filename is required'),
  contentType: z.string()
    .min(1, 'Content type is required'),
  fileHash: z.string()
    .optional(),
});

export const confirmUploadSchema = z.object({
  documentId: z.string().min(1, 'Document ID is required'),
  fileHash: z.string().optional(),
});

export const presignPartsSchema = z.object({
  uploadId: z.string().min(1, 'Upload ID is required'),
  fileKey: z.string().min(1, 'File key is required'),
  partNumbers: z.array(z.number().int().min(1)).min(1, 'At least one part number is required'),
});

export const completeMultipartSchema = z.object({
  documentId: z.string().min(1, 'Document ID is required'),
  uploadId: z.string().min(1, 'Upload ID is required'),
  fileKey: z.string().min(1, 'File key is required'),
  parts: z.array(z.object({
    PartNumber: z.number().int().min(1),
    ETag: z.string().min(1, 'ETag is required'),
  })).min(1, 'At least one part is required'),
});

export const abortMultipartSchema = z.object({
  documentId: z.string().min(1, 'Document ID is required'),
  uploadId: z.string().min(1, 'Upload ID is required'),
  fileKey: z.string().min(1, 'File key is required'),
});