import jsPDF from "jspdf/dist/jspdf.es.min.js";
import twemoji from "twemoji";
import { DOMParserImpl } from "../lib/xmlparser.js";

// tell if we're in browser or node
const isBrowser = (typeof window !== "undefined" && typeof document !== "undefined");
const isNode = (typeof process !== "undefined" && process.versions?.node);

const DEFAULT_FONT_TYPE = 'helvetica';

// default character to print when we don't have a number
const DEFAULT_NUM = '•'

const emojiImageCache = new Map();
const emojiRx = /\p{Extended_Pictographic}(?:\p{Emoji_Modifier})?/u;

const PARSER = new DOMParserImpl();

const clueParseCache = new Map(); // reuse DOM parses across layout attempts

const pdfTimingEnabled = (() => {
  if (typeof process !== "undefined" && process.env?.JSCROSSWORD_PDF_TIMING === '1') {
    return true;
  }
  if (typeof globalThis !== "undefined" && globalThis.__JSCROSSWORD_PDF_TIMING__) {
    return true;
  }
  return false;
})();

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function logDocWithCluesTime(label, durationMs) {
  console.debug(`[xw_pdf timing] ${label}: ${durationMs.toFixed(1)}ms`);
}

/** Helper function to grab textContent **/
function safeHtmlText(html) {
  if (!html) return "";
  const doc = PARSER.parseFromString(`<div>${html}</div>`, "text/html");
  return doc.documentElement?.textContent || "";
}

// --- Lightweight GraphemeSplitter replacement using Intl.Segmenter ---
const splitGraphemes = (str) => {
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return [...segmenter.segment(str)].map(s => s.segment);
  }
  // Fallback: not perfect for emoji with skin tones/ZWJ, but safe
  return Array.from(str);
};

// Cache the DOM parse / grapheme extraction so repeated measurements reuse the same arrays
function parseClueMarkup(clue) {
  if (clueParseCache.has(clue)) {
    return clueParseCache.get(clue);
  }
  const htmlDoc = PARSER.parseFromString(clue, "text/html");
  const clean_clue = safeHtmlText(clue);
  const split_clue = traverseTree(htmlDoc);
  const parsed = { clean_clue, split_clue };
  clueParseCache.set(clue, parsed);
  return parsed;
}

/** Helper function to sanitize Unicode for jsPDF-safe output **/
function foldReplacing(str, fallback = '*') {
  // Quick helpers
  const isAsciiOrLatin1 = (cp) => (cp <= 0x7F) || (cp >= 0x00A0 && cp <= 0x00FF);

  const stripCombiningMarks = (s) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const replacements = {
    // Curly single quotes / apostrophes
    '‘': "'", '’': "'", '‚': ',', '‛': "'",

    // Curly double quotes
    '“': '"', '”': '"', '„': '"', '‟': '"',

    // Dashes / hyphens / minus
    '–': '-', '—': '-', '−': '-', '‒': '-', '―': '-',

    // Ellipsis
    '…': '...',

    // Bullets and similar
    '•': '*', '◦': '*', '▪': '*', '·': '*', '∙': '*',

    // Spaces
    '\u00A0': ' ',           // NBSP
    '\u2009': ' ',           // thin space
    '\u200A': ' ',           // hair space
    '\u202F': ' ',           // narrow no-break space
    '\u200B': '',            // zero-width space
    '\u2060': '',            // word joiner

    // Common symbols that often appear in text
    '©': '(c)', '®': '(R)', '™': '(TM)',
    '°': ' deg ',            // optional: you may prefer "°" if it renders for you
    '×': 'x',
    '÷': '/',
    '≠': '!=',
    '≤': '<=',
    '≥': '>=',
    '≈': '~',
    '…': '...',

    // Currency (core fonts usually don’t do € reliably)
    '€': 'EUR',
    '£': 'GBP',
    '¥': 'JPY',

    // Fractions
    '½': '1/2',
    '¼': '1/4',
    '¾': '3/4',

    // Arrows (often unsupported)
    '→': '->',
    '←': '<-',
    '↔': '<->',
    '⇒': '=>',
    '⇐': '<=',
  };

  // Chars that don't decompose the way we want (or decompose to something odd)
  const specialFold = {
    'ß': 'ss',
    'Æ': 'AE', 'æ': 'ae',
    'Œ': 'OE', 'œ': 'oe',
    'Ø': 'O',  'ø': 'o',
    'Đ': 'D',  'đ': 'd',
    'Ł': 'L',  'ł': 'l',
    'Þ': 'Th', 'þ': 'th',
    'İ': 'I',  'ı': 'i',
    'Ŋ': 'N',  'ŋ': 'n',
  };

  return Array.from(str).map(c => {
    if (typeof emojiRx !== 'undefined' && emojiRx.test(c)) return c; // preserve emoji

    // 1) Direct replacements first
    if (replacements[c]) return replacements[c];
    if (specialFold[c]) return specialFold[c];

    const cp = c.codePointAt(0);

    // 2) Keep ASCII + Latin-1 (é lives here: U+00E9)
    if (isAsciiOrLatin1(cp)) return c;

    // 3) Try stripping diacritics (Ś -> S). Works for most accented Latin letters.
    const de = stripCombiningMarks(c);
    if (de !== c) {
      // Only keep if result is now ASCII/Latin-1 (sometimes it's still exotic)
      for (const dch of de) {
        const dcp = dch.codePointAt(0);
        if (!isAsciiOrLatin1(dcp)) return fallback;
      }
      return de;
    }

    // 4) Give up
    return fallback;
  }).join('');
}



