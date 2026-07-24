// Mesh, Buffer and Indexer classes for litegl.js.
//
// A Mesh wraps several GPU Buffers (vertex streams + index streams) plus some global info such as
// the bounding box. This file ports the original mesh.js verbatim (public API preserved) to strict
// TypeScript. Additional Mesh statics/methods live in primitives.ts and parsers.ts; they are typed
// here as `declare` members so those modules can attach implementations.

import { ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER, STATIC_DRAW } from "./constants";
import type { GLContext } from "./types";
import type { Shader } from "./shader";
import { temp_vec3, temp2_vec3 } from "./temp";
import { BBox } from "./geo";
import { cloneObject, getClassName, HttpRequest } from "./utils";
import type { HttpRequestOptions } from "./utils";

// --- shared type aliases ------------------------------------------------------------------------

/** Any of the numeric typed-array views litegl stores in buffers. */
export type TypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

/** Constructor union for the typed arrays above. */
export type TypedArrayConstructor =
  | Int8ArrayConstructor
  | Uint8ArrayConstructor
  | Uint8ClampedArrayConstructor
  | Int16ArrayConstructor
  | Uint16ArrayConstructor
  | Int32ArrayConstructor
  | Uint32ArrayConstructor
  | Float32ArrayConstructor
  | Float64ArrayConstructor;

/** A callable/newable typed-array constructor accepting a length or a source array. */
type TypedArrayCtorCallable = { new (arg: number | ArrayLike<number>): TypedArray };

/** Maps typed-array class-name strings (as produced by getClassName) back to a constructor. */
const TYPED_ARRAY_CTORS: Record<string, TypedArrayConstructor> = {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
};

/** Generic info about a well-known buffer name (spacing, shader attribute, etc). */
export interface CommonBufferInfo {
  spacing: number;
  attribute: string;
  normalize?: boolean;
  type?: TypedArrayConstructor;
}

/** A submesh group inside Mesh.info.groups. */
export interface MeshGroup {
  name: string;
  start: number;
  length: number;
  material?: string;
  bounding?: Float32Array;
  [key: string]: unknown;
}

/** Extra mesh metadata (groups and anything else). */
export interface MeshInfo {
  groups: MeshGroup[];
  [key: string]: unknown;
}

/** A morph target attached to a mesh. */
export interface MeshMorph {
  name?: string;
  weight?: number;
  buffers: Record<string, Float32Array>;
}

/** Options accepted by the Mesh constructor / addBuffers (spliced onto the instance). */
export interface MeshOptions {
  stream_type?: number;
  info?: MeshInfo;
  bounding?: Float32Array | number[];
  bones?: unknown[];
  morphs?: MeshMorph[];
  [key: string]: unknown;
}

/** Options accepted by the Mesh primitive factories (plane, cube, sphere, ...). */
export interface MeshPrimitiveOptions {
  size?: number;
  sizex?: number;
  sizey?: number;
  sizez?: number;
  width?: number;
  height?: number;
  radius?: number;
  innerradius?: number;
  outerradius?: number;
  detail?: number;
  detailX?: number;
  detailY?: number;
  slices?: number;
  innerslices?: number;
  outerslices?: number;
  subdivisions?: number;
  xz?: boolean;
  xy?: boolean;
  hemi?: boolean;
  caps?: boolean | number;
  lat?: number;
  long?: number;
  angle?: number;
  thickness?: number;
  empty?: boolean;
  extrude?: number;
  wireframe?: boolean;
  lines?: number | boolean;
  triangles?: number[] | TypedArray;
  vertices?: number[] | TypedArray;
  normals?: number[] | TypedArray;
  coords?: number[] | TypedArray;
  bounding?: Float32Array | number[];
  info?: MeshInfo;
  stream_type?: number;
  [key: string]: unknown;
}

/** A mesh format parser (registered in Mesh.parsers). */
export type MeshParser = (data: string | ArrayBuffer, options: Record<string, unknown>) => unknown;
/** A mesh format encoder (registered in Mesh.encoders). */
export type MeshEncoder = (mesh: Mesh, options?: Record<string, unknown>) => unknown;
/** A binary mesh (de)compressor (registered in Mesh.compressors / Mesh.decompressors). */
export type MeshCompressor = (o: Record<string, unknown>) => unknown;

/** Reads GL.debug (attached at runtime by index.ts) without importing the GL namespace. */
function isDebug(): boolean {
  return !!(globalThis as unknown as { GL?: { debug?: boolean } }).GL?.debug;
}

/**
 * Indexer used to reuse vertices among a mesh
 * @class Indexer
 * @constructor
 */
export class Indexer {
  unique: unknown[];
  indices: number[];
  map: Record<string, number>;

  constructor() {
    this.unique = [];
    this.indices = [];
    this.map = {};
  }

  add(obj: unknown): number {
    const key = JSON.stringify(obj);
    if (!(key in this.map)) {
      this.map[key] = this.unique.length;
      this.unique.push(obj);
    }
    return this.map[key];
  }
}

/**
 * A data buffer to be stored in the GPU
 * @class Buffer
 * @constructor
 * @param {Number} target gl.ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER
 * @param {ArrayBufferView} data the data in typed-array format
 * @param {number} spacing number of numbers per component (3 per vertex, 2 per uvs...), default 3
 * @param {enum} stream_type default gl.STATIC_DRAW (other: gl.DYNAMIC_DRAW, gl.STREAM_DRAW
 */
export class Buffer {
  gl: GLContext | null;
  buffer: WebGLBuffer | null;
  target: number;
  attribute: string | null;
  normalize: boolean;
  data: TypedArray;
  spacing: number;
  stream_type?: number;
  name?: string;
  type?: TypedArrayConstructor;
  _context_id?: number;
  _data?: unknown;

  constructor(
    target?: number,
    data?: TypedArray,
    spacing?: number,
    stream_type?: number | null,
    gl?: GLContext | null
  ) {
    if (isDebug()) console.log("GL.Buffer created");

    if (gl !== null) gl = gl || globalThis.gl;
    this.gl = gl ?? null;

    this.buffer = null; //webgl buffer
    this.target = target as number; //GL.ARRAY_BUFFER, GL.ELEMENT_ARRAY_BUFFER
    this.attribute = null; //name of the attribute in the shader ("a_vertex","a_normal","a_coord",...)
    this.normalize = false; //if the value should be normalized between 0 and 1 based on type

    //optional
    this.data = data as TypedArray;
    this.spacing = spacing || 3;

    if (this.data && this.gl) this.upload(stream_type);
  }

  /**
   * binds the buffer to a attrib location
   * @method bind
   * @param {number} location the location of the shader  (from shader.attributes[ name ])
   */
  bind(location: number, gl?: GLContext | null): void {
    gl = gl || this.gl;
    if (!gl) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, this.spacing, this.buffer!.gl_type, this.normalize || false, 0, 0);
  }

  /**
   * unbinds the buffer from an attrib location
   * @method unbind
   * @param {number} location the location of the shader
   */
  unbind(location: number, gl?: GLContext | null): void {
    gl = gl || this.gl;
    if (!gl) return;
    gl.disableVertexAttribArray(location);
  }

  /**
   * Applies an action to every vertex in this buffer
   * @method forEach
   * @param {function} callback to be called for every vertex (or whatever is contained in the buffer)
   */
  forEach(callback: (chunk: TypedArray, index: number) => void): this {
    const d = this.data;
    for (let i = 0, s = this.spacing, l = d.length; i < l; i += s) {
      callback(d.subarray(i, i + s), i);
    }
    return this; //to concatenate
  }

  /**
   * Applies a mat4 transform to every triplets in the buffer (assuming they are points)
   * No upload is performed (to ensure efficiency in case there are several operations performed)
   * @method applyTransform
   * @param {mat4} mat
   */
  applyTransform(mat: NumberArray): this {
    const d = this.data;
    for (let i = 0, s = this.spacing, l = d.length; i < l; i += s) {
      const v = d.subarray(i, i + s) as Float32Array;
      vec3.transformMat4(v, v, mat);
    }
    return this; //to concatenate
  }

  /**
   * Uploads the buffer data (stored in this.data) to the GPU
   * @method upload
   * @param {number} stream_type default gl.STATIC_DRAW (other: gl.DYNAMIC_DRAW, gl.STREAM_DRAW
   */
  upload(stream_type?: number | null): void {
    //default gl.STATIC_DRAW (other: gl.DYNAMIC_DRAW, gl.STREAM_DRAW )
    const spacing = this.spacing || 3; //default spacing
    const gl = this.gl;
    if (!gl) return;

    if (!this.data) throw "No data supplied";

    let data = this.data;
    if (!data.buffer) throw "Buffers must be typed arrays";

    //I store some stuff inside the WebGL buffer instance, it is supported
    this.buffer = this.buffer || gl.createBuffer();
    if (!this.buffer) return; //if the context is lost...

    this.buffer.length = data.length;
    this.buffer.spacing = spacing;

    //store the data format
    switch (data.constructor) {
      case Int8Array:
        this.buffer.gl_type = gl.BYTE;
        break;
      case Uint8ClampedArray:
      case Uint8Array:
        this.buffer.gl_type = gl.UNSIGNED_BYTE;
        break;
      case Int16Array:
        this.buffer.gl_type = gl.SHORT;
        break;
      case Uint16Array:
        this.buffer.gl_type = gl.UNSIGNED_SHORT;
        break;
      case Int32Array:
        this.buffer.gl_type = gl.INT;
        break;
      case Uint32Array:
        this.buffer.gl_type = gl.UNSIGNED_INT;
        break;
      case Float32Array:
        this.buffer.gl_type = gl.FLOAT;
        break;
      default:
        throw "unsupported buffer type";
    }

    if (this.target == gl.ARRAY_BUFFER && (this.buffer.gl_type == gl.INT || this.buffer.gl_type == gl.UNSIGNED_INT)) {
      console.warn("WebGL does not support UINT32 or INT32 as vertex buffer types, converting to FLOAT");
      this.buffer.gl_type = gl.FLOAT;
      data = new Float32Array(data);
    }

    gl.bindBuffer(this.target, this.buffer);
    gl.bufferData(this.target, data, stream_type || this.stream_type || gl.STATIC_DRAW);
  }

  //legacy
  compile(stream_type?: number | null): void {
    this.upload(stream_type);
  }

  /**
   * Assign data to buffer and uploads it (it allows range)
   * @method setData
   * @param {ArrayBufferView} data in Float32Array format usually
   * @param {number} offset offset in bytes
   */
  setData(data: TypedArray, offset?: number): void {
    if (!data.buffer) throw "Data must be typed array";
    offset = offset || 0;

    if (!this.data) {
      this.data = data;
      this.upload();
      return;
    } else if (this.data.length < data.length)
      throw "buffer is not big enough, you cannot set data to a smaller buffer";

    if (this.data != data) {
      if (this.data.length == data.length) {
        this.data.set(data);
        this.upload();
        return;
      }

      //upload just part of it
      const new_data_view = new Uint8Array(
        data.buffer,
        (data.buffer as unknown as { byteOffset?: number }).byteOffset,
        data.buffer.byteLength
      );
      const data_view = new Uint8Array(this.data.buffer);
      data_view.set(new_data_view, offset);
      this.uploadRange(offset, new_data_view.length);
    }
  }

  /**
   * Uploads part of the buffer data (stored in this.data) to the GPU
   * @method uploadRange
   * @param {number} start offset in bytes
   * @param {number} size sizes in bytes
   */
  uploadRange(start: number, size: number): void {
    if (!this.data) throw "No data stored in this buffer";

    const data = this.data;
    if (!data.buffer) throw "Buffers must be typed arrays";

    //cut fragment to upload (no way to avoid GC here, no function to specify the size in WebGL 1.0, but there is one in WebGL 2.0)
    const view = new Uint8Array(this.data.buffer, start, size);

    const gl = this.gl;
    if (!gl) return;
    gl.bindBuffer(this.target, this.buffer);
    gl.bufferSubData(this.target, start, view);
  }

  /**
   * Clones one buffer (it allows to share the same data between both buffers)
   * @method clone
   * @param {boolean} share if you want that both buffers share the same data (default false)
   * return {GL.Buffer} buffer cloned
   */
  clone(share?: boolean): Buffer {
    const buffer = new Buffer();
    if (share) {
      const src = this as unknown as Record<string, unknown>;
      const dst = buffer as unknown as Record<string, unknown>;
      for (const i in src) dst[i] = src[i];
    } else {
      if (this.target) buffer.target = this.target;
      if (this.gl) buffer.gl = this.gl;
      if (this.spacing) buffer.spacing = this.spacing;
      if (this.data) {
        //clone data
        const ctor = this.data.constructor as TypedArrayCtorCallable;
        buffer.data = new ctor(this.data);
        buffer.upload();
      }
    }
    return buffer;
  }

  toJSON(): Record<string, unknown> | null {
    if (!this.data) {
      console.error("cannot serialize a mesh without data");
      return null;
    }

    return {
      data_type: getClassName(this.data),
      data: this.data.toJSON(),
      target: this.target,
      attribute: this.attribute,
      spacing: this.spacing,
    };
  }

  fromJSON(o: {
    data_type: string;
    data: ArrayLike<number>;
    target: number;
    spacing?: number;
    attribute: string | null;
  }): void {
    const data_type = TYPED_ARRAY_CTORS[o.data_type] || Float32Array;
    this.data = new (data_type as TypedArrayCtorCallable)(o.data); //cloned
    this.target = o.target;
    this.spacing = o.spacing || 3;
    this.attribute = o.attribute;
    this.upload(STATIC_DRAW);
  }

  /**
   * Deletes the content from the GPU and destroys the handler
   * @method delete
   */
  delete(): void {
    const gl = this.gl;
    if (!gl) return;
    gl.deleteBuffer(this.buffer);
    this.buffer = null;
  }
}

