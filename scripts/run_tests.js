import fs from "fs";
import path from "path";
import JSCrossword from "../src/jscrossword.js";
import { jscrossword_to_pdf } from "../src/lib/xw_pdf.js";

async function runTests() {
  const testFilesDir = "./test_files";
  const testOutputDir = "./test_output";

  // Create output directory if it doesn't exist
  if (!fs.existsSync(testOutputDir)) {
    fs.mkdirSync(testOutputDir, { recursive: true });
  }

  const files = fs.readdirSync(testFilesDir).filter(f => !f.startsWith("."));
  console.log(`Found ${files.length} test files. Starting PDF generation tests...\n`);

  let passed = 0;
  let failed = 0;

  for (const file of files) {
    const filePath = path.join(testFilesDir, file);
    const outPath = path.join(testOutputDir, `${path.basename(file, path.extname(file))}.pdf`);

    try {
      console.log(`Processing: ${file}...`);
      const buf = fs.readFileSync(filePath);
      const xw = JSCrossword.fromData(new Uint8Array(buf));
      
      const pdf = await jscrossword_to_pdf(xw);
      fs.writeFileSync(outPath, Buffer.from(pdf.output("arraybuffer")));
      
      console.log(`  ✅ Success -> ${outPath}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ Failed: ${file}`);
      console.error(err);
      failed++;
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("All PDF generation tests passed successfully! 🎉");
    process.exit(0);
  }
}

runTests();
