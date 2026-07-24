// Ambient declarations for litegl.js
// -----------------------------------
// litegl relies on glMatrix 2.x being loaded as an EXTERNAL GLOBAL (vec2/vec3/vec4/mat3/mat4/quat)
// rather than importing it. These ambient declarations describe that external surface (the subset
// litegl uses, plus the extensions litegl installs in `gl-matrix-extra.ts`) so the strict compiler
// can type-check against it. This file is a global script (no import/export) on purpose.

/** A mutable typed vector/matrix (glMatrix stores everything as Float32Array). */
type FloatArray = Float32Array;
/** A read-only vector/matrix input of arbitrary length: typed array or plain number array. */
type NumberArray = Float32Array | number[] | readonly number[];

// Concrete storage/output types (what litegl actually allocates and returns).
type Vec2 = Float32Array;
type Vec3 = Float32Array;
type Vec4 = Float32Array;
type Mat3 = Float32Array;
type Mat4 = Float32Array;
type Quat = Float32Array;

// Dimensioned read-only argument types. Use these on method parameters so a signature states how
// many components it expects: a `vec2/vec3/vec4` (Float32Array) or an inline `[x, y, ...]` tuple.
// Array literals like `[0, 0, 1]` are accepted directly via contextual typing.
/** A 2-component vector argument: a vec2 (Float32Array) or an `[x, y]` tuple. */
type Vec2Like = Float32Array | readonly [number, number];
/** A 3-component vector argument: a vec3 (Float32Array) or an `[x, y, z]` tuple. */
type Vec3Like = Float32Array | readonly [number, number, number];
/** A 4-component vector argument: a vec4 (Float32Array) or an `[x, y, z, w]` tuple. */
type Vec4Like = Float32Array | readonly [number, number, number, number];

interface GLMatrixVec2 {
  create(): Float32Array;
  clone(a: NumberArray): Float32Array;
  fromValues(x: number, y: number): Float32Array;
  copy(out: Float32Array, a: NumberArray): Float32Array;
  set(out: Float32Array, x: number, y: number): Float32Array;
  add(out: Float32Array, a: NumberArray, b: NumberArray): Float32Array;
  subtract(out: Float32Array, a: NumberArray, b: NumberArray): Float32Array;
  sub(out: Float32Array, a: NumberArray, b: NumberArray): Float32Array;
  scale(out: Float32Array, a: NumberArray, s: number): Float32Array;
  normalize(out: Float32Array, a: NumberArray): Float32Array;
  dot(a: NumberArray, b: NumberArray): number;
  length(a: NumberArray): number;
  len(a: NumberArray): number;
  distance(a: NumberArray, b: NumberArray): number;
  transformMat3(out: Float32Array, a: NumberArray, m: NumberArray): Float32Array;
  // litegl extensions:
  rotate(out: Float32Array, vec: NumberArray, angle_in_rad: number): Float32Array;
  perpdot(a: NumberArray, b: NumberArray): number;
  computeSignedAngle(a: NumberArray, b: NumberArray): number;
  random(vec: Float32Array, scale?: number): Float32Array;
}

