// Splits text into chunks for AI processing
// Note: Updated to word-based chunking for more stable AI context windows.
// Target: ~400 words per chunk.

const splitIntoChunks = (text, wordLimit = 300) => {
  if (!text || text.length === 0) return [];
  
  const paragraphs = text.split('\n\n').filter(p => p.trim());
  const chunks = [];
  let currentChunk = '';
  let currentWordCount = 0;

 for (const para of paragraphs) {
  const words = para.split(/\s+/);
  const wordCount = words.length;

  if (wordCount > wordLimit) {
    if (currentChunk.trim()) chunks.push(currentChunk.trim());

    currentChunk = '';
    currentWordCount = 0;

    for (let i = 0; i < words.length; i += wordLimit) {
      chunks.push(words.slice(i, i + wordLimit).join(' '));
    }

    continue;
  }

  if ((currentWordCount + wordCount) > wordLimit) {
    if (currentChunk.trim()) chunks.push(currentChunk.trim());

    currentChunk = para;
    currentWordCount = wordCount;
  } else {
    currentChunk += (currentChunk ? '\n\n' : '') + para;
    currentWordCount += wordCount;
  }
}

  if (currentChunk.trim()) chunks.push(currentChunk.trim());
  return chunks;
};

export { splitIntoChunks };