/**
 * Base class for meshes, it wraps several buffers and some global info like the bounding box
 * @class Mesh
 * @param {Object} vertexBuffers object with all the vertex streams
 * @param {Object} indexBuffers object with all the indices streams
 * @param {Object} options
 * @param {WebGLContext} gl [Optional] gl context where to create the mesh
 * @constructor
 */
export class Mesh {
  gl?: GLContext;
  _context_id?: number;
  vertexBuffers: Record<string, Buffer>;
  indexBuffers: Record<string, Buffer>;
  info: MeshInfo;
  _bounding: Float32Array;
  metadata?: { faces?: number; vertices?: number; indexed?: boolean; [key: string]: unknown };
  morphs?: MeshMorph[];
  bones?: unknown[];
  ready?: boolean;

  // --- static registries and defaults defined in this file ---
  static common_buffers: Record<string, CommonBufferInfo> = {
    vertices: { spacing: 3, attribute: "a_vertex" },
    vertices2D: { spacing: 2, attribute: "a_vertex2D" },
    normals: { spacing: 3, attribute: "a_normal", normalize: true },
    coords: { spacing: 2, attribute: "a_coord" },
    coords1: { spacing: 2, attribute: "a_coord1" },
    coords2: { spacing: 2, attribute: "a_coord2" },
    colors: { spacing: 4, attribute: "a_color", normalize: true }, // cant use Uint8Array, dont know how as data comes in another format
    tangents: { spacing: 3, attribute: "a_tangent" },
    bone_indices: { spacing: 4, attribute: "a_bone_indices", type: Uint8Array },
    weights: { spacing: 4, attribute: "a_weights", normalize: true }, // cant use Uint8Array, dont know how
    extra: { spacing: 1, attribute: "a_extra" },
    extra2: { spacing: 2, attribute: "a_extra2" },
    extra3: { spacing: 3, attribute: "a_extra3" },
    extra4: { spacing: 4, attribute: "a_extra4" },
  };

  static default_datatype: TypedArrayConstructor = Float32Array;

  //Here we store all basic mesh parsers (OBJ, STL) and encoders
  static parsers: Record<string, MeshParser> = {};
  static encoders: Record<string, MeshEncoder> = {};
  static binary_file_formats: Record<string, boolean> = {}; //extensions that must be downloaded in binary
  static compressors: Record<string, MeshCompressor> = {}; //used to compress binary meshes
  static decompressors: Record<string, MeshCompressor> = {}; //used to decompress binary meshes

  static EXTENSION = "wbin";
  static enable_wbin_compression = true;

  // --- statics implemented in primitives.ts (declare-only: type without runtime emit) ---
  declare static plane: (options?: MeshPrimitiveOptions, gl?: GLContext) => Mesh;
  declare static plane2D: (options?: MeshPrimitiveOptions, gl?: GLContext) => Mesh;
  declare static point: (options?: MeshPrimitiveOptions) => Mesh;
  declare static cube: (options?: MeshPrimitiveOptions, gl?: GLContext) => Mesh;
  declare static box: (options?: MeshPrimitiveOptions, gl?: GLContext) => Mesh;
  declare static circle: (options?: MeshPrimitiveOptions, gl?: GLContext) => Mesh;
  declare static ring: (options?: MeshPrimitiveOptions, gl?: GLContext) => Mesh;
  declare static cylinder: (options?: MeshPrimitiveOptions, gl?: GLContext) => Mesh;
  declare static cone: (options?: MeshPrimitiveOptions, gl?: GLContext) => Mesh;
  declare static torus: (options?: MeshPrimitiveOptions, gl?: GLContext) => Mesh;
  declare static sphere: (options?: MeshPrimitiveOptions, gl?: GLContext) => Mesh;
  declare static grid: (options?: MeshPrimitiveOptions, gl?: GLContext) => Mesh;
  declare static icosahedron: (options?: MeshPrimitiveOptions, gl?: GLContext) => Mesh;
  declare static shape: (line: number[] | number[][], options?: MeshPrimitiveOptions, gl?: GLContext) => Mesh;

  // --- statics/instance-methods implemented in parsers.ts (declare-only) ---
  declare static parseOBJ: (text: string, options?: Record<string, unknown>) => Mesh;
  declare static fromBinary: (data_array: ArrayBuffer | Uint8Array, options?: Record<string, unknown>) => Mesh;
  declare static compress: (o: Record<string, unknown>, format?: string) => unknown;
  declare static decompress: (o: Record<string, unknown>) => unknown;
  declare toBinary: (options?: Record<string, unknown>) => unknown;

  constructor(
    vertexbuffers?: Record<string, unknown> | null,
    indexbuffers?: Record<string, unknown> | null,
    options?: MeshOptions | null,
    gl?: GLContext | null
  ) {
    if (isDebug()) console.log("GL.Mesh created");

    if (gl !== null) {
      gl = gl || globalThis.gl;
      this.gl = gl;
    }

    //used to avoid problems with resources moving between different webgl context
    if (this.gl) this._context_id = this.gl.context_id;

    this.vertexBuffers = {};
    this.indexBuffers = {};

    //here you can store extra info, like groups, which is an array of { name, start, length, material }
    this.info = {
      groups: [],
    };
    this._bounding = BBox.create(); //here you can store a AABB in BBox format

    if (vertexbuffers || indexbuffers)
      this.addBuffers(vertexbuffers, indexbuffers, options ? options.stream_type : null);

    if (options) {
      const self = this as unknown as Record<string, unknown>;
      const opts = options as unknown as Record<string, unknown>;
      for (const i in opts) self[i] = opts[i];
    }
  }

  get bounding(): Float32Array {
    return this._bounding;
  }

  set bounding(v: NumberArray | null | undefined) {
    if (!v) return;
    if (v.length < 13)
      throw "Bounding must use the BBox bounding format of 13 floats: center, halfsize, min, max, radius";
    this._bounding.set(v);
  }

  /**
   * Adds buffer to mesh
   * @method addBuffer
   * @param {string} name
   * @param {Buffer} buffer
   */
  addBuffer(name: string, buffer: Buffer): void {
    if (buffer.target == gl.ARRAY_BUFFER) this.vertexBuffers[name] = buffer;
    else this.indexBuffers[name] = buffer;

    if (!buffer.attribute) {
      const info = Mesh.common_buffers[name];
      if (info) buffer.attribute = info.attribute;
    }
  }

