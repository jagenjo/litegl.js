// Builds the browser-global (IIFE) bundles of litegl.js with esbuild.
//
//  - build/litegl.js      : readable IIFE bundle (sets window.GL / window.LiteGL / window.Texture ...)
//  - build/litegl.min.js  : minified IIFE bundle
//
// glMatrix (vec2/vec3/vec4/mat3/mat4/quat) is left as a FREE EXTERNAL GLOBAL: it is never
// imported, so esbuild emits bare references that resolve from `window` at runtime, exactly as
// the original build did. The consumer must still load gl-matrix 2.x before litegl.
//
// external/dds.js is prepended (banner) so `Texture.fromDDS*` works out of the box, mirroring the
// old Python build which concatenated dds.js into the bundle.

import * as esbuild from "esbuild";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const ddsSource = readFileSync(resolve(root, "external", "dds.js"), "utf8");

const headerComment =
  `//litegl.js v${pkg.version} by Javi Agenjo 2014-2026 @tamat (tamats.com)\n` +
  `//forked from lightgl.js by Evan Wallace (madebyevan.com)\n` +
  `//requires gl-matrix 2.x to be loaded before this file\n`;

mkdirSync(resolve(root, "build"), { recursive: true });

/** @type {import("esbuild").BuildOptions} */
const common = {
  entryPoints: [resolve(root, "src", "index.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2018"],
  banner: { js: headerComment + ddsSource },
  logLevel: "info",
};

await esbuild.build({
  ...common,
  outfile: resolve(root, "build", "litegl.js"),
  minify: false,
});

await esbuild.build({
  ...common,
  outfile: resolve(root, "build", "litegl.min.js"),
  minify: true,
});

console.log("Built build/litegl.js and build/litegl.min.js");
