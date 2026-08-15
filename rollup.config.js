import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";
import { visualizer } from "rollup-plugin-visualizer";
import alias from "@rollup/plugin-alias";
import json from "@rollup/plugin-json";

import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isStats = process.env.STATS === "true";
const buildTarget = process.env.BUILD; // "browser", "cli", or undefined

let versionUpdated = false;

const updateVersionPlugin = {
  name: "update-version",
  buildStart() {
    if (versionUpdated) return;
    versionUpdated = true;

    try {
      const pkgPath = path.resolve(__dirname, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const currentVersion = pkg.version || "0.0.0";

      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1);
      const day = String(now.getDate());
      const datePrefix = `${year}.${month}.${day}`;

      let minor = 0;
      if (currentVersion.startsWith(datePrefix)) {
        const parts = currentVersion.split('.');
        if (parts.length === 4) {
          minor = parseInt(parts[3], 10) + 1;
        } else {
          minor = 1;
        }
      }
      const newVersion = `${datePrefix}.${minor}`;

      if (pkg.version !== newVersion) {
        pkg.version = newVersion;
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
        console.log(`\n[Version Update] Updated package.json version to: ${newVersion}`);
      }
    } catch (err) {
      console.error("[Version Update] Failed to update package.json version:", err);
    }
  }
};

/**
 * Shared plugins
 */
const basePlugins = [
  alias({
    entries: [
      {
        find: "html2canvas",
        replacement: path.resolve(__dirname, "src/empty-module.js")
      },
      {
        find: "image-size",
        replacement: path.resolve(__dirname, "src/empty-module.js")
      }
    ]
  }),
  resolve({ browser: true, preferBuiltins: false }),
  commonjs(),
  ...(isStats ? [visualizer({ filename: "stats.html" })] : [])
];

/**
 * Browser bundle
 */
const browserConfig = {
  input: "src/jscrossword.js",
  output: {
    file: "dist/jscrossword_combined.js",
    format: "iife",             // attaches to window
    name: "JSCrossword",
    sourcemap: true,
    globals: {
      linkedom: "undefined"     // don’t try to include linkedom in browser
    },
    inlineDynamicImports: true
  },
  plugins: [updateVersionPlugin, ...basePlugins, json(), terser()],
  external: ["linkedom"]        // exclude from browser build
};

/**
 * CLI bundle
 */
const cliConfig = {
  input: "bin/puz2pdf.js",
  output: {
    file: "dist/puz2pdf.mjs",
    format: "es",
    sourcemap: true,
    inlineDynamicImports: true,
    banner: "#!/usr/bin/env node",
    strict: false                // don’t prepend "use strict"; keeps shebang at top
  },
  plugins: [
    updateVersionPlugin,
    resolve({ preferBuiltins: true }),
    commonjs(),
    json(),
    terser()
  ],
  external: []
};

/**
 * Export conditionally
 */
let configs = [];

if (!buildTarget || buildTarget === "browser") {
  configs.push(browserConfig);
}

if (!buildTarget || buildTarget === "cli") {
  configs.push(cliConfig);
}

export default configs;