  /**
   * Adds vertex and indices buffers to a mesh
   * @method addBuffers
   * @param {Object} vertexBuffers object with all the vertex streams
   * @param {Object} indexBuffers object with all the indices streams
   * @param {enum} stream_type default gl.STATIC_DRAW (other: gl.DYNAMIC_DRAW, gl.STREAM_DRAW )
   */
  addBuffers(
    vertexbuffers?: Record<string, unknown> | null,
    indexbuffers?: Record<string, unknown> | null,
    stream_type?: number | null
  ): void {
    let num_vertices = 0;

    if (this.vertexBuffers["vertices"]) num_vertices = this.vertexBuffers["vertices"].data.length / 3;

    for (const i in vertexbuffers) {
      let data = vertexbuffers[i] as unknown;
      if (!data) continue;

      if ((data as { constructor: unknown }).constructor === Buffer || (data as { data?: unknown }).data) {
        //allows to clone meshes
        data = (data as { data: unknown }).data;
      } else if (typeof (data as ArrayLike<number>)[0] != "number") {
        //linearize: (transform Arrays in typed arrays)
        let newdata: number[] = [];
        const arr = data as unknown[];
        for (let j = 0, chunk = 10000; j < arr.length; j += chunk) {
          newdata = Array.prototype.concat.apply(newdata, arr.slice(j, j + chunk) as number[]);
        }
        data = newdata;
      }

      const stream_info = Mesh.common_buffers[i];

      //cast to typed float32 if no type is specified
      if ((data as { constructor: unknown }).constructor === Array) {
        let datatype: TypedArrayConstructor = Mesh.default_datatype;
        if (stream_info && stream_info.type) datatype = stream_info.type;
        data = new (datatype as TypedArrayCtorCallable)(data as ArrayLike<number>);
      }

      //compute spacing
      if (i == "vertices") num_vertices = (data as TypedArray).length / 3;
      let spacing = (data as TypedArray).length / num_vertices;
      if (stream_info && stream_info.spacing) spacing = stream_info.spacing;

      //add and upload
      let attribute = "a_" + i;
      if (stream_info && stream_info.attribute) attribute = stream_info.attribute;

      if (this.vertexBuffers[i]) this.updateVertexBuffer(i, attribute, spacing, data as TypedArray, stream_type);
      else this.createVertexBuffer(i, attribute, spacing, data as TypedArray, stream_type);
    }

    if (indexbuffers)
      for (const i in indexbuffers) {
        let data = indexbuffers[i] as unknown;
        if (!data) continue;

        if ((data as { constructor: unknown }).constructor === Buffer || (data as { data?: unknown }).data) {
          data = (data as { data: unknown }).data;
        }
        if (typeof (data as ArrayLike<number>)[0] != "number") {
          //linearize
          let newdata: number[] = [];
          const arr = data as unknown[];
          for (let k = 0, chunk = 10000; k < arr.length; k += chunk) {
            newdata = Array.prototype.concat.apply(newdata, arr.slice(k, k + chunk) as number[]);
          }
          data = newdata;
        }

        //cast to typed
        if ((data as { constructor: unknown }).constructor === Array) {
          let datatype: TypedArrayConstructor = Uint16Array;
          if (num_vertices > 256 * 256) datatype = Uint32Array;
          data = new (datatype as TypedArrayCtorCallable)(data as ArrayLike<number>);
        }

        this.createIndexBuffer(i, data as TypedArray);
      }
  }

  /**
   * Creates a new empty buffer and attachs it to this mesh
   * @method createVertexBuffer
   * @param {String} name "vertices","normals"...
   * @param {String} attribute name of the stream in the shader "a_vertex","a_normal",... [optional, if omitted is used the common_buffers]
   * @param {number} spacing components per vertex [optional, if ommited is used the common_buffers, if not found then uses 3 ]
   * @param {ArrayBufferView} buffer_data the data in typed array format [optional, if ommited it created an empty array of getNumVertices() * spacing]
   * @param {enum} stream_type [optional, default = gl.STATIC_DRAW (other: gl.DYNAMIC_DRAW, gl.STREAM_DRAW ) ]
   */
  createVertexBuffer(
    name: string,
    attribute?: string | null,
    buffer_spacing?: number,
    buffer_data?: TypedArray,
    stream_type?: number | null
  ): Buffer {
    const common = Mesh.common_buffers[name]; //generic info about a buffer with the same name

    if (!attribute && common) attribute = common.attribute;

    if (!attribute) throw "Buffer added to mesh without attribute name";

    if (!buffer_spacing && common) {
      if (common && common.spacing) buffer_spacing = common.spacing;
      else buffer_spacing = 3;
    }

    if (!buffer_data) {
      const num = this.getNumVertices();
      if (!num) throw "Cannot create an empty buffer in a mesh without vertices (vertices are needed to know the size)";
      buffer_data = new Mesh.default_datatype(num * (buffer_spacing as number));
    }

    if (!buffer_data.buffer) throw "Buffer data MUST be typed array";

    //used to ensure the buffers are held in the same gl context as the mesh
    const buffer = (this.vertexBuffers[name] = new Buffer(ARRAY_BUFFER, buffer_data, buffer_spacing, stream_type, this.gl));
    buffer.name = name;
    buffer.attribute = attribute;

    //to convert [255,128,...] into [1,0.5,...]  in the shader
    if (
      buffer_data.constructor == Uint8Array ||
      buffer_data.constructor == Int8Array ||
      buffer_data.constructor == Uint16Array ||
      buffer_data.constructor == Int16Array ||
      buffer_data.constructor == Uint32Array ||
      buffer_data.constructor == Int32Array
    ) {
      if (common && common.normalize) buffer.normalize = true;
    }

    return buffer;
  }

  /**
   * Updates a vertex buffer
   * @method updateVertexBuffer
   * @param {String} name the name of the buffer
   * @param {String} attribute the name of the attribute in the shader
   * @param {number} spacing number of numbers per component (3 per vertex, 2 per uvs...), default 3
   * @param {*} data the array with all the data
   * @param {enum} stream_type default gl.STATIC_DRAW (other: gl.DYNAMIC_DRAW, gl.STREAM_DRAW
   */
  updateVertexBuffer(
    name: string,
    attribute: string,
    buffer_spacing: number,
    buffer_data: TypedArray,
    stream_type?: number | null
  ): void {
    const buffer = this.vertexBuffers[name];
    if (!buffer) {
      console.log("buffer not found: ", name);
      return;
    }

    if (!buffer_data.length) return;

    buffer.attribute = attribute;
    buffer.spacing = buffer_spacing;
    buffer.data = buffer_data;
    buffer.upload(stream_type);
  }

  /**
   * Removes a vertex buffer from the mesh
   * @method removeVertexBuffer
   * @param {String} name "vertices","normals"...
   * @param {Boolean} free if you want to remove the data from the GPU
   */
  removeVertexBuffer(name: string, free?: boolean): void {
    const buffer = this.vertexBuffers[name];
    if (!buffer) return;
    if (free) buffer.delete();
    delete this.vertexBuffers[name];
  }

  /**
   * Returns a vertex buffer
   * @method getVertexBuffer
   * @param {String} name of vertex buffer
   * @return {Buffer} the buffer
   */
  getVertexBuffer(name: string): Buffer {
    return this.vertexBuffers[name];
  }

  /**
   * Creates a new empty index buffer and attachs it to this mesh
   * @method createIndexBuffer
   * @param {String} name
   * @param {Typed array} data
   * @param {enum} stream_type gl.STATIC_DRAW, gl.DYNAMIC_DRAW, gl.STREAM_DRAW
   */
  createIndexBuffer(name: string, buffer_data: TypedArray | number[], stream_type?: number | null): Buffer {
    //(target, data, spacing, stream_type, gl)

    //cast to typed
    if (buffer_data.constructor === Array) {
      let datatype: TypedArrayConstructor = Uint16Array;
      const vertices = this.vertexBuffers["vertices"];
      if (vertices) {
        const num_vertices = vertices.data.length / 3;
        if (num_vertices > 256 * 256) datatype = Uint32Array;
        buffer_data = new (datatype as TypedArrayCtorCallable)(buffer_data as ArrayLike<number>);
      }
    }

    const buffer = (this.indexBuffers[name] = new Buffer(
      ELEMENT_ARRAY_BUFFER,
      buffer_data as TypedArray,
      0,
      stream_type,
      this.gl
    ));
    return buffer;
  }

  /**
   * Returns a vertex buffer
   * @method getBuffer
   * @param {String} name of vertex buffer
   * @return {Buffer} the buffer
   */
  getBuffer(name: string): Buffer {
    return this.vertexBuffers[name];
  }

  /**
   * Returns a index buffer
   * @method getIndexBuffer
   * @param {String} name of index buffer
   * @return {Buffer} the buffer
   */
  getIndexBuffer(name: string): Buffer {
    return this.indexBuffers[name];
  }

  /**
   * Removes an index buffer from the mesh
   * @method removeIndexBuffer
   * @param {String} name "vertices","normals"...
   * @param {Boolean} free if you want to remove the data from the GPU
   */
  removeIndexBuffer(name: string, free?: boolean): void {
    const buffer = this.indexBuffers[name];
    if (!buffer) return;
    if (free) buffer.delete();
    delete this.indexBuffers[name];
  }

  /**
   * Uploads data inside buffers to VRAM.
   * @method upload
   * @param {number} buffer_type gl.STATIC_DRAW, gl.DYNAMIC_DRAW, gl.STREAM_DRAW
   */
  upload(buffer_type?: number): void {
    for (const attribute in this.vertexBuffers) {
      const buffer = this.vertexBuffers[attribute];
      //buffer.data = this[buffer.name];
      buffer.upload(buffer_type);
    }

    for (const name in this.indexBuffers) {
      const buffer = this.indexBuffers[name];
      //buffer.data = this[name];
      buffer.upload();
    }
  }

  //LEGACY, plz remove
  compile(buffer_type?: number): void {
    this.upload(buffer_type);
  }

  deleteBuffers(): void {
    for (const i in this.vertexBuffers) {
      const buffer = this.vertexBuffers[i];
      buffer.delete();
    }
    this.vertexBuffers = {};

    for (const i in this.indexBuffers) {
      const buffer = this.indexBuffers[i];
      buffer.delete();
    }
    this.indexBuffers = {};
  }

  delete(): void {
    this.deleteBuffers();
  }