/* Helper function to fetch a data URL */
async function fetchAsDataURL(url, mime = "image/png") {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);

  if (isBrowser) {
    const blob = await resp.blob();
    const reader = new FileReader();
    return await new Promise((resolve, reject) => {
      reader.onerror = reject;
      reader.onloadend = () => resolve(reader.result); // data: URL
      reader.readAsDataURL(blob);
    });
  } else if (isNode) {
    const ab = await resp.arrayBuffer();
    const b64 = Buffer.from(ab).toString("base64");
    return `data:${mime};base64,${b64}`;
  } else {
    // Very defensive fallback
    const ab = await resp.arrayBuffer();
    const b64 = Buffer.from(ab).toString("base64");
    return `data:${mime};base64,${b64}`;
  }
}

async function preloadEmojiImages(charList) {
  const twemojiBase = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/";
  const uniqueEmoji = [...new Set(charList.filter(c => emojiRx.test(c)))];

  const tasks = [];
  for (const emoji of uniqueEmoji) {
    if (emojiImageCache.has(emoji)) continue;
    const codepoint = twemoji.convert.toCodePoint(emoji);
    const url = `${twemojiBase}${codepoint}.png`;
    tasks.push(
      fetchAsDataURL(url, "image/png")
        .then(dataUrl => emojiImageCache.set(emoji, dataUrl))
        .catch(err => console.warn(`Could not load emoji ${emoji}:`, err))
    );
  }
  await Promise.all(tasks);
}


/** Wrapper for the above function **/
async function preloadFromClueArrays(clueArrays) {
  const flatText = clueArrays.flat().join("\n");
  const graphemes = splitGraphemes(flatText);
  const emojiChars = [...new Set(graphemes.filter(g => emojiRx.test(g)))];
  await preloadEmojiImages(emojiChars);
}

/** Helper functions for splitting text with tags **/
// function to traverse DOM tree
function traverseTree(htmlDoc, agg = []) {
  if (htmlDoc.nodeName === '#text') {
    const thisTag = htmlDoc.parentNode?.tagName || "";
    const is_bold = thisTag === "B";
    const is_italic = thisTag === "I";

    const text = htmlDoc.nodeValue || "";
    const graphemes = splitGraphemes(text);

    graphemes.forEach(char => {
      agg.push({
        char,
        is_bold,
        is_italic,
        is_emoji: emojiRx.test(char),
      });
    });
  }

  const children = htmlDoc.childNodes || [];
  for (let i = 0; i < children.length; i++) {
    agg = traverseTree(children[i], agg);
  }

  return agg;
}

// Print a line of text that may be bolded or italicized
const printCharacters = (doc, textObject, startY, startX, fontSize, font_type = DEFAULT_FONT_TYPE, emojiSize = fontSize) => {
  if (!textObject.length) return;

  if (typeof textObject === 'string') {
    const myText = foldReplacing(textObject);
    doc.text(startX, startY, myText);
    return;
  }

  textObject.forEach(row => {
    const char = foldReplacing(row.char);
    const is_bold = row.is_bold;
    const is_italic = row.is_italic;
    const is_emoji = row.is_emoji;

    if (is_emoji) {
      const emojiData = emojiImageCache.get(char);
      if (emojiData) {
        doc.addImage(emojiData, 'PNG', startX, startY - emojiSize + 2, emojiSize, emojiSize);
        startX += emojiSize;
      } else {
        doc.text('**', startX, startY);
        startX += doc.getTextWidth('**');
      }
    } else {
      doc.setFont(font_type,
        is_bold ? 'bold' :
        is_italic ? 'italic' : 'normal');

      doc.text(char, startX, startY);
      startX = startX + doc.getStringUnitWidth(row.char) * fontSize;
      doc.setFont(font_type, 'normal');
    }

    doc.setFont(font_type, 'normal');
  });
};

// helper function for bold/italic/emoji clues
function split_text_to_size_bi(
  clue,
  col_width,
  doc,
  has_header = false,
  font_type = DEFAULT_FONT_TYPE
) {
  // --- Handle header first ---
  let header_line = null;
  if (has_header) {
    const clue_split = clue.split("\n");
    header_line = clue_split[0];
    clue = clue_split.slice(1).join("\n");
  }

  // --- Parse clue into DOM + plain text ---
  const { clean_clue, split_clue } = parseClueMarkup(clue);

  // --- Quick checks ---
  const containsBold = clue.toUpperCase().includes("<B");
  const containsItalic = clue.toUpperCase().includes("<I");
  const containsEmoji = emojiRx.test(clean_clue);

  // --- Fast path: no markup, no emoji, no hyphens
  if (!containsBold && !containsItalic && !containsEmoji && !clean_clue.includes("-") ) {
    let lines = doc.splitTextToSize(clean_clue, col_width);
    if (has_header) lines = [header_line].concat(lines);
    return lines;
  }

  // --- Emoji only ---
  if (!containsBold && !containsItalic && containsEmoji) {
    let lines = doc.splitTextToSize(clean_clue, col_width).map(line =>
      splitGraphemes(line).map(char => ({
        char,
        is_bold: false,
        is_italic: false,
        is_emoji: emojiRx.test(char)
      }))
    );
    if (has_header) lines = [header_line].concat(lines);
    return lines;
  }

  // --- Formatting only (no emoji) ---
  if ((containsBold || containsItalic) && !containsEmoji) {
    doc.setFont(font_type, "bold");
    const wrapped = doc.splitTextToSize(clean_clue, col_width);
    doc.setFont(font_type, "normal");

    let ctr = 0;
    const SPLIT_CHARS = new Set([" ", "\t", "\n", "-"]);
    const lines = wrapped.map(line => {
      const thisLine = [];
      for (let i = 0; i < line.length; i++) {
        thisLine.push(split_clue[ctr++]);
      }
      if (split_clue[ctr] && SPLIT_CHARS.has(split_clue[ctr].char)) {
        ctr++;
      }
      return thisLine;
    });

    if (has_header) return [header_line].concat(lines);
    return lines;
  }

  // --- Mixed emoji + formatting ---
  const measured_chunks = [];
  const chunk_map = [];

  for (let i = 0; i < split_clue.length;) {
    const c = split_clue[i];
    if (c.is_emoji) {
      measured_chunks.push(c.char);
      chunk_map.push([i]);
      i++;
    } else {
      let acc = "";
      const indices = [];
      while (i < split_clue.length && !split_clue[i].is_emoji) {
        acc += split_clue[i].char;
        indices.push(i);
        i++;
      }
      acc.split(/([\-\s]+)/).forEach(word => {
        if (word) {
          measured_chunks.push(word);
          chunk_map.push(indices.splice(0, word.length));
        }
      });
    }
  }

  doc.setFont(font_type, "bold");
  const wrapped_lines = [];
  const wrapped_maps = [];
  let currentLine = "";
  let currentMap = [];

  for (let j = 0; j < measured_chunks.length; j++) {
    const chunk = measured_chunks[j];
    const testLine = currentLine + chunk;
    if (doc.getTextWidth(testLine) > col_width && currentLine !== "") {
      wrapped_lines.push(currentLine);
      wrapped_maps.push(currentMap);
      currentLine = chunk;
      currentMap = chunk_map[j];
    } else {
      currentLine += chunk;
      currentMap = currentMap.concat(chunk_map[j]);
    }
  }
  if (currentLine) {
    wrapped_lines.push(currentLine);
    wrapped_maps.push(currentMap);
  }
  doc.setFont(font_type, "normal");

  let lines = wrapped_maps.map(map =>
    map.map(i => split_clue[i]).filter(Boolean)
  );

  if (has_header) lines = [header_line].concat(lines);
  return lines;
}


