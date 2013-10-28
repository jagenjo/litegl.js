//packer version
//litegl.js (Javi Agenjo) forked from lightgl.js by Evan Wallace (madebyevan.com)
"use strict"

var gl;
var DEG2RAD = 0.0174532925;
var RAD2DEG = 57.295779578552306;
var EPSILON = 0.000001;

/**
* Tells if one number is power of two (used for textures)
* @method isPowerOfTwo
* @param {v} number
* @return {boolean}
*/
function isPowerOfTwo(v)
{
	return ((Math.log(v) / Math.log(2)) % 1) == 0;
}

/**
* Get current time in milliseconds
* @method getTime
* @return {number}
*/
function getTime() {
	return new Date().getTime();
}

function isFunction(obj) {
  return !!(obj && obj.constructor && obj.call && obj.apply);
}

function isArray(obj) {
  return !!(obj && obj.constructor && (obj.constructor == Array || obj.constructor == Float32Array));
  //var str = Object.prototype.toString.call(obj);
  //return str == '[object Array]' || str == '[object Float32Array]';
}

function isNumber(obj) {
  var str = Object.prototype.toString.call(obj);
  return str == '[object Number]' || str == '[object Boolean]';
}

function regexMap(regex, text, callback) {
  var result;
  while ((result = regex.exec(text)) != null) {
    callback(result);
  }
}

function createCanvas(width, height) {
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}
/**
 * @fileoverview dds - Utilities for loading DDS texture files
 * @author Brandon Jones
 * @version 0.1
 */

/*
 * Copyright (c) 2012 Brandon Jones
 *
 * This software is provided 'as-is', without any express or implied
 * warranty. In no event will the authors be held liable for any damages
 * arising from the use of this software.
 *
 * Permission is granted to anyone to use this software for any purpose,
 * including commercial applications, and to alter it and redistribute it
 * freely, subject to the following restrictions:
 *
 *    1. The origin of this software must not be misrepresented; you must not
 *    claim that you wrote the original software. If you use this software
 *    in a product, an acknowledgment in the product documentation would be
 *    appreciated but is not required.
 *
 *    2. Altered source versions must be plainly marked as such, and must not
 *    be misrepresented as being the original software.
 *
 *    3. This notice may not be removed or altered from any source
 *    distribution.
 */