  bindBuffers(shader: Shader): void {
    // enable attributes as necessary.
    for (const name in this.vertexBuffers) {
      const buffer = this.vertexBuffers[name];
      const attribute = buffer.attribute || name;
      const location = shader.attributes[attribute];
      if (location == null || !buffer.buffer) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer.buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, buffer.buffer.spacing, buffer.buffer.gl_type, buffer.normalize || false, 0, 0);
    }
  }

  unbindBuffers(shader: Shader): void {
    // disable attributes
    for (const name in this.vertexBuffers) {
      const buffer = this.vertexBuffers[name];
      const attribute = buffer.attribute || name;
      const location = shader.attributes[attribute];
      if (location == null || !buffer.buffer) continue; //ignore this buffer
      gl.disableVertexAttribArray(shader.attributes[attribute]);
    }
  }

  /**
   * Creates a clone of the mesh, the datarrays are cloned too
   * @method clone
   */
  clone(gl?: GLContext | null): Mesh {
    gl = gl || globalThis.gl;
    const vbs: Record<string, TypedArray> = {};
    const ibs: Record<string, TypedArray> = {};

    for (const i in this.vertexBuffers) {
      const b = this.vertexBuffers[i];
      const ctor = b.data.constructor as TypedArrayCtorCallable;
      vbs[i] = new ctor(b.data); //clone
    }
    for (const i in this.indexBuffers) {
      const b = this.indexBuffers[i];
      const ctor = b.data.constructor as TypedArrayCtorCallable;
      ibs[i] = new ctor(b.data); //clone
    }

    return new Mesh(vbs, ibs, undefined, gl);
  }

  /**
   * Creates a clone of the mesh, but the data-arrays are shared between both meshes (useful for sharing a mesh between contexts)
   * @method clone
   */
  cloneShared(gl?: GLContext | null): Mesh {
    gl = gl || globalThis.gl;
    return new Mesh(this.vertexBuffers, this.indexBuffers, undefined, gl);
  }

  /**
   * Creates an object with the info of the mesh (useful to transfer to workers)
   * @method toObject
   */
  toObject(): Record<string, unknown> {
    const vbs: Record<string, { spacing: number; data: TypedArray }> = {};
    const ibs: Record<string, { data: TypedArray }> = {};

    for (const i in this.vertexBuffers) {
      const b = this.vertexBuffers[i];
      const ctor = b.data.constructor as TypedArrayCtorCallable;
      vbs[i] = {
        spacing: b.spacing,
        data: new ctor(b.data), //clone
      };
    }
    for (const i in this.indexBuffers) {
      const b = this.indexBuffers[i];
      const ctor = b.data.constructor as TypedArrayCtorCallable;
      ibs[i] = {
        data: new ctor(b.data), //clone
      };
    }

    return {
      vertexBuffers: vbs,
      indexBuffers: ibs,
      info: this.info ? cloneObject(this.info) : null,
      bounding: this._bounding.toJSON(),
    };
  }

  toJSON(): Record<string, unknown> {
    const r: {
      vertexBuffers: Record<string, unknown>;
      indexBuffers: Record<string, unknown>;
      info: Record<string, unknown> | null;
      bounding: number[];
    } = {
      vertexBuffers: {},
      indexBuffers: {},
      info: this.info ? cloneObject(this.info) : null,
      bounding: this._bounding.toJSON(),
    };

    for (const i in this.vertexBuffers) r.vertexBuffers[i] = this.vertexBuffers[i].toJSON();

    for (const i in this.indexBuffers) r.indexBuffers[i] = this.indexBuffers[i].toJSON();

    return r;
  }

  fromJSON(o: {
    vertexBuffers?: Record<string, Parameters<Buffer["fromJSON"]>[0] | null>;
    indexBuffers?: Record<string, Parameters<Buffer["fromJSON"]>[0] | null>;
    info?: MeshInfo;
    bounding?: NumberArray;
  }): void {
    this.vertexBuffers = {};
    this.indexBuffers = {};

    for (const i in o.vertexBuffers) {
      if (!o.vertexBuffers[i]) continue;
      const buffer = new Buffer();
      buffer.fromJSON(o.vertexBuffers[i]!);
      if (!buffer.attribute && Mesh.common_buffers[i]) buffer.attribute = Mesh.common_buffers[i].attribute;
      this.vertexBuffers[i] = buffer;
    }

    for (const i in o.indexBuffers) {
      if (!o.indexBuffers[i]) continue;
      const buffer = new Buffer();
      buffer.fromJSON(o.indexBuffers[i]!);
      this.indexBuffers[i] = buffer;
    }

    if (o.info) this.info = cloneObject(o.info) as unknown as MeshInfo;
    if (o.bounding) this.bounding = o.bounding; //setter does the job
  }

  /**
   * Computes some data about the mesh
   * @method generateMetadata
   */
  generateMetadata(): void {
    const metadata: { faces?: number; vertices?: number; indexed?: boolean; [key: string]: unknown } = {};

    const vertices = this.vertexBuffers["vertices"].data;
    const triangles = this.indexBuffers["triangles"].data;

    metadata.vertices = vertices.length / 3;
    if (triangles) metadata.faces = triangles.length / 3;
    else metadata.faces = vertices.length / 9;

    metadata.indexed = !!this.metadata!.faces;
    this.metadata = metadata;
  }

  //never tested
  /*
	draw(shader, mode, range_start, range_length)
	{
		if(range_length == 0) return;

		// Create and enable attribute pointers as necessary.
		var length = 0;
		for (var attribute in this.vertexBuffers) {
		  var buffer = this.vertexBuffers[attribute];
		  var location = shader.attributes[attribute] ||
			gl.getAttribLocation(shader.program, attribute);
		  if (location == -1 || !buffer.buffer) continue;
		  shader.attributes[attribute] = location;
		  gl.bindBuffer(gl.ARRAY_BUFFER, buffer.buffer);
		  gl.enableVertexAttribArray(location);
		  gl.vertexAttribPointer(location, buffer.buffer.spacing, gl.FLOAT, false, 0, 0);
		  length = buffer.buffer.length / buffer.buffer.spacing;
		}

		//range rendering
		var offset = 0;
		if(arguments.length > 3) //render a polygon range
			offset = range_start * (this.indexBuffer ? this.indexBuffer.constructor.BYTES_PER_ELEMENT : 1); //in bytes (Uint16 == 2 bytes)

		if(arguments.length > 4)
			length = range_length;
		else if (this.indexBuffer)
			length = this.indexBuffer.buffer.length - offset;

		// Disable unused attribute pointers.
		for (var attribute in shader.attributes) {
		  if (!(attribute in this.vertexBuffers)) {
			gl.disableVertexAttribArray(shader.attributes[attribute]);
		  }
		}

		// Draw the geometry.
		if (length && (!this.indexBuffer || indexBuffer.buffer)) {
		  if (this.indexBuffer) {
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer.buffer);
			gl.drawElements(mode, length, gl.UNSIGNED_SHORT, offset);
		  } else {
			gl.drawArrays(mode, offset, length);
		  }
		}

		return this;
	}
	*/

  /**
   * Creates a new index stream with wireframe
   * @method computeWireframe
   */
  computeWireframe(): this {
    const index_buffer = this.indexBuffers["triangles"];

    const vertices = this.vertexBuffers["vertices"].data;
    const num_vertices = vertices.length / 3;

    let buffer: Uint16Array | Uint32Array;

    if (!index_buffer) {
      //unindexed
      const num_triangles = num_vertices / 3;
      buffer = num_vertices > 256 * 256 ? new Uint32Array(num_triangles * 6) : new Uint16Array(num_triangles * 6);
      for (let i = 0; i < num_vertices; i += 3) {
        buffer[i * 2] = i;
        buffer[i * 2 + 1] = i + 1;
        buffer[i * 2 + 2] = i + 1;
        buffer[i * 2 + 3] = i + 2;
        buffer[i * 2 + 4] = i + 2;
        buffer[i * 2 + 5] = i;
      }
    } else {
      //indexed
      const data = index_buffer.data;

      const indexer = new Indexer();
      for (let i = 0; i < data.length; i += 3) {
        const t = data.subarray(i, i + 3);
        for (let j = 0; j < t.length; j++) {
          const a = t[j],
            b = t[(j + 1) % t.length];
          indexer.add([Math.min(a, b), Math.max(a, b)]);
        }
      }

      //linearize
      const unique = indexer.unique;
      buffer = num_vertices > 256 * 256 ? new Uint32Array(unique.length * 2) : new Uint16Array(unique.length * 2);
      for (let i = 0, l = unique.length; i < l; ++i) buffer.set(unique[i] as ArrayLike<number>, i * 2);
    }

    //create stream
    this.createIndexBuffer("wireframe", buffer);
    return this;
  }

  /**
   * Multiplies every normal by -1 and uploads it
   * @method flipNormals
   * @param {enum} stream_type default gl.STATIC_DRAW (other: gl.DYNAMIC_DRAW, gl.STREAM_DRAW)
   */
  flipNormals(stream_type?: number | null): void {
    const normals_buffer = this.vertexBuffers["normals"];
    if (!normals_buffer) return;
    const normals_data = normals_buffer.data;
    const nl = normals_data.length;
    for (let i = 0; i < nl; ++i) normals_data[i] *= -1;
    normals_buffer.upload(stream_type);

    //reverse indices too
    if (!this.indexBuffers["triangles"]) this.computeIndices(); //create indices

    const triangles_buffer = this.indexBuffers["triangles"];
    const data = triangles_buffer.data;
    const l = data.length;
    for (let i = 0; i < l; i += 3) {
      const tmp = data[i];
      data[i] = data[i + 1];
      data[i + 1] = tmp;
      //the [i+2] stays the same
    }
    triangles_buffer.upload(stream_type);
  }

  /**
   * Compute indices for a mesh where vertices are shared
   * @method computeIndices
   */
  computeIndices(): void {
    //cluster by distance
    const new_vertices: Float32Array[] = [];
    const new_normals: Float32Array[] = [];
    const new_coords: Float32Array[] = [];

    const indices: number[] = [];

    const old_vertices_buffer = this.vertexBuffers["vertices"];
    const old_normals_buffer = this.vertexBuffers["normals"];
    const old_coords_buffer = this.vertexBuffers["coords"];

    const old_vertices_data = old_vertices_buffer.data as Float32Array;

    let old_normals_data: Float32Array | null = null;
    if (old_normals_buffer) old_normals_data = old_normals_buffer.data as Float32Array;

    let old_coords_data: Float32Array | null = null;
    if (old_coords_buffer) old_coords_data = old_coords_buffer.data as Float32Array;

    const indexer: Record<number, number[]> = {};

    const l = old_vertices_data.length / 3;
    let j = 0;
    let l2 = 0;
    for (let i = 0; i < l; ++i) {
      const v = old_vertices_data.subarray(i * 3, (i + 1) * 3);
      const key = (v[0] * 1000) | 0;

      //search in new_vertices
      j = 0;
      const candidates = indexer[key];
      if (candidates) {
        l2 = candidates.length;
        for (; j < l2; j++) {
          const v2 = new_vertices[candidates[j]];
          //same vertex
          if (vec3.sqrDist(v, v2) < 0.01) {
            indices.push(j);
            break;
          }
        }
      }

      if (candidates && j != l2) continue;

      const index = j;
      new_vertices.push(v);
      if (indexer[key]) indexer[key].push(index);
      else indexer[key] = [index];

      if (old_normals_data) new_normals.push(old_normals_data.subarray(i * 3, (i + 1) * 3));
      if (old_coords_data) new_coords.push(old_coords_data.subarray(i * 2, (i + 1) * 2));
      indices.push(index);
    }

    this.vertexBuffers = {}; //erase all

    //new buffers
    this.createVertexBuffer("vertices", Mesh.common_buffers["vertices"].attribute, 3, linearizeArray(new_vertices));
    if (old_normals_data)
      this.createVertexBuffer("normals", Mesh.common_buffers["normals"].attribute, 3, linearizeArray(new_normals));
    if (old_coords_data)
      this.createVertexBuffer("coords", Mesh.common_buffers["coords"].attribute, 2, linearizeArray(new_coords));

    this.createIndexBuffer("triangles", indices);
  }

  /**
   * Breaks the indices
   * @method explodeIndices
   */
  explodeIndices(buffer_name?: string): void {
    buffer_name = buffer_name || "triangles";

    const indices_buffer = this.getIndexBuffer(buffer_name);
    if (!indices_buffer) return;

    const indices = indices_buffer.data;

    const new_buffers: Record<string, TypedArray> = {};
    for (const i in this.vertexBuffers) {
      const info = Mesh.common_buffers[i] as CommonBufferInfo;
      new_buffers[i] = new (info.type || Float32Array)(info.spacing * indices.length);
    }

    for (let i = 0, l = indices.length; i < l; ++i) {
      const index = indices[i];
      for (const jname in this.vertexBuffers) {
        const buffer = this.vertexBuffers[jname];
        const info = Mesh.common_buffers[jname] as CommonBufferInfo;
        const spacing = buffer.spacing || info.spacing;
        const new_buffer = new_buffers[jname];
        new_buffer.set(buffer.data.subarray(index * spacing, index * spacing + spacing), i * spacing);
      }
    }

    for (const i in new_buffers) {
      const old = this.vertexBuffers[i];
      this.createVertexBuffer(i, old.attribute, old.spacing, new_buffers[i]);
    }

    delete this.indexBuffers[buffer_name];
  }

  /**
   * Creates a stream with the normals
   * @method computeNormals
   * @param {enum} stream_type default gl.STATIC_DRAW (other: gl.DYNAMIC_DRAW, gl.STREAM_DRAW)
   */
  computeNormals(stream_type?: number | null): Buffer | undefined {
    const vertices_buffer = this.vertexBuffers["vertices"];
    if (!vertices_buffer) {
      console.error("Cannot compute normals of a mesh without vertices");
      return;
    }

    const vertices = this.vertexBuffers["vertices"].data as Float32Array;

    //create because it is faster than filling it with zeros
    const normals = new Float32Array(vertices.length);

    let triangles: TypedArray | null = null;
    if (this.indexBuffers["triangles"]) triangles = this.indexBuffers["triangles"].data;

    const temp = temp_vec3;
    const temp2 = temp2_vec3;

    let i1: number, i2: number, i3: number;
    let v1: Float32Array, v2: Float32Array, v3: Float32Array;
    let n1: Float32Array, n2: Float32Array, n3: Float32Array;

    //compute the plane normal
    const l = triangles ? triangles.length : vertices.length;
    for (let a = 0; a < l; a += 3) {
      if (triangles) {
        i1 = triangles[a];
        i2 = triangles[a + 1];
        i3 = triangles[a + 2];

        v1 = vertices.subarray(i1 * 3, i1 * 3 + 3);
        v2 = vertices.subarray(i2 * 3, i2 * 3 + 3);
        v3 = vertices.subarray(i3 * 3, i3 * 3 + 3);

        n1 = normals.subarray(i1 * 3, i1 * 3 + 3);
        n2 = normals.subarray(i2 * 3, i2 * 3 + 3);
        n3 = normals.subarray(i3 * 3, i3 * 3 + 3);
      } else {
        v1 = vertices.subarray(a * 3, a * 3 + 3);
        v2 = vertices.subarray(a * 3 + 3, a * 3 + 6);
        v3 = vertices.subarray(a * 3 + 6, a * 3 + 9);

        n1 = normals.subarray(a * 3, a * 3 + 3);
        n2 = normals.subarray(a * 3 + 3, a * 3 + 6);
        n3 = normals.subarray(a * 3 + 6, a * 3 + 9);
      }

      vec3.sub(temp, v2, v1);
      vec3.sub(temp2, v3, v1);
      vec3.cross(temp, temp, temp2);
      vec3.normalize(temp, temp);

      //save
      vec3.add(n1, n1, temp);
      vec3.add(n2, n2, temp);
      vec3.add(n3, n3, temp);
    }

    //normalize if vertices are shared
    if (triangles)
      for (let a = 0, ln = normals.length; a < ln; a += 3) {
        const n = normals.subarray(a, a + 3);
        vec3.normalize(n, n);
      }

    const normals_buffer = this.vertexBuffers["normals"];

    if (normals_buffer) {
      normals_buffer.data = normals;
      normals_buffer.upload(stream_type);
    } else return this.createVertexBuffer("normals", Mesh.common_buffers["normals"].attribute, 3, normals);
    return normals_buffer;
  }

  /**
   * Creates a new stream with the tangents
   * @method computeTangents
   */
  computeTangents(): void {
    const vertices_buffer = this.vertexBuffers["vertices"];
    if (!vertices_buffer) {
      console.error("Cannot compute tangents of a mesh without vertices");
      return;
    }

    const normals_buffer = this.vertexBuffers["normals"];
    if (!normals_buffer) {
      console.error("Cannot compute tangents of a mesh without normals");
      return;
    }

    const uvs_buffer = this.vertexBuffers["coords"];
    if (!uvs_buffer) {
      console.error("Cannot compute tangents of a mesh without uvs");
      return;
    }

    const triangles_buffer = this.indexBuffers["triangles"];
    if (!triangles_buffer) {
      console.error("Cannot compute tangents of a mesh without indices");
      return;
    }

    const vertices = vertices_buffer.data as Float32Array;
    const normals = normals_buffer.data as Float32Array;
    const uvs = uvs_buffer.data as Float32Array;
    const triangles = triangles_buffer.data;

    if (!vertices || !normals || !uvs) return;

    const num_vertices = vertices.length / 3;

    const tangents = new Float32Array(num_vertices * 4);

    //temporary (shared)
    const tan1 = new Float32Array(num_vertices * 3 * 2);
    const tan2 = tan1.subarray(num_vertices * 3);

    let a: number, l: number;
    const sdir = vec3.create();
    const tdir = vec3.create();
    const temp = vec3.create();
    const temp2 = vec3.create();

    for (a = 0, l = triangles.length; a < l; a += 3) {
      const i1 = triangles[a];
      const i2 = triangles[a + 1];
      const i3 = triangles[a + 2];

      const v1 = vertices.subarray(i1 * 3, i1 * 3 + 3);
      const v2 = vertices.subarray(i2 * 3, i2 * 3 + 3);
      const v3 = vertices.subarray(i3 * 3, i3 * 3 + 3);

      const w1 = uvs.subarray(i1 * 2, i1 * 2 + 2);
      const w2 = uvs.subarray(i2 * 2, i2 * 2 + 2);
      const w3 = uvs.subarray(i3 * 2, i3 * 2 + 2);

      const x1 = v2[0] - v1[0];
      const x2 = v3[0] - v1[0];
      const y1 = v2[1] - v1[1];
      const y2 = v3[1] - v1[1];
      const z1 = v2[2] - v1[2];
      const z2 = v3[2] - v1[2];

      const s1 = w2[0] - w1[0];
      const s2 = w3[0] - w1[0];
      const t1 = w2[1] - w1[1];
      const t2 = w3[1] - w1[1];

      let r: number;
      const den = s1 * t2 - s2 * t1;
      if (Math.abs(den) < 0.000000001) r = 0.0;
      else r = 1.0 / den;

      vec3.copy(sdir, [(t2 * x1 - t1 * x2) * r, (t2 * y1 - t1 * y2) * r, (t2 * z1 - t1 * z2) * r]);
      vec3.copy(tdir, [(s1 * x2 - s2 * x1) * r, (s1 * y2 - s2 * y1) * r, (s1 * z2 - s2 * z1) * r]);

      vec3.add(tan1.subarray(i1 * 3, i1 * 3 + 3), tan1.subarray(i1 * 3, i1 * 3 + 3), sdir);
      vec3.add(tan1.subarray(i2 * 3, i2 * 3 + 3), tan1.subarray(i2 * 3, i2 * 3 + 3), sdir);
      vec3.add(tan1.subarray(i3 * 3, i3 * 3 + 3), tan1.subarray(i3 * 3, i3 * 3 + 3), sdir);

      vec3.add(tan2.subarray(i1 * 3, i1 * 3 + 3), tan2.subarray(i1 * 3, i1 * 3 + 3), tdir);
      vec3.add(tan2.subarray(i2 * 3, i2 * 3 + 3), tan2.subarray(i2 * 3, i2 * 3 + 3), tdir);
      vec3.add(tan2.subarray(i3 * 3, i3 * 3 + 3), tan2.subarray(i3 * 3, i3 * 3 + 3), tdir);
    }

    for (a = 0, l = vertices.length; a < l; a += 3) {
      const n = normals.subarray(a, a + 3);
      const t = tan1.subarray(a, a + 3);

      // Gram-Schmidt orthogonalize
      vec3.subtract(temp, t, vec3.scale(temp, n, vec3.dot(n, t)));
      vec3.normalize(temp, temp);

      // Calculate handedness
      const w = vec3.dot(vec3.cross(temp2, n, t), tan2.subarray(a, a + 3)) < 0.0 ? -1.0 : 1.0;
      tangents.set([temp[0], temp[1], temp[2], w], (a / 3) * 4);
    }

    this.createVertexBuffer("tangents", Mesh.common_buffers["tangents"].attribute, 4, tangents);
  }

  /**
   * Creates texture coordinates using a triplanar aproximation
   * @method computeTextureCoordinates
   */
  computeTextureCoordinates(stream_type?: number | null): void {
    const vertices_buffer = this.vertexBuffers["vertices"];
    if (!vertices_buffer) {
      console.error("Cannot compute uvs of a mesh without vertices");
      return;
    }

    this.explodeIndices("triangles");

    const vertices = vertices_buffer.data as Float32Array;
    const num_vertices = vertices.length / 3;

    const uvs_buffer = this.vertexBuffers["coords"];
    const uvs = new Float32Array(num_vertices * 2);

    const triangles_buffer = this.indexBuffers["triangles"];
    let triangles: TypedArray | null = null;
    if (triangles_buffer) triangles = triangles_buffer.data;

    const plane_normal = vec3.create();
    const side1 = vec3.create();
    const side2 = vec3.create();

    const bbox = this.getBoundingBox();
    const bboxcenter = BBox.getCenter(bbox);
    const bboxhs = vec3.create();
    bboxhs.set(BBox.getHalfsize(bbox)); //careful, this is a reference
    vec3.scale(bboxhs, bboxhs, 2);

    const num = triangles ? triangles.length : vertices.length / 3;

    for (let a = 0; a < num; a += 3) {
      let v1: Float32Array, v2: Float32Array, v3: Float32Array;
      let uv1: Float32Array, uv2: Float32Array, uv3: Float32Array;
      if (triangles) {
        const i1 = triangles[a];
        const i2 = triangles[a + 1];
        const i3 = triangles[a + 2];

        v1 = vertices.subarray(i1 * 3, i1 * 3 + 3);
        v2 = vertices.subarray(i2 * 3, i2 * 3 + 3);
        v3 = vertices.subarray(i3 * 3, i3 * 3 + 3);

        uv1 = uvs.subarray(i1 * 2, i1 * 2 + 2);
        uv2 = uvs.subarray(i2 * 2, i2 * 2 + 2);
        uv3 = uvs.subarray(i3 * 2, i3 * 2 + 2);
      } else {
        v1 = vertices.subarray(a * 3, a * 3 + 3);
        v2 = vertices.subarray((a + 1) * 3, (a + 1) * 3 + 3);
        v3 = vertices.subarray((a + 2) * 3, (a + 2) * 3 + 3);

        uv1 = uvs.subarray(a * 2, a * 2 + 2);
        uv2 = uvs.subarray((a + 1) * 2, (a + 1) * 2 + 2);
        uv3 = uvs.subarray((a + 2) * 2, (a + 2) * 2 + 2);
      }

      vec3.sub(side1, v1, v2);
      vec3.sub(side2, v1, v3);
      vec3.cross(plane_normal, side1, side2);
      //vec3.normalize( plane_normal, plane_normal ); //not necessary

      plane_normal[0] = Math.abs(plane_normal[0]);
      plane_normal[1] = Math.abs(plane_normal[1]);
      plane_normal[2] = Math.abs(plane_normal[2]);

      if (plane_normal[0] > plane_normal[1] && plane_normal[0] > plane_normal[2]) {
        //X
        uv1[0] = (v1[2] - bboxcenter[2]) / bboxhs[2];
        uv1[1] = (v1[1] - bboxcenter[1]) / bboxhs[1];
        uv2[0] = (v2[2] - bboxcenter[2]) / bboxhs[2];
        uv2[1] = (v2[1] - bboxcenter[1]) / bboxhs[1];
        uv3[0] = (v3[2] - bboxcenter[2]) / bboxhs[2];
        uv3[1] = (v3[1] - bboxcenter[1]) / bboxhs[1];
      } else if (plane_normal[1] > plane_normal[2]) {
        //Y
        uv1[0] = (v1[0] - bboxcenter[0]) / bboxhs[0];
        uv1[1] = (v1[2] - bboxcenter[2]) / bboxhs[2];
        uv2[0] = (v2[0] - bboxcenter[0]) / bboxhs[0];
        uv2[1] = (v2[2] - bboxcenter[2]) / bboxhs[2];
        uv3[0] = (v3[0] - bboxcenter[0]) / bboxhs[0];
        uv3[1] = (v3[2] - bboxcenter[2]) / bboxhs[2];
      } else {
        //Z
        uv1[0] = (v1[0] - bboxcenter[0]) / bboxhs[0];
        uv1[1] = (v1[1] - bboxcenter[1]) / bboxhs[1];
        uv2[0] = (v2[0] - bboxcenter[0]) / bboxhs[0];
        uv2[1] = (v2[1] - bboxcenter[1]) / bboxhs[1];
        uv3[0] = (v3[0] - bboxcenter[0]) / bboxhs[0];
        uv3[1] = (v3[1] - bboxcenter[1]) / bboxhs[1];
      }
    }

    if (uvs_buffer) {
      uvs_buffer.data = uvs;
      uvs_buffer.upload(stream_type);
    } else this.createVertexBuffer("coords", Mesh.common_buffers["coords"].attribute, 2, uvs);
  }

  /**
   * Computes the number of vertices
   * @method getVertexNumber
   */
  getNumVertices(): number {
    const b = this.vertexBuffers["vertices"];
    if (!b) return 0;
    return b.data.length / b.spacing;
  }

  /**
   * Computes the number of triangles (takes into account indices)
   * @method getNumTriangles
   */
  getNumTriangles(): number {
    const indices_buffer = this.getIndexBuffer("triangles");
    if (!indices_buffer) return this.getNumVertices() / 3;
    return indices_buffer.data.length / 3;
  }

  /**
   * Computes bounding information
   * @method Mesh.computeBoundingBox
   * @param {typed Array} vertices array containing all the vertices
   * @param {BBox} bb where to store the bounding box
   * @param {Array} mask [optional] to specify which vertices must be considered when creating the bbox, used to create BBox of a submesh
   */
  static computeBoundingBox(
    vertices: Float32Array,
    bb?: Float32Array,
    mask?: ArrayLike<number>
  ): Float32Array | undefined {
    if (!vertices) return;

    let start = 0;

    if (mask) {
      for (let i = 0; i < mask.length; ++i)
        if (mask[i]) {
          start = i;
          break;
        }
      if (start == mask.length) {
        console.warn("mask contains only zeros, no vertices marked");
        return;
      }
    }

    const min = vec3.clone(vertices.subarray(start * 3, start * 3 + 3));
    const max = vec3.clone(vertices.subarray(start * 3, start * 3 + 3));
    let v: Float32Array;

    for (let i = start * 3; i < vertices.length; i += 3) {
      if (mask && !mask[i / 3]) continue;
      v = vertices.subarray(i, i + 3);
      vec3.min(min, v, min);
      vec3.max(max, v, max);
    }

    if (
      isNaN(min[0]) ||
      isNaN(min[1]) ||
      isNaN(min[2]) ||
      isNaN(max[0]) ||
      isNaN(max[1]) ||
      isNaN(max[2])
    ) {
      min[0] = min[1] = min[2] = 0;
      max[0] = max[1] = max[2] = 0;
      console.warn("Warning: GL.Mesh has NaN values in vertices");
    }

    const center = vec3.add(vec3.create(), min, max);
    vec3.scale(center, center, 0.5);
    const half_size = vec3.subtract(vec3.create(), max, center);

    return BBox.setCenterHalfsize(bb || BBox.create(), center, half_size);
  }

  /**
   * returns the bounding box, if it is not computed, then computes it
   * @method getBoundingBox
   * @return {BBox} bounding box
   */
  getBoundingBox(): Float32Array {
    if (this._bounding) return this._bounding;

    this.updateBoundingBox();
    return this._bounding;
  }

  /**
   * Update bounding information of this mesh
   * @method updateBoundingBox
   */
  updateBoundingBox(): void {
    const vertices = this.vertexBuffers["vertices"];
    if (!vertices) return;
    Mesh.computeBoundingBox(vertices.data as Float32Array, this._bounding);
    if (this.info && this.info.groups && this.info.groups.length) this.computeGroupsBoundingBoxes();
  }

  /**
   * Update bounding information for every group submesh
   * @method computeGroupsBoundingBoxes
   */
  computeGroupsBoundingBoxes(): boolean | undefined {
    let indices: TypedArray | null = null;
    const indices_buffer = this.getIndexBuffer("triangles");
    if (indices_buffer) indices = indices_buffer.data;

    const vertices_buffer = this.getVertexBuffer("vertices");
    if (!vertices_buffer) return false;
    const vertices = vertices_buffer.data as Float32Array;
    if (!vertices.length) return false;

    const groups = this.info.groups;
    if (!groups) return;

    for (let i = 0; i < groups.length; ++i) {
      const group = groups[i];
      group.bounding = group.bounding || BBox.create();
      let submesh_vertices: Float32Array | null = null;
      if (indices) {
        const mask = new Uint8Array(vertices.length / 3);
        const s = group.start;
        for (let j = 0, l = group.length; j < l; j += 3) {
          mask[indices[s + j]] = 1;
          mask[indices[s + j + 1]] = 1;
          mask[indices[s + j + 2]] = 1;
        }
        Mesh.computeBoundingBox(vertices, group.bounding, mask);
      } else {
        submesh_vertices = vertices.subarray(group.start * 3, (group.start + group.length) * 3);
        Mesh.computeBoundingBox(submesh_vertices, group.bounding);
      }
    }
    return true;
  }

  /**
   * forces a bounding box to be set
   * @method setBoundingBox
   * @param {vec3} center center of the bounding box
   * @param {vec3} half_size vector from the center to positive corner
   */
  setBoundingBox(center: Vec3Like, half_size: Vec3Like): void {
    BBox.setCenterHalfsize(this._bounding, center, half_size);
  }

  /**
   * Remove all local memory from the streams (leaving it only in the VRAM) to save RAM
   * @method freeData
   */
  freeData(): void {
    const self = this as unknown as Record<string, unknown>;
    for (const attribute in this.vertexBuffers) {
      (this.vertexBuffers[attribute] as unknown as { data: TypedArray | null }).data = null;
      delete self[this.vertexBuffers[attribute].name as string]; //delete from the mesh itself
    }
    for (const name in this.indexBuffers) {
      (this.indexBuffers[name] as unknown as { data: TypedArray | null }).data = null;
      delete self[this.indexBuffers[name].name as string]; //delete from the mesh itself
    }
  }

  configure(o: Record<string, unknown>, options?: MeshOptions): void {
    const vertex_buffers: Record<string, unknown> = {};
    const index_buffers: Record<string, unknown> = {};
    const opts: Record<string, unknown> = (options as Record<string, unknown>) || {};

    for (const j in o) {
      if (!o[j]) continue;

      if (j == "vertexBuffers" || j == "vertex_buffers") {
        //HACK: legacy code
        const src = o[j] as Record<string, unknown>;
        for (const k in src) vertex_buffers[k] = src[k];
        continue;
      }

      if (j == "indexBuffers" || j == "index_buffers") {
        const src = o[j] as Record<string, unknown>;
        for (const k in src) index_buffers[k] = src[k];
        continue;
      }

      if (j == "indices" || j == "lines" || j == "wireframe" || j == "triangles") index_buffers[j] = o[j];
      else if (Mesh.common_buffers[j]) vertex_buffers[j] = o[j];
      else {
        //global data like bounding, info of groups, etc
        opts[j] = o[j];
      }
    }

    this.addBuffers(vertex_buffers, index_buffers, opts.stream_type as number | null);

    const self = this as unknown as Record<string, unknown>;
    for (const i in opts) self[i] = opts[i];

    if (!opts.bounding) this.updateBoundingBox();
  }

  /**
   * Returns the amount of memory used by this mesh in bytes (sum of all buffers)
   * @method getMemory
   * @return {number} bytes
   */
  totalMemory(): number {
    let num = 0 | 0;

    for (const name in this.vertexBuffers) num += this.vertexBuffers[name].data.buffer.byteLength;
    for (const name in this.indexBuffers) num += this.indexBuffers[name].data.buffer.byteLength;

    return num;
  }

  slice(start: number, length: number): Mesh | null {
    const new_vertex_buffers: Record<string, number[]> = {};

    const indices_buffer = this.indexBuffers["triangles"];
    if (!indices_buffer) {
      console.warn("splice in not indexed not supported yet");
      return null;
    }

    const indices = indices_buffer.data;

    const new_triangles: number[] = [];
    const reindex = new Int32Array(indices.length);
    reindex.fill(-1);

    let end = start + length;
    if (end >= indices.length) end = indices.length;

    let last_index = 0;
    for (let j = start; j < end; ++j) {
      const index = indices[j];
      if (reindex[index] != -1) {
        new_triangles.push(reindex[index]);
        continue;
      }

      //new vertex
      const new_index = last_index++;
      reindex[index] = new_index;
      new_triangles.push(new_index);

      for (const i in this.vertexBuffers) {
        const buffer = this.vertexBuffers[i];
        const data = buffer.data;
        const spacing = buffer.spacing;
        if (!new_vertex_buffers[i]) new_vertex_buffers[i] = [];
        const new_buffer = new_vertex_buffers[i];
        for (let k = 0; k < spacing; ++k) new_buffer.push(data[k + index * spacing]);
      }
    }

    const new_mesh = new Mesh(new_vertex_buffers, { triangles: new_triangles }, null, gl);
    new_mesh.updateBoundingBox();
    return new_mesh;
  }

  /**
   * returns a low poly version of the mesh that takes much less memory (but breaks tiling of uvs and smoothing groups)
   * @method simplify
   * @return {Mesh} simplified mesh
   */
  simplify(): void {
    //compute bounding box
    const bb = this.getBoundingBox();
    const min = BBox.getMin(bb);
    const halfsize = BBox.getHalfsize(bb);
    const range = vec3.scale(vec3.create(), halfsize, 2);

    const newmesh = new Mesh();
    const temp = vec3.create();

    for (const i in this.vertexBuffers) {
      //take every vertex and normalize it to the bounding box
      const buffer = this.vertexBuffers[i];
      const data = buffer.data as Float32Array;

      const new_data = new Float32Array(data.length);

      if (i == "vertices") {
        for (let j = 0, l = data.length; j < l; j += 3) {
          const v = data.subarray(j, j + 3);
          vec3.sub(temp, v, min);
          vec3.div(temp, temp, range);
          temp[0] = Math.round(temp[0] * 256) / 256;
          temp[1] = Math.round(temp[1] * 256) / 256;
          temp[2] = Math.round(temp[2] * 256) / 256;
          vec3.mul(temp, temp, range);
          vec3.add(temp, temp, min);
          new_data.set(temp, j);
        }
      } else {
        // noop
      }

      // NOTE: preserved from the original (unfinished) simplify(): addBuffer is called with no
      // arguments here, which is not valid for its public signature. Cast to keep the original
      // (broken) behavior without weakening addBuffer's type.
      (newmesh.addBuffer as unknown as () => void)();
    }

    //search for repeated vertices
    //compute the average normal and coord
    //reindex the triangles
    //return simplified mesh
  }

  /**
   * Static method for the class Mesh to create a mesh from a list of common streams
   * @method Mesh.load
   * @param {Object} buffers object will all the buffers
   * @param {Object} options [optional]
   * @param {Mesh} output_mesh [optional] mesh to store the mesh, otherwise is created
   * @param {WebGLContext} gl [optional] if omitted, the global.gl is used
   */
  static load(
    buffers: Record<string, unknown>,
    options?: (MeshOptions & { no_gl?: boolean }) | null,
    output_mesh?: Mesh | null,
    gl?: GLContext | null
  ): Mesh {
    options = options || {};
    if (options.no_gl) gl = null;
    const mesh = output_mesh || new Mesh(null, null, null, gl);
    mesh.configure(buffers, options);
    return mesh;
  }

  /**
   * Returns a mesh with all the meshes merged (you can apply transforms individually to every buffer)
   * @method Mesh.mergeMeshes
   * @param {Array} meshes array containing object like { mesh:, matrix:, texture_matrix: }
   * @param {Object} options { only_data: to get the mesh data without uploading it }
   * @return {GL.Mesh|Object} the mesh in GL.Mesh format or Object format (if options.only_data is true)
   */
  static mergeMeshes(
    meshes: Array<{ mesh: Mesh; [key: string]: unknown }>,
    options?: Record<string, unknown>
  ): Mesh | Record<string, unknown> {
    options = options || {};

    const vertex_buffers: Record<string, number | TypedArray> = {};
    const index_buffers: Record<string, number | TypedArray> = {};
    const offsets: Record<string, number> = {}; //tells how many positions indices must be offseted
    const vertex_offsets: number[] = [];
    let current_vertex_offset = 0;
    let num_vertices = 0;
    const groups: MeshGroup[] = [];
    const bones: unknown[] = [];
    const bones_by_index: Record<string, number> = {};
    let num_morphs = 0;
    let morphs: MeshMorph[] | null = null;

    let mesh: Mesh = meshes[0].mesh;

    //vertex buffers
    //compute size
    for (let i = 0; i < meshes.length; ++i) {
      const mesh_info = meshes[i];
      mesh = mesh_info.mesh;
      const offset = current_vertex_offset;
      vertex_offsets.push(offset);
      const length = mesh.vertexBuffers["vertices"].data.length / 3;
      current_vertex_offset += length;

      for (const j in mesh.vertexBuffers) {
        if (!vertex_buffers[j]) vertex_buffers[j] = mesh.vertexBuffers[j].data.length;
        else (vertex_buffers[j] as number) += mesh.vertexBuffers[j].data.length;
      }

      for (const j in mesh.indexBuffers) {
        if (!index_buffers[j]) index_buffers[j] = mesh.indexBuffers[j].data.length;
        else (index_buffers[j] as number) += mesh.indexBuffers[j].data.length;
      }

      //groups
      const group: MeshGroup = {
        name: "mesh_" + i,
        start: offset,
        length: length,
        material: "",
      };

      //add bones
      const mesh_bones = mesh.bones as Array<[string, ...unknown[]]> | undefined;
      if (mesh_bones) {
        const prev_bones_by_index: Record<number, number> = {};
        for (let j = 0; j < mesh_bones.length; ++j) {
          const b = mesh_bones[j];
          if (!bones_by_index[b[0]]) {
            bones_by_index[b[0]] = bones.length;
            bones.push(b);
          }
          prev_bones_by_index[j] = bones_by_index[b[0]];
        }

        //remap bones
        const bones_buffer = mesh.vertexBuffers["bone_indices"].data;
        for (let j = 0; j < bones_buffer.length; j += 1) {
          bones_buffer[j] = prev_bones_by_index[bones_buffer[j]];
        }
      } else if (bones.length) throw "cannot merge meshes, one contains bones, the other doesnt";

      groups.push(group);

      if (mesh.morphs) {
        const num = Object.values(mesh.morphs).length;
        if (num_morphs == 0) num_morphs = num;
        else if (num_morphs !== num) throw "cannot merge meshes with and without morph targets";
      }
    }

    //allocate
    for (const j in vertex_buffers) {
      let datatype = options[j] as TypedArrayConstructor | null | undefined;
      if (datatype === null) {
        delete vertex_buffers[j];
        continue;
      }

      if (!datatype) {
        let one_buffer: Buffer | TypedArray | undefined = mesh.vertexBuffers[j];
        if (one_buffer) {
          if ((one_buffer as Buffer).data) one_buffer = (one_buffer as Buffer).data;
          if ((one_buffer as TypedArray).constructor !== Array) datatype = (one_buffer as TypedArray).constructor as TypedArrayConstructor;
        }
        if (!datatype) datatype = Float32Array;
      }

      vertex_buffers[j] = new (datatype as TypedArrayCtorCallable)(vertex_buffers[j] as number);
      offsets[j] = 0;
      if (j === "vertices") num_vertices = (vertex_buffers[j] as TypedArray).length / 3;
    }

    //allocate for morph targets too
    if (num_morphs) {
      morphs = [];
      for (let i = 0; i < num_morphs; ++i) {
        const base_mesh = meshes[0].mesh;
        const base_morphs = base_mesh.morphs as MeshMorph[];
        const morph_data: MeshMorph = {
          name: base_morphs[i].name,
          weight: base_morphs[i].weight,
          buffers: {
            vertices: new Float32Array(num_vertices * 3),
            normals: new Float32Array(num_vertices * 3),
          },
        };
        morphs.push(morph_data);
      }
    }

    //and for indices
    for (const j in index_buffers) {
      const datatype: TypedArrayConstructor = current_vertex_offset < 256 * 256 ? Uint16Array : Uint32Array;
      index_buffers[j] = new (datatype as TypedArrayCtorCallable)(index_buffers[j] as number);
      offsets[j] = 0;
    }

    //useful functions
    function apply_transform(array: TypedArray, start: number, length: number, matrix: NumberArray): void {
      const l = start + length;
      for (let i = start; i < l; i += 3) {
        const v = array.subarray(i, i + 3) as Float32Array;
        vec3.transformMat4(v, v, matrix);
      }
    }

    function apply_transform2D(array: TypedArray, start: number, length: number, matrix: NumberArray): void {
      const l = start + length;
      for (let i = start; i < l; i += 2) {
        const v = array.subarray(i, i + 2) as Float32Array;
        vec2.transformMat3(v, v, matrix);
      }
    }

    function apply_offset(array: TypedArray, start: number, length: number, offset: number): void {
      if (!offset) return;
      const l = start + length;
      for (let i = start; i < l; ++i) array[i] += offset;
    }

    //store
    for (let i = 0; i < meshes.length; ++i) {
      const mesh_info = meshes[i];
      mesh = mesh_info.mesh;
      const offset = offsets["vertices"];

      for (const j in mesh.vertexBuffers) {
        if (!vertex_buffers[j]) continue;

        (vertex_buffers[j] as TypedArray).set(mesh.vertexBuffers[j].data, offsets[j]);

        //apply transform
        if (mesh_info[j + "_matrix"]) {
          const matrix = mesh_info[j + "_matrix"] as Float32Array;
          if (matrix.length == 16)
            apply_transform(vertex_buffers[j] as TypedArray, offsets[j], mesh.vertexBuffers[j].data.length, matrix);
          else if (matrix.length == 9)
            apply_transform2D(vertex_buffers[j] as TypedArray, offsets[j], mesh.vertexBuffers[j].data.length, matrix);
        }

        offsets[j] += mesh.vertexBuffers[j].data.length;
      }

      for (const j in mesh.indexBuffers) {
        (index_buffers[j] as TypedArray).set(mesh.indexBuffers[j].data, offsets[j]);
        apply_offset(index_buffers[j] as TypedArray, offsets[j], mesh.indexBuffers[j].data.length, vertex_offsets[i]);
        offsets[j] += mesh.indexBuffers[j].data.length;
      }

      if (num_morphs) {
        const mesh_morphs = mesh.morphs as MeshMorph[];
        for (let j = 0; j < mesh_morphs.length; ++j) {
          const morph = mesh_morphs[j];
          for (const k in morph.buffers) {
            const morph_data = morph.buffers[k];
            morphs![j].buffers[k].set(morph_data, offset);
          }
        }
      }
    }

    const extra: { info: { groups: MeshGroup[] }; bones?: unknown[] } = { info: { groups: groups } };
    if (bones.length) extra.bones = bones;

    //return
    if (!options.only_data) {
      const merged = new Mesh(
        vertex_buffers as unknown as Record<string, unknown>,
        index_buffers as unknown as Record<string, unknown>,
        extra as unknown as MeshOptions
      );
      merged.updateBoundingBox();
      if (morphs) merged.morphs = morphs;
      return merged;
    }
    return {
      vertexBuffers: vertex_buffers,
      indexBuffers: index_buffers,
      info: { groups: groups },
      morphs: morphs,
    };
  }

  /**
   * Returns am empty mesh and loads a mesh and parses it using the Mesh.parsers, by default only OBJ is supported
   * @method Mesh.fromOBJ
   * @param {Array} meshes array containing all the meshes
   */
  static fromURL(
    url: string,
    on_complete?: (mesh: Mesh | null, url?: string, options?: Record<string, unknown>) => void,
    gl?: GLContext | null,
    options?: HttpRequestOptions
  ): Mesh | null {
    options = options || {};
    gl = gl || globalThis.gl;

    const pos = url.lastIndexOf(".");
    let extension = url.substr(pos + 1).toLowerCase();
    if (options.extension) extension = options.extension as string;

    const parser = Mesh.parsers[extension.toLowerCase()];
    if (!parser) {
      console.error("No parser available in litegl to parse mesh of type", extension);
      return null;
    }

    const mesh = new Mesh(undefined, undefined, undefined, gl);
    mesh.ready = false;

    options.binary = Mesh.binary_file_formats[extension];

    HttpRequest(
      url,
      null,
      function (data: unknown): void {
        mesh.parse(data as string | ArrayBuffer, extension, options as Record<string, unknown>);
        delete mesh.ready;
        if (on_complete) on_complete.call(mesh, mesh, url, options as Record<string, unknown>);
      },
      function (): void {
        if (on_complete) on_complete(null);
      },
      options
    );
    return mesh;
  }

  /**
   * given some data an information about the format, it search for a parser in Mesh.parsers and tries to extract the mesh information
   * Only obj supported now
   * @method parse
   * @param {*} data could be string or ArrayBuffer
   * @param {String} format parser file format name (p.e. "obj")
   * @return {?} depending on the parser
   */
  parse(data: string | ArrayBuffer, format: string, options?: Record<string, unknown>): unknown {
    options = options || {};
    options.mesh = this;
    format = format.toLowerCase();
    const parser = Mesh.parsers[format];
    if (parser) return parser.call(null, data, options);
    throw "GL.Mesh.parse: no parser found for format " + format;
  }

  /**
   * It returns the mesh data encoded in the format specified
   * Only obj supported now
   * @method encode
   * @param {String} format to encode the data to (p.e. "obj")
   * @return {?} String with the info
   */
  encode(format: string, options?: Record<string, unknown>): unknown {
    format = format.toLowerCase();
    const encoder = Mesh.encoders[format];
    if (encoder) return encoder.call(null, this, options);
    throw "GL.Mesh.encode: no encoder found for format " + format;
  }

  /**
   * Returns a shared mesh containing a quad to be used when rendering to the screen
   * Reusing the same quad helps not filling the memory
   * @method getScreenQuad
   * @return {GL.Mesh} the screen quad
   */
  static getScreenQuad(gl?: GLContext | null): Mesh {
    gl = gl || globalThis.gl;
    let mesh = gl.meshes[":screen_quad"];
    if (mesh) return mesh;

    const vertices = new Float32Array([0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0]);
    const coords = new Float32Array([0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1]);
    mesh = new Mesh({ vertices: vertices, coords: coords }, undefined, undefined, gl);
    return (gl.meshes[":screen_quad"] = mesh);
  }
}

