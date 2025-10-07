import fs from "fs";
import path from "path";
import JSCrossword from "../src/jscrossword.js";
import { jscrossword_to_pdf } from "../src/lib/xw_pdf.js";

async function main() {
  const [,, infile, outfile] = process.argv;
  if (!infile) {
    console.error("Usage: puz2pdf <input.puz|.jpz|.ipuz> [output.pdf]");
    process.exit(1);
  }

  // Load file
  const buf = fs.readFileSync(infile);
  let data = new Uint8Array(buf);

  // Parse
  const xw = JSCrossword.fromData(data);

  // Pick output name
  let out = outfile;
  if (!out) {
    const stem = path.basename(infile, path.extname(infile));
    out = `${stem}.pdf`;
  }

  // Generate PDF
  const pdf = await jscrossword_to_pdf(xw);

  // Save PDF
  fs.writeFileSync(out, Buffer.from(pdf.output("arraybuffer")));
  console.log(`✅ Wrote PDF to ${out}`);
}

main().catch(err => {
  console.error("❌ PDF generation failed:", err);
  process.exit(1);
});
