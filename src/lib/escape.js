// lib/escape.js
// -----------------------------------------------------------------------------
// Minimal HTML decoding helper for JSCrossword
// -----------------------------------------------------------------------------

import { parseHTML } from "linkedom";

let decodeDocument = null;

/**
 * Decode HTML entities (used when reading formats like JPZ or CFP).
 * Works in both browser and Node environments.
 *
 * In browser: uses the real document.
 * In Node: lazily creates a lightweight LinkeDOM document on first call.
 */
export function unescapeHtmlClue(safe = "") {
  if (!safe) return "";

  if (!decodeDocument) {
    if (typeof window !== "undefined" && window.document) {
      decodeDocument = document;
    } else {
      const { document } = parseHTML("<!doctype html><html><body></body></html>");
      decodeDocument = document;
    }
  }

  const el = decodeDocument.createElement("textarea");
  el.innerHTML = safe;
  return el.textContent;
}
