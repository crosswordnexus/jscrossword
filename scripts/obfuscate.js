/**
* Scripts to obfuscate a JSCrossword
* All of them return a JSCrossword object
**/

let JSCrosswordRef;

try {
  // Works in Node or ESM environments
  const mod = await import("../src/jscrossword.js");
  JSCrosswordRef = mod.default || mod.JSCrossword;
} catch (err) {
  // Fallback for browser
  JSCrosswordRef = window.JSCrossword;
}

const JSCrossword = JSCrosswordRef;

// --- helper functions ---
function sortString(text) {
  return text.split("").sort().join("");
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function downsOnly(xw) {
  const newClues = xw.clues.map(list => {
    if (/across/i.test(list.title)) {
      return {
        ...list,
        clue: list.clue.map(c => ({ ...c, text: "--" })),
      };
    }
    return list;
  });
  return new JSCrossword(xw.metadata, xw.cells, xw.words, newClues);
}

export function turtleify(xw) {
  function turtleWord(w) {
    if (/^[A-Za-z]+$/.test(w) && w.length >= 3 && Math.random() < 0.36) {
      if (w === w.toUpperCase()) return "TURTLE";
      if (w[0] === w[0].toUpperCase()) return "Turtle";
      return "turtle";
    }
    return w;
  }

  const newClues = xw.clues.map(list => ({
    ...list,
    clue: list.clue.map(c => ({
      ...c,
      text: c.text
        .split(/\s+/)
        .map(turtleWord)
        .join(" "),
    })),
  }));

  return new JSCrossword(xw.metadata, xw.cells, xw.words, newClues);
}

export function letterShuffle(xw) {
  function shuffle(s) {
    return s.split("").sort(() => 0.5 - Math.random()).join("");
  }

  const newClues = xw.clues.map(list => ({
    ...list,
    clue: list.clue.map(c => {
      const text = c.text
        // Split on spaces but keep multiple spaces intact for readability
        .split(/(\s+)/)
        .map(w => {
          // Skip tags or HTML entities
          if (/[<>]/.test(w)) return w;
          if (w.length >= 4) {
            const inner = shuffle(w.slice(1, -1));
            return w[0] + inner + w[w.length - 1];
          }
          return w;
        })
        .join("");
      return { ...c, text };
    }),
  }));

  return new JSCrossword(xw.metadata, xw.cells, xw.words, newClues);
}

export function diagramless(xw) {
  // Step 1: Copy metadata and mark it as diagramless
  const md = { ...xw.metadata, crossword_type: "diagramless" };

  // Step 2: Blank out all non-block cells
  const blankCells = xw.cells.map(c => {
    const isBlock = c.type === "block";

    return {
      ...c,
      solution: isBlock ? "#" : c.solution,
      letter: null,
      value: null,
      type: null,
      number: null
    };
  });

  // make an intermediate jscrossword
  const xw1 = new JSCrossword(md, blankCells, xw.words, xw.clues);

  // Step 3: Recompute numbering using xwGrid
  const grid = xw1.grid();
  const numbering = grid.gridNumbering();

  // Step 4: Add numbers back into cells
  const numberedCells = blankCells.map(c => {
    const num = numbering[c.y]?.[c.x];
    return { ...c, number: num && num > 0 ? String(num) : null };
  });

  // Step 5: Create a new JSCrossword object with updated data
  return new JSCrossword(md, numberedCells, xw.words, xw.clues);
}

export function clueSort(xw) {
  // Precompute entry words for each clue number
  const entries = xw.get_entry_mapping();

  const newClues = xw.clues.map(list => {
    // Pair up each clue with its entry
    const paired = list.clue.map(c => ({
      entry: entries[c.number] || "",
      text: c.text,
    }));

    // Sort those pairs alphabetically by entry
    const sortedByEntry = [...paired].sort((a, b) =>
      a.entry.localeCompare(b.entry)
    );

    // Extract just the sorted clue texts
    const sortedTexts = sortedByEntry.map(p => p.text);

    // Assign the sorted texts back to the original clue numbers/order
    const newClueObjs = list.clue.map((c, i) => ({
      ...c,
      text: sortedTexts[i],
    }));

    return { ...list, clue: newClueObjs };
  });

  return new JSCrossword(xw.metadata, xw.cells, xw.words, newClues);
}

if (typeof window !== "undefined") {
  window.JSCrosswordMutators = { downsOnly, turtleify, letterShuffle, diagramless, clueSort };
} else {
  globalThis.JSCrosswordMutators = { downsOnly, turtleify, letterShuffle, diagramless, clueSort };
}

export default { downsOnly, turtleify, letterShuffle, diagramless, clueSort };
