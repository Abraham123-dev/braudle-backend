// Splits text into chunks for AI processing
// Target: ~500 tokens per chunk (~350-400 words)

const splitIntoChunks = (text, chunkSize = 400) => {
  if (!text || text.length === 0) return [];
  
  const paragraphs = text.split('\n\n').filter(p => p.trim());
  const chunks = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    const words = para.split(' ');

    // If a single paragraph is larger than the chunkSize, split it by words
    if (para.length > chunkSize) {
      if (currentChunk.trim()) chunks.push(currentChunk.trim());
      currentChunk = '';

      const subChunks = para.match(new RegExp(`[\\s\\S]{1,${chunkSize}}(\\s|$)`, 'g')) || [];
      chunks.push(...subChunks.map(s => s.trim()));
      continue;
    }

    if ((currentChunk.length + para.length) > chunkSize) {
      if (currentChunk.trim()) chunks.push(currentChunk.trim());
      currentChunk = para;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }

  if (currentChunk.trim()) chunks.push(currentChunk.trim());
  return chunks;
};

export { splitIntoChunks };