var DDS = (function () {

    "use strict";
    
    // All values and structures referenced from:
    // http://msdn.microsoft.com/en-us/library/bb943991.aspx/
    var DDS_MAGIC = 0x20534444;
    
    var DDSD_CAPS = 0x1,
        DDSD_HEIGHT = 0x2,
        DDSD_WIDTH = 0x4,
        DDSD_PITCH = 0x8,
        DDSD_PIXELFORMAT = 0x1000,
        DDSD_MIPMAPCOUNT = 0x20000,
        DDSD_LINEARSIZE = 0x80000,
        DDSD_DEPTH = 0x800000;

    var DDSCAPS_COMPLEX = 0x8,
        DDSCAPS_MIPMAP = 0x400000,
        DDSCAPS_TEXTURE = 0x1000;
        
    var DDSCAPS2_CUBEMAP = 0x200,
        DDSCAPS2_CUBEMAP_POSITIVEX = 0x400,
        DDSCAPS2_CUBEMAP_NEGATIVEX = 0x800,
        DDSCAPS2_CUBEMAP_POSITIVEY = 0x1000,
        DDSCAPS2_CUBEMAP_NEGATIVEY = 0x2000,
        DDSCAPS2_CUBEMAP_POSITIVEZ = 0x4000,
        DDSCAPS2_CUBEMAP_NEGATIVEZ = 0x8000,
        DDSCAPS2_VOLUME = 0x200000;

    var DDPF_ALPHAPIXELS = 0x1,
        DDPF_ALPHA = 0x2,
        DDPF_FOURCC = 0x4,
        DDPF_RGB = 0x40,
        DDPF_YUV = 0x200,
        DDPF_LUMINANCE = 0x20000;

    function fourCCToInt32(value) {
        return value.charCodeAt(0) +
            (value.charCodeAt(1) << 8) +
            (value.charCodeAt(2) << 16) +
            (value.charCodeAt(3) << 24);
    }

    function int32ToFourCC(value) {
        return String.fromCharCode(
            value & 0xff,
            (value >> 8) & 0xff,
            (value >> 16) & 0xff,
            (value >> 24) & 0xff
        );
    }

    var FOURCC_DXT1 = fourCCToInt32("DXT1");
    var FOURCC_DXT3 = fourCCToInt32("DXT3");
    var FOURCC_DXT5 = fourCCToInt32("DXT5");

    var headerLengthInt = 31; // The header length in 32 bit ints

    // Offsets into the header array
    var off_magic = 0;

    var off_size = 1;
    var off_flags = 2;
    var off_height = 3;
    var off_width = 4;

    var off_mipmapCount = 7;

    var off_pfFlags = 20;
    var off_pfFourCC = 21;
    var off_caps = 27;
    
    // Little reminder for myself where the above values come from
    /*DDS_PIXELFORMAT {
        int32 dwSize; // offset: 19
        int32 dwFlags;
        char[4] dwFourCC;
        int32 dwRGBBitCount;
        int32 dwRBitMask;
        int32 dwGBitMask;
        int32 dwBBitMask;
        int32 dwABitMask; // offset: 26
    };
    
    DDS_HEADER {
        int32 dwSize; // 1
        int32 dwFlags;
        int32 dwHeight;
        int32 dwWidth;
        int32 dwPitchOrLinearSize;
        int32 dwDepth;
        int32 dwMipMapCount; // offset: 7
        int32[11] dwReserved1;
        DDS_PIXELFORMAT ddspf; // offset 19
        int32 dwCaps; // offset: 27
        int32 dwCaps2;
        int32 dwCaps3;
        int32 dwCaps4;
        int32 dwReserved2; // offset 31
    };*/

    /**
     * Transcodes DXT into RGB565.
     * Optimizations:
     * 1. Use integer math to compute c2 and c3 instead of floating point
     *    math.  Specifically:
     *      c2 = 5/8 * c0 + 3/8 * c1
     *      c3 = 3/8 * c0 + 5/8 * c1
     *    This is about a 40% performance improvement.  It also appears to
     *    match what hardware DXT decoders do, as the colors produced
     *    by this integer math match what hardware produces, while the
     *    floating point in dxtToRgb565Unoptimized() produce slightly
     *    different colors (for one GPU this was tested on).
     * 2. Unroll the inner loop.  Another ~10% improvement.
     * 3. Compute r0, g0, b0, r1, g1, b1 only once instead of twice.
     *    Another 10% improvement.
     * 4. Use a Uint16Array instead of a Uint8Array.  Another 10% improvement.
     * @author Evan Parker
     * @param {Uint16Array} src The src DXT bits as a Uint16Array.
     * @param {number} srcByteOffset
     * @param {number} width
     * @param {number} height
     * @return {Uint16Array} dst
     */
    function dxtToRgb565(src, src16Offset, width, height) {
        var c = new Uint16Array(4);
        var dst = new Uint16Array(width * height);
        var nWords = (width * height) / 4;
        var m = 0;
        var dstI = 0;
        var i = 0;
        var r0 = 0, g0 = 0, b0 = 0, r1 = 0, g1 = 0, b1 = 0;
    
        var blockWidth = width / 4;
        var blockHeight = height / 4;
        for (var blockY = 0; blockY < blockHeight; blockY++) {
            for (var blockX = 0; blockX < blockWidth; blockX++) {
                i = src16Offset + 4 * (blockY * blockWidth + blockX);
                c[0] = src[i];
                c[1] = src[i + 1];
                r0 = c[0] & 0x1f;
                g0 = c[0] & 0x7e0;
                b0 = c[0] & 0xf800;
                r1 = c[1] & 0x1f;
                g1 = c[1] & 0x7e0;
                b1 = c[1] & 0xf800;
                // Interpolate between c0 and c1 to get c2 and c3.
                // Note that we approximate 1/3 as 3/8 and 2/3 as 5/8 for
                // speed.  This also appears to be what the hardware DXT
                // decoder in many GPUs does :)
                c[2] = ((5 * r0 + 3 * r1) >> 3)
                    | (((5 * g0 + 3 * g1) >> 3) & 0x7e0)
                    | (((5 * b0 + 3 * b1) >> 3) & 0xf800);
                c[3] = ((5 * r1 + 3 * r0) >> 3)
                    | (((5 * g1 + 3 * g0) >> 3) & 0x7e0)
                    | (((5 * b1 + 3 * b0) >> 3) & 0xf800);
                m = src[i + 2];
                dstI = (blockY * 4) * width + blockX * 4;
                dst[dstI] = c[m & 0x3];
                dst[dstI + 1] = c[(m >> 2) & 0x3];
                dst[dstI + 2] = c[(m >> 4) & 0x3];
                dst[dstI + 3] = c[(m >> 6) & 0x3];
                dstI += width;
                dst[dstI] = c[(m >> 8) & 0x3];
                dst[dstI + 1] = c[(m >> 10) & 0x3];
                dst[dstI + 2] = c[(m >> 12) & 0x3];
                dst[dstI + 3] = c[(m >> 14)];
                m = src[i + 3];
                dstI += width;
                dst[dstI] = c[m & 0x3];
                dst[dstI + 1] = c[(m >> 2) & 0x3];
                dst[dstI + 2] = c[(m >> 4) & 0x3];
                dst[dstI + 3] = c[(m >> 6) & 0x3];
                dstI += width;
                dst[dstI] = c[(m >> 8) & 0x3];
                dst[dstI + 1] = c[(m >> 10) & 0x3];
                dst[dstI + 2] = c[(m >> 12) & 0x3];
                dst[dstI + 3] = c[(m >> 14)];
            }
        }
        return dst;
    }

    /**
     * Parses a DDS file from the given arrayBuffer and uploads it into the currently bound texture
     *
     * @param {WebGLRenderingContext} gl WebGL rendering context
     * @param {WebGLCompressedTextureS3TC} ext WEBGL_compressed_texture_s3tc extension object
     * @param {TypedArray} arrayBuffer Array Buffer containing the DDS files data
     * @param {boolean} [loadMipmaps] If false only the top mipmap level will be loaded, otherwise all available mipmaps will be uploaded
     *
     * @returns {number} Number of mipmaps uploaded, 0 if there was an error
     */
    function uploadDDSLevels(gl, ext, arrayBuffer, loadMipmaps) {
        var header = new Int32Array(arrayBuffer, 0, headerLengthInt),
            fourCC, blockBytes, internalFormat,
            width, height, dataLength, dataOffset, is_cubemap,
            rgb565Data, byteArray, mipmapCount, i, face;

        if(header[off_magic] != DDS_MAGIC) {
            console.error("Invalid magic number in DDS header");
            return 0;
        }
        
        if(!header[off_pfFlags] & DDPF_FOURCC) {
            console.error("Unsupported format, must contain a FourCC code");
            return 0;
        }

        fourCC = header[off_pfFourCC];
        switch(fourCC) {
            case FOURCC_DXT1:
                blockBytes = 8;
                internalFormat = ext ? ext.COMPRESSED_RGB_S3TC_DXT1_EXT : null;
                break;

			/*
            case FOURCC_DXT1:
                blockBytes = 8;
                internalFormat = ext ? ext.COMPRESSED_RGBA_S3TC_DXT1_EXT : null;
                break;
			*/

            case FOURCC_DXT3:
                blockBytes = 16;
                internalFormat = ext ? ext.COMPRESSED_RGBA_S3TC_DXT3_EXT : null;
                break;

            case FOURCC_DXT5:
                blockBytes = 16;
                internalFormat = ext ? ext.COMPRESSED_RGBA_S3TC_DXT5_EXT : null;
                break;

            default:
				//blockBytes = 24;
				//internalFormat = gl.RGB;
                console.error("Unsupported FourCC code:", int32ToFourCC(fourCC), fourCC);
                return null;
        }

        mipmapCount = 1;
        if(header[off_flags] & DDSD_MIPMAPCOUNT && loadMipmaps !== false) {
            mipmapCount = Math.max(1, header[off_mipmapCount]);
        }

        width = header[off_width];
        height = header[off_height];
        dataOffset = header[off_size] + 4;
		is_cubemap = !!(header[off_caps+1] & DDSCAPS2_CUBEMAP);

		if(is_cubemap)
		{
			//console.error("Cubemaps not supported in DDS");
			//return null;

			for(face = 0; face < 6; ++face)
			{
				width = header[off_width];
				height = header[off_height];
				for(i = 0; i < mipmapCount; ++i) {
					dataLength = Math.max( 4, width )/4 * Math.max( 4, height )/4 * blockBytes;
					byteArray = new Uint8Array(arrayBuffer, dataOffset, dataLength);
					if(fourCC)
						gl.compressedTexImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, i, internalFormat, width, height, 0, byteArray);
					//else
					//	gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, i, internalFormat, width, height, 0, gl.RGB, gl.UNSIGNED_BYTE, byteArray);
					dataOffset += dataLength;
					width *= 0.5;
					height *= 0.5;
				}
			}
		}
		else //2d texture
		{
			if(ext) {
				for(i = 0; i < mipmapCount; ++i) {
					dataLength = Math.max( 4, width )/4 * Math.max( 4, height )/4 * blockBytes;
					byteArray = new Uint8Array(arrayBuffer, dataOffset, dataLength);
					gl.compressedTexImage2D(gl.TEXTURE_2D, i, internalFormat, width, height, 0, byteArray);
					dataOffset += dataLength;
					width *= 0.5;
					height *= 0.5;
				}
			} else {
				if(fourCC == FOURCC_DXT1) {
					dataLength = Math.max( 4, width )/4 * Math.max( 4, height )/4 * blockBytes;
					byteArray = new Uint16Array(arrayBuffer);
					rgb565Data = dxtToRgb565(byteArray, dataOffset / 2, width, height);
					gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, width, height, 0, gl.RGB, gl.UNSIGNED_SHORT_5_6_5, rgb565Data);
					if(loadMipmaps) {
						gl.generateMipmap(gl.TEXTURE_2D);
					}
				} else {
					console.error("No manual decoder for", int32ToFourCC(fourCC), "and no native support");
					return 0;
				}
			}
		}

        return mipmapCount;
    }

    /**
     * Creates a texture from the DDS file at the given URL. Simple shortcut for the most common use case
     *
     * @param {WebGLRenderingContext} gl WebGL rendering context
     * @param {WebGLCompressedTextureS3TC} ext WEBGL_compressed_texture_s3tc extension object
     * @param {string} src URL to DDS file to be loaded
     * @param {function} [callback] callback to be fired when the texture has finished loading
     *
     * @returns {WebGLTexture} New texture that will receive the DDS image data
     */
    function loadDDSTextureEx(gl, ext, src, texture, loadMipmaps, callback) {
        var xhr = new XMLHttpRequest();
        
        xhr.open('GET', src, true);
        xhr.responseType = "arraybuffer";
        xhr.onload = function() {
            if(this.status == 200) {
				var header = new Int32Array(this.response, 0, headerLengthInt)
				var is_cubemap = !!(header[off_caps+1] & DDSCAPS2_CUBEMAP);
				var tex_type = is_cubemap ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D;
                gl.bindTexture(tex_type, texture);
                var mipmaps = uploadDDSLevels(gl, ext, this.response, loadMipmaps);
                gl.texParameteri(tex_type, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(tex_type, gl.TEXTURE_MIN_FILTER, mipmaps > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
                gl.bindTexture(tex_type, null);
				texture.texture_type = tex_type;
				texture.width = header[off_width];
				texture.height = header[off_height];
            }

            if(callback) {
                callback(texture);
            }
        };
        xhr.send(null);

        return texture;
    }

    /**
     * Creates a texture from the DDS file at the given ArrayBuffer.
     *
     * @param {WebGLRenderingContext} gl WebGL rendering context
     * @param {WebGLCompressedTextureS3TC} ext WEBGL_compressed_texture_s3tc extension object
     * @param {ArrayBuffer} data containing the DDS file
     *
     * @returns {WebGLTexture} New texture that will receive the DDS image data
     */
    function loadDDSTextureFromMemoryEx(gl, ext, data, texture, loadMipmaps) {
		var header = new Int32Array(data, 0, headerLengthInt)
		var is_cubemap = !!(header[off_caps+1] & DDSCAPS2_CUBEMAP);
		var tex_type = is_cubemap ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D;
		gl.bindTexture(tex_type, texture);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false );
		var mipmaps = uploadDDSLevels(gl, ext, data, loadMipmaps);
		gl.texParameteri(tex_type, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(tex_type, gl.TEXTURE_MIN_FILTER, mipmaps > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
		gl.bindTexture(tex_type, null);
		texture.texture_type = tex_type;
		texture.width = header[off_width];
		texture.height = header[off_height];
        return texture;
    }

    /**
     * Creates a texture from the DDS file at the given URL. Simple shortcut for the most common use case
     *
     * @param {WebGLRenderingContext} gl WebGL rendering context
     * @param {WebGLCompressedTextureS3TC} ext WEBGL_compressed_texture_s3tc extension object
     * @param {string} src URL to DDS file to be loaded
     * @param {function} [callback] callback to be fired when the texture has finished loading
     *
     * @returns {WebGLTexture} New texture that will receive the DDS image data
     */
    function loadDDSTexture(gl, ext, src, callback) {
        var texture = gl.createTexture();
        loadDDSTextureEx(gl, src, texture, true, callback);
        return texture;
    }

    return {
        dxtToRgb565: dxtToRgb565,
        uploadDDSLevels: uploadDDSLevels,
        loadDDSTextureEx: loadDDSTextureEx,
        loadDDSTexture: loadDDSTexture,
		loadDDSTextureFromMemoryEx: loadDDSTextureFromMemoryEx
    };

})();
/* this file adds some extra functions to gl-matrix library */
if(typeof(glMatrix) == "undefined")
	throw("You must include glMatrix on your project");

vec3.zero = function(a)
{
	a[0] = a[1] = a[2] = 0.0;
	return a;
}

vec3.minValue = function(a)
{
	if(a[0] < a[1] && a[0] < a[2]) return a[0];
	if(a[1] < a[2]) return a[1];
	return a[2];
}

vec3.maxValue = function(a)
{
	if(a[0] > a[1] && a[0] > a[2]) return a[0];
	if(a[1] > a[2]) return a[1];
	return a[2];
}

vec3.minValue = function(a)
{
	if(a[0] < a[1] && a[0] < a[2]) return a[0];
	if(a[1] < a[2]) return a[1];
	return a[2];
}

vec3.addValue = function(out,a,v)
{
	out[0] = a[0] + v;
	out[1] = a[1] + v;
	out[2] = a[2] + v;
}

vec3.subValue = function(out,a,v)
{
	out[0] = a[0] - v;
	out[1] = a[1] - v;
	out[2] = a[2] - v;
}


vec3.toArray = function(vec)
{
	return [vec[0],vec[1],vec[2]];
}

vec3.rotateX = function(out,vec,angle_in_rad)
{
	var y = vec[1], z = vec[2];
	var cos = Math.cos(angle_in_rad);
	var sin = Math.sin(angle_in_rad);

	out[0] = vec[0];
	out[1] = y * cos - z * sin;
	out[2] = y * sin + z * cos;
	return out;
}

vec3.rotateY = function(out,vec,angle_in_rad)
{
	var x = vec[0], z = vec[2];
	var cos = Math.cos(angle_in_rad);
	var sin = Math.sin(angle_in_rad);

	out[0] = x * cos - z * sin;
	out[1] = vec[1];
	out[2] = x * sin + z * cos;
	return out;
}

vec3.rotateZ = function(out,vec,angle_in_rad)
{
	var x = vec[0], y = vec[1];
	var cos = Math.cos(angle_in_rad);
	var sin = Math.sin(angle_in_rad);

	out[0] = x * cos - y * sin;
	out[1] = x * sin + y * cos;
	out[2] = vec[2];
	return out;
}

//color
vec3.random = function(vec)
{
	vec = vec || vec3.create();
	vec[0] = Math.random();
	vec[1] = Math.random();
	vec[2] = Math.random();
}

/** MATRIX ********************/

mat4.multiplyVec3 = function(out, m, a) {
    var x = a[0], y = a[1], z = a[2];
    out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    return out;
};

mat4.projectVec3 = function(out, m, a) {
   var x = a[0], y = a[1], z = a[2];
   var v = vec3.fromValues(
      m[0] * x + m[1] * y + m[2] * z + m[3],
      m[4] * x + m[5] * y + m[6] * z + m[7],
      m[8] * x + m[9] * y + m[10] * z + m[11]
    );
   
   return vec3.scale(v,v,1.0 / (m[12] * v[0] + m[13] * v[1] + m[14] * v[2] + m[15]) );
};

//without translation
mat4.rotateVec3 = function(out, m, a) {
    var x = a[0], y = a[1], z = a[2];
    out[0] = m[0] * x + m[4] * y + m[8] * z;
    out[1] = m[1] * x + m[5] * y + m[9] * z;
    out[2] = m[2] * x + m[6] * y + m[10] * z;
    return out;
};


mat4.translationMatrix = function (v)
{
	var out = mat4.create();
	out[12] = v[0];
	out[13] = v[1];
	out[14] = v[2];
	return out;
}

mat4.setTranslation = function (out, v)
{
	out[12] = v[0];
	out[13] = v[1];
	out[14] = v[2];
	return out;
}

//returns the matrix without rotation
mat4.toRotationMat4 = function (out, mat) {
	mat4.copy(out,mat);
	out[12] = out[13] = out[14] = 0.0;
	return out;
};

//not tested
vec3.project = function(out, obj,  modelview, projection) {
	//var point = projection.transformPoint(modelview.transformPoint(new Vector(objX, objY, objZ)));
	//var point = projection.transformPoint( modelview.transformPoint( vec3.create(objX, objY, objZ)));
	var pos = vec3.clone(obj);
	mat4.multiplyVec3(pos, modelview, pos );
	mat4.multiplyVec3(pos, projection, pos);
	return vec3.set( out,
	  viewport[0] + viewport[2] * (point[0] * 0.5 + 0.5),
	  viewport[1] + viewport[3] * (point[1] * 0.5 + 0.5),
	  point[2] * 0.5 + 0.5
	);
};

var unprojectMat = mat4.create();
var unprojectVec = vec4.create();

vec3.unproject = function (out, vec, view, proj, viewport) {

	var m = unprojectMat;
	var v = unprojectVec;
	
	v[0] = (vec[0] - viewport[0]) * 2.0 / viewport[2] - 1.0;
	v[1] = (vec[1] - viewport[1]) * 2.0 / viewport[3] - 1.0;
	v[2] = 2.0 * vec[2] - 1.0;
	v[3] = 1.0;
	
	mat4.multiply(m, proj, view);
	if(!mat4.invert(m,m)) { return null; }
	
	vec4.transformMat4(v, v, m);
	if(v[3] === 0.0) { return null; }

	out[0] = v[0] / v[3];
	out[1] = v[1] / v[3];
	out[2] = v[2] / v[3];
	
	return out;
};

quat.toEuler = function(out, quat) {
	var q = quat;
	var heading, attitude, bank;

	if( (q[0]*q[1] + q[2]*q[3]) == 0.5 )
	{
		heading = 2 * atan2(q[0],q[3]);
		bank = 0;
		attitude = 0; //¿?
	}
	else if( (q[0]*q[1] + q[2]*q[3]) == 0.5 )
	{
		heading = -2 * atan2(q[0],q[3]);
		bank = 0;
		attitude = 0; //¿?
	}
	else
	{
		heading = Math.atan2( 2*(q[1]*q[3] - q[0]*q[2]) , 1 - 2 * (q[1]*q[1] - q[2]*q[2]) );
		attitude = Math.asin( 2*(q[0]*q[1] - q[2]*q[3]) );
		bank = Math.atan2( 2*(q[0]*q[3] - q[1]*q[2]), 1 - 2*(q[0]*q[0] - q[2]*q[2]) );
	}

	if(!out)
		out = vec3.create();
	vec3.set(out, heading, attitude, bank);
	return out;
}

quat.fromEuler = function(out, vec) {
	var heading = vec[0];
	var attitude = vec[1];
	var bank = vec[2];

	var C1 = Math.cos(heading);
	var C2 = Math.cos(attitude);
	var C3 = Math.cos(bank);
	var S1 = Math.sin(heading);
	var S2 = Math.sin(attitude);
	var S3 = Math.sin(bank);

	var w = Math.sqrt(1.0 + C1 * C2 + C1*C3 - S1 * S2 * S3 + C2*C3) * 0.5;
	var x = (C2 * S3 + C1 * S3 + S1 * S2 * C3) / (4.0 * w);
	var y = (S1 * C2 + S1 * C3 + C1 * S2 * S3) / (4.0 * w);
	var z = (-S1 * S3 + C1 * S2 * C3 + S2) /(4.0 * w);
	if(!out)
		out = quat.create();
	return quat.set(out, x,y,z,w );
};

/* doesnt work 
quat.lookAt = function(target, up, quat) {
	var forward = vec3.normalize( target, vec3.create() );
	up = vec3.normalize( up, vec3.create() );

	var right = vec3.cross(up,forward, vec3.create() );
	vec3.normalize( right );
	vec3.cross(forward, right, up );

	quat = quat || quat.create();

	quat[3] = Math.sqrt(1.0 + right[0] + up[1] + forward[2]) * 0.5;
	var w4_recip = 1.0 / (4.0 * quat[3]);
	quat[0] = (forward[1] - up[2]) * w4_recip;
	quat[1] = (right[2] - forward[0]) * w4_recip;
	quat[2] = (up[0] - right[1]) * w4_recip;
	 
	return quat;
}
*/

/**
* Indexer used to reuse vertices among a mesh
* @class Indexer
* @constructor
*/
function Indexer() {
  this.unique = [];
  this.indices = [];
  this.map = {};
}
Indexer.prototype = {
	add: function(obj) {
    var key = JSON.stringify(obj);
    if (!(key in this.map)) {
      this.map[key] = this.unique.length;
      this.unique.push(obj);
    }
    return this.map[key];
  }
};

/**
* A data buffer to be stored in the GPU
* @class Buffer
* @constructor
* @param {String} target name of the attribute
* @param {ArrayBufferView} array_type the array used to store it (Float32Array, Uint8Array ...)
*/
function Buffer(target, array_type) {
	this.buffer = null; //gl buffer
	this.target = target; //array_buffer
	this.type = array_type; //Float32Array Uint16Array...
	this.data = [];
}

/**
* Uploads the buffer data (stored in this.data) to the GPU
* @method compile
* @param {number} buffer_type default gl.STATIC_DRAW (other: gl.DYNAMIC_DRAW, gl.STREAM_DRAW 
*/
Buffer.prototype.compile = function(stream_type) { //default gl.STATIC_DRAW (other: gl.DYNAMIC_DRAW, gl.STREAM_DRAW )
	var data = null;
	var is_typed = (this.data.constructor != Array);
	var typed_array = null;
	var spacing = this.spacing || 3; //default spacing	

	if(is_typed) 
	{
		typed_array = this.data;
		data = typed_array;
	}
	else //regular array (convert to typed array)
	{
		if( typeof(this.data[0]) == 'number') //linear array
		{
			data = this.data;
			typed_array = new this.type(data);
		}
		else //arrays of arrays: [[0,1,0],[0,1,0],...] //flatten
		{
			data = [];
			for (var i = 0, chunk = 10000; i < this.data.length; i += chunk) {
			  data = Array.prototype.concat.apply(data, this.data.slice(i, i + chunk));
			}
			spacing = this.data.length ? data.length / this.data.length : 0;
			if (spacing != Math.round(spacing)) throw 'buffer elements not of consistent size, average size is ' + spacing;
			typed_array = new this.type(data);
		}
		//this.data = typed_array;
	}

	this.buffer = this.buffer || gl.createBuffer();
	this.buffer.length = data.length;
	this.buffer.spacing = spacing;
	gl.bindBuffer(this.target, this.buffer);
	gl.bufferData(this.target, typed_array , stream_type || gl.STATIC_DRAW);

	//this.data = null; //free memory once uploaded
	this.data = typed_array; //replace non-typed data by the typed one
	return typed_array; //maybe somebody needs the new clean buffer
};


/**
* Mesh class to upload geometry to the GPU
* @class Mesh
* @param {Object} options which streams do you want to create
* @constructor
*/
function Mesh(options) {
	options = options || {};
	this.vertexBuffers = {};
	this.indexBuffers = {};
	this.addVertexBuffer('vertices', Mesh.common_buffers["vertices"].attribute );

	for(var i in options)
		if( options[i] && Mesh.common_buffers[i] )
			this.addVertexBuffer( i, Mesh.common_buffers[i].attribute );

	//index buffers
	if (options.triangles) this.addIndexBuffer('triangles');
	if (options.lines) this.addIndexBuffer('lines');
};

Mesh.common_buffers = {
	"vertices": {size:3, attribute: "a_vertex"},
	"normals": {size:3, attribute: "a_normal"},
	"coords": {size:2, attribute: "a_coord"},
	"coords2": {size:2, attribute: "a_coord2"},
	"colors": {size:4, attribute: "a_color"},
	"tangents": {size:3, attribute: "a_tangent"},
	"bones": {size:4, attribute: "a_bones"},
	"weights": {size:4, attribute: "a_weights"},
	"extra": {size:1, attribute: "a_extra"},
	"extra2": {size:2, attribute: "a_extra2"},
	"extra3": {size:3, attribute: "a_extra3"},
	"extra4": {size:4, attribute: "a_extra4"}
};

/**
* Creates a new empty buffer and attachs it to this mesh
* @method addVertexBuffer
* @param {String} name 
* @param {String} attribute name of the stream in the shader
*/

Mesh.prototype.addVertexBuffer = function(name, attribute, buffer_spacing, buffer_data, buffer_type ) {
	var buffer = this.vertexBuffers[attribute] = new Buffer(gl.ARRAY_BUFFER, Float32Array);
	buffer.name = name;
	this[name] = []; //this created a regular array

	if (!buffer_spacing && Mesh.common_buffers[name])
		buffer.spacing = Mesh.common_buffers[name].size;

	if(buffer_data)
	{
		buffer.data = buffer_data;
		buffer.compile(buffer_type);
	}

	return buffer;
}

/**
* Creates a new empty index buffer and attachs it to this mesh
* @method addIndexBuffer
* @param {String} name 
*/

Mesh.prototype.addIndexBuffer = function(name) {
	var buffer = this.indexBuffers[name] = new Buffer(gl.ELEMENT_ARRAY_BUFFER, Uint16Array);
	this[name] = []; //this created a regular array
}

/**
* Uploads data of buffers to VRAM
* @method compile
* @param {number} buffer_type gl.STATIC_DRAW, gl.DYNAMIC_DRAW, gl.STREAM_DRAW
*/
Mesh.prototype.compile = function(buffer_type) {
	for (var attribute in this.vertexBuffers) {
		var buffer = this.vertexBuffers[attribute];
		buffer.data = this[buffer.name];
		buffer.compile(buffer_type);
	}

	for (var name in this.indexBuffers) {
		var buffer = this.indexBuffers[name];
		buffer.data = this[name];
		buffer.compile();
	}
}

/**
* Computes some data about the mesh
* @method generateMetadata
*/
Mesh.prototype.generateMetadata = function()
{
	var metadata = {};
	metadata.vertices = this.vertices.length / 3;
	if(this.triangles)
		metadata.faces = this.triangles.length / 3;
	else
		metadata.faces = this.vertices.length / 9;
	metadata.indexed = !!this.metadata.faces;
	metadata.have_normals = !!this.normals;
	metadata.have_coords = !!this.coords;
	metadata.have_colors = !!this.colors;

	this.metadata = metadata;
}

//never tested
/*
Mesh.prototype.draw = function(shader, mode, range_start, range_length)
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
Mesh.prototype.computeWireframe = function() {
	var data = this.triangles || this.vertices;

	var indexer = new Indexer();
	if( data.constructor == Array )
	{
		for (var i = 0; i < data.length; i++) {
		  var t = data[i];
		  for (var j = 0; j < t.length; j++) {
			var a = t[j], b = t[(j + 1) % t.length];
			indexer.add([Math.min(a, b), Math.max(a, b)]);
		  }
		}
	}
	else
	{
		for (var i = 0; i < data.length; i+=3) {
		  var t = data.subarray(i,i+3);
		  for (var j = 0; j < t.length; j++) {
			var a = t[j], b = t[(j + 1) % t.length];
			indexer.add([Math.min(a, b), Math.max(a, b)]);
		  }
		}
	}
	if (!this.lines) this.addIndexBuffer('lines');
	this.lines = indexer.unique;

	this.compile();
	return this;
}


/**
* Creates a new stream with the tangents
* @method computeTangents
*/
Mesh.prototype.computeTangents = function() {
	var vertices = this.vertexBuffers["a_vertex"].data;
	var normals = this.vertexBuffers["a_normal"].data;
	var uvs = this.vertexBuffers["a_coord"].data;
	var triangles = this.indexBuffers["triangles"].data;

	if(!vertices || !normals || !uvs) return;

	var tangents = new Float32Array(vertices.length);
	//temporary
	var tan1 = new Float32Array(vertices.length);
	var tan2 = new Float32Array(vertices.length);

	var a;
	for (a = 0; a < triangles.length; a+=3)
	{
		var i1 = triangles[a];
		var i2 = triangles[a+1];
		var i3 = triangles[a+2];

		var v1 = vertices.subarray(i1*3,i1*3+3);
		var v2 = vertices.subarray(i2*3,i2*3+3);
		var v3 = vertices.subarray(i3*3,i3*3+3);

		var w1 = uvs.subarray(i1*2,i1*2+2);
		var w2 = uvs.subarray(i2*2,i2*2+2);
		var w3 = uvs.subarray(i3*2,i3*2+2);

		var x1 = v2[0] - v1[0];
		var x2 = v3[0] - v1[0];
		var y1 = v2[1] - v1[1];
		var y2 = v3[1] - v1[1];
		var z1 = v2[2] - v1[2];
		var z2 = v3[2] - v1[2];

		var s1 = w2[0] - w1[0];
		var s2 = w3[0] - w1[0];
		var t1 = w2[1] - w1[1];
		var t2 = w3[1] - w1[1];

		var r;
		var den = (s1 * t2 - s2 * t1);
		if ( Math.abs(den) < 0.000000001 )
		  r = 0.0;
		else
		  r = 1.0 / den;

		var sdir = vec3.fromValues( (t2 * x1 - t1 * x2) * r, (t2 * y1 - t1 * y2) * r,
		  (t2 * z1 - t1 * z2) * r);
		var tdir = vec3.fromValues( (s1 * x2 - s2 * x1) * r, (s1 * y2 - s2 * y1) * r,
		  (s1 * z2 - s2 * z1) * r);

		vec3.add( vertices.subarray(i1*3,i1*3+3), sdir);
		vec3.add( vertices.subarray(i2*3,i2*3+3), sdir);
		vec3.add( vertices.subarray(i3*3,i3*3+3), sdir);

		vec3.add( vertices.subarray(i1*3,i1*3+3), tdir);
		vec3.add( vertices.subarray(i2*3,i2*3+3), tdir);
		vec3.add( vertices.subarray(i3*3,i3*3+3), tdir);
	}

	var temp = vec3.create();
	for (a = 0; a < positions.length; a+=3)
	{
		var n = normals.subarray(a,a+3);
		var t = tan1.subarray(a,a+3);

		// Gram-Schmidt orthogonalize
		vec3.subtract(t, vec3.scale(n, vec3.dot(n, t, temp), temp), temp);
		vec3.normalize(temp);

		// Calculate handedness
		var w = ( vec3.dot( vec3.cross(n, t, vec3.create()), tan2.subarray(a,a+3)) < 0.0) ? -1.0 : 1.0;
		tangents.set([temp[0], temp[1], temp[2], w],a);
	}

	var buffer = this.addVertexBuffer('tangents', Mesh.TANGENT_STREAM_NAME);
	buffer.data = tangents;
	buffer.compile();
}

/**
* Computes bounding information
* @method computeBounding
* @param {Array} vertices array containing all the vertices
*/
Mesh.prototype.computeBounding = function( vertices ) {
	vertices = vertices || this.vertexBuffers["a_vertex"].data;
	if(!vertices) return;

	var min = vec3.clone( vertices.subarray(0,3) );
	var max = vec3.clone( vertices.subarray(0,3) );
	var v;
	for(var i = 3; i < vertices.length; i+=3)
	{
		v = vertices.subarray(i,i+3);
		vec3.min( min,v, min);
		vec3.max( max,v, max);
	}

	var center = vec3.add(vec3.create(), min,max );
	vec3.scale( center, center, 0.5);
	var half_size = vec3.subtract( vec3.create(), max, center );

	if(!this.bounding)
		this.bounding = {};
	this.bounding.aabb_center = center;
	this.bounding.aabb_half = half_size;
	this.bounding.aabb_min = min;
	this.bounding.aabb_max = max;
	this.bounding.radius = vec3.length( half_size );
}

/*
Mesh.prototype.toBinary = function() {

}
*/

/**
* Remove all local memory from the streams (leaving it only in the VRAM) to save RAM
* @method freeData
*/
Mesh.prototype.freeData = function()
{
	for (var attribute in this.vertexBuffers)
	{
		this.vertexBuffers[attribute].data = null;
		delete this[ this.vertexBuffers[attribute].name ]; //delete from the mesh itself
	}
	for (var name in this.indexBuffers)
	{
		this.indexBuffers[name].data = null;
		delete this[ this.indexBuffers[name].name ]; //delete from the mesh itself
	}
}

/**
* Static method for the class Mesh to create a mesh from a list of streams
* @method Mesh.load
* @param {Object} json streams
*/
Mesh.load = function(buffers, options) {
	options = options || {};
	if (!('coords' in options)) options.coords = !!buffers.coords;
	if (!('coords2' in options)) options.coords2 = !!buffers.coords2;
	if (!('normals' in options)) options.normals = !!buffers.normals;
	if (!('colors' in options)) options.colors = !!buffers.colors;
	if (!('triangles' in options)) options.triangles = !!buffers.triangles;
	if (!('lines' in options)) options.lines = !!buffers.lines;

	//create the mesh with the buffers empty
	var mesh = new GL.Mesh(options);

	//attach the data to the mesh object
	mesh.vertices = buffers.vertices;
	if(!mesh.vertices.length) throw("Error: empty mesh vertices");

	if (mesh.coords) mesh.coords = buffers.coords;
	if (mesh.coords2) mesh.coords2 = buffers.coords2;
	if (mesh.normals) mesh.normals = buffers.normals;
	if (mesh.colors) mesh.colors = buffers.colors;
	if (mesh.triangles) mesh.triangles = buffers.triangles;
	if (mesh.lines) mesh.lines = buffers.lines;

	//upload data to buffers in VRAM
	mesh.compile( options.stream_type ); 

	if(options.bounding) //bounding information provided
		mesh.bounding = options.bounding;
	/* 
	else
		mesh.computeBounding(); //forcing to build the bounding is silly when using direct rendering
	*/

	return mesh;
}

/**
* Returns a planar mesh (you can choose how many subdivisions)
* @method Mesh.plane
* @param {Object} options valid options: detail, detailX, detailY, size, width, heigth, xz (horizontal plane)
*/
Mesh.plane = function(options) {
	options = options || {};
	options.triangles = [];
	var mesh = new Mesh(options);
	var detailX = options.detailX || options.detail || 1;
	var detailY = options.detailY || options.detail || 1;
	var width = options.width || options.size || 1;
	var height = options.height || options.size || 1;
	var xz = options.xz;
	width *= 0.5;
	height *= 0.5;

	var triangles = mesh.triangles;
	var vertices = mesh.vertices;
	var coords = mesh.coords;
	var normals = mesh.normals;

	for (var y = 0; y <= detailY; y++) {
	var t = y / detailY;
	for (var x = 0; x <= detailX; x++) {
	  var s = x / detailX;
	  if(xz)
		  vertices.push((2 * s - 1) * width, 0, (2 * t - 1) * width);
	  else
		  vertices.push((2 * s - 1) * width, (2 * t - 1) * height, 0);
	  if (coords) coords.push(s, t);
	  if (normals) normals.push(0, xz?1:0, xz?0:1);
	  if (x < detailX && y < detailY) {
		var i = x + y * (detailX + 1);
		if(xz)
		{
			triangles.push(i + 1, i, i + detailX + 1);
			triangles.push(i + 1, i + detailX + 1, i + detailX + 2);
		}
		else
		{
			triangles.push(i, i + 1, i + detailX + 1);
			triangles.push(i + detailX + 1, i + 1, i + detailX + 2);
		}
	  }
	}
	}

	mesh.bounding = {
		aabb_center: [0,0,0],
		aabb_half: xz ? [width,0,height] : [width,height,0],
		aabb_min: xz ? [-width,0,-height] : [-width,-height,0],
		aabb_max: xz ? [width,0,height] : [s,height,0],
		radius: vec3.length([width,0,height])
	};
	mesh.compile();
	return mesh;
};

/**
* Returns a cube mesh 
* @method Mesh.cube
* @param {Object} options valid options: size 
*/
Mesh.cube = function(options) {
	options = options || {};
	var size = options.size || 1;
	size *= 0.5;

	var buffers = {};
	//[[-1,1,-1],[-1,-1,+1],[-1,1,1],[-1,1,-1],[-1,-1,-1],[-1,-1,+1],[1,1,-1],[1,1,1],[1,-1,+1],[1,1,-1],[1,-1,+1],[1,-1,-1],[-1,1,1],[1,-1,1],[1,1,1],[-1,1,1],[-1,-1,1],[1,-1,1],[-1,1,-1],[1,1,-1],[1,-1,-1],[-1,1,-1],[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,1],[1,1,-1],[-1,1,-1],[-1,1,1],[1,1,1],[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,-1],[1,-1,1],[-1,-1,1]]
	buffers.vertices = new Float32Array([-1,1,-1,-1,-1,+1,-1,1,1,-1,1,-1,-1,-1,-1,-1,-1,+1,1,1,-1,1,1,1,1,-1,+1,1,1,-1,1,-1,+1,1,-1,-1,-1,1,1,1,-1,1,1,1,1,-1,1,1,-1,-1,1,1,-1,1,-1,1,-1,1,1,-1,1,-1,-1,-1,1,-1,1,-1,-1,-1,-1,-1,-1,1,-1,1,1,1,1,1,-1,-1,1,-1,-1,1,1,1,1,1,-1,-1,-1,1,-1,-1,1,-1,1,-1,-1,-1,1,-1,1,-1,-1,1]);
	//for(var i in options.vertices) for(var j in options.vertices[i]) options.vertices[i][j] *= size;
	for(var i = 0, l = buffers.vertices.length; i < l; ++i) buffers.vertices[i] *= size;

	//[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[1,0,0],[1,0,0],[1,0,0],[1,0,0],[1,0,0],[1,0,0],[0,0,1],[0,0,1],[0,0,1],[0,0,1],[0,0,1],[0,0,1],[0,0,-1],[0,0,-1],[0,0,-1],[0,0,-1],[0,0,-1],[0,0,-1],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,-1,0],[0,-1,0],[0,-1,0],[0,-1,0],[0,-1,0],[0,-1,0]]
	//[[0,1],[1,0],[1,1],[0,1],[0,0],[1,0],[1,1],[0,1],[0,0],[1,1],[0,0],[1,0],[0,1],[1,0],[1,1],[0,1],[0,0],[1,0],[1,1],[0,1],[0,0],[1,1],[0,0],[1,0],[0,1],[1,0],[1,1],[0,1],[0,0],[1,0],[1,1],[0,1],[0,0],[1,1],[0,0],[1,0]];
	buffers.normals = new Float32Array([-1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0]);
	buffers.coords = new Float32Array([0,1,1,0,1,1,0,1,0,0,1,0,1,1,0,1,0,0,1,1,0,0,1,0,0,1,1,0,1,1,0,1,0,0,1,0,1,1,0,1,0,0,1,1,0,0,1,0,0,1,1,0,1,1,0,1,0,0,1,0,1,1,0,1,0,0,1,1,0,0,1,0]);

	options.bounding = {
		aabb_center: [0,0,0],
		aabb_half: [size,size,size],
		aabb_min: [-size,-size,-size],
		aabb_max: [size,size,size],
		radius: vec3.length([size,size,size])
	};

	return Mesh.load(buffers, options);
}

/**
* Returns a cube mesh 
* @method Mesh.cylinder
* @param {Object} options valid options: radius, height, subdivisions 
*/
Mesh.cylinder = function(options) {
	options = options || {};
	var radius = options.radius || 1;
	var height = options.height || 2;
	var subdivisions = options.subdivisions || 64;

	var vertices = new Float32Array(subdivisions * 6 * 3);
	var normals = new Float32Array(subdivisions * 6 * 3);
	var coords = new Float32Array(subdivisions * 6 * 2);

	var delta = 2*Math.PI / subdivisions;
	var normal = null;
	for(var i = 0; i < subdivisions; ++i)
	{
		var angle = i * delta;

		normal = [ Math.sin(angle), 0, Math.cos(angle)];
		vertices.set([ normal[0]*radius, height*0.5, normal[2]*radius], i*6*3);
		normals.set(normal, i*6*3 );
		coords.set([i/subdivisions,1], i*6*2 );

		normal = [ Math.sin(angle), 0, Math.cos(angle)];
		vertices.set([ normal[0]*radius, height*-0.5, normal[2]*radius], i*6*3 + 3);
		normals.set(normal, i*6*3 + 3);
		coords.set([i/subdivisions,0], i*6*2 + 2);

		normal = [ Math.sin(angle+delta), 0, Math.cos(angle+delta)];
		vertices.set([ normal[0]*radius, height*-0.5, normal[2]*radius], i*6*3 + 6);
		normals.set(normal, i*6*3 + 6);
		coords.set([(i+1)/subdivisions,0], i*6*2 + 4);

		normal = [ Math.sin(angle+delta), 0, Math.cos(angle+delta)];
		vertices.set([ normal[0]*radius, height*0.5, normal[2]*radius], i*6*3 + 9);
		normals.set(normal, i*6*3 + 9);
		coords.set([(i+1)/subdivisions,1], i*6*2 + 6);

		normal = [ Math.sin(angle), 0, Math.cos(angle)];
		vertices.set([ normal[0]*radius, height*0.5, normal[2]*radius], i*6*3 + 12);
		normals.set(normal, i*6*3 + 12);
		coords.set([i/subdivisions,1], i*6*2 + 8);

		normal = [ Math.sin(angle+delta), 0, Math.cos(angle+delta)];
		vertices.set([ normal[0]*radius, height*-0.5, normal[2]*radius], i*6*3 + 15);
		normals.set(normal, i*6*3 + 15);
		coords.set([(i+1)/subdivisions,0], i*6*2 + 10);
	}

	var buffers = {
		vertices: vertices,
		normals: normals,
		coords: coords
	}

	options.bounding = {
		aabb_center: [0,0,0],
		aabb_half: [radius,height*0.5,radius],
		aabb_min: [-radius,height*-0.5,-radius],
		aabb_max: [radius,height*0.5,radius],
		radius: vec3.length([radius,height,radius])
	};

	return Mesh.load(buffers, options);
}

/**
* Returns a sphere mesh 
* @method Mesh.sphere
* @param {Object} options valid options: radius, lat, long
*/
Mesh.sphere = function(options) {
	options = options || {};
	var radius = options.radius || 1;
	var latitudeBands = options.lat || 16;
	var longitudeBands = options["long"] || 16;

 var vertexPositionData = new Float32Array( (latitudeBands+1)*(longitudeBands+1)*3 );
 var normalData = new Float32Array( (latitudeBands+1)*(longitudeBands+1)*3 );
 var textureCoordData = new Float32Array( (latitudeBands+1)*(longitudeBands+1)*2 );
 var indexData = new Uint16Array( latitudeBands*longitudeBands*6 );

 var i = 0, iuv = 0;
 for (var latNumber = 0; latNumber <= latitudeBands; latNumber++) {
   var theta = latNumber * Math.PI / latitudeBands;
   var sinTheta = Math.sin(theta);
   var cosTheta = Math.cos(theta);

   for (var longNumber = 0; longNumber <= longitudeBands; longNumber++) {
     var phi = longNumber * 2 * Math.PI / longitudeBands;
     var sinPhi = Math.sin(phi);
     var cosPhi = Math.cos(phi);

     var x = cosPhi * sinTheta;
     var y = cosTheta;
     var z = sinPhi * sinTheta;
     var u = 1- (longNumber / longitudeBands);
     var v = 1 - latNumber / latitudeBands;

     vertexPositionData.set([radius * x,radius * y,radius * z],i);
     normalData.set([x,y,z],i);
     textureCoordData.set([u,v], iuv );
	 i += 3;
	 iuv += 2;
   }
 }

 i=0;
 for (var latNumber = 0; latNumber < latitudeBands; latNumber++) {
   for (var longNumber = 0; longNumber < longitudeBands; longNumber++) {
     var first = (latNumber * (longitudeBands + 1)) + longNumber;
     var second = first + longitudeBands + 1;

     indexData.set([second,first,first + 1], i);
     indexData.set([second + 1,second,first + 1], i+3);
	 i += 6;
   }
 }

	var buffers = {
		vertices: vertexPositionData,
		normals: normalData,
		coords: textureCoordData,
		triangles: indexData
	};

	options.bounding = {
		aabb_center: [0,0,0],
		aabb_half: [radius,radius,radius],
		aabb_min: [-radius,-radius,-radius],
		aabb_max: [radius,radius,radius],
		radius: radius //vec3.length([radius,radius,radius]) //this should work but the radius doesnt match the AABB, dangerous
	};
	return Mesh.load(buffers, options);
}


Mesh.getScreenQuad = function()
{
	if(this._screen_quad)
		return this._screen_quad;
	var vertices = new Float32Array(18);
	var coords = new Float32Array([-1,-1, 1,1, -1,1,  -1,-1, 1,-1, 1,1 ]);
	this.screen_quad = new GL.Mesh.load({
		vertices: vertices,
		coords: coords});
	return this.screen_quad;
}
/**
* Texture class to upload images to the GPU, default is gl.TEXTURE_2D, gl.RGBAof gl.UNSIGNED_BYTE with filter gl.LINEAR, and gl.CLAMP_TO_EDGE
	There is a list of options
	==========================
	- texture_type: gl.TEXTURE_2D, gl.TEXTURE_CUBE_MAP
	- format: gl.RGB, gl.RGBA, gl.DEPTH_COMPONENT
	- type: gl.UNSIGNED_BYTE, gl.UNSIGNED_SHORT, gl.HALF_FLOAT_OES, gl.FLOAT
	- filter: filtering for mag and min: gl.NEAREST or gl.LINEAR
	- magFilter: magnifying filter: gl.NEAREST, gl.LINEAR
	- minFilter: minifying filter: gl.NEAREST, gl.LINEAR, gl.LINEAR_MIPMAP_LINEAR
	- premultiply_alpha: multiplies alpha channel by every color channel
	- wrap: texture wrapping: gl.CLAMP_TO_EDGE, gl.REPEAT, gl.MIRROR

* @class Texture
* @param {number} width texture width (any supported but Power of Two allows to have mipmaps), 0 means no memory reserved till its filled
* @param {number} height texture height (any supported but Power of Two allows to have mipmaps), 0 means no memory reserved till its filled
* @param {Object} options Check the list in the description
* @constructor
*/
function Texture(width, height, options) {
	options = options || {};
	width = parseInt(width); 
	height = parseInt(height);
	this.handler = gl.createTexture();
	this.width = width;
	this.height = height;
	this.format = options.format || gl.RGBA; //gl.DEPTH_COMPONENT
	this.type = options.type || gl.UNSIGNED_BYTE; //gl.UNSIGNED_SHORT
	this.texture_type = options.texture_type || gl.TEXTURE_2D;
	this.magFilter = options.magFilter || options.filter || gl.LINEAR;
	this.minFilter = options.minFilter || options.filter || gl.LINEAR;
	this.wrapS = options.wrap || options.wrapS || gl.CLAMP_TO_EDGE;
	this.wrapT = options.wrap || options.wrapT || gl.CLAMP_TO_EDGE;

	this.has_mipmaps = false;

	if(this.format == gl.DEPTH_COMPONENT && !gl.depth_ext)
		throw("Depth Texture not supported");
	if(this.type == gl.FLOAT && !gl.float_ext)
		throw("Float Texture not supported");
	if(this.type == gl.HALF_FLOAT_OES && !gl.half_float_ext)
		throw("Half Float Texture not supported");
	if((this.minFilter == gl.LINEAR_MIPMAP_LINEAR || this.wrapS != gl.CLAMP_TO_EDGE || this.wrapT != gl.CLAMP_TO_EDGE) && (!isPowerOfTwo(this.width) || !isPowerOfTwo(this.height)))
		throw("Cannot use texture-wrap or mipmaps in Non-Power-of-Two textures");

	if(width && height)
	{
		//I use an invalid gl enum to say this texture is a depth texture, ugly, I know...
		gl.bindTexture(this.texture_type, this.handler);
		if(options.premultiply_alpha)
			gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
		else
			gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
		gl.texParameteri(this.texture_type, gl.TEXTURE_MAG_FILTER, this.magFilter );
		gl.texParameteri(this.texture_type, gl.TEXTURE_MIN_FILTER, this.minFilter );
		gl.texParameteri(this.texture_type, gl.TEXTURE_WRAP_S, this.wrapS );
		gl.texParameteri(this.texture_type, gl.TEXTURE_WRAP_T, this.wrapT );

		//gl.TEXTURE_1D is not supported by WebGL...
		if(this.texture_type == gl.TEXTURE_2D)
		{
			gl.texImage2D(gl.TEXTURE_2D, 0, this.format, width, height, 0, this.format, this.type, null);
		}
		else if(this.texture_type == gl.TEXTURE_CUBE_MAP)
		{
			gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X, 0, this.format, this.width, this.height, 0, this.format, this.type, null);
			gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_Y, 0, this.format, this.width, this.height, 0, this.format, this.type, null);
			gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_Z, 0, this.format, this.width, this.height, 0, this.format, this.type, null);
			gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_X, 0, this.format, this.width, this.height, 0, this.format, this.type, null);
			gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, 0, this.format, this.width, this.height, 0, this.format, this.type, null);
			gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_Z, 0, this.format, this.width, this.height, 0, this.format, this.type, null);
		}
		gl.bindTexture(this.texture_type, null); //disable
	}
}

