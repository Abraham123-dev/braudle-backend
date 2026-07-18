import { completeMultipartSchema } from '../src/validators/document.validator.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

console.log('--- Testing completeMultipartSchema Validation & Normalisation ---');

// Test Case 1: camelCase/lowercase input (from frontend)
try {
  const input = {
    documentId: 'doc123',
    uploadId: 'upload123',
    fileKey: 'file123',
    parts: [
      { partNumber: 1, etag: 'etag1' },
      { partNumber: 2, etag: 'etag2' }
    ]
  };
  const result = completeMultipartSchema.parse(input);
  console.log('✅ Test 1: camelCase input successfully validated.');
  
  assert(result.parts[0].PartNumber === 1, 'Expected PartNumber to be 1');
  assert(result.parts[0].ETag === 'etag1', 'Expected ETag to be etag1');
  assert(result.parts[1].PartNumber === 2, 'Expected PartNumber to be 2');
  assert(result.parts[1].ETag === 'etag2', 'Expected ETag to be etag2');
  console.log('✅ Test 1 structure mapping verified.', JSON.stringify(result.parts));
} catch (err) {
  console.error('❌ Test 1 failed:', err.message);
  process.exit(1);
}

// Test Case 2: PascalCase input (original format)
try {
  const input = {
    documentId: 'doc123',
    uploadId: 'upload123',
    fileKey: 'file123',
    parts: [
      { PartNumber: 1, ETag: 'etag1' },
      { PartNumber: 2, ETag: 'etag2' }
    ]
  };
  const result = completeMultipartSchema.parse(input);
  console.log('✅ Test 2: PascalCase input successfully validated.');
  
  assert(result.parts[0].PartNumber === 1, 'Expected PartNumber to be 1');
  assert(result.parts[0].ETag === 'etag1', 'Expected ETag to be etag1');
  assert(result.parts[1].PartNumber === 2, 'Expected PartNumber to be 2');
  assert(result.parts[1].ETag === 'etag2', 'Expected ETag to be etag2');
  console.log('✅ Test 2 structure mapping verified.');
} catch (err) {
  console.error('❌ Test 2 failed:', err.message);
  process.exit(1);
}

// Test Case 3: Invalid input (mixed missing fields)
try {
  const input = {
    documentId: 'doc123',
    uploadId: 'upload123',
    fileKey: 'file123',
    parts: [
      { partNumber: 1 } // missing ETag/etag
    ]
  };
  completeMultipartSchema.parse(input);
  console.error('❌ Test 3 failed: expected validation error for missing etag, but none thrown.');
  process.exit(1);
} catch (err) {
  console.log('✅ Test 3: correctly rejected input with missing etag:', err.message);
}

// Test Case 4: Invalid input (wrong type)
try {
  const input = {
    documentId: 'doc123',
    uploadId: 'upload123',
    fileKey: 'file123',
    parts: [
      { partNumber: 'one', etag: 'etag1' } // string instead of number
    ]
  };
  completeMultipartSchema.parse(input);
  console.error('❌ Test 4 failed: expected validation error for non-numeric partNumber, but none thrown.');
  process.exit(1);
} catch (err) {
  console.log('✅ Test 4: correctly rejected input with non-numeric part number:', err.message);
}

console.log('--- All validation tests passed! ---');
