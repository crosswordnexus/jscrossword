# jscrossword

**jscrossword** is a lightweight JavaScript library for reading and writing crossword files in multiple formats.
It runs both **in the browser** (via a bundled script) and **on the command line** (via a Node.js CLI tool).

It supports parsing/exporting the most common crossword file types used by constructors and solvers:

* **PUZ** (`.puz`)
* **JPZ** (`.jpz`, zipped XML)
* **iPUZ** (`.ipuz`, JSON)
* **CFP** (`.cfp`, CrossFire)

All formats are normalized into a single `JSCrossword` class, which provides:

* Metadata (title, author, copyright, notes, etc.)
* Cells (grid positions, solutions, numbering, blocks/voids)
* Words and their clue associations
* Clue text (with safe HTML escaping for display in browsers)
* Utility methods (`get_solution_array()`, `get_entry_mapping()`, etc.)

---

## Project structure

```
src/
  jscrossword.js       # main entry point, defines JSCrossword
  grid.js              # helper for numbering and entries
  formats/             # per-format readers/writers
    puz.js
    jpz.js
    ipuz.js
    cfp.js
lib/
  jsunzip.js           # minimal unzipper for JPZ
  escape.js            # HTML escaping utilities
  xmlparser.js         # XML parsing wrapper (browser + Node)
bin/
  puz2pdf.js           # CLI entry point
dist/
  jscrossword_combined.js  # browser-ready bundle (built)
  puz2pdf.js               # Node-ready CLI build
```

---

## Usage

### In the browser

Include the prebuilt bundle:

```html
<script src="dist/jscrossword_combined.js"></script>
<script>
  // Example: load a JPZ file and parse it
  fetch("puzzle.jpz")
    .then(resp => resp.arrayBuffer())
    .then(buf => {
      const bytes = new Uint8Array(buf);
      const puzzle = JSCrossword.fromData(bytes);
      console.log("Loaded puzzle:", puzzle.metadata.title);
    });
</script>
```

---

### On the command line

The CLI tool is named **`puz2pdf`**.
It reads a crossword file (PUZ, JPZ, IPUZ, CFP) and produces a PDF.

#### Install locally

```sh
npm install
```

Run with:

```sh
node dist/puz2pdf.js path/to/puzzle.puz
```

#### Install globally

To expose the CLI as `puz2pdf`:

```sh
npm install -g .
```

Then run:

```sh
puz2pdf puzzle.puz
```

---

## Development

### Install dependencies

```sh
npm install
```

### Build all bundles (browser + CLI)

```sh
npm run build
```

Outputs:

* `dist/jscrossword_combined.js` (browser bundle)
* `dist/puz2pdf.js` (Node CLI bundle)

### Build browser-only

```sh
npm run build:browser
```

### Build CLI-only

```sh
npm run build:cli
```

### Clean build artifacts

```sh
npm run clean
```

### Bundle analysis

```sh
npm run build:stats
```

This creates a `stats.html` file.
Open it in your browser to see a visualization of module sizes and dependencies.

---

## Notes

* All strings are sanitized in the `JSCrossword` constructor (`sanitize()`), so titles, authors, and clue text are safe to inject into the DOM.
* Writers (`xw_write_*`) are still under development — parsing is the main focus for now.

---

## License

MIT License © 2025 Crossword Nexus