/**
* Returns if depth texture is supported by the GPU
* @method isDepthSupported
*/
Texture.isDepthSupported = function()
{
	return (gl.getExtension("WEBGL_depth_texture") || gl.getExtension("WEBKIT_WEBGL_depth_texture") || gl.getExtension("MOZ_WEBGL_depth_texture")) != null;
}

var framebuffer;
var renderbuffer;

/**
* Binds the texture to one texture unit
* @method bind
* @param {number} unit texture unit
* @return {number} returns the texture unit
*/
Texture.prototype.bind = function(unit) {
	if(unit == undefined) unit = 0;
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
Texture.prototype.unbind = function(unit) {
	if(unit == undefined) unit = 0;
	gl.activeTexture(gl.TEXTURE0 + unit );
	gl.bindTexture(this.texture_type, null);
}


Texture.prototype.setParameter = function(param,value) {
	gl.texParameteri(this.texture_type, param, value);
}

/**
* Given an Image/Canvas/Video it uploads it to the GPU
* @method uploadImage
* @param {Image} img
*/
Texture.prototype.uploadImage = function(image)
{
	this.bind();
	try {
		gl.texImage2D(gl.TEXTURE_2D, 0, this.format, this.format, this.type, image);
		this.width = image.videoWidth || image.width;
		this.height = image.videoHeight || image.height;
	} catch (e) {
		if (location.protocol == 'file:') {
			throw 'image not loaded for security reasons (serve this page over "http://" instead)';
		} else {
			throw 'image not loaded for security reasons (image must originate from the same ' +
			'domain as this page or use Cross-Origin Resource Sharing)';
		}
	}

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
*/
Texture.prototype.uploadData = function(data)
{
	this.bind();
	gl.texImage2D(this.texture_type, 0, this.format, this.format, this.type, data);
	if (this.minFilter && this.minFilter != gl.NEAREST && this.minFilter != gl.LINEAR) {
		gl.generateMipmap(texture.texture_type);
		this.has_mipmaps = true;
	}
}

/**
* Render to texture using FBO, just pass the callback to a rendering function and the content of the texture will be updated
* @method drawTo
* @param {Function} callback function that does all the rendering inside this texture
*/
Texture.prototype.drawTo = function(callback) {
	var v = gl.getParameter(gl.VIEWPORT);
	framebuffer = framebuffer || gl.createFramebuffer();
	renderbuffer = renderbuffer || gl.createRenderbuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
	if (this.width != renderbuffer.width || this.height != renderbuffer.height) {
	  renderbuffer.width = this.width;
	  renderbuffer.height = this.height;
	  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, this.width, this.height);
	}

	gl.viewport(0, 0, this.width, this.height);

	if(this.texture_type == gl.TEXTURE_2D)
	{
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.handler, 0);
		gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer);
		callback();
	}
	else if(this.texture_type == gl.TEXTURE_CUBE_MAP)
	{
		for(var i = 0; i < 6; i++)
		{
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X+i, this.handler, 0);
			gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer);
			callback(i);
		}
	}

	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.bindRenderbuffer(gl.RENDERBUFFER, null);
	gl.viewport(v[0], v[1], v[2], v[3]);
}