interface GLMatrixVec3 {
  create(): Float32Array;
  clone(a: NumberArray): Float32Array;
  fromValues(x: number, y: number, z: number): Float32Array;
  copy(out: Float32Array, a: NumberArray): Float32Array;
  set(out: Float32Array, x: number, y: number, z: number): Float32Array;
  add(out: Float32Array, a: NumberArray, b: NumberArray): Float32Array;
  subtract(out: Float32Array, a: NumberArray, b: NumberArray): Float32Array;
  sub(out: Float32Array, a: NumberArray, b: NumberArray): Float32Array;
  multiply(out: Float32Array, a: NumberArray, b: NumberArray): Float32Array;
  mul(out: Float32Array, a: NumberArray, b: NumberArray): Float32Array;
  divide(out: Float32Array, a: NumberArray, b: NumberArray): Float32Array;
  div(out: Float32Array, a: NumberArray, b: NumberArray): Float32Array;
  scale(out: Float32Array, a: NumberArray, s: number): Float32Array;
  scaleAndAdd(out: Float32Array, a: NumberArray, b: NumberArray, s: number): Float32Array;
  normalize(out: Float32Array, a: NumberArray): Float32Array;
  dot(a: NumberArray, b: NumberArray): number;
  cross(out: Float32Array, a: NumberArray, b: NumberArray): Float32Array;
  length(a: NumberArray): number;
  len(a: NumberArray): number;
  dist(a: NumberArray, b: NumberArray): number;
  sqrDist(a: NumberArray, b: NumberArray): number;
  distance(a: NumberArray, b: NumberArray): number;
  lerp(out: Float32Array, a: NumberArray, b: NumberArray, t: number): Float32Array;
  min(out: Float32Array, a: NumberArray, b: NumberArray): Float32Array;
  max(out: Float32Array, a: NumberArray, b: NumberArray): Float32Array;
  transformMat4(out: Float32Array, a: NumberArray, m: NumberArray): Float32Array;
  transformQuat(out: Float32Array, a: NumberArray, q: NumberArray): Float32Array;
  // litegl extensions:
  ZERO: Float32Array;
  FRONT: Float32Array;
  UP: Float32Array;
  RIGHT: Float32Array;
  zero(a: Float32Array): Float32Array;
  minValue(a: NumberArray): number;
  maxValue(a: NumberArray): number;
  addValue(out: Float32Array, a: NumberArray, v: number): void;
  subValue(out: Float32Array, a: NumberArray, v: number): void;
  toArray(vec: NumberArray): number[];
  rotateX(out: Float32Array, vec: NumberArray, angle_in_rad: number): Float32Array;
  rotateY(out: Float32Array, vec: NumberArray, angle_in_rad: number): Float32Array;
  rotateZ(out: Float32Array, vec: NumberArray, angle_in_rad: number): Float32Array;
  angle(a: NumberArray, b: NumberArray): number;
  signedAngle(from: NumberArray, to: NumberArray, axis: NumberArray): number;
  random(vec: Float32Array, scale?: number): Float32Array;
  cartesianToPolar(out: Float32Array | null, v: NumberArray): Float32Array;
  polarToCartesian(out: Float32Array, v: NumberArray): Float32Array;
  reflect(out: Float32Array, v: NumberArray, n: NumberArray): Float32Array;
  project(out: Float32Array, vec: NumberArray, mvp: NumberArray, viewport?: NumberArray): Float32Array;
  unproject(out: Float32Array, vec: NumberArray, viewprojection: NumberArray, viewport: NumberArray): Float32Array | null;
  getMat3Column(out: Float32Array, m: NumberArray, index: number): Float32Array;
}

interface GLMatrixVec4 {
  create(): Float32Array;
  clone(a: NumberArray): Float32Array;
  fromValues(x: number, y: number, z: number, w: number): Float32Array;
  copy(out: Float32Array, a: NumberArray): Float32Array;
  set(out: Float32Array, x: number, y: number, z: number, w: number): Float32Array;
  add(out: Float32Array, a: NumberArray, b: NumberArray): Float32Array;
  scale(out: Float32Array, a: NumberArray, s: number): Float32Array;
  normalize(out: Float32Array, a: NumberArray): Float32Array;
  dot(a: NumberArray, b: NumberArray): number;
  transformMat4(out: Float32Array, a: NumberArray, m: NumberArray): Float32Array;
  // litegl extensions:
  random(vec: Float32Array, scale?: number): Float32Array;
  toArray(vec: NumberArray): number[];
}

interface GLMatrixMat3 {
  create(): Float32Array;
  clone(a: NumberArray): Float32Array;
  copy(out: Float32Array, a: NumberArray): Float32Array;
  identity(out: Float32Array): Float32Array;
  invert(out: Float32Array, a: NumberArray): Float32Array | null;
  transpose(out: Float32Array, a: NumberArray): Float32Array;
  multiply(out: Float32Array, a: NumberArray, b: NumberArray): Float32Array;
  fromQuat(out: Float32Array, q: NumberArray): Float32Array;
  fromMat4(out: Float32Array, m: NumberArray): Float32Array;
  normalFromMat4(out: Float32Array, m: NumberArray): Float32Array | null;
  // litegl extensions:
  IDENTITY: Float32Array;
  setColumn(out: Float32Array, v: NumberArray, index: number): Float32Array;
}