/** Draw a crossword grid (requires jsPDF) **/
function draw_crossword_grid(doc, xw, options) {
  /*
   *  doc is a jsPDF instance
   * xw is a JSCrossword instance
   */

  function parseImageFormat(dataUrl) {
    if (typeof dataUrl !== "string") {
      return "PNG";
    }
    var match = /^data:image\/([^;]+);base64,/i.exec(dataUrl);
    if (!match) {
      return "PNG";
    }
    var format = match[1].toUpperCase().split("+")[0];
    return format === "JPG" ? "JPEG" : format;
  }

  // options are as below
  var DEFAULT_OPTIONS = {
    grid_letters: true,
    grid_numbers: true,
    x0: 20,
    y0: 20,
    cell_size: 24,
    gray: null,
    line_width: 0.7,
    bar_width: 2.5
  };

  for (var key in DEFAULT_OPTIONS) {
    if (!DEFAULT_OPTIONS.hasOwnProperty(key)) continue;
    if (!options.hasOwnProperty(key)) {
      options[key] = DEFAULT_OPTIONS[key];
    }
  }

  // If there's an image, draw it and return
  if (xw.metadata.image) {
    var imageFormat = parseImageFormat(xw.metadata.image);
    doc.addImage(xw.metadata.image, imageFormat, options.x0, options.y0, xw.metadata.width * options.cell_size, xw.metadata.height * options.cell_size);
    return;
  }

  var PTS_TO_IN = 72;
  var cell_size = options.cell_size;

  /** Function to draw a square **/
  function draw_square(doc, x1, y1, cell_size, number, letter, filled, cell, barsOnly = false) {

    if (!barsOnly) {
      // thank you https://stackoverflow.com/a/5624139
      function hexToRgb(hex) {
        hex = hex || '#FFFFFF';
        // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
        var shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
        hex = hex.replace(shorthandRegex, function(m, r, g, b) {
          return r + r + g + g + b + b;
        });


        var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16)
        } : null;
      }

      var MIN_NUMBER_SIZE = 4;

      var filled_string = (filled ? 'F' : 'S');
      var number_offset = cell_size / 20;
      var number_size = cell_size / 3.5 < MIN_NUMBER_SIZE ? MIN_NUMBER_SIZE : cell_size / 3.5;
      //var letter_size = cell_size/1.5;
      var letter_length = letter.length;
      var letter_size = cell_size / (1.5 + 0.5 * (letter_length - 1));
      var letter_pct_down = 4 / 5;

      // for "clue" cells we set the background and text color
      doc.setTextColor(0, 0, 0);
      if (cell.clue) {
        //doc.setTextColor(255, 255, 255);
        cell['background-color'] = '#CCCCCC';
      }

      if (cell['background-color']) {
        var filled_string = 'F';
        var rgb = hexToRgb(cell['background-color']);
        doc.setFillColor(rgb.r, rgb.g, rgb.b);
        doc.setDrawColor(options.gray.toString());
        // Draw one filled square and then one unfilled
        doc.rect(x1, y1, cell_size, cell_size, filled_string);
        doc.rect(x1, y1, cell_size, cell_size);
      } else {
        doc.setFillColor(options.gray.toString());
        doc.setDrawColor(options.gray.toString());
        // draw the bounding box for all squares -- even "clue" squares
        if (true) {
          doc.rect(x1, y1, cell_size, cell_size);
          doc.rect(x1, y1, cell_size, cell_size, filled_string);
        }
      }
      //numbers
      doc.setFont(options.font_type, 'normal');
      doc.setFontSize(number_size);
      //number = ASCIIFolder.foldReplacing(number);
      doc.text(x1 + number_offset, y1 + number_size, number);

      // top-right numbers
      var top_right_number = cell.top_right_number ? cell.top_right_number : '';
      doc.setFontSize(number_size);
      //top_right_number = ASCIIFolder.foldReplacing(top_right_number);
      doc.text(x1 + cell_size - number_offset, y1 + number_size, top_right_number, null, null, 'right');

      // letters
      doc.setFont(options.font_type, 'normal');
      doc.setFontSize(letter_size);
      doc.text(x1 + cell_size / 2, y1 + cell_size * letter_pct_down, letter, null, null, 'center');

      // circles
      if (cell['background-shape']) {
        doc.circle(x1 + cell_size / 2, y1 + cell_size / 2, cell_size / 2);
      }
    }
    // bars
    cell.bar = {
      top: cell['top-bar'],
      left: cell['left-bar'],
      right: cell['right-bar'],
      bottom: cell['bottom-bar']
    };
    if (cell.bar) {
      var bar = cell.bar;
      var bar_start = {
        top: [x1, y1],
        left: [x1, y1],
        right: [x1 + cell_size, y1 + cell_size],
        bottom: [x1 + cell_size, y1 + cell_size]
      };
      var bar_end = {
        top: [x1 + cell_size, y1],
        left: [x1, y1 + cell_size],
        right: [x1 + cell_size, y1],
        bottom: [x1, y1 + cell_size]
      };
      for (var key in bar) {
        if (bar.hasOwnProperty(key)) {
          if (bar[key]) {
            doc.setLineWidth(options.bar_width);
            doc.line(bar_start[key][0], bar_start[key][1], bar_end[key][0], bar_end[key][1]);
            doc.setLineWidth(options.line_width);
          }
        }
      }
    }
    // Reset the text color, if necessary
    doc.setTextColor(0, 0, 0);
  } // end draw_square()

  var width = xw.metadata.width;
  var height = xw.metadata.height;
  xw.cells.forEach(function(c) {
    // don't draw a square if we have a void
    if (c.is_void || (c.type === 'block' && c['background-color'] === '#FFFFFF')) {
      return;
    }
    var x_pos = options.x0 + c.x * cell_size;
    var y_pos = options.y0 + c.y * cell_size;
    // letter
    var letter = c.solution || '';
    if (!options.grid_letters) {
      letter = '';
    }
    letter = letter || c.letter || '';
    var filled = c.type == 'block';
    // number
    var number = c['number'] || '';
    if (!options.grid_numbers) {
      number = '';
    }
    // circle
    var circle = c['background-shape'] == 'circle';
    // draw the square
    // for diagramless puzzles don't put anything but the square
    if (xw.metadata.crossword_type == 'diagramless') {
      number = '';
      letter = '';
      filled = false;
    }
    draw_square(doc, x_pos, y_pos, cell_size, number, letter, filled, c);
  });

  // Draw just the bars afterward
  // This is necessary because we may have overwritten bars earlier
  xw.cells.forEach(function(c) {
    var x_pos = options.x0 + c.x * cell_size;
    var y_pos = options.y0 + c.y * cell_size;
    draw_square(doc, x_pos, y_pos, cell_size, '', '', false, c, true);
  });
}