/**
* Copy content of one texture into another
* @method copyTo
* @param {Texture} target_texture
*/
Texture.prototype.copyTo = function(target_texture) {
	var that = this;

	//copy content
	target_texture.drawTo(function() {
		gl.disable( gl.BLEND );
		gl.disable( gl.DEPTH_TEST );
		gl.disable( gl.CULL_FACE );
		that.toViewport();
	});

	if (target_texture.minFilter && target_texture.minFilter != gl.NEAREST && target_texture.minFilter != gl.LINEAR) {
		target_texture.bind();
		gl.generateMipmap(target_texture.texture_type);
		target_texture.has_mipmaps = true;
	}
	gl.bindTexture(target_texture.texture_type, null); //disable
}

/**
* Render texture in a quad to full viewport size
* @method toViewport
* @param {Shader} shader to apply, otherwise a default textured shader is applied
* @param {Object} uniforms for the shader if needed
*/
Texture.prototype.toViewport = function(shader, uniforms)
{
	shader = shader || Shader.getScreenShader();
	var mesh = Mesh.getScreenQuad();
	if(uniforms)
		shader.uniforms(uniforms);
	this.bind(0);
	shader.uniforms({texture: 0}).draw( mesh, gl.TRIANGLES );
}

/**
* Copy texture content to a canvas
* @method toCanvas
* @param {Canvas} canvas must have the same size, if different the canvas will be resized
*/
Texture.prototype.toCanvas = function(canvas)
{
	var w = this.width;
	var h = this.height;
	canvas = canvas || createCanvas(w,h);
	if(canvas.width != w) canvas.width = w;
	if(canvas.height != h) canvas.height = h;

	var buffer = new Uint8Array(w*h*4);
	this.drawTo( function() {
		gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,buffer);
	});

	var ctx = canvas.getContext("2d");
	var pixels = ctx.getImageData(0,0,w,h);
	pixels.data.set( buffer );
	ctx.putImageData(pixels,0,0);

	return canvas;
}

