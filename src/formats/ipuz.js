/*******************
 * iPUZ reading/writing functions
 * copyright (c) 2021 Crossword Nexus
 * MIT License https://opensource.org/licenses/MIT
 *******************/

import { xwGrid } from "../grid.js";
import { unescapeHtmlClue } from "../lib/escape.js";
import pkg from "../../package.json" assert { type: "json" };

/** Helper function to determine if we're 0- or 1-indexed **/
function cellOffset(clues, height, width) {
  let maxCoord = 0;
  for (const dir of Object.keys(clues)) {
    for (const clue of clues[dir]) {
      if (clue.cells) {
        for (const [x, y] of clue.cells) {
          if (x > maxCoord) maxCoord = x;
          if (y > maxCoord) maxCoord = y;
        }
      }
    }
  }
  return maxCoord > width || maxCoord > height ? 0 : 1;
}

export function xw_read_ipuz(inputData) {
  if (!(inputData instanceof Uint8Array)) {
    throw new Error("IPUZ parser expects Uint8Array input");
  }

  // decode bytes to UTF-8 string
  const jsonString = new TextDecoder("utf-8").decode(inputData);

  // parse JSON
  const data = JSON.parse(jsonString);

  const ALLOWED_KINDS = ['crossword', 'diagramless', 'coded'];
  let crossword_type = null;
  (data.kind || []).forEach(k => {
    ALLOWED_KINDS.forEach(ak => {
      if (k.indexOf(ak) !== -1) crossword_type = ak;
    });
  });

  const BLOCK = data.block || '#';
  const EMPTY = data.empty || '0';
  const height = data?.dimensions?.height || 0;
  const width = data?.dimensions?.width || 0;

  const metadata = {
    title: data.title || '',
    author: data.author || '',
    copyright: data.copyright || '',
    description: data.notes || data.intro || '',
    intro: data.intro || null,
    height,
    width,
    crossword_type,
    fakeclues: data.fakeclues || false,
    word_locations: Boolean(data.words),
    completion_message: data.explanation || null,
    // we add an image for vpuz support
    image: data["puzzle-image"] || null
  };

  const cells = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cellData = data.puzzle?.[y]?.[x];
      const is_void = cellData === null;

      let number = null;
      let style = {};
      if (typeof cellData === 'object' && cellData !== null) {
        number = cellData.cell?.toString() ?? null;
        style = cellData.style || {};
      } else if (cellData !== null && cellData !== undefined) {
        number = cellData.toString();
      }
      if (number === EMPTY) number = null;

      let solution = '';
      try {
        let raw = data.solution?.[y]?.[x];
        if (typeof raw === 'string') solution = raw.toUpperCase();
        else if (raw) solution = (raw.value || raw.cell || '').toUpperCase();
      } catch {}

      // Set the "type"
      // We prioritize void over block
      let type = null;
      if (is_void) type = 'void';
      else if (solution === BLOCK || number === BLOCK) type = 'block';

      const letter = cellData?.value || null;

      const bars = {
        'bottom-bar': style.barred?.includes('B') || null,
        'right-bar': style.barred?.includes('R') || null,
        'top-bar': style.barred?.includes('T') || null,
        'left-bar': style.barred?.includes('L') || null
      };

      let background_shape = style.shapebg;
      let background_color = style.color;
      // keep your original color handling
      if (background_color && background_color.match('^[A-Fa-f0-9]{6}$')) {
        background_color = '#' + background_color.toString();
      }

      let top_right_number = null;
      if (style.mark) {
        top_right_number = style.mark.TR;
        number = style.mark.TL || number;
        if (!number) number = style.mark.BL;
        if (!top_right_number) top_right_number = style.mark.BR;
      }

      // Change the "number" if it isn't real
      if (number === EMPTY || number === BLOCK) {
          number = null;
      }

      cells.push({
        x,
        y,
        solution,
        number,
        type,
        'background-color': background_color,
        'background-shape': background_shape,
        letter,
        top_right_number,
        is_void,
        clue: null,
        value: null,
        ...bars
      });
    }
  }

  const clues = [];
  const words = [];
  let word_id = 1;

  let titles = data.clues ? Object.keys(data.clues) : [];
  if (titles.length > 1 && titles[0].toLowerCase() === 'down' && titles[1].toLowerCase() === 'across') {
    titles = [titles[1], titles[0]];
  }

  // Get the offset from the heuristic
  const offset = cellOffset(data['clues'], height, width);
  console.log("Detected cell offset: ", offset);

  titles.forEach(title => {
    const thisClues = [];
    (data.clues[title] || []).forEach(clue => {
      let number = '',
        text = '',
        refs = {};
      if (Array.isArray(clue)) {
        number = clue[0].toString();
        text = clue[1];
      } else if (typeof clue === 'string') {
        text = clue;
      } else {
        if (clue.number) number = clue.number.toString();
        text = clue.clue;
        refs = {
          ...(clue.references || {}),
          ...(clue.continued || {})
        };
      }
      thisClues.push({
        word: word_id.toString(),
        number,
        text,
        refs
      });

      if (clue.cells && clue.cells.length) {
        const thisCells = clue.cells.map(c => [c[0] - offset, c[1] - offset]);
        words.push({
          id: word_id.toString(),
          cells: thisCells
        });
      }
      word_id++;
    });
    clues.push({
      title: title.split(':').at(-1),
      clue: thisClues
    });
  });

  if (!words.length) {
    if (!data.words) {
      const thisGrid = new xwGrid(cells);
      let word_id = 1;
      const acrossEntries = thisGrid.acrossEntries();
      Object.keys(acrossEntries).forEach(i => {
        words.push({
          id: (word_id++).toString(),
          cells: acrossEntries[i].cells,
          dir: 'across'
        });
      });
      const downEntries = thisGrid.downEntries();
      Object.keys(downEntries).forEach(i => {
        words.push({
          id: (word_id++).toString(),
          cells: downEntries[i].cells,
          dir: 'down'
        });
      });
    } else {
      let word_id = 1;
      const directions = ['across', 'down'];
      for (let i = 0; i < data.words.length; i++) {
        for (let j = 0; j < data.words[i].length; j++) {
          const newCells = data.words[i][j].cells.map(c => [c[0] - 1, c[1] - 1]);
          words.push({
            id: (word_id++).toString(),
            cells: newCells,
            dir: directions[i]
          });
        }
      }
    }
  }

  return {
    metadata,
    cells,
    words,
    clues
  };
}

