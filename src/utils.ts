// Miscellaneous helpers ported from utils.js.
//
// Pure ESM: every symbol the original attached to `global.`/`GL.` is a named export with its original
// name (index.ts re-attaches them to the GL namespace and to window). glMatrix globals (vec3, ...) and
// LEvent are ambient globals referenced directly, never imported. Prototype/built-in extensions are
// kept as runtime side effects; their types live in globals.d.ts.

import { LEvent } from "./levent";

export const DEG2RAD = 0.0174532925;
export const RAD2DEG = 57.295779578552306;
export const EPSILON = 0.000001;

/**
* Tells if one number is power of two (used for textures)
* @method isPowerOfTwo
* @param {v} number
* @return {boolean}
*/
export function isPowerOfTwo(v: number): boolean {
	return ((Math.log(v) / Math.log(2)) % 1) == 0;
}

/**
* Tells you the closest POT size (it rounds, so 257 will give 256, while 511 will give 512)
* @method nearestPowerOfTwo
* @param {v} number
* @return {number}
*/
export function nearestPowerOfTwo(v: number): number {
	return Math.pow(2, Math.round( Math.log( v ) / Math.log(2) ) )
}

/**
* Tells you the closest POT size (it ceils, so 256 will giev 256, but 257 will give 512)
* @method nextPowerOfTwo
* @param {v} number
* @return {number}
*/
export function nextPowerOfTwo(v: number): number {
	return Math.pow(2, Math.ceil( Math.log( v ) / Math.log(2) ) )
}

//Global Scope
//better array conversion to string for serializing
type TypedArrayCtor =
	| typeof Uint8Array
	| typeof Int8Array
	| typeof Uint16Array
	| typeof Int16Array
	| typeof Uint32Array
	| typeof Int32Array
	| typeof Float32Array
	| typeof Float64Array;

const typed_arrays: TypedArrayCtor[] = [ Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array ];
function typedToArray(this: ArrayLike<number>): number[] {
	return Array.prototype.slice.call(this);
}
typed_arrays.forEach( function(v: TypedArrayCtor): void {
	if(!v.prototype.toJSON)
		Object.defineProperty( v.prototype, "toJSON", {
			value: typedToArray,
			enumerable: false,
            configurable: true,
            writable: true
		});
});



/**
* Get current time in milliseconds
* @method getTime
* @return {number}
*/
export const getTime: () => number =
	typeof performance !== "undefined"
		? performance.now.bind(performance)
		: Date.now.bind( Date );


export function isFunction(obj: unknown): boolean {
  const o = obj as { constructor?: unknown; call?: unknown; apply?: unknown } | null | undefined;
  return !!(o && o.constructor && o.call && o.apply);
}

export function isArray(obj: unknown): boolean {
  return !!(obj && (obj as { constructor?: unknown }).constructor === Array );
  //var str = Object.prototype.toString.call(obj);
  //return str == '[object Array]' || str == '[object Float32Array]';
}

export function isNumber(obj: unknown): boolean {
  return (obj != null && (obj as { constructor?: unknown }).constructor === Number );
}

export function getClassName(obj: unknown): string | undefined {
	if (!obj)
		return;

	const o = obj as { name?: string; toString?: () => string };

	//from function info, but not standard
	if(o.name)
		return o.name;

	//from sourcecode
	if(o.toString) {
		const arr = o.toString().match(
			/function\s*(\w+)/);
		if (arr && arr.length == 2) {
			return arr[1];
		}
	}
}

/**
* clone one object recursively, only allows objects containing number,strings,typed-arrays or other objects
* @method cloneObject
* @param {Object} object
* @param {Object} target if omited an empty object is created
* @return {Object}
*/
export function cloneObject(o: Record<string, unknown>, t?: Record<string, unknown>): Record<string, unknown> {
	if((o as object).constructor !== Object)
		throw("cloneObject only can clone pure javascript objects, not classes");

	t = t || {};

	for(const i in o)
	{
		const v = o[i];
		if(v === null)
		{
			t[i] = null;
			continue;
		}

		const ctor = (v as { constructor: Function }).constructor;
		switch(ctor)
		{
			case Int8Array:
			case Uint8Array:
			case Int16Array:
			case Uint16Array:
			case Int32Array:
			case Uint32Array:
			case Float32Array:
			case Float64Array:
				t[i] = new (ctor as new (arg: ArrayLike<number>) => unknown)(v as ArrayLike<number>);
				break;
			case Boolean:
			case Number:
			case String:
				t[i] = v;
				break;
			case Array:
				t[i] = (v as unknown[]).concat(); //content is not cloned
				break;
			case Object:
				t[i] = cloneObject(v as Record<string, unknown>);
				break;
		}
	}

	return t;
}


