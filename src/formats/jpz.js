import { maybeUnzipText } from "../lib/maybeUnzip.js";
import { parseXml } from "../lib/xmlparser.js";
import { unescapeHtmlClue } from "../lib/escape.js";

/*******************
* JPZ reading/writing functions
*******************/

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
    crossword_type,
  };

  if (metadata.intro && !metadata.description) {
    metadata.description = metadata.intro;
  }

  if (!doc.querySelector("applet-settings solution")) {
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
      value: cell.textContent?.trim() || null,
    };

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

  // clues
  const clues = [];
  if (crossword_type !== "coded") {
    crossword.querySelectorAll("clues").forEach(clues_block => {
      const title = clues_block.querySelector("title")?.textContent.trim() || "";
      const clueList = Array.from(clues_block.querySelectorAll("clue")).map(clue => {
        let text = clue.innerHTML.trim();
        text = text.replace(/\s+xmlns="[^"]*"/g, "");
        text = unescapeHtmlClue(text);
        const fmt = clue.getAttribute("format");
        if (fmt) text += ` (${fmt})`;
        return {
          text,
          word: clue.getAttribute("word"),
          number: clue.getAttribute("number"),
        };
      });
      clues.push({ title, clue: clueList });
    });
  }

  return { metadata, cells, words, clues };
}

function xw_write_jpz(metadata, cells, words, clues) {
  // TODO
}

export { xw_write_jpz };
