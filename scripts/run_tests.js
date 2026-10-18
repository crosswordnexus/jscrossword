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
  console.log(`Found ${files.length} test files. Starting PDF and JPZ generation tests...\n`);

  let passed = 0;
  let failed = 0;

  for (const file of files) {
    const filePath = path.join(testFilesDir, file);
    const outPdfPath = path.join(testOutputDir, `${path.basename(file, path.extname(file))}.pdf`);
    const outJpzPath = path.join(testOutputDir, `${path.basename(file, path.extname(file))}.jpz`);

    try {
      console.log(`Processing: ${file}...`);
      const buf = fs.readFileSync(filePath);
      const xw = JSCrossword.fromData(new Uint8Array(buf));
      
      // PDF generation
      const pdf = await jscrossword_to_pdf(xw);
      fs.writeFileSync(outPdfPath, Buffer.from(pdf.output("arraybuffer")));

      // JPZ generation
      const jpzString = xw.toJPZString();
      fs.writeFileSync(outJpzPath, jpzString, "utf8");

      // Verify that the generated JPZ can be re-parsed successfully
      JSCrossword.fromData(new TextEncoder().encode(jpzString));
      
      console.log(`  ✅ Success -> ${outPdfPath} and ${outJpzPath}`);
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
    console.log("All tests passed successfully! 🎉");
    process.exit(0);
  }
}

runTests();