/**
 * Helper function to make a grid with clues
 **/
function doc_with_clues(xw, options, doc_width, doc_height, clue_arrays, num_arrays, gridProps, columnsPreSet = false) {
  const cluePtMin = options.min_clue_pt;
  const cluePtMax = options.max_clue_pt;
  const guessCluePt = (cluePtMin + cluePtMax) / 2.0;

  var max_title_author_pt = options.max_title_pt;
  const col_width = gridProps.col_width;
  const grid_ypos = gridProps.grid_ypos;
  const has_top_header_row = (options.header1 || options.header2) ? 1 : 0;

  const layoutWithCluePt = (testPt) => {
    const doc = new jsPDF(options.orientation, 'pt', 'letter');
    const clue_padding = testPt / options.clue_padding_denominator;
    doc.setFontSize(testPt);
    doc.setLineWidth(options.line_width);

    const max_clue_num_length = xw.clues.map(x => x.clue).flat().map(x => x.number).map(x => x.length).reduce((a, b) => Math.max(a, b));
    const num_margin = doc.getTextWidth('9'.repeat(max_clue_num_length));
    let num_xpos = options.margin + num_margin;
    const line_margin = 1.5 * doc.getTextWidth(' ');
    let line_xpos = num_xpos + line_margin;
    const top_line_ypos = options.margin +
      has_top_header_row * (max_title_author_pt + options.vertical_separator) +
      max_title_author_pt +
      options.vertical_separator * 2 +
      testPt + clue_padding;
    let line_ypos = top_line_ypos;
    let my_column = 0;

    for (let k = 0; k < clue_arrays.length; k++) {
      const clues = clue_arrays[k];
      const nums = num_arrays[k];
      for (let i = 0; i < clues.length; i++) {
        const clue = clues[i];
        const num = nums[i];

        const max_line_ypos = my_column < options.num_full_columns
          ? doc_height - options.margin - options.max_title_pt - 2 * options.vertical_separator
          : grid_ypos - options.grid_padding;

        const lines = split_text_to_size_bi(clue, col_width - (num_margin + line_margin), doc, i == 0, options.font_type);

        if (line_ypos + (lines.length - 1) * (testPt + clue_padding) > max_line_ypos) {
          my_column += 1;
          num_xpos = options.margin + num_margin + my_column * (col_width + options.column_padding);
          line_xpos = num_xpos + line_margin;
          line_ypos = top_line_ypos;
          if (clue === '') {
            continue;
          }
        }

        for (let j = 0; j < lines.length; j++) {
          const line = lines[j];
          if (i == 0 && j == 0) {
            doc.setFont(options.font_type, 'bold');
            printCharacters(doc, line, line_ypos, line_xpos, testPt, options.font_type);
            doc.setFont(options.font_type, 'normal');
            line_ypos += clue_padding;
          } else {
            if (j == 0 || (i == 0 && j == 1)) {
              doc.setFont(options.font_type, 'bold');
              doc.text(num_xpos, line_ypos, num, null, null, "right");
              doc.setFont(options.font_type, 'normal');
            }
            doc.setFont(options.font_type, 'normal');
            printCharacters(doc, line, line_ypos, line_xpos, testPt, options.font_type);
          }
          line_ypos += testPt + clue_padding;
        }
        line_ypos += clue_padding;
      }
    }

    const too_small = testPt < options.min_clue_pt && options.num_pages < 2 && !columnsPreSet;
    const overflow = my_column > options.num_columns - 1;
    let reason = null;
    if (too_small) reason = 'clue pt below minimum';
    else if (overflow) reason = 'column overflow';
    else reason = 'success';

    return {
      doc,
      clue_pt: (!too_small && !overflow) ? testPt : null,
      success: !too_small && !overflow,
      reason
    };
  };

  let bestResult = null;
  let low = cluePtMin;
  let high = cluePtMax;
  let guess = guessCluePt;
  for (let i = 0; i < 5; i++) {
    const attempt = layoutWithCluePt(guess);
    if (attempt.success) {
      // This attempt is best if it has a bigger font than a previous attempt
      if (!bestResult || attempt.clue_pt > bestResult.clue_pt) {
        bestResult = attempt;
      }
      low = guess;
    } else {
      high = guess;
    }
    guess = (low + high) / 2;
  }

  if (!bestResult) {
    bestResult = layoutWithCluePt(low);
  }

  return bestResult;

}