export function linearizeArray(
  array: TypedArray | number[] | ArrayLike<number>[],
  typed_array_class?: TypedArrayConstructor
): TypedArray {
  const generic = array as { constructor: unknown; length: number };
  if (generic.constructor === typed_array_class) return array as TypedArray;
  if (generic.constructor !== Array) {
    const ctor = (typed_array_class || Float32Array) as TypedArrayCtorCallable;
    return new ctor(array as ArrayLike<number>);
  }

  const ctor = (typed_array_class || Float32Array) as TypedArrayCtorCallable;
  const outer = array as ArrayLike<number>[];
  const components = outer[0].length;
  const size = outer.length * components;
  const buffer = new ctor(size);

  for (let i = 0; i < outer.length; ++i)
    for (let j = 0; j < components; ++j) buffer[i * components + j] = outer[i][j];
  return buffer;
}

/**
 * This is used when a mesh is dynamic and constantly changes
 * @class DynamicMesh
 */
export class DynamicMesh extends Mesh {
  static DEFAULT_NORMAL: Float32Array = vec3.fromValues(0, 1, 0);
  static DEFAULT_COORD: Float32Array = vec2.fromValues(0.5, 0.5);
  static DEFAULT_COLOR: Float32Array = vec4.fromValues(1, 1, 1, 1);

