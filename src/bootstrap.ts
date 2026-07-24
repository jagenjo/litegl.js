// Environment checks and polyfills that must run before anything else in the library.
//
// litegl expects glMatrix 2.x to be present as a global (vec2/vec3/vec4/mat3/mat4/quat). Unlike the
// original header.js, this ESM build does not auto-`require` glMatrix in Node: consumers must load
// glMatrix 2.x themselves before litegl (browser <script> behaviour is unchanged).

interface AnimationFrameGlobal {
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  mozRequestAnimationFrame?: (callback: FrameRequestCallback) => number;
  webkitRequestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
}

const frameGlobal = globalThis as unknown as AnimationFrameGlobal;

if (typeof glMatrix === "undefined") {
  throw "litegl.js requires gl-matrix to work. It must be included before litegl.";
} else if (typeof vec2 === "undefined") {
  throw "litegl.js does not support gl-matrix 3.0, download 2.8 https://github.com/toji/gl-matrix/releases/tag/v2.8.1";
}

// requestAnimationFrame polyfill
if (!frameGlobal.requestAnimationFrame) {
  frameGlobal.requestAnimationFrame =
    frameGlobal.mozRequestAnimationFrame ||
    frameGlobal.webkitRequestAnimationFrame ||
    function (callback: FrameRequestCallback): number {
      return setTimeout(() => callback(Date.now()), 1000 / 60) as unknown as number;
    };
}
