import test from 'node:test';
import assert from 'node:assert/strict';
import { canConfirmUpload, isOwnedUploadSession } from '../src/utils/uploadSession.js';

test('multipart session is owned only when user, key, and upload ID all match', () => {
  const document = {
    userId: 'user-a',
    fileKey: 'uploads/user-a/file.pdf',
    multipartUploadId: 'upload-a',
  };

  assert.equal(isOwnedUploadSession(document, {
    userId: 'user-a',
    fileKey: 'uploads/user-a/file.pdf',
    uploadId: 'upload-a',
  }), true);

  assert.equal(isOwnedUploadSession(document, {
    userId: 'user-b',
    fileKey: 'uploads/user-a/file.pdf',
    uploadId: 'upload-a',
  }), false);

  assert.equal(isOwnedUploadSession(document, {
    userId: 'user-a',
    fileKey: 'uploads/user-a/file.pdf',
    uploadId: 'upload-b',
  }), false);

  assert.equal(isOwnedUploadSession(document, {
    userId: 'user-a',
    fileKey: 'uploads/user-b/file.pdf',
    uploadId: 'upload-a',
  }), false);
});

test('confirmation can be claimed only once for a pending presigned upload', () => {
  const pending = {
    uploadState: 'presigned',
    processingStatus: 'pending',
  };

  assert.equal(canConfirmUpload(pending), true);
  assert.equal(canConfirmUpload({
    ...pending,
    uploadState: 'completed',
    uploadConfirmedAt: new Date(),
  }), false);
  assert.equal(canConfirmUpload({
    ...pending,
    uploadConfirmedAt: new Date(),
  }), false);
  assert.equal(canConfirmUpload({
    ...pending,
    processingStatus: 'processing',
  }), false);
});

test('legacy documents without uploadState remain confirmable once', () => {
  assert.equal(canConfirmUpload({
    processingStatus: 'pending',
  }), true);
});