  _use_normals: boolean;
  _use_coords: boolean;
  _use_colors: boolean;
  _vertex_data!: Float32Array;
  _normal_data?: Float32Array;
  _coord_data?: Float32Array;
  _color_data?: Float32Array;
  current_pos: number;
  max_size: number;
  _must_update: boolean;

  constructor(size?: number, normals?: boolean, coords?: boolean, colors?: boolean, gl?: GLContext | null) {
    super(undefined, undefined, undefined, gl);

    size = size || 1024;

    if (isDebug()) console.log("GL.Mesh created");

    this._use_normals = !!normals;
    this._use_coords = !!coords;
    this._use_colors = !!colors;
    this.current_pos = 0;
    this.max_size = size;
    this._must_update = true;

    this.resize(size);
  }

  resize(size: number): void {
    const buffers: Record<string, Float32Array> = {};

    this._vertex_data = new Float32Array(size * 3);
    buffers.vertices = this._vertex_data;

    if (this._use_normals) buffers.normals = this._normal_data = new Float32Array(size * 3);
    if (this._use_coords) buffers.coords = this._coord_data = new Float32Array(size * 2);
    if (this._use_colors) buffers.colors = this._color_data = new Float32Array(size * 4);

    this.addBuffers(buffers);

    this.current_pos = 0;
    this.max_size = size;
    this._must_update = true;
  }

