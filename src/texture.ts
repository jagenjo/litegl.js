// Texture class: uploads images/data to the GPU and offers helpers to render to/from textures.
//
// Converted from the original prototype-based texture.js to a strict-TypeScript ES module. The class
// keeps its original public API; a later index.ts re-attaches it to the `GL` namespace and window.

import type { GLContext } from "./types";
import { Shader, type UniformValue } from "./shader";
import { Mesh } from "./mesh";
import { temp_mat3 } from "./temp";
import { isPowerOfTwo, nearestPowerOfTwo, createCanvas, getTime, HttpRequest } from "./utils";
import {
  TEXTURE_2D,
  TEXTURE_CUBE_MAP,
  TEXTURE_3D,
  RGB,
  RGBA,
  DEPTH_COMPONENT,
  DEPTH_STENCIL,
  UNSIGNED_INT_24_8,
  UNSIGNED_BYTE,
  UNSIGNED_SHORT,
  UNSIGNED_INT,
  FLOAT,
  HALF_FLOAT,
  HALF_FLOAT_OES,
  DEPTH_COMPONENT16,
  DEPTH_COMPONENT24,
  DEPTH_COMPONENT32F,
  DEPTH24_STENCIL8,
  RGBA32F,
  RGBA16F,
  RGB32F,
  LINEAR,
  NEAREST,
  CLAMP_TO_EDGE,
} from "./constants";

/** Any DOM source that can be uploaded to a texture. */
export type TextureImageSource =
  | HTMLImageElement
  | HTMLCanvasElement
  | HTMLVideoElement
  | ImageBitmap;

/** Raw pixel data accepted for uploads (a typed array/buffer view or a plain number array). */
export type TexturePixelData = ArrayBufferView | number[];

/** What the `data` field of a Texture can hold (where the content came from). */
export type TextureContent =
  | TextureImageSource
  | ArrayBufferView
  | Array<ArrayBufferView | number[]>
  | TextureImageSource[]
  | null;

/** Info describing where a cubemap face is located inside a bigger image. */
export interface CubemapFaceInfo {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A basic set of texture format properties (subset shared by Texture and getProperties). */
export interface TextureProperties {
  width: number;
  height: number;
  type: number;
  format: number;
  texture_type: number;
  magFilter: number;
  minFilter: number;
  wrapS: number;
  wrapT: number;
}

/** Structural type used to compare two textures (or texture-like descriptors) by format. */
export interface TextureFormatLike {
  width: number;
  height: number;
  type: number;
  format: number;
  texture_type: number;
}

/**
 * Options accepted by the Texture constructor and the static factory methods.
 * See the class JSDoc for a description of the most relevant ones.
 */
export interface TextureOptions {
  texture_type?: number;
  format?: number;
  internalFormat?: number;
  type?: number;
  filter?: number;
  magFilter?: number;
  minFilter?: number;
  wrap?: number;
  wrapS?: number;
  wrapT?: number;
  depth?: number;
  pixel_data?: ArrayBufferView | number[] | Array<ArrayBufferView | number[]>;
  premultiply_alpha?: boolean;
  no_flip?: boolean;
  anisotropic?: number;
  ignore_pot?: boolean;
  texture?: Texture;
  subimage?: boolean;
  cubemap_face?: number;
  mipmap_level?: number;
  extension?: string;
  temp_color?: number[] | Uint8Array | Float32Array;
  keep_image?: boolean;
  is_polar?: boolean;
  is_cross?: number;
  faces?: CubemapFaceInfo[];
  width?: number;
  height?: number;
  size?: number;
}

/** Result of parsing a TGA file. */
export interface TGAImage {
  width: number;
  height: number;
  bpp: number;
  bytesPerPixel: number;
  imageSize: number;
  pixels: Uint8Array;
  flipY: boolean;
  format: string;
}

/** A WebGLRenderbuffer decorated by this module with size/time bookkeeping. */
interface PooledRenderbuffer extends WebGLRenderbuffer {
  time: number;
  width: number;
  height: number;
}

// scratch buffers reused across calls (previously kept alive via closures)
const blit_viewport = new Float32Array(4);
const renderQuad_identity: Float32Array = mat3.create();
const renderQuad_pos: Float32Array = vec2.create();
const renderQuad_size: Float32Array = vec2.create();
const renderQuad_white: Float32Array = vec4.fromValues(1, 1, 1, 1);

/**
* Texture class to upload images to the GPU, default is gl.TEXTURE_2D, gl.RGBA of gl.UNSIGNED_BYTE with filters set to gl.LINEAR and wrap to gl.CLAMP_TO_EDGE <br/>
	There is a list of options <br/>
	========================== <br/>
	- texture_type: gl.TEXTURE_2D, gl.TEXTURE_CUBE_MAP, default gl.TEXTURE_2D <br/>
	- format: gl.RGB, gl.RGBA, gl.DEPTH_COMPONENT, default gl.RGBA <br/>
	- type: gl.UNSIGNED_BYTE, gl.UNSIGNED_SHORT, gl.HALF_FLOAT_OES, gl.FLOAT, default gl.UNSIGNED_BYTE <br/>
	- filter: filtering for mag and min: gl.NEAREST or gl.LINEAR, default gl.NEAREST <br/>
	- magFilter: magnifying filter: gl.NEAREST, gl.LINEAR, default gl.NEAREST <br/>
	- minFilter: minifying filter: gl.NEAREST, gl.LINEAR, gl.LINEAR_MIPMAP_LINEAR, default gl.NEAREST <br/>
	- wrap: texture wrapping: gl.CLAMP_TO_EDGE, gl.REPEAT, gl.MIRROR, default gl.CLAMP_TO_EDGE (also accepts wrapT and wrapS for separate settings) <br/>
	- pixel_data: ArrayBufferView with the pixel data to upload to the texture, otherwise the texture will be black (if cubemaps then pass an array[6] with the data for every face)<br/>
	- premultiply_alpha : multiply the color by the alpha value when uploading, default FALSE <br/>
	- no_flip : do not flip in Y, default TRUE <br/>
	- anisotropic : number of anisotropic fetches, default 0 <br/>

	check for more info about formats: https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/texImage2D

* @class Texture
* @param {number} width texture width (any supported but Power of Two allows to have mipmaps), 0 means no memory reserved till its filled
* @param {number} height texture height (any supported but Power of Two allows to have mipmaps), 0 means no memory reserved till its filled
* @param {Object} options Check the list in the description
* @constructor
*/
export class Texture {
  // --- static configuration ---
  static DEFAULT_TYPE = UNSIGNED_BYTE;
  static DEFAULT_FORMAT = RGBA;
  static DEFAULT_MAG_FILTER = LINEAR;
  static DEFAULT_MIN_FILTER = LINEAR;
  static DEFAULT_WRAP_S = CLAMP_TO_EDGE;
  static DEFAULT_WRAP_T = CLAMP_TO_EDGE;
  static EXTENSION = "png"; //used when saving it to file

  //used for render to FBOs
  static framebuffer: WebGLFramebuffer | null = null;
  static renderbuffer: WebGLRenderbuffer | null = null;
  static loading_color = new Uint8Array([0, 0, 0, 0]);
  static use_renderbuffer_pool = true; //should improve performance

  static CROSS_ORIGIN_CREDENTIALS = "Anonymous";

  static binary_extension = "png";

  static MAX_TEXTURE_IMAGE_UNITS = 0;
  static disable_deprecated?: boolean;

  //When creating cubemaps this is helpful
  //THIS works
  static cubemap_camera_parameters: Array<{
    type: string;
    dir: Float32Array;
    up: Float32Array;
    right: Float32Array;
  }> = [
    { type: "posX", dir: vec3.fromValues(1, 0, 0), up: vec3.fromValues(0, 1, 0), right: vec3.fromValues(0, 0, -1) },
    { type: "negX", dir: vec3.fromValues(-1, 0, 0), up: vec3.fromValues(0, 1, 0), right: vec3.fromValues(0, 0, 1) },
    { type: "posY", dir: vec3.fromValues(0, 1, 0), up: vec3.fromValues(0, 0, -1), right: vec3.fromValues(1, 0, 0) },
    { type: "negY", dir: vec3.fromValues(0, -1, 0), up: vec3.fromValues(0, 0, 1), right: vec3.fromValues(1, 0, 0) },
    { type: "posZ", dir: vec3.fromValues(0, 0, 1), up: vec3.fromValues(0, 1, 0), right: vec3.fromValues(1, 0, 0) },
    { type: "negZ", dir: vec3.fromValues(0, 0, -1), up: vec3.fromValues(0, 1, 0), right: vec3.fromValues(-1, 0, 0) },
  ];

  // --- instance fields ---
  gl: GLContext;
  _context_id: number;
  handler: WebGLTexture | null;
  /** set by FBO while this texture is bound as a render target */
  _in_current_fbo?: boolean;
  width: number;
  height: number;
  depth?: number;
  texture_type: number;
  format: number;
  internalFormat: number;
  type: number;
  magFilter: number;
  minFilter: number;
  wrapS: number;
  wrapT: number;
  data: TextureContent;
  has_mipmaps: boolean;

  // optional / dynamically-assigned fields
  ready?: boolean;
  url?: string;
  img?: TextureImageSource;
  metadata?: { width: number; height: number };
  _key?: string;
  _pool?: number;

