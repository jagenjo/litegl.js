// Shader class to upload GLSL programs to the GPU.
//
// Ported from the original shader.js. Public API is preserved exactly; the only structural change is
// that this is now a pure ESM `class` (index.ts re-attaches it to the GL namespace / globals).

import { Buffer, Mesh } from "./mesh";
import type { GLContext } from "./types";
import {
  VERTEX_SHADER,
  FRAGMENT_SHADER,
  FLOAT,
  FLOAT_MAT2,
  FLOAT_MAT3,
  FLOAT_MAT4,
  FLOAT_VEC2,
  FLOAT_VEC3,
  FLOAT_VEC4,
  INT,
  UNSIGNED_INT,
  INT_VEC2,
  INT_VEC3,
  INT_VEC4,
  SAMPLER_2D,
  SAMPLER_3D,
  SAMPLER_CUBE,
  INT_SAMPLER_2D,
  INT_SAMPLER_3D,
  INT_SAMPLER_CUBE,
  UNSIGNED_INT_SAMPLER_2D,
  UNSIGNED_INT_SAMPLER_3D,
  UNSIGNED_INT_SAMPLER_CUBE,
  TYPE_LENGTH,
  TRIANGLES,
  LINES,
  STREAM_DRAW,
  ARRAY_BUFFER,
  ELEMENT_ARRAY_BUFFER,
} from "./constants";

import { HttpRequest, isNumber } from "./utils";

/**
 * A uniform-setter function as returned by Shader.getUniformFunc: one of the many `gl.uniformNxx` /
 * `gl.uniformMatrixNfv` methods. They all differ in signature, so they are modeled as a single call
 * shape that is later invoked with `.call(this.gl, loc, [transpose,] value)`. Matrix setters receive
 * an extra leading `false` (transpose) argument.
 */
export type UniformSetter = (
  this: GLContext,
  location: WebGLUniformLocation | null,
  ...args: unknown[]
) => void;

/** Any value that can be uploaded to a uniform. */
export type UniformValue = number | boolean | Float32Array | Int32Array | number[] | readonly number[];

/** Per-uniform (and per-attribute) metadata extracted from a linked program. */
export interface UniformInfo {
  type: number;
  func: UniformSetter;
  size: number;
  type_length: number;
  is_matrix?: boolean;
  loc: WebGLUniformLocation | null;
  /** Preallocated scratch buffer for uploading plain-array values (absent on attributes). */
  data?: Float32Array;
}

/** Result of Shader.parseError. */
export interface ShaderParsedError {
  type: string;
  line_number: number;
  line_pos: number;
  line_code: string;
  err: string;
}

/** Scratch buffers cached per instanced-attribute slot (see drawInstanced). */
interface InstancingArray {
  data: Float32Array;
  buffer: WebGLBuffer;
  uniform?: string;
  element_size?: number;
}

/** A WebGLBuffer augmented by GL.Buffer.upload() with element-layout info. */
interface DataWebGLBuffer extends WebGLBuffer {
  length: number;
  spacing: number;
  gl_type: number;
}

// this two variables are a hack to avoid memory allocation on drawCalls
const temp_attribs_array = new Uint8Array(16);
const temp_attribs_array_zero = new Uint8Array(16); // should be filled with zeros always

/**
 * Shader class to upload programs to the GPU
 * @class Shader
 * @constructor
 * @param {String} vertexSource (it also allows to pass a compiled vertex shader)
 * @param {String} fragmentSource (it also allows to pass a compiled fragment shader)
 * @param {Object} macros (optional) precompiler macros to be applied when compiling
 */
export class Shader {
  // --- instance fields ---
  gl!: GLContext;
  program!: WebGLProgram;
  vs_shader!: WebGLShader;
  fs_shader!: WebGLShader;
  _context_id!: number;
  attributes: Record<string, number> = {};
  uniformInfo: Record<string, UniformInfo> = {};
  samplers: Record<string, number> = {};
  ready?: boolean;
  _first_use?: boolean;
  setup?: (this: Shader) => void;

  // --- static props ---
  static use_async = true; // https://toji.github.io/shader-perf/
  static _temp_uniform = new Float32Array(16);
  static _instancing_arrays: InstancingArray[] = [];
  /** object with files to #import from, assigned externally */
  static files: Record<string, string> | null = null;

  constructor(
    vertexSource: string | WebGLShader,
    fragmentSource: string | WebGLShader,
    macros?: Record<string, string | number | boolean> | null
  ) {
    if ((globalThis as unknown as { GL?: { debug?: boolean } }).GL?.debug)
      console.log("GL.Shader created");

    if (!vertexSource || !fragmentSource) throw "GL.Shader source code parameter missing";

    // used to avoid problems with resources moving between different webgl context
    this._context_id = globalThis.gl.context_id;
    const gl: GLContext = (this.gl = globalThis.gl);

    // expand macros
    const extra_code = Shader.expandMacros(macros);

    const final_vertexSource =
      typeof vertexSource === "string" ? Shader.injectCode(extra_code, vertexSource, gl) : vertexSource;
    const final_fragmentSource =
      typeof fragmentSource === "string" ? Shader.injectCode(extra_code, fragmentSource, gl) : fragmentSource;

    this.program = gl.createProgram()!;

    const vs: WebGLShader =
      typeof vertexSource === "string"
        ? Shader.compileSource(VERTEX_SHADER, final_vertexSource as string)
        : vertexSource;
    const fs: WebGLShader =
      typeof fragmentSource === "string"
        ? Shader.compileSource(FRAGMENT_SHADER, final_fragmentSource as string)
        : fragmentSource;

    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);

    // store shaders separated
    this.vs_shader = vs;
    this.fs_shader = fs;

    // Extract info from the shader
    this.attributes = {};
    this.uniformInfo = {};
    this.samplers = {};