/**
* Similar to drawTo but it also stores the depth in a depth texture
* @method drawToColorAndDepth
* @param {Texture} color_texture
* @param {Texture} depth_texture
* @param {Function} callback
*/
Texture.drawToColorAndDepth = function(color_texture, depth_texture, callback) {

	if(depth_texture.width != color_texture.width || depth_texture.height != color_texture.height)
		throw("Different size between color texture and depth texture");

	var v = gl.getParameter(gl.VIEWPORT);
	framebuffer = framebuffer || gl.createFramebuffer();
	renderbuffer = renderbuffer || gl.createRenderbuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

	gl.viewport(0, 0, color_texture.width, color_texture.height);

	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color_texture.handler, 0);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth_texture.handler, 0);

	callback();

	gl.bindFramebuffer(gl.FRAMEBUFFER, null);

	gl.viewport(v[0], v[1], v[2], v[3]);
}

/**
* Loads and uploads a texture from a url
* @method Texture.fromURL
* @param {String} url
* @param {Object} options
* @param {Function} on_complete
* @return {Texture} the texture
*/
Texture.fromURL = function(url, options, on_complete) {
	options = options || {};
	var texture = options.texture || new GL.Texture(1, 1, options);
	texture.bind();
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, (options.flipY != true ? 1 : 0) );
	var temp_color = new Uint8Array(options.temp_color || [0,0,0,255]);
	gl.texImage2D(gl.TEXTURE_2D, 0, texture.format, texture.width, texture.height, 0, texture.format, texture.type, temp_color );
	gl.bindTexture(texture.texture_type, null); //disable
	texture.ready = false;

	if( url.toLowerCase().indexOf(".dds") != -1)
	{
		var ext = gl.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");
		var new_texture = new GL.Texture(0,0, options);
		DDS.loadDDSTextureEx(gl, ext, url, new_texture.handler, true, function(t) {
			texture.texture_type = t.texture_type;
			texture.handler = t;
			texture.ready = true;
		});
	}
	else
	{
		var image = new Image();
		image.src = url;
		var that = this;
		image.onload = function()
		{
			options.texture = texture;
			GL.Texture.fromImage(this, options);
			texture.ready = true;
			if(on_complete)
				on_complete(texture);
		}
	}

	return texture;
};

/**
* Create a texture from an Image
* @method Texture.fromImage
* @param {Image} image
* @param {Object} options
* @return {Texture} the texture
*/
Texture.fromImage = function(image, options) {
	options = options || {};
	var texture = options.texture || new GL.Texture(image.width, image.height, options);
	texture.bind();
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, (options.flipY != true ? 1 : 0) );
	gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!options.premultiply_alpha );
	texture.uploadImage(image);
	if (options.minFilter && options.minFilter != gl.NEAREST && options.minFilter != gl.LINEAR) {
		texture.bind();
		gl.generateMipmap(texture.texture_type);
		texture.has_mipmaps = true;
	}
	gl.bindTexture(texture.texture_type, null); //disable
	return texture;
};

/**
* Create a texture from a Video
* @method Texture.fromVideo
* @param {Video} video
* @param {Object} options
* @return {Texture} the texture
*/
Texture.fromVideo = function(video, options) {
	options = options || {};
	var texture = options.texture || new GL.Texture(video.videoWidth, video.videoHeight, options);
	texture.bind();
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, (options.flipY != true ? 1 : 0) );
	gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!options.premultiply_alpha );
	texture.uploadImage(video);
	if (options.minFilter && options.minFilter != gl.NEAREST && options.minFilter != gl.LINEAR) {
		texture.bind();
		gl.generateMipmap(texture.texture_type);
		texture.has_mipmaps = true;
	}
	gl.bindTexture(texture.texture_type, null); //disable
	return texture;
};

/**
* Create a clone of a texture
* @method Texture.fromTexture
* @param {Texture} old_texture
* @param {Object} options
* @return {Texture} the texture
*/
Texture.fromTexture = function(old_texture, options) {
	options = options || {};
	var texture = new GL.Texture( old_texture.width, old_texture.height, options );
	old_texture.copyTo( texture );
	return texture;
};

/**
* Create a texture from an ArrayBuffer containing the pixels
* @method Texture.fromTexture
* @param {number} width
* @param {number} height
* @param {ArrayBuffer} pixels
* @param {Object} options
* @return {Texture} the texture
*/
Texture.fromMemory = function(width, height, pixels, options) //format in options as format
{
	options = options || {};
	var texture = options.texture || new GL.Texture(width, height, options);
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
	//the standard is to flip, so noflip means flip
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, (options.flipY != true ? 1 : 0) );
	gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!options.premultiply_alpha );
	texture.bind();

	try {
		gl.texImage2D(gl.TEXTURE_2D, 0, texture.format, width, height, 0, texture.format, texture.type, pixels);
	} catch (e) {
		if (location.protocol == 'file:') {
		  throw 'image not loaded for security reasons (serve this page over "http://" instead)';
		} else {
		  throw 'image not loaded for security reasons (image must originate from the same ' +
			'domain as this page or use Cross-Origin Resource Sharing)';
		}
	}
	if (options.minFilter && options.minFilter != gl.NEAREST && options.minFilter != gl.LINEAR) {
		gl.generateMipmap(gl.TEXTURE_2D);
		texture.has_mipmaps = true;
	}
	gl.bindTexture(texture.texture_type, null); //disable
	return texture;
};

/**
* Create a cubemap texture from a set of 6 images
* @method Texture.cubemapFromImages
* @param {Array} images
* @param {Object} options
* @return {Texture} the texture
*/
Texture.cubemapFromImages = function(images, options) {
	options = options || {};
	if(images.length != 6)
		throw "missing images to create cubemap";

	var size = images[0].width;
	var height = images[0].height;
	options.texture_type = gl.TEXTURE_CUBE_MAP;

	var texture = options.texture || new Texture(size, options);
	try {

		for(var i = 0; i < 6; i++)
			gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X+i, 0, texture.format, texture.format, texture.type, images[i]);
	} catch (e) {
		if (location.protocol == 'file:') {
		  throw 'image not loaded for security reasons (serve this page over "http://" instead)';
		} else {
		  throw 'image not loaded for security reasons (image must originate from the same ' +
			'domain as this page or use Cross-Origin Resource Sharing)';
		}
	}
	if (options.minFilter && options.minFilter != gl.NEAREST && options.minFilter != gl.LINEAR) {
		gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
		texture.has_mipmaps = true;
	}
	return texture;
};

/**
* Create a cubemap texture from a single image that contains all six images arranged vertically
* @method Texture.cubemapFromImage
* @param {Image} image
* @param {Object} options
* @return {Texture} the texture
*/
Texture.cubemapFromImage = function(image, options) {
	options = options || {};

	if(image.width != (image.height / 6) && image.height % 6 != 0)
	{
		console.log("Texture not valid, size doesnt match a cubemap");
		return;
	}

	var size = image.width;
	var height = image.height / 6;
	var images = [];
	for(var i = 0; i < 6; i++)
	{
		var canvas = createCanvas( image.width, height );
		var ctx = canvas.getContext("2d");
		ctx.drawImage(image, 0, height*i, image.width,height, 0,0, image.width,height );
		images.push(canvas);
	}

	return Texture.cubemapFromImages(images, options);
};

/**
* returns a Blob containing all the data from the texture
* @method Texture.toBlob
* @return {Blob} the blob containing the data
*/
Texture.prototype.toBlob = function()
{
	var w = this.width;
	var h = this.height;

	//Read pixels form WebGL
	var buffer = new Uint8Array(w*h*4);
	this.drawTo( function() {
		gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,buffer);
	});

	//dump to canvas
	var canvas = createCanvas(w,h);
	if(!canvas.toBlob)
		throw "toBlob not supported on Canvas element";

	var ctx = canvas.getContext("2d");
	var pixels = ctx.getImageData(0,0,w,h);
	pixels.data.set( buffer );
	ctx.putImageData(pixels,0,0);

	//reverse
	var final_canvas = createCanvas(w,h);
	var final_ctx = final_canvas.getContext("2d");
	final_ctx.translate(0,final_canvas.height);
	final_ctx.scale(1,-1);
	final_ctx.drawImage( canvas, 0, 0 );

	return final_canvas.toBlob();
}

/**
* returns a base64 String containing all the data from the texture
* @method Texture.toBase64
* @return {String} the data in base64 format
*/
Texture.prototype.toBase64 = function()
{
	var w = this.width;
	var h = this.height;

	//Read pixels form WebGL
	var buffer = new Uint8Array(w*h*4);
	this.drawTo( function() {
		gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,buffer);
	});

	//dump to canvas
	var canvas = createCanvas(w,h);
	var ctx = canvas.getContext("2d");
	var pixels = ctx.getImageData(0,0,w,h);
	pixels.data.set( buffer );
	ctx.putImageData(pixels,0,0);

	//create an image
	var img = canvas.toDataURL("image/png"); //base64 string
	return img;
}

/**
* generates some basic metadata about the image
* @method generateMetadata
* @return {Object}
*/
Texture.prototype.generateMetadata = function()
{
	var metadata = {};
	metadata.width = this.width;
	metadata.height = this.height;
	this.metadata = metadata;
}
/**
* Shader class to upload programs to the GPU
* @class Shader
* @constructor
* @param {String} vertexSource
* @param {String} fragmentSource
* @param {Object} macros (optional) precompiler macros to be applied when compiling
*/
function Shader(vertexSource, fragmentSource, macros)
{
	var extra_code = "";
	if(macros)
		for(var i in macros)
			extra_code += "#define " + i + " " + (macros[i] ? macros[i] : "") + "\n";

	//Compile shader
	function compileSource(type, source) {
		var shader = gl.createShader(type);
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			throw 'compile error: ' + gl.getShaderInfoLog(shader);
		}
		return shader;
	}
	this.program = gl.createProgram();
	gl.attachShader(this.program, compileSource(gl.VERTEX_SHADER, extra_code + vertexSource));
	gl.attachShader(this.program, compileSource(gl.FRAGMENT_SHADER, extra_code + fragmentSource));
	gl.linkProgram(this.program);
	if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
		throw 'link error: ' + gl.getProgramInfoLog(this.program);
	}

	//Extract info
	this.attributes = {};
	this.uniformLocations = {};
	var isSampler = {};
		regexMap(/uniform\s+sampler(1D|2D|3D|Cube)\s+(\w+)\s*;/g, vertexSource + fragmentSource, function(groups) {
		isSampler[groups[2]] = 1;
	});
	this.isSampler = isSampler;
}

/**
* Uploads a set of uniforms to the Shader
* @method uniforms
* @param {Object} uniforms
*/
Shader.prototype.uniforms = function(uniforms) {
	//upload uniforms
	gl.useProgram(this.program);

	for (var name in uniforms) {
		var location = this.uniformLocations[name] || gl.getUniformLocation(this.program, name);
		if (!location) continue;
		this.uniformLocations[name] = location;

		var value = uniforms[name];
		if(value == null) continue;
		if(value.constructor == Float32Array)
		{
			switch (value.length) {
				case 1: gl.uniform1fv(location, value); break; //float
				case 2: gl.uniform2fv(location, value); break; //vec2
				case 3: gl.uniform3fv(location, value); break; //vec3
				case 4: gl.uniform4fv(location, value); break; //vec4
				case 9: gl.uniformMatrix3fv(location, false,  value); break; //matrix3
				case 16: gl.uniformMatrix4fv(location, false, value); break; //matrix4
				default: throw 'don\'t know how to load uniform "' + name + '" of length ' + value.length;
			}
		} else if (isArray(value))
		{
			switch (value.length) {
			case 1: gl.uniform1fv(location, new Float32Array(value)); break; //float
			case 2: gl.uniform2fv(location, new Float32Array(value)); break; //vec2
			case 3: gl.uniform3fv(location, new Float32Array(value)); break; //vec3
			case 4: gl.uniform4fv(location, new Float32Array(value)); break; //vec4
			case 9: gl.uniformMatrix3fv(location, false, new Float32Array([  //matrix3
							value[0], value[3], value[6],
							value[1], value[4], value[7],
							value[2], value[5], value[8]
						  ])); break;
			case 16: gl.uniformMatrix4fv(location, false, new Float32Array([ //matrix4
							value[0], value[4], value[8], value[12],
							value[1], value[5], value[9], value[13],
							value[2], value[6], value[10], value[14],
							value[3], value[7], value[11], value[15]
						  ])); break;
			default: throw 'don\'t know how to load uniform "' + name + '" of length ' + value.length;
			}
		}
		else if (isNumber(value))
		{
			(this.isSampler[name] ? gl.uniform1i : gl.uniform1f).call(gl, location, value);
		} else {
			throw 'attempted to set uniform "' + name + '" to invalid value ' + value;
		}
	}
	return this;
}//uniforms

/**
* Renders a mesh using this shader, remember to use the function uniforms before to enable the shader
* @method draw
* @param {Mesh} mesh
* @param {number} mode could be gl.LINES, gl.POINTS, gl.TRIANGLES, gl.TRIANGLE_STRIP, gl.TRIANGLE_FAN
*/
Shader.prototype.draw = function(mesh, mode) {
	this.drawBuffers(mesh.vertexBuffers,
	  mesh.indexBuffers[mode == gl.LINES ? 'lines' : 'triangles'],
	  arguments.length < 2 ? gl.TRIANGLES : mode);
}

