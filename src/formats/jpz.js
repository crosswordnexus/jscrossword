import { maybeUnzipText } from "../lib/maybeUnzip.js";
import { parseXml } from "../lib/xmlparser.js";
import { unescapeHtmlClue } from "../lib/escape.js";
import { xwGrid } from "../grid.js";

/*******************
* JPZ reading/writing functions
*******************/

const imageFormatToMime = {
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export function xw_read_jpz(data) {
  const xmlString = maybeUnzipText(data);

  const doc = parseXml(xmlString);

  const puzzle = doc.querySelector("rectangular-puzzle");
  if (!puzzle) throw new Error("Could not find puzzle data in JPZ");

  // crossword type
  const crossword =
    doc.querySelector("crossword") ||
    doc.querySelector("coded") ||
    doc.querySelector("acrostic");
  if (!crossword) throw new Error("Unsupported crossword type");
  const crossword_type = crossword.nodeName;

  // metadata
  const md = puzzle.querySelector("metadata");
  if (!md) throw new Error("Could not find metadata in JPZ");

  const metadata = {
    title: md.querySelector("title")?.textContent.trim() || "",
    author: md.querySelector("creator")?.textContent.trim() || "",
    copyright: md.querySelector("copyright")?.textContent.trim() || "",
    description: md.querySelector("description")?.textContent.trim() || "",
    intro: puzzle.querySelector("instructions")?.textContent.trim() || "",
    fakeclues: !!md.querySelector("fakeclues"),
    realwords: !!md.querySelector("realwords"),
    autofill: !!md.querySelector("autofill"),
    crossword_type,
  };

  if (metadata.intro && !metadata.description) {
    metadata.description = metadata.intro;
  }

  if (!doc.querySelector("applet-settings")) {
    metadata.has_reveal = true;
  }
  else if (!doc.querySelector("applet-settings solution")) {
    metadata.has_reveal = false;
  }

  const completion = doc.querySelector("completion");
  if (completion) {
    metadata.completion_message = completion.textContent.trim();
  }

  // cells
  const grid = crossword.querySelector("grid");
  metadata.width = Number(grid.getAttribute("width"));
  metadata.height = Number(grid.getAttribute("height"));

  const cells = Array.from(grid.querySelectorAll("cell")).map(cell => {
    const new_cell = {
      x: +cell.getAttribute("x") - 1,
      y: +cell.getAttribute("y") - 1,
      solution: cell.getAttribute("solution"),
      number: cell.getAttribute("number"),
      type: cell.getAttribute("type"),
      "background-color": cell.getAttribute("background-color"),
      "background-shape": cell.getAttribute("background-shape"),
      letter: cell.getAttribute("solve-state"),
      top_right_number: cell.getAttribute("top-right-number"),
      is_void: cell.getAttribute("type") === "void",
      clue: cell.getAttribute("type") === "clue",
      value: null,
    };

    const valueClone = cell.cloneNode(true);
    valueClone.querySelector("background-picture")?.remove();
    const textValue = valueClone.textContent?.trim() || null;
    new_cell.value = textValue;

    const bgPicture = cell.querySelector("background-picture");
    if (bgPicture) {
      const encoded = bgPicture.querySelector("encoded-image")?.textContent?.trim();
      if (encoded) {
        const formatAttr = bgPicture.getAttribute("format")?.toLowerCase();
        const mimeType = formatAttr
          ? imageFormatToMime[formatAttr] ?? `image/${formatAttr}`
          : "image/png";
        new_cell.image = `data:${mimeType};base64,${encoded}`;
      }
    }

    if (cell.getAttribute("hint") === "true") {
      new_cell.letter = new_cell.solution;
    }

    ["top-bar", "bottom-bar", "left-bar", "right-bar"].forEach(dir => {
      if (cell.hasAttribute(dir)) {
        new_cell[dir] = cell.getAttribute(dir) === "true";
      }
    });

    return new_cell;
  });

  // words
  function cells_from_xy(x, y) {
    const word_cells = [];
    const split_x = x.split("-");
    const split_y = y.split("-");
    if (split_x.length > 1) {
      const [x_from, x_to] = split_x.map(Number);
      const y1 = Number(split_y[0]);
      for (let k = x_from; x_from < x_to ? k <= x_to : k >= x_to; x_from < x_to ? k++ : k--) {
        word_cells.push([k - 1, y1 - 1]);
      }
    } else if (split_y.length > 1) {
      const [y_from, y_to] = split_y.map(Number);
      const x1 = Number(split_x[0]);
      for (let k = y_from; y_from < y_to ? k <= y_to : k >= y_to; y_from < y_to ? k++ : k--) {
        word_cells.push([x1 - 1, k - 1]);
      }
    } else {
      word_cells.push([Number(split_x[0]) - 1, Number(split_y[0]) - 1]);
    }
    return word_cells;
  }

  const words = Array.from(crossword.querySelectorAll("word")).map(word => {
    let word_cells = [];
    const x = word.getAttribute("x");
    const y = word.getAttribute("y");
    if (x && y) word_cells = word_cells.concat(cells_from_xy(x, y));
    word.querySelectorAll("cells").forEach(c => {
      word_cells = word_cells.concat(cells_from_xy(c.getAttribute("x"), c.getAttribute("y")));
    });
    return { id: word.getAttribute("id"), cells: word_cells };
  });

  if (!words.length && crossword_type !== "diagramless") {
    const thisGrid = new xwGrid(cells);
    let word_id = 1;
    const acrossEntries = thisGrid.acrossEntries();
    Object.keys(acrossEntries).forEach(i => {
      words.push({
        id: (word_id++).toString(),
        cells: acrossEntries[i].cells,
        dir: "across",
      });
    });
    const downEntries = thisGrid.downEntries();
    Object.keys(downEntries).forEach(i => {
      words.push({
        id: (word_id++).toString(),
        cells: downEntries[i].cells,
        dir: "down",
      });
    });
  }

  // clues
  const clues = [];
  if (crossword_type !== "coded") {
    crossword.querySelectorAll("clues").forEach(clues_block => {
      const title = clues_block.querySelector("title")?.textContent.trim() || "";
      const isFake = clues_block.getAttribute("fake") === "true" ||
                     Boolean(metadata.fakeclues && !metadata.realwords);
      const clueList = Array.from(clues_block.querySelectorAll("clue")).map(clue => {
        let text = clue.innerHTML.trim();
        text = text.replace(/\s+xmlns="[^"]*"/g, "");
        text = unescapeHtmlClue(text);
        const fmt = clue.getAttribute("format");
        if (fmt) text += ` (${fmt})`;
        const wordAttr = clue.getAttribute("word");
        const word = isFake ? null : (wordAttr || null);
        return {
          text,
          word,
          number: clue.getAttribute("number"),
        };
      });
      const clueGroup = { title, clue: clueList };
      if (isFake) clueGroup.fake = true;
      clues.push(clueGroup);
    });
  }

  return { metadata, cells, words, clues };
}

/** Escape special XML characters for attributes and text content. */
function escapeXml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Extract image format (PNG, JPG, etc.) and base64 payload from a data URL or raw string.
 */
function parseImageData(imageData) {
  if (!imageData || typeof imageData !== "string") return null;
  const match = imageData.match(/^data:([^;]+);base64,(.+)$/s);
  if (match) {
    const mime = match[1].toLowerCase();
    const encoded = match[2].trim();
    let format = "PNG";
    if (mime === "image/jpeg" || mime === "image/jpg") format = "JPG";
    else if (mime === "image/gif") format = "GIF";
    else if (mime === "image/bmp") format = "BMP";
    else if (mime === "image/webp") format = "WEBP";
    else if (mime === "image/svg+xml") format = "SVG";
    else if (mime.startsWith("image/")) format = mime.replace("image/", "").toUpperCase();
    return { format, encoded };
  }
  return { format: "PNG", encoded: imageData.trim() };
}

/**
 * Write crossword data to JPZ XML format.
 *
 * @param {Object} metadata - Puzzle metadata (title, author, dimensions, etc.)
 * @param {Array} cells - Grid cells array
 * @param {Array} words - Word entries array (generated automatically if omitted)
 * @param {Array|Object} clues - Clue groups array or object
 * @returns {string} JPZ XML document as a string
 */
function xw_write_jpz(metadata = {}, cells = [], words = [], clues = []) {
  // Support calling as xw_write_jpz({ metadata, cells, words, clues })
  if (metadata && !cells && metadata.metadata && metadata.cells) {
    cells = metadata.cells;
    words = metadata.words;
    clues = metadata.clues;
    metadata = metadata.metadata;
  }

  metadata = metadata || {};
  cells = cells || [];
  words = words ? [...words] : [];

  // Metadata defaults and dimensions
  const crossword_type = metadata.crossword_type || "crossword";
  const width = Number(metadata.width) || (cells.length ? Math.max(...cells.map(c => Number(c.x))) + 1 : 0);
  const height = Number(metadata.height) || (cells.length ? Math.max(...cells.map(c => Number(c.y))) + 1 : 0);
  const has_reveal = metadata.has_reveal !== false;
  const completionMessage = metadata.completion_message || metadata.completion || "";
  const creator = metadata.author || metadata.creator || "";
  const title = metadata.title || "";
  const copyright = metadata.copyright || "";
  const description = metadata.description || "";
  const createdAt = metadata.created_at || metadata.date || "";
  const intro = metadata.intro || metadata.instructions || "";

  const bodyTag = crossword_type;

  // Sort cells by x then y (column by column) to match standard JPZ layout
  const sortedCells = [...cells].sort((a, b) => {
    if (a.x !== b.x) return a.x - b.x;
    return a.y - b.y;
  });

  // Build <cell> elements
  const cellsXml = sortedCells.map(cell => {
    const x = Number(cell.x) + 1;
    const y = Number(cell.y) + 1;
    let attrs = `x="${x}" y="${y}"`;

    if (cell.type) {
      attrs += ` type="${escapeXml(cell.type)}"`;
    } else if (cell.is_void) {
      attrs += ` type="void"`;
    } else if (cell.solution === ".") {
      attrs += ` type="block"`;
    } else if (cell.clue) {
      attrs += ` type="clue"`;
    }

    if (cell.solution && cell.solution !== "." && cell.type !== "block" && !cell.is_void) {
      attrs += ` solution="${escapeXml(cell.solution)}"`;
    }
    if (cell.number != null && cell.number !== "") {
      attrs += ` number="${escapeXml(String(cell.number))}"`;
    }

    const bgColor = cell["background-color"] || cell.background_color;
    if (bgColor) attrs += ` background-color="${escapeXml(bgColor)}"`;

    const bgShape = cell["background-shape"] || cell.background_shape;
    if (bgShape) attrs += ` background-shape="${escapeXml(bgShape)}"`;

    const solveState = cell.letter || cell["solve-state"];
    if (solveState) attrs += ` solve-state="${escapeXml(solveState)}"`;

    const trNum = cell.top_right_number || cell["top-right-number"];
    if (trNum != null && trNum !== "") attrs += ` top-right-number="${escapeXml(String(trNum))}"`;

    if (cell.hint) attrs += ` hint="true"`;

    ["top-bar", "bottom-bar", "left-bar", "right-bar"].forEach(dir => {
      if (cell[dir]) attrs += ` ${dir}="true"`;
    });

    let bgPicXml = "";
    if (cell.image) {
      const img = parseImageData(cell.image);
      if (img) {
        bgPicXml = `                  <background-picture format="${escapeXml(img.format)}">\n                        <encoded-image>${img.encoded}</encoded-image>\n                    </background-picture>`;
      }
    }

    const textValue = cell.value != null && cell.value !== "" ? escapeXml(cell.value) : "";

    if (bgPicXml && textValue) {
      return `                <cell ${attrs}>\n${bgPicXml}\n                    ${textValue}\n                </cell>`;
    } else if (bgPicXml) {
      return `                <cell ${attrs}>\n${bgPicXml}\n                </cell>`;
    } else if (textValue) {
      return `                <cell ${attrs}>${textValue}</cell>`;
    } else {
      return `                <cell ${attrs}/>`;
    }
  }).join("\n");

  // Build <word> elements
  const wordsXml = (words || []).map(word => {
    const wordCells = (word.cells || []).map(c => {
      const cx = (Array.isArray(c) ? c[0] : c.x) + 1;
      const cy = (Array.isArray(c) ? c[1] : c.y) + 1;
      return `                <cells x="${cx}" y="${cy}"/>`;
    }).join("\n");
    return `            <word id="${escapeXml(String(word.id))}">\n${wordCells}\n            </word>`;
  }).join("\n");

  // Build <clues> blocks (omitted for coded crosswords)
  let cluesXml = "";
  if (crossword_type !== "coded") {
    let clueGroups = [];
    if (Array.isArray(clues)) {
      clueGroups = clues;
    } else if (clues && typeof clues === "object") {
      clueGroups = Object.entries(clues).map(([title, clueList]) => ({
        title,
        clue: clueList,
      }));
    }

    cluesXml = clueGroups.map(group => {
      const isFake = group.fake === true || Boolean(metadata.fakeclues && !metadata.realwords);
      const fakeAttr = isFake ? ' fake="true"' : "";
      const titleXml = group.title ? `                <title>${escapeXml(group.title)}</title>\n` : "";
      const clueList = group.clue || group.clues || [];

      const itemsXml = clueList.map(c => {
        let number = "";
        let text = "";
        let word = "";
        let format = "";
        if (typeof c === "string") {
          text = c;
        } else if (Array.isArray(c)) {
          number = c[0] != null ? String(c[0]) : "";
          text = c[1] != null ? String(c[1]) : "";
        } else if (c && typeof c === "object") {
          number = c.number != null ? String(c.number) : "";
          text = c.text ?? c.clue ?? "";
          word = isFake ? "" : (c.word != null ? String(c.word) : "");
          format = c.format != null ? String(c.format) : "";
        }

        let attrs = "";
        if (number) attrs += ` number="${escapeXml(number)}"`;
        if (word) attrs += ` word="${escapeXml(word)}"`;
        if (format) attrs += ` format="${escapeXml(format)}"`;

        if (text) {
          return `                <clue${attrs}>${escapeXml(text)}</clue>`;
        }
        return `                <clue${attrs}/>`;
      }).join("\n");

      return `            <clues${fakeAttr}>\n${titleXml}${itemsXml}\n            </clues>`;
    }).join("\n");
  }

  // Assemble the full JPZ XML document
  const parts = [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<crossword-compiler-applet\n    xmlns="http://crossword.info/xml/crossword-compiler">`,
    `    <applet-settings cursor-color="#ffff00" selected-cells-color="#00ff00">`,
    `        <actions buttons-layout="left">`,
    `            <reveal-word label="Reveal Word"/>`,
    `            <reveal-letter label="Reveal Letter"/>`,
    `            <check label="Check"/>`,
    ...(has_reveal ? [`            <solution label="Solution"/>`] : []),
    `            <pencil label="Pencil"/>`,
    `        </actions>`,
    ...(completionMessage ? [`        <completion only-if-correct="true">${escapeXml(completionMessage)}</completion>`] : []),
    `    </applet-settings>`,
    `    <rectangular-puzzle\n        xmlns="http://crossword.info/xml/rectangular-puzzle">`,
    ...(intro ? [`        <instructions>${escapeXml(intro)}</instructions>`] : []),
    `        <metadata>`,
    ...(creator ? [`            <creator>${escapeXml(creator)}</creator>`] : []),
    ...(completionMessage ? [`            <completion>${escapeXml(completionMessage)}</completion>`] : []),
    ...(copyright ? [`            <copyright>${escapeXml(copyright)}</copyright>`] : []),
    description ? `            <description>${escapeXml(description)}</description>` : `            <description/>`,
    ...(createdAt ? [`            <created_at>${escapeXml(createdAt)}</created_at>`] : []),
    ...(title ? [`            <title>${escapeXml(title)}</title>`] : []),
    `            <type>${escapeXml(crossword_type)}</type>`,
    ...(metadata.fakeclues ? [`            <fakeclues/>`] : []),
    ...(metadata.realwords ? [`            <realwords/>`] : []),
    ...(metadata.autofill ? [`            <autofill/>`] : []),
    `        </metadata>`,
    `        <${bodyTag}>`,
    `            <grid width="${width}" height="${height}">`,
    cellsXml,
    `            </grid>`,
    ...(wordsXml ? [wordsXml] : []),
    ...(cluesXml ? [cluesXml] : []),
    `        </${bodyTag}>`,
    `    </rectangular-puzzle>`,
    `</crossword-compiler-applet>`,
    ``
  ];

  return parts.join("\n");
}

export { xw_write_jpz };
