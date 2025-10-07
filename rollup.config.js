import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";
import { visualizer } from "rollup-plugin-visualizer";
import alias from "@rollup/plugin-alias";
import json from "@rollup/plugin-json";

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isStats = process.env.STATS === "true";
const buildTarget = process.env.BUILD; // "browser", "cli", or undefined

/**
 * Shared plugins
 */
const basePlugins = [
  alias({
    entries: [
      {
        find: "html2canvas",
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
  plugins: [...basePlugins, json(), terser()],
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
