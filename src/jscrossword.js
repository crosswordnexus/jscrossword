import { xw_read_cfp, xw_write_cfp } from "./formats/cfp.js";
import { xw_read_ipuz, xw_write_ipuz } from "./formats/ipuz.js";
import { xw_read_jpz, xw_write_jpz } from "./formats/jpz.js";
import { xw_read_puz } from "./formats/puz.js";
import { xw_read_rg } from "./formats/rg.js";
import { jscrossword_to_pdf } from "./lib/xw_pdf.js";
import { xwGrid } from "./grid.js";

import createDOMPurify from "dompurify";
import { parseHTML } from "linkedom";

import LZString from "lz-string";

export default class JSCrossword {
  /*
   * metadata: title, author, copyright, description (notes),
   *           height, width, crossword_type
   * cells:    array of cell objects
   * words:    array of {id, cells}
   * clues:    array of {title, clue: [...]}
   */
  constructor(metadata, cells, words, clues) {
    this.metadata = metadata;
    this.cells = cells;
    this.words = words;
    this.clues = clues;

    this.sanitize();  // ensure safe strings
  }

 /**
 * Sanitize all user-facing strings in metadata and clues.
 *
 * Uses DOMPurify to remove unsafe HTML while preserving formatting tags
 * like <i>, <b>, <sup>, <sub>, and <span>.
 *
 * Called automatically in the constructor, but can also be called
 * manually if raw puzzle data is mutated later.
 */
 sanitize() {
  const md = this.metadata;

  // Pick a DOMPurify window for either browser or Node
  let purifyWindow;
  if (typeof window !== "undefined" && window.document) {
    // Browser
    purifyWindow = window;
  } else {
    // Node — use linkedom to create a lightweight DOM
    const { window: lw } = parseHTML("<!doctype html><html><body></body></html>");
    purifyWindow = lw;
  }

  const DOMPurify = createDOMPurify(purifyWindow);

  // Strip all HTML from metadata (plain text only)
  const cleanText = s => DOMPurify.sanitize(s || "", { ALLOWED_TAGS: [] });

  md.title = cleanText(md.title);
  md.author = cleanText(md.author);
  md.copyright = cleanText(md.copyright);
  md.description = cleanText(md.description);
  if (md.intro) md.intro = cleanText(md.intro);
  if (md.completion_message) md.completion_message = cleanText(md.completion_message);

  // Allow limited formatting tags for clues
  const purifierOptions = {
    ALLOWED_TAGS: ["i", "b", "sup", "sub", "span"],
    ALLOWED_ATTR: ["class", "style"],
  };

  this.clues.forEach(clueList => {
    clueList.title = cleanText(clueList.title || "");
    clueList.clue.forEach(c => {
      c.text = DOMPurify.sanitize(c.text || "", purifierOptions);
    });
  });
}


  /** set has_check and has_reveal as needed **/
  set_check_reveal() {
    const all_letters = new Set(this.cells.map(x => x.solution));
    if (all_letters.size <= 2) {
      this.metadata.has_check = false;
      this.metadata.has_reveal = false;
    }
  }

  /** Create a solution array **/
  create_solution_array() {
    const { height: h, width: w } = this.metadata;
    const solutionArray = Array.from({ length: h }, () =>
      Array.from({ length: w }, () => false)
    );
    this.cells.forEach(c => {
      solutionArray[c.y][c.x] = c.solution;
    });
    this.solution_array = solutionArray;
  }

  /** Get the solution array **/
  get_solution_array() {
    if (!this.solution_array) this.create_solution_array();
    return this.solution_array;
  }

  /** Create a mapping of word ID to entry (or cells) **/
  create_entry_mapping(cells = false) {
    const soln_arr = this.get_solution_array();
    const entryMapping = {};
    this.words.forEach(w => {
      if (cells) {
        entryMapping[w.id] = w.cells;
      } else {
        let entry = "";
        w.cells.forEach(([x, y]) => {
          entry += soln_arr[y][x];
        });
        entryMapping[w.id] = entry;
      }
    });
    this.entry_mapping = entryMapping;
  }

  get_entry_mapping(cells = false) {
    if (!this.entry_mapping) this.create_entry_mapping(cells);
    return this.entry_mapping;
  }

  // ---- Factories (static) ----
  static readCFP(xmlString, options = {}) {
    const { metadata, cells, words, clues } = xw_read_cfp(xmlString);
    return new JSCrossword(metadata, cells, words, clues);
  }