/**
* Renders a range of a mesh using this shader
* @method drawRange
* @param {Mesh} mesh
* @param {number} mode could be gl.LINES, gl.POINTS, gl.TRIANGLES, gl.TRIANGLE_STRIP, gl.TRIANGLE_FAN
* @param {number} start first primitive to render
* @param {number} length number of primitives to render
*/
Shader.prototype.drawRange = function(mesh, mode, start, length)
{
	this.drawBuffers(mesh.vertexBuffers,
	  mesh.indexBuffers[mode == gl.LINES ? 'lines' : 'triangles'],
	  mode, start, length);
}

/**
* Renders a range of a mesh using this shader
* @method drawBuffers
* @param {Object} vertexBuffers an object containing all the buffers
* @param {IndexBuffer} indexBuffer
* @param {number} mode could be gl.LINES, gl.POINTS, gl.TRIANGLES, gl.TRIANGLE_STRIP, gl.TRIANGLE_FAN
* @param {number} range_start first primitive to render
* @param {number} range_length number of primitives to render
*/
Shader.prototype.drawBuffers = function(vertexBuffers, indexBuffer, mode, range_start, range_length)
{
	if(range_length == 0) return;

	// Create and enable attribute pointers as necessary.
	var length = 0;
	for (var attribute in vertexBuffers) {
	  var buffer = vertexBuffers[attribute];
	  var location = this.attributes[attribute] ||
		gl.getAttribLocation(this.program, attribute);
	  if (location == -1 || !buffer.buffer) continue;
	  this.attributes[attribute] = location;
	  gl.bindBuffer(gl.ARRAY_BUFFER, buffer.buffer);
	  gl.enableVertexAttribArray(location);
	  gl.vertexAttribPointer(location, buffer.buffer.spacing, gl.FLOAT, false, 0, 0);
	  length = buffer.buffer.length / buffer.buffer.spacing;
	}

	//range rendering
	var offset = 0;
	if(arguments.length > 3) //render a polygon range
		offset = range_start * (indexBuffer ? indexBuffer.constructor.BYTES_PER_ELEMENT : 1); //in bytes (Uint16 == 2 bytes)

	if(arguments.length > 4)
		length = range_length;
	else if (indexBuffer)
		length = indexBuffer.buffer.length - offset;

	// Disable unused attribute pointers.
	for (var attribute in this.attributes) {
	  if (!(attribute in vertexBuffers)) {
		gl.disableVertexAttribArray(this.attributes[attribute]);
	  }
	}

	// Draw the geometry.
	if (length && (!indexBuffer || indexBuffer.buffer)) {
	  if (indexBuffer) {
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer.buffer);
		gl.drawElements(mode, length, gl.UNSIGNED_SHORT, offset);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
	  } else {
		gl.drawArrays(mode, offset, length);
	  }
	}

	return this;
}

//Now some common shaders everybody needs

//Screen shader: used to render one texture into another
Shader.getScreenShader = function()
{
	if(this._screen_shader)
		return this._screen_shader;

	var shader = new GL.Shader("\n\
			precision highp float;\n\
			attribute vec3 a_vertex;\n\
			attribute vec2 a_coord;\n\
			varying vec2 coord;\n\
			void main() { \n\
				coord = a_coord; \n\
				gl_Position = vec4(coord * 2.0 - 1.0, 0.0, 1.0); \n\
			}\n\
			","\n\
			precision highp float;\n\
			uniform sampler2D texture;\n\
			varying vec2 coord;\n\
			void main() {\n\
				gl_FragColor = texture2D(texture, coord);\n\
			}\n\
			");
	this._screen_shader = shader;
	return this._screen_shader;
}