export function xw_write_ipuz(metadata, cells, words, clues) {

  // ❌ IPUZ doesn't support acrostic-type puzzles
  if (metadata.crossword_type === "acrostic") {
    console.error("Cannot export acrostic puzzles to iPuz format.");
    return "{}";
  }

  const j = {
    "version": "http://ipuz.org/v1",
    "kind": ["http://ipuz.org/crossword#1"],
    "author": metadata.author || "",
    "title": metadata.title || "",
    "copyright": metadata.copyright || "",
    "notes": metadata.description || "",
    "intro": metadata.description || "",
    "dimensions": {
      "width": metadata.width,
      "height": metadata.height
    },
    "block": "#",
    "empty": "_"
  };

  const JSCROSSWORD_VERSION = pkg.version || "dev";
  j['origin'] = `JSCrossword version ${JSCROSSWORD_VERSION}`;

  // add some additional stuff
  if (metadata.fakeclues) j.fakeclues = metadata.fakeclues;
  if (metadata["puzzle-image"]) j["puzzle-image"] = metadata["puzzle-image"];
  if (metadata.explanation) j.explanation = metadata.explanation;

  if (metadata.crossword_type === 'diagramless') {
    j.kind = ["http://ipuz.org/crossword/diagramless#1"];
  } else if (metadata.crossword_type === 'coded') {
    j.kind = [
      "http://ipuz.org/crossword#1",
      "http://crosswordnexus.com/ipuz/coded#1"
    ];
  }

  const BARS = {
    top: 'T',
    right: 'R',
    bottom: 'B',
    left: 'L'
  };
  const puzzle = [];
  const solution = [];

  for (let y1 = 0; y1 < metadata.height; y1++) {
    const row = [];
    const solutionRow = [];
    for (let x1 = 0; x1 < metadata.width; x1++) {
      const cell = cells.find(z => z.x === x1 && z.y === y1);
      if ( !cell || cell.is_void) {
        row.push(null);
        solutionRow.push(null);
        continue;
      }

      // puzzle cell
      let thisCell = cell.number ? {
        cell: cell.number
      } : {
        cell: "_"
      };
      let style = {};

      if (cell['background-shape'] === 'circle') {
        style.shapebg = "circle";
      }
      if (cell['background-color']) {
        style.color = cell['background-color'].replace('#', '');
      }
      if (cell['top_right_number']) {
        style.mark = {
          TR: cell['top_right_number']
        };
      }

      let barred = "";
      for (const b of Object.keys(BARS)) {
        if (cell[`${b}-bar`]) barred += BARS[b];
      }
      if (barred) style.barred = barred;

      if (Object.keys(style).length > 0) {
        thisCell.style = style;
      } else {
        // if it's just a number, simplify to string
        thisCell = thisCell.cell || "_";
      }

      row.push(thisCell);

      // solution cell
      if (cell.type === 'block') {
        solutionRow.push("#");
      } else if (cell.solution) {
        solutionRow.push(cell.solution);
      } else {
        solutionRow.push("_");
      }
    }
    puzzle.push(row);
    solution.push(solutionRow);
  }

  j.puzzle = puzzle;
  j.solution = solution;

  const ipuz_clues = {};
  for (const clueList of clues) {
    ipuz_clues[clueList.title] = [];
    for (const thisClue of clueList.clue) {
      const ipuzClue = {
        clue: unescapeHtmlClue(thisClue.text)
      };
      if (thisClue.number) ipuzClue.number = thisClue.number;

      const thisWord = words.find(x => x.id === thisClue.word);
      if (thisWord && thisWord.cells?.length) {
        ipuzClue.cells = thisWord.cells.map(c => [c[0] + 1, c[1] + 1]);
      }

      ipuz_clues[clueList.title].push(ipuzClue);
    }
  }
  j.clues = ipuz_clues;

  return JSON.stringify(j);
}