interface GLMatrixMat4 {
  create(): Float32Array;
  clone(a: NumberArray): Float32Array;
  copy(out: Float32Array, a: NumberArray): Float32Array;
  identity(out: Float32Array): Float32Array;
  invert(out: Float32Array, a: NumberArray): Float32Array | null;
  transpose(out: Float32Array, a: NumberArray): Float32Array;
  multiply(out: Float32Array, a: NumberArray, b: NumberArray): Float32Array;
  mul(out: Float32Array, a: NumberArray, b: NumberArray): Float32Array;
  translate(out: Float32Array, a: NumberArray, v: NumberArray): Float32Array;
  scale(out: Float32Array, a: NumberArray, v: NumberArray): Float32Array;
  rotate(out: Float32Array, a: NumberArray, rad: number, axis: NumberArray): Float32Array | null;
  rotateX(out: Float32Array, a: NumberArray, rad: number): Float32Array;
  rotateY(out: Float32Array, a: NumberArray, rad: number): Float32Array;
  rotateZ(out: Float32Array, a: NumberArray, rad: number): Float32Array;
  perspective(out: Float32Array, fovy: number, aspect: number, near: number, far: number): Float32Array;
  ortho(out: Float32Array, left: number, right: number, bottom: number, top: number, near: number, far: number): Float32Array;
  lookAt(out: Float32Array, eye: NumberArray, center: NumberArray, up: NumberArray): Float32Array;
  fromQuat(out: Float32Array, q: NumberArray): Float32Array;
  fromRotationTranslation(out: Float32Array, q: NumberArray, v: NumberArray): Float32Array;
  // litegl extensions:
  IDENTITY: Float32Array;
  toArray(mat: NumberArray): number[];
  setUpAndOrthonormalize(out: Float32Array, m: Float32Array, up: NumberArray): void;
  multiplyVec3(out: Float32Array, m: NumberArray, a: NumberArray): Float32Array;
  projectVec3(out: Float32Array, m: NumberArray, a: NumberArray): Float32Array;
  rotateVec3(out: Float32Array, m: NumberArray, a: NumberArray): Float32Array;
  fromTranslationFrontTop(out: Float32Array, pos: NumberArray, front: NumberArray, top: NumberArray): Float32Array;
  translationMatrix(v: NumberArray): Float32Array;
  setTranslation(out: Float32Array, v: NumberArray): Float32Array;
  getTranslation(out: Float32Array, matrix: NumberArray): Float32Array;
  toRotationMat4(out: Float32Array, mat: NumberArray): Float32Array;
  swapRows(out: Float32Array, mat: Float32Array, row: number, row2: number): Float32Array;
  scaleAndAdd(out: Float32Array, mat: NumberArray, mat2: NumberArray, v: number): Float32Array;
}

interface GLMatrixQuat {
  create(): Float32Array;
  clone(a: NumberArray): Float32Array;
  copy(out: Float32Array, a: NumberArray): Float32Array;
  identity(out: Float32Array): Float32Array;
  set(out: Float32Array, x: number, y: number, z: number, w: number): Float32Array;
  add(out: Float32Array, a: NumberArray, b: NumberArray): Float32Array;
  multiply(out: Float32Array, a: NumberArray, b: NumberArray): Float32Array;
  mul(out: Float32Array, a: NumberArray, b: NumberArray): Float32Array;
  normalize(out: Float32Array, a: NumberArray): Float32Array;
  slerp(out: Float32Array, a: NumberArray, b: NumberArray, t: number): Float32Array;
  invert(out: Float32Array, a: NumberArray): Float32Array;
  conjugate(out: Float32Array, a: NumberArray): Float32Array;
  setAxisAngle(out: Float32Array, axis: NumberArray, rad: number): Float32Array;
  // litegl extensions:
  fromAxisAngle(axis: NumberArray, rad: number): Float32Array;
  lookRotation(q: Float32Array, front: NumberArray, up: NumberArray): Float32Array;
  toEuler(out: Float32Array | null, q: NumberArray): Float32Array;
  fromEuler(out: Float32Array, vec: NumberArray): Float32Array;
  fromMat4(out: Float32Array, m: NumberArray): void;
  fromMat3AndQuat(q: Float32Array, A: NumberArray, max_iter?: number): Float32Array;
  rotateToFrom(out: Float32Array | null, v1: NumberArray, v2: NumberArray): Float32Array;
  lookAt(out: Float32Array, forwardVector: NumberArray, up: NumberArray): Float32Array;
}

declare const vec2: GLMatrixVec2;
declare const vec3: GLMatrixVec3;
declare const vec4: GLMatrixVec4;
declare const mat3: GLMatrixMat3;
declare const mat4: GLMatrixMat4;
declare const quat: GLMatrixQuat;

