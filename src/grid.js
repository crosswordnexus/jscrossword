// grid.js
//
// Provides the xwGrid class for working with crossword cell arrays.
// Used by CFP, iPUZ, JPZ readers to compute numbering and entries.

export class xwGrid {
  constructor(cells) {
    this.cells = cells;
    this.height = Math.max(...cells.map(c => parseInt(c.y))) + 1;
    this.width = Math.max(...cells.map(c => parseInt(c.x))) + 1;
    this.numbers = this.gridNumbering();
  }

  /** Return the cell object at (x, y). */
  cellAt(x, y) {
    return this.cells.find(cell => cell.x === x && cell.y === y);
  }

  /** Return the solution letter at (x, y). */
  letterAt(x, y) {
    return this.cellAt(x, y).solution;
  }

  /** True if this cell is a block or void. */
  isBlack(x, y) {
    const c = this.cellAt(x, y);
    return c.type === "void" || c.type === "block";
  }

  /** Check if we have a black square or bar in a given direction. */
  hasBlack(x, y, dir) {
    const md = {
      right: { xcheck: this.width - 1, xoffset: 1, yoffset: 0, dir2: "left" },
      left:  { xcheck: 0, xoffset: -1, yoffset: 0, dir2: "right" },
      top:   { ycheck: 0, xoffset: 0, yoffset: -1, dir2: "bottom" },
      bottom:{ ycheck: this.height - 1, xoffset: 0, yoffset: 1, dir2: "top" },
    }[dir];

    if (x === md?.xcheck || y === md?.ycheck) return true;
    if (this.isBlack(x + (md?.xoffset || 0), y + (md?.yoffset || 0))) return true;
    if (this.cellAt(x, y)[`${dir}-bar`]) return true;
    if (this.cellAt(x + (md?.xoffset || 0), y + (md?.yoffset || 0))[`${md?.dir2}-bar`]) return true;
    return false;
  }

  startAcrossWord(x, y) {
    return this.hasBlack(x, y, "left") &&
           x < this.width - 1 &&
           !this.isBlack(x, y) &&
           !this.hasBlack(x, y, "right");
  }

  startDownWord(x, y) {
    return this.hasBlack(x, y, "top") &&
           y < this.height - 1 &&
           !this.isBlack(x, y) &&
           !this.hasBlack(x, y, "bottom");
  }

  /** Numbering for every cell, 2D array of ints. */
  gridNumbering() {
    const numbers = [];
    let thisNumber = 1;
    for (let y = 0; y < this.height; y++) {
      const rowNums = [];
      for (let x = 0; x < this.width; x++) {
        if (this.startAcrossWord(x, y) || this.startDownWord(x, y)) {
          rowNums.push(thisNumber);
          thisNumber++;
        } else {
          rowNums.push(0);
        }
      }
      numbers.push(rowNums);
    }
    return numbers;
  }

  /** Map of across entries keyed by number. Each has {word, cells}. */
  acrossEntries() {
    const acrossEntries = {};
    for (let y = 0; y < this.height; y++) {
      let thisNum = null;
      for (let x = 0; x < this.width; x++) {
        if (this.startAcrossWord(x, y)) {
          thisNum = this.numbers[y][x];
          if (thisNum) acrossEntries[thisNum] = { word: "", cells: [] };
        }
        if (!this.isBlack(x, y) && thisNum) {
          acrossEntries[thisNum].word += this.letterAt(x, y);
          acrossEntries[thisNum].cells.push([x, y]);
        }
        if (this.hasBlack(x, y, "right")) {
          thisNum = null;
        }
      }
    }
    return acrossEntries;
  }

  /** Map of down entries keyed by number. Each has {word, cells}. */
  downEntries() {
    const downEntries = {};
    for (let x = 0; x < this.width; x++) {
      let thisNum = null;
      for (let y = 0; y < this.height; y++) {
        if (this.startDownWord(x, y)) {
          thisNum = this.numbers[y][x];
          if (thisNum) downEntries[thisNum] = { word: "", cells: [] };
        }
        if (!this.isBlack(x, y) && thisNum) {
          downEntries[thisNum].word += this.letterAt(x, y);
          downEntries[thisNum].cells.push([x, y]);
        }
        if (this.hasBlack(x, y, "bottom")) {
          thisNum = null;
        }
      }
    }
    return downEntries;
  }
}
