# Scalable Document OCR Implementation Plan

## Problem Statement

When you upload an image-based PDF (like a scanned textbook), the system attempts to extract text. If it finds auto-generated page numbers, it bypasses the OCR fallback. If the fallback does trigger, it renders the PDF to memory (crashing on large files) and truncates to 10 pages.

You want it to be **fast and reliable**, use **existing models**, and perfectly **follow your AI Gateway structure** so that if the primary provider hits a limit, it gracefully falls back to your other providers.

## The Solution: Gateway-Routed PDF Extraction

We will create a new function `extractPDFTextGateway` inside `ai.service.js` that mirrors your existing `generateAIResponse` loop. 
1. **Primary (OpenRouter):** OpenRouter natively supports raw PDF file uploads in its API. It will process all 151+ pages instantly without memory spikes.
2. **Fallbacks (Groq, Mistral, Nvidia):** If OpenRouter returns a transient error (e.g. 429 Rate Limit), the gateway catches it and falls back. Since the fallback models don't support raw PDFs natively, the gateway will gracefully slice the first 10 pages into images (preventing memory crashes) and pass them to the fallback vision models to ensure the extraction still succeeds.

## Proposed Changes

---

### Backend Worker Logic
Update the `document.worker.js` file to route scanned PDFs through the new gateway.

#### [MODIFY] [document.worker.js](file:///c:/Users/USER/braudle-backend/src/workers/document.worker.js)
1. **Smarter Fallback Trigger:** 
   Update the condition to calculate text density. 
   `if (cleanText.length / pdfData.numpages < 100)` 
   If a PDF yields less than 100 characters per page on average, we classify it as a scanned document requiring OCR.
2. **Call the Gateway:**
   Replace the raw `pdf-to-png-converter` block with a single call:
   `extractedText = await AIService.extractPDFTextGateway(fileBuffer, documentId);`

#### [MODIFY] [ai.service.js](file:///c:/Users/USER/braudle-backend/src/services/ai.service.js)
1. **New Gateway Method:**
   Create `extractPDFTextGateway(fileBuffer, filename)`.
2. **Gateway Loop:**
   Implement the exact same `for (const provider of providers)` loop used in `generateAIResponse`.
   ```javascript
   const providers = ['openrouter', 'groq', 'mistral', 'nvidia'];
   ```
3. **Provider-Specific Handling:**
   - **If OpenRouter:** Convert `fileBuffer` to base64, wrap in `{ type: "file", file: { file_data: ... } }`, and send.
   - **If Fallback (Groq/Mistral/etc):** Run `pdf-to-png-converter` for the first 10 pages (to protect memory), convert to base64, and send to the respective provider's vision model.
4. **Error Handling:**
   Use the existing `isTransientError` and `logFallback` utilities to ensure it behaves exactly like the rest of your AI infrastructure.

## Verification Plan

### Automated Tests
- Run backend linting.

### Manual Verification
- Upload the 11MB (151-page) PDF.
- Verify in the console logs that `[EXTRACT PDF]` is routed to OpenRouter.
- Temporarily invalidate the OpenRouter key to test the gateway fallback and verify it successfully routes to Groq Vision as a fallback without crashing the server.
