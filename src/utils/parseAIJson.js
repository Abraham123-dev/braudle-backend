export const parseAIJson = (content, defaultValue = {}) => {
  if (!content || typeof content !== 'string') return defaultValue;
  try {
    // Strip reasoning think blocks
    let cleanContent = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (cleanContent.startsWith('<think>')) {
      const thinkEnd = cleanContent.indexOf('</think>');
      if (thinkEnd !== -1) {
        cleanContent = cleanContent.substring(thinkEnd + 8).trim();
      } else {
        cleanContent = '';
      }
    }

    const startObj = cleanContent.indexOf('{');
    const startArr = cleanContent.indexOf('[');
    
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

    for (let i = startIndex; i < cleanContent.length; i++) {
      if (cleanContent[i] === openChar) depth++;
      else if (cleanContent[i] === closeChar) depth--;

      if (depth === 0) {
        endIndex = i;
        found = true;
        break;
      }
    }

    let jsonStr = '';
    if (found) {
      jsonStr = cleanContent.substring(startIndex, endIndex + 1).trim();
    } else {
      // Truncated JSON: take the string to the very end and repair it
      jsonStr = cleanContent.substring(startIndex).trim();
    }

    try {
      return JSON.parse(jsonStr);
    } catch (parseErr) {
      // Basic JSON repair for truncated/malformed responses
      console.warn(`[parseAIJson] Initial parse failed, attempting basic repair...`);
      let repairedStr = jsonStr;
      
      // If it looks like it was truncated inside a string value (odd number of quotes)
      if ((repairedStr.match(/"/g) || []).length % 2 !== 0) {
        // Find trailing fragments and close the quote
        repairedStr = repairedStr.replace(/[,:]\s*$/, '');
        repairedStr += '"';
      }

      // Clean up trailing commas/colons before closing braces
      repairedStr = repairedStr.replace(/,\s*$/, '');

      // Balance braces and brackets
      const openBraces = (repairedStr.match(/{/g) || []).length;
      const closeBraces = (repairedStr.match(/}/g) || []).length;
      const openBrackets = (repairedStr.match(/\[/g) || []).length;
      const closeBrackets = (repairedStr.match(/]/g) || []).length;
      
      if (openBraces > closeBraces) {
        repairedStr += '}'.repeat(openBraces - closeBraces);
      }
      if (openBrackets > closeBrackets) {
        repairedStr += ']'.repeat(openBrackets - closeBrackets);
      }
      
      try {
        return JSON.parse(repairedStr);
      } catch (secondErr) {
        console.error(`[parseAIJson] Repair failed:`, secondErr.message);
        throw parseErr; // Throw original error to be caught by outer catch block
      }
    }
  } catch (err) {
    console.error(`[parseAIJson] Failed to parse AI response:`, err.message);
    return defaultValue;
  }
};