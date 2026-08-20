// formats/apz.js
import { parseXml, getText } from "../lib/xmlparser.js";

function getClueLetter(clueIndex) {
  const code = 'A'.charCodeAt(0) + (clueIndex % 26);
  const letter = String.fromCharCode(code);
  return letter.repeat(Math.floor(clueIndex / 26) + 1);
}

export function generateGridKey(solutionStr, answers) {
  let wordIndex = 0;
  const solutionWords = [];
  let indexInFiltered = 0;
  for (let i = 0; i < solutionStr.length; i++) {
    const ch = solutionStr[i].toUpperCase();
    if ((ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')) {
      solutionWords.push({ char: ch, wordIdx: wordIndex, index: indexInFiltered });
      indexInFiltered++;
    } else if (ch === ' ' || ch === '\n' || ch === '\r') {
      if (solutionWords.length > 0 && solutionWords[solutionWords.length - 1].wordIdx === wordIndex) {
        wordIndex++;
      }
    }
  }

  // Frequencies check
  const solutionLetterFrequencies = {};
  solutionWords.forEach(w => {
    solutionLetterFrequencies[w.char] = (solutionLetterFrequencies[w.char] || 0) + 1;
  });
  const answersLetterFrequencies = {};
  answers.forEach(ans => {
    for (let char of ans.toUpperCase()) {
      answersLetterFrequencies[char] = (answersLetterFrequencies[char] || 0) + 1;
    }
  });

  const allChars = new Set([...Object.keys(solutionLetterFrequencies), ...Object.keys(answersLetterFrequencies)]);
  for (let char of allChars) {
    if ((solutionLetterFrequencies[char] || 0) !== (answersLetterFrequencies[char] || 0)) {
      throw new Error(`Solution letters do not exactly match letters from clue answers. Mismatch on '${char}': solution has ${solutionLetterFrequencies[char] || 0}, answers have ${answersLetterFrequencies[char] || 0}`);
    }
  }

  let remainingSolutionCharacters = solutionWords.map((w, idx) => ({ ...w, originalIdx: idx }));

  // seeded RNG from https://stackoverflow.com/a/19303725
  let RNGSeed = 1;
  function random() {
      var x = Math.sin(RNGSeed++) * 10000;
      return x - Math.floor(x);
  }

  function shuffle(arr) {
    const newArr = [...arr];
    for (let i = newArr.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
    }
    return newArr;
  }

  const answerEntries = answers.map((answer, answerIndex) => ({ answer, answerIndex }));
  const shuffledAnswerEntries = shuffle(answerEntries);

  const gridKey = Array.from({ length: answers.length });

  shuffledAnswerEntries.forEach(({ answer, answerIndex }) => {
    const solutionWordsUsedInAnswer = new Set();
    const answerChars = answer.toUpperCase().split("").map((ch, idx) => ({ ch, idx }));
    const shuffledAnswerChars = shuffle(answerChars);

    const charAssignments = [];

    shuffledAnswerChars.forEach(({ ch, idx }) => {
      const matchingSolutionCharacters = remainingSolutionCharacters.filter(w => w.char === ch);
      if (matchingSolutionCharacters.length === 0) {
        throw new Error(`No matching solution characters found for '${ch}' during grid key generation.`);
      }

      const solutionCharactersInUnusedWords = matchingSolutionCharacters.filter(w => !solutionWordsUsedInAnswer.has(w.wordIdx));
      const candidateSolutionCharacters = solutionCharactersInUnusedWords.length > 0
        ? solutionCharactersInUnusedWords
        : matchingSolutionCharacters;

      const selected = candidateSolutionCharacters[Math.floor(random() * candidateSolutionCharacters.length)];
      remainingSolutionCharacters = remainingSolutionCharacters.filter(w => w.originalIdx !== selected.originalIdx);
      solutionWordsUsedInAnswer.add(selected.wordIdx);

      charAssignments.push({
        answerCharIndex: idx,
        cellNumber: selected.index + 1
      });
    });

    charAssignments.sort((a, b) => a.answerCharIndex - b.answerCharIndex);
    gridKey[answerIndex] = charAssignments.map(c => c.cellNumber);
  });

  return gridKey;
}

export function xw_read_apz(data) {
  // Decode XML string
  const xmlString = new TextDecoder("utf-8").decode(data);
  const doc = parseXml(xmlString);

  const puzzle = doc.getElementsByTagName("puzzle")[0];
  if (!puzzle) throw new Error("Not a valid APZ puzzle");

  const metadataNode = puzzle.getElementsByTagName("metadata")[0];
  const getMetadataText = (tag) => {
    return metadataNode ? getText(metadataNode, tag) : "";
  };

  const solutionRaw = getText(puzzle, "solution");
  const cleanSolution = solutionRaw.replace(/[\r\n]+/g, "");

  // Parse answers
  const answersRaw = getText(puzzle, "answers");
  const answers = answersRaw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  // Calculate layout dimensions for clues/answers
  const colSize = Math.ceil(answers.length / 2);
  const leftMax = Math.max(...answers.slice(0, colSize).map(a => a.length));
  const rightMax = Math.max(...answers.slice(colSize).map(a => a.length));

  const leftColWidth = 1 + leftMax;  // 1 cell for label + max answer cells
  const rightColWidth = 1 + rightMax;

  // Determine quote width and height (optional, treated as suggestions)
  let quoteWidth = parseInt(getMetadataText("width"), 10);
  if (!quoteWidth || isNaN(quoteWidth) || quoteWidth <= 0) {
    quoteWidth = Math.max(leftColWidth + 1 + rightColWidth, 27);
  }

  let quoteHeight = parseInt(getMetadataText("height"), 10);
  const minQuoteHeight = Math.ceil(cleanSolution.length / quoteWidth);
  if (!quoteHeight || isNaN(quoteHeight) || quoteHeight < minQuoteHeight) {
    quoteHeight = minQuoteHeight;
  }

  // Slice the clean solution into rows of length quoteWidth
  const solutionLines = [];
  for (let i = 0; i < cleanSolution.length; i += quoteWidth) {
    solutionLines.push(cleanSolution.slice(i, i + quoteWidth));
  }

  // Parse clues
  const cluesRaw = getText(puzzle, "clues");
  const clueTexts = cluesRaw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  // Parse or generate gridkey
  let gridKey = [];
  const gridkeyNode = puzzle.getElementsByTagName("gridkey")[0];
  if (gridkeyNode && gridkeyNode.textContent.trim()) {
    gridKey = gridkeyNode.textContent
      .trim()
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => line.split(/\s+/).map(Number));
  } else {
    gridKey = generateGridKey(cleanSolution, answers);
  }

  const totalWidth = Math.max(quoteWidth, leftColWidth + 1 + rightColWidth, 27);
  const leftColEnd = leftColWidth + Math.floor((totalWidth - leftColWidth - rightColWidth - 1) / 2);
  const totalHeight = quoteHeight + 1 + colSize;

  const completionMessage = getText(puzzle, "completion") || "";

  const metadata = {
    title: getMetadataText("title"),
    author: getMetadataText("creator"),
    copyright: getMetadataText("copyright"),
    description: getMetadataText("description"),
    height: totalHeight,
    width: totalWidth,
    crossword_type: "acrostic",
    completion_message: completionMessage,
  };

  const cells = [];
  const numberToCellMap = {}; // mapping number (string) -> cell reference in quote

  // Helper to generate void cells
  function fillVoid(xStart, xEnd, y) {
    for (let x = xStart; x < xEnd; x++) {
      cells.push({
        x,
        y,
        solution: null,
        number: null,
        type: "void",
        "background-shape": null,
        letter: null,
        top_right_number: null,
        is_void: true,
        clue: false,
        value: null
      });
    }
  }

  // --- 1. Populate Quote Grid ---
  let quoteCounter = 1;
  const quoteStartX = Math.floor((totalWidth - quoteWidth) / 2);

  for (let y = 0; y < quoteHeight; y++) {
    fillVoid(0, quoteStartX, y);

    const line = solutionLines[y];
    for (let x = 0; x < quoteWidth; x++) {
      const char = line ? line[x] : undefined;

      if (char === undefined) {
        cells.push({
          x: quoteStartX + x,
          y,
          solution: null,
          number: null,
          type: "void",
          "background-shape": null,
          letter: null,
          top_right_number: null,
          is_void: true,
          clue: false,
          value: null
        });
        continue;
      }

      const upperChar = char.toUpperCase();
      const isAlphaNum = (upperChar >= 'A' && upperChar <= 'Z') || (upperChar >= '0' && upperChar <= '9');

      let cell;
      if (isAlphaNum) {
        cell = {
          x: quoteStartX + x,
          y,
          solution: upperChar,
          number: quoteCounter.toString(),
          type: null,
          "background-shape": null,
          letter: null,
          top_right_number: null,
          is_void: false,
          clue: false,
          value: null
        };
        numberToCellMap[quoteCounter.toString()] = cell;
        quoteCounter++;
      } else if (char === ' ') {
        // Spaces inside the quote are black squares (blocks) to act as word boundaries
        cell = {
          x: quoteStartX + x,
          y,
          solution: null,
          number: null,
          type: "block",
          "background-shape": null,
          letter: null,
          top_right_number: null,
          is_void: false,
          clue: false,
          value: null
        };
      } else {
        // Punctuation characters (hyphens, apostrophes, etc.) become clues prefilled with the character
        cell = {
          x: quoteStartX + x,
          y,
          solution: upperChar,
          number: null,
          type: "clue",
          "background-shape": null,
          letter: upperChar,
          top_right_number: null,
          is_void: false,
          clue: true,
          value: upperChar
        };
      }

      cells.push(cell);
    }

    fillVoid(quoteStartX + quoteWidth, totalWidth, y);
  }

  // --- 2. Spacer Divider Row ---
  fillVoid(0, totalWidth, quoteHeight);

  // --- 3. Populate Clue Answer Rows ---
  const words = [];
  const clueList = [];

  const addClue = (clueIdx, startX, y) => {
    const clueLetter = getClueLetter(clueIdx);
    const wordId = (clueIdx + 1).toString();
    const answer = answers[clueIdx] || "";
    const key = gridKey[clueIdx] || [];

    cells.push({
      x: startX,
      y,
      solution: clueLetter,
      number: null,
      type: "clue",
      "background-shape": null,
      letter: clueLetter,
      top_right_number: null,
      is_void: false,
      clue: true,
      value: clueLetter
    });

    const wordCells = [];
    for (let j = 0; j < answer.length; j++) {
      const num = key[j];
      const cx = startX + 1 + j;
      const cell = {
        x: cx,
        y,
        solution: answer[j].toUpperCase(),
        number: num ? num.toString() : null,
        type: null,
        "background-shape": null,
        letter: null,
        top_right_number: null,
        is_void: false,
        clue: false,
        value: null
      };
      cells.push(cell);
      wordCells.push([cx, y]);

      if (num && numberToCellMap[num.toString()]) {
        numberToCellMap[num.toString()].top_right_number = clueLetter;
      }
    }

    words.push({ id: wordId, cells: wordCells });
    clueList.push({
      text: clueTexts[clueIdx],
      word: wordId,
      number: clueLetter
    });
  };

  for (let r = 0; r < colSize; r++) {
    const y = quoteHeight + 1 + r;

    // --- Left Column ---
    addClue(r, 0, y);
    fillVoid(1 + (answers[r] || "").length, leftColEnd, y);
    fillVoid(leftColEnd, leftColEnd + 1, y);

    // --- Right Column ---
    const rightClueIdx = colSize + r;
    if (rightClueIdx < answers.length) {
      addClue(rightClueIdx, leftColEnd + 1, y);
      fillVoid(leftColEnd + 2 + (answers[rightClueIdx] || "").length, totalWidth, y);
    } else {
      fillVoid(leftColEnd + 1, totalWidth, y);
    }
  }

  // --- Quote Word containing all quote cells ---
  const quoteCells = [];
  for (let i = 1; i < quoteCounter; i++) {
    const cell = numberToCellMap[i.toString()];
    if (cell) {
      quoteCells.push([cell.x, cell.y]);
    }
  }
  words.push({
    id: "1000",
    cells: quoteCells
  });

  clueList.sort((a, b) => {
    const getIdx = letter => {
      let idx = 0;
      for (let i = 0; i < letter.length; i++) {
        idx = idx * 26 + (letter.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
      }
      return idx;
    };
    return getIdx(a.number) - getIdx(b.number);
  });

  const clues = [
    { title: "CLUES", clue: clueList }
  ];

  return { metadata, cells, words, clues };
}