/* SLOW because accepts booleans
function isNumber(obj) {
  var str = Object.prototype.toString.call(obj);
  return str == '[object Number]' || str == '[object Boolean]';
}
*/

//given a regular expression, a text and a callback, it calls the function every time it finds it
export function regexMap(regex: RegExp, text: string, callback: (result: RegExpExecArray) => void): void {
  let result: RegExpExecArray | null;
  while ((result = regex.exec(text)) != null) {
    callback(result);
  }
}

export function createCanvas(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

export function cloneCanvas(c: HTMLCanvasElement): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = c.width;
    canvas.height = c.height;
    const ctx = canvas.getContext("2d");
    ctx!.drawImage(c,0,0);
    return canvas;
}

if(typeof(Image) != "undefined") //not existing inside workers
{
	(Image.prototype as unknown as { getPixels: (this: HTMLImageElement) => Uint8ClampedArray }).getPixels = function(this: HTMLImageElement): Uint8ClampedArray
	{
		const canvas = document.createElement('canvas');
		canvas.width = this.width;
		canvas.height = this.height;
		const ctx = canvas.getContext("2d")!;
		ctx.drawImage(this,0,0);
		return ctx.getImageData(0, 0, this.width, this.height).data;
	}
}

//you must pass an object with characters to replace and replace with what {"a":"A","c":"C"}
if(!String.prototype.hasOwnProperty("replaceAll"))
	Object.defineProperty(String.prototype, "replaceAll", {
		value: function(this: string, words: Record<string, string>): string {
			let str: string = this;
			for(const i in words)
				str = str.split(i).join(words[i]);
			return str;
		},
		enumerable: false
	});

/*
String.prototype.replaceAll = function(words){
	var str = this;
	for(var i in words)
		str = str.split(i).join(words[i]);
    return str;
};
*/

//used for hashing keys
if(!String.prototype.hasOwnProperty("hashCode"))
	Object.defineProperty(String.prototype, "hashCode", {
		value: function(this: string): number {
			let hash = 0, i: number, c: number, l: number;
			if (this.length == 0) return hash;
			for (i = 0, l = this.length; i < l; ++i) {
				c  = this.charCodeAt(i);
				hash  = ((hash<<5)-hash)+c;
				hash |= 0; // Convert to 32bit integer
			}
			return hash;
		},
		enumerable: false
	});

//avoid errors when Typed array is expected and regular array is found
//Array.prototype.subarray = Array.prototype.slice;
//if(!Array.prototype.hasOwnProperty("subarray"))
//	Object.defineProperty(Array.prototype, "subarray", { value: Array.prototype.slice, enumerable: false });

if(!Array.prototype.hasOwnProperty("clone"))
	Object.defineProperty(Array.prototype, "clone", { value: Array.prototype.concat, enumerable: false });
if(!Float32Array.prototype.hasOwnProperty("clone"))
	Object.defineProperty(Float32Array.prototype, "clone", { value: function(this: Float32Array): Float32Array { return new Float32Array(this); }, enumerable: false });


// remove all properties on obj, effectively reverting it to a new object (to reduce garbage)
export function wipeObject(obj: Record<string, unknown>): void {
  for (const p in obj)
  {
    if (Object.prototype.hasOwnProperty.call(obj, p))
      delete obj[p];
  }
}