/** The glMatrix root object; present when glMatrix 2.x is loaded. Used only for feature detection. */
declare const glMatrix: { vec2?: unknown; vec3?: unknown; [k: string]: unknown } | undefined;

// --- Math extensions installed by gl-matrix-extra.ts ---
interface Math {
  clamp(v: number, a: number, b: number): number;
  lerp(a: number, b: number, f: number): number;
  lerp01(a: number, b: number, f: number): number;
  iLerp(a: number, b: number, v: number): number;
  remap(v: number, min: number, max: number, min2: number, max2: number): number;
}

// --- Built-in prototype extensions installed by utils.ts ---
interface Array<T> {
  clone(): T[];
}
interface String {
  // Note: litegl installs a legacy `replaceAll(words: Record<string,string>)` polyfill only when the
  // native method is absent; it is never called internally, so it is intentionally not typed here to
  // avoid clashing with the native ES2021 String.prototype.replaceAll signature.
  hashCode(): number;
}
interface HTMLImageElement {
  /** Reads the image pixels via a 2D canvas (installed by utils.ts). */
  getPixels(): Uint8ClampedArray;
}
interface Int8Array { toJSON(): number[]; }
interface Uint8Array { toJSON(): number[]; }
interface Uint8ClampedArray { toJSON(): number[]; }
interface Int16Array { toJSON(): number[]; }
interface Uint16Array { toJSON(): number[]; }
interface Int32Array { toJSON(): number[]; }
interface Uint32Array { toJSON(): number[]; }
interface Float32Array {
  toJSON(): number[];
  clone(): Float32Array;
}
interface Float64Array { toJSON(): number[]; }
interface XMLHttpRequest {
  done(callback: (this: XMLHttpRequest, request: XMLHttpRequest) => void): XMLHttpRequest;
  fail(callback: (this: XMLHttpRequest, request: XMLHttpRequest) => void): XMLHttpRequest;
}
// litegl stores extra metadata directly on the opaque WebGLBuffer handle (see Buffer.upload).
interface WebGLBuffer {
  length: number;
  spacing: number;
  gl_type: number;
}

// --- Optional external vendored dependencies (not bundled into the ESM build) ---
declare const DDS:
  | {
      loadDDSTextureEx(
        gl: WebGLRenderingContext,
        ext: unknown,
        url: string,
        texture: WebGLTexture | null,
        flipY: boolean,
        callback?: (texture: WebGLTexture) => void
      ): WebGLTexture;
      loadDDSTextureFromMemoryEx(
        gl: WebGLRenderingContext,
        ext: unknown,
        data: ArrayBuffer,
        texture: WebGLTexture | null,
        flipY: boolean
      ): WebGLTexture;
      getDDSTextureFromMemoryEx?: (...args: unknown[]) => unknown;
    }
  | undefined;

interface WBinStatic {
  classes: Record<string, unknown>;
  isWBin(data: Uint8Array): boolean;
  load(data: Uint8Array, skip_classname?: boolean): unknown;
  create(origin: unknown, class_name?: string): Uint8Array;
}
declare const WBin: WBinStatic | undefined;

interface EarcutStatic {
  (data: number[], holeIndices?: number[] | null, dim?: number): number[];
  flatten(data: number[][]): { vertices: number[]; holes: number[]; dimensions: number };
}
declare const earcut: EarcutStatic | undefined;

// --- DOM event augmentations ---
// GL.augmentEvent() and the input handlers decorate native events with extra fields; these optional
// members describe them so handlers can read them under strict mode.
interface Event {
  eventType?: string;
  is_touch?: boolean;
}
interface MouseEvent {
  mousex: number;
  mousey: number;
  canvasx: number;
  canvasy: number;
  deltax: number;
  deltay: number;
  dragging?: boolean;
  leftButton?: boolean;
  middleButton?: boolean;
  rightButton?: boolean;
  buttons_mask?: number;
  click_time?: number;
  wheel?: number;
  delta?: number;
  skip_preventDefault?: boolean;
  originalEvent?: MouseEvent;
  pinchScaling?: number;
  wheelDelta?: number;
  wheelDeltaY?: number;
  isButtonPressed?(num: number): number;
}
interface KeyboardEvent {
  character?: string;
  isChar?: boolean;
  keyIdentifier?: string;
}

// Hammer.js is an optional external gesture library detected at runtime in core.ts.
declare const Hammer: unknown | undefined;
