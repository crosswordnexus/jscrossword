// formats/cfp.js
import { xwGrid } from "../grid.js";
import { parseXml, getText, getAttr } from "../lib/xmlparser.js";
import { unescapeHtmlClue } from "../lib/escape.js";

export function xw_read_cfp(data) {
  // data is Uint8Array → decode to UTF-8 string
  const xmlString = new TextDecoder("utf-8").decode(data);

  // Parse XML string → DOM
  const doc = parseXml(xmlString);
  const root = doc.getElementsByTagName("CROSSFIRE")[0];
  if (!root) throw new Error("Not a valid CFP puzzle");

  // --- Metadata ---
  const grid_str = getText(root, "GRID").trim();
  const grid_arr = grid_str.split("\n");
  const width = Number(getAttr(root, "GRID", "width"));
  const height = grid_arr.length;

  const metadata = {
    title: getText(root, "TITLE"),
    author: getText(root, "AUTHOR"),
    copyright: getText(root, "COPYRIGHT"),
    description: getText(root, "NOTES"),
    height,
    width,
    crossword_type: "crossword",
  };

  // --- Cells ---
  const circle_locations = new Set(
    getText(root, "CIRCLES")
      .split(",")
      .filter(Boolean)
      .map(Number)
  );

  const rebusObj = {};
  const rebusNodes = root.getElementsByTagName("REBUS");
  for (let i = 0; i < rebusNodes.length; i++) {
    const r = rebusNodes[i];
    rebusObj[r.getAttribute("input")] = r
      .getAttribute("letters")
      .toUpperCase();
  }

  const cells = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = x + y * width;
      let solution = grid_arr[y].charAt(x);
      solution = rebusObj[solution] || solution;

      let type = null;
      if (solution === ".") {
        type = "block";
        solution = null;
      }

      const new_cell = {
        x,
        y,
        solution,
        number: null,
        type,
        "background-shape": circle_locations.has(idx) ? "circle" : null,
      };
      cells.push(new_cell);
    }
  }

  // Numbering
  const thisGrid = new xwGrid(cells);
  const gn = thisGrid.gridNumbering();
  cells.forEach(cell => {
    const num = gn[cell.y][cell.x];
    if (num) cell.number = num.toString();
  });

  // --- Words & Clues ---
  const entries = {
    ACROSS: thisGrid.acrossEntries(),
    DOWN: thisGrid.downEntries(),
  };
  const clues1 = { ACROSS: [], DOWN: [] };
  const words = [];

  const wordNodes = root.getElementsByTagName("WORD");
  for (let i = 0; i < wordNodes.length; i++) {
    const w = wordNodes[i];
    const word_id = (Number(w.getAttribute("id")) + 1000).toString();
    const number = w.getAttribute("num");
    let text = w.innerHTML || w.textContent || "";
    text = text.replace(/\s+xmlns="[^"]*"/g, "");
    text = unescapeHtmlClue(text);
    const dir = w.getAttribute("dir");

    clues1[dir].push({ word: word_id, number, text });
    const thisCells = entries[dir][Number(number)].cells;
    words.push({ id: word_id, cells: thisCells });
  }

  const clues = [
    { title: "ACROSS", clue: clues1["ACROSS"] },
    { title: "DOWN", clue: clues1["DOWN"] },
  ];

  return { metadata, cells, words, clues };
}

export function xw_write_cfp(metadata, cells, words, clues) {
  // TODO
}