//copy methods from origin to target
export function extendClass( target: Function, origin: Function ): void {
	const t = target as unknown as Record<string, unknown>;
	const o = origin as unknown as Record<string, unknown>;

	for(const i in o) //copy class properties
	{
		if(Object.prototype.hasOwnProperty.call(target, i))
			continue;
		t[i] = o[i];
	}

	const originProto = (origin as { prototype?: unknown }).prototype;
	if(originProto) //copy prototype properties
	{
		const oproto = originProto as Record<string, unknown> & {
			__lookupGetter__(name: string): (() => unknown) | undefined;
			__lookupSetter__(name: string): ((value: unknown) => void) | undefined;
		};
		const tproto = (target as { prototype: unknown }).prototype as Record<string, unknown> & {
			__defineGetter__(name: string, fn: () => unknown): void;
			__defineSetter__(name: string, fn: (value: unknown) => void): void;
		};

		const prop_names = Object.getOwnPropertyNames( oproto );
		for(let i = 0; i < prop_names.length; ++i) //only enumerables
		{
			const name = prop_names[i];
			//if(!origin.prototype.hasOwnProperty(name))
			//	continue;

			if(Object.prototype.hasOwnProperty.call(tproto, name)) //avoid overwritting existing ones
				continue;

			//copy getters
			const getter = oproto.__lookupGetter__(name);
			if(getter)
				tproto.__defineGetter__(name, getter);
			else
				tproto[name] = oproto[name];

			//and setters
			const setter = oproto.__lookupSetter__(name);
			if(setter)
				tproto.__defineSetter__(name, setter);
		}
	}

	if(!Object.prototype.hasOwnProperty.call(target, "superclass"))
		Object.defineProperty(target, "superclass", {
			get: function(): Function { return origin },
			enumerable: false
		});
}


export interface HttpRequestOptions {
	async?: boolean;
	responseType?: XMLHttpRequestResponseType;
	binary?: boolean;
	[key: string]: unknown;
}

//simple http request
export function HttpRequest<T = unknown>( url: string, params?: Record<string, unknown> | null, callback?: (response: T) => void, error?: ((status: unknown) => void) | null, options?: HttpRequestOptions ): XMLHttpRequest {
	let async = true;
	options = options || {};
	if(options.async !== undefined)
		async = options.async;

	if(params)
	{
		const params_arr: string[] = [];
		for(const i in params)
			params_arr.push(i + "=" + params[i]);
		const params_str = params_arr.join("&");
		url = url + "?" + params_str;
	}

	const xhr = new XMLHttpRequest();
	xhr.open('GET', url, async);
	xhr.responseType = (options.responseType || "text") as XMLHttpRequestResponseType;
	xhr.onload = function(this: XMLHttpRequest): void
	{
		if(this.status != 200)
		{
			LEvent.trigger(xhr,"fail",this.status);
			if(error)
				error(this.status);
			return;
		}

		LEvent.trigger(xhr,"done",this.response);
		if(callback)
			callback(this.response);
		return;
	}

	xhr.onerror = function(err: ProgressEvent): void
	{
		LEvent.trigger(xhr,"fail",err);
	}

	if(options)
	{
		const xhrRecord = xhr as unknown as Record<string, unknown>;
		for(const i in options)
			xhrRecord[i] = options[i];
		if(options.binary)
			xhr.responseType = "arraybuffer";
	}

	xhr.send();

	return xhr;
}

//exposed under the name GL.request in the original library
export const request = HttpRequest;

//cheap simple promises
if( globalThis.XMLHttpRequest )
{
	if( !XMLHttpRequest.prototype.hasOwnProperty("done") )
		Object.defineProperty( XMLHttpRequest.prototype, "done", { enumerable: false, value: function(this: XMLHttpRequest, callback: (err: unknown) => void): XMLHttpRequest
		{
		  LEvent.bind(this,"done", function(e: unknown, err: unknown): void { callback(err); } );
		  return this;
		}});

	if( !XMLHttpRequest.prototype.hasOwnProperty("fail") )
		Object.defineProperty( XMLHttpRequest.prototype, "fail", { enumerable: false, value: function(this: XMLHttpRequest, callback: (err: unknown) => void): XMLHttpRequest
		{
		  LEvent.bind(this,"fail", function(e: unknown, err: unknown): void { callback(err); } );
		  return this;
		}});
}

export function getFileExtension(url: string): string {
	const question = url.indexOf("?");
	if(question != -1)
		url = url.substr(0,question);
	const point = url.lastIndexOf(".");
	if(point == -1)
		return "";
	return url.substr(point+1).toLowerCase();
}


//allows to pack several (text)files inside one single file (useful for shaders)
//every file must start with \filename.ext  or /filename.ext
export function loadFileAtlas(url: string, callback?: (files: Record<string, string>) => void, sync?: boolean): { done: (callback: (files: Record<string, string>) => void) => void } {
	let deferred_callback: ((files: Record<string, string>) => void) | null = null;

	//NOTE: `sync` is forwarded verbatim into the options slot, mirroring the original behaviour.
	HttpRequest(url, null, function(data: unknown): void {
		const files = processFileAtlas(data as string);
		if(callback)
			callback(files);
		if(deferred_callback)
			deferred_callback(files);
	}, alert, sync as unknown as HttpRequestOptions | undefined);

	return { done: function(callback: (files: Record<string, string>) => void): void { deferred_callback = callback; } };
}

