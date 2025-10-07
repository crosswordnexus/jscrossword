/**
 * xmlparser.js
 *
 * Provides a unified DOMParser:
 *  - Browser: native DOMParser
 *  - Node: linkedom DOMParser
 */
import * as linkedom from "linkedom";

let DOMParserImpl;

if (typeof window !== "undefined" && typeof window.DOMParser !== "undefined") {
  // ✅ Browser
  DOMParserImpl = window.DOMParser;
} else {
  // ✅ Node
  DOMParserImpl = linkedom.DOMParser;
}

export { DOMParserImpl };

/**
 * Parse XML string into a DOM Document
 */
export function parseXml(xmlString) {
  const parser = new DOMParserImpl();
  return parser.parseFromString(xmlString, "application/xml");
}

/**
 * Helpers for safe tag access
 */
export function getText(root, tag) {
  const el = root.getElementsByTagName(tag)[0];
  return el ? el.textContent : "";
}

export function getAttr(root, tag, attr) {
  const el = root.getElementsByTagName(tag)[0];
  return el ? el.getAttribute(attr) : null;
}