  constructor(width: number, height: number, options?: TextureOptions | null, gl?: GLContext) {
    options = options || {};

    //used to avoid problems with resources moving between different webgl context
    gl = gl || globalThis.gl;
    this.gl = gl;
    this._context_id = gl.context_id;

    //round sizes
    width = parseInt(width as unknown as string);
    height = parseInt(height as unknown as string);

    if ((globalThis as unknown as { GL?: { debug?: boolean } }).GL?.debug)
      console.log("GL.Texture created: ", width, height);

    //create texture handler
    this.handler = gl.createTexture();

    //set settings
    this.width = width;
    this.height = height;
    if (options.depth) //for texture_3d
      this.depth = options.depth;
    this.texture_type = options.texture_type || gl.TEXTURE_2D; //or gl.TEXTURE_CUBE_MAP
    this.format = options.format || Texture.DEFAULT_FORMAT; //gl.RGBA (if gl.DEPTH_COMPONENT remember type: gl.UNSIGNED_SHORT)
    this.internalFormat = options.internalFormat || 0; //LUMINANCE, and weird formats with bits
    this.type = options.type || Texture.DEFAULT_TYPE; //gl.UNSIGNED_BYTE, gl.UNSIGNED_SHORT, gl.FLOAT or gl.HALF_FLOAT_OES (or gl.HIGH_PRECISION_FORMAT which could be half or float)
    this.magFilter = options.magFilter || options.filter || Texture.DEFAULT_MAG_FILTER;
    this.minFilter = options.minFilter || options.filter || Texture.DEFAULT_MIN_FILTER;
    this.wrapS = options.wrap || options.wrapS || Texture.DEFAULT_WRAP_S;
    this.wrapT = options.wrap || options.wrapT || Texture.DEFAULT_WRAP_T;
    this.data = null; //where the data came from

    //precompute the max amount of texture units
    if (!Texture.MAX_TEXTURE_IMAGE_UNITS)
      Texture.MAX_TEXTURE_IMAGE_UNITS = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number;

    this.has_mipmaps = false;

    if (this.format == gl.DEPTH_COMPONENT && gl.webgl_version == 1 && !gl.extensions["WEBGL_depth_texture"])
      throw "Depth Texture not supported";
    if (this.type == gl.FLOAT && !gl.extensions["OES_texture_float"] && gl.webgl_version == 1)
      throw "Float Texture not supported";
    if (this.type == HALF_FLOAT_OES) {
      if (!gl.extensions["OES_texture_half_float"] && gl.webgl_version == 1)
        throw "Half Float Texture extension not supported.";
      else if (gl.webgl_version > 1) {
        console.warn("using HALF_FLOAT_OES in WebGL2 is deprecated, suing HALF_FLOAT instead");
        this.type = this.format == gl.RGB ? gl.RGB16F : gl.RGBA16F;
      }
    }
    if (
      (!isPowerOfTwo(this.width) || !isPowerOfTwo(this.height)) && //non power of two
      ((this.minFilter != gl.NEAREST && this.minFilter != gl.LINEAR) || //uses mipmaps
        this.wrapS != gl.CLAMP_TO_EDGE ||
        this.wrapT != gl.CLAMP_TO_EDGE)
    ) {
      //uses wrap
      if (!options.ignore_pot) throw "Cannot use texture-wrap or mipmaps in Non-Power-of-Two textures";
      else {
        this.minFilter = this.magFilter = gl.LINEAR;
        this.wrapS = this.wrapT = gl.CLAMP_TO_EDGE;
      }
    }

    //empty textures are allowed to be created
    if (!width || !height) return;

    //because sometimes the internal format is not so obvious
    if (!this.internalFormat) this.computeInternalFormat();

    const type = this.type;

    function toTypedArray(data: ArrayBufferView | number[]): ArrayBufferView {
      if ((data as { constructor: unknown }).constructor !== Array) return data as ArrayBufferView;
      if (type == FLOAT) return new Float32Array(data as number[]);
      if (type == HALF_FLOAT_OES) return new Uint16Array(data as number[]);
      return new Uint8Array(data as number[]);
    }

    //this is done because in some cases the user binds a texture to slot 0 and then creates a new one, which overrides slot 0
    gl.activeTexture(gl.TEXTURE0 + Texture.MAX_TEXTURE_IMAGE_UNITS - 1);
    //I use an invalid gl enum to say this texture is a depth texture, ugly, I know...
    gl.bindTexture(this.texture_type, this.handler);
    gl.texParameteri(this.texture_type, gl.TEXTURE_MAG_FILTER, this.magFilter);
    gl.texParameteri(this.texture_type, gl.TEXTURE_MIN_FILTER, this.minFilter);
    gl.texParameteri(this.texture_type, gl.TEXTURE_WRAP_S, this.wrapS);
    gl.texParameteri(this.texture_type, gl.TEXTURE_WRAP_T, this.wrapT);

    if (options.anisotropic && gl.extensions["EXT_texture_filter_anisotropic"])
      gl.texParameterf(
        TEXTURE_2D,
        gl.extensions["EXT_texture_filter_anisotropic"].TEXTURE_MAX_ANISOTROPY_EXT,
        options.anisotropic
      );

    let pixel_data: ArrayBufferView | number[] | Array<ArrayBufferView | number[]> | null | undefined =
      options.pixel_data;
    if (pixel_data && !(pixel_data as ArrayBufferView).buffer) {
      if (this.texture_type == TEXTURE_CUBE_MAP) {
        const pd = pixel_data as unknown as unknown[];
        if ((pd[0] as { constructor: unknown }).constructor === Number) {
          //special case, specify just one face and copy it
          const single = toTypedArray(pixel_data as number[]);
          pixel_data = [single, single, single, single, single, single];
        } else {
          const arr = pixel_data as Array<ArrayBufferView | number[]>;
          for (let i = 0; i < arr.length; ++i) arr[i] = toTypedArray(arr[i]);
        }
      } else pixel_data = toTypedArray(pixel_data as ArrayBufferView | number[]);
      this.data = pixel_data as TextureContent;
    }

    Texture.setUploadOptions(options);

    //here we create all **********************************
    //gl.TEXTURE_1D is not supported by WebGL...
    if (this.texture_type == TEXTURE_2D) {
      //create the texture
      gl.texImage2D(
        TEXTURE_2D,
        0,
        this.internalFormat,
        width,
        height,
        0,
        this.format,
        this.type,
        (pixel_data as ArrayBufferView | null) || null
      );

      //generate empty mipmaps (necessary?)
      if (
        isPowerOfTwo(width) &&
        isPowerOfTwo(height) &&
        options.minFilter &&
        options.minFilter != gl.NEAREST &&
        options.minFilter != gl.LINEAR
      ) {
        gl.generateMipmap(this.texture_type);
        this.has_mipmaps = true;
      }
    } else if (this.texture_type == TEXTURE_CUBE_MAP) {
      const facesize = width * width * (this.format == RGBA ? 4 : 3);
      for (let i = 0; i < 6; ++i) {
        let cubemap_data:
          | ArrayBufferView
          | Array<ArrayBufferView | number[]>
          | number[]
          | null
          | undefined = pixel_data;
        if (cubemap_data) {
          if ((cubemap_data as { constructor: unknown }).constructor === Array) //six arrays
            cubemap_data = (cubemap_data as Array<ArrayBufferView | number[]>)[i] as ArrayBufferView;
          //all data mixed in a single array
          else (cubemap_data as unknown as { subarray(a: number, b: number): ArrayBufferView }).subarray(facesize * i, facesize * (i + 1));
        }
        gl.texImage2D(
          gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
          0,
          this.internalFormat,
          this.width,
          this.height,
          0,
          this.format,
          this.type,
          (cubemap_data as ArrayBufferView | null) || null
        );
      }
    } else if (this.texture_type == TEXTURE_3D) {
      if (this.gl.webgl_version == 1)
        throw "TEXTURE_3D not supported in WebGL 1. Enable WebGL 2 in the context by passing webgl2:true to the context";
      if (!options.depth) throw "3d texture depth must be set in the options.depth";
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0); //standard does not allow this flags for 3D textures
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage3D(
        TEXTURE_3D,
        0,
        this.internalFormat,
        width,
        height,
        options.depth,
        0,
        this.format,
        this.type,
        (pixel_data as ArrayBufferView | null) || null
      );
    }
    gl.bindTexture(this.texture_type, null); //disable
    gl.activeTexture(gl.TEXTURE0);
  }

  //because usually you dont want to specify the internalFormat, this tries to guess it from its format
  //check https://webgl2fundamentals.org/webgl/lessons/webgl-data-textures.html for more info
  computeInternalFormat(): void {
    this.internalFormat = this.format; //default

    if (gl.webgl_version == 1) {
      if (this.type == HALF_FLOAT) {
        console.warn("webgl 1 does not use HALF_FLOAT, converting to HALF_FLOAT_OES");
        this.type = HALF_FLOAT_OES;
      }
    } else {
      if (this.type == HALF_FLOAT_OES) {
        console.warn("webgl 2 does not use HALF_FLOAT_OES, converting to HALF_FLOAT");
        this.type = HALF_FLOAT;
      }
    }

    //automatic selection of internal format for depth textures to avoid problems between webgl1 and 2
    if (this.format == DEPTH_COMPONENT || this.format === DEPTH_STENCIL) {
      this.minFilter = NEAREST;

      if (gl.webgl_version == 2) {
        if (this.type === UNSIGNED_INT_24_8 && this.format === DEPTH_STENCIL)
          this.internalFormat = DEPTH24_STENCIL8;
        else if (this.type === FLOAT && this.format === DEPTH_STENCIL)
          this.internalFormat = gl.FLOAT_32_UNSIGNED_INT_24_8_REV;
        else if (this.type == UNSIGNED_SHORT) this.internalFormat = DEPTH_COMPONENT16;
        else if (this.type == UNSIGNED_INT) this.internalFormat = DEPTH_COMPONENT24;
        else if (this.type == FLOAT) this.internalFormat = DEPTH_COMPONENT32F;
        else throw "unsupported type for a depth texture";
      } else if (gl.webgl_version == 1) {
        if (this.type == FLOAT) throw "WebGL 1.0 does not support float depth textures";
        this.internalFormat = DEPTH_COMPONENT;
      }
    } else if (this.format == gl.RGBA) {
      if (gl.webgl_version == 2) {
        if (this.type == FLOAT) this.internalFormat = RGBA32F;
        else if (this.type == HALF_FLOAT) this.internalFormat = RGBA16F;
        /*
			else if( this.type == GL.UNSIGNED_SHORT )
			{
				this.internalFormat = GL.RGBA16UI;
				this.format = gl.RGBA_INTEGER;
			}
			else if( this.type == GL.UNSIGNED_INT )
			{
				this.internalFormat = GL.RGBA32UI;
				this.format = gl.RGBA_INTEGER;
			}
			*/
      }
    } else if (this.format == gl.RGB) {
      if (gl.webgl_version == 2) {
        if (this.type == FLOAT) this.internalFormat = RGB32F;
        else if (this.type == HALF_FLOAT) {
          throw "GL.RGB HALF_FLOAT is not supported, use RGBA instead";
          this.internalFormat = RGB; //not GL.RGB16F
        }
      }
    }
  }

  /**
	* Free the texture memory from the GPU, sets the texture handler to null
	* @method delete
	*/
  delete(): void {
    gl.deleteTexture(this.handler);
    this.handler = null;
  }

  getProperties(): TextureProperties {
    return {
      width: this.width,
      height: this.height,
      type: this.type,
      format: this.format,
      texture_type: this.texture_type,
      magFilter: this.magFilter,
      minFilter: this.minFilter,
      wrapS: this.wrapS,
      wrapT: this.wrapT,
    };
  }

  hasSameProperties(t?: TextureFormatLike | null): boolean {
    if (!t) return false;
    return (
      t.width == this.width &&
      t.height == this.height &&
      t.type == this.type &&
      t.format == this.format &&
      t.texture_type == this.texture_type
    );
  }

  hasSameSize(t?: TextureFormatLike | null): boolean {
    if (!t) return false;
    return t.width == this.width && t.height == this.height;
  }

  //textures cannot be stored in JSON
  toJSON(): string {
    return "";
  }

  /**
	* Returns if depth texture is supported by the GPU
	* @method isDepthSupported
	* @return {Boolean} true if supported
	*/
  static isDepthSupported(): boolean {
    return gl.extensions["WEBGL_depth_texture"] != null;
  }