/**
 * Helper function to return parameters of a grid
 * (grid_width, grid_height, cell_size)
 * given the options and the number of columns
 **/
function grid_props(xw, options, doc_width, doc_height) {
  // size of columns
  var col_width = (doc_width - 2 * options.margin - (options.num_columns - 1) * options.column_padding) / options.num_columns;

  // The grid is under all but the first few columns
  var grid_width = doc_width - 2 * options.margin - options.num_full_columns * (col_width + options.column_padding);
  var grid_height = (grid_width / xw.metadata.width) * xw.metadata.height;

  // We change the grid width and height if num_full_columns == 0
  // This is because we don't want it to take up too much space
  if (options.num_full_columns === 0 || options.num_pages == 2) {
    // set the height to be (about) half of the available area
    grid_height = doc_height * 4 / 9;
    // If there are very few clues we can increase the grid height
    if (xw.clues.length < 10) {
      grid_height = doc_height * 2 / 3;
    }
    if (options.num_pages == 2) {
      grid_height = doc_height - (2 * options.margin + 3 * options.max_title_pt + 4 * options.vertical_separator + 3 * options.notepad_max_pt);
    }
    grid_width = (grid_height / xw.metadata.height) * xw.metadata.width;
    // however! if this is bigger than allowable, re-calibrate
    if (grid_width > (doc_width - 2 * options.margin)) {
      grid_width = (doc_width - 2 * options.margin);
      grid_height = (grid_width / xw.metadata.width) * xw.metadata.height;
    }

    // we shouldn't let the squares get too big
    var cell_size = grid_width / xw.metadata.width;
    if (cell_size > options.max_cell_size) {
      cell_size = options.max_cell_size;
      grid_height = cell_size * xw.metadata.height;
      grid_width = cell_size * xw.metadata.width;
    }
  }

  // We don't show the notepad if there isn't one
  if (!xw.metadata.description) {
    options.show_notepad = false;
  }

  // x and y position of grid
  // Reserve spot for the notepad
  var notepad_ypos = doc_height - options.margin - options.max_title_pt - options.vertical_separator * 2;
  var notepad_xpos;

  var notepad_height = 0;
  // helper value for multiplying
  var show_notepad_int = options.show_notepad ? 1 : 0;

  var grid_xpos = doc_width - options.margin - grid_width;
  var grid_ypos = notepad_ypos - show_notepad_int * (options.vertical_separator + notepad_height) - grid_height;

  var notepad_xpos = doc_width - options.margin - grid_width / 2;

  // we change the x position of the grid if there are no full columns
  // or if we're printing on two pages
  // specifically, we want to center it.
  if (options.num_full_columns == 0 || options.num_pages == 2) {
    grid_xpos = (doc_width - grid_width) / 2;
    notepad_xpos = doc_width / 2;
  }

  // if there are no clues at all, center the y-position too
  if (!xw.clues.length || options.num_pages == 2) {
    grid_ypos = (doc_height - grid_height) / 2;
  }

  // Determine how much space to set aside for the notepad
  var notepad_height = 0;
  if (options.show_notepad) {
    var doc1 = new jsPDF(options.orientation, 'pt', 'letter');
    const notepad_width = grid_width - 20;
    doc1.setFontSize(options.notepad_min_pt);
    var num_notepad_lines = doc1.splitTextToSize(xw.metadata.description, notepad_width).length;

    doc1.setFont(options.font_type, 'italic');
    var notepad_pt = options.notepad_max_pt;
    doc1.setFontSize(notepad_pt);
    var notepad_lines = doc1.splitTextToSize(xw.metadata.description, notepad_width);
    while (notepad_lines.length > num_notepad_lines) {
      notepad_pt -= 0.2;
      doc1.setFontSize(notepad_pt);
      notepad_lines = doc1.splitTextToSize(xw.metadata.description, notepad_width);
    }
    var notepad_adj = (num_notepad_lines > 1 ? 1.1 : 1.2);
    notepad_height = num_notepad_lines * notepad_pt * notepad_adj;
  }
  grid_ypos -= notepad_height;

  // Set the cell size
  var cell_size = grid_width / xw.metadata.width;

  const myObj = {
    grid_xpos: grid_xpos,
    grid_ypos: grid_ypos,
    grid_width: grid_width,
    grid_height: grid_height,
    col_width: col_width,
    notepad_height: notepad_height,
    notepad_pt: notepad_pt,
    cell_size: cell_size,
    notepad_lines: notepad_lines,
    notepad_xpos: notepad_xpos,
    notepad_ypos: notepad_ypos
  }
  return myObj;
}

/** Helper function to load an image and get its dimensions **/
async function loadImage(base64Image) {
  if (isBrowser) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.onerror = reject;
      img.src = base64Image;
    });
  } else {
    // Node fallback (requires npm install image-size)
    const { imageSize } = await import("image-size");
    const buf = Buffer.from(base64Image.split(",")[1], "base64");
    const dims = imageSize(buf);
    return { width: dims.width, height: dims.height };
  }
}