//This parses a text file that contains several text files (they are separated by "\filename"), and returns an object with every file separatly
export function processFileAtlas(data: string, skip_trim?: boolean): Record<string, string> {
	const lines = data.split("\n");
	const files: Record<string, string> = {};

	let current_file_lines: string[] = [];
	let current_file_name = "";
	for(let i = 0, l = lines.length; i < l; i++)
	{
		const line = skip_trim ? lines[i] : lines[i].trim();
		if(!line.length)
			continue;
		if( line[0] != "\\")
		{
			current_file_lines.push(line);
			continue;
		}

		if( current_file_lines.length )
			files[ current_file_name ] = current_file_lines.join("\n");
		current_file_lines.length = 0;
		current_file_name = line.substr(1);
	}

	if( current_file_lines.length )
		files[ current_file_name ] = current_file_lines.join("\n");

	return files;
}


/*
global.halfFloatToFloat = function( h )
{
	function convertMantissa(i) {
	    if (i == 0)
			return 0
		else if (i < 1024)
		{
	        var m = i << 13;
			var e = 0;
			while (!(m & 0x00800000))
			{
				e -= 0x00800000
				m = m << 1
			}
	        m &= ~0x00800000
		    e += 0x38800000
	        return m | e;
		}
		return 0x38000000 + ((i - 1024) << 13);
	}

	function convertExponent(i)	{
		if (i == 0)
			return 0;
		else if (i >= 1 && i <= 31)
			return i << 23;
		else if (i == 31)
			return 0x47800000;
		else if (i == 32)
			return 0x80000000;
		else if (i >= 33 && i <= 63)
			return 0x80000000 + ((i - 32) << 23);
		return 0xC7800000;
	}

	function convertOffset(i) {
	    if (i == 0 || i == 32)
		    return 0
		return 1024;
	}

	var v = convertMantissa( convertOffset( h >> 10) + (h & 0x3ff) ) + convertExponent(h >> 10);
	var a = new Uint32Array([v]);
	return (new Float32Array(a.buffer))[0];
}
*/

export function typedArrayToArray(array: ArrayLike<number>): number[] {
	const r: number[] = [];
	r.length = array.length;
	for(let i = 0; i < array.length; i++)
		r[i] = array[i];
	return r;
}

