# jscrossword

**jscrossword** is a lightweight JavaScript library for reading, writing, and exporting crossword puzzles in multiple formats.\
It runs both **in the browser** (via a bundled script) and **on the command line** (via a Node.js CLI tool).

It supports the most common crossword file types used by constructors and solvers:

- **PUZ** (`.puz`)
- **JPZ** (`.jpz`, zipped XML)
- **iPUZ** (`.ipuz`, JSON)
- **CFP** (`.cfp`, CrossFire)
- *(experimental)* **VPuz** and **Rows Garden**

All formats are normalized into a single `JSCrossword` class that provides:

- Metadata (title, author, copyright, notes)
- Cells (coordinates, numbering, blocks/voids)
- Word entries and clue associations
- Clue text with safe HTML escaping
- Utility methods like `get_solution_array()` and `get_entry_mapping()`
- PDF export (`toPDF()`) for browser and CLI

---

## Project structure

```
.
├── bin/
│   └── puz2pdf.js             # CLI entry point (source)
├── dist/
│   ├── jscrossword_combined.js   # Browser-ready bundle (IIFE)
│   ├── jscrossword_combined.js.map
│   ├── puz2pdf.mjs               # Node.js CLI bundle (ESM)
│   └── puz2pdf.mjs.map
├── src/
│   ├── jscrossword.js         # main entry, defines JSCrossword class
│   ├── grid.js                # numbering + entry helpers
│   ├── formats/               # format-specific readers/writers
│   │   ├── puz.js
│   │   ├── jpz.js
│   │   ├── ipuz.js
│   │   ├── cfp.js
│   │   └── ...
│   ├── lib/                   # support utilities
│   │   ├── jsunzip.js
│   │   ├── escape.js
│   │   ├── xmlparser.js
│   │   └── ...
│   └── empty-module.js        # rollup placeholder for browser-only deps
├── scripts/
│   ├── obfuscate.js
│   └── obfuscator_data/
├── test_files/                # sample puzzles for testing
│   ├── Dimensionless.puz
│   ├── FM.jpz
│   ├── fun.ipuz
│   └── ...
├── rollup.config.js
├── package.json
├── LICENSE
└── README.md
```

---

## Usage

### In the browser

Include the prebuilt bundle:

```html
<script src="dist/jscrossword_combined.js"></script>
<script>
  // Example: load and parse a JPZ file
  fetch("puzzle.jpz")
    .then(resp => resp.arrayBuffer())
    .then(buf => {
      const bytes = new Uint8Array(buf);
      const puzzle = JSCrossword.fromData(bytes);
      console.log(`Loaded puzzle: \"${puzzle.metadata.title}\"`);
    });
</script>
```

---

### Generating PDFs in the browser

You can create and download printable PDFs directly from any supported crossword file — no server required.

```html
<input type="file" id="fileInput" accept=".puz,.jpz,.ipuz,.cfp" />
<button id="makePdfBtn" disabled>Make PDF</button>

<script src="dist/jscrossword_combined.js"></script>
<script>
  let currentXw = null;

  document.getElementById("fileInput").addEventListener("change", async (evt) => {
    const file = evt.target.files[0];
    if (!file) return;

    try {
      const buf = await file.arrayBuffer();
      const data = new Uint8Array(buf);
      const xw = JSCrossword.fromData(data);
      currentXw = xw;
      document.getElementById("makePdfBtn").disabled = false;
      console.log(`Loaded ${file.name}:`, xw);
    } catch (err) {
      console.error("File load failed:", err);
      alert("Could not parse this file.");
    }
  });

  document.getElementById("makePdfBtn").addEventListener("click", async () => {
    if (!currentXw) return alert("Please upload a crossword first.");
    try {
      const doc = await currentXw.toPDF();
      doc.save("crossword.pdf");
    } catch (err) {
      console.error("PDF generation failed:", err);
      alert("Failed to create PDF. See console for details.");
    }
  });
</script>
```

> 🔹 **Tip:**\
> The generated PDF respects clue formatting (bold/italic/emoji), layout options, and embedded headers where supported.

---

### On the command line

The CLI tool is named **`puz2pdf`**.
It reads a crossword file (`.puz`, `.jpz`, `.ipuz`, `.cfp`) and produces a formatted PDF.

#### Install locally

```sh
npm install
```

Run with:

```sh
node dist/puz2pdf.mjs path/to/puzzle.puz
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

- `dist/jscrossword_combined.js` — browser bundle (IIFE)
- `dist/puz2pdf.mjs` — CLI bundle (ESM)

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

### Analyze bundle

```sh
npm run build:stats
```

Generates a `stats.html` file showing module sizes and dependency graphs.

---

## Notes

- All strings are sanitized in the `JSCrossword` constructor (`sanitize()`), so puzzle data is safe for DOM insertion.
- Export functions (`xw_write_*`) are actively being expanded.
- The PDF generator (`toPDF()`) uses **jsPDF**, **GraphemeSplitter**, and **Twemoji** for Unicode and emoji compatibility.
- Rollup is used for bundling with optional minification and dependency visualization.

---

## Non-standard Extensions

**jscrossword** supports some non-standard extensions to common formats to enable features not present in the original specifications.

### Global Flags

#### `fakeclues`, `realwords`, and `autofill`
In both iPUZ and JPZ, you can add global flags that set corresponding metadata properties:
- **`fakeclues`**: sets `metadata.fakeclues` to `true`.
- **`realwords`**: sets `metadata.realwords` to `true`.
- **`autofill`**: sets `metadata.autofill` to `true`.

**JPZ:** Add `<fakeclues/>`, `<realwords/>`, or `<autofill/>` elements inside `<metadata>`.

**iPUZ:** Add `"fakeclues": true`, `"realwords": true`, or `"autofill": true` at the top level.

### Fake Clue Groups

You can mark an entire group of clues (e.g., "Across" or "Down") as "fake" (e.g. for cryptic variety puzzles or puzzles with multiple sets of clues where some are decoys). When a group is marked as fake, the resulting `clueList` object will have a `fake: true` property.

#### JPZ Extension

In JPZ files, add a `fake="true"` attribute to the `<clues>` element:

```xml
<clues fake="true">
  <title>Across</title>
  <clue number="1" word="1">Fake clue text</clue>
</clues>
```

#### iPUZ Extension

In iPUZ files, add a top-level `fakecluegroups` property containing an array of clue group titles:

```json
{
  "clues": {
    "Across": [...],
    "Down": [...]
  },
  "fakecluegroups": ["Across"]
}
```

### Acrostics

#### JPZ Extension
While not part of the standard JPZ schema, **jscrossword** supports parsing acrostic puzzles from JPZ files using the `<acrostic>` element in place of `<crossword>`.

---

## License

MIT License © 2025 [Crossword Nexus](https://crosswordnexus.com)