/** Create a PDF with possibly an image **/
// in xw_pdf.js
export async function jscrossword_to_pdf(xw, options = {}) {
  if (!xw.metadata.image) {
    return await jscrossword_to_pdf2(xw, options);
  } else {
    try {
      const dimensions = await loadImage(xw.metadata.image);
      const minDimension = 17;
      if (dimensions.width < dimensions.height) {
        xw.metadata.width = minDimension;
        xw.metadata.height = (minDimension * dimensions.height) / dimensions.width;
      } else {
        xw.metadata.height = minDimension;
        xw.metadata.width = (minDimension * dimensions.width) / dimensions.height;
      }
      return await jscrossword_to_pdf2(xw, options);
    } catch (error) {
      console.error("Failed to load image:", error);
      return null;
    }
  }
}

/** Create a PDF (requires jsPDF) **/
async function jscrossword_to_pdf2(xw, options = {}) {
  var DEFAULT_OPTIONS = {
    margin: 40,
    title_pt: null,
    copyright_pt: null,
    num_columns: null,
    num_full_columns: null,
    num_pages: 1,
    column_padding: 10,
    gray: null,
    under_title_spacing: 20,
    max_clue_pt: 14,
    min_clue_pt: 8,
    grid_padding: 5,
    outfile: null,
    vertical_separator: 10,
    show_notepad: false,
    line_width: 0.7,
    notepad_max_pt: 12,
    notepad_min_pt: 8,
    orientation: 'portrait',
    header1: '',
    header2: '',
    header3: '',
    max_cell_size: 30,
    min_cell_size: 15,
    max_title_pt: 12,
    max_columns: 5,
    min_columns: 2,
    min_grid_size: 240,
    clue_padding_denominator: 3,
    font_type: DEFAULT_FONT_TYPE,
    print: false
  };

  var clue_length = xw.clues.map(x => x.clue).flat().map(x => x.text).join('').length;

  for (var key in DEFAULT_OPTIONS) {
    if (!DEFAULT_OPTIONS.hasOwnProperty(key)) continue;
    if (!options.hasOwnProperty(key)) {
      options[key] = DEFAULT_OPTIONS[key];
    }
  }

  // Sorry big titles but we need a max size here
  const MAX_TITLE_PT = options.max_title_pt;
  if (options.title_pt > MAX_TITLE_PT) {
    options.title_pt = MAX_TITLE_PT;
  }
  if (options.copyright_pt > MAX_TITLE_PT) {
    options.copyright_pt = MAX_TITLE_PT;
  }

  var PTS_PER_IN = 72;
  var DOC_WIDTH = 8.5 * PTS_PER_IN;
  var DOC_HEIGHT = 11 * PTS_PER_IN;
  // wide puzzles get printed in landscape
  if (options.orientation == 'landscape' || xw.metadata.width >= 30) {
    DOC_WIDTH = 11 * PTS_PER_IN;
    DOC_HEIGHT = 8.5 * PTS_PER_IN;
    options.orientation = 'landscape';
  } else {
    options.orientation = 'portrait';
  }


  var margin = options.margin;

  var xw_height = xw.metadata.height;
  var xw_width = xw.metadata.width;

  // If there's no filename, use the title
  if (!options.outfile) {
    var outname = xw.metadata.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.pdf';
    options.outfile = outname;
  }

  // variables used in for loops
  var i, j;

  // If options.gray is NULL, we determine it
  if (options.gray === null) {
    options.gray = 0.5; // default
    // If there are very few black squares, we can make darker
    var num_black_squares = xw.cells.map(x => x.type).reduce(function(accum, cur) {
      return accum + (cur === 'block' ? 1 : 0);
    }, 0);
    if (num_black_squares / (xw_height * xw_width) < 0.05) {
      options.gray = 0.1;
    }
  }

  // If options.num_columns is null, we determine it ourselves
  var possibleColumns = [];
  var columnsPreSet = false;
  if (options.num_columns === null || options.num_full_columns === null) {
    // special logic for two pages
    if (options.num_pages == 2 || !xw.clues.length) {
      var numCols = Math.min(Math.ceil(clue_length / 800), 5);
      options.num_columns = numCols;
      options.num_full_columns = numCols;
      possibleColumns.push({
        num_columns: numCols,
        num_full_columns: numCols
      });
    } else {
      for (var nc = options.min_columns; nc <= options.max_columns; nc++) {
        for (var fc = 0; fc <= nc - 1; fc++) {
          // make the grid and check the cell size
          options.num_columns = nc;
          options.num_full_columns = fc;
          var gp = grid_props(xw, options, DOC_WIDTH, DOC_HEIGHT);
          // we ignore "min_grid_size" for now
          if (gp.cell_size >= options.min_cell_size) {
            possibleColumns.push({
              num_columns: nc,
              num_full_columns: fc
            });
          }
        }
      }
    }
  } else {
    columnsPreSet = true;
    possibleColumns = [{
      num_columns: options.num_columns,
      num_full_columns: options.num_full_columns
    }];
  }

  // The maximum font size of title and author
  var max_title_author_pt = MAX_TITLE_PT;
  var doc, docObj;

  // create the clue strings and clue arrays
  var clue_arrays = [];
  var num_arrays = [];
  for (j = 0; j < xw.clues.length; j++) {
    var these_clues = [];
    var these_nums = [];
    for (i = 0; i < xw.clues[j]['clue'].length; i++) {
      var e = xw.clues[j]['clue'][i];
      // if no number, default to a bullet
      var num = e.number || DEFAULT_NUM;
      var clue = e.text;
      // for acrostics, we don't print a clue without a "number"
      if (xw.metadata.crossword_type == 'acrostic' && num == DEFAULT_NUM) {
        continue;
      }

      //var this_clue_string = num + '. ' + clue;
      var this_clue_string = clue;
      if (i == 0) {
        these_clues.push(xw.clues[j].title + '\n' + this_clue_string);
      } else {
        these_clues.push(this_clue_string);
      }
      these_nums.push(num);
    }
    // add a space between the clue lists, assuming we're not at the end
    if (j < xw.clues.length - 1) {
      these_clues.push('');
      these_nums.push('');
    }
    clue_arrays.push(these_clues);
    num_arrays.push(these_nums);
  }

  // Update the emoji mapper
  await preloadFromClueArrays(clue_arrays);

  // Loop through and write to PDF if we find a good fit
  // Find an appropriate font size
  // don't do this if there are no clues
  doc = new jsPDF(options.orientation, 'pt', 'letter');
  const ideal_clue_pt = 12.5;
  const ideal_cell_size = (options.max_cell_size + options.min_cell_size) / 2.5;
  let ideal_grid_area = ideal_cell_size * ideal_cell_size * xw_height * xw_width;
  if (ideal_grid_area < DOC_WIDTH * DOC_HEIGHT * 0.25) {
    ideal_grid_area = DOC_WIDTH * DOC_HEIGHT * 0.25;
  } else if (ideal_grid_area > DOC_WIDTH * DOC_HEIGHT * 0.4) {
    ideal_grid_area = DOC_WIDTH * DOC_HEIGHT * 0.4;
  }
  const maxClueChars = Math.max(1, clue_length);
  let selectedDoc = null;
  let bestVal = Infinity;
  if (xw.clues.length) {
    possibleColumns.forEach(function(pc) {
      options.num_columns = pc.num_columns;
      options.num_full_columns = pc.num_full_columns;
      const gridProps = grid_props(xw, options, DOC_WIDTH, DOC_HEIGHT);
      if (gridProps.cell_size < options.min_cell_size) {
        if (pdfTimingEnabled) {
          console.debug(`[xw_pdf skip candidate] ${pc.num_columns}/${pc.num_full_columns}: cell_size ${gridProps.cell_size.toFixed(2)} < min ${options.min_cell_size}`);
        }
        return;
      }
      const columnWidth = (DOC_WIDTH - 2 * options.margin - (pc.num_columns - 1) * options.column_padding) / pc.num_columns;
      let fullColumnHeight = DOC_HEIGHT - options.margin - options.max_title_pt - 2 * options.vertical_separator;
      if (fullColumnHeight < 0) fullColumnHeight = 0;
      const partialColumnHeight = Math.max(0, gridProps.grid_ypos - options.grid_padding);
      const fullColumns = pc.num_full_columns;
      const partialColumns = Math.max(0, pc.num_columns - fullColumns);
      const availableArea = columnWidth * (fullColumns * fullColumnHeight + partialColumns * partialColumnHeight);
      const areaPerChar = availableArea / maxClueChars;
      const estimatedCluePt = Math.max(options.min_clue_pt, Math.min(options.max_clue_pt, 0.0272 * areaPerChar + 6.21));
      const start = pdfTimingEnabled ? now() : 0;
      docObj = doc_with_clues(xw, options, DOC_WIDTH, DOC_HEIGHT, clue_arrays, num_arrays, gridProps, columnsPreSet, estimatedCluePt);
      if (pdfTimingEnabled) {
        logDocWithCluesTime(`doc_with_clues ${pc.num_columns}/${pc.num_full_columns}`, now() - start);
      }
      if (docObj.clue_pt) {
        if (pdfTimingEnabled) {
          console.log(
            `[xw_pdf clue pt] ${pc.num_columns}/${pc.num_full_columns}: ` +
            `estimate ${estimatedCluePt.toFixed(2)} actual ${docObj.clue_pt.toFixed(2)}`
          );
        }
        const actualGridArea = gridProps.grid_width * gridProps.grid_height;
        let actualVal = ((actualGridArea - ideal_grid_area) / ideal_grid_area) ** 2 +
          ((docObj.clue_pt - ideal_clue_pt) / ideal_clue_pt) ** 2;
        if (pc.num_columns) {
          actualVal += pc.num_columns / 500;
        }
        if (actualVal < bestVal) {
          bestVal = actualVal;
          selectedDoc = {
            docObj,
            gridProps,
            columns: pc
          };
        }
      } else if (pdfTimingEnabled) {
        console.warn(`[xw_pdf layout fail] ${pc.num_columns}/${pc.num_full_columns}: ${docObj.reason}`);
      }
    });
  } else {
    var gridProps = grid_props(xw, options, DOC_WIDTH, DOC_HEIGHT);
    const start = pdfTimingEnabled ? now() : 0;
    docObj = doc_with_clues(xw, options, DOC_WIDTH, DOC_HEIGHT, clue_arrays, num_arrays, gridProps, columnsPreSet, ideal_clue_pt);
    if (pdfTimingEnabled) {
      logDocWithCluesTime("doc_with_clues (no clues)", now() - start);
    }
    selectedDoc = {
      docObj: docObj,
      gridProps: gridProps,
      columns: {}
    };
  }

  // If there are no possibilities here go to two pages
  if (!selectedDoc) {
    var numCols = Math.min(Math.ceil(clue_length / 800), 5);
    options.num_columns = numCols;
    options.num_full_columns = numCols;
    options.num_pages = 2;
    var gridProps = grid_props(xw, options, DOC_WIDTH, DOC_HEIGHT);
    const start = pdfTimingEnabled ? now() : 0;
    docObj = doc_with_clues(xw, options, DOC_WIDTH, DOC_HEIGHT, clue_arrays, num_arrays, gridProps, false, ideal_clue_pt);
    if (pdfTimingEnabled) {
      logDocWithCluesTime("doc_with_clues (two pages)", now() - start);
    }
    var pc = {
      num_columns: numCols,
      num_full_columns: numCols
    };
    selectedDoc = {
      docObj: docObj,
      gridProps: gridProps,
      columns: pc
    };
  }

  doc = selectedDoc.docObj.doc;
  var gridProps = selectedDoc.gridProps;
  var grid_xpos = gridProps.grid_xpos
  var grid_ypos = gridProps.grid_ypos;
  var grid_width = gridProps.grid_width;
  var grid_height = gridProps.grid_height;
  var notepad_height = gridProps.notepad_height;
  var notepad_pt = gridProps.notepad_pt;
  var cell_size = gridProps.cell_size;
  var notepad_lines = gridProps.notepad_lines;
  var notepad_xpos = gridProps.notepad_xpos;
  var notepad_ypos = gridProps.notepad_ypos;

  /***********************/

  // If title_pt is null, we determine it
  var DEFAULT_TITLE_PT = MAX_TITLE_PT;
  var total_width = DOC_WIDTH - 2 * margin;
  if (!options.title_pt) {
    options.title_pt = DEFAULT_TITLE_PT;
    var finding_title_pt = true;
    while (finding_title_pt) {
      var header1_header2 = options.header1 + 'ABCDEFGH' + options.header2;
      var title_header3 = xw.metadata.title + 'ABCDEFGH' + options.header3;
      doc.setFontSize(options.title_pt).setFont(options.font_type, 'bold');
      var lines1 = doc.splitTextToSize(header1_header2, DOC_WIDTH);
      var lines2 = doc.splitTextToSize(title_header3, DOC_WIDTH);
      if (lines1.length == 1 && lines2.length == 1) {
        finding_title_pt = false;
      } else {
        options.title_pt -= 1;
      }
    }
  }
  // same for copyright
  if (!options.copyright_pt) {
    options.copyright_pt = DEFAULT_TITLE_PT;
    var finding_title_pt = true;
    while (finding_title_pt) {
      var author_copyright = xw.metadata.author + 'ABCDEFGH' + xw.metadata.copyright;
      doc.setFontSize(options.copyright_pt).setFont(options.font_type, 'normal');
      var lines1 = doc.splitTextToSize(author_copyright, DOC_WIDTH);
      if (lines1.length == 1) {
        finding_title_pt = false;
      } else {
        options.title_pt -= 1;
      }
    }
  }



  /* Render headers and footers */
  function renderHeaders(page = 1) {
    var title_xpos = margin;
    var author_xpos = DOC_WIDTH - margin;
    var title_author_ypos = margin + max_title_author_pt;
    var right_xpos = DOC_WIDTH - margin;

    if (options.header1 || options.header2) {
      doc.setFontSize(options.title_pt);
      doc.setFont(options.font_type, 'bold');
      doc.text(title_xpos, title_author_ypos, safeHtmlText(options.header1));
      doc.text(right_xpos, title_author_ypos, safeHtmlText(options.header2), null, null, 'right');
      title_author_ypos += max_title_author_pt + options.vertical_separator;
    }

    //title
    doc.setFontSize(options.title_pt);
    doc.setFont(options.font_type, 'bold');
    doc.text(title_xpos, title_author_ypos, safeHtmlText(xw.metadata.title));
    if (options.header3) {
      doc.text(right_xpos, title_author_ypos, safeHtmlText(options.header3), null, null, 'right');
    }

    // Draw a line under the headers
    var line_x1 = margin;
    var line_x2 = DOC_WIDTH - margin;
    var line_y = title_author_ypos + options.vertical_separator;
    doc.line(line_x1, line_y, line_x2, line_y);

    /* Render copyright */
    var copyright_xpos = DOC_WIDTH - margin;
    var copyright_ypos = DOC_HEIGHT - margin;
    doc.setFontSize(options.copyright_pt);
    doc.setFont(options.font_type, 'normal');
    doc.text(copyright_xpos, copyright_ypos, safeHtmlText(xw.metadata.copyright), null, null, 'right');

    /* Render author */
    var author_xpos = margin;
    var author_ypos = copyright_ypos;
    doc.setFontSize(options.copyright_pt);
    doc.setFont(options.font_type, 'normal');
    doc.text(author_xpos, author_ypos, safeHtmlText(xw.metadata.author));

    /* Draw a line above the copyright */
    var line2_x1 = line_x1;
    var line2_x2 = line_x2;
    var line2_y = copyright_ypos - options.copyright_pt - options.vertical_separator;
    doc.line(line2_x1, line2_y, line2_x2, line2_y);

    /* Render notepad */
    if (options.show_notepad && page == 1) {
      doc.setFont(options.font_type, 'italic');
      doc.setFontSize(notepad_pt);
      // We can move notepad_ypos up a bit depending on notepad_pt
      //notepad_ypos = grid_ypos + grid_height + options.vertical_separator + (notepad.max_pt + notepad_pt)/2;
      notepad_ypos = grid_ypos + grid_height + options.vertical_separator + notepad_pt;
      notepad_lines.forEach(function(notepad1) {
        doc.text(notepad_xpos, notepad_ypos, notepad1, null, null, 'center');
        notepad_ypos += notepad_pt;
      });
      doc.setFont(options.font_type, 'normal');

      // Draw a rectangle around the notepad
      var notepad_rect_y = grid_ypos + grid_height + options.vertical_separator;
      var notepad_rect_x = grid_xpos;
      var notepad_rect_w = grid_width;
      var notepad_rect_h = notepad_height;
      var notepad_rect_radius = notepad_pt / 2.5;
      doc.roundedRect(notepad_rect_x, notepad_rect_y, notepad_rect_w, notepad_rect_h, notepad_rect_radius, notepad_rect_radius);

    }
  } // end renderHeaders()

  // Add headers to new page
  if (options.num_pages == 1) {
    renderHeaders(1);
  } else {
    // we do page 2 first because we switch the pages later
    renderHeaders(2);
    doc.addPage();
    renderHeaders(1);
  }

  /* Draw grid */

  var grid_options = {
    grid_letters: false,
    grid_numbers: true,
    x0: grid_xpos,
    y0: grid_ypos,
    cell_size: grid_width / xw_width,
    gray: options.gray,
    image: xw.metadata.image
  };
  draw_crossword_grid(doc, xw, grid_options);

  if (options.num_pages == 2) {
    doc.movePage(2, 1);
  }

  return doc;
}