  clear(): void {
    this.current_pos = 0;
  }

  addPoint(vertex: ArrayLike<number>, normal?: ArrayLike<number>, coord?: ArrayLike<number>, color?: ArrayLike<number>): boolean {
    if (this.current_pos >= this.max_size) {
      console.warn("DynamicMesh: not enough space, reserve more");
      return false;
    }
    const pos = this.current_pos++;

    this._vertex_data.set(vertex, pos * 3);

    if (this._normal_data) this._normal_data.set(normal || DynamicMesh.DEFAULT_NORMAL, pos * 3);
    if (this._coord_data) this._coord_data.set(coord || DynamicMesh.DEFAULT_COORD, pos * 2);
    if (this._color_data) this._color_data.set(color || DynamicMesh.DEFAULT_COLOR, pos * 4);

    this._must_update = true;
    return true;
  }

  update(force?: boolean): number {
    if (!this._must_update && !force) return this.current_pos;
    this._must_update = false;

    this.getBuffer("vertices").upload(gl.STREAM_DRAW);
    if (this._normal_data) this.getBuffer("normal").upload(gl.STREAM_DRAW);
    if (this._coord_data) this.getBuffer("coord").upload(gl.STREAM_DRAW);
    if (this._color_data) this.getBuffer("color").upload(gl.STREAM_DRAW);
    return this.current_pos;
  }
}