//Blur shader
Shader.getBlurShader = function()
{
	if(this._blur_shader)
		return this._blur_shader;

	var shader = new GL.Shader("\n\
			precision highp float;\n\
			attribute vec3 a_vertex;\n\
			attribute vec2 a_coord;\n\
			varying vec2 v_coord;\n\
			void main() {\n\
				v_coord = a_coord; gl_Position = vec4(v_coord * 2.0 - 1.0, 0.0, 1.0);\n\
			}\n\
			","\n\
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
			");
	this._blur_shader = shader;
	return this._blur_shader;
}


/**
* The static module that contains all the features
* @class GL
*/
var GL = {
	contexts: [], //Index with all the WEBGL canvas created, so the update message is sent to all of them instead of independently
	blockable_keys: {"Up":true,"Down":true,"Left":true,"Right":true},

	/**
	* creates a new WebGL canvas
	* @method create
	* @param {Object} options supported are: width, height
	* @return {gl} gl context for webgl
	*/
	create: function(options) {
		options = options || {};
		var canvas = null;
		if(options.canvas)
		{
			if(typeof(options.canvas) == "string")
			{
				canvas = document.getElementById( options.canvas );
				if(!canvas) throw("Canvas element not found: " + options.canvas );
			}
			else 
				canvas = options.canvas;
		}
		else
			canvas = createCanvas(  options.width || 800, options.height || 600 );

		if (!('alpha' in options)) options.alpha = false;
		try { gl = canvas.getContext('webgl', options); } catch (e) {}
		try { gl = gl || canvas.getContext('experimental-webgl', options); } catch (e) {}
		if (!gl) { throw 'WebGL not supported'; }

		//get some useful extensions
		gl.derivatives_supported = gl.getExtension('OES_standard_derivatives') || false ;
		gl.depth_ext = gl.getExtension("WEBGL_depth_texture") || gl.getExtension("WEBKIT_WEBGL_depth_texture") || gl.getExtension("MOZ_WEBGL_depth_texture");
		//for float textures
		gl.float_ext = gl.getExtension("OES_texture_float");
		gl.float_ext_linear = gl.getExtension("OES_texture_float_linear");
		gl.half_float_ext = gl.getExtension("OES_texture_half_float");
		gl.half_float_ext_linear = gl.getExtension("OES_texture_half_float_linear");
		gl.HALF_FLOAT_OES = 0x8D61; 

		//just some checks
		if(typeof(glMatrix) == "undefined")
			throw("glMatrix not found, LiteGL requires glMatrix to be included");

		//trigger the mainLoop if no other context has been created before
		if (this.contexts.length == 0) GL.animate();

		//add this canvas to the context that may need update(dt) events
		this.contexts.push(gl);

		var last_click_time = 0;

		/**
		* Tells the system to capture mouse events on the canvas. This will trigger onmousedown, onmousemove, onmouseup, onmousewheel callbacks in the canvas.
		* @method gl.captureMouse
		* @param {boolean} capture_wheel capture also the mouse wheel
		*/
		gl.captureMouse = function(capture_wheel) {
			canvas.addEventListener("mousedown", onmouse);
			canvas.addEventListener("mousemove", onmouse);
			if(capture_wheel)
			{
				canvas.addEventListener("mousewheel", onmouse, false);
				canvas.addEventListener("wheel", onmouse, false);
				//canvas.addEventListener("DOMMouseScroll", onmouse, false);
			}
		}

		function onmouse(e) {
			GL.augmentEvent(e, canvas);
			e.eventType = e.type; //type cannot be overwritten, so I make a clone to allow me to overwrite

			if(e.eventType == "mousedown")
			{
				canvas.removeEventListener("mousemove", onmouse);
				document.addEventListener("mousemove", onmouse);
				document.addEventListener("mouseup", onmouse);
				last_click_time = new Date().getTime();

				if(gl.onmousedown) gl.onmousedown(e);
			}
			else if(e.eventType == "mousemove" && gl.onmousemove)
			{ 
				//move should be propagated (otherwise other components may fail)
				var now = new Date().getTime();
				e.click_time = now - last_click_time;
				gl.onmousemove(e); 
				return; 
			} 
			else if(e.eventType == "mouseup")
			{
				canvas.addEventListener("mousemove", onmouse);
				document.removeEventListener("mousemove", onmouse);
				document.removeEventListener("mouseup", onmouse);
				var now = new Date().getTime();
				e.click_time = now - last_click_time;
				last_click_time = now;

				if(gl.onmouseup) gl.onmouseup(e);
			}
			else if(gl.onmousewheel && (e.eventType == "mousewheel" || e.eventType == "wheel" || e.eventType == "DOMMouseScroll"))
			{ 
				e.eventType = "mousewheel";
				e.wheel = (e.wheelDeltaY != null ? e.wheelDeltaY : e.detail * -60);
				gl.onmousewheel(e);
			}

			e.stopPropagation();
			e.preventDefault();
			return false;
		}

		/**
		* Tells the system to capture key events on the canvas. This will trigger onkey
		* @method gl.captureKeys
		* @param {boolean} prevent_default prevent default behaviour (like scroll on the web, etc)
		*/
		gl.captureKeys = function( prevent_default ) {
			gl.keys = {};
			document.addEventListener("keydown", function(e) { onkey(e, prevent_default); });
			document.addEventListener("keyup", function(e) { onkey(e, prevent_default); });
		}

		function onkey(e, prevent_default)
		{
			//trace(e);
			e.eventType = e.type; //type cannot be overwritten, so I make a clone to allow me to overwrite

			var target_element = e.target.nodeName.toLowerCase();
			if(target_element == "input" || target_element == "textarea" || target_element == "select")
				return;

			e.character = String.fromCharCode(e.keyCode).toLowerCase();

			if (!e.altKey && !e.ctrlKey && !e.metaKey) {
				var key = GL.mapKeyCode(e.keyCode);
				if (key) gl.keys[key] = e.type == "keydown";
				gl.keys[e.keyCode] = e.type == "keydown";
			}

			if(e.type == "keydown" && gl.onkeydown) gl.onkeydown(e);
			else if(e.type == "keyup" && gl.onkeyup) gl.onkeyup(e);

			if(prevent_default && (e.isChar || GL.blockable_keys[e.keyIdentifier]) )
				e.preventDefault();
		}

		//gamepads
		gl.gamepads = null;
		function onButton(e, pressed)
		{
			console.log(e);
			if(pressed && gl.onbuttondown) gl.onbuttondown(e);
			else if(!pressed && gl.onbuttonup) gl.onbuttonup(e);
		}

		/**
		* Tells the system to capture gamepad events on the canvas. 
		* @method gl.captureGamepads
		*/
		gl.captureGamepads = function()
		{
			var getGamepads = navigator.getGamepads || navigator.webkitGetGamepads || navigator.mozGetGamepads; 
			if(!getGamepads) return;
			this.gamepads = getGamepads.call(navigator);

			//only in firefox
			window.addEventListener("gamepadButtonDown", function(e) { onButton(e, true); }, false);
			window.addEventListener("MozGamepadButtonDown", function(e) { onButton(e, true); }, false);
			window.addEventListener("WebkitGamepadButtonDown", function(e) { onButton(e, true); }, false);
			window.addEventListener("gamepadButtonUp", function(e) { onButton(e, false); }, false);
			window.addEventListener("MozGamepadButtonUp", function(e) { onButton(e, false); }, false);
			window.addEventListener("WebkitGamepadButtonUp", function(e) { onButton(e, false); }, false);
		}

		/**
		* returns the detected gamepads on the system
		* @method gl.getGamepads
		*/
		gl.getGamepads = function()
		{
			//gamepads
			var getGamepads = navigator.getGamepads || navigator.webkitGetGamepads || navigator.mozGetGamepads; 
			if(!getGamepads) return;
			var gamepads = getGamepads.call(navigator);
			var gamepad = null;
			for(var i = 0; i < 4; i++)
				if (gamepads[i])
				{
					gamepad = gamepads[i];
					if(this.gamepads) //launch connected gamepads: NOT TESTED
					{
						if(!this.gamepads[i] && gamepads[i] && this.ongamepadconnected)
							this.ongamepadconnected(gamepad);
						else if(this.gamepads[i] && !gamepads[i] && this.ongamepaddisconnected)
							this.ongamepaddisconnected(this.gamepads[i]);
					}
				}
			this.gamepads = gamepads;
			return gamepads;
		}

		return gl;
	},

	mapKeyCode: function(code) {
		var named = {
			8: 'BACKSPACE',
			9: 'TAB',
			13: 'ENTER',
			16: 'SHIFT',
			27: 'ESCAPE',
			32: 'SPACE',
			37: 'LEFT',
			38: 'UP',
			39: 'RIGHT',
			40: 'DOWN'
		};
		return named[code] || (code >= 65 && code <= 90 ? String.fromCharCode(code) : null);
	},

	//add useful info to the event
	dragging: false,
	last_pos: null,

	augmentEvent: function(e, root_element)
	{
		var offset_left = 0;
		var offset_top = 0;
		var b = null;

		root_element = root_element || e.target || gl.canvas;
		b = root_element.getBoundingClientRect();
			
		e.mousex = e.pageX - b.left;
		e.mousey = e.pageY - b.top;
		e.canvasx = e.mousex;
		e.canvasy = b.height - e.mousey;
		e.deltax = 0;
		e.deltay = 0;

		if(e.type == "mousedown")
			this.dragging = true;
		else if (e.type == "mousemove")
		{
			//trace(e.mousex + " " + e.mousey);
		}
		else if (e.type == "mouseup")
			this.dragging = false;

		if(this.last_pos)
		{
			e.deltax = e.mousex - this.last_pos[0];
			e.deltay = e.mousey - this.last_pos[1];
		}

		this.last_pos = [e.mousex, e.mousey];
		e.dragging = this.dragging;
		var left_button = e.buttons != null ? e.buttons : e.which;
		e.leftButton = left_button == 1;
	},

	animate: function() {
		var post =
		window.requestAnimationFrame ||
		window.mozRequestAnimationFrame ||
		window.webkitRequestAnimationFrame ||
		function(callback) { setTimeout(callback, 1000 / 60); };
		var time = new Date().getTime();

		//update only if browser tab visible
		function update() {
			var now = new Date().getTime();
			//launch the event to every WEBGL context
			for(var i in GL.contexts)
			{
				var gl = GL.contexts[i];
				var dt = (now - time) / 1000;
				if (gl.onupdate) gl.onupdate(dt);
				if (gl.ondraw) gl.ondraw();
			}
			post(update);
			time = now;
		}

		//updated always
		var time_forced = new Date().getTime();
		function forceUpdate() {
			var now = new Date().getTime();
			//launch the event to every WEBGL context
			for(var i in GL.contexts)
			{
				var gl = GL.contexts[i];
				if (gl.onforceupdate) gl.onforceupdate((now - time_forced) / 1000);
			}
			setTimeout(forceUpdate, 1000 / 60);
			time_forced = now;
		}

		gl.relaunch = function() { post(update); }

		update(); //only if the tab is in focus
		forceUpdate(); //always
	},

	Buffer: Buffer,
	Mesh: Mesh,
	Texture: Texture,
	Shader: Shader,

	//mini textures manager
	textures: {},
	_loading_textures: {},

	loadTexture: function(url, options, on_load)
	{
		if(this.textures[url]) return this.textures[url];
		if(this._loading_textures[url]) return null;
		var img = new Image();
		img.url = url;
		img.onload = function()
		{
			var texture = GL.Texture.fromImage(this, options);
			texture.img = this;
			GL.textures[this.url] = texture;
			delete GL._loading_textures[this.url];
			if(on_load) on_load(texture);
		} 
		img.src = url;
		this._loading_textures[url] = true;
		return null;
	}


};




/* Lite Events system (similar to jQuery) but lightweight, to use to hook rendering stages */
var LEvent = {
	jQuery: false, //dispatch as jQuery events (enable this if you want to hook regular jQuery events to instances, they are dispatches as ":eventname" to avoid collisions)
	//map: new Weakmap(),

	bind: function( instance, event_name, callback, instance2 )
	{
		if(!instance) throw("cannot bind event to null");
		if(!callback) throw("cannot bind to null callback");
		if(instance.constructor === String ) throw("cannot bind event to a string");
		if(instance.hasOwnProperty("__on_" + event_name))
			instance["__on_" + event_name].push([callback,instance2]);
		else
			instance["__on_" + event_name] = [[callback,instance2]];
	},

	unbind: function( instance, event_name, callback, instance2 )
	{
		if(!instance) throw("cannot unbind event to null");
		if(!callback) throw("cannot unbind from null callback");
		if(instance.constructor === String ) throw("cannot bind event to a string");
		if(!instance.hasOwnProperty("__on_" + event_name)) return;

		for(var i in instance["__on_" + event_name])
		{
			var v = instance["__on_" + event_name][i];
			if(v[0] === callback && v[1] === instance2)
			{
				instance["__on_" + event_name].splice( i, 1);
				break;
			}
		}

		if (instance["__on_" + event_name].length == 0)
			delete instance["__on_" + event_name];
	},

	unbindAll: function(instance, instance2)
	{
		if(!instance) throw("cannot unbind event to null");
		if(!instance2) //remove all
		{
			var remove = [];
			for(var i in instance)
			{
				if(i.substring(0,5) != "__on_") continue;
				remove.push(i);
			}
			for(var i in remove)
				delete instance[remove[i]];
			return;
		}

		//remove only the instance2
		//for every property in the instance
		for(var i in instance)
		{
			if(i.substring(0,5) != "__on_") continue; //skip non-LEvent properties
			var array = instance[i];
			for(var j=0; j < array.length; ++j)
			{
				if( array[j][1] != instance2 ) continue;
				array.splice(j,1);//remove
				--j;//iterate from the gap
			}
			if(array.length == 0)
				delete instance[i];
		}
	},

	isbind: function( instance, event_name, callback, instance2 )
	{
		if(!instance || !instance.hasOwnProperty("__on_" + event_name)) return false;
		for(var i in instance["__on_" + event_name])
		{
			var v = instance["__on_" + event_name][i];
			if(v[0] === callback && v[1] === instance2)
				return true;
		}
		return false;
	},

	trigger: function( instance, event, params, skip_jquery )
	{
		if(!instance) throw("cannot trigger event from null");
		if(instance.constructor === String ) throw("cannot bind event to a string");
		//you can resend the events as jQuery events, but to avoid collisions with system events, we use ":" at the begining
		if(typeof(event) == "string")
			event = { type: event, target: instance, stopPropagation: LEvent._stopPropagation };

		if(LEvent.jQuery && !skip_jquery) $(instance).trigger( ":" + event.type, params );

		if(!instance.hasOwnProperty("__on_" + event.type)) return;
		for(var i in instance["__on_" + event.type])
		{
			var v = instance["__on_" + event.type][i];
			if( v[0].call(v[1], event, params) == false || event.stop)
				break; //stopPropagation
		}

		return event;
	},

	_stopPropagation: function() { this.stop = true; }
};
/* geometric utilities */
var geo = {

	createPlane: function(P,N)
	{
		return new Float32Array([N[0],N[1],N[2],-vec3.dot(P,N)]);
	},

	distancePointToPlane: function(point, plane)
	{
		return (vec3.dot(point,plane) + plane[3])/Math.sqrt(plane[0]*plane[0] + plane[1]*plane[1] + plane[2]*plane[2]);
	},

	//for sorting
	distance2PointToPlane: function(point, plane)
	{
		return (vec3.dot(point,plane) + plane[3])/(plane[0]*plane[0] + plane[1]*plane[1] + plane[2]*plane[2]);
	},

	projectPointOnPlane: function(point, P, N, result)
	{
		result = result || vec3.create();
		var v = vec3.subtract( vec3.create(), point, P );
		var dist = vec3.dot(v,N);
		return vec3.subtract( result, point , vec3.scale( vec3.create(), N, dist ) );
	},

	reflectPointInPlane: function(point, P, N)
	{
		var d = -1 * (P[0] * N[0] + P[1] * N[1] + P[2] * N[2]);
		var t = -(d + N[0]*point[0] + N[1]*point[1] + N[2]*point[2]) / (N[0]*N[0] + N[1]*N[1] + N[2]*N[2]);
		//trace("T:" + t);
		//var closest = [ point[0]+t*N[0], point[1]+t*N[1], point[2]+t*N[2] ];
		//trace("Closest:" + closest);
		return vec3.fromValues( point[0]+t*N[0]*2, point[1]+t*N[1]*2, point[2]+t*N[2]*2 );
	},

	testRayPlane: function(start, direction, P, N, result)
	{
		var D = vec3.dot( P, N );
		var numer = D - vec3.dot(N, start);
		var denom = vec3.dot(N, direction);
		if( Math.abs(denom) < EPSILON) return false;
		var t = (numer / denom);
		if(t < 0.0) return false; //behind the ray
		if(result)
			vec3.add( result,  start, vec3.scale( vec3.create(), direction, t) );

		return true;
	},

	testRayBox: function(start, direction, minB, maxB, result)
	{
	//#define NUMDIM	3
	//#define RIGHT	0
	//#define LEFT	1
	//#define MIDDLE	2

		result = result || vec3.create();

		var inside = true;
		var quadrant = new Float32Array(3);
		var i;
		var whichPlane;
		var maxT = new Float32Array(3);
		var candidatePlane = new Float32Array(3);

		/* Find candidate planes; this loop can be avoided if
		rays cast all from the eye(assume perpsective view) */
		for (i=0; i < 3; i++)
			if(start[i] < minB[i]) {
				quadrant[i] = 1;
				candidatePlane[i] = minB[i];
				inside = false;
			}else if (start[i] > maxB[i]) {
				quadrant[i] = 0;
				candidatePlane[i] = maxB[i];
				inside = false;
			}else	{
				quadrant[i] = 2;
			}

		/* Ray origin inside bounding box */
		if(inside)	{
			vec3.copy(result, start);
			return true;
		}


		/* Calculate T distances to candidate planes */
		for (i = 0; i < 3; i++)
			if (quadrant[i] != 2 && direction[i] != 0.)
				maxT[i] = (candidatePlane[i] - start[i]) / direction[i];
			else
				maxT[i] = -1.;

		/* Get largest of the maxT's for final choice of intersection */
		whichPlane = 0;
		for (i = 1; i < 3; i++)
			if (maxT[whichPlane] < maxT[i])
				whichPlane = i;

		/* Check final candidate actually inside box */
		if (maxT[whichPlane] < 0.) return false;
		for (i = 0; i < 3; i++)
			if (whichPlane != i) {
				result[i] = start[i] + maxT[whichPlane] * direction[i];
				if (result[i] < minB[i] || result[i] > maxB[i])
					return false;
			} else {
				result[i] = candidatePlane[i];
			}
		return true;				/* ray hits box */
	},

	testRaySphere: function(start, direction, center, radius, result)
	{
		// sphere equation (centered at origin) x2+y2+z2=r2
		// ray equation x(t) = p0 + t*dir
		// substitute x(t) into sphere equation
		// solution below:

		// transform ray origin into sphere local coordinates
		var orig = vec3.subtract(vec3.create(), start, center);

		var a = direction[0]*direction[0] + direction[1]*direction[1] + direction[2]*direction[2];
		var b = 2*orig[0]*direction[0] + 2*orig[1]*direction[1] + 2*orig[2]*direction[2];
		var c = orig[0]*orig[0] + orig[1]*orig[1] + orig[2]*orig[2] - radius*radius;
		//return quadraticFormula(a,b,c,t0,t1) ? 2 : 0;

		var q = b*b - 4*a*c; 
		if( q < 0.0 )
			return false;

		if(result)
		{
			var sq = Math.sqrt(q);
			var d = 1 / (2*a);
			var r1 = ( -b + sq ) * d;
			var r2 = ( -b - sq ) * d;
			var t = r1 < r2 ? r1 : r2;
			vec3.add(result, start, vec3.scale( vec3.create(), direction, t ) );
		}
		return true;//real roots
	},

	testRayCylinder: function(start, direction, p, q, r, result)
	{
		var sa = vec3.clone(start);
		var sb = vec3.add(vec3.create(), start, vec3.scale( vec3.create(), direction, 100000) );
		var t = 0;
		var d = vec3.subtract(vec3.create(),q,p);
		var m = vec3.subtract(vec3.create(),sa,p);
		var n = vec3.subtract(vec3.create(),sb,sa);
		//var n = vec3.create(direction);

		var md = vec3.dot(m, d);
		var nd = vec3.dot(n, d);
		var dd = vec3.dot(d, d);

		// Test if segment fully outside either endcap of cylinder
		if (md < 0.0 && md + nd < 0.0) return false; // Segment outside ’p’ side of cylinder
		if (md > dd && md + nd > dd) return false; // Segment outside ’q’ side of cylinder

		var nn = vec3.dot(n, n);
		var mn = vec3.dot(m, n);
		var a = dd * nn - nd * nd; 
		var k = vec3.dot(m,m) - r*r;
		var c = dd * k - md * md;

		if (Math.abs(a) < EPSILON) 
		{
			// Segment runs parallel to cylinder axis
			if (c > 0.0) return false;
			// ’a’ and thus the segment lie outside cylinder
			// Now known that segment intersects cylinder; figure out how it intersects
			if (md < 0.0) t = -mn/nn;
			// Intersect segment against ’p’ endcap
			else if (md > dd)
				t=(nd-mn)/nn;
			// Intersect segment against ’q’ endcap
			else t = 0.0;
			// ’a’ lies inside cylinder
			if(result) vec3.add(result, sa, vec3.scale(vec3.create(), n,t) );
			return true;
		}
		var b = dd * mn - nd * md;
		var discr = b*b - a*c;
		if (discr < 0.0) 
			return false;
		// No real roots; no intersection
		t = (-b - Math.sqrt(discr)) / a;
		if (t < 0.0 || t > 1.0) 
			return false;
		// Intersection lies outside segment
		if(md+t*nd < 0.0)
		{
			// Intersection outside cylinder on ’p’ side
			if (nd <= 0.0) 
				return false;
			// Segment pointing away from endcap
			t = -md / nd;
			// Keep intersection if Dot(S(t) - p, S(t) - p) <= r^2
			if(result) vec3.add(result, sa, vec3.scale(vec3.create(), n,t) );

			return k+2*t*(mn+t*nn) <= 0.0;
		} else if (md+t*nd>dd)
		{
			// Intersection outside cylinder on ’q’ side
			if (nd >= 0.0) return false; //Segment pointing away from endcap
			t = (dd - md) / nd;
			// Keep intersection if Dot(S(t) - q, S(t) - q) <= r^2
			if(result) vec3.add(result, sa, vec3.scale(vec3.create(), n,t) );
			return k+dd - 2*md+t*(2*(mn - nd)+t*nn) <= 0.0;
		}
		// Segment intersects cylinder between the endcaps; t is correct
		if(result) vec3.add(result, sa, vec3.scale(vec3.create(), n,t) );
		return true;
	},

	closestPointBetweenLines: function(a0,a1, b0,b1, p_a, p_b)
	{
		var u = vec3.subtract( vec3.create(), a1, a0 );
		var v = vec3.subtract( vec3.create(), b1, b0 );
		var w = vec3.subtract( vec3.create(), a0, b0 );

		var a = vec3.dot(u,u);         // always >= 0
		var b = vec3.dot(u,v);
		var c = vec3.dot(v,v);         // always >= 0
		var d = vec3.dot(u,w);
		var e = vec3.dot(v,w);
		var D = a*c - b*b;        // always >= 0
		var sc, tc;

		// compute the line parameters of the two closest points
		if (D < EPSILON) {          // the lines are almost parallel
			sc = 0.0;
			tc = (b>c ? d/b : e/c);    // use the largest denominator
		}
		else {
			sc = (b*e - c*d) / D;
			tc = (a*e - b*d) / D;
		}

		// get the difference of the two closest points
		if(p_a)	vec3.add(p_a, a0, vec3.scale(vec3.create(),u,sc));
		if(p_b)	vec3.add(p_b, b0, vec3.scale(vec3.create(),v,tc));

		var dP = vec3.add( vec3.create(), w, vec3.subtract( vec3.create(), vec3.scale(vec3.create(),u,sc) , vec3.scale(vec3.create(),v,tc)) );  // =  L1(sc) - L2(tc)
		return vec3.length(dP);   // return the closest distance
	}
};
// Provides a convenient raytracing interface.

// ### new GL.HitTest([t, hit, normal])
// 
// This is the object used to return hit test results. If there are no
// arguments, the constructed argument represents a hit infinitely far
// away.
function HitTest(t, hit, normal) {
  this.t = arguments.length ? t : Number.MAX_VALUE;
  this.hit = hit;
  this.normal = normal;
}

// ### .mergeWith(other)
// 
// Changes this object to be the closer of the two hit test results.
HitTest.prototype = {
  mergeWith: function(other) {
    if (other.t > 0 && other.t < this.t) {
      this.t = other.t;
      this.hit = other.hit;
      this.normal = other.normal;
    }
  }
};

// ### new GL.Raytracer()
// 
// This will read the current modelview matrix, projection matrix, and viewport,
// reconstruct the eye position, and store enough information to later generate
// per-pixel rays using `getRayForPixel()`.
// 
// Example usage:
// 
//     var tracer = new GL.Raytracer();
//     var ray = tracer.getRayForPixel(
//       gl.canvas.width / 2,
//       gl.canvas.height / 2);
//       var result = GL.Raytracer.hitTestSphere(
//       tracer.eye, ray, new GL.Vector(0, 0, 0), 1);
function Raytracer(viewmatrix, projectionmatrix, viewport) {
  viewport = viewport || gl.getParameter(gl.VIEWPORT);
  var m = viewmatrix;
  this.viewport = viewport;

  var minX = viewport[0], maxX = minX + viewport[2];
  var minY = viewport[1], maxY = minY + viewport[3];
  this.ray00 = vec3.unproject(vec3.create(), vec3.fromValues(minX, minY, 1), viewmatrix, projectionmatrix, viewport);
  this.ray10 = vec3.unproject(vec3.create(), vec3.fromValues(maxX, minY, 1), viewmatrix, projectionmatrix, viewport);
  this.ray01 = vec3.unproject(vec3.create(), vec3.fromValues(minX, maxY, 1), viewmatrix, projectionmatrix, viewport);
  this.ray11 = vec3.unproject(vec3.create(), vec3.fromValues(maxX, maxY, 1), viewmatrix, projectionmatrix, viewport);

  this.eye = vec3.create();
  var eye = this.eye;
  vec3.unproject(eye, eye, viewmatrix, projectionmatrix, viewport);

  vec3.subtract(this.ray00, this.ray00, eye);
  vec3.subtract(this.ray10, this.ray10, eye);
  vec3.subtract(this.ray01, this.ray01, eye);
  vec3.subtract(this.ray11, this.ray11, eye);
}

  // ### .getRayForPixel(x, y)
  // 
  // Returns the ray originating from the camera and traveling through the pixel `x, y`.
Raytracer.prototype.getRayForPixel = function(x, y) {
    x = (x - this.viewport[0]) / this.viewport[2];
    y = 1 - (y - this.viewport[1]) / this.viewport[3];
    var ray0 = vec3.lerp(vec3.create(), this.ray00, this.ray10, x);
    var ray1 = vec3.lerp(vec3.create(), this.ray01, this.ray11, x);
    return vec3.normalize( vec3.create(), vec3.lerp(vec3.create(), ray0, ray1, y) );
}


// ### GL.Raytracer.hitTestBox(origin, ray, min, max)
// 
// Traces the ray starting from `origin` along `ray` against the axis-aligned box
// whose coordinates extend from `min` to `max`. Returns a `HitTest` with the
// information or `null` for no intersection.
// 
// This implementation uses the [slab intersection method](http://www.siggraph.org/education/materials/HyperGraph/raytrace/rtinter3.htm).
var _hittest_inv = mat4.create();
Raytracer.hitTestBox = function(origin, ray, min, max, model) {
  var _hittest_v3 = new Float32Array(10*3); //reuse memory to speedup
  
  if(model)
  {
	var inv = mat4.invert( _hittest_inv, model );
	origin = mat4.multiplyVec3( _hittest_v3.subarray(3,6), inv, origin );
	ray = mat4.rotateVec3( _hittest_v3.subarray(6,9), inv, ray );
  }

  var tMin = vec3.subtract( _hittest_v3.subarray(9,12), min, origin );
  vec3.divide( tMin, tMin, ray );

  var tMax = vec3.subtract( _hittest_v3.subarray(12,15), max, origin );
  vec3.divide( tMax, tMax, ray );

  var t1 = vec3.min( _hittest_v3.subarray(15,18), tMin, tMax);
  var t2 = vec3.max( _hittest_v3.subarray(18,21), tMin, tMax);

  var tNear = vec3.maxValue(t1);
  var tFar = vec3.minValue(t2);

  if (tNear > 0 && tNear < tFar) {
    var epsilon = 1.0e-6;
	var hit = vec3.scale( _hittest_v3.subarray(21,24), ray, tNear);
	vec3.add( hit, origin, hit );

    vec3.addValue(_hittest_v3.subarray(24,27), min, epsilon);
    vec3.subValue(_hittest_v3.subarray(27,30), max, epsilon);

    return new HitTest(tNear, hit, vec3.fromValues(
      (hit[0] > max[0]) - (hit[0] < min[0]),
      (hit[1] > max[1]) - (hit[1] < min[1]),
      (hit[2] > max[2]) - (hit[2] < min[2])
    ));
  }

  return null;
};




// ### GL.Raytracer.hitTestSphere(origin, ray, center, radius)
// 
// Traces the ray starting from `origin` along `ray` against the sphere defined
// by `center` and `radius`. Returns a `HitTest` with the information or `null`
// for no intersection.
Raytracer.hitTestSphere = function(origin, ray, center, radius) {
  var offset = vec3.subtract( vec3.create(), origin,center);
  var a = vec3.dot(ray,ray);
  var b = 2 * vec3.dot(ray,offset);
  var c = vec3.dot(offset,offset) - radius * radius;
  var discriminant = b * b - 4 * a * c;

  if (discriminant > 0) {
    var t = (-b - Math.sqrt(discriminant)) / (2 * a), hit = vec3.add(vec3.create(),origin, vec3.scale(vec3.create(), ray, t));
    return new HitTest(t, hit, vec3.scale( vec3.create(), vec3.subtract(vec3.create(), hit,center), 1.0/radius));
  }

  return null;
};


// ### GL.Raytracer.hitTestTriangle(origin, ray, a, b, c)
// 
// Traces the ray starting from `origin` along `ray` against the triangle defined
// by the points `a`, `b`, and `c`. Returns a `HitTest` with the information or
// `null` for no intersection.
Raytracer.hitTestTriangle = function(origin, ray, a, b, c) {
  var ab = vec3.subtract(vec3.create(), b,a );
  var ac = vec3.subtract(vec3.create(), c,a );
  var normal = vec3.cross( vec3.create(), ab,ac);
  vec3.normalize( normal, normal );
  var t = vec3.dot(normal, vec3.subtract( vec3.create(), a,origin)) / vec3.dot(normal,ray);

  if (t > 0) {
    var hit = vec3.add( vec3.create(), origin, vec3.scale(vec3.create(), ray,t));
    var toHit = vec3.subtract( vec3.create(), hit, a);
    var dot00 = vec3.dot(ac,ac);
    var dot01 = vec3.dot(ac,ab);
    var dot02 = vec3.dot(ac,toHit);
    var dot11 = vec3.dot(ab,ab);
    var dot12 = vec3.dot(ab,toHit);
    var divide = dot00 * dot11 - dot01 * dot01;
    var u = (dot11 * dot02 - dot01 * dot12) / divide;
    var v = (dot00 * dot12 - dot01 * dot02) / divide;
    if (u >= 0 && v >= 0 && u + v <= 1) return new HitTest(t, hit, normal);
  }

  return null;
};

GL.Raytracer = Raytracer;
//***** OBJ parser adapted from SpiderGL implementation *****************
/**
* A data buffer to be stored in the GPU
* @class Buffer
* @constructor
* @param {String} target name of the attribute
* @param {ArrayBufferView} array_type the array used to store it (Float32Array, Uint8Array ...)
*/

Mesh.parseOBJ = function(text, options)
{
	options = options || {};

	//final arrays (packed, lineal [ax,ay,az, bx,by,bz ...])
	var positionsArray = [ ];
	var texcoordsArray = [ ];
	var normalsArray   = [ ];
	var indicesArray   = [ ];

	//unique arrays (not packed, lineal)
	var positions = [ ];
	var texcoords = [ ];
	var normals   = [ ];
	var facemap   = { };
	var index     = 0;

	var line = null;
	var f   = null;
	var pos = 0;
	var tex = 0;
	var nor = 0;
	var x   = 0.0;
	var y   = 0.0;
	var z   = 0.0;
	var tokens = null;

	var hasPos = false;
	var hasTex = false;
	var hasNor = false;

	var parsingFaces = false;
	var indices_offset = 0;
	var negative_offset = -1; //used for weird objs with negative indices
	var max_index = 0;

	var skip_indices = options.noindex ? options.noindex : (text.length > 10000000 ? true : false);
	//trace("SKIP INDICES: " + skip_indices);
	var flip_axis = options.flipAxis;
	var flip_normals = (flip_axis || options.flipNormals);

	//used for mesh groups (submeshes)
	var group = null;
	var groups = [];
	var materials_found = {};

	var lines = text.split("\n");
	var length = lines.length;
	for (var lineIndex = 0;  lineIndex < length; ++lineIndex) {
		line = lines[lineIndex].replace(/[ \t]+/g, " ").replace(/\s\s*$/, ""); //trim

		if (line[0] == "#") continue;
		if(line == "") continue;

		tokens = line.split(" ");

		if(parsingFaces && tokens[0] == "v") //another mesh?
		{
			indices_offset = index;
			parsingFaces = false;
		}

		if (tokens[0] == "v") {
			if(flip_axis) //maya and max notation style
				positions.push(-1*parseFloat(tokens[1]),parseFloat(tokens[3]),parseFloat(tokens[2]));
			else
				positions.push(parseFloat(tokens[1]),parseFloat(tokens[2]),parseFloat(tokens[3]));
		}
		else if (tokens[0] == "vt") {
			texcoords.push(parseFloat(tokens[1]),parseFloat(tokens[2]));
		}
		else if (tokens[0] == "vn") {

			if(flip_normals)  //maya and max notation style
				normals.push(-parseFloat(tokens[2]),-parseFloat(tokens[3]),parseFloat(tokens[1]));
			else
				normals.push(parseFloat(tokens[1]),parseFloat(tokens[2]),parseFloat(tokens[3]));
		}
		else if (tokens[0] == "f") {
			parsingFaces = true;

			if (tokens.length < 4) continue; //faces with less that 3 vertices? nevermind

			//for every corner of this polygon
			var polygon_indices = [];
			for (var i=1; i < tokens.length; ++i) 
			{
				if (!(tokens[i] in facemap) || skip_indices) 
				{
					f = tokens[i].split("/");

					if (f.length == 1) { //unpacked
						pos = parseInt(f[0]) - 1;
						tex = pos;
						nor = pos;
					}
					else if (f.length == 2) { //no normals
						pos = parseInt(f[0]) - 1;
						tex = parseInt(f[1]) - 1;
						nor = -1;
					}
					else if (f.length == 3) { //all three indexed
						pos = parseInt(f[0]) - 1;
						tex = parseInt(f[1]) - 1;
						nor = parseInt(f[2]) - 1;
					}
					else {
						console.err("Problem parsing: unknown number of values per face");
						return false;
					}

					/*
					//pos = Math.abs(pos); tex = Math.abs(tex); nor = Math.abs(nor);
					if(pos < 0) pos = positions.length/3 + pos - negative_offset;
					if(tex < 0) tex = texcoords.length/2 + tex - negative_offset;
					if(nor < 0) nor = normals.length/3 + nor - negative_offset;
					*/

					x = 0.0;
					y = 0.0;
					z = 0.0;
					if ((pos * 3 + 2) < positions.length) {
						hasPos = true;
						x = positions[pos*3+0];
						y = positions[pos*3+1];
						z = positions[pos*3+2];
					}

					positionsArray.push(x,y,z);
					//positionsArray.push([x,y,z]);

					x = 0.0;
					y = 0.0;
					if ((tex * 2 + 1) < texcoords.length) {
						hasTex = true;
						x = texcoords[tex*2+0];
						y = texcoords[tex*2+1];
					}
					texcoordsArray.push(x,y);
					//texcoordsArray.push([x,y]);

					x = 0.0;
					y = 0.0;
					z = 1.0;
					if(nor != -1)
					{
						if ((nor * 3 + 2) < normals.length) {
							hasNor = true;
							x = normals[nor*3+0];
							y = normals[nor*3+1];
							z = normals[nor*3+2];
						}
						
						normalsArray.push(x,y,z);
						//normalsArray.push([x,y,z]);
					}

					//Save the string "10/10/10" and tells which index represents it in the arrays
					if(!skip_indices)
						facemap[tokens[i]] = index++;
				}//end of 'if this token is new (store and index for later reuse)'

				//store key for this triplet
				if(!skip_indices)
				{
					var final_index = facemap[tokens[i]];
					polygon_indices.push(final_index);
					if(max_index < final_index)
						max_index = final_index;
				}
			} //end of for every token on a 'f' line

			//polygons (not just triangles)
			if(!skip_indices)
			{
				for(var iP = 2; iP < polygon_indices.length; iP++)
				{
					indicesArray.push( polygon_indices[0], polygon_indices[iP-1], polygon_indices[iP] );
					//indicesArray.push( [polygon_indices[0], polygon_indices[iP-1], polygon_indices[iP]] );
				}
			}
		}
		else if (tokens[0] == "g" || tokens[0] == "usemtl") {
			negative_offset = positions.length / 3 - 1;

			if(tokens.length > 1)
			{
				if(group != null)
				{
					group.length = indicesArray.length - group.start;
					if(group.length > 0)
						groups.push(group);
				}

				group = {
					name: tokens[1],
					start: indicesArray.length,
					length: -1,
					material: ""
				};
			}
		}
		else if (tokens[0] == "usemtl") {
			if(group)
				group.material = tokens[1];
		}
		/*
		else if (tokens[0] == "o" || tokens[0] == "s") {
			//ignore
		}
		else
		{
			//console.log("unknown code: " + line);
		}
		*/
	}

	if(group && (indicesArray.length - group.start) > 1)
	{
		group.length = indicesArray.length - group.start;
		groups.push(group);
	}

	//deindex streams
	if((max_index > 256*256 || skip_indices ) && indicesArray.length > 0)
	{
		console.log("Deindexing mesh...")
		var finalVertices = new Float32Array(indicesArray.length * 3);
		var finalNormals = normalsArray && normalsArray.length ? new Float32Array(indicesArray.length * 3) : null;
		var finalTexCoords = texcoordsArray && texcoordsArray.length ? new Float32Array(indicesArray.length * 2) : null;
		for(var i = 0; i < indicesArray.length; i += 1)
		{
			finalVertices.set( positionsArray.slice( indicesArray[i]*3,indicesArray[i]*3 + 3), i*3 );
			if(finalNormals)
				finalNormals.set( normalsArray.slice( indicesArray[i]*3,indicesArray[i]*3 + 3 ), i*3 );
			if(finalTexCoords)
				finalTexCoords.set( texcoordsArray.slice(indicesArray[i]*2,indicesArray[i]*2 + 2 ), i*2 );
		}
		positionsArray = finalVertices;
		if(finalNormals)
			normalsArray = finalNormals;
		if(finalTexCoords)
			texcoordsArray = finalTexCoords;
		indicesArray = null;
	}

	//Create final mesh object
	var mesh = {};

	//create typed arrays
	if (hasPos)
		mesh.vertices = new Float32Array(positionsArray);
	if (hasNor && normalsArray.length > 0)
		mesh.normals = new Float32Array(normalsArray);
	if (hasTex && texcoordsArray.length > 0)
		mesh.coords = new Float32Array(texcoordsArray);
	if (indicesArray && indicesArray.length > 0)
		mesh.triangles = new Uint16Array(indicesArray);

	var info = {};
	if(groups.length > 1)
		info.groups = groups;
	mesh.info = info;

	var final_mesh = Mesh.load(mesh);
	final_mesh.computeBounding();
	return final_mesh;
}

