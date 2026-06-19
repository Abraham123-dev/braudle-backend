import { env } from '../config/env.js';

const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';

/**
 * Searches YouTube for educational videos related to a concept.
 * Uses the YouTube Data API v3. Returns the top result as a structured object.
 *
 * Used by the AI tutor to suggest real video links when a topic benefits
 * from visual explanation. NOT called every session — only when the AI prompt
 * explicitly requests an enrichment resource.
 *
 * @param {string} query - The search query (concept name or topic)
 * @param {number} maxResults - Max number of results to return (default 1 for inline suggestions)
 * @returns {Promise<Array<{title, url, thumbnail, channelTitle}>>} Video results
 */
export const searchYouTube = async (query, maxResults = 1) => {
  // Graceful degradation: if no API key configured, return empty array silently
  if (!env.youtube.apiKey) {
    return [];
  }

  const params = new URLSearchParams({
    part: 'snippet',
    q: `${query} explanation tutorial`,
    type: 'video',
    maxResults: String(maxResults),
    safeSearch: 'strict',
    relevanceLanguage: 'en',
    key: env.youtube.apiKey,
  });

  try {
    const response = await fetch(`${YOUTUBE_SEARCH_URL}?${params.toString()}`);

    if (!response.ok) {
      // Quota exceeded or invalid key — fail silently (don't crash the tutor)
      console.warn(`[YOUTUBE] Search failed (${response.status}) for query: "${query}"`);
      return [];
    }

    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      return [];
    }

    return data.items.map((item) => ({
      title: item.snippet.title,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      thumbnail: item.snippet.thumbnails?.medium?.url || null,
      channelTitle: item.snippet.channelTitle,
    }));
  } catch (err) {
    // Network error — fail silently, tutor continues without the video
    console.error('[YOUTUBE] Search error:', err.message);
    return [];
  }
};

/**
 * Formats a YouTube result into a tutoring-friendly markdown string.
 * Designed to be embedded inline in AI responses.
 *
 * @param {{title, url, channelTitle}} video
 * @returns {string}
 */
export const formatVideoSuggestion = (video) => {
  if (!video) return '';
  return `\n\n🎥 **Watch to understand this better:**\n[${video.title}](${video.url}) — *${video.channelTitle}*`;
};