export function RGBToHex(r: number, g: number, b: number): string {
	r = Math.min(255, r*255)|0;
	g = Math.min(255, g*255)|0;
	b = Math.min(255, b*255)|0;
	return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

export function HUEToRGB( p: number, q: number, t: number ): number {
	if(t < 0) t += 1;
	if(t > 1) t -= 1;
	if(t < 1/6) return p + (q - p) * 6 * t;
	if(t < 1/2) return q;
	if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
	return p;
}

export function HSLToRGB( h: number, s: number, l: number, out?: Float32Array ): Float32Array {
	let r: number, g: number, b: number;
	out = out || vec3.create();
	if(s == 0){
		r = g = b = l; // achromatic
	}else{
		const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		const p = 2 * l - q;
		r = HUEToRGB(p, q, h + 1/3);
		g = HUEToRGB(p, q, h);
		b = HUEToRGB(p, q, h - 1/3);
	}
	out[0] = r;
	out[1] = g;
	out[2] = b;
	return out;
}

//to change the color: from http://www.w3schools.com/cssref/css_colorsfull.asp
const string_colors: Record<string, number[]> = {
	white: [1,1,1],
	black: [0,0,0],
	gray: [0.501960813999176, 0.501960813999176, 0.501960813999176],
	red: [1,0,0],
	orange: [1, 0.6470588445663452, 0],
	pink: [1, 0.7529411911964417, 0.7960784435272217],
	green: [0, 0.501960813999176, 0],
	lime: [0,1,0],
	blue: [0,0,1],
	violet: [0.9333333373069763, 0.5098039507865906, 0.9333333373069763],
	magenta: [1,0,1],
	cyan: [0,1,1],
	yellow: [1,1,0],
	brown: [0.6470588445663452, 0.16470588743686676, 0.16470588743686676],
	silver: [0.7529411911964417, 0.7529411911964417, 0.7529411911964417],
	gold: [1, 0.843137264251709, 0],
	transparent: [0,0,0,0]
};

export function hexColorToRGBA( hex: unknown, color?: Float32Array, alpha?: number ): Float32Array {
	alpha = (alpha === undefined ? 1 : alpha);
	color = color || new Float32Array(4);
	color[3] = alpha;

	if(typeof(hex) != "string")
		return color;


	//for those hardcoded colors
	const col = string_colors[hex];
	if( col !== undefined )
	{
		color.set( col );
		if(color.length == 3)
			color[3] = alpha;
		else
			color[3] *= alpha;
		return color;
	}

	//rgba colors
	let pos = hex.indexOf("rgba(");
	if(pos != -1)
	{
		let str: string | string[] = hex.substr(5,hex.length-2);
		str = str.split(",");
		color[0] = parseInt( str[0] ) / 255;
		color[1] = parseInt( str[1] ) / 255;
		color[2] = parseInt( str[2] ) / 255;
		color[3] = parseFloat( str[3] ) * alpha;
		return color;
	}

	pos = hex.indexOf("hsla(");
	if(pos != -1)
	{
		let str: string | string[] = hex.substr(5,hex.length-2);
		str = str.split(",");
		HSLToRGB( parseInt( str[0] ) / 360, parseInt( str[1] ) / 100, parseInt( str[2] ) / 100, color );
		color[3] = parseFloat( str[3] ) * alpha;
		return color;
	}

	color[3] = alpha;

	//rgb colors
	pos = hex.indexOf("rgb(");
	if(pos != -1)
	{
		let str: string | string[] = hex.substr(4,hex.length-2);
		str = str.split(",");
		color[0] = parseInt( str[0] ) / 255;
		color[1] = parseInt( str[1] ) / 255;
		color[2] = parseInt( str[2] ) / 255;
		return color;
	}

	pos = hex.indexOf("hsl(");
	if(pos != -1)
	{
		let str: string | string[] = hex.substr(4,hex.length-2);
		str = str.split(",");
		HSLToRGB( parseInt( str[0] ) / 360, parseInt( str[1] ) / 100, parseInt( str[2] ) / 100, color );
		return color;
	}


	//the rest
	// Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
	const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
	const expanded = hex.replace( shorthandRegex, function(m: string, r: string, g: string, b: string): string {
		return r + r + g + g + b + b;
	});

	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(expanded);
	if(!result)
		return color;

	color[0] = parseInt(result[1], 16) / 255;
	color[1] = parseInt(result[2], 16) / 255;
	color[2] = parseInt(result[3], 16) / 255;
	return color;
}

const toHalfFloat_floatView = new Float32Array(1);
const toHalfFloat_int32View = new Int32Array(toHalfFloat_floatView.buffer);

export function toHalfFloat( fval: number ): number {
	toHalfFloat_floatView[0] = fval;
	const fbits = toHalfFloat_int32View[0];
	const sign  = (fbits >> 16) & 0x8000;          // sign only
	let val   = ( fbits & 0x7fffffff ) + 0x1000; // rounded value

	if( val >= 0x47800000 ) {             // might be or become NaN/Inf
	  if( ( fbits & 0x7fffffff ) >= 0x47800000 ) {
	                                      // is or must become NaN/Inf
	    if( val < 0x7f800000 ) {          // was value but too large
	      return sign | 0x7c00;           // make it +/-Inf
	    }
	    return sign | 0x7c00 |            // remains +/-Inf or NaN
	        ( fbits & 0x007fffff ) >> 13; // keep NaN (and Inf) bits
	  }
	  return sign | 0x7bff;               // unrounded not quite Inf
	}
	if( val >= 0x38800000 ) {             // remains normalized value
	  return sign | val - 0x38000000 >> 13; // exp - 127 + 15
	}
	if( val < 0x33000000 )  {             // too small for subnormal
	  return sign;                        // becomes +/-0
	}
	val = ( fbits & 0x7fffffff ) >> 23;   // tmp exp for subnormal calc
	return sign | ( ( fbits & 0x7fffff | 0x800000 ) // add subnormal bit
	     + ( 0x800000 >>> val - 102 )     // round depending on cut off
	     >> 126 - val );                  // div by 2^(1-(exp-127+15)) and >> 13 | exp=0
}
