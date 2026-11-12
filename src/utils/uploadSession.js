const sameId = (left, right) => left?.toString() === right?.toString();

export const isOwnedUploadSession = (document, { userId, fileKey, uploadId }) => (
  sameId(document?.userId, userId)
  && document?.fileKey === fileKey
  && document?.multipartUploadId === uploadId
);

export const canConfirmUpload = (document) => (
  ['presigned', undefined, null].includes(document?.uploadState)
  && !document?.uploadConfirmedAt
  && document?.processingStatus === 'pending'
);