  static readJPZ(data, options = {}) {
    const { metadata, cells, words, clues } = xw_read_jpz(data);
    return new JSCrossword(metadata, cells, words, clues);
  }

  static readPUZ(data, options = {}) {
    const { metadata, cells, words, clues } = xw_read_puz(data, options);
    return new JSCrossword(metadata, cells, words, clues);
  }

  static readIPUZ(data, options = {}) {
    const { metadata, cells, words, clues } = xw_read_ipuz(data);
    return new JSCrossword(metadata, cells, words, clues);
  }

  static readRG(data, options = {}) {
    const { metadata, cells, words, clues } = xw_read_rg(data);
    return new JSCrossword(metadata, cells, words, clues);
  }

  static READERS = [
    JSCrossword.readPUZ,
    JSCrossword.readJPZ,
    JSCrossword.readIPUZ,
    JSCrossword.readCFP,
    JSCrossword.readRG
  ];

  /**
   * Attempt to parse `data` with the available readers and return a JSCrossword.
   *
   * The `options` object is forwarded to each reader (readPUZ, readJPZ, readIPUZ, etc.)
   * so format-specific readers can take appropriate actions (for example, how to
   * handle locked PUZ files).
   *
   * Supported options:
   * @param {Object} options
   * @param {"allow"|"mask"|"bruteforce"} [options.lockedHandling="allow"]
   *        How to treat locked PUZ files:
   *          - "allow"      : return parsed data as-is (may contain scrambled letters).
   *          - "mask"       : replace all solution letters with `maskChar` and set metadata.locked = true.
   *          - "bruteforce" : attempt to recover real solutions (descrambler or solver). May time out/fail.
   *
   * @param {string} [options.maskChar="X"]
   *        Character used when lockedHandling === "mask".
   *
   * @param {number} [options.maxBruteForceTimeMs=30000]
   *        Time budget (ms) for any brute-force/solver-based unlock attempts.
   *
   * Notes:
   *  - All keys in `options` are forwarded unchanged to the reader functions
   *    (e.g., `xw_read_puz(data, options)`), so readers may accept additional
   *    format-specific options beyond those documented here.
   *  - On success, the returned JSCrossword will have metadata.locked and
   *    metadata.lockedHandling set when applicable so callers can inspect what
   *    action (if any) was taken.
   *
   * Example:
   *   const js = JSCrossword.fromData(buffer, {
   *     lockedHandling: "mask",
   *     maskChar: "?",
   *   });
   */
  static fromData(data, options = {}) {
    const errors = [];
    for (const reader of JSCrossword.READERS) {
      try {
        const js = reader(data, options);
        js.set_check_reveal();
        return js;
      } catch (err) {
        //console.log(err);
      }
    }
    throw new Error("Unknown puzzle format.");
  }

  async toPDF(options = {}) {
    return await jscrossword_to_pdf(this, options); // returns jsPDF instance
  }

  /**
   * Control what gets serialized when JSON.stringify(this) is called.
   * Only include the basics; derived fields (solution_array, entry_mapping)
   * are excluded since they can be regenerated.
   */
  toJSON() {
    return {
      metadata: this.metadata,
      cells: this.cells,
      words: this.words,
      clues: this.clues
    };
  }

  /**
   * Instance method: serialize this crossword into compressed, URI-safe string.
   */
  serialize() {
    // remove some NULL stuff
    const json = JSON.stringify(this, (key, value) =>
      value === null ? undefined : value
    );
    return LZString.compressToEncodedURIComponent(json);
  }

  /**
   * Static method: deserialize a compressed string back into a JSCrossword.
   */
  static deserialize(param) {
    const json = LZString.decompressFromEncodedURIComponent(param);
    const obj = JSON.parse(json);
    return new JSCrossword(obj.metadata, obj.cells, obj.words, obj.clues);
  }

  /**
   * Write data for downloads
   **/
  toJPZString() {
    return xw_write_jpz(this.metadata, this.cells, this.words, this.clues);
  }

  toIpuzString() {
    return xw_write_ipuz(this.metadata, this.cells, this.words, this.clues);
  }

  toCFPString() {
    return xw_write_cfp(this.metadata, this.cells, this.words, this.clues);
  }

  /* xwGrid */
  grid() {
    return new xwGrid(this.cells);
  }

  static xwGrid(cells) {
    return new xwGrid(cells);
  }

}
