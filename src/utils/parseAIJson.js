/**
 * Centralized utility to extract and parse JSON from AI string responses.
 * AI models often include conversational filler or markdown blocks.
 * @param {string} content - The raw string from the AI.
 * @param {any} defaultValue - Fallback value if parsing fails.
 * @returns {any} The parsed JSON object or the default value.
 */
export const parseAIJson = (content, defaultValue = {}) => {
  if (!content || typeof content !== 'string') return defaultValue;
  try {
    const startObj = content.indexOf('{');
    const startArr = content.indexOf('[');
    
    if (startObj === -1 && startArr === -1) return defaultValue;
    
    let startIndex = -1;
    let openChar = '';
    let closeChar = '';
    
    if (startObj !== -1 && (startArr === -1 || startObj < startArr)) {
      startIndex = startObj;
      openChar = '{';
      closeChar = '}';
    } else {
      startIndex = startArr;
      openChar = '[';
      closeChar = ']';
    }

    let depth = 0;
    let found = false;
    let endIndex = -1;

    for (let i = startIndex; i < content.length; i++) {
      if (content[i] === openChar) depth++;
      else if (content[i] === closeChar) depth--;

      if (depth === 0) {
        endIndex = i;
        found = true;
        break;
      }
    }

    if (!found) throw new Error('Unbalanced or missing braces/brackets');

    const jsonStr = content.substring(startIndex, endIndex + 1).trim();
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error(`[parseAIJson] Failed to parse AI response:`, err.message);
    return defaultValue;
  }
};