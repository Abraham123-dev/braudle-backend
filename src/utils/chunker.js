// Splits text into chunks for AI processing
// Note: Updated to word-based chunking for more stable AI context windows.
// Target: ~400 words per chunk.

const splitIntoChunks = (text, wordLimit = 300) => {
  if (!text || text.length === 0) return [];
  
  const paragraphs = text.split('\n\n').filter(p => p.trim());
  const chunks = [];
  let currentChunk = [];
  let currentWordCount = 0;

  const getWordCount = (str) => str.split(/\s+/).filter(Boolean).length;

  for (const para of paragraphs) {
    const paraWordCount = getWordCount(para);

    // If paragraph fits, add it to current chunk
    if (currentWordCount + paraWordCount <= wordLimit) {
      currentChunk.push(para);
      currentWordCount += paraWordCount;
      continue;
    }

    // It doesn't fit. Save current chunk if not empty
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n\n'));
      currentChunk = [];
      currentWordCount = 0;
    }

    // If the paragraph itself is larger than the limit, split it by sentences
    if (paraWordCount > wordLimit) {
      // Split by sentence boundaries (.?! followed by whitespace)
      const sentences = para.split(/(?<=[.!?])\s+/);
      let sentenceChunk = [];
      let sentenceWordCount = 0;

      for (const sentence of sentences) {
        const sentenceWords = getWordCount(sentence);

        if (sentenceWordCount + sentenceWords <= wordLimit) {
          sentenceChunk.push(sentence);
          sentenceWordCount += sentenceWords;
        } else {
          if (sentenceChunk.length > 0) {
            chunks.push(sentenceChunk.join(' '));
          }

          // If a single sentence is somehow longer than wordLimit, chunk it by words
          if (sentenceWords > wordLimit) {
            const words = sentence.split(/\s+/);
            for (let i = 0; i < words.length; i += wordLimit) {
              chunks.push(words.slice(i, i + wordLimit).join(' '));
            }
            sentenceChunk = [];
            sentenceWordCount = 0;
          } else {
            sentenceChunk = [sentence];
            sentenceWordCount = sentenceWords;
          }
        }
      }

      if (sentenceChunk.length > 0) {
        currentChunk = [sentenceChunk.join(' ')];
        currentWordCount = sentenceWordCount;
      }
    } else {
      // Paragraph fits in a new chunk
      currentChunk = [para];
      currentWordCount = paraWordCount;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n\n'));
  }

  return chunks;
};

export { splitIntoChunks };
