// litegl.js — public entry point.
//
// This module assembles the `GL` namespace object (mirroring the original `var GL = global.GL =
// global.LiteGL = {}` facade) from the individual ESM modules, and — for backwards compatibility with
// the classic `<script src="litegl.js">` usage — re-attaches everything to the global object exactly
// as the original library did (both `GL.X` and, for many symbols, a bare `window.X`).
//
// Side-effect import order matters: bootstrap (glMatrix guard + rAF polyfill) and the glMatrix
// extensions must run before anything uses them.
import "./bootstrap";
import "./gl-matrix-extra";

import * as constants from "./constants";
import * as utils from "./utils";
import * as core from "./core";
import * as temp from "./temp";
import { geo, BBox, distanceToPlane, planeBoxOverlap, CLIP_INSIDE, CLIP_OUTSIDE, CLIP_OVERLAP } from "./geo";
import { Indexer, Buffer, Mesh, DynamicMesh, linearizeArray } from "./mesh";
import "./primitives"; // augments Mesh with the primitive factory statics (plane/cube/sphere/...)
import "./parsers"; // augments Mesh with the OBJ / mesh / wbin parsers + encoders
import { Texture } from "./texture";
import { FBO } from "./fbo";
import { Shader } from "./shader";
import { LEvent } from "./levent";
import { Octree } from "./octree";
import { HitTest, Ray, Raytracer } from "./raytracer";
import { Unwrapper } from "./unwrapper";

/**
 * The GL namespace: contains every litegl class plus all the WebGL enum mirror constants (so they can
 * be used before a context exists). `GL`, `window.GL` and `window.LiteGL` all reference this object.
 */
export const GL = {
  ...constants,

  // reusable scratch vectors/matrices
  temp_vec3: temp.temp_vec3,
  temp2_vec3: temp.temp2_vec3,
  temp_vec4: temp.temp_vec4,
  temp_quat: temp.temp_quat,
  temp_mat3: temp.temp_mat3,
  temp_mat4: temp.temp_mat4,

  // context creation + helpers (core)
  create: core.create,
  mapKeyCode: core.mapKeyCode,
  augmentEvent: core.augmentEvent,
  isMobile: core.isMobile,

  // classes
  Indexer,
  Buffer,
  Mesh,
  DynamicMesh,
  Texture,
  FBO,
  Shader,
  Octree,
  Ray,
  Raytracer,
  HitTest,
  Unwrapper,
  LEvent,
  BBox,

  // geometry helpers (GL + global)
  distanceToPlane,
  planeBoxOverlap,
  CLIP_INSIDE,
  CLIP_OUTSIDE,
  CLIP_OVERLAP,

  // misc helpers that were exposed on GL
  linearizeArray,
  getTime: utils.getTime,
  isPowerOfTwo: utils.isPowerOfTwo,
  nearestPowerOfTwo: utils.nearestPowerOfTwo,
  nextPowerOfTwo: utils.nextPowerOfTwo,
  cloneObject: utils.cloneObject,
  createCanvas: utils.createCanvas,
  cloneCanvas: utils.cloneCanvas,
  extendClass: utils.extendClass,
  loadFileAtlas: utils.loadFileAtlas,
  processFileAtlas: utils.processFileAtlas,
  request: utils.HttpRequest, // NB: on GL this is `request`; the bare global is `HttpRequest`

  // mutable runtime state (kept live via getters over the core module bindings)
  get last_context_id(): number {
    return core.last_context_id;
  },
  get reverse(): Record<number, string> | null {
    return core.reverse;
  },
  get dragging(): boolean {
    return core.dragging;
  },
  get last_pos(): [number, number] {
    return core.last_pos;
  },
};

// ---------------------------------------------------------------------------
// Backwards-compatible global attachment (classic <script> usage).
// ---------------------------------------------------------------------------
const glob = globalThis as unknown as Record<string, unknown>;

glob.GL = GL;
glob.LiteGL = GL;

// Symbols the original library attached directly to the global object (window). Some are also on GL
// ("GL + global"), some are global-only; this list reproduces the original surface exactly (plus the
// additive `Unwrapper`, which the original source defined but the shipped build happened to omit).
const globalSymbols: Record<string, unknown> = {
  // classes (GL + global)
  Mesh,
  Shader,
  Texture,
  Octree,
  Ray,
  Raytracer,
  HitTest,
  LEvent,
  BBox,
  Unwrapper,
  // geometry (geo is global-only; the rest are GL + global)
  geo,
  distanceToPlane,
  planeBoxOverlap,
  CLIP_INSIDE,
  CLIP_OUTSIDE,
  CLIP_OVERLAP,
  // utils (mix of GL + global and global-only)
  DEG2RAD: utils.DEG2RAD,
  RAD2DEG: utils.RAD2DEG,
  EPSILON: utils.EPSILON,
  getTime: utils.getTime,
  isPowerOfTwo: utils.isPowerOfTwo,
  nearestPowerOfTwo: utils.nearestPowerOfTwo,
  nextPowerOfTwo: utils.nextPowerOfTwo,
  isFunction: utils.isFunction,
  isArray: utils.isArray,
  isNumber: utils.isNumber,
  getClassName: utils.getClassName,
  cloneObject: utils.cloneObject,
  regexMap: utils.regexMap,
  createCanvas: utils.createCanvas,
  cloneCanvas: utils.cloneCanvas,
  wipeObject: utils.wipeObject,
  extendClass: utils.extendClass,
  HttpRequest: utils.HttpRequest, // asymmetric: global name is HttpRequest, GL name is request
  getFileExtension: utils.getFileExtension,
  loadFileAtlas: utils.loadFileAtlas,
  processFileAtlas: utils.processFileAtlas,
  typedArrayToArray: utils.typedArrayToArray,
  RGBToHex: utils.RGBToHex,
  HUEToRGB: utils.HUEToRGB,
  HSLToRGB: utils.HSLToRGB,
  hexColorToRGBA: utils.hexColorToRGBA,
  toHalfFloat: utils.toHalfFloat,
};

for (const key in globalSymbols) {
  glob[key] = globalSymbols[key];
}

// ---------------------------------------------------------------------------
// Named ESM re-exports (for modern `import { Texture } from "litegl"` consumers).
// ---------------------------------------------------------------------------
export * from "./constants";
export { Indexer, Buffer, Mesh, DynamicMesh, linearizeArray } from "./mesh";
export { Texture } from "./texture";
export { FBO } from "./fbo";
export { Shader } from "./shader";
export { Octree } from "./octree";
export { HitTest, Ray, Raytracer } from "./raytracer";
export { Unwrapper } from "./unwrapper";
export { LEvent } from "./levent";
export { geo, BBox, distanceToPlane, planeBoxOverlap, CLIP_INSIDE, CLIP_OUTSIDE, CLIP_OVERLAP } from "./geo";
export {
  create,
  mapKeyCode,
  augmentEvent,
  isMobile,
} from "./core";
export * from "./utils";
export type { GLContext, CreateContextOptions, LiteGLMouse, GLExtensionsMap } from "./types";
export { temp_vec3, temp2_vec3, temp_vec4, temp_quat, temp_mat3, temp_mat4 } from "./temp";

export default GL;