    if (!Shader.use_async) this.checkLink();
    else this._first_use = true;
  }

  static expandMacros(macros?: Record<string, string | number | boolean> | null): string {
    let extra_code = ""; // add here preprocessor directives that should be above everything
    if (macros) for (const i in macros) extra_code += "#define " + i + " " + (macros[i] ? macros[i] : "") + "\n";
    return extra_code;
  }

  // this is done to avoid problems with the #version which must be in the first line
  static injectCode(inject_code: string, code: string, gl?: GLContext): string {
    const index = code.indexOf("\n");
    const version = gl ? "#define WEBGL" + gl.webgl_version + "\n" : "";
    const first_line = code.substr(0, index).trim();
    if (first_line.indexOf("#version") == -1) return version + inject_code + code;
    return first_line + "\n" + version + inject_code + code.substr(index);
  }

  /**
   * Compiles one single shader source (could be gl.VERTEX_SHADER or gl.FRAGMENT_SHADER) and returns the webgl shader handler
   * Used internaly to compile the vertex and fragment shader.
   * It throws an exception if there is any error in the code
   * @method Shader.compileSource
   * @param {Number} type could be gl.VERTEX_SHADER or gl.FRAGMENT_SHADER
   * @param {String} source the source file to compile
   * @return {WebGLShader} the handler from webgl
   */
  static compileSource(type: number, source: string, gl?: GLContext, shader?: WebGLShader | null): WebGLShader {
    const g: GLContext = gl || globalThis.gl;
    const sh: WebGLShader = shader || g.createShader(type)!;
    g.shaderSource(sh, source);
    g.compileShader(sh);
    return sh;
  }

  static parseError(
    error_str: string | null | undefined,
    vs_code: string,
    fs_code: string
  ): ShaderParsedError | null {
    if (!error_str) return null;

    const t = error_str.split(" ");
    const nums = t[5].split(":");

    return {
      type: t[0],
      line_number: parseInt(nums[1]),
      line_pos: parseInt(nums[0]),
      line_code: (t[0] == "Fragment" ? fs_code : vs_code).split("\n")[parseInt(nums[1])],
      err: error_str,
    };
  }

  /**
   * clears all memory allocated by this shader
   * @method delete
   */
  delete(): void {
    if (this.program) this.gl.deleteProgram(this.program);
    if (this.vs_shader) this.gl.deleteShader(this.vs_shader);
    if (this.fs_shader) this.gl.deleteShader(this.fs_shader);
    this.gl = null as unknown as GLContext;
    this.attributes = {};
    this.uniformInfo = {};
    this.samplers = {};
  }

  /**
   * It updates the code inside one shader
   * @method updateShader
   * @param {String} vertexSource
   * @param {String} fragmentSource
   * @param {Object} macros [optional]
   */
  updateShader(
    vertexSource: string | WebGLShader,
    fragmentSource: string | WebGLShader,
    macros?: Record<string, string | number | boolean> | null
  ): void {
    const gl: GLContext = this.gl || globalThis.gl;

    if (!this.program) this.program = gl.createProgram()!;
    else {
      gl.detachShader(this.program, this.vs_shader);
      gl.detachShader(this.program, this.fs_shader);
    }

    // expand macros
    const extra_code = Shader.expandMacros(macros);

    const final_vertexSource =
      typeof vertexSource === "string" ? Shader.injectCode(extra_code, vertexSource, gl) : vertexSource;
    const final_fragmentSource =
      typeof fragmentSource === "string" ? Shader.injectCode(extra_code, fragmentSource, gl) : fragmentSource;

    const vs: WebGLShader =
      typeof vertexSource === "string"
        ? Shader.compileSource(VERTEX_SHADER, final_vertexSource as string)
        : vertexSource;
    const fs: WebGLShader =
      typeof fragmentSource === "string"
        ? Shader.compileSource(FRAGMENT_SHADER, final_fragmentSource as string)
        : fragmentSource;

    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);

    // store shaders separated
    this.vs_shader = vs;
    this.fs_shader = fs;

    // Extract info from the shader
    this.attributes = {};
    this.uniformInfo = {};
    this.samplers = {};

    if (!Shader.use_async) this.checkLink();
    else this._first_use = true;
  }

  /**
   * It extract all the info about the compiled shader program, all the info about uniforms and attributes.
   * This info is stored so it works faster during rendering.
   * @method extractShaderInfo
   */
  extractShaderInfo(): void {
    const gl = this.gl;

    const l = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS) as number;

    // extract uniforms info
    for (let i = 0; i < l; ++i) {
      const data = gl.getActiveUniform(this.program, i);
      if (!data) break;

      let uniformName = data.name;

      // arrays have uniformName[0], strip the [] (also data.size tells you if it is an array)
      const pos = uniformName.indexOf("[");
      if (pos != -1) {
        const pos2 = uniformName.indexOf("]."); // leave array of structs though
        if (pos2 == -1) uniformName = uniformName.substr(0, pos);
      }

      // store texture samplers
      if (
        data.type == SAMPLER_2D ||
        data.type == SAMPLER_CUBE ||
        data.type == SAMPLER_3D ||
        data.type == INT_SAMPLER_2D ||
        data.type == INT_SAMPLER_CUBE ||
        data.type == INT_SAMPLER_3D ||
        data.type == UNSIGNED_INT_SAMPLER_2D ||
        data.type == UNSIGNED_INT_SAMPLER_CUBE ||
        data.type == UNSIGNED_INT_SAMPLER_3D
      )
        this.samplers[uniformName] = data.type;

      // get which function to call when uploading this uniform
      const func = Shader.getUniformFunc(data);
      let is_matrix = false;
      if (data.type == FLOAT_MAT2 || data.type == FLOAT_MAT3 || data.type == FLOAT_MAT4) is_matrix = true;
      const type_length = TYPE_LENGTH[data.type] || 1;

      // save the info so the user doesnt have to specify types when uploading data to the shader
      this.uniformInfo[uniformName] = {
        type: data.type,
        func: func,
        size: data.size,
        type_length: type_length,
        is_matrix: is_matrix,
        loc: gl.getUniformLocation(this.program, uniformName),
        data: new Float32Array(type_length * data.size), // prealloc space to assign uniforms that are not typed
      };
    }

    // extract attributes info
    for (let i = 0, l2 = gl.getProgramParameter(this.program, gl.ACTIVE_ATTRIBUTES) as number; i < l2; ++i) {
      const data = gl.getActiveAttrib(this.program, i);
      if (!data) break;
      const func = Shader.getUniformFunc(data);
      const type_length = TYPE_LENGTH[data.type] || 1;
      this.uniformInfo[data.name] = {
        type: data.type,
        func: func,
        type_length: type_length,
        size: data.size,
        loc: null,
      };
      // gl.getAttribLocation( this.program, data.name )
      if (data.name !== "gl_VertexID")
        // if gl_VertexID is used, it appears as a attribute!
        this.attributes[data.name] = gl.getAttribLocation(this.program, data.name);
    }
  }

  /**
   * Returns if this shader has a uniform with the given name
   * @method hasUniform
   * @param {String} name name of the uniform
   * @return {Boolean}
   */
  hasUniform(name: string): UniformInfo | undefined {
    return this.uniformInfo[name];
  }

  /**
   * Returns if this shader has an attribute with the given name
   * @method hasAttribute
   * @param {String} name name of the attribute
   * @return {Boolean}
   */
  hasAttribute(name: string): number | undefined {
    return this.attributes[name];
  }

  /**
   * Tells you which function to call when uploading a uniform according to the data type in the shader
   * Used internally from extractShaderInfo to optimize calls
   * @method Shader.getUniformFunc
   * @param {Object} data info about the uniform
   * @return {Function}
   */
  static getUniformFunc(data: { type: number; size: number }): UniformSetter {
    let func: UniformSetter;
    switch (data.type) {
      case FLOAT:
        if (data.size == 1) func = gl.uniform1f as unknown as UniformSetter;
        else func = gl.uniform1fv as unknown as UniformSetter;
        break;
      case FLOAT_MAT2:
        func = gl.uniformMatrix2fv as unknown as UniformSetter;
        break;
      case FLOAT_MAT3:
        func = gl.uniformMatrix3fv as unknown as UniformSetter;
        break;
      case FLOAT_MAT4:
        func = gl.uniformMatrix4fv as unknown as UniformSetter;
        break;
      case FLOAT_VEC2:
        func = gl.uniform2fv as unknown as UniformSetter;
        break;
      case FLOAT_VEC3:
        func = gl.uniform3fv as unknown as UniformSetter;
        break;
      case FLOAT_VEC4:
        func = gl.uniform4fv as unknown as UniformSetter;
        break;

      case UNSIGNED_INT:
      case INT:
        if (data.size == 1) func = gl.uniform1i as unknown as UniformSetter;
        else func = gl.uniform1iv as unknown as UniformSetter;
        break;
      case INT_VEC2:
        func = gl.uniform2iv as unknown as UniformSetter;
        break;
      case INT_VEC3:
        func = gl.uniform3iv as unknown as UniformSetter;
        break;
      case INT_VEC4:
        func = gl.uniform4iv as unknown as UniformSetter;
        break;

      case SAMPLER_2D:
      case SAMPLER_3D:
      case SAMPLER_CUBE:
      case INT_SAMPLER_2D:
      case INT_SAMPLER_3D:
      case INT_SAMPLER_CUBE:
      case UNSIGNED_INT_SAMPLER_2D:
      case UNSIGNED_INT_SAMPLER_3D:
      case UNSIGNED_INT_SAMPLER_CUBE:
        func = gl.uniform1i as unknown as UniformSetter;
        break;
      default:
        func = gl.uniform1f as unknown as UniformSetter;
        break;
    }
    return func;
  }

  /**
   * Create a shader from two urls. While the system is fetching the two urls, the shader contains a dummy shader that renders black.
   * @method Shader.fromURL
   * @param {String} vs_path the url to the vertex shader
   * @param {String} fs_path the url to the fragment shader
   * @param {Function} on_complete [Optional] a callback to call once the shader is ready.
   * @return {Shader}
   */
  static fromURL(vs_path: string, fs_path: string, _on_complete?: (shader: Shader) => void): Shader {
    // create simple shader first
    const vs_code = "\n\
			precision highp float;\n\
			attribute vec3 a_vertex;\n\
			attribute mat4 u_mvp;\n\
			void main() { \n\
				gl_Position = u_mvp * vec4(a_vertex,1.0); \n\
			}\n\
		";
    const fs_code = "\n\
			precision highp float;\n\
			void main() {\n\
				gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);\n\
			}\n\
			";

    const shader = new Shader(vs_code, fs_code);
    shader.ready = false;

    let true_vs: string | null = null;
    let true_fs: string | null = null;

    HttpRequest(vs_path, null, function (code: string): void {
      true_vs = code;
      if (true_fs) compileShader();
    });

    HttpRequest(fs_path, null, function (code: string): void {
      true_fs = code;
      if (true_vs) compileShader();
    });

    function compileShader(): void {
      const true_shader = new Shader(true_vs as string, true_fs as string);
      for (const i in true_shader) (shader as unknown as Record<string, unknown>)[i] = (true_shader as unknown as Record<string, unknown>)[i];
      shader.ready = true;
    }

    return shader;
  }

  // check if shader works
  checkLink(): void {
    this._first_use = false;

    if (!gl.getShaderParameter(this.vs_shader, gl.COMPILE_STATUS)) {
      throw "Vertex shader compile error: " + gl.getShaderInfoLog(this.vs_shader);
    }
    if (!gl.getShaderParameter(this.fs_shader, gl.COMPILE_STATUS)) {
      throw "Fragment shader compile error: " + gl.getShaderInfoLog(this.fs_shader);
    }
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw "link error: " + gl.getProgramInfoLog(this.program);
    }
    this.extractShaderInfo();
  }

  /**
   * enables the shader (calls useProgram)
   * @method bind
   */
  bind(): void {
    const gl = this.gl;

    if (Shader.use_async && this._first_use) {
      this.checkLink();
      this._first_use = false;
    }

    gl.useProgram(this.program);
    gl._current_shader = this;
  }

  /**
   * Returns the location of a uniform or attribute
   * @method getLocation
   * @param {String} name
   * @return {WebGLUniformLocation} location
   */
  getLocation(name: string): WebGLUniformLocation | null {
    const info = this.uniformInfo[name];
    if (info) return this.uniformInfo[name].loc;
    return null;
  }

  /**
   * Uploads a set of uniforms to the Shader. You dont need to specify types, they are infered from the shader info.
   * @method uniforms
   * @param {Object} uniforms
   */
  uniforms(uniforms: Record<string, UniformValue>): Shader {
    const gl = this.gl;
    if (this._first_use) this.checkLink();
    gl.useProgram(this.program);
    gl._current_shader = this;

    for (const name in uniforms) {
      const info = this.uniformInfo[name];
      if (!info) continue;
      this._setUniform(name, uniforms[name]);
      // this.setUniform( name, uniforms[name] );
      // this._assing_uniform(uniforms, name, gl );
    }

    return this;
  } // uniforms

  uniformsArray(array: Record<string, UniformValue>[]): Shader {
    const gl = this.gl;
    if (this._first_use) this.checkLink();
    gl.useProgram(this.program);
    gl._current_shader = this;

    for (let i = 0, l = array.length; i < l; ++i) {
      const uniforms = array[i];
      for (const name in uniforms) this._setUniform(name, uniforms[name]);
      // this._assing_uniform(uniforms, name, gl );
    }

    return this;
  }

  /**
   * Uploads a uniform to the Shader. You dont need to specify types, they are infered from the shader info. Shader must be binded!
   * @method setUniform
   * @param {string} name
   * @param {*} value
   */
  setUniform(name: string, value: UniformValue | null | undefined): void {
    if (this.gl._current_shader != this) this.bind();

    const info = this.uniformInfo[name];
    if (!info) return;

    if (info.loc === null) return;

    if (value == null) return; // strict?

    if ((value as object).constructor === Array) {
      info.data!.set(value as number[]);
      value = info.data!;
    }

    if (info.is_matrix) info.func.call(this.gl, info.loc, false, value);
    else info.func.call(this.gl, info.loc, value);
  }

  // skips enabling shader
  _setUniform(name: string, value: UniformValue | null | undefined): void {
    if (this._first_use) this.checkLink();

    const info = this.uniformInfo[name];
    if (!info) return;

    if (info.loc === null) return;

    // if(info.loc.constructor !== Function)
    // 	return;

    if (value == null) return;

    if ((value as object).constructor === Array) {
      info.data!.set(value as number[]);
      value = info.data!;
    }

    if (info.is_matrix) info.func.call(this.gl, info.loc, false, value);
    else info.func.call(this.gl, info.loc, value);
  }

  /**
   * Renders a mesh using this shader, remember to use the function uniforms before to enable the shader
   * @method draw
   * @param {Mesh} mesh
   * @param {number} mode could be gl.LINES, gl.POINTS, gl.TRIANGLES, gl.TRIANGLE_STRIP, gl.TRIANGLE_FAN
   * @param {String} index_buffer_name the name of the index buffer, if not provided triangles will be assumed
   */
  draw(mesh: Mesh, mode?: number, index_buffer_name?: string): Shader {
    const ibn = index_buffer_name === undefined ? (mode == LINES ? "lines" : "triangles") : index_buffer_name;
    return this.drawBuffers(
      mesh.vertexBuffers,
      ibn ? mesh.indexBuffers[ibn] : null,
      mode === undefined ? TRIANGLES : mode
    );
  }

  /**
   * Renders a range of a mesh using this shader
   * @method drawRange
   * @param {Mesh} mesh
   * @param {number} mode could be gl.LINES, gl.POINTS, gl.TRIANGLES, gl.TRIANGLE_STRIP, gl.TRIANGLE_FAN
   * @param {number} start first primitive to render
   * @param {number} length number of primitives to render
   * @param {String} index_buffer_name the name of the index buffer, if not provided triangles will be assumed
   */
  drawRange(mesh: Mesh, mode: number, start: number, length: number, index_buffer_name?: string): Shader {
    const ibn = index_buffer_name === undefined ? (mode == LINES ? "lines" : "triangles") : index_buffer_name;

    return this.drawBuffers(mesh.vertexBuffers, ibn ? mesh.indexBuffers[ibn] : null, mode, start, length);
  }

  /**
   * render several buffers with a given index buffer
   * @method drawBuffers
   * @param {Object} vertexBuffers an object containing all the buffers
   * @param {IndexBuffer} indexBuffer
   * @param {number} mode could be gl.LINES, gl.POINTS, gl.TRIANGLES, gl.TRIANGLE_STRIP, gl.TRIANGLE_FAN
   * @param {number} range_start first primitive to render
   * @param {number} range_length number of primitives to render
   */
  drawBuffers(
    vertexBuffers: Record<string, Buffer>,
    indexBuffer: Buffer | null,
    mode: number,
    range_start?: number,
    range_length?: number
  ): Shader {
    if (range_length == 0) return this;

    const gl = this.gl;

    if (this._first_use) this.checkLink();
    gl.useProgram(this.program); // this could be removed assuming every shader is called with some uniforms

    // enable attributes as necessary.
    let length = 0;
    const attribs_in_use = temp_attribs_array; // hack to avoid garbage
    attribs_in_use.set(temp_attribs_array_zero); // reset

    for (const name in vertexBuffers) {
      const buffer = vertexBuffers[name];
      const attribute = buffer.attribute || name;
      // precompute attribute locations in shader
      const location = this.attributes[attribute]; // || gl.getAttribLocation(this.program, attribute);

      if (location == null || !buffer.buffer)
        // -1 changed for null
        continue; // ignore this buffer

      attribs_in_use[location] = 1; // mark it as used

      const glbuffer = buffer.buffer as DataWebGLBuffer;
      // this.attributes[attribute] = location;
      gl.bindBuffer(gl.ARRAY_BUFFER, glbuffer);
      gl.enableVertexAttribArray(location);

      gl.vertexAttribPointer(location, glbuffer.spacing, glbuffer.gl_type, buffer.normalize, 0, 0);
      length = glbuffer.length / glbuffer.spacing;
    }

    // range rendering
    let offset = 0; // in bytes
    if (range_start !== undefined && range_start > 0)
      // render a polygon range
      offset = range_start; // in bytes (Uint16 == 2 bytes)

    if (indexBuffer) length = (indexBuffer.buffer as DataWebGLBuffer).length - offset;

    if (range_length !== undefined && range_length > 0 && range_length < length)
      // to avoid problems
      length = range_length;

    const BYTES_PER_ELEMENT =
      indexBuffer && indexBuffer.data
        ? (indexBuffer.data.constructor as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT
        : 1;
    offset *= BYTES_PER_ELEMENT;

    // Force to disable buffers in this shader that are not in this mesh
    for (const attribute in this.attributes) {
      const location = this.attributes[attribute];
      if (!attribs_in_use[location]) {
        gl.disableVertexAttribArray(this.attributes[attribute]);
      }
    }

    // Draw the geometry.
    if (length && (!indexBuffer || indexBuffer.buffer)) {
      if (indexBuffer) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer.buffer);
        gl.drawElements(mode, length, (indexBuffer.buffer as DataWebGLBuffer).gl_type, offset); // gl.UNSIGNED_SHORT
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
      } else {
        gl.drawArrays(mode, offset, length);
      }
      gl.draw_calls++;
    }

    return this;
  }

  drawInstanced(
    mesh: Mesh,
    primitive: number,
    indices: string | Buffer | null | undefined,
    instanced_uniforms: Record<string, number[] | number[][] | Float32Array>,
    range_start?: number,
    range_length?: number,
    num_intances?: number
  ): Shader | undefined {
    if (range_length === 0) return;

    // bind buffers
    const gl = this.gl;

    if (gl.webgl_version == 1 && !gl.extensions.ANGLE_instanced_arrays) throw "instancing not supported";

    if (this._first_use) this.checkLink();
    gl.useProgram(this.program); // this could be removed assuming every shader is called with some uniforms

    // enable attributes as necessary.
    let length = 0;
    const attribs_in_use = temp_attribs_array; // hack to avoid garbage
    attribs_in_use.set(temp_attribs_array_zero); // reset

    const vertexBuffers = mesh.vertexBuffers;

    for (const name in vertexBuffers) {
      const buffer = vertexBuffers[name];
      const attribute = buffer.attribute || name;
      // precompute attribute locations in shader
      const location = this.attributes[attribute]; // || gl.getAttribLocation(this.program, attribute);

      if (location == null || !buffer.buffer)
        // -1 changed for null
        continue; // ignore this buffer

      attribs_in_use[location] = 1; // mark it as used

      const glbuffer = buffer.buffer as DataWebGLBuffer;
      // this.attributes[attribute] = location;
      gl.bindBuffer(gl.ARRAY_BUFFER, glbuffer);
      gl.enableVertexAttribArray(location);

      gl.vertexAttribPointer(location, glbuffer.spacing, glbuffer.gl_type, buffer.normalize, 0, 0);
      length = glbuffer.length / glbuffer.spacing;
    }

    let indexBuffer: Buffer | null = null;
    if (indices) {
      if (typeof indices === "string") indexBuffer = mesh.getIndexBuffer(indices);
      else if (indices instanceof Buffer) indexBuffer = indices;
    }

    // range rendering
    let offset = 0; // in bytes
    if (range_start !== undefined && range_start > 0)
      // render a polygon range
      offset = range_start;

    if (indexBuffer) length = (indexBuffer.buffer as DataWebGLBuffer).length - offset;

    if (range_length !== undefined && range_length > 0 && range_length < length)
      // to avoid problems
      length = range_length;

    const BYTES_PER_ELEMENT =
      indexBuffer && indexBuffer.data
        ? (indexBuffer.data.constructor as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT
        : 1;
    offset *= BYTES_PER_ELEMENT;

    // Force to disable buffers in this shader that are not in this mesh
    for (const attribute in this.attributes) {
      const location = this.attributes[attribute];
      if (!attribs_in_use[location]) {
        gl.disableVertexAttribArray(this.attributes[attribute]);
      }
    }

    const ext = gl.extensions.ANGLE_instanced_arrays;
    let batch_length = 0;

    // pack the instanced uniforms
    let index = 0;
    for (const uniform in instanced_uniforms) {
      const values = instanced_uniforms[uniform];
      batch_length = values.length;
      const uniformLocation = this.attributes[uniform];
      if (uniformLocation == null) return; // not found
      let element_size = 0;
      let total_size = 0;
      if (values.constructor === Array) {
        const arr = values as number[] | number[][];
        const first = arr[0];
        element_size = (first as object).constructor === Number ? 1 : (first as number[]).length;
        total_size = element_size * arr.length;
      } // typed array
      else {
        element_size = this.uniformInfo[uniform].type_length;
        total_size = values.length;
        batch_length = total_size / element_size;
      }

      let data_array = Shader._instancing_arrays[index];
      if (!data_array || data_array.data.length < total_size)
        data_array = Shader._instancing_arrays[index] = {
          data: new Float32Array(total_size),
          buffer: gl.createBuffer()!,
        };
      data_array.uniform = uniform;
      data_array.element_size = element_size;
      if (values.constructor === Array) {
        const arr = values as number[][];
        for (let j = 0; j < arr.length; ++j) data_array.data.set(arr[j] as ArrayLike<number>, j * element_size); // flatten array
      } // copy
      else data_array.data.set(values as Float32Array);
      gl.bindBuffer(gl.ARRAY_BUFFER, data_array.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data_array.data, STREAM_DRAW);

      if (element_size == 16) {
        // mat4
        for (let k = 0; k < 4; ++k) {
          gl.enableVertexAttribArray(uniformLocation + k);
          gl.vertexAttribPointer(uniformLocation + k, 4, FLOAT, false, 16 * 4, k * 4 * 4); // 4 bytes per float
          if (ext)
            // webgl 1
            ext.vertexAttribDivisorANGLE(uniformLocation + k, 1); // This makes it instanced!
          else gl.vertexAttribDivisor(uniformLocation + k, 1); // This makes it instanced!
        }
      } // others
      else {
        gl.enableVertexAttribArray(uniformLocation);
        gl.vertexAttribPointer(uniformLocation, element_size, FLOAT, false, element_size * 4, 0); // 4 bytes per float, 0 offset
        if (ext)
          // webgl 1
          ext.vertexAttribDivisorANGLE(uniformLocation, 1); // This makes it instanced!
        else gl.vertexAttribDivisor(uniformLocation, 1); // This makes it instanced!
      }
      index += 1;
    }

    if (num_intances) batch_length = num_intances;

    if (ext) {
      // webgl 1.0
      if (indexBuffer) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer.buffer);
        ext.drawElementsInstancedANGLE(
          primitive,
          length,
          (indexBuffer.buffer as DataWebGLBuffer).gl_type,
          offset,
          batch_length
        );
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
      } else ext.drawArraysInstancedANGLE(primitive, offset, length, batch_length);
    } else {
      if (indexBuffer) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer.buffer);
        gl.drawElementsInstanced(
          primitive,
          length,
          (indexBuffer.buffer as DataWebGLBuffer).gl_type,
          offset,
          batch_length
        );
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
      } else gl.drawArraysInstanced(primitive, offset, length, batch_length);
    }

    // disable instancing buffers
    for (let i = 0; i < index; ++i) {
      const info = Shader._instancing_arrays[i];
      const uniformLocation = this.attributes[info.uniform as string];
      const element_size = info.element_size;
      if (element_size == 16) {
        // mat4
        for (let k = 0; k < 4; ++k) {
          gl.disableVertexAttribArray(uniformLocation + k);
          if (ext)
            // webgl 1
            ext.vertexAttribDivisorANGLE(uniformLocation + k, 0);
          else gl.vertexAttribDivisor(uniformLocation + k, 0);
        }
      } // others
      else {
        gl.enableVertexAttribArray(uniformLocation);
        if (ext)
          // webgl 1
          ext.vertexAttribDivisorANGLE(uniformLocation, 0);
        else gl.vertexAttribDivisor(uniformLocation, 0);
      }
    }

    return this;
  }

  /**
   * Given a source code with the directive #import it expands it inserting the code using Shader.files to fetch for import files.
   * Warning: Imports are evaluated only the first inclusion, the rest are ignored to avoid double inclusion of functions
   *          Also, imports cannot have other imports inside.
   * @method Shader.expandImports
   * @param {String} code the source code
   * @param {Object} files [Optional] object with files to import from (otherwise Shader.files is used)
   * @return {String} the code with the lines #import removed and replaced by the code
   */
  static expandImports(code: string, files?: Record<string, string> | null): string {
    const f = files || Shader.files;

    const already_imported: Record<string, boolean> = {}; // avoid to import two times the same code
    if (!f) throw "Shader.files not initialized, assign files there";

    const replace_import = function (v: string): string {
      const token = v.split('"');
      const id = token[1];
      if (already_imported[id]) return "//already imported: " + id + "\n";
      const file = f[id];
      already_imported[id] = true;
      if (file) return file + "\n";
      return "//import code not found: " + id + "\n";
    };

    // return code.replace(/#import\s+\"(\w+)\"\s*\n/g, replace_import );
    return code.replace(/#import\s+"([a-zA-Z0-9_.]+)"\s*\n/g, replace_import);
  }

  static dumpErrorToConsole(err: string, vscode: string, fscode: string): void {
    console.error(err);
    let code: string;
    if (err.indexOf("Fragment") != -1) code = fscode;
    else code = vscode;

    const lines = code.split("\n");
    for (const i in lines) lines[i] = i + "| " + lines[i];

    console.groupCollapsed("Shader code");
    console.log(lines.join("\n"));
    console.groupEnd();
  }

  static convertTo100(code: string, type: number): void {
    // in VERTEX
    // change in for attribute
    // change out for varying
    // add #extension GL_OES_standard_derivatives
    // in FRAGMENT
    // change in for varying
    // remove out vec4 _gl_FragColor
    // rename _gl_FragColor for gl_FragColor
    // in both
    // change #version 300 es for #version 100
    // replace 'texture(' for 'texture2D('
    void code;
    void type;
  }

  static convertTo300(code: string, type: number): void {
    // in VERTEX
    // change attribute for in
    // change varying for out
    // remove #extension GL_OES_standard_derivatives
    // in FRAGMENT
    // change varying for in
    // rename gl_FragColor for _gl_FragColor
    // rename gl_FragData[0] for _gl_FragColor
    // add out vec4 _gl_FragColor
    // in both
    // replace texture2D for texture
    void code;
    void type;
  }

  // helps to check if a variable value is valid to an specific uniform in a shader
  static validateValue(value: unknown, uniform_info: UniformInfo): boolean {
    if (value === null || value === undefined) return false;

    switch (uniform_info.type) {
      // used to validate shaders
      case INT:
      case FLOAT:
      case SAMPLER_2D:
      case SAMPLER_3D:
      case SAMPLER_CUBE:
      case INT_SAMPLER_2D:
      case INT_SAMPLER_3D:
      case INT_SAMPLER_CUBE:
      case UNSIGNED_INT_SAMPLER_2D:
      case UNSIGNED_INT_SAMPLER_3D:
      case UNSIGNED_INT_SAMPLER_CUBE:
        return isNumber(value);
      case INT_VEC2:
      case FLOAT_VEC2:
        return (value as ArrayLike<number>).length === 2;
      case INT_VEC3:
      case FLOAT_VEC3:
        return (value as ArrayLike<number>).length === 3;
      case INT_VEC4:
      case FLOAT_VEC4:
      case FLOAT_MAT2:
        return (value as ArrayLike<number>).length === 4;
      case FLOAT_MAT3:
        return (value as ArrayLike<number>).length === 8;
      case FLOAT_MAT4:
        return (value as ArrayLike<number>).length === 16;
    }
    return true;
  }

  //**************** SHADERS ***********************************

  static DEFAULT_VERTEX_SHADER = "\n\
			precision highp float;\n\
			attribute vec3 a_vertex;\n\
			attribute vec3 a_normal;\n\
			attribute vec2 a_coord;\n\
			varying vec3 v_position;\n\
			varying vec3 v_normal;\n\
			varying vec2 v_coord;\n\
			uniform mat4 u_model;\n\
			uniform mat4 u_mvp;\n\
			void main() {\n\
				v_position = (u_model * vec4(a_vertex,1.0)).xyz;\n\
				v_normal = (u_model * vec4(a_normal,0.0)).xyz;\n\
				v_coord = a_coord;\n\
				gl_Position = u_mvp * vec4(a_vertex,1.0);\n\
			}\n\
			";

  static SCREEN_VERTEX_SHADER = "\n\
			precision highp float;\n\
			attribute vec3 a_vertex;\n\
			attribute vec2 a_coord;\n\
			varying vec2 v_coord;\n\
			void main() { \n\
				v_coord = a_coord; \n\
				gl_Position = vec4(a_coord * 2.0 - 1.0, 0.0, 1.0); \n\
			}\n\
			";

  static SCREEN_300_VERTEX_SHADER = "#version 300 es\n\
			precision highp float;\n\
			in vec3 a_vertex;\n\
			in vec2 a_coord;\n\
			out vec2 v_coord;\n\
			void main() { \n\
				v_coord = a_coord; \n\
				gl_Position = vec4(a_coord * 2.0 - 1.0, 0.0, 1.0); \n\
			}\n\
			";

  static SCREEN_FRAGMENT_SHADER = "\n\
			precision highp float;\n\
			uniform sampler2D u_texture;\n\
			varying vec2 v_coord;\n\
			void main() {\n\
				gl_FragColor = texture2D(u_texture, v_coord);\n\
			}\n\
			";

  // used in createFX
  static SCREEN_FRAGMENT_FX = "\n\
			precision highp float;\n\
			uniform sampler2D u_texture;\n\
			varying vec2 v_coord;\n\
			#ifdef FX_UNIFORMS\n\
				FX_UNIFORMS\n\
			#endif\n\
			void main() {\n\
				vec2 uv = v_coord;\n\
				vec4 color = texture2D(u_texture, uv);\n\
				#ifdef FX_CODE\n\
					FX_CODE ;\n\
				#endif\n\
				gl_FragColor = color;\n\
			}\n\
			";

  static SCREEN_COLORED_FRAGMENT_SHADER = "\n\
			precision highp float;\n\
			uniform sampler2D u_texture;\n\
			uniform vec4 u_color;\n\
			varying vec2 v_coord;\n\
			void main() {\n\
				gl_FragColor = u_color * texture2D(u_texture, v_coord);\n\
			}\n\
			";

  static BLEND_FRAGMENT_SHADER = "\n\
			precision highp float;\n\
			uniform sampler2D u_texture;\n\
			uniform sampler2D u_texture2;\n\
			uniform float u_factor;\n\
			varying vec2 v_coord;\n\
			void main() {\n\
				gl_FragColor = mix( texture2D(u_texture, v_coord), texture2D(u_texture2, v_coord), u_factor);\n\
			}\n\
			";

  // used to paint quads
  static QUAD_VERTEX_SHADER = "\n\
			precision highp float;\n\
			attribute vec3 a_vertex;\n\
			attribute vec2 a_coord;\n\
			varying vec2 v_coord;\n\
			uniform vec2 u_position;\n\
			uniform vec2 u_size;\n\
			uniform vec2 u_viewport;\n\
			uniform mat3 u_transform;\n\
			void main() { \n\
				vec3 pos = vec3(u_position + vec2(a_coord.x,1.0 - a_coord.y)  * u_size, 1.0);\n\
				v_coord = a_coord; \n\
				pos = u_transform * pos;\n\
				pos.z = 0.0;\n\
				//normalize\n\
				pos.x = (2.0 * pos.x / u_viewport.x) - 1.0;\n\
				pos.y = -((2.0 * pos.y / u_viewport.y) - 1.0);\n\
				gl_Position = vec4(pos, 1.0); \n\
			}\n\
			";

  static QUAD_FRAGMENT_SHADER = "\n\
			precision highp float;\n\
			uniform sampler2D u_texture;\n\
			uniform vec4 u_color;\n\
			varying vec2 v_coord;\n\
			void main() {\n\
				gl_FragColor = u_color * texture2D(u_texture, v_coord);\n\
			}\n\
			";

  // used to render partially a texture
  static QUAD2_FRAGMENT_SHADER = "\n\
			precision highp float;\n\
			uniform sampler2D u_texture;\n\
			uniform vec4 u_color;\n\
			uniform vec4 u_texture_area;\n\
			varying vec2 v_coord;\n\
			void main() {\n\
			    vec2 uv = vec2( mix(u_texture_area.x, u_texture_area.z, v_coord.x), 1.0 - mix(u_texture_area.w, u_texture_area.y, v_coord.y) );\n\
				gl_FragColor = u_color * texture2D(u_texture, uv);\n\
			}\n\
			";

  static PRIMITIVE2D_VERTEX_SHADER = "\n\
			precision highp float;\n\
			attribute vec3 a_vertex;\n\
			uniform vec2 u_viewport;\n\
			uniform mat3 u_transform;\n\
			void main() { \n\
				vec3 pos = a_vertex;\n\
				pos = u_transform * pos;\n\
				pos.z = 0.0;\n\
				//normalize\n\
				pos.x = (2.0 * pos.x / u_viewport.x) - 1.0;\n\
				pos.y = -((2.0 * pos.y / u_viewport.y) - 1.0);\n\
				gl_Position = vec4(pos, 1.0); \n\
			}\n\
			";

  static FLAT_VERTEX_SHADER = "\n\
			precision highp float;\n\
			attribute vec3 a_vertex;\n\
			uniform mat4 u_mvp;\n\
			void main() { \n\
				gl_Position = u_mvp * vec4(a_vertex,1.0); \n\
			}\n\
			";

  static FLAT_FRAGMENT_SHADER = "\n\
			precision highp float;\n\
			uniform vec4 u_color;\n\
			void main() {\n\
				gl_FragColor = u_color;\n\
			}\n\
			";

  static SCREEN_FLAT_FRAGMENT_SHADER = Shader.FLAT_FRAGMENT_SHADER; // legacy

  /**
   * Allows to create a simple shader meant to be used to process a texture, instead of having to define the generic Vertex & Fragment Shader code
   * @method Shader.createFX
   * @param {string} code string containg code, like "color = color * 2.0;"
   * @param {string} [uniforms=null] string containg extra uniforms, like "uniform vec3 u_pos;"
   */
  static createFX(code: string, uniforms?: string | null, shader?: Shader): Shader {
    // remove comments
    code = Shader.removeComments(code, true); // remove comments and breaklines to avoid problems with the macros
    const uniforms_clean = Shader.removeComments(uniforms, true); // remove comments and breaklines to avoid problems with the macros
    const macros = {
      FX_CODE: code,
      FX_UNIFORMS: uniforms_clean || "",
    };
    if (!shader) return new Shader(Shader.SCREEN_VERTEX_SHADER, Shader.SCREEN_FRAGMENT_FX, macros);
    shader.updateShader(Shader.SCREEN_VERTEX_SHADER, Shader.SCREEN_FRAGMENT_FX, macros);
    return shader;
  }

  /**
   * Given a shader code with some vars inside (like {{varname}}) and an object with the variable values, it will replace them.
   * @method Shader.replaceCodeUsingContext
   * @param {string} code string containg code and vars in {{varname}} format
   * @param {object} context object containing all var values
   */
  static replaceCodeUsingContext(code_template: string, context: Record<string, string>): string {
    return code_template.replace(/\{\{[a-zA-Z0-9_]*\}\}/g, function (v: string): string {
      v = v.replace(/[{}]/g, "");
      return context[v] || "";
    });
  }

  static removeComments(code?: string | null, one_line?: boolean): string {
    if (!code) return "";

    const rx = /(\/\*([^*]|[\r\n]|(\*+([^*/]|[\r\n])))*\*+\/)|(\/\/.*)/g;
    code = code.replace(rx, "");
    const lines = code.split("\n");
    const result: string[] = [];
    for (let i = 0; i < lines.length; ++i) {
      let line = lines[i];
      const pos = line.indexOf("//");
      if (pos != -1) line = lines[i].substr(0, pos);
      line = line.trim();
      if (line.length) result.push(line);
    }
    return result.join(one_line ? "" : "\n");
  }

  /**
   * Renders a fullscreen quad with this shader applied
   * @method toViewport
   * @param {object} uniforms
   */
  toViewport(uniforms?: Record<string, UniformValue>): void {
    const mesh = Mesh.getScreenQuad();
    if (uniforms) this.uniforms(uniforms);
    this.draw(mesh);
  }

  // Now some common shaders everybody needs

  /**
   * Returns a shader ready to render a textured quad in fullscreen, use with Mesh.getScreenQuad() mesh
   * shader params: sampler2D u_texture
   * @method Shader.getScreenShader
   */
  static getScreenShader(gl?: GLContext): Shader {
    const g = gl || globalThis.gl;
    let shader = g.shaders[":screen"];
    if (shader) return shader;
    shader = g.shaders[":screen"] = new Shader(Shader.SCREEN_VERTEX_SHADER, Shader.SCREEN_FRAGMENT_SHADER);
    return shader.uniforms({ u_texture: 0 }); // do it the first time so I dont have to do it every time
  }

  /**
   * Returns a shader ready to render a flat color quad in fullscreen, use with Mesh.getScreenQuad() mesh
   * shader params: vec4 u_color
   * @method Shader.getFlatScreenShader
   */
  static getFlatScreenShader(gl?: GLContext): Shader {
    const g = gl || globalThis.gl;
    let shader = g.shaders[":flat_screen"];
    if (shader) return shader;
    shader = g.shaders[":flat_screen"] = new Shader(Shader.SCREEN_VERTEX_SHADER, Shader.FLAT_FRAGMENT_SHADER);
    return shader.uniforms({ u_color: [1, 1, 1, 1] }); // do it the first time so I dont have to do it every time
  }

  /**
   * Returns a shader ready to render a colored textured quad in fullscreen, use with Mesh.getScreenQuad() mesh
   * shader params vec4 u_color and sampler2D u_texture
   * @method Shader.getColoredScreenShader
   */
  static getColoredScreenShader(gl?: GLContext): Shader {
    const g = gl || globalThis.gl;
    let shader = g.shaders[":colored_screen"];
    if (shader) return shader;
    shader = g.shaders[":colored_screen"] = new Shader(
      Shader.SCREEN_VERTEX_SHADER,
      Shader.SCREEN_COLORED_FRAGMENT_SHADER
    );
    return shader.uniforms({ u_texture: 0, u_color: vec4.fromValues(1, 1, 1, 1) }); // do it the first time so I dont have to do it every time
  }

  /**
   * Returns a shader ready to render a quad with transform, use with Mesh.getScreenQuad() mesh
   * shader must have: u_position, u_size, u_viewport, u_transform (mat3)
   * @method Shader.getQuadShader
   */
  static getQuadShader(gl?: GLContext): Shader {
    const g = gl || globalThis.gl;
    const shader = g.shaders[":quad"];
    if (shader) return shader;
    return (g.shaders[":quad"] = new Shader(Shader.QUAD_VERTEX_SHADER, Shader.QUAD_FRAGMENT_SHADER));
  }

  /**
   * Returns a shader ready to render part of a texture into the viewport
   * shader must have: u_position, u_size, u_viewport, u_transform, u_texture_area (vec4)
   * @method Shader.getPartialQuadShader
   */
  static getPartialQuadShader(gl?: GLContext): Shader {
    const g = gl || globalThis.gl;
    const shader = g.shaders[":quad2"];
    if (shader) return shader;
    return (g.shaders[":quad2"] = new Shader(Shader.QUAD_VERTEX_SHADER, Shader.QUAD2_FRAGMENT_SHADER));
  }

  /**
   * Returns a shader that blends two textures
   * shader must have: u_factor, u_texture, u_texture2
   * @method Shader.getBlendShader
   */
  static getBlendShader(gl?: GLContext): Shader {
    const g = gl || globalThis.gl;
    const shader = g.shaders[":blend"];
    if (shader) return shader;
    return (g.shaders[":blend"] = new Shader(Shader.SCREEN_VERTEX_SHADER, Shader.BLEND_FRAGMENT_SHADER));
  }

  /**
   * Returns a shader used to apply gaussian blur to one texture in one axis (you should use it twice to get a gaussian blur)
   * shader params are: vec2 u_offset, float u_intensity
   * @method Shader.getBlurShader
   */
  static getBlurShader(gl?: GLContext): Shader {
    const g = gl || globalThis.gl;
    const existing = g.shaders[":blur"];
    if (existing) return existing;

    const shader = new Shader(
      Shader.SCREEN_VERTEX_SHADER,
      "\n\
			precision highp float;\n\
			varying vec2 v_coord;\n\
			uniform sampler2D u_texture;\n\
			uniform vec2 u_offset;\n\
			uniform float u_intensity;\n\
			void main() {\n\
			   vec4 sum = vec4(0.0);\n\
			   sum += texture2D(u_texture, v_coord + u_offset * -4.0) * 0.05/0.98;\n\
			   sum += texture2D(u_texture, v_coord + u_offset * -3.0) * 0.09/0.98;\n\
			   sum += texture2D(u_texture, v_coord + u_offset * -2.0) * 0.12/0.98;\n\
			   sum += texture2D(u_texture, v_coord + u_offset * -1.0) * 0.15/0.98;\n\
			   sum += texture2D(u_texture, v_coord) * 0.16/0.98;\n\
			   sum += texture2D(u_texture, v_coord + u_offset * 4.0) * 0.05/0.98;\n\
			   sum += texture2D(u_texture, v_coord + u_offset * 3.0) * 0.09/0.98;\n\
			   sum += texture2D(u_texture, v_coord + u_offset * 2.0) * 0.12/0.98;\n\
			   sum += texture2D(u_texture, v_coord + u_offset * 1.0) * 0.15/0.98;\n\
			   gl_FragColor = u_intensity * sum;\n\
			}\n\
			"
    );
    return (g.shaders[":blur"] = shader);
  }

  // shader to copy a depth texture into another one
  static getCopyDepthShader(gl?: GLContext): Shader {
    const g = gl || globalThis.gl;
    const existing = g.shaders[":copy_depth"];
    if (existing) return existing;

    const shader = new Shader(
      Shader.SCREEN_VERTEX_SHADER,
      "\n\
			#extension GL_EXT_frag_depth : enable\n\
			precision highp float;\n\
			varying vec2 v_coord;\n\
			uniform sampler2D u_texture;\n\
			void main() {\n\
			   gl_FragDepthEXT = texture2D( u_texture, v_coord ).x;\n\
			   gl_FragColor = vec4(1.0);\n\
			}\n\
			"
    );
    return (g.shaders[":copy_depth"] = shader);
  }

  static getCubemapShowShader(gl?: GLContext): Shader {
    const g = gl || globalThis.gl;
    const existing = g.shaders[":show_cubemap"];
    if (existing) return existing;

    const shader = new Shader(
      Shader.DEFAULT_VERTEX_SHADER,
      "\n\
			precision highp float;\n\
			varying vec3 v_normal;\n\
			uniform samplerCube u_texture;\n\
			void main() {\n\
			   gl_FragColor = textureCube( u_texture, v_normal );\n\
			}\n\
			"
    );
    shader.uniforms({ u_texture: 0 });
    return (g.shaders[":show_cubemap"] = shader);
  }

  // shader to copy a cubemap into another
  static getPolarToCubemapShader(gl?: GLContext): Shader {
    const g = gl || globalThis.gl;
    const existing = g.shaders[":polar_to_cubemap"];
    if (existing) return existing;

    const shader = new Shader(
      Shader.SCREEN_VERTEX_SHADER,
      "\n\
			precision highp float;\n\
			varying vec2 v_coord;\n\
			uniform sampler2D u_texture;\n\
			uniform mat3 u_rotation;\n\
			void main() {\n\
				vec2 uv = vec2( v_coord.x, 1.0 - v_coord.y );\n\
				vec3 dir = normalize( vec3( uv - vec2(0.5), 0.5 ));\n\
				dir = u_rotation * dir;\n\
				float u = atan(dir.x,dir.z) / 6.28318531;\n\
				float v = (asin(dir.y) / 1.57079633) * 0.5 + 0.5;\n\
				u = mod(u,1.0);\n\
				v = mod(v,1.0);\n\
			   gl_FragColor = texture2D( u_texture, vec2(u,v) );\n\
			}\n\
			"
    );
    return (g.shaders[":polar_to_cubemap"] = shader);
  }

  // shader to copy a cubemap into another
  static getCubemapCopyShader(gl?: GLContext): Shader {
    const g = gl || globalThis.gl;
    const existing = g.shaders[":copy_cubemap"];
    if (existing) return existing;

    const shader = new Shader(
      Shader.SCREEN_VERTEX_SHADER,
      "\n\
			precision highp float;\n\
			varying vec2 v_coord;\n\
			uniform samplerCube u_texture;\n\
			uniform mat3 u_rotation;\n\
			void main() {\n\
				vec2 uv = vec2( v_coord.x, 1.0 - v_coord.y );\n\
				vec3 dir = vec3( uv - vec2(0.5), 0.5 );\n\
				dir = u_rotation * dir;\n\
			   gl_FragColor = textureCube( u_texture, dir );\n\
			}\n\
			"
    );
    return (g.shaders[":copy_cubemap"] = shader);
  }

  // shader to blur a cubemap
  static getCubemapBlurShader(gl?: GLContext): Shader {
    const g = gl || globalThis.gl;
    const existing = g.shaders[":blur_cubemap"];
    if (existing) return existing;

    const shader = new Shader(
      Shader.SCREEN_VERTEX_SHADER,
      "\n\
			#ifndef NUM_SAMPLES\n\
				#define NUM_SAMPLES 4\n\
			#endif\n\
			\n\
			precision highp float;\n\
			varying vec2 v_coord;\n\
			uniform samplerCube u_texture;\n\
			uniform mat3 u_rotation;\n\
			uniform vec2 u_offset;\n\
			uniform float u_intensity;\n\
			void main() {\n\
				vec4 sum = vec4(0.0);\n\
				vec2 uv = vec2( v_coord.x, 1.0 - v_coord.y ) - vec2(0.5);\n\
				vec3 dir = vec3(0.0);\n\
				vec4 color = vec4(0.0);\n\
				for( int x = -2; x <= 2; x++ )\n\
				{\n\
					for( int y = -2; y <= 2; y++ )\n\
					{\n\
						dir.xy = uv + vec2( u_offset.x * float(x), u_offset.y * float(y)) * 0.5;\n\
						dir.z = 0.5;\n\
						dir = u_rotation * dir;\n\
						color = textureCube( u_texture, dir );\n\
						color.xyz = color.xyz * color.xyz;/*linearize*/\n\
						sum += color;\n\
					}\n\
				}\n\
				sum /= 25.0;\n\
			   gl_FragColor = vec4( sqrt( sum.xyz ), sum.w ) ;\n\
			}\n\
			"
    );
    return (g.shaders[":blur_cubemap"] = shader);
  }

  // shader to do FXAA (antialiasing)
  static FXAA_FUNC = "\n\
	uniform vec2 u_viewportSize;\n\
	uniform vec2 u_iViewportSize;\n\
	#define FXAA_REDUCE_MIN   (1.0/ 128.0)\n\
	#define FXAA_REDUCE_MUL   (1.0 / 8.0)\n\
	#define FXAA_SPAN_MAX     8.0\n\
	\n\
	/* from mitsuhiko/webgl-meincraft based on the code on geeks3d.com */\n\
	/* fragCoord MUST BE IN PIXELS */\n\
	vec4 applyFXAA(sampler2D tex, vec2 fragCoord)\n\
	{\n\
		vec4 color = vec4(0.0);\n\
		/*vec2 u_iViewportSize = vec2(1.0 / u_viewportSize.x, 1.0 / u_viewportSize.y);*/\n\
		vec3 rgbNW = texture2D(tex, (fragCoord + vec2(-1.0, -1.0)) * u_iViewportSize).xyz;\n\
		vec3 rgbNE = texture2D(tex, (fragCoord + vec2(1.0, -1.0)) * u_iViewportSize).xyz;\n\
		vec3 rgbSW = texture2D(tex, (fragCoord + vec2(-1.0, 1.0)) * u_iViewportSize).xyz;\n\
		vec3 rgbSE = texture2D(tex, (fragCoord + vec2(1.0, 1.0)) * u_iViewportSize).xyz;\n\
		vec3 rgbM  = texture2D(tex, fragCoord  * u_iViewportSize).xyz;\n\
		vec3 luma = vec3(0.299, 0.587, 0.114);\n\
		float lumaNW = dot(rgbNW, luma);\n\
		float lumaNE = dot(rgbNE, luma);\n\
		float lumaSW = dot(rgbSW, luma);\n\
		float lumaSE = dot(rgbSE, luma);\n\
		float lumaM  = dot(rgbM,  luma);\n\
		float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));\n\
		float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));\n\
		\n\
		vec2 dir;\n\
		dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));\n\
		dir.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));\n\
		\n\
		float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * (0.25 * FXAA_REDUCE_MUL), FXAA_REDUCE_MIN);\n\
		\n\
		float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);\n\
		dir = min(vec2(FXAA_SPAN_MAX, FXAA_SPAN_MAX), max(vec2(-FXAA_SPAN_MAX, -FXAA_SPAN_MAX), dir * rcpDirMin)) * u_iViewportSize;\n\
		\n\
		vec3 rgbA = 0.5 * (texture2D(tex, fragCoord * u_iViewportSize + dir * (1.0 / 3.0 - 0.5)).xyz + \n\
			texture2D(tex, fragCoord * u_iViewportSize + dir * (2.0 / 3.0 - 0.5)).xyz);\n\
		vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(tex, fragCoord * u_iViewportSize + dir * -0.5).xyz + \n\
			texture2D(tex, fragCoord * u_iViewportSize + dir * 0.5).xyz);\n\
		\n\
		//return vec4(rgbA,1.0);\n\
		float lumaB = dot(rgbB, luma);\n\
		if ((lumaB < lumaMin) || (lumaB > lumaMax))\n\
			color = vec4(rgbA, 1.0);\n\
		else\n\
			color = vec4(rgbB, 1.0);\n\
		return color;\n\
	}\n\
";

  /**
   * Returns a shader to apply FXAA antialiasing
   * params are vec2 u_viewportSize, vec2 u_iViewportSize or you can call shader.setup()
   * @method Shader.getFXAAShader
   */
  static getFXAAShader(gl?: GLContext): Shader {
    const g = gl || globalThis.gl;
    const existing = g.shaders[":fxaa"];
    if (existing) return existing;

    const shader = new Shader(
      Shader.SCREEN_VERTEX_SHADER,
      "\n\
			precision highp float;\n\
			varying vec2 v_coord;\n\
			uniform sampler2D u_texture;\n\
			" +
        Shader.FXAA_FUNC +
        "\n\
			\n\
			void main() {\n\
			   gl_FragColor = applyFXAA( u_texture, v_coord * u_viewportSize) ;\n\
			}\n\
			"
    );

    const viewport = vec2.fromValues(g.viewport_data[2], g.viewport_data[3]);
    const iviewport = vec2.fromValues(1 / g.viewport_data[2], 1 / g.viewport_data[3]);

    shader.setup = function (this: Shader): void {
      viewport[0] = g.viewport_data[2];
      viewport[1] = g.viewport_data[3];
      iviewport[0] = 1 / g.viewport_data[2];
      iviewport[1] = 1 / g.viewport_data[3];
      this.uniforms({ u_viewportSize: viewport, u_iViewportSize: iviewport });
    };
    return (g.shaders[":fxaa"] = shader);
  }

  /**
   * Returns a flat shader (useful to render lines)
   * @method Shader.getFlatShader
   */
  static getFlatShader(gl?: GLContext): Shader {
    const g = gl || globalThis.gl;
    const existing = g.shaders[":flat"];
    if (existing) return existing;

    const shader = new Shader(Shader.FLAT_VERTEX_SHADER, Shader.FLAT_FRAGMENT_SHADER);
    shader.uniforms({ u_color: [1, 1, 1, 1] });
    return (g.shaders[":flat"] = shader);
  }
}