  /**
	* Binds the texture to one texture unit
	* @method bind
	* @param {number} unit texture unit
	* @return {number} returns the texture unit
	*/
  bind(unit?: number): number {
    if (unit == undefined) unit = 0;
    const gl = this.gl;

    //TODO: if the texture is not uploaded, must be upload now

    //bind
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(this.texture_type, this.handler);
    return unit;
  }

  /**
	* Unbinds the texture
	* @method unbind
	* @param {number} unit texture unit
	* @return {number} returns the texture unit
	*/
  unbind(unit?: number): void {
    if (unit === undefined) unit = 0;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(this.texture_type, null);
  }

  setParameter(param: number, value: number): void {
    this.bind(0);
    this.gl.texParameteri(this.texture_type, param, value);
    switch (param) {
      case this.gl.TEXTURE_MAG_FILTER:
        this.magFilter = value;
        break;
      case this.gl.TEXTURE_MIN_FILTER:
        this.minFilter = value;
        break;
      case this.gl.TEXTURE_WRAP_S:
        this.wrapS = value;
        break;
      case this.gl.TEXTURE_WRAP_T:
        this.wrapT = value;
        break;
    }
  }

  /**
	* Unbinds the texture
	* @method Texture.setUploadOptions
	* @param {Object} options a list of options to upload the texture
	* - premultiply_alpha : multiply the color by the alpha value, default FALSE
	* - no_flip : do not flip in Y, default TRUE
	*/
  static setUploadOptions(options?: TextureOptions | null, gl?: GLContext): void {
    gl = gl || globalThis.gl;

    //FIREFOX throws a warning because this cannot be used with arraybuffers as you are in charge or applying it manually...
    if (!Texture.disable_deprecated) {
      if (options) {
        //options that are not stored in the texture should be passed again to avoid reusing unknown state
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, options.premultiply_alpha ? 1 : 0);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, options.no_flip ? 0 : 1);
      } else {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      }
    }

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  //flips image data in Y in place
  static flipYData(data: Uint8Array | Uint16Array | Float32Array, width: number, height: number, numchannels: number): void {
    const Ctor = data.constructor as { new (length: number): typeof data };
    const temp = new Ctor(width * numchannels);
    let pos = 0;
    let lastpos = width * (height - 1) * numchannels;
    const l = Math.floor(height * 0.5); //middle
    for (let i = 0; i < l; ++i) {
      const row = data.subarray(pos, pos + width * numchannels);
      const row2 = data.subarray(lastpos, lastpos + width * numchannels);
      temp.set(row);
      row.set(row2);
      row2.set(temp);
      pos += width * numchannels;
      lastpos -= width * numchannels;
      if (pos > lastpos) break;
    }
  }

  /**
	* Given an Image/Canvas/Video it uploads it to the GPU
	* @method uploadImage
	* @param {Image} img
	* @param {Object} options [optional] upload options (premultiply_alpha, no_flip)
	*/
  uploadImage(image: TextureImageSource, options?: TextureOptions | null): void {
    this.bind();
    const gl = this.gl;
    if (!image) throw "uploadImage parameter must be Image";

    Texture.setUploadOptions(options, gl);

    try {
      if (options && options.subimage) {
        //upload partially
        if (gl.webgl_version == 1) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.format, this.type, image);
        else
          gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            0,
            0,
            (image as HTMLVideoElement).videoWidth || (image as { width: number }).width,
            (image as HTMLVideoElement).videoHeight || (image as { height: number }).height,
            this.format,
            this.type,
            image
          );
      } else {
        const w = (image as HTMLVideoElement).videoWidth || (image as { width: number }).width;
        const h = (image as HTMLVideoElement).videoHeight || (image as { height: number }).height;
        if ((w != this.width || h != this.height) && this.width != 1 && this.height != 1)
          console.warn("image uploaded has a different size than texture, resizing it.");
        gl.texImage2D(gl.TEXTURE_2D, 0, this.format, this.format, this.type, image);
        this.width = w;
        this.height = h;
      }
      this.data = image;
    } catch (e) {
      console.error(e);
      if (location.protocol == "file:") {
        throw 'image not loaded for security reasons (serve this page over "http://" instead)';
      } else {
        throw (
          "image not loaded for security reasons (image must originate from the same " +
          "domain as this page or use Cross-Origin Resource Sharing)"
        );
      }
    }

    //TODO: add expand transparent pixels option

    //generate mipmaps
    if (this.minFilter && this.minFilter != gl.NEAREST && this.minFilter != gl.LINEAR) {
      gl.generateMipmap(this.texture_type);
      this.has_mipmaps = true;
    }
    gl.bindTexture(this.texture_type, null); //disable
  }

  /**
	* Uploads data to the GPU (data must have the appropiate size)
	* @method uploadData
	* @param {ArrayBuffer} data
	* @param {Object} options [optional] upload options (premultiply_alpha, no_flip, cubemap_face, mipmap_level)
	*/
  uploadData(data: ArrayBufferView, options?: TextureOptions | null, skip_mipmaps?: boolean): void {
    options = options || {};
    if (!data) throw "no data passed";
    const gl = this.gl;
    this.bind();
    Texture.setUploadOptions(options, gl);
    const mipmap_level = options.mipmap_level || 0;
    let width = this.width;
    let height = this.height;
    width = width >> mipmap_level;
    height = height >> mipmap_level;
    const internal_format = this.internalFormat || this.format;

    if (this.type == HALF_FLOAT_OES && data.constructor === Float32Array)
      console.warn(
        "cannot uploadData to a HALF_FLOAT texture from a Float32Array, must be Uint16Array. To upload it we recomment to create a FLOAT texture, upload data there and copy to your HALF_FLOAT."
      );

    if (this.texture_type == TEXTURE_2D) {
      if (gl.webgl_version == 1) {
        if ((data as { buffer?: ArrayBufferLike }).buffer && (data as ArrayBufferView).buffer.constructor == ArrayBuffer)
          gl.texImage2D(this.texture_type, mipmap_level, internal_format, width, height, 0, this.format, this.type, data);
        else
          gl.texImage2D(
            this.texture_type,
            mipmap_level,
            internal_format,
            this.format,
            this.type,
            data as unknown as TexImageSource
          );
      } else if (gl.webgl_version == 2) {
        //webgl forces to use width and height
        if ((data as { buffer?: ArrayBufferLike }).buffer && (data as ArrayBufferView).buffer.constructor == ArrayBuffer)
          gl.texImage2D(this.texture_type, mipmap_level, internal_format, width, height, 0, this.format, this.type, data);
        else
          gl.texImage2D(this.texture_type, mipmap_level, internal_format, width, height, 0, this.format, this.type, data);
      }
    } else if (this.texture_type == TEXTURE_3D) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0); //standard does not allow this flags for 3D textures
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage3D(
        this.texture_type,
        mipmap_level,
        internal_format,
        width,
        height,
        (this.depth as number) >> mipmap_level,
        0,
        this.format,
        this.type,
        data
      );
    } else if (this.texture_type == TEXTURE_CUBE_MAP)
      gl.texImage2D(
        gl.TEXTURE_CUBE_MAP_POSITIVE_X + (options.cubemap_face || 0),
        mipmap_level,
        internal_format,
        width,
        height,
        0,
        this.format,
        this.type,
        data
      );
    else throw "cannot uploadData for this texture type";

    this.data = data; //should I clone it?

    if (!skip_mipmaps && this.minFilter && this.minFilter != gl.NEAREST && this.minFilter != gl.LINEAR) {
      gl.generateMipmap(this.texture_type);
      this.has_mipmaps = true;
    }
    gl.bindTexture(this.texture_type, null); //disable
  }

  /**
	* Render to texture using FBO, just pass the callback to a rendering function and the content of the texture will be updated
	* If the texture is a cubemap, the callback will be called six times, once per face, the number of the face is passed as a second parameter
	* for further info about how to set up the propper cubemap camera, check the GL.Texture.cubemap_camera_parameters with the direction and up vector for every face.
	*
	* Keep in mind that it tries to reuse the last renderbuffer for the depth, and if it cannot (different size) it creates a new one (throwing the old)
	* @method drawTo
	* @param {Function} callback function that does all the rendering inside this texture
	*/
  drawTo(callback: (texture: Texture, a?: unknown, b?: unknown) => void, params?: unknown): this {
    const gl = this.gl;

    //if(this.format == gl.DEPTH_COMPONENT)
    //	throw("cannot use drawTo in depth textures, use Texture.drawToColorAndDepth");

    const v = gl.getViewport();
    const now = getTime();

    const old_fbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;

    const framebuffer = (gl._framebuffer = gl._framebuffer || gl.createFramebuffer());
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

    //this code allows to reuse old renderbuffers instead of creating and destroying them for every frame
    let renderbuffer: PooledRenderbuffer | null = null;

    //generate unique key for this renderbuffer (declared at method scope for inner_check_destroy)
    let key = "";

    if (Texture.use_renderbuffer_pool) {
      //create a renderbuffer pool
      if (!gl._renderbuffers_pool) gl._renderbuffers_pool = {};
      const pool = gl._renderbuffers_pool as unknown as Record<string, PooledRenderbuffer>;
      //generate unique key for this renderbuffer
      key = this.width + ":" + this.height;

      //reuse or create new one
      if (pool[key]) {
        //Reuse old
        renderbuffer = pool[key];
        renderbuffer.time = now;
        gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
      } else {
        //create temporary buffer
        pool[key] = renderbuffer = gl.createRenderbuffer() as PooledRenderbuffer;
        renderbuffer.time = now;
        renderbuffer.width = this.width;
        renderbuffer.height = this.height;
        gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);

        //destroy after one minute
        setTimeout(inner_check_destroy.bind(renderbuffer), 1000 * 60);
      }
    } else {
      renderbuffer = (gl._renderbuffer = gl._renderbuffer || gl.createRenderbuffer()) as PooledRenderbuffer;
      renderbuffer.width = this.width;
      renderbuffer.height = this.height;
      gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
    }

    //bind render buffer for depth or color
    if (this.format === gl.DEPTH_COMPONENT)
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA4, this.width, this.height);
    else gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, this.width, this.height);

    //clears memory from unused buffer
    function inner_check_destroy(this: PooledRenderbuffer): void {
      const pool = gl._renderbuffers_pool as unknown as Record<string, PooledRenderbuffer>;
      if (getTime() - this.time >= 1000 * 60) {
        //console.log("Buffer cleared");
        gl.deleteRenderbuffer(pool[key]);
        delete pool[key];
      } else setTimeout(inner_check_destroy.bind(this), 1000 * 60);
    }

    gl.viewport(0, 0, this.width, this.height);

    //if(gl._current_texture_drawto)
    //	throw("Texture.drawTo: Cannot use drawTo from inside another drawTo");

    gl._current_texture_drawto = this;
    gl._current_fbo_color = framebuffer;
    gl._current_fbo_depth = renderbuffer;

    if (this.texture_type == gl.TEXTURE_2D) {
      if (this.format !== gl.DEPTH_COMPONENT) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.handler, 0);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer);
      } else {
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, renderbuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.handler, 0);
      }
      callback(this, params);
    } else if (this.texture_type == gl.TEXTURE_CUBE_MAP) {
      //bind the fixed ones out of the loop to save calls
      if (this.format !== gl.DEPTH_COMPONENT)
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer);
      else gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, renderbuffer);

      //for every face of the cubemap
      for (let i = 0; i < 6; i++) {
        if (this.format !== gl.DEPTH_COMPONENT)
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, this.handler, 0);
        else
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, this.handler, 0);
        callback(this, i, params);
      }
    }

    this.data = null;

    gl._current_texture_drawto = null;
    gl._current_fbo_color = null;
    gl._current_fbo_depth = null;

    gl.bindFramebuffer(gl.FRAMEBUFFER, old_fbo);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.viewport(v[0], v[1], v[2], v[3]);

    return this;
  }

  /*
	Texture.drawTo = function( color_textures, callback, depth_texture )
	{
		var w = -1,
			h = -1,
			type = null;

		if(!color_textures && !depth_texture)
			throw("Textures missing in drawTo");

		if(color_textures && color_textures.length)
		{
			for(var i = 0; i < color_textures.length; i++)
			{
				var t = color_textures[i];
				if(w == -1)
					w = t.width;
				else if(w != t.width)
					throw("Cannot use Texture.drawTo if textures have different dimensions");
				if(h == -1)
					h = t.height;
				else if(h != t.height)
					throw("Cannot use Texture.drawTo if textures have different dimensions");
				if(type == null) //first one defines the type
					type = t.type;
				else if (type != t.type)
					throw("Cannot use Texture.drawTo if textures have different data type, all must have the same type");
			}
		}
		else
		{
			w = depth_texture.width;
			h = depth_texture.height;
		}

		var ext = gl.extensions["WEBGL_draw_buffers"];
		if(!ext && color_textures && color_textures.length > 1)
			throw("Rendering to several textures not supported");

		var v = gl.getViewport();
		gl._framebuffer =  gl._framebuffer || gl.createFramebuffer();
		gl.bindFramebuffer( gl.FRAMEBUFFER,  gl._framebuffer );

		gl.viewport( 0, 0, w, h );

		var renderbuffer = null;
		if( depth_texture && depth_texture.format !== gl.DEPTH_COMPONENT || depth_texture.type != gl.UNSIGNED_INT )
			throw("Depth texture must be of format: gl.DEPTH_COMPONENT and type: gl.UNSIGNED_INT");

		if( depth_texture )
		{
			gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth_texture.handler, 0);
		}
		else //create a temporary depth renderbuffer
		{
			//create renderbuffer for depth
			renderbuffer = gl._renderbuffer = gl._renderbuffer || gl.createRenderbuffer();
			renderbuffer.width = w;
			renderbuffer.height = h;
			gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer );
			gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);

			gl.framebufferRenderbuffer( gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer );
		}

		if( color_textures )
		{
			var order = []; //draw_buffers request the use of an array with the order of the attachments
			for(var i = 0; i < color_textures.length; i++)
			{
				var t = color_textures[i];
				gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t.handler, 0);
				order.push( gl.COLOR_ATTACHMENT0 + i );
			}

			if(color_textures.length > 1)
				ext.drawBuffersWEBGL( order );
		}
		else //create temporary color render buffer
		{
			var color_renderbuffer = this._color_renderbuffer = this._color_renderbuffer || gl.createRenderbuffer();
			color_renderbuffer.width = w;
			color_renderbuffer.height = h;

			gl.bindRenderbuffer( gl.RENDERBUFFER, color_renderbuffer );
			gl.renderbufferStorage( gl.RENDERBUFFER, gl.RGBA4, w, h );

			gl.framebufferRenderbuffer( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color_renderbuffer );
		}

		var complete = gl.checkFramebufferStatus( gl.FRAMEBUFFER );
		if(complete !== gl.FRAMEBUFFER_COMPLETE)
			throw("FBO not complete: " + complete);

		callback();

		//clear data
		if(color_textures.length)
			for(var i = 0; i < color_textures.length; ++i)
				color_textures[i].data = null;

		gl.bindFramebuffer(gl.FRAMEBUFFER, null);

		gl.viewport(v[0], v[1], v[2], v[3]);
	}

	Texture.drawToColorAndDepth = function( color_texture, depth_texture, callback ) {
		var gl = color_texture.gl; //static function

		if(depth_texture.width != color_texture.width || depth_texture.height != color_texture.height)
			throw("Different size between color texture and depth texture");

		var v = gl.getViewport();

		gl._framebuffer =  gl._framebuffer || gl.createFramebuffer();

		gl.bindFramebuffer( gl.FRAMEBUFFER,  gl._framebuffer);

		gl.viewport(0, 0, color_texture.width, color_texture.height);

		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color_texture.handler, 0);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,  gl.TEXTURE_2D, depth_texture.handler, 0);

		callback();

		color_texture.data = null;
		depth_texture.data = null;

		gl.bindFramebuffer(gl.FRAMEBUFFER, null);

		gl.viewport(v[0], v[1], v[2], v[3]);
	}
	*/

  /**
	* Copy content of one texture into another
	* TODO: check using copyTexImage2D
	* @method copyTo
	* @param {GL.Texture} target_texture
	* @param {GL.Shader} [shader=null] optional shader to apply while copying
	* @param {Object} [uniforms=null] optional uniforms for the shader
	*/
  copyTo(target_texture: Texture, shader?: Shader | null, uniforms?: Record<string, unknown> | null): this {
    const gl = this.gl;
    if (!target_texture) throw "target_texture required";

    //save state
    const previous_fbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const viewport = gl.getViewport();

    if (!shader) shader = this.texture_type == gl.TEXTURE_2D ? Shader.getScreenShader() : Shader.getCubemapCopyShader();

    //render
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    if (shader && uniforms) shader.uniforms(uniforms as Record<string, UniformValue>);

    //reuse fbo
    let fbo = gl.__copy_fbo as unknown as WebGLFramebuffer | null | undefined;
    if (!fbo) {
      fbo = gl.createFramebuffer();
      gl.__copy_fbo = fbo as unknown as import("./fbo").FBO;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo as WebGLFramebuffer);

    gl.viewport(0, 0, target_texture.width, target_texture.height);
    if (this.texture_type == gl.TEXTURE_2D) {
      //regular color texture
      if (this.format !== gl.DEPTH_COMPONENT && this.format !== gl.DEPTH_STENCIL) {
        /* doesnt work
			if( this.width == target_texture.width && this.height == target_texture.height && this.format == target_texture.format)
			{
				gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.handler, 0);
				gl.bindTexture( target_texture.texture_type, target_texture.handler );
				gl.copyTexImage2D( target_texture.texture_type, 0, this.format, 0, 0, target_texture.width, target_texture.height, 0);
			}
			else
			*/
        {
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target_texture.handler, 0);
          this.toViewport(shader);
        }
      } else {
        //copying a depth texture is harder
        const color_renderbuffer = (gl._color_renderbuffer =
          gl._color_renderbuffer || gl.createRenderbuffer()) as PooledRenderbuffer;
        const w = (color_renderbuffer.width = target_texture.width);
        const h = (color_renderbuffer.height = target_texture.height);

        //attach color render buffer
        gl.bindRenderbuffer(gl.RENDERBUFFER, color_renderbuffer);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA4, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color_renderbuffer);

        //attach depth texture
        const attachment_point = target_texture.format == gl.DEPTH_STENCIL ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT;
        gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment_point, gl.TEXTURE_2D, target_texture.handler, 0);

        const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER); //this line is slow according to Mozilla?
        if (complete !== gl.FRAMEBUFFER_COMPLETE) throw "FBO not complete: " + complete;

        //enable depth test?
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.ALWAYS);
        gl.colorMask(false, false, false, false);
        //call shader that overwrites depth values
        shader = Shader.getCopyDepthShader();
        this.toViewport(shader);
        gl.colorMask(true, true, true, true);
        gl.disable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment_point, gl.TEXTURE_2D, null, 0);
      }
    } else if (this.texture_type == gl.TEXTURE_CUBE_MAP) {
      shader.uniforms({ u_texture: 0 });
      const rot_matrix = temp_mat3;
      for (let i = 0; i < 6; i++) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, target_texture.handler, 0);
        const face_info = Texture.cubemap_camera_parameters[i];
        mat3.identity(rot_matrix);
        rot_matrix.set(face_info.right, 0);
        rot_matrix.set(face_info.up, 3);
        rot_matrix.set(face_info.dir, 6);
        //mat3.invert(rot_matrix,rot_matrix);
        this.toViewport(shader, { u_rotation: rot_matrix });
      }
    }

    //restore previous state
    gl.setViewport(viewport); //restore viewport
    gl.bindFramebuffer(gl.FRAMEBUFFER, previous_fbo); //restore fbo

    //generate mipmaps when needed
    if (target_texture.minFilter && target_texture.minFilter != gl.NEAREST && target_texture.minFilter != gl.LINEAR) {
      target_texture.bind();
      gl.generateMipmap(target_texture.texture_type);
      target_texture.has_mipmaps = true;
    }

    target_texture.data = null;
    gl.bindTexture(target_texture.texture_type, null); //disable
    return this;
  }

  /**
	* Similar to CopyTo, but more specific, only for color texture_2D. It doesnt change the blend flag
	* @method blit
	* @param {GL.Texture} target_texture
	* @param {GL.Shader} [shader=null] optional shader to apply while copying
	* @param {Object} [uniforms=null] optional uniforms for the shader
	*/
  blit(target_texture: Texture, shader?: Shader | null, uniforms?: Record<string, unknown> | null): this {
    const gl = this.gl;
    const viewport = blit_viewport;

    if (this.texture_type != gl.TEXTURE_2D || this.format === gl.DEPTH_COMPONENT || this.format === gl.DEPTH_STENCIL)
      throw "blit only support TEXTURE_2D of RGB or RGBA. use copyTo instead";

    //save state
    const previous_fbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    viewport.set(gl.viewport_data);

    shader = shader || Shader.getScreenShader();
    if (shader && uniforms) shader.uniforms(uniforms as Record<string, UniformValue>);

    //reuse fbo
    let fbo = gl.__copy_fbo as unknown as WebGLFramebuffer | null | undefined;
    if (!fbo) {
      fbo = gl.createFramebuffer();
      gl.__copy_fbo = fbo as unknown as import("./fbo").FBO;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo as WebGLFramebuffer);

    gl.viewport(0, 0, target_texture.width, target_texture.height);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target_texture.handler, 0);

    this.bind(0);
    shader.draw(Mesh.getScreenQuad(), gl.TRIANGLES);

    //restore previous state
    gl.setViewport(viewport); //restore viewport
    gl.bindFramebuffer(gl.FRAMEBUFFER, previous_fbo); //restore fbo

    target_texture.data = null;
    gl.bindTexture(target_texture.texture_type, null); //disable
    return this;
  }

  /**
	* Render texture in a quad to full viewport size
	* @method toViewport
	* @param {Shader} shader to apply, otherwise a default textured shader is applied [optional]
	* @param {Object} uniforms for the shader if needed [optional]
	*/
  toViewport(shader?: Shader | null, uniforms?: Record<string, unknown> | null): void {
    shader = shader || Shader.getScreenShader();
    const mesh = Mesh.getScreenQuad();
    this.bind(0);
    //shader.uniforms({u_texture: 0}); //never changes
    if (uniforms) shader.uniforms(uniforms as Record<string, UniformValue>);
    shader.draw(mesh, gl.TRIANGLES);
  }

  /**
	* Fills the texture with a constant color (uses gl.clear) or shader
	* @method fill
	* @param {vec4|GL.Shader} color rgba or shader
	* @param {boolean} skip_mipmaps if true the mipmaps wont be updated
	*/
  fill(color_or_shader: Float32Array | number[] | Shader, skip_mipmaps?: boolean): void {
    if ((color_or_shader as { constructor: unknown }).constructor === Shader) {
      const shader = color_or_shader as Shader;
      this.drawTo(function () {
        shader.toViewport();
      });
    } else {
      const color = color_or_shader as Float32Array | number[];
      const old_color = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
      gl.clearColor(color[0], color[1], color[2], color[3]);
      this.drawTo(function () {
        gl.clear(gl.COLOR_BUFFER_BIT);
      });
      gl.clearColor(old_color[0], old_color[1], old_color[2], old_color[3]);
    }

    if (!skip_mipmaps && this.minFilter && this.minFilter != gl.NEAREST && this.minFilter != gl.LINEAR) {
      this.bind();
      gl.generateMipmap(this.texture_type);
      this.has_mipmaps = true;
    }
  }

  /**
	* Render texture in a quad of specified area
	* @method renderQuad
	* @param {number} x
	* @param {number} y
	* @param {number} width
	* @param {number} height
	*/
  renderQuad(x: number, y: number, w: number, h: number, shader?: Shader | null, uniforms?: Record<string, unknown> | null): void {
    const pos = renderQuad_pos;
    const size = renderQuad_size;
    pos[0] = x;
    pos[1] = y;
    size[0] = w;
    size[1] = h;

    shader = shader || Shader.getQuadShader(this.gl);
    const mesh = Mesh.getScreenQuad(this.gl);
    this.bind(0);
    shader.uniforms({
      u_texture: 0,
      u_position: pos,
      u_color: renderQuad_white,
      u_size: size,
      u_viewport: gl.viewport_data.subarray(2, 4),
      u_transform: renderQuad_identity,
    });
    if (uniforms) shader.uniforms(uniforms as Record<string, UniformValue>);
    shader.draw(mesh, gl.TRIANGLES);
  }

  /**
	* Applies a blur filter of 5x5 pixels to the texture (be careful using it, it is slow)
	* @method applyBlur
	* @param {Number} offsetx scalar that multiplies the offset when fetching pixels horizontally (default 1)
	* @param {Number} offsety scalar that multiplies the offset when fetching pixels vertically (default 1)
	* @param {Number} intensity scalar that multiplies the result (default 1)
	* @param {Texture} output_texture [optional] if not passed the output is the own texture
	* @param {Texture} temp_texture blur needs a temp texture, if not supplied it will use the temporary textures pool
	* @return {Texture} returns the temp_texture in case you want to reuse it
	*/
  applyBlur(
    offsetx: number,
    offsety: number,
    intensity: number,
    output_texture?: Texture,
    temp_texture?: Texture
  ): void {
    const gl = this.gl;
    if (offsetx === undefined) offsetx = 1;
    if (offsety === undefined) offsety = 1;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    output_texture = output_texture || this;
    const is_temp = !temp_texture;

    //if(this === output_texture && this.texture_type === gl.TEXTURE_CUBE_MAP )
    //	throw("cannot use applyBlur in a texture with itself when blurring a CUBE_MAP");
    if (temp_texture === output_texture) throw "cannot use applyBlur in a texture using as temporary itself";

    if (output_texture && this.texture_type !== output_texture.texture_type)
      throw "cannot use applyBlur with textures of different texture_type";

    //if(this.width != output_texture.width || this.height != output_texture.height)
    //	throw("cannot use applyBlur with an output texture of different size, it doesnt work");

    //save state
    const current_fbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const viewport = gl.getViewport();

    //reuse fbo
    let fbo = gl.__copy_fbo as unknown as WebGLFramebuffer | null | undefined;
    if (!fbo) {
      fbo = gl.createFramebuffer();
      gl.__copy_fbo = fbo as unknown as import("./fbo").FBO;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo as WebGLFramebuffer);
    gl.viewport(0, 0, this.width, this.height);

    if (this.texture_type === gl.TEXTURE_2D) {
      const shader = Shader.getBlurShader();

      if (!temp_texture) temp_texture = Texture.getTemporary(this.width, this.height, this);

      //horizontal blur
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, temp_texture.handler, 0);
      this.toViewport(shader, { u_texture: 0, u_intensity: intensity, u_offset: [0, offsety / this.height] });

      //vertical blur
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output_texture.handler, 0);
      gl.viewport(0, 0, output_texture.width, output_texture.height);
      temp_texture.toViewport(shader, { u_intensity: intensity, u_offset: [offsetx / temp_texture.width, 0] });

      if (is_temp) Texture.releaseTemporary(temp_texture);
    } else if (this.texture_type === gl.TEXTURE_CUBE_MAP) {
      //var weights = new Float32Array([ 0.16/0.98, 0.15/0.98, 0.12/0.98, 0.09/0.98, 0.05/0.98 ]);
      //var weights = new Float32Array([ 0.05/0.98, 0.09/0.98, 0.12/0.98, 0.15/0.98, 0.16/0.98, 0.15/0.98, 0.12/0.98, 0.09/0.98, 0.05/0.98, 0.0 ]); //extra 0 to avoid mat3
      const shader = Shader.getCubemapBlurShader();
      shader.uniforms({ u_texture: 0, u_intensity: intensity, u_offset: [offsetx / this.width, offsety / this.height] });
      this.bind(0);
      const mesh = Mesh.getScreenQuad();
      mesh.bindBuffers(shader);
      shader.bind();

      let destination: Texture | null = null;

      if (!temp_texture && output_texture == this) //we need a temporary texture
        destination = temp_texture = Texture.getTemporary(output_texture.width, output_texture.height, output_texture);
      //blur directly to output texture
      else destination = output_texture;

      const rot_matrix = temp_mat3;
      for (let i = 0; i < 6; ++i) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, destination.handler, 0);
        const face_info = Texture.cubemap_camera_parameters[i];
        mat3.identity(rot_matrix);
        rot_matrix.set(face_info.right, 0);
        rot_matrix.set(face_info.up, 3);
        rot_matrix.set(face_info.dir, 6);
        //mat3.invert(rot_matrix,rot_matrix);
        shader._setUniform("u_rotation", rot_matrix);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      mesh.unbindBuffers(shader);

      if (temp_texture) //copy back
        temp_texture.copyTo(output_texture);

      if (temp_texture && is_temp) //release temp
        Texture.releaseTemporary(temp_texture);
    }

    //restore previous state
    gl.setViewport(viewport); //restore viewport
    gl.bindFramebuffer(gl.FRAMEBUFFER, current_fbo); //restore fbo

    output_texture.data = null;

    //generate mipmaps when needed
    if (output_texture.minFilter && output_texture.minFilter != gl.NEAREST && output_texture.minFilter != gl.LINEAR) {
      output_texture.bind();
      gl.generateMipmap(output_texture.texture_type);
      output_texture.has_mipmaps = true;
    }

    gl.bindTexture(output_texture.texture_type, null); //disable
  }

  /**
	* Loads and uploads a texture from a url
	* @method Texture.fromURL
	* @param {String} url
	* @param {Object} options
	* @param {Function} on_complete
	* @return {Texture} the texture
	*/
  static fromURL(
    url: string,
    options?: TextureOptions | null,
    on_complete?: (texture: Texture | null, url?: string) => void,
    gl?: GLContext
  ): Texture {
    gl = gl || globalThis.gl;

    options = options || {};
    options = Object.create(options) as TextureOptions; //creates a new options using the old one as prototype

    let texture = options.texture || new Texture(1, 1, options, gl);

    if (url.length < 64) texture.url = url;
    texture.bind();
    const default_color = options.temp_color || Texture.loading_color;
    //Texture.setUploadOptions(options);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    const temp_color = options.type == gl.FLOAT ? new Float32Array(default_color) : new Uint8Array(default_color);
    gl.texImage2D(gl.TEXTURE_2D, 0, texture.format, texture.width, texture.height, 0, texture.format, texture.type, temp_color);
    gl.bindTexture(texture.texture_type, null); //disable
    texture.ready = false;

    let ext: string | null = null;
    if (options.extension) //to force format
      ext = options.extension;

    if (!ext && url.length < 512) {
      //avoid base64 urls
      let base = url;
      let pos = url.indexOf("?");
      if (pos != -1) base = url.substr(0, pos);
      pos = base.lastIndexOf(".");
      if (pos != -1) ext = base.substr(pos + 1).toLowerCase();
    }

    if (ext == "dds") {
      const s3tc_ext: unknown =
        gl.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc") || gl.getExtension("WEBGL_compressed_texture_s3tc");
      const new_texture = new Texture(0, 0, options, gl);
      if (DDS)
        DDS.loadDDSTextureEx(gl as unknown as WebGLRenderingContext, s3tc_ext, url, new_texture.handler, true, function (t: WebGLTexture) {
          texture.texture_type = (t as unknown as { texture_type: number }).texture_type;
          texture.handler = t;
          delete texture.ready; //texture.ready = true;
          if (on_complete) on_complete(texture, url);
        });
    } else if (ext == "tga") {
      HttpRequest(
        url,
        null,
        function (data: ArrayBuffer) {
          const img_data = Texture.parseTGA(data);
          if (!img_data) return;
          options!.texture = texture;
          if (img_data.flipY) options!.no_flip = true;
          if (img_data.format == "RGB") texture.format = gl!.RGB;
          texture = Texture.fromMemory(img_data.width, img_data.height, img_data.pixels, options!);
          delete texture.ready; //texture.ready = true;
          if (on_complete) on_complete(texture, url);
        },
        null,
        { binary: true }
      );
    } else {
      //png,jpg,webp,...
      const image = new Image();
      image.src = url;
      image.crossOrigin = Texture.CROSS_ORIGIN_CREDENTIALS; //to please the CORS gods
      image.onload = function () {
        options!.texture = texture;
        Texture.fromImage(image, options);
        delete texture.ready; //texture.ready = true;
        if (on_complete) on_complete(texture, url);
      };
      image.onerror = function () {
        if (on_complete) on_complete(null);
      };
    }

    return texture;
  }

  static parseTGA(data: ArrayBuffer): TGAImage | null {
    if (!data || data.constructor !== ArrayBuffer) throw "TGA: data must be ArrayBuffer";
    const bytes = new Uint8Array(data);
    const TGAheader = new Uint8Array([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const TGAcompare = bytes.subarray(0, 12);
    for (let i = 0; i < TGAcompare.length; i++)
      if (TGAheader[i] != TGAcompare[i]) {
        console.error("TGA header is not valid");
        return null; //not a TGA
      }

    const header = bytes.subarray(12, 18);
    const width = header[1] * 256 + header[0];
    const height = header[3] * 256 + header[2];
    const bpp = header[4];
    const bytesPerPixel = bpp / 8;
    const imageSize = width * height * bytesPerPixel;
    const pixels = new Uint8Array(bytes.subarray(18, 18 + imageSize)); //clone
    const flipY = (header[5] & (1 << 5)) == 0; //needs swap in Y
    //TGA comes in BGR format so we swap it, this is slooooow
    for (let i = 0; i < imageSize; i += bytesPerPixel) {
      const temp = pixels[i];
      pixels[i] = pixels[i + 2];
      pixels[i + 2] = temp;
    }
    const img: TGAImage = {
      width: width,
      height: height,
      bpp: bpp,
      bytesPerPixel: bytesPerPixel,
      imageSize: imageSize,
      pixels: pixels,
      flipY: flipY,
      format: bpp == 32 ? "RGBA" : "RGB",
    };
    return img;
  }

  /**
	* Create a texture from an Image
	* @method Texture.fromImage
	* @param {Image} image
	* @param {Object} options
	* @return {Texture} the texture
	*/
  static fromImage(image: TextureImageSource, options?: TextureOptions | null): Texture {
    options = options || {};

    const texture = options.texture || new Texture((image as { width: number }).width, (image as { height: number }).height, options);
    texture.uploadImage(image, options); //options could have a prototype

    texture.bind();
    gl.texParameteri(texture.texture_type, gl.TEXTURE_MAG_FILTER, texture.magFilter || Texture.DEFAULT_MAG_FILTER);
    gl.texParameteri(texture.texture_type, gl.TEXTURE_MIN_FILTER, texture.minFilter || Texture.DEFAULT_MIN_FILTER);
    gl.texParameteri(texture.texture_type, gl.TEXTURE_WRAP_S, texture.wrapS || Texture.DEFAULT_WRAP_S);
    gl.texParameteri(texture.texture_type, gl.TEXTURE_WRAP_T, texture.wrapT || Texture.DEFAULT_WRAP_T);

    if ((isPowerOfTwo(texture.width) && isPowerOfTwo(texture.height)) || gl.webgl_version > 1) {
      if (options.minFilter && options.minFilter != gl.NEAREST && options.minFilter != gl.LINEAR) {
        texture.bind();
        gl.generateMipmap(texture.texture_type);
        texture.has_mipmaps = true;
      }
    } else {
      //no mipmaps supported
      gl.texParameteri(texture.texture_type, gl.TEXTURE_MIN_FILTER, LINEAR);
      //gl.texParameteri(texture.texture_type, gl.TEXTURE_MAG_FILTER, GL.LINEAR );
      gl.texParameteri(texture.texture_type, gl.TEXTURE_WRAP_S, CLAMP_TO_EDGE);
      gl.texParameteri(texture.texture_type, gl.TEXTURE_WRAP_T, CLAMP_TO_EDGE);
      texture.has_mipmaps = false;
    }
    gl.bindTexture(texture.texture_type, null); //disable
    texture.data = image;
    if (options.keep_image) texture.img = image;
    return texture;
  }

  /**
	* Create a texture from a Video
	* @method Texture.fromVideo
	* @param {Video} video
	* @param {Object} options
	* @return {Texture} the texture
	*/
  static fromVideo(video: HTMLVideoElement, options?: TextureOptions | null): Texture {
    options = options || {};

    const texture = options.texture || new Texture(video.videoWidth, video.videoHeight, options);
    texture.bind();
    texture.uploadImage(video, options);
    if (options.minFilter && options.minFilter != gl.NEAREST && options.minFilter != gl.LINEAR) {
      texture.bind();
      gl.generateMipmap(texture.texture_type);
      texture.has_mipmaps = true;
      texture.data = video;
    }
    gl.bindTexture(texture.texture_type, null); //disable
    return texture;
  }

  /**
	* Create a clone of a texture
	* @method Texture.fromTexture
	* @param {Texture} old_texture
	* @param {Object} options
	* @return {Texture} the texture
	*/
  static fromTexture(old_texture: Texture, options?: TextureOptions | null): Texture {
    options = options || {};
    const texture = new Texture(old_texture.width, old_texture.height, options);
    old_texture.copyTo(texture);
    return texture;
  }

  clone(options?: TextureOptions | null): Texture {
    const old_options = this.getProperties() as unknown as Record<string, unknown>;
    if (options) {
      const src = options as unknown as Record<string, unknown>;
      for (const i in src) old_options[i] = src[i];
    }
    return Texture.fromTexture(this, old_options as unknown as TextureOptions);
  }

  /**
	* Create a texture from an ArrayBuffer containing the pixels
	* @method Texture.fromMemory
	* @param {number} width
	* @param {number} height
	* @param {ArrayBuffer} pixels
	* @param {Object} options
	* @return {Texture} the texture
	*/
  static fromMemory(
    width: number,
    height: number,
    pixels: ArrayBufferView | number[],
    options?: TextureOptions | null
  ): Texture {
    //format in options as format
    options = options || {};

    const texture = options.texture || new Texture(width, height, options);
    Texture.setUploadOptions(options);
    texture.bind();

    if ((pixels as { constructor: unknown }).constructor === Array) {
      if (options.type == gl.FLOAT) pixels = new Float32Array(pixels as number[]);
      else if (options.type == HALF_FLOAT || options.type == HALF_FLOAT_OES)
        pixels = new Uint16Array(pixels as number[]); //gl.UNSIGNED_SHORT_4_4_4_4 is only for texture that are SHORT per pixel, not per channel!
      else pixels = new Uint8Array(pixels as number[]);
    }

    gl.texImage2D(gl.TEXTURE_2D, 0, texture.format, width, height, 0, texture.format, texture.type, pixels as ArrayBufferView);
    texture.width = width;
    texture.height = height;
    texture.data = pixels as ArrayBufferView;
    if (options.minFilter && options.minFilter != gl.NEAREST && options.minFilter != gl.LINEAR) {
      gl.generateMipmap(gl.TEXTURE_2D);
      texture.has_mipmaps = true;
    }
    gl.bindTexture(texture.texture_type, null); //disable
    return texture;
  }

  /**
	* Create a texture from an ArrayBuffer containing the pixels
	* @method Texture.fromDDSInMemory
	* @param {ArrayBuffer} DDS data
	* @param {Object} options
	* @return {Texture} the texture
	*/
  static fromDDSInMemory(data: ArrayBuffer, options?: TextureOptions | null): Texture {
    //format in options as format
    options = options || {};

    const texture = options.texture || new Texture(0, 0, options);
    Texture.setUploadOptions(options);
    texture.bind();

    const ext: unknown =
      gl.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc") || gl.getExtension("WEBGL_compressed_texture_s3tc");
    if (DDS)
      DDS.loadDDSTextureFromMemoryEx(gl as unknown as WebGLRenderingContext, ext, data, texture as unknown as WebGLTexture, true);

    gl.bindTexture(texture.texture_type, null); //disable
    return texture;
  }

  /**
	* Create a generative texture from a shader ( must GL.Shader.getScreenShader as reference for the shader )
	* @method Texture.fromShader
	* @param {number} width
	* @param {number} height
	* @param {Shader} shader
	* @param {Object} options
	* @return {Texture} the texture
	*/
  static fromShader(width: number, height: number, shader: Shader, options?: TextureOptions | null): Texture {
    options = options || {};

    const texture = new Texture(width, height, options);
    //copy content
    texture.drawTo(function () {
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      const mesh = Mesh.getScreenQuad();
      shader.draw(mesh);
    });

    return texture;
  }

  /**
	* Create a cubemap texture from a set of 6 images
	* @method Texture.cubemapFromImages
	* @param {Array} images
	* @param {Object} options
	* @return {Texture} the texture
	*/
  static cubemapFromImages(images: TextureImageSource[], options?: TextureOptions | null): Texture {
    options = options || {};
    if (images.length != 6) throw "missing images to create cubemap";

    const width = (images[0] as { width: number }).width;
    const height = (images[0] as { height: number }).height;
    options.texture_type = gl.TEXTURE_CUBE_MAP;

    let texture: Texture;

    if (options.texture) {
      texture = options.texture;
      texture.width = width;
      texture.height = height;
    } else texture = new Texture(width, height, options);

    Texture.setUploadOptions(options);
    texture.bind();

    try {
      for (let i = 0; i < 6; i++)
        gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, texture.format, texture.format, texture.type, images[i]);
      texture.data = images;
    } catch (e) {
      if (location.protocol == "file:") {
        throw 'image not loaded for security reasons (serve this page over "http://" instead)';
      } else {
        throw (
          "image not loaded for security reasons (image must originate from the same " +
          "domain as this page or use Cross-Origin Resource Sharing)"
        );
      }
    }
    if (options.minFilter && options.minFilter != gl.NEAREST && options.minFilter != gl.LINEAR) {
      gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
      texture.has_mipmaps = true;
    }

    texture.unbind();
    return texture;
  }

  /**
	* Create a cubemap texture from a single image that contains all six images
	* If it is a cross, it must be horizontally aligned, and options.is_cross must be equal to the column where the top and bottom are located (usually 1 or 2)
	* otherwise it assumes the 6 images are arranged vertically, in the order of OpenGL: +X, -X, +Y, -Y, +Z, -Z
	* @method Texture.cubemapFromImage
	* @param {Image} image
	* @param {Object} options
	* @return {Texture} the texture
	*/
  static cubemapFromImage(image: HTMLImageElement, options?: TextureOptions | null): Texture | null {
    options = options || {};

    if (image.width != image.height / 6 && image.height % 6 != 0 && !options.faces && !options.is_polar) {
      console.error("Cubemap image not valid, only 1x6 (vertical) or 6x3 (cross) formats. Check size:", image.width, image.height);
      return null;
    }

    let width = image.width;
    let height = image.height;

    if (options.is_polar) {
      const size = options.size || nearestPowerOfTwo(image.height);
      const temp_tex = Texture.fromImage(image, { ignore_pot: true, wrap: gl.REPEAT, filter: gl.LINEAR });
      let cubemap = new Texture(size, size, { texture_type: gl.TEXTURE_CUBE_MAP, format: gl.RGBA });
      if (options.texture) {
        const old_tex = options.texture;
        const src = cubemap as unknown as Record<string, unknown>;
        const dst = old_tex as unknown as Record<string, unknown>;
        for (const i in src) dst[i] = src[i];
        cubemap = old_tex;
      }
      const rot_matrix = mat3.create();
      const uniforms = { u_texture: 0, u_rotation: rot_matrix };
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      const shader = Shader.getPolarToCubemapShader();
      cubemap.drawTo(function (t: Texture, i?: unknown) {
        const face_info = Texture.cubemap_camera_parameters[i as number];
        mat3.identity(rot_matrix);
        rot_matrix.set(face_info.right, 0);
        rot_matrix.set(face_info.up, 3);
        rot_matrix.set(face_info.dir, 6);
        temp_tex.toViewport(shader, uniforms);
      });
      if (options.keep_image) cubemap.img = image;
      return cubemap;
    } else if (options.is_cross !== undefined) {
      options.faces = Texture.generateCubemapCrossFacesInfo(image.width, options.is_cross);
      width = height = image.width / 4;
    } else if (options.faces) {
      width = options.width || options.faces[0].width;
      height = options.height || options.faces[0].height;
    } else height /= 6;

    if (width != height) {
      console.log("Texture not valid, width and height for every face must be square");
      return null;
    }

    const size = width;
    options.no_flip = true;

    const images: HTMLCanvasElement[] = [];
    for (let i = 0; i < 6; i++) {
      const canvas = createCanvas(size, size);
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      if (options.faces)
        ctx.drawImage(
          image,
          options.faces[i].x,
          options.faces[i].y,
          options.faces[i].width || size,
          options.faces[i].height || size,
          0,
          0,
          size,
          size
        );
      else ctx.drawImage(image, 0, height * i, width, height, 0, 0, size, size);
      images.push(canvas);
      //document.body.appendChild(canvas); //debug
    }

    const texture = Texture.cubemapFromImages(images, options);
    if (options.keep_image) texture.img = image;
    return texture;
  }

  /**
	* Given the width and the height of an image, and in which column is the top and bottom sides of the cubemap, it gets the info to pass to Texture.cubemapFromImage in options.faces
	* @method Texture.generateCubemapCrossFaces
	* @param {number} width of the CROSS image (not the side image)
	* @param {number} column the column where the top and the bottom is located
	* @return {Object} object to pass to Texture.cubemapFromImage in options.faces
	*/
  static generateCubemapCrossFacesInfo(width: number, column?: number): CubemapFaceInfo[] {
    if (column === undefined) column = 1;
    const s = width / 4;

    return [
      { x: 2 * s, y: s, width: s, height: s }, //+x
      { x: 0, y: s, width: s, height: s }, //-x
      { x: column * s, y: 0, width: s, height: s }, //+y
      { x: column * s, y: 2 * s, width: s, height: s }, //-y
      { x: s, y: s, width: s, height: s }, //+z
      { x: 3 * s, y: s, width: s, height: s }, //-z
    ];
  }

  /**
	* Create a cubemap texture from a single image url that contains the six images
	* if it is a cross, it must be horizontally aligned, and options.is_cross must be equal to the column where the top and bottom are located (usually 1 or 2)
	* otherwise it assumes the 6 images are arranged vertically.
	* @method Texture.cubemapFromURL
	* @param {Image} image
	* @param {Object} options
	* @param {Function} on_complete callback
	* @return {Texture} the texture
	*/
  static cubemapFromURL(
    url: string,
    options?: TextureOptions | null,
    on_complete?: (texture: Texture | null) => void
  ): Texture {
    options = options || {};
    options = Object.create(options) as TextureOptions; //creates a new options using the old one as prototype
    options.texture_type = gl.TEXTURE_CUBE_MAP;
    let texture: Texture | null = options.texture || new Texture(1, 1, options);

    texture.bind();
    Texture.setUploadOptions(options);
    const default_color = options.temp_color || [0, 0, 0, 255];
    const temp_color = options.type == gl.FLOAT ? new Float32Array(default_color) : new Uint8Array(default_color);

    for (let i = 0; i < 6; i++)
      gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, texture.format, 1, 1, 0, texture.format, texture.type, temp_color);
    gl.bindTexture(texture.texture_type, null); //disable
    texture.ready = false;

    const image = new Image();
    image.src = url;
    image.onload = function () {
      options!.texture = texture!;
      texture = Texture.cubemapFromImage(image, options);
      if (texture) delete texture.ready; //texture.ready = true;
      if (on_complete) on_complete(texture);
    };

    return texture;
  }

  /**
	* returns an ArrayBuffer with the pixels in the texture, they are fliped in Y
	* Warn: If cubemap it only returns the pixels of the first face! use getCubemapPixels instead
	* @method getPixels
	* @param {number} cubemap_face [optional] the index of the cubemap face to read (ignore if texture_2D)
	* @param {number} mipmap level [optional, default is 0]
	* @return {ArrayBuffer} the data ( Uint8Array, Uint16Array or Float32Array )
	*/
  getPixels(cubemap_face?: number, mipmap_level?: number): Uint8Array | Uint16Array | Float32Array {
    mipmap_level = mipmap_level || 0;
    const gl = this.gl;
    const v = gl.getViewport();
    const old_fbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;

    if (this.format == gl.DEPTH_COMPONENT) throw "cannot use getPixels in depth textures";

    gl.disable(gl.DEPTH_TEST);

    //reuse fbo
    let fbo = gl.__copy_fbo as unknown as WebGLFramebuffer | null | undefined;
    if (!fbo) {
      fbo = gl.createFramebuffer();
      gl.__copy_fbo = fbo as unknown as import("./fbo").FBO;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo as WebGLFramebuffer);

    let buffer: Uint8Array | Uint16Array | Float32Array;

    const width = this.width >> mipmap_level;
    const height = this.height >> mipmap_level;
    gl.viewport(0, 0, width, height);

    if (this.texture_type == gl.TEXTURE_2D)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.handler, mipmap_level);
    else if (this.texture_type == gl.TEXTURE_CUBE_MAP)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + (cubemap_face || 0), this.handler, mipmap_level);

    let channels = this.format == gl.RGB ? 3 : 4;
    channels = 4; //WEBGL DOES NOT SUPPORT READING 3 CHANNELS ONLY, YET...
    const type = this.type;
    //type = gl.UNSIGNED_BYTE; //WEBGL DOES NOT SUPPORT READING FLOAT seems, YET... 23/5/18 now it seems it does now

    if (type == gl.UNSIGNED_BYTE) buffer = new Uint8Array(width * height * channels);
    else if (type == HALF_FLOAT || type == HALF_FLOAT_OES) //previously half float couldnot be read
      buffer = new Uint16Array(width * height * channels); //gl.UNSIGNED_SHORT_4_4_4_4 is only for texture that are SHORT per pixel, not per channel!
    else buffer = new Float32Array(width * height * channels);

    gl.readPixels(0, 0, width, height, channels == 3 ? gl.RGB : gl.RGBA, type, buffer); //NOT SUPPORTED FLOAT or RGB BY WEBGL YET

    //restore
    gl.bindFramebuffer(gl.FRAMEBUFFER, old_fbo);
    gl.viewport(v[0], v[1], v[2], v[3]);
    return buffer;
  }

  /**
	* uploads some pixels to the texture (see uploadData method for more options)
	* @method setPixels
	* @param {ArrayBuffer} data gl.UNSIGNED_BYTE or gl.FLOAT data
	* @param {Boolean} no_flip do not flip in Y
	* @param {Boolean} skip_mipmaps do not update mipmaps when possible
	* @param {Number} cubemap_face if the texture is a cubemap, which face
	*/
  setPixels(data: ArrayBufferView, no_flip?: boolean, skip_mipmaps?: boolean, cubemap_face?: number): void {
    const options: TextureOptions = { no_flip: no_flip };
    if (cubemap_face) options.cubemap_face = cubemap_face;
    this.uploadData(data, options, skip_mipmaps);
  }

  /**
	* returns an array with six arrays containing the pixels of every cubemap face
	* @method getCubemapPixels
	* @return {Array} the array that has 6 typed arrays containing the pixels
	*/
  getCubemapPixels(): Array<Uint8Array | Uint16Array | Float32Array> {
    if (this.texture_type !== gl.TEXTURE_CUBE_MAP) throw "this texture is not a cubemap";
    return [
      this.getPixels(0),
      this.getPixels(1),
      this.getPixels(2),
      this.getPixels(3),
      this.getPixels(4),
      this.getPixels(5),
    ];
  }

  /**
	* fills a cubemap given an array with typed arrays containing the pixels of 6 faces
	* @method setCubemapPixels
	* @param {Array} data array that has 6 typed arrays containing the pixels
	* @param {bool} noflip if pixels should not be flipped according to Y
	*/
  setCubemapPixels(data_array: ArrayBufferView[], no_flip?: boolean): void {
    if (this.texture_type !== gl.TEXTURE_CUBE_MAP)
      throw "this texture is not a cubemap, it should be created with { texture_type: gl.TEXTURE_CUBE_MAP }";
    for (let i = 0; i < 6; ++i) this.setPixels(data_array[i], no_flip, i != 5, i);
  }

  /**
	* Copy texture content to a canvas
	* @method toCanvas
	* @param {Canvas} canvas must have the same size, if different the canvas will be resized
	* @param {boolean} flip_y optional, flip vertically
	* @param {Number} max_size optional, if it is supplied the canvas wont be bigger of max_size (the image will be scaled down)
	*/
  toCanvas(canvas?: HTMLCanvasElement | null, flip_y?: boolean, max_size?: number): HTMLCanvasElement {
    max_size = max_size || 8192;
    const gl = this.gl;

    let w = Math.min(this.width, max_size);
    let h = Math.min(this.height, max_size);

    //cross
    if (this.texture_type == gl.TEXTURE_CUBE_MAP) {
      w = w * 4;
      h = h * 3;
    }

    canvas = canvas || createCanvas(w, h);
    if (canvas.width != w) canvas.width = w;
    if (canvas.height != h) canvas.height = h;

    let buffer: Uint8Array | Uint16Array | Float32Array | null = null;
    if (this.texture_type == gl.TEXTURE_2D) {
      if (this.width != w || this.height != h || this.type != gl.UNSIGNED_BYTE) {
        //resize image to fit the canvas
        //create a temporary texture
        const temp = new Texture(w, h, { format: gl.RGBA, filter: gl.NEAREST });
        this.copyTo(temp);
        buffer = temp.getPixels();
      } else buffer = this.getPixels();

      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      const pixels = ctx.getImageData(0, 0, w, h);
      pixels.data.set(buffer);
      ctx.putImageData(pixels, 0, 0);

      if (flip_y) {
        const temp = createCanvas(w, h);
        const temp_ctx = temp.getContext("2d") as CanvasRenderingContext2D;
        temp_ctx.translate(0, temp.height);
        temp_ctx.scale(1, -1);
        temp_ctx.drawImage(canvas, 0, 0, temp.width, temp.height);
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.drawImage(temp, 0, 0);
      }
    } else if (this.texture_type == gl.TEXTURE_CUBE_MAP) {
      const temp_canvas = createCanvas(this.width, this.height);
      const temp_ctx = temp_canvas.getContext("2d") as CanvasRenderingContext2D;
      const info = Texture.generateCubemapCrossFacesInfo(canvas.width, 1);
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let cubemap: Texture = this;
      if (this.type != gl.UNSIGNED_BYTE) {
        //convert pixels to uint8 as it is the only supported format by the canvas
        //create a temporary texture
        cubemap = new Texture(this.width, this.height, {
          format: gl.RGBA,
          texture_type: gl.TEXTURE_CUBE_MAP,
          filter: gl.NEAREST,
          type: gl.UNSIGNED_BYTE,
        });
        this.copyTo(cubemap);
      }

      for (let i = 0; i < 6; i++) {
        const pixels = temp_ctx.getImageData(0, 0, temp_canvas.width, temp_canvas.height);
        buffer = cubemap.getPixels(i);
        pixels.data.set(buffer);
        temp_ctx.putImageData(pixels, 0, 0);
        ctx.drawImage(temp_canvas, info[i].x, info[i].y, temp_canvas.width, temp_canvas.height);
      }
    }

    return canvas;
  }

  /**
	* returns the texture file in binary format
	* @method toBinary
	* @param {Boolean} flip_y
	* @return {ArrayBuffer} the arraybuffer of the file containing the image
	*/
  toBinary(flip_y?: boolean, type?: string): Uint8Array {
    //dump to canvas
    const canvas = this.toCanvas(null, flip_y);
    //use the slow method (because its sync)
    const data = canvas.toDataURL(type);
    const index = data.indexOf(",");
    const base64_data = data.substr(index + 1);
    const binStr = atob(base64_data);
    const len = binStr.length,
      arr = new Uint8Array(len);
    for (let i = 0; i < len; ++i) {
      arr[i] = binStr.charCodeAt(i);
    }
    return arr;
  }

  /**
	* returns a Blob containing all the data from the texture
	* @method toBlob
	* @return {Blob} the blob containing the data
	*/
  toBlob(flip_y?: boolean, type?: string): Blob {
    const arr = this.toBinary(flip_y);
    const blob = new Blob([arr as BlobPart], { type: type || "image/png" });
    return blob;
  }

  //faster depending on the browser
  toBlobAsync(flip_y?: boolean, type?: string, callback?: (blob: Blob | null) => void): void {
    //dump to canvas
    const canvas = this.toCanvas(null, flip_y);

    //some browser support a fast way to blob a canvas
    if (canvas.toBlob) {
      canvas.toBlob(callback || (() => {}), type);
      return;
    }

    //use the slow method
    const blob = this.toBlob(flip_y, type);
    if (callback) callback(blob);
  }

  /**
	* returns a base64 String containing all the data from the texture
	* @method toBase64
	* @param {boolean} flip_y if you want to flip vertically the image, WebGL saves the images upside down
	* @return {String} the data in base64 format
	*/
  toBase64(flip_y?: boolean): string {
    const w = this.width;
    const h = this.height;

    //Read pixels form WebGL
    const buffer = this.getPixels();

    //dump to canvas so we can encode it
    let canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const pixels = ctx.getImageData(0, 0, w, h);
    pixels.data.set(buffer);
    ctx.putImageData(pixels, 0, 0);

    if (flip_y) {
      const temp_canvas = createCanvas(w, h);
      const temp_ctx = temp_canvas.getContext("2d") as CanvasRenderingContext2D;
      temp_ctx.translate(0, h);
      temp_ctx.scale(1, -1);
      temp_ctx.drawImage(canvas, 0, 0);
      canvas = temp_canvas;
    }

    //create an image
    const img = canvas.toDataURL("image/png"); //base64 string
    return img;
  }

  /**
	* generates some basic metadata about the image
	* @method generateMetadata
	* @return {Object}
	*/
  generateMetadata(): void {
    const metadata = { width: this.width, height: this.height };
    this.metadata = metadata;
  }

  static compareFormats(a?: TextureFormatLike | null, b?: TextureFormatLike | null): boolean {
    if (!a || !b) return false;
    if (a == b) return true;

    if (
      a.width != b.width ||
      a.height != b.height ||
      a.type != b.type || //gl.UNSIGNED_BYTE
      a.format != b.format || //gl.RGB
      a.texture_type != b.texture_type
    )
      //gl.TEXTURE_2D
      return false;
    return true;
  }

  /**
	* blends texture A and B and stores the result in OUT
	* @method blend
	* @param {Texture} a
	* @param {Texture} b
	* @param {Texture} out [optional]
	* @return {Object}
	*/
  static blend(a: Texture, b: Texture, factor: number, out?: Texture): boolean {
    if (!a || !b) return false;
    if (a == b) {
      if (out) a.copyTo(out);
      else a.toViewport();
      return true;
    }

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    const shader = Shader.getBlendShader();
    const mesh = Mesh.getScreenQuad();
    b.bind(1);
    shader.uniforms({ u_texture: 0, u_texture2: 1, u_factor: factor });

    if (out) {
      out.drawTo(function () {
        if (a == out || b == out) throw "Blend output cannot be the same as the input";
        a.bind(0);
        shader.draw(mesh, gl.TRIANGLES);
      });
      return true;
    }

    a.bind(0);
    shader.draw(mesh, gl.TRIANGLES);
    return true;
  }

  static cubemapToTexture2D(
    cubemap_texture: Texture,
    size?: number,
    target_texture?: Texture,
    keep_type?: boolean,
    yaw?: number
  ): Texture {
    if (!cubemap_texture || cubemap_texture.texture_type != gl.TEXTURE_CUBE_MAP) throw "No cubemap in convert";

    size = size || cubemap_texture.width;
    const type = keep_type ? cubemap_texture.type : gl.UNSIGNED_BYTE;
    yaw = yaw || 0;
    if (!target_texture) target_texture = new Texture(size * 2, size, { minFilter: gl.NEAREST, type: type });
    let shader = gl.shaders["cubemap_to_texture2D"];
    if (!shader) {
      shader = gl.shaders["cubemap_to_texture2D"] = new Shader(
        Shader.SCREEN_VERTEX_SHADER,
        "\
		precision mediump float;\n\
		#define PI 3.14159265358979323846264\n\
		uniform samplerCube texture;\
		varying vec2 v_coord;\
		uniform float u_yaw;\n\
		void main() {\
			float alpha = ((1.0 - v_coord.x) * 2.0) * PI + u_yaw;\
			float beta = (v_coord.y * 2.0 - 1.0) * PI * 0.5;\
			vec3 N = vec3( -cos(alpha) * cos(beta), sin(beta), sin(alpha) * cos(beta) );\
			gl_FragColor = textureCube(texture,N);\
		}"
      );
    }
    shader.setUniform("u_yaw", yaw);
    target_texture.drawTo(function () {
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      cubemap_texture.toViewport(shader);
    });
    return target_texture;
  }

  /**
	* returns a white texture of 1x1 pixel
	* @method Texture.getWhiteTexture
	* @return {Texture} the white texture
	*/
  static getWhiteTexture(gl?: GLContext): Texture {
    gl = gl || globalThis.gl;
    const tex = gl.textures[":white"];
    if (tex) return tex;

    const color = new Uint8Array([255, 255, 255, 255]);
    return (gl.textures[":white"] = new Texture(1, 1, { pixel_data: color }));
  }

  /**
	* returns a black texture of 1x1 pixel
	* @method Texture.getBlackTexture
	* @return {Texture} the black texture
	*/
  static getBlackTexture(gl?: GLContext): Texture {
    gl = gl || globalThis.gl;
    const tex = gl.textures[":black"];
    if (tex) return tex;
    const color = new Uint8Array([0, 0, 0, 255]);
    return (gl.textures[":black"] = new Texture(1, 1, { pixel_data: color }));
  }

  /**
	* Returns a texture from the texture pool, if none matches the specifications it creates one
	* @method Texture.getTemporary
	* @param {Number} width the texture width
	* @param {Number} height the texture height
	* @param {Object|Texture} options to specifiy texture_type,type,format, it can be an object or another texture
	* @param {WebGLContext} gl [optional]
	* @return {Texture} the textures that matches this settings
	*/
  static getTemporary(width: number, height: number, options?: TextureOptions | Texture | null, gl?: GLContext): Texture {
    gl = gl || globalThis.gl;

    if (!gl._texture_pool) gl._texture_pool = [];

    let texture_type = TEXTURE_2D;
    let type = Texture.DEFAULT_TYPE;
    let format = Texture.DEFAULT_FORMAT;

    if (options) {
      if (options.texture_type) texture_type = options.texture_type;
      if (options.type) type = options.type;
      if (options.format) format = options.format;
    }

    //var key = (type&0xFFFF) + ((width&0xFFFF)<<16) + ((height&0xFFFF)<<32); // 64bits key: 0x0000 type width height WRONG
    const key = texture_type + ":" + type + ":" + width + "x" + height + ":" + format;

    //iterate
    const pool = gl._texture_pool;
    for (let i = 0; i < pool.length; ++i) {
      const tex = pool[i];
      if (tex._key != key) //|| tex.texture_type != texture_type || tex.format != format )
        continue;
      //remove from the pool
      pool.splice(i, 1);
      tex._pool = 0;
      return tex; //return
    }

    //not found, create it
    const tex = new Texture(width, height, { type: type, texture_type: texture_type, format: format, filter: gl.LINEAR });
    tex._key = key;
    tex._pool = 0;
    return tex;
  }

  /**
	* Given a texture it adds it to the texture pool so it can be reused in the future
	* @method Texture.releaseTemporary
	* @param {GL.Texture} tex
	* @param {WebGLContext} gl [optional]
	*/
  static releaseTemporary(tex: Texture, gl?: GLContext): void {
    gl = gl || globalThis.gl;

    if (!gl._texture_pool) gl._texture_pool = [];

    //if pool is greater than zero means this texture is already inside
    if ((tex._pool ?? 0) > 0) console.warn("this texture is already in the textures pool");

    let pool = gl._texture_pool;
    if (!pool) pool = gl._texture_pool = [];
    tex._pool = getTime();
    pool.push(tex);

    //do not store too much textures in the textures pool
    if (pool.length > 20) {
      pool.sort(function (a, b) {
        return (b._pool ?? 0) - (a._pool ?? 0);
      }); //sort by time
      //pool.sort( function(a,b) { return a._key - b._key } ); //sort by size
      const last = pool.pop() as Texture; //free the last one
      last._pool = 0;
      last.delete();
    }
  }

  //returns the next power of two bigger than size
  static nextPOT(size: number): number {
    return Math.pow(2, Math.ceil(Math.log(size) / Math.log(2)));
  }
}
