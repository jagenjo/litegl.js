//litegl.js v0.4.0 by Javi Agenjo 2014-2026 @tamat (tamats.com)
//forked from lightgl.js by Evan Wallace (madebyevan.com)
//requires gl-matrix 2.x to be loaded before this file
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

    function BGRtoRGB( byteArray )
	{
		for(var j = 0, l = byteArray.length, tmp = 0; j < l; j+=4) //BGR fix
		{
			tmp = byteArray[j];
			byteArray[j] = byteArray[j+2];
			byteArray[j+2] = tmp;
		}
	}

    function flipDXT( width, blockBytes, byteArray )
	{
		//TODO
		//var row = Uint8Array(width);
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
				blockBytes = 4;
				fourCC = null;
				internalFormat = gl.RGBA;
                //console.error("Unsupported FourCC code:", int32ToFourCC(fourCC), fourCC);
                //return null;
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
				for(var i = 0; i < mipmapCount; ++i) {
					if(fourCC)
					{
						dataLength = Math.max( 4, width )/4 * Math.max( 4, height )/4 * blockBytes;
						byteArray = new Uint8Array(arrayBuffer, dataOffset, dataLength);
						flipDXT( width, blockBytes, byteArray );
						gl.compressedTexImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, i, internalFormat, width, height, 0, byteArray);
					}
					else
					{
						gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false );
						dataLength = width * height * blockBytes;
						byteArray = new Uint8Array(arrayBuffer, dataOffset, dataLength);
						BGRtoRGB(byteArray);
						gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, i, internalFormat, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, byteArray);
					}
					dataOffset += dataLength;
					width *= 0.5;
					height *= 0.5;
				}
			}
		}
		else //2d texture
		{
			if(ext) {
				gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true );
				for(var i = 0; i < mipmapCount; ++i) {
					if(fourCC)
					{
						dataLength = Math.max( 4, width )/4 * Math.max( 4, height )/4 * blockBytes;
						byteArray = new Uint8Array(arrayBuffer, dataOffset, dataLength);
						gl.compressedTexImage2D(gl.TEXTURE_2D, i, internalFormat, width, height, 0, byteArray);
					}
					else
					{
						dataLength = width * height * blockBytes;
						byteArray = new Uint8Array(arrayBuffer, dataOffset, dataLength);
						BGRtoRGB(byteArray);
						gl.texImage2D(gl.TEXTURE_2D, i, internalFormat, width, height, 0, internalFormat, gl.UNSIGNED_BYTE, byteArray);
					}
					dataOffset += dataLength;
					width *= 0.5;
					height *= 0.5;
				}
			} else {
				if(fourCC == FOURCC_DXT1) {
					dataLength = Math.max( 4, width )/4 * Math.max( 4, height )/4 * blockBytes;
					byteArray = new Uint16Array(arrayBuffer);
					//Decompress
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
     * Parses a DDS file from the given arrayBuffer and uploads it into the currently bound texture
     *
     * @param {WebGLRenderingContext} gl WebGL rendering context
     * @param {WebGLCompressedTextureS3TC} ext WEBGL_compressed_texture_s3tc extension object
     * @param {TypedArray} arrayBuffer Array Buffer containing the DDS files data
     * @param {boolean} [loadMipmaps] If false only the top mipmap level will be loaded, otherwise all available mipmaps will be uploaded
     *
     * @returns {number} Number of mipmaps uploaded, 0 if there was an error
     */
    function getDDSLevels( arrayBuffer, compressed_not_supported )
	{
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
                internalFormat = "COMPRESSED_RGB_S3TC_DXT1_EXT";
                break;

            case FOURCC_DXT3:
                blockBytes = 16;
                internalFormat = "COMPRESSED_RGBA_S3TC_DXT3_EXT";
                break;

            case FOURCC_DXT5:
                blockBytes = 16;
                internalFormat = "COMPRESSED_RGBA_S3TC_DXT5_EXT";
                break;

            default:
				blockBytes = 4;
				internalFormat = "RGBA";
                //console.error("Unsupported FourCC code:", int32ToFourCC(fourCC), fourCC);
                //return null;
        }

        mipmapCount = 1;
        if(header[off_flags] & DDSD_MIPMAPCOUNT && loadMipmaps !== false) {
            mipmapCount = Math.max(1, header[off_mipmapCount]);
        }

        width = header[off_width];
        height = header[off_height];
        dataOffset = header[off_size] + 4;
		is_cubemap = !!(header[off_caps+1] & DDSCAPS2_CUBEMAP);

		var buffers = [];

		if(is_cubemap)
		{
			for(var face = 0; face < 6; ++face)
			{
				width = header[off_width];
				height = header[off_height];
				for(var i = 0; i < mipmapCount; ++i)
				{
					if(fourCC)
					{
						dataLength = Math.max( 4, width )/4 * Math.max( 4, height )/4 * blockBytes;
						byteArray = new Uint8Array(arrayBuffer, dataOffset, dataLength);
						buffers.push({ tex: "TEXTURE_CUBE_MAP", face: face, mipmap: i, internalFormat: internalFormat, width: width, height: height, offset: 0, dataOffset: dataOffset, dataLength: dataLength });
					}
					else
					{
						dataLength = width * height * blockBytes;
						byteArray = new Uint8Array(arrayBuffer, dataOffset, dataLength);
						BGRtoRGB(byteArray);
						buffers.push({ tex: "TEXTURE_CUBE_MAP", face: face, mipmap: i, internalFormat: internalFormat, width: width, height: height, offset: 0, type: "UNSIGNED_BYTE", dataOffset: dataOffset, dataLength: dataLength });
					}
					dataOffset += dataLength;
					width *= 0.5;
					height *= 0.5;
				}
			}
		}
		else //2d texture
		{
			if(!compressed_not_supported)
			{
				for(var i = 0; i < mipmapCount; ++i) {
					dataLength = Math.max( 4, width )/4 * Math.max( 4, height )/4 * blockBytes;
					byteArray = new Uint8Array(arrayBuffer, dataOffset, dataLength);
					//gl.compressedTexImage2D(gl.TEXTURE_2D, i, internalFormat, width, height, 0, byteArray);
					buffers.push({ tex: "TEXTURE_2D", mipmap: i, internalFormat: internalFormat, width: width, height: height, offset: 0, type: "UNSIGNED_BYTE", dataOffset: dataOffset, dataLength: dataLength });
					dataOffset += dataLength;
					width *= 0.5;
					height *= 0.5;
				}
			} else {
				if(fourCC == FOURCC_DXT1)
				{
					dataLength = Math.max( 4, width )/4 * Math.max( 4, height )/4 * blockBytes;
					byteArray = new Uint16Array(arrayBuffer);
					rgb565Data = dxtToRgb565(byteArray, dataOffset / 2, width, height);
					//gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, width, height, 0, gl.RGB, gl.UNSIGNED_SHORT_5_6_5, rgb565Data);
					buffers.push({ tex: "TEXTURE_2D", mipmap: 0, internalFormat: "RGB", width: width, height: height, offset: 0, format:"RGB", type: "UNSIGNED_SHORT_5_6_5", data: rgb565Data });
				} else {
					console.error("No manual decoder for", int32ToFourCC(fourCC), "and no native support");
					return 0;
				}
			}
		}

        return buffers;
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
     * @param {Texture} texture from GL.Texture
     * @returns {WebGLTexture} New texture that will receive the DDS image data
     */
    function loadDDSTextureFromMemoryEx(gl, ext, data, texture, loadMipmaps) {
		var header = new Int32Array(data, 0, headerLengthInt)
		var is_cubemap = !!(header[off_caps+1] & DDSCAPS2_CUBEMAP);
		var tex_type = is_cubemap ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D;

		var handler = texture.handler || texture;

		gl.bindTexture(tex_type, texture.handler);

		//upload data
		var mipmaps = uploadDDSLevels(gl, ext, data, loadMipmaps);

		gl.texParameteri(tex_type, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(tex_type, gl.TEXTURE_MIN_FILTER, mipmaps > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
        if(is_cubemap)
        {
            gl.texParameteri(tex_type, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE );
            gl.texParameteri(tex_type, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE );
        }

		gl.bindTexture(tex_type, null); //unbind
		if(texture.handler)
		{
			texture.texture_type = tex_type;
			texture.width = header[off_width];
			texture.height = header[off_height];
		}
        return texture;
    }

    /**
     * Extracts the texture info from a DDS file at the given ArrayBuffer.
     *
     * @param {ArrayBuffer} data containing the DDS file
     *
     * @returns {Object} contains mipmaps and properties
     */
    function getDDSTextureFromMemoryEx(data) {
		var header = new Int32Array(data, 0, headerLengthInt)
		var is_cubemap = !!(header[off_caps+1] & DDSCAPS2_CUBEMAP);
		var tex_type = is_cubemap ? "TEXTURE_CUBE_MAP" : "TEXTURE_2D";
		var buffers = getDDSLevels(data);

		var texture = {
			type: tex_type,
			buffers: buffers,
			data: data,
			width: header[off_width],
			height: header[off_height]
		};

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
        var ext = gl.getExtension("WEBGL_compressed_texture_s3tc");
        loadDDSTextureEx(gl, ext, src, texture, true, callback);
        return texture;
    }

    return {
        dxtToRgb565: dxtToRgb565,
        uploadDDSLevels: uploadDDSLevels,
        loadDDSTextureEx: loadDDSTextureEx,
        loadDDSTexture: loadDDSTexture,
		loadDDSTextureFromMemoryEx: loadDDSTextureFromMemoryEx,
		getDDSTextureFromMemoryEx: getDDSTextureFromMemoryEx
    };

})();

if(typeof(global) != "undefined")
	global.DDS = DDS;

"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/bootstrap.ts
  var frameGlobal = globalThis;
  if (typeof glMatrix === "undefined") {
    throw "litegl.js requires gl-matrix to work. It must be included before litegl.";
  } else if (typeof vec2 === "undefined") {
    throw "litegl.js does not support gl-matrix 3.0, download 2.8 https://github.com/toji/gl-matrix/releases/tag/v2.8.1";
  }
  if (!frameGlobal.requestAnimationFrame) {
    frameGlobal.requestAnimationFrame = frameGlobal.mozRequestAnimationFrame || frameGlobal.webkitRequestAnimationFrame || function(callback) {
      return setTimeout(() => callback(Date.now()), 1e3 / 60);
    };
  }

  // src/gl-matrix-extra.ts
  Math.clamp = function(v, a, b) {
    return a > v ? a : b < v ? b : v;
  };
  Math.lerp = function(a, b, f) {
    return a * (1 - f) + b * f;
  };
  Math.lerp01 = function(a, b, f) {
    return Math.clamp(a * (1 - f) + b * f, 0, 1);
  };
  Math.iLerp = function(a, b, v) {
    return (v - a) / (b - a);
  };
  Math.remap = function(v, min, max, min2, max2) {
    return Math.lerp(min2, max2, Math.iLerp(min, max, v));
  };
  vec3.ZERO = vec3.fromValues(0, 0, 0);
  vec3.FRONT = vec3.fromValues(0, 0, -1);
  vec3.UP = vec3.fromValues(0, 1, 0);
  vec3.RIGHT = vec3.fromValues(1, 0, 0);
  vec2.rotate = function(out, vec, angle_in_rad) {
    const x = vec[0], y = vec[1];
    const cos = Math.cos(angle_in_rad);
    const sin = Math.sin(angle_in_rad);
    out[0] = x * cos - y * sin;
    out[1] = x * sin + y * cos;
    return out;
  };
  vec2.perpdot = function(a, b) {
    return a[1] * b[0] + -a[0] * b[1];
  };
  vec2.computeSignedAngle = function(a, b) {
    return Math.atan2(vec2.perpdot(a, b), vec2.dot(a, b));
  };
  vec2.random = function(vec, scale) {
    scale = scale || 1;
    vec[0] = Math.random() * scale;
    vec[1] = Math.random() * scale;
    return vec;
  };
  vec3.zero = function(a) {
    a[0] = a[1] = a[2] = 0;
    return a;
  };
  vec3.minValue = function(a) {
    if (a[0] < a[1] && a[0] < a[2]) return a[0];
    if (a[1] < a[2]) return a[1];
    return a[2];
  };
  vec3.maxValue = function(a) {
    if (a[0] > a[1] && a[0] > a[2]) return a[0];
    if (a[1] > a[2]) return a[1];
    return a[2];
  };
  vec3.addValue = function(out, a, v) {
    out[0] = a[0] + v;
    out[1] = a[1] + v;
    out[2] = a[2] + v;
  };
  vec3.subValue = function(out, a, v) {
    out[0] = a[0] - v;
    out[1] = a[1] - v;
    out[2] = a[2] - v;
  };
  vec3.toArray = function(vec) {
    return [vec[0], vec[1], vec[2]];
  };
  vec3.rotateX = function(out, vec, angle_in_rad) {
    const y = vec[1], z = vec[2];
    const cos = Math.cos(angle_in_rad);
    const sin = Math.sin(angle_in_rad);
    out[0] = vec[0];
    out[1] = y * cos - z * sin;
    out[2] = y * sin + z * cos;
    return out;
  };
  vec3.rotateY = function(out, vec, angle_in_rad) {
    const x = vec[0], z = vec[2];
    const cos = Math.cos(angle_in_rad);
    const sin = Math.sin(angle_in_rad);
    out[0] = x * cos - z * sin;
    out[1] = vec[1];
    out[2] = x * sin + z * cos;
    return out;
  };
  vec3.rotateZ = function(out, vec, angle_in_rad) {
    const x = vec[0], y = vec[1];
    const cos = Math.cos(angle_in_rad);
    const sin = Math.sin(angle_in_rad);
    out[0] = x * cos - y * sin;
    out[1] = x * sin + y * cos;
    out[2] = vec[2];
    return out;
  };
  vec3.angle = function(a, b) {
    return Math.acos(vec3.dot(a, b));
  };
  vec3.signedAngle = function(from, to, axis) {
    const unsignedAngle = vec3.angle(from, to);
    const cross_x = from[1] * to[2] - from[2] * to[1];
    const cross_y = from[2] * to[0] - from[0] * to[2];
    const cross_z = from[0] * to[1] - from[1] * to[0];
    const sign = Math.sign(axis[0] * cross_x + axis[1] * cross_y + axis[2] * cross_z);
    return unsignedAngle * sign;
  };
  vec3.random = function(vec, scale) {
    scale = scale || 1;
    vec[0] = Math.random() * scale;
    vec[1] = Math.random() * scale;
    vec[2] = Math.random() * scale;
    return vec;
  };
  vec3.cartesianToPolar = function(out, v) {
    out = out || vec3.create();
    const x = v[0];
    const y = v[1];
    const z = v[2];
    out[0] = Math.sqrt(x * x + y * y + z * z);
    out[1] = Math.asin(y / out[0]);
    out[2] = Math.atan2(x, z);
    return out;
  };
  vec3.polarToCartesian = function(out, v) {
    const r = v[0];
    const lat = v[1];
    const lon = v[2];
    out[0] = r * Math.cos(lat) * Math.sin(lon);
    out[1] = r * Math.sin(lat);
    out[2] = r * Math.cos(lat) * Math.cos(lon);
    return out;
  };
  vec3.reflect = function(out, v, n) {
    const x = v[0];
    const y = v[1];
    const z = v[2];
    vec3.scale(out, n, -2 * vec3.dot(v, n));
    out[0] += x;
    out[1] += y;
    out[2] += z;
    return out;
  };
  vec4.random = function(vec, scale) {
    scale = scale || 1;
    vec[0] = Math.random() * scale;
    vec[1] = Math.random() * scale;
    vec[2] = Math.random() * scale;
    vec[3] = Math.random() * scale;
    return vec;
  };
  vec4.toArray = function(vec) {
    return [vec[0], vec[1], vec[2], vec[3]];
  };
  mat3.IDENTITY = mat3.create();
  mat4.IDENTITY = mat4.create();
  mat4.toArray = function(mat) {
    return [mat[0], mat[1], mat[2], mat[3], mat[4], mat[5], mat[6], mat[7], mat[8], mat[9], mat[10], mat[11], mat[12], mat[13], mat[14], mat[15]];
  };
  mat4.setUpAndOrthonormalize = function(out, m, up) {
    if (m != out)
      mat4.copy(out, m);
    const right = out.subarray(0, 3);
    vec3.normalize(out.subarray(4, 7), up);
    const front = out.subarray(8, 11);
    vec3.cross(right, up, front);
    vec3.normalize(right, right);
    vec3.cross(front, right, up);
    vec3.normalize(front, front);
  };
  mat4.multiplyVec3 = function(out, m, a) {
    const x = a[0], y = a[1], z = a[2];
    out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    return out;
  };
  mat4.projectVec3 = function(out, m, a) {
    const ix = a[0];
    const iy = a[1];
    const iz = a[2];
    const ox = m[0] * ix + m[4] * iy + m[8] * iz + m[12];
    const oy = m[1] * ix + m[5] * iy + m[9] * iz + m[13];
    const oz = m[2] * ix + m[6] * iy + m[10] * iz + m[14];
    const ow = m[3] * ix + m[7] * iy + m[11] * iz + m[15];
    out[0] = (ox / ow + 1) / 2;
    out[1] = (oy / ow + 1) / 2;
    out[2] = (oz / ow + 1) / 2;
    return out;
  };
  vec3.project = function(out, vec, mvp, viewport) {
    viewport = viewport || globalThis.gl.viewport_data;
    const m = mvp;
    const ix = vec[0];
    const iy = vec[1];
    const iz = vec[2];
    const ox = m[0] * ix + m[4] * iy + m[8] * iz + m[12];
    const oy = m[1] * ix + m[5] * iy + m[9] * iz + m[13];
    const oz = m[2] * ix + m[6] * iy + m[10] * iz + m[14];
    const ow = m[3] * ix + m[7] * iy + m[11] * iz + m[15];
    const projx = (ox / ow + 1) / 2;
    const projy = 1 - (oy / ow + 1) / 2;
    const projz = (oz / ow + 1) / 2;
    out[0] = projx * viewport[2] + viewport[0];
    out[1] = projy * viewport[3] + viewport[1];
    out[2] = projz;
    return out;
  };
  var unprojectMat = mat4.create();
  var unprojectVec = vec4.create();
  vec3.unproject = function(out, vec, viewprojection, viewport) {
    const m = unprojectMat;
    const v = unprojectVec;
    v[0] = (vec[0] - viewport[0]) * 2 / viewport[2] - 1;
    v[1] = (vec[1] - viewport[1]) * 2 / viewport[3] - 1;
    v[2] = 2 * vec[2] - 1;
    v[3] = 1;
    if (!mat4.invert(m, viewprojection))
      return null;
    vec4.transformMat4(v, v, m);
    if (v[3] === 0)
      return null;
    out[0] = v[0] / v[3];
    out[1] = v[1] / v[3];
    out[2] = v[2] / v[3];
    return out;
  };
  mat4.rotateVec3 = function(out, m, a) {
    const x = a[0], y = a[1], z = a[2];
    out[0] = m[0] * x + m[4] * y + m[8] * z;
    out[1] = m[1] * x + m[5] * y + m[9] * z;
    out[2] = m[2] * x + m[6] * y + m[10] * z;
    return out;
  };
  mat4.fromTranslationFrontTop = function(out, pos, front, top) {
    vec3.cross(out.subarray(0, 3), front, top);
    out.set(top, 4);
    out.set(front, 8);
    out.set(pos, 12);
    return out;
  };
  mat4.translationMatrix = function(v) {
    const out = mat4.create();
    out[12] = v[0];
    out[13] = v[1];
    out[14] = v[2];
    return out;
  };
  mat4.setTranslation = function(out, v) {
    out[12] = v[0];
    out[13] = v[1];
    out[14] = v[2];
    return out;
  };
  mat4.getTranslation = function(out, matrix) {
    out[0] = matrix[12];
    out[1] = matrix[13];
    out[2] = matrix[14];
    return out;
  };
  mat4.toRotationMat4 = function(out, mat) {
    mat4.copy(out, mat);
    out[12] = out[13] = out[14] = 0;
    return out;
  };
  mat4.swapRows = function(out, mat, row, row2) {
    if (out != mat) {
      mat4.copy(out, mat);
      out[4 * row] = mat[4 * row2];
      out[4 * row + 1] = mat[4 * row2 + 1];
      out[4 * row + 2] = mat[4 * row2 + 2];
      out[4 * row + 3] = mat[4 * row2 + 3];
      out[4 * row2] = mat[4 * row];
      out[4 * row2 + 1] = mat[4 * row + 1];
      out[4 * row2 + 2] = mat[4 * row + 2];
      out[4 * row2 + 3] = mat[4 * row + 3];
      return out;
    }
    const temp = new Float32Array(mat.subarray(row * 4, row * 5));
    mat.set(mat.subarray(row2 * 4, row2 * 5), row * 4);
    mat.set(temp, row2 * 4);
    return out;
  };
  mat4.scaleAndAdd = function(out, mat, mat2, v) {
    out[0] = mat[0] + mat2[0] * v;
    out[1] = mat[1] + mat2[1] * v;
    out[2] = mat[2] + mat2[2] * v;
    out[3] = mat[3] + mat2[3] * v;
    out[4] = mat[4] + mat2[4] * v;
    out[5] = mat[5] + mat2[5] * v;
    out[6] = mat[6] + mat2[6] * v;
    out[7] = mat[7] + mat2[7] * v;
    out[8] = mat[8] + mat2[8] * v;
    out[9] = mat[9] + mat2[9] * v;
    out[10] = mat[10] + mat2[10] * v;
    out[11] = mat[11] + mat2[11] * v;
    out[12] = mat[12] + mat2[12] * v;
    out[13] = mat[13] + mat2[13] * v;
    out[14] = mat[14] + mat2[14] * v;
    out[15] = mat[15] + mat2[15] * v;
    return out;
  };
  quat.fromAxisAngle = function(axis, rad) {
    const out = quat.create();
    rad = rad * 0.5;
    const s = Math.sin(rad);
    out[0] = s * axis[0];
    out[1] = s * axis[1];
    out[2] = s * axis[2];
    out[3] = Math.cos(rad);
    return out;
  };
  quat.lookRotation = (function() {
    const vector = vec3.create();
    const vector2 = vec3.create();
    const vector3 = vec3.create();
    return function(q, front, up) {
      vec3.normalize(vector, front);
      vec3.cross(vector2, up, vector);
      vec3.normalize(vector2, vector2);
      vec3.cross(vector3, vector, vector2);
      const m00 = vector2[0];
      const m01 = vector2[1];
      const m02 = vector2[2];
      const m10 = vector3[0];
      const m11 = vector3[1];
      const m12 = vector3[2];
      const m20 = vector[0];
      const m21 = vector[1];
      const m22 = vector[2];
      const num8 = m00 + m11 + m22;
      if (num8 > 0) {
        let num = Math.sqrt(num8 + 1);
        q[3] = num * 0.5;
        num = 0.5 / num;
        q[0] = (m12 - m21) * num;
        q[1] = (m20 - m02) * num;
        q[2] = (m01 - m10) * num;
        return q;
      }
      if (m00 >= m11 && m00 >= m22) {
        const num7 = Math.sqrt(1 + m00 - m11 - m22);
        const num4 = 0.5 / num7;
        q[0] = 0.5 * num7;
        q[1] = (m01 + m10) * num4;
        q[2] = (m02 + m20) * num4;
        q[3] = (m12 - m21) * num4;
        return q;
      }
      if (m11 > m22) {
        const num6 = Math.sqrt(1 + m11 - m00 - m22);
        const num3 = 0.5 / num6;
        q[0] = (m10 + m01) * num3;
        q[1] = 0.5 * num6;
        q[2] = (m21 + m12) * num3;
        q[3] = (m20 - m02) * num3;
        return q;
      }
      const num5 = Math.sqrt(1 + m22 - m00 - m11);
      const num2 = 0.5 / num5;
      q[0] = (m20 + m02) * num2;
      q[1] = (m21 + m12) * num2;
      q[2] = 0.5 * num5;
      q[3] = (m01 - m10) * num2;
      return q;
    };
  })();
  quat.toEuler = function(out, q) {
    const heading = Math.atan2(2 * q[1] * q[3] - 2 * q[0] * q[2], 1 - 2 * q[1] * q[1] - 2 * q[2] * q[2]);
    const attitude = Math.asin(2 * q[0] * q[1] + 2 * q[2] * q[3]);
    const bank = Math.atan2(2 * q[0] * q[3] - 2 * q[1] * q[2], 1 - 2 * q[0] * q[0] - 2 * q[2] * q[2]);
    if (!out)
      out = vec3.create();
    vec3.set(out, heading, attitude, bank);
    return out;
  };
  quat.fromEuler = function(out, vec) {
    const heading = vec[0];
    const attitude = vec[1];
    const bank = vec[2];
    const C1 = Math.cos(heading);
    const C2 = Math.cos(attitude);
    const C3 = Math.cos(bank);
    const S1 = Math.sin(heading);
    const S2 = Math.sin(attitude);
    const S3 = Math.sin(bank);
    let w = Math.sqrt(1 + C1 * C2 + C1 * C3 - S1 * S2 * S3 + C2 * C3) * 0.5;
    if (w == 0) {
      w = 1e-6;
    }
    const x = (C2 * S3 + C1 * S3 + S1 * S2 * C3) / (4 * w);
    const y = (S1 * C2 + S1 * C3 + C1 * S2 * S3) / (4 * w);
    const z = (-S1 * S3 + C1 * S2 * C3 + S2) / (4 * w);
    quat.set(out, x, y, z, w);
    quat.normalize(out, out);
    return out;
  };
  quat.fromMat4 = function(out, m) {
    const trace = m[0] + m[5] + m[10];
    if (trace > 0) {
      const s = Math.sqrt(trace + 1);
      out[3] = s * 0.5;
      const recip = 0.5 / s;
      out[0] = (m[9] - m[6]) * recip;
      out[1] = (m[8] - m[2]) * recip;
      out[2] = (m[4] - m[1]) * recip;
    } else {
      let i = 0;
      if (m[5] > m[0])
        i = 1;
      if (m[10] > m[i * 4 + i])
        i = 2;
      const j = (i + 1) % 3;
      const k = (j + 1) % 3;
      const s = Math.sqrt(m[i * 4 + i] - m[j * 4 + j] - m[k * 4 + k] + 1);
      out[i] = 0.5 * s;
      const recip = 0.5 / s;
      out[3] = (m[k * 4 + j] - m[j * 4 + k]) * recip;
      out[j] = (m[j * 4 + i] + m[i * 4 + j]) * recip;
      out[k] = (m[k * 4 + i] + m[i * 4 + k]) * recip;
    }
    quat.normalize(out, out);
  };
  vec3.getMat3Column = function(out, m, index) {
    out[0] = m[index * 3];
    out[1] = m[index * 3 + 1];
    out[2] = m[index * 3 + 2];
    return out;
  };
  mat3.setColumn = function(out, v, index) {
    out[index * 3] = v[0];
    out[index * 3 + 1] = v[1];
    out[index * 3 + 2] = v[2];
    return out;
  };
  quat.fromMat3AndQuat = (function() {
    const temp_mat32 = mat3.create();
    const temp_quat2 = quat.create();
    const Rcol0 = vec3.create();
    const Rcol1 = vec3.create();
    const Rcol2 = vec3.create();
    const Acol0 = vec3.create();
    const Acol1 = vec3.create();
    const Acol2 = vec3.create();
    const RAcross0 = vec3.create();
    const RAcross1 = vec3.create();
    const RAcross2 = vec3.create();
    const omega = vec3.create();
    return function(q, A, max_iter) {
      max_iter = max_iter || 25;
      for (let iter = 0; iter < max_iter; ++iter) {
        const R = mat3.fromQuat(temp_mat32, q);
        vec3.getMat3Column(Rcol0, R, 0);
        vec3.getMat3Column(Rcol1, R, 1);
        vec3.getMat3Column(Rcol2, R, 2);
        vec3.getMat3Column(Acol0, A, 0);
        vec3.getMat3Column(Acol1, A, 1);
        vec3.getMat3Column(Acol2, A, 2);
        vec3.cross(RAcross0, Rcol0, Acol0);
        vec3.cross(RAcross1, Rcol1, Acol1);
        vec3.cross(RAcross2, Rcol2, Acol2);
        vec3.add(omega, RAcross0, RAcross1);
        vec3.add(omega, omega, RAcross2);
        const d = 1 / Math.abs(vec3.dot(Rcol0, Acol0) + vec3.dot(Rcol1, Acol1) + vec3.dot(Rcol2, Acol2)) + 1e-9;
        vec3.scale(omega, omega, d);
        const w = vec3.length(omega);
        if (w < 1e-9)
          break;
        vec3.scale(omega, omega, 1 / w);
        quat.setAxisAngle(temp_quat2, omega, w);
        quat.mul(q, temp_quat2, q);
        quat.normalize(q, q);
      }
      return q;
    };
  })();
  quat.rotateToFrom = (function() {
    const tmp = vec3.create();
    return function(out, v1, v2) {
      out = out || quat.create();
      const axis = vec3.cross(tmp, v1, v2);
      const dot = vec3.dot(v1, v2);
      if (dot < -1 + 0.01) {
        out[0] = 0;
        out[1] = 1;
        out[2] = 0;
        out[3] = 0;
        return out;
      }
      out[0] = axis[0] * 0.5;
      out[1] = axis[1] * 0.5;
      out[2] = axis[2] * 0.5;
      out[3] = (1 + dot) * 0.5;
      quat.normalize(out, out);
      return out;
    };
  })();
  quat.lookAt = (function() {
    const axis = vec3.create();
    return function(out, forwardVector, up) {
      const dot = vec3.dot(vec3.FRONT, forwardVector);
      if (Math.abs(dot - -1) < 1e-6) {
        out.set(vec3.UP);
        out[3] = Math.PI;
        return out;
      }
      if (Math.abs(dot - 1) < 1e-6) {
        return quat.identity(out);
      }
      const rotAngle = Math.acos(dot);
      vec3.cross(axis, vec3.FRONT, forwardVector);
      vec3.normalize(axis, axis);
      quat.setAxisAngle(out, axis, rotAngle);
      return out;
    };
  })();

  // src/constants.ts
  var constants_exports = {};
  __export(constants_exports, {
    ALPHA: () => ALPHA,
    ALWAYS: () => ALWAYS,
    ARRAY_BUFFER: () => ARRAY_BUFFER,
    BACK: () => BACK,
    BLEND: () => BLEND,
    BOOL: () => BOOL,
    BOOL_VEC2: () => BOOL_VEC2,
    BOOL_VEC3: () => BOOL_VEC3,
    BOOL_VEC4: () => BOOL_VEC4,
    BYTE: () => BYTE,
    CCW: () => CCW,
    CLAMP_TO_EDGE: () => CLAMP_TO_EDGE,
    COLOR_BUFFER_BIT: () => COLOR_BUFFER_BIT,
    CONSTANT_ALPHA: () => CONSTANT_ALPHA,
    CONSTANT_COLOR: () => CONSTANT_COLOR,
    CULL_FACE: () => CULL_FACE,
    CW: () => CW,
    DECR: () => DECR,
    DECR_WRAP: () => DECR_WRAP,
    DEPTH24_STENCIL8: () => DEPTH24_STENCIL8,
    DEPTH_BUFFER_BIT: () => DEPTH_BUFFER_BIT,
    DEPTH_COMPONENT: () => DEPTH_COMPONENT,
    DEPTH_COMPONENT16: () => DEPTH_COMPONENT16,
    DEPTH_COMPONENT24: () => DEPTH_COMPONENT24,
    DEPTH_COMPONENT32F: () => DEPTH_COMPONENT32F,
    DEPTH_STENCIL: () => DEPTH_STENCIL,
    DEPTH_TEST: () => DEPTH_TEST,
    DST_ALPHA: () => DST_ALPHA,
    DST_COLOR: () => DST_COLOR,
    DYNAMIC_DRAW: () => DYNAMIC_DRAW,
    ELEMENT_ARRAY_BUFFER: () => ELEMENT_ARRAY_BUFFER,
    EQUAL: () => EQUAL,
    FLOAT: () => FLOAT,
    FLOAT_MAT2: () => FLOAT_MAT2,
    FLOAT_MAT3: () => FLOAT_MAT3,
    FLOAT_MAT4: () => FLOAT_MAT4,
    FLOAT_VEC2: () => FLOAT_VEC2,
    FLOAT_VEC3: () => FLOAT_VEC3,
    FLOAT_VEC4: () => FLOAT_VEC4,
    FRAGMENT_SHADER: () => FRAGMENT_SHADER,
    FRONT: () => FRONT,
    FRONT_AND_BACK: () => FRONT_AND_BACK,
    GEQUAL: () => GEQUAL,
    GREATER: () => GREATER,
    HALF_FLOAT: () => HALF_FLOAT,
    HALF_FLOAT_OES: () => HALF_FLOAT_OES,
    INCR: () => INCR,
    INCR_WRAP: () => INCR_WRAP,
    INT: () => INT,
    INT_SAMPLER_2D: () => INT_SAMPLER_2D,
    INT_SAMPLER_3D: () => INT_SAMPLER_3D,
    INT_SAMPLER_CUBE: () => INT_SAMPLER_CUBE,
    INT_VEC2: () => INT_VEC2,
    INT_VEC3: () => INT_VEC3,
    INT_VEC4: () => INT_VEC4,
    INVERT: () => INVERT,
    KEEP: () => KEEP,
    LEFT_MOUSE_BUTTON: () => LEFT_MOUSE_BUTTON,
    LEFT_MOUSE_BUTTON_MASK: () => LEFT_MOUSE_BUTTON_MASK,
    LEQUAL: () => LEQUAL,
    LESS: () => LESS,
    LINEAR: () => LINEAR,
    LINEAR_MIPMAP_LINEAR: () => LINEAR_MIPMAP_LINEAR,
    LINEAR_MIPMAP_NEAREST: () => LINEAR_MIPMAP_NEAREST,
    LINES: () => LINES,
    LINE_LOOP: () => LINE_LOOP,
    LINE_STRIP: () => LINE_STRIP,
    LUMINANCE: () => LUMINANCE,
    LUMINANCE_ALPHA: () => LUMINANCE_ALPHA,
    MIDDLE_MOUSE_BUTTON: () => MIDDLE_MOUSE_BUTTON,
    MIDDLE_MOUSE_BUTTON_MASK: () => MIDDLE_MOUSE_BUTTON_MASK,
    MIRRORED_REPEAT: () => MIRRORED_REPEAT,
    NEAREST: () => NEAREST,
    NEAREST_MIPMAP_LINEAR: () => NEAREST_MIPMAP_LINEAR,
    NEAREST_MIPMAP_NEAREST: () => NEAREST_MIPMAP_NEAREST,
    NEVER: () => NEVER,
    NOTEQUAL: () => NOTEQUAL,
    ONE: () => ONE,
    ONE_MINUS_CONSTANT_ALPHA: () => ONE_MINUS_CONSTANT_ALPHA,
    ONE_MINUS_CONSTANT_COLOR: () => ONE_MINUS_CONSTANT_COLOR,
    ONE_MINUS_DST_ALPHA: () => ONE_MINUS_DST_ALPHA,
    ONE_MINUS_DST_COLOR: () => ONE_MINUS_DST_COLOR,
    ONE_MINUS_SRC_ALPHA: () => ONE_MINUS_SRC_ALPHA,
    ONE_MINUS_SRC_COLOR: () => ONE_MINUS_SRC_COLOR,
    POINTS: () => POINTS,
    R11F_G11F_B10F: () => R11F_G11F_B10F,
    R16F: () => R16F,
    R32F: () => R32F,
    R8: () => R8,
    R8UI: () => R8UI,
    REPEAT: () => REPEAT,
    REPLACE: () => REPLACE,
    RG16F: () => RG16F,
    RG32F: () => RG32F,
    RG8: () => RG8,
    RGB: () => RGB,
    RGB16F: () => RGB16F,
    RGB32F: () => RGB32F,
    RGB565: () => RGB565,
    RGB5_A1: () => RGB5_A1,
    RGB8: () => RGB8,
    RGB8UI: () => RGB8UI,
    RGB9_E5: () => RGB9_E5,
    RGBA: () => RGBA,
    RGBA16F: () => RGBA16F,
    RGBA16I: () => RGBA16I,
    RGBA16UI: () => RGBA16UI,
    RGBA32F: () => RGBA32F,
    RGBA32I: () => RGBA32I,
    RGBA32UI: () => RGBA32UI,
    RGBA8: () => RGBA8,
    RGBA8UI: () => RGBA8UI,
    RIGHT_MOUSE_BUTTON: () => RIGHT_MOUSE_BUTTON,
    RIGHT_MOUSE_BUTTON_MASK: () => RIGHT_MOUSE_BUTTON_MASK,
    SAMPLER_2D: () => SAMPLER_2D,
    SAMPLER_3D: () => SAMPLER_3D,
    SAMPLER_CUBE: () => SAMPLER_CUBE,
    SHORT: () => SHORT,
    SRC_ALPHA: () => SRC_ALPHA,
    SRC_ALPHA_SATURATE: () => SRC_ALPHA_SATURATE,
    SRC_COLOR: () => SRC_COLOR,
    SRGB8: () => SRGB8,
    STATIC_DRAW: () => STATIC_DRAW,
    STENCIL_BUFFER_BIT: () => STENCIL_BUFFER_BIT,
    STREAM_DRAW: () => STREAM_DRAW,
    TEXTURE_2D: () => TEXTURE_2D,
    TEXTURE_3D: () => TEXTURE_3D,
    TEXTURE_CUBE_MAP: () => TEXTURE_CUBE_MAP,
    TEXTURE_MAG_FILTER: () => TEXTURE_MAG_FILTER,
    TEXTURE_MIN_FILTER: () => TEXTURE_MIN_FILTER,
    TEXTURE_WRAP_S: () => TEXTURE_WRAP_S,
    TEXTURE_WRAP_T: () => TEXTURE_WRAP_T,
    TRIANGLES: () => TRIANGLES,
    TRIANGLE_FAN: () => TRIANGLE_FAN,
    TRIANGLE_STRIP: () => TRIANGLE_STRIP,
    TYPE_LENGTH: () => TYPE_LENGTH,
    UNSIGNED_BYTE: () => UNSIGNED_BYTE,
    UNSIGNED_INT: () => UNSIGNED_INT,
    UNSIGNED_INT_24_8: () => UNSIGNED_INT_24_8,
    UNSIGNED_INT_24_8_WEBGL: () => UNSIGNED_INT_24_8_WEBGL,
    UNSIGNED_INT_SAMPLER_2D: () => UNSIGNED_INT_SAMPLER_2D,
    UNSIGNED_INT_SAMPLER_3D: () => UNSIGNED_INT_SAMPLER_3D,
    UNSIGNED_INT_SAMPLER_CUBE: () => UNSIGNED_INT_SAMPLER_CUBE,
    UNSIGNED_SHORT: () => UNSIGNED_SHORT,
    VERTEX_SHADER: () => VERTEX_SHADER,
    ZERO: () => ZERO,
    blockable_keys: () => blockable_keys
  });
  var COLOR_BUFFER_BIT = 16384;
  var DEPTH_BUFFER_BIT = 256;
  var STENCIL_BUFFER_BIT = 1024;
  var TEXTURE_2D = 3553;
  var TEXTURE_CUBE_MAP = 34067;
  var TEXTURE_3D = 32879;
  var TEXTURE_MAG_FILTER = 10240;
  var TEXTURE_MIN_FILTER = 10241;
  var TEXTURE_WRAP_S = 10242;
  var TEXTURE_WRAP_T = 10243;
  var BYTE = 5120;
  var UNSIGNED_BYTE = 5121;
  var SHORT = 5122;
  var UNSIGNED_SHORT = 5123;
  var INT = 5124;
  var UNSIGNED_INT = 5125;
  var FLOAT = 5126;
  var HALF_FLOAT_OES = 36193;
  var HALF_FLOAT = 5131;
  var DEPTH_COMPONENT16 = 33189;
  var DEPTH_COMPONENT24 = 33190;
  var DEPTH_COMPONENT32F = 36012;
  var FLOAT_VEC2 = 35664;
  var FLOAT_VEC3 = 35665;
  var FLOAT_VEC4 = 35666;
  var INT_VEC2 = 35667;
  var INT_VEC3 = 35668;
  var INT_VEC4 = 35669;
  var BOOL = 35670;
  var BOOL_VEC2 = 35671;
  var BOOL_VEC3 = 35672;
  var BOOL_VEC4 = 35673;
  var FLOAT_MAT2 = 35674;
  var FLOAT_MAT3 = 35675;
  var FLOAT_MAT4 = 35676;
  var SAMPLER_2D = 35678;
  var SAMPLER_3D = 35679;
  var SAMPLER_CUBE = 35680;
  var INT_SAMPLER_2D = 36298;
  var INT_SAMPLER_3D = 36299;
  var INT_SAMPLER_CUBE = 36300;
  var UNSIGNED_INT_SAMPLER_2D = 36306;
  var UNSIGNED_INT_SAMPLER_3D = 36307;
  var UNSIGNED_INT_SAMPLER_CUBE = 36308;
  var DEPTH_COMPONENT = 6402;
  var ALPHA = 6406;
  var RGB = 6407;
  var RGBA = 6408;
  var LUMINANCE = 6409;
  var LUMINANCE_ALPHA = 6410;
  var DEPTH_STENCIL = 34041;
  var UNSIGNED_INT_24_8 = 34042;
  var UNSIGNED_INT_24_8_WEBGL = 34042;
  var R8 = 33321;
  var R16F = 33325;
  var R32F = 33326;
  var R8UI = 33330;
  var RG8 = 33323;
  var RG16F = 33327;
  var RG32F = 33328;
  var RGB8 = 32849;
  var SRGB8 = 35905;
  var RGB565 = 36194;
  var R11F_G11F_B10F = 35898;
  var RGB9_E5 = 35901;
  var RGB16F = 34843;
  var RGB32F = 34837;
  var RGB8UI = 36221;
  var RGBA8 = 32856;
  var RGB5_A1 = 32855;
  var RGBA16F = 34842;
  var RGBA32F = 34836;
  var RGBA8UI = 36220;
  var RGBA16I = 36232;
  var RGBA16UI = 36214;
  var RGBA32I = 36226;
  var RGBA32UI = 36208;
  var DEPTH24_STENCIL8 = 35056;
  var NEAREST = 9728;
  var LINEAR = 9729;
  var NEAREST_MIPMAP_NEAREST = 9984;
  var LINEAR_MIPMAP_NEAREST = 9985;
  var NEAREST_MIPMAP_LINEAR = 9986;
  var LINEAR_MIPMAP_LINEAR = 9987;
  var REPEAT = 10497;
  var CLAMP_TO_EDGE = 33071;
  var MIRRORED_REPEAT = 33648;
  var ZERO = 0;
  var ONE = 1;
  var SRC_COLOR = 768;
  var ONE_MINUS_SRC_COLOR = 769;
  var SRC_ALPHA = 770;
  var ONE_MINUS_SRC_ALPHA = 771;
  var DST_ALPHA = 772;
  var ONE_MINUS_DST_ALPHA = 773;
  var DST_COLOR = 774;
  var ONE_MINUS_DST_COLOR = 775;
  var SRC_ALPHA_SATURATE = 776;
  var CONSTANT_COLOR = 32769;
  var ONE_MINUS_CONSTANT_COLOR = 32770;
  var CONSTANT_ALPHA = 32771;
  var ONE_MINUS_CONSTANT_ALPHA = 32772;
  var VERTEX_SHADER = 35633;
  var FRAGMENT_SHADER = 35632;
  var FRONT = 1028;
  var BACK = 1029;
  var FRONT_AND_BACK = 1032;
  var NEVER = 512;
  var LESS = 513;
  var EQUAL = 514;
  var LEQUAL = 515;
  var GREATER = 516;
  var NOTEQUAL = 517;
  var GEQUAL = 518;
  var ALWAYS = 519;
  var KEEP = 7680;
  var REPLACE = 7681;
  var INCR = 7682;
  var DECR = 7683;
  var INCR_WRAP = 34055;
  var DECR_WRAP = 34056;
  var INVERT = 5386;
  var STREAM_DRAW = 35040;
  var STATIC_DRAW = 35044;
  var DYNAMIC_DRAW = 35048;
  var ARRAY_BUFFER = 34962;
  var ELEMENT_ARRAY_BUFFER = 34963;
  var POINTS = 0;
  var LINES = 1;
  var LINE_LOOP = 2;
  var LINE_STRIP = 3;
  var TRIANGLES = 4;
  var TRIANGLE_STRIP = 5;
  var TRIANGLE_FAN = 6;
  var CW = 2304;
  var CCW = 2305;
  var CULL_FACE = 2884;
  var DEPTH_TEST = 2929;
  var BLEND = 3042;
  var LEFT_MOUSE_BUTTON = 0;
  var MIDDLE_MOUSE_BUTTON = 1;
  var RIGHT_MOUSE_BUTTON = 2;
  var LEFT_MOUSE_BUTTON_MASK = 1;
  var RIGHT_MOUSE_BUTTON_MASK = 2;
  var MIDDLE_MOUSE_BUTTON_MASK = 4;
  var blockable_keys = {
    Up: true,
    Down: true,
    Left: true,
    Right: true
  };
  var TYPE_LENGTH = {};
  TYPE_LENGTH[FLOAT] = TYPE_LENGTH[INT] = TYPE_LENGTH[BYTE] = TYPE_LENGTH[BOOL] = 1;
  TYPE_LENGTH[FLOAT_VEC2] = TYPE_LENGTH[INT_VEC2] = TYPE_LENGTH[BOOL_VEC2] = 2;
  TYPE_LENGTH[FLOAT_VEC3] = TYPE_LENGTH[INT_VEC3] = TYPE_LENGTH[BOOL_VEC3] = 3;
  TYPE_LENGTH[FLOAT_VEC4] = TYPE_LENGTH[INT_VEC4] = TYPE_LENGTH[BOOL_VEC4] = 4;
  TYPE_LENGTH[FLOAT_MAT3] = 9;
  TYPE_LENGTH[FLOAT_MAT4] = 16;

  // src/levent.ts
  var LEvent = {
    /**
     * Binds an event to an instance
     * @method LEvent.bind
     * @param {Object} instance where to attach the event
     * @param {String} event_name string defining the event name
     * @param {function} callback function to call when the event is triggered
     * @param {Object} target_instance [Optional] instance to call the function (use this instead of .bind method to help removing events)
     **/
    bind(instance, event_type, callback, target_instance) {
      if (!instance)
        throw "cannot bind event to null";
      if (!callback)
        throw "cannot bind to null callback";
      if (instance.constructor === String)
        throw "cannot bind event to a string";
      const target = instance;
      let events = target.__levents;
      if (!events) {
        Object.defineProperty(target, "__levents", { value: {}, enumerable: false });
        events = target.__levents;
      }
      if (Object.prototype.hasOwnProperty.call(events, event_type))
        events[event_type].push([callback, target_instance]);
      else
        events[event_type] = [[callback, target_instance]];
      if (target.onLEventBinded)
        target.onLEventBinded(event_type, callback, target_instance);
    },
    /**
     * Unbinds an event from an instance
     * @method LEvent.unbind
     * @param {Object} instance where the event is binded
     * @param {String} event_name string defining the event name
     * @param {function} callback function that was binded
     * @param {Object} target_instance [Optional] target_instance that was binded
     **/
    unbind(instance, event_type, callback, target_instance) {
      if (!instance)
        throw "cannot unbind event to null";
      if (!callback)
        throw "cannot unbind from null callback";
      if (instance.constructor === String)
        throw "cannot bind event to a string";
      const target = instance;
      const events = target.__levents;
      if (!events)
        return;
      if (!Object.prototype.hasOwnProperty.call(events, event_type))
        return;
      for (let i = 0, l = events[event_type].length; i < l; ++i) {
        const v = events[event_type][i];
        if (v[0] === callback && v[1] === target_instance) {
          events[event_type].splice(i, 1);
          break;
        }
      }
      if (events[event_type].length == 0)
        delete events[event_type];
      if (target.onLEventUnbinded)
        target.onLEventUnbinded(event_type, callback, target_instance);
    },
    /**
     * Unbinds all events from an instance (or the ones that match certain target_instance)
     * @method LEvent.unbindAll
     * @param {Object} instance where the events are binded
     * @param {Object} target_instance [Optional] target_instance of the events to remove
     **/
    unbindAll(instance, target_instance, callback) {
      if (!instance)
        throw "cannot unbind events in null";
      const target = instance;
      const events = target.__levents;
      if (!events)
        return;
      if (target.onLEventUnbindAll)
        target.onLEventUnbindAll(target_instance, callback);
      if (!target_instance) {
        delete target.__levents;
        return;
      }
      for (const i in events) {
        const array = events[i];
        for (let j = array.length - 1; j >= 0; --j) {
          if (array[j][1] != target_instance || callback && callback !== array[j][0])
            continue;
          array.splice(j, 1);
        }
      }
    },
    /**
     * Unbinds all callbacks associated to one specific event from this instance
     * @method LEvent.unbindAllEvent
     * @param {Object} instance where the events are binded
     * @param {String} event name of the event you want to remove all binds
     **/
    unbindAllEvent(instance, event_type) {
      if (!instance)
        throw "cannot unbind events in null";
      const target = instance;
      const events = target.__levents;
      if (!events)
        return;
      delete events[event_type];
      if (target.onLEventUnbindAll)
        target.onLEventUnbindAll(event_type, void 0, void 0);
      return;
    },
    /**
     * Tells if there is a binded callback that matches the criteria
     * @method LEvent.isBind
     * @param {Object} instance where the are the events binded
     * @param {String} event_name string defining the event name
     * @param {function} callback the callback
     * @param {Object} target_instance [Optional] instance binded to callback
     **/
    isBind(instance, event_type, callback, target_instance) {
      if (!instance)
        throw "LEvent cannot have null as instance";
      const events = instance.__levents;
      if (!events)
        return;
      if (!Object.prototype.hasOwnProperty.call(events, event_type))
        return false;
      for (let i = 0, l = events[event_type].length; i < l; ++i) {
        const v = events[event_type][i];
        if (v[0] === callback && v[1] === target_instance)
          return true;
      }
      return false;
    },
    /**
     * Tells if there is any callback binded to this event
     * @method LEvent.hasBind
     * @param {Object} instance where the are the events binded
     * @param {String} event_name string defining the event name
     * @return {boolean} true is there is at least one
     **/
    hasBind(instance, event_type) {
      if (!instance)
        throw "LEvent cannot have null as instance";
      const events = instance.__levents;
      if (!events || !Object.prototype.hasOwnProperty.call(events, event_type) || !events[event_type].length)
        return false;
      return true;
    },
    /**
     * Tells if there is any callback binded to this object pointing to a method in the target object
     * @method LEvent.hasBindTo
     * @param {Object} instance where there are the events binded
     * @param {Object} target instance to check to
     * @return {boolean} true is there is at least one
     **/
    hasBindTo(instance, target) {
      if (!instance)
        throw "LEvent cannot have null as instance";
      const events = instance.__levents;
      if (!events)
        return false;
      for (const j in events) {
        const binds = events[j];
        for (let i = 0; i < binds.length; ++i) {
          if (binds[i][1] === target)
            return true;
        }
      }
      return false;
    },
    /**
     * Triggers and event in an instance
     * If the callback returns true then it will stop the propagation and return true
     * @method LEvent.trigger
     * @param {Object} instance that triggers the event
     * @param {String} event_name string defining the event name
     * @param {*} parameters that will be received by the binded function
     * @param {bool} reverse_order trigger in reverse order (binded last get called first)
     * @param {bool} expand_parameters parameters are passed not as one single parameter, but as many
     * return {bool} true if the event passed was blocked by any binded callback
     **/
    trigger(instance, event_type, params, reverse_order, expand_parameters) {
      if (!instance)
        throw "cannot trigger event from null";
      if (instance.constructor === String)
        throw "cannot bind event to a string";
      const events = instance.__levents;
      if (!events || !Object.prototype.hasOwnProperty.call(events, event_type))
        return false;
      const inst = events[event_type];
      if (reverse_order) {
        for (let i = inst.length - 1; i >= 0; --i) {
          const v = inst[i];
          if (expand_parameters) {
            if (v && v[0].apply(v[1], params) === true)
              return true;
          } else {
            if (v && v[0].call(v[1], event_type, params) === true)
              return true;
          }
        }
      } else {
        for (let i = 0, l = inst.length; i < l; ++i) {
          const v = inst[i];
          if (expand_parameters) {
            if (v && v[0].apply(v[1], params) === true)
              return true;
          } else {
            if (v && v[0].call(v[1], event_type, params) === true)
              return true;
          }
        }
      }
      return false;
    },
    /**
     * Triggers and event to every element in an array.
     * If the event returns true, it must be intercepted
     * @method LEvent.triggerArray
     * @param {Array} array contains all instances to triggers the event
     * @param {String} event_name string defining the event name
     * @param {*} parameters that will be received by the binded function
     * @param {bool} reverse_order trigger in reverse order (binded last get called first)
     * @param {bool} expand_parameters parameters are passed not as one single parameter, but as many
     * return {bool} false
     **/
    triggerArray(instances, event_type, params, reverse_order, expand_parameters) {
      let blocked = false;
      for (let i = 0, l = instances.length; i < l; ++i) {
        const instance = instances[i];
        if (!instance)
          throw "cannot trigger event from null";
        if (instance.constructor === String)
          throw "cannot bind event to a string";
        const events = instance.__levents;
        if (!events || !Object.prototype.hasOwnProperty.call(events, event_type))
          continue;
        if (reverse_order) {
          for (let j = events[event_type].length - 1; j >= 0; --j) {
            const v = events[event_type][j];
            if (expand_parameters) {
              if (v[0].apply(v[1], params) === true) {
                blocked = true;
                break;
              }
            } else {
              if (v[0].call(v[1], event_type, params) === true) {
                blocked = true;
                break;
              }
            }
          }
        } else {
          for (let j = 0, ll = events[event_type].length; j < ll; ++j) {
            const v = events[event_type][j];
            if (expand_parameters) {
              if (v[0].apply(v[1], params) === true) {
                blocked = true;
                break;
              }
            } else {
              if (v[0].call(v[1], event_type, params) === true) {
                blocked = true;
                break;
              }
            }
          }
        }
      }
      return blocked;
    },
    extendObject(object) {
      const obj = object;
      obj.bind = function(event_type, callback, instance) {
        return LEvent.bind(this, event_type, callback, instance);
      };
      obj.trigger = function(event_type, params) {
        return LEvent.trigger(this, event_type, params);
      };
      obj.unbind = function(event_type, callback, target_instance) {
        return LEvent.unbind(this, event_type, callback, target_instance);
      };
      obj.unbindAll = function(target_instance, callback) {
        return LEvent.unbindAll(this, target_instance, callback);
      };
    },
    /**
     * Adds the methods to bind, trigger and unbind to this class prototype
     * @method LEvent.extendClass
     * @param {Object} constructor
     **/
    extendClass(constructor) {
      LEvent.extendObject(constructor.prototype);
    }
  };

  // src/utils.ts
  var DEG2RAD = 0.0174532925;
  var RAD2DEG = 57.295779578552306;
  var EPSILON = 1e-6;
  function isPowerOfTwo(v) {
    return Math.log(v) / Math.log(2) % 1 == 0;
  }
  function nearestPowerOfTwo(v) {
    return Math.pow(2, Math.round(Math.log(v) / Math.log(2)));
  }
  function nextPowerOfTwo(v) {
    return Math.pow(2, Math.ceil(Math.log(v) / Math.log(2)));
  }
  var typed_arrays = [Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array];
  function typedToArray() {
    return Array.prototype.slice.call(this);
  }
  typed_arrays.forEach(function(v) {
    if (!v.prototype.toJSON)
      Object.defineProperty(v.prototype, "toJSON", {
        value: typedToArray,
        enumerable: false,
        configurable: true,
        writable: true
      });
  });
  var getTime = typeof performance !== "undefined" ? performance.now.bind(performance) : Date.now.bind(Date);
  function isFunction(obj) {
    const o = obj;
    return !!(o && o.constructor && o.call && o.apply);
  }
  function isArray(obj) {
    return !!(obj && obj.constructor === Array);
  }
  function isNumber(obj) {
    return obj != null && obj.constructor === Number;
  }
  function getClassName(obj) {
    if (!obj)
      return;
    const o = obj;
    if (o.name)
      return o.name;
    if (o.toString) {
      const arr = o.toString().match(
        /function\s*(\w+)/
      );
      if (arr && arr.length == 2) {
        return arr[1];
      }
    }
  }
  function cloneObject(o, t) {
    if (o.constructor !== Object)
      throw "cloneObject only can clone pure javascript objects, not classes";
    t = t || {};
    for (const i in o) {
      const v = o[i];
      if (v === null) {
        t[i] = null;
        continue;
      }
      const ctor = v.constructor;
      switch (ctor) {
        case Int8Array:
        case Uint8Array:
        case Int16Array:
        case Uint16Array:
        case Int32Array:
        case Uint32Array:
        case Float32Array:
        case Float64Array:
          t[i] = new ctor(v);
          break;
        case Boolean:
        case Number:
        case String:
          t[i] = v;
          break;
        case Array:
          t[i] = v.concat();
          break;
        case Object:
          t[i] = cloneObject(v);
          break;
      }
    }
    return t;
  }
  function regexMap(regex, text, callback) {
    let result;
    while ((result = regex.exec(text)) != null) {
      callback(result);
    }
  }
  function createCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  function cloneCanvas(c) {
    const canvas = document.createElement("canvas");
    canvas.width = c.width;
    canvas.height = c.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(c, 0, 0);
    return canvas;
  }
  if (typeof Image != "undefined") {
    Image.prototype.getPixels = function() {
      const canvas = document.createElement("canvas");
      canvas.width = this.width;
      canvas.height = this.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(this, 0, 0);
      return ctx.getImageData(0, 0, this.width, this.height).data;
    };
  }
  if (!String.prototype.hasOwnProperty("replaceAll"))
    Object.defineProperty(String.prototype, "replaceAll", {
      value: function(words) {
        let str = this;
        for (const i in words)
          str = str.split(i).join(words[i]);
        return str;
      },
      enumerable: false
    });
  if (!String.prototype.hasOwnProperty("hashCode"))
    Object.defineProperty(String.prototype, "hashCode", {
      value: function() {
        let hash = 0, i, c, l;
        if (this.length == 0) return hash;
        for (i = 0, l = this.length; i < l; ++i) {
          c = this.charCodeAt(i);
          hash = (hash << 5) - hash + c;
          hash |= 0;
        }
        return hash;
      },
      enumerable: false
    });
  if (!Array.prototype.hasOwnProperty("clone"))
    Object.defineProperty(Array.prototype, "clone", { value: Array.prototype.concat, enumerable: false });
  if (!Float32Array.prototype.hasOwnProperty("clone"))
    Object.defineProperty(Float32Array.prototype, "clone", { value: function() {
      return new Float32Array(this);
    }, enumerable: false });
  function wipeObject(obj) {
    for (const p in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, p))
        delete obj[p];
    }
  }
  function extendClass(target, origin) {
    const t = target;
    const o = origin;
    for (const i in o) {
      if (Object.prototype.hasOwnProperty.call(target, i))
        continue;
      t[i] = o[i];
    }
    const originProto = origin.prototype;
    if (originProto) {
      const oproto = originProto;
      const tproto = target.prototype;
      const prop_names = Object.getOwnPropertyNames(oproto);
      for (let i = 0; i < prop_names.length; ++i) {
        const name = prop_names[i];
        if (Object.prototype.hasOwnProperty.call(tproto, name))
          continue;
        const getter = oproto.__lookupGetter__(name);
        if (getter)
          tproto.__defineGetter__(name, getter);
        else
          tproto[name] = oproto[name];
        const setter = oproto.__lookupSetter__(name);
        if (setter)
          tproto.__defineSetter__(name, setter);
      }
    }
    if (!Object.prototype.hasOwnProperty.call(target, "superclass"))
      Object.defineProperty(target, "superclass", {
        get: function() {
          return origin;
        },
        enumerable: false
      });
  }
  function HttpRequest(url, params, callback, error, options) {
    let async = true;
    options = options || {};
    if (options.async !== void 0)
      async = options.async;
    if (params) {
      const params_arr = [];
      for (const i in params)
        params_arr.push(i + "=" + params[i]);
      const params_str = params_arr.join("&");
      url = url + "?" + params_str;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, async);
    xhr.responseType = options.responseType || "text";
    xhr.onload = function() {
      if (this.status != 200) {
        LEvent.trigger(xhr, "fail", this.status);
        if (error)
          error(this.status);
        return;
      }
      LEvent.trigger(xhr, "done", this.response);
      if (callback)
        callback(this.response);
      return;
    };
    xhr.onerror = function(err) {
      LEvent.trigger(xhr, "fail", err);
    };
    if (options) {
      const xhrRecord = xhr;
      for (const i in options)
        xhrRecord[i] = options[i];
      if (options.binary)
        xhr.responseType = "arraybuffer";
    }
    xhr.send();
    return xhr;
  }
  var request = HttpRequest;
  if (globalThis.XMLHttpRequest) {
    if (!XMLHttpRequest.prototype.hasOwnProperty("done"))
      Object.defineProperty(XMLHttpRequest.prototype, "done", { enumerable: false, value: function(callback) {
        LEvent.bind(this, "done", function(e, err) {
          callback(err);
        });
        return this;
      } });
    if (!XMLHttpRequest.prototype.hasOwnProperty("fail"))
      Object.defineProperty(XMLHttpRequest.prototype, "fail", { enumerable: false, value: function(callback) {
        LEvent.bind(this, "fail", function(e, err) {
          callback(err);
        });
        return this;
      } });
  }
  function getFileExtension(url) {
    const question = url.indexOf("?");
    if (question != -1)
      url = url.substr(0, question);
    const point = url.lastIndexOf(".");
    if (point == -1)
      return "";
    return url.substr(point + 1).toLowerCase();
  }
  function loadFileAtlas(url, callback, sync) {
    let deferred_callback = null;
    HttpRequest(url, null, function(data) {
      const files = processFileAtlas(data);
      if (callback)
        callback(files);
      if (deferred_callback)
        deferred_callback(files);
    }, alert, sync);
    return { done: function(callback2) {
      deferred_callback = callback2;
    } };
  }
  function processFileAtlas(data, skip_trim) {
    const lines = data.split("\n");
    const files = {};
    let current_file_lines = [];
    let current_file_name = "";
    for (let i = 0, l = lines.length; i < l; i++) {
      const line = skip_trim ? lines[i] : lines[i].trim();
      if (!line.length)
        continue;
      if (line[0] != "\\") {
        current_file_lines.push(line);
        continue;
      }
      if (current_file_lines.length)
        files[current_file_name] = current_file_lines.join("\n");
      current_file_lines.length = 0;
      current_file_name = line.substr(1);
    }
    if (current_file_lines.length)
      files[current_file_name] = current_file_lines.join("\n");
    return files;
  }
  function typedArrayToArray(array) {
    const r = [];
    r.length = array.length;
    for (let i = 0; i < array.length; i++)
      r[i] = array[i];
    return r;
  }
  function RGBToHex(r, g, b) {
    r = Math.min(255, r * 255) | 0;
    g = Math.min(255, g * 255) | 0;
    b = Math.min(255, b * 255) | 0;
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
  function HUEToRGB(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  function HSLToRGB(h, s, l, out) {
    let r, g, b;
    out = out || vec3.create();
    if (s == 0) {
      r = g = b = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = HUEToRGB(p, q, h + 1 / 3);
      g = HUEToRGB(p, q, h);
      b = HUEToRGB(p, q, h - 1 / 3);
    }
    out[0] = r;
    out[1] = g;
    out[2] = b;
    return out;
  }
  var string_colors = {
    white: [1, 1, 1],
    black: [0, 0, 0],
    gray: [0.501960813999176, 0.501960813999176, 0.501960813999176],
    red: [1, 0, 0],
    orange: [1, 0.6470588445663452, 0],
    pink: [1, 0.7529411911964417, 0.7960784435272217],
    green: [0, 0.501960813999176, 0],
    lime: [0, 1, 0],
    blue: [0, 0, 1],
    violet: [0.9333333373069763, 0.5098039507865906, 0.9333333373069763],
    magenta: [1, 0, 1],
    cyan: [0, 1, 1],
    yellow: [1, 1, 0],
    brown: [0.6470588445663452, 0.16470588743686676, 0.16470588743686676],
    silver: [0.7529411911964417, 0.7529411911964417, 0.7529411911964417],
    gold: [1, 0.843137264251709, 0],
    transparent: [0, 0, 0, 0]
  };
  function hexColorToRGBA(hex, color, alpha) {
    alpha = alpha === void 0 ? 1 : alpha;
    color = color || new Float32Array(4);
    color[3] = alpha;
    if (typeof hex != "string")
      return color;
    const col = string_colors[hex];
    if (col !== void 0) {
      color.set(col);
      if (color.length == 3)
        color[3] = alpha;
      else
        color[3] *= alpha;
      return color;
    }
    let pos = hex.indexOf("rgba(");
    if (pos != -1) {
      let str = hex.substr(5, hex.length - 2);
      str = str.split(",");
      color[0] = parseInt(str[0]) / 255;
      color[1] = parseInt(str[1]) / 255;
      color[2] = parseInt(str[2]) / 255;
      color[3] = parseFloat(str[3]) * alpha;
      return color;
    }
    pos = hex.indexOf("hsla(");
    if (pos != -1) {
      let str = hex.substr(5, hex.length - 2);
      str = str.split(",");
      HSLToRGB(parseInt(str[0]) / 360, parseInt(str[1]) / 100, parseInt(str[2]) / 100, color);
      color[3] = parseFloat(str[3]) * alpha;
      return color;
    }
    color[3] = alpha;
    pos = hex.indexOf("rgb(");
    if (pos != -1) {
      let str = hex.substr(4, hex.length - 2);
      str = str.split(",");
      color[0] = parseInt(str[0]) / 255;
      color[1] = parseInt(str[1]) / 255;
      color[2] = parseInt(str[2]) / 255;
      return color;
    }
    pos = hex.indexOf("hsl(");
    if (pos != -1) {
      let str = hex.substr(4, hex.length - 2);
      str = str.split(",");
      HSLToRGB(parseInt(str[0]) / 360, parseInt(str[1]) / 100, parseInt(str[2]) / 100, color);
      return color;
    }
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    const expanded = hex.replace(shorthandRegex, function(m, r, g, b) {
      return r + r + g + g + b + b;
    });
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(expanded);
    if (!result)
      return color;
    color[0] = parseInt(result[1], 16) / 255;
    color[1] = parseInt(result[2], 16) / 255;
    color[2] = parseInt(result[3], 16) / 255;
    return color;
  }
  var toHalfFloat_floatView = new Float32Array(1);
  var toHalfFloat_int32View = new Int32Array(toHalfFloat_floatView.buffer);
  function toHalfFloat(fval) {
    toHalfFloat_floatView[0] = fval;
    const fbits = toHalfFloat_int32View[0];
    const sign = fbits >> 16 & 32768;
    let val = (fbits & 2147483647) + 4096;
    if (val >= 1199570944) {
      if ((fbits & 2147483647) >= 1199570944) {
        if (val < 2139095040) {
          return sign | 31744;
        }
        return sign | 31744 | // remains +/-Inf or NaN
        (fbits & 8388607) >> 13;
      }
      return sign | 31743;
    }
    if (val >= 947912704) {
      return sign | val - 939524096 >> 13;
    }
    if (val < 855638016) {
      return sign;
    }
    val = (fbits & 2147483647) >> 23;
    return sign | (fbits & 8388607 | 8388608) + (8388608 >>> val - 102) >> 126 - val;
  }

  // src/temp.ts
  var temp_vec3 = vec3.create();
  var temp2_vec3 = vec3.create();
  var temp_vec4 = vec4.create();
  var temp_quat = quat.create();
  var temp_mat3 = mat3.create();
  var temp_mat4 = mat4.create();

  // src/geo.ts
  var EPSILON2 = 1e-6;
  var CLIP_INSIDE = 0;
  var CLIP_OUTSIDE = 1;
  var CLIP_OVERLAP = 2;
  var pft_V1 = vec3.create();
  var pft_V2 = vec3.create();
  var pft_N = vec3.create();
  var ctn_V1 = vec3.create();
  var ctn_V2 = vec3.create();
  var ctn_N = vec3.create();
  var ppl_AP = vec3.create();
  var ppl_AB = vec3.create();
  var cpts_AP = vec3.create();
  var cpts_AB = vec3.create();
  var ppp_V = vec3.create();
  var ipit_A = vec3.create();
  var ipit_B = vec3.create();
  var ipit_C = vec3.create();
  var ipit_U = vec3.create();
  var ipit_V = vec3.create();
  var ipit_W = vec3.create();
  var tsp_temp = vec3.create();
  var trs_temp = vec3.create();
  var htt_ab = vec3.create();
  var htt_ac = vec3.create();
  var htt_normal = vec3.create();
  var htt_temp = vec3.create();
  var htt_hit = vec3.create();
  var trb_quadrant = new Float32Array(3);
  var trb_candidatePlane = new Float32Array(3);
  var trb_maxT = new Float32Array(3);
  var trbb_inv = mat4.create();
  var trbb_end = vec3.create();
  var trbb_origin2 = vec3.create();
  var geo = {
    last_t: -1,
    /**
    * Returns a float4 containing the info about a plane with normal N and that passes through point P
    * @method createPlane
    * @param {vec3} P
    * @param {vec3} N
    * @return {vec4} plane values
    */
    createPlane: function(P, N) {
      return new Float32Array([N[0], N[1], N[2], -vec3.dot(P, N)]);
    },
    /**
    * assigns a float4 containing the info about a plane that passes the three vertices
    * @method planeFromTriangle
    * @param {vec3} out
    * @param {vec3} A
    * @param {vec3} B
    * @param {vec3} C
    * @return {vec4} plane values
    */
    planeFromTriangle: function(out, A, B, C) {
      vec3.sub(pft_V1, B, A);
      vec3.sub(pft_V2, C, A);
      vec3.cross(pft_N, pft_V1, pft_V2);
      vec3.normalize(pft_N, pft_N);
      out[0] = pft_N[0];
      out[1] = pft_N[1];
      out[2] = pft_N[2];
      out[3] = -vec3.dot(A, pft_N);
      return out;
    },
    /**
    * computes the normal of a triangle
    * @method computeTriangleNormal
    * @param {vec3} out
    * @param {vec3} A
    * @param {vec3} B
    * @param {vec3} C
    * @return {vec4} plane values
    */
    computeTriangleNormal: function(out, A, B, C) {
      vec3.sub(ctn_V1, B, A);
      vec3.sub(ctn_V2, C, A);
      vec3.cross(ctn_N, ctn_V1, ctn_V2);
      vec3.normalize(ctn_N, ctn_N);
      out[0] = ctn_N[0];
      out[1] = ctn_N[1];
      out[2] = ctn_N[2];
      return out;
    },
    /**
    * Computes the distance between the point and the plane
    * @method distancePointToPlane
    * @param {vec3} point
    * @param {vec4} plane
    * @return {Number} distance
    */
    distancePointToPlane: function(point, plane) {
      return (vec3.dot(point, plane) + plane[3]) / Math.sqrt(plane[0] * plane[0] + plane[1] * plane[1] + plane[2] * plane[2]);
    },
    /**
    * Computes the square distance between the point and the plane
    * @method distance2PointToPlane
    * @param {vec3} point
    * @param {vec4} plane
    * @return {Number} distance*distance
    */
    distance2PointToPlane: function(point, plane) {
      return (vec3.dot(point, plane) + plane[3]) / (plane[0] * plane[0] + plane[1] * plane[1] + plane[2] * plane[2]);
    },
    /**
    * Projects a 3D point on a 3D infinite line
    * @method projectPointOnLine
    * @param {vec3} P
    * @param {vec3} A line start
    * @param {vec3} B line end
    * @param {vec3} result to store result (optional)
    * @return {vec3} projectec point
    */
    projectPointOnLine: function(P, A, B, result) {
      result = result || vec3.create();
      vec3.sub(ppl_AP, P, A);
      vec3.sub(ppl_AB, B, A);
      var div = vec3.dot(ppl_AP, ppl_AB) / vec3.dot(ppl_AB, ppl_AB);
      result[0] = A[0] + div * ppl_AB[0];
      result[1] = A[1] + div * ppl_AB[1];
      result[2] = A[2] + div * ppl_AB[2];
      return result;
    },
    /**
    * Projects a 2D point on a 2D infinite line
    * @method project2DPointOnLine
    * @param {vec2} P
    * @param {vec2} A line start
    * @param {vec2} B line end
    * @param {vec2} result to store result (optional)
    * @return {vec2} projectec point
    */
    project2DPointOnLine: function(P, A, B, result) {
      result = result || vec2.create();
      var AP = vec2.fromValues(P[0] - A[0], P[1] - A[1]);
      var AB = vec2.fromValues(B[0] - A[0], B[1] - A[1]);
      var div = vec2.dot(AP, AB) / vec2.dot(AB, AB);
      result[0] = A[0] + div * AB[0];
      result[1] = A[1] + div * AB[1];
      return result;
    },
    /**
    * returns the closest point to a 3D segment
    * @method closestPointToSegment
    * @param {vec3} P
    * @param {vec3} A line start
    * @param {vec3} B line end
    * @param {vec3} result to store result (optional)
    * @return {vec3} projectec point
    */
    closestPointToSegment: function(P, A, B, result) {
      result = result || vec3.create();
      vec3.sub(cpts_AP, P, A);
      vec3.sub(cpts_AB, B, A);
      var div = vec3.dot(cpts_AP, cpts_AB) / vec3.dot(cpts_AB, cpts_AB);
      div = Math.min(1, Math.max(0, div));
      result[0] = A[0] + div * cpts_AB[0];
      result[1] = A[1] + div * cpts_AB[1];
      result[2] = A[2] + div * cpts_AB[2];
      return result;
    },
    /**
    * Projects point on plane
    * @method projectPointOnPlane
    * @param {vec3} point
    * @param {vec3} P plane point
    * @param {vec3} N plane normal
    * @param {vec3} result to store result (optional)
    * @return {vec3} projectec point
    */
    projectPointOnPlane: function(point, P, N, result) {
      result = result || vec3.create();
      vec3.sub(ppp_V, point, P);
      var dist = vec3.dot(ppp_V, N);
      vec3.scale(ppp_V, N, dist);
      return vec3.sub(result, point, ppp_V);
    },
    /**
    * Tells if a coplanar point is inside the triangle
    * @method isPointInsideTriangle
    * @param {vec3} point
    * @param {vec3} A
    * @param {vec3} B
    * @param {vec3} C
    * @return {boolean}
    */
    isPointInsideTriangle: function(p, a, b, c) {
      vec3.sub(ipit_A, a, p);
      vec3.sub(ipit_B, b, p);
      vec3.sub(ipit_C, c, p);
      vec3.cross(ipit_U, ipit_B, ipit_C);
      vec3.cross(ipit_V, ipit_C, ipit_A);
      vec3.cross(ipit_W, ipit_A, ipit_B);
      if (vec3.dot(ipit_U, ipit_V) < 0 || vec3.dot(ipit_U, ipit_W) < 0)
        return false;
      return true;
    },
    /**
    * Finds the reflected point over a plane (useful for reflecting camera position when rendering reflections)
    * @method reflectPointInPlane
    * @param {vec3} point point to reflect
    * @param {vec3} P point where the plane passes
    * @param {vec3} N normal of the plane
    * @return {vec3} reflected point
    */
    reflectPointInPlane: function(point, P, N) {
      var d = -1 * (P[0] * N[0] + P[1] * N[1] + P[2] * N[2]);
      var t = -(d + N[0] * point[0] + N[1] * point[1] + N[2] * point[2]) / (N[0] * N[0] + N[1] * N[1] + N[2] * N[2]);
      return vec3.fromValues(point[0] + t * N[0] * 2, point[1] + t * N[1] * 2, point[2] + t * N[2] * 2);
    },
    /**
    * test a ray plane collision and retrieves the collision point
    * @method testRayPlane
    * @param {vec3} start ray start
    * @param {vec3} direction ray direction
    * @param {vec3} P point where the plane passes
    * @param {vec3} N normal of the plane
    * @param {vec3} result collision position
    * @return {boolean} returns if the ray collides the plane or the ray is parallel to the plane
    */
    testRayPlane: function(start, direction, P, N, result) {
      var D = vec3.dot(P, N);
      var numer = D - vec3.dot(N, start);
      var denom = vec3.dot(N, direction);
      if (Math.abs(denom) < EPSILON2) return false;
      var t = geo.last_t = numer / denom;
      if (t < 0)
        return false;
      if (result)
        vec3.add(result, start, vec3.scale(result, direction, t));
      return true;
    },
    /**
    * test collision between segment and plane and retrieves the collision point
    * @method testSegmentPlane
    * @param {vec3} start segment start
    * @param {vec3} end segment end
    * @param {vec3} P point where the plane passes
    * @param {vec3} N normal of the plane
    * @param {vec3} result collision position
    * @return {boolean} returns if the segment collides the plane or it is parallel to the plane
    */
    testSegmentPlane: function(start, end, P, N, result) {
      var D = vec3.dot(P, N);
      var numer = D - vec3.dot(N, start);
      var direction = vec3.sub(tsp_temp, end, start);
      var denom = vec3.dot(N, direction);
      if (Math.abs(denom) < EPSILON2)
        return false;
      var t = geo.last_t = numer / denom;
      if (t < 0)
        return false;
      if (t > 1)
        return false;
      if (result)
        vec3.add(result, start, vec3.scale(result, direction, t));
      return true;
    },
    /**
    * test a ray sphere collision and retrieves the collision point
    * @method testRaySphere
    * @param {vec3} start ray start
    * @param {vec3} direction ray direction (normalized)
    * @param {vec3} center center of the sphere
    * @param {number} radius radius of the sphere
    * @param {vec3} result [optional] collision position
    * @param {number} max_dist not fully tested
    * @return {boolean} returns if the ray collides the sphere
    */
    testRaySphere: function(start, direction, center, radius, result, max_dist) {
      var orig = vec3.subtract(trs_temp, start, center);
      var a = direction[0] * direction[0] + direction[1] * direction[1] + direction[2] * direction[2];
      var b = 2 * orig[0] * direction[0] + 2 * orig[1] * direction[1] + 2 * orig[2] * direction[2];
      var c = orig[0] * orig[0] + orig[1] * orig[1] + orig[2] * orig[2] - radius * radius;
      var q = b * b - 4 * a * c;
      if (q < 0)
        return false;
      if (result) {
        var sq = Math.sqrt(q);
        var d = 1 / (2 * a);
        var r1 = (-b + sq) * d;
        var r2 = (-b - sq) * d;
        var t = r1 < r2 ? r1 : r2;
        if (max_dist !== void 0 && t > max_dist)
          return false;
        geo.last_t = t;
        vec3.add(result, start, vec3.scale(result, direction, t));
      }
      return true;
    },
    //NOT TESTED!
    hitTestTriangle: function(origin, direction, a, b, c, result) {
      vec3.subtract(htt_ab, b, a);
      vec3.subtract(htt_ac, c, a);
      vec3.cross(htt_normal, htt_ab, htt_ac);
      vec3.normalize(htt_normal, htt_normal);
      var t = vec3.dot(htt_normal, vec3.subtract(htt_temp, a, origin)) / vec3.dot(htt_normal, direction);
      if (t > 0) {
        vec3.add(htt_hit, origin, vec3.scale(htt_temp, direction, t));
        var toHit = vec3.subtract(htt_temp, htt_temp, a);
        var dot00 = vec3.dot(htt_ac, htt_ac);
        var dot01 = vec3.dot(htt_ac, htt_ab);
        var dot02 = vec3.dot(htt_ac, toHit);
        var dot11 = vec3.dot(htt_ab, htt_ab);
        var dot12 = vec3.dot(htt_ab, toHit);
        var divide = dot00 * dot11 - dot01 * dot01;
        var u = (dot11 * dot02 - dot01 * dot12) / divide;
        var v = (dot00 * dot12 - dot01 * dot02) / divide;
        if (u >= 0 && v >= 0 && u + v <= 1) {
          geo.last_t = t;
          if (result)
            vec3.add(result, origin, vec3.scale(htt_temp, direction, t));
          return true;
        }
      }
      return false;
    },
    /**
    * test a ray cylinder collision (only vertical cylinders) and retrieves the collision point [not fully tested]
    * @method testRayCylinder
    * @param {vec3} start ray start
    * @param {vec3} direction ray direction
    * @param {vec3} p center of the cylinder
    * @param {number} q height of the cylinder
    * @param {number} r radius of the cylinder
    * @param {vec3} result collision position
    * @return {boolean} returns if the ray collides the cylinder
    */
    testRayCylinder: function(start, direction, p, q, r, result) {
      var sa = vec3.clone(start);
      var sb = vec3.add(vec3.create(), start, vec3.scale(vec3.create(), direction, 1e5));
      var t = 0;
      var d = vec3.subtract(vec3.create(), q, p);
      var m = vec3.subtract(vec3.create(), sa, p);
      var n = vec3.subtract(vec3.create(), sb, sa);
      var md = vec3.dot(m, d);
      var nd = vec3.dot(n, d);
      var dd = vec3.dot(d, d);
      if (md < 0 && md + nd < 0) return false;
      if (md > dd && md + nd > dd) return false;
      var nn = vec3.dot(n, n);
      var mn = vec3.dot(m, n);
      var a = dd * nn - nd * nd;
      var k = vec3.dot(m, m) - r * r;
      var c = dd * k - md * md;
      if (Math.abs(a) < EPSILON2) {
        if (c > 0) return false;
        if (md < 0) t = -mn / nn;
        else if (md > dd)
          t = (nd - mn) / nn;
        else t = 0;
        if (result)
          vec3.add(result, sa, vec3.scale(result, n, t));
        return true;
      }
      var b = dd * mn - nd * md;
      var discr = b * b - a * c;
      if (discr < 0)
        return false;
      t = (-b - Math.sqrt(discr)) / a;
      if (t < 0 || t > 1)
        return false;
      if (md + t * nd < 0) {
        if (nd <= 0)
          return false;
        t = -md / nd;
        if (result)
          vec3.add(result, sa, vec3.scale(result, n, t));
        return k + 2 * t * (mn + t * nn) <= 0;
      } else if (md + t * nd > dd) {
        if (nd >= 0) return false;
        t = (dd - md) / nd;
        if (result)
          vec3.add(result, sa, vec3.scale(result, n, t));
        return k + dd - 2 * md + t * (2 * (mn - nd) + t * nn) <= 0;
      }
      geo.last_t = t;
      if (result)
        vec3.add(result, sa, vec3.scale(result, n, t));
      return true;
    },
    /**
    * test a ray bounding-box collision and retrieves the collision point, the BB must be Axis Aligned
    * @method testRayBox
    * @param {vec3} start ray start
    * @param {vec3} direction ray direction
    * @param {vec3} minB minimum position of the bounding box
    * @param {vec3} maxB maximim position of the bounding box
    * @param {vec3} result collision position
    * @return {boolean} returns if the ray collides the box
    */
    testRayBox: function(start, direction, minB, maxB, result, max_dist) {
      max_dist = max_dist || Number.MAX_VALUE;
      var inside = true;
      var i = 0 | 0;
      var whichPlane;
      trb_quadrant.fill(0);
      trb_maxT.fill(0);
      trb_candidatePlane.fill(0);
      for (i = 0; i < 3; ++i)
        if (start[i] < minB[i]) {
          trb_quadrant[i] = 1;
          trb_candidatePlane[i] = minB[i];
          inside = false;
        } else if (start[i] > maxB[i]) {
          trb_quadrant[i] = 0;
          trb_candidatePlane[i] = maxB[i];
          inside = false;
        } else {
          trb_quadrant[i] = 2;
        }
      if (inside) {
        geo.last_t = 0;
        if (result)
          vec3.copy(result, start);
        return true;
      }
      for (i = 0; i < 3; ++i)
        if (trb_quadrant[i] != 2 && direction[i] != 0)
          trb_maxT[i] = (trb_candidatePlane[i] - start[i]) / direction[i];
        else
          trb_maxT[i] = -1;
      whichPlane = 0;
      for (i = 1; i < 3; i++)
        if (trb_maxT[whichPlane] < trb_maxT[i])
          whichPlane = i;
      if (trb_maxT[whichPlane] < 0) return false;
      if (trb_maxT[whichPlane] > max_dist) return false;
      geo.last_t = trb_maxT[whichPlane];
      for (i = 0; i < 3; ++i)
        if (whichPlane != i) {
          var res = start[i] + trb_maxT[whichPlane] * direction[i];
          if (res < minB[i] || res > maxB[i])
            return false;
          if (result)
            result[i] = res;
        } else {
          if (result)
            result[i] = trb_candidatePlane[i];
        }
      return true;
    },
    /**
    * test a ray bounding-box collision, it uses the  BBox class and allows to use non-axis aligned bbox
    * @method testRayBBox
    * @param {vec3} origin ray origin
    * @param {vec3} direction ray direction
    * @param {BBox} box in BBox format
    * @param {mat4} model transformation of the BBox [optional]
    * @param {vec3} result collision position in world space unless in_local is true
    * @return {boolean} returns if the ray collides the box
    */
    testRayBBox: function(origin, direction, box, model, result, max_dist, in_local) {
      if (!origin || !direction || !box)
        throw "parameters missing";
      if (model) {
        mat4.invert(trbb_inv, model);
        vec3.add(trbb_end, origin, direction);
        origin = vec3.transformMat4(trbb_origin2, origin, trbb_inv);
        vec3.transformMat4(trbb_end, trbb_end, trbb_inv);
        vec3.sub(trbb_end, trbb_end, origin);
        direction = vec3.normalize(trbb_end, trbb_end);
      }
      var r = geo.testRayBox(origin, direction, box.subarray(6, 9), box.subarray(9, 12), result, max_dist);
      if (!in_local && model && result)
        vec3.transformMat4(result, result, model);
      return r;
    },
    /**
    * test if a 3d point is inside a BBox
    * @method testPointBBox
    * @param {vec3} point
    * @param {BBox} bbox
    * @return {boolean} true if it is inside
    */
    testPointBBox: function(point, bbox) {
      if (point[0] < bbox[6] || point[0] > bbox[9] || point[1] < bbox[7] || point[0] > bbox[10] || point[2] < bbox[8] || point[0] > bbox[11])
        return false;
      return true;
    },
    /**
    * test if a BBox overlaps another BBox
    * @method testBBoxBBox
    * @param {BBox} a
    * @param {BBox} b
    * @return {boolean} true if it overlaps
    */
    testBBoxBBox: function(a, b) {
      var tx = Math.abs(b[0] - a[0]);
      if (tx > a[3] + b[3])
        return false;
      var ty = Math.abs(b[1] - a[1]);
      if (ty > a[4] + b[4])
        return false;
      var tz = Math.abs(b[2] - a[2]);
      if (tz > a[5] + b[5])
        return false;
      var vmin = BBox.getMin(b);
      if (geo.testPointBBox(vmin, a)) {
        var vmax = BBox.getMax(b);
        if (geo.testPointBBox(vmax, a)) {
          return true;
        }
      }
      return true;
    },
    /**
    * test if a sphere overlaps a BBox
    * @method testSphereBBox
    * @param {vec3} point
    * @param {float} radius
    * @param {BBox} bounding_box
    * @return {boolean} true if it overlaps
    */
    testSphereBBox: function(center, radius, bbox) {
      var s, d = 0;
      var vmin = BBox.getMin(bbox);
      var vmax = BBox.getMax(bbox);
      for (var i = 0; i < 3; ++i) {
        if (center[i] < vmin[i]) {
          s = center[i] - vmin[i];
          d += s * s;
        } else if (center[i] > vmax[i]) {
          s = center[i] - vmax[i];
          d += s * s;
        }
      }
      var radiusSquared = radius * radius;
      if (d <= radiusSquared) {
        return true;
      }
      return false;
    },
    closestPointBetweenLines: function(a0, a1, b0, b1, p_a, p_b) {
      var u = vec3.subtract(vec3.create(), a1, a0);
      var v = vec3.subtract(vec3.create(), b1, b0);
      var w = vec3.subtract(vec3.create(), a0, b0);
      var a = vec3.dot(u, u);
      var b = vec3.dot(u, v);
      var c = vec3.dot(v, v);
      var d = vec3.dot(u, w);
      var e = vec3.dot(v, w);
      var D = a * c - b * b;
      var sc, tc;
      if (D < EPSILON2) {
        sc = 0;
        tc = b > c ? d / b : e / c;
      } else {
        sc = (b * e - c * d) / D;
        tc = (a * e - b * d) / D;
      }
      if (p_a) vec3.add(p_a, a0, vec3.scale(vec3.create(), u, sc));
      if (p_b) vec3.add(p_b, b0, vec3.scale(vec3.create(), v, tc));
      var dP = vec3.add(vec3.create(), w, vec3.subtract(vec3.create(), vec3.scale(vec3.create(), u, sc), vec3.scale(vec3.create(), v, tc)));
      return vec3.length(dP);
    },
    /**
    * extract frustum planes given a view-projection matrix
    * @method extractPlanes
    * @param {mat4} viewprojection matrix
    * @return {Float32Array} returns all 6 planes in a float32array[24]
    */
    extractPlanes: function(vp, planes) {
      var out = planes || new Float32Array(4 * 6);
      function normalize(pos) {
        var N = out.subarray(pos, pos + 3);
        var l = vec3.length(N);
        if (l === 0) return;
        l = 1 / l;
        out[pos] *= l;
        out[pos + 1] *= l;
        out[pos + 2] *= l;
        out[pos + 3] *= l;
      }
      out.set([vp[3] - vp[0], vp[7] - vp[4], vp[11] - vp[8], vp[15] - vp[12]], 0);
      normalize(0);
      out.set([vp[3] + vp[0], vp[7] + vp[4], vp[11] + vp[8], vp[15] + vp[12]], 4);
      normalize(4);
      out.set([vp[3] + vp[1], vp[7] + vp[5], vp[11] + vp[9], vp[15] + vp[13]], 8);
      normalize(8);
      out.set([vp[3] - vp[1], vp[7] - vp[5], vp[11] - vp[9], vp[15] - vp[13]], 12);
      normalize(12);
      out.set([vp[3] - vp[2], vp[7] - vp[6], vp[11] - vp[10], vp[15] - vp[14]], 16);
      normalize(16);
      out.set([vp[3] + vp[2], vp[7] + vp[6], vp[11] + vp[10], vp[15] + vp[14]], 20);
      normalize(20);
      return out;
    },
    /**
    * test a BBox against the frustum
    * @method frustumTestBox
    * @param {Float32Array} planes frustum planes
    * @param {BBox} boundindbox in BBox format
    * @return {enum} CLIP_INSIDE, CLIP_OVERLAP, CLIP_OUTSIDE
    */
    frustumTestBox: function(planes, box) {
      var flag = 0, o = 0;
      flag = planeBoxOverlap(planes.subarray(0, 4), box);
      if (flag == CLIP_OUTSIDE) return CLIP_OUTSIDE;
      o += flag;
      flag = planeBoxOverlap(planes.subarray(4, 8), box);
      if (flag == CLIP_OUTSIDE) return CLIP_OUTSIDE;
      o += flag;
      flag = planeBoxOverlap(planes.subarray(8, 12), box);
      if (flag == CLIP_OUTSIDE) return CLIP_OUTSIDE;
      o += flag;
      flag = planeBoxOverlap(planes.subarray(12, 16), box);
      if (flag == CLIP_OUTSIDE) return CLIP_OUTSIDE;
      o += flag;
      flag = planeBoxOverlap(planes.subarray(16, 20), box);
      if (flag == CLIP_OUTSIDE) return CLIP_OUTSIDE;
      o += flag;
      flag = planeBoxOverlap(planes.subarray(20, 24), box);
      if (flag == CLIP_OUTSIDE) return CLIP_OUTSIDE;
      o += flag;
      return o == 0 ? CLIP_INSIDE : CLIP_OVERLAP;
    },
    /**
    * test a Sphere against the frustum
    * @method frustumTestSphere
    * @param {vec3} center sphere center
    * @param {number} radius sphere radius
    * @return {enum} CLIP_INSIDE, CLIP_OVERLAP, CLIP_OUTSIDE
    */
    frustumTestSphere: function(planes, center, radius) {
      var dist;
      var overlap = false;
      dist = distanceToPlane(planes.subarray(0, 4), center);
      if (dist < -radius) return CLIP_OUTSIDE;
      else if (dist >= -radius && dist <= radius) overlap = true;
      dist = distanceToPlane(planes.subarray(4, 8), center);
      if (dist < -radius) return CLIP_OUTSIDE;
      else if (dist >= -radius && dist <= radius) overlap = true;
      dist = distanceToPlane(planes.subarray(8, 12), center);
      if (dist < -radius) return CLIP_OUTSIDE;
      else if (dist >= -radius && dist <= radius) overlap = true;
      dist = distanceToPlane(planes.subarray(12, 16), center);
      if (dist < -radius) return CLIP_OUTSIDE;
      else if (dist >= -radius && dist <= radius) overlap = true;
      dist = distanceToPlane(planes.subarray(16, 20), center);
      if (dist < -radius) return CLIP_OUTSIDE;
      else if (dist >= -radius && dist <= radius) overlap = true;
      dist = distanceToPlane(planes.subarray(20, 24), center);
      if (dist < -radius) return CLIP_OUTSIDE;
      else if (dist >= -radius && dist <= radius) overlap = true;
      return overlap ? CLIP_OVERLAP : CLIP_INSIDE;
    },
    /**
    * test if a 2d point is inside a 2d polygon
    * @method testPoint2DInPolygon
    * @param {Array} poly array of 2d points
    * @param {vec2} point
    * @return {boolean} true if it is inside
    */
    testPoint2DInPolygon: function(poly, pt) {
      for (var c = false, i = -1, l = poly.length, j = l - 1; ++i < l; j = i)
        (poly[i][1] <= pt[1] && pt[1] < poly[j][1] || poly[j][1] <= pt[1] && pt[1] < poly[i][1]) && pt[0] < (poly[j][0] - poly[i][0]) * (pt[1] - poly[i][1]) / (poly[j][1] - poly[i][1]) + poly[i][0] && (c = !c);
      return c;
    }
  };
  var bbtm_points_buffer = new Float32Array(8 * 3);
  var bbtm_points = [];
  for (let bbtm_i = 0; bbtm_i < 24; bbtm_i += 3)
    bbtm_points.push(bbtm_points_buffer.subarray(bbtm_i, bbtm_i + 3));
  var BBox = {
    center: 0,
    halfsize: 3,
    min: 6,
    max: 9,
    radius: 12,
    data_length: 13,
    //corners: new Float32Array([1,1,1,  1,1,-1,  1,-1,1,  1,-1,-1,  -1,1,1,  -1,1,-1,  -1,-1,1,  -1,-1,-1 ]),
    corners: [vec3.fromValues(1, 1, 1), vec3.fromValues(1, 1, -1), vec3.fromValues(1, -1, 1), vec3.fromValues(1, -1, -1), vec3.fromValues(-1, 1, 1), vec3.fromValues(-1, 1, -1), vec3.fromValues(-1, -1, 1), vec3.fromValues(-1, -1, -1)],
    /**
    * create an empty bbox
    * @method create
    * @return {BBox} returns a float32array with the bbox
    */
    create: function() {
      return new Float32Array(13);
    },
    /**
    * create an bbox copy from another one
    * @method clone
    * @return {BBox} returns a float32array with the bbox
    */
    clone: function(bb) {
      return new Float32Array(bb);
    },
    /**
    * copy one bbox into another
    * @method copy
    * @param {BBox} out where to store the result
    * @param {BBox} where to read the bbox
    * @return {BBox} returns out
    */
    copy: function(out, bb) {
      out.set(bb);
      return out;
    },
    /**
    * create a bbox from one point
    * @method fromPoint
    * @param {vec3} point
    * @return {BBox} returns a float32array with the bbox
    */
    fromPoint: function(point) {
      var bb = BBox.create();
      bb.set(point, 0);
      bb.set(point, 6);
      bb.set(point, 9);
      return bb;
    },
    /**
    * create a bbox from min and max points
    * @method fromMinMax
    * @param {vec3} min
    * @param {vec3} max
    * @return {BBox} returns a float32array with the bbox
    */
    fromMinMax: function(min, max) {
      var bb = BBox.create();
      BBox.setMinMax(bb, min, max);
      return bb;
    },
    /**
    * create a bbox from center and halfsize
    * @method fromCenterHalfsize
    * @param {vec3} center
    * @param {vec3} halfsize
    * @return {BBox} returns a float32array with the bbox
    */
    fromCenterHalfsize: function(center, halfsize) {
      var bb = BBox.create();
      BBox.setCenterHalfsize(bb, center, halfsize);
      return bb;
    },
    /**
    * create a bbox from a typed-array containing points
    * @method fromPoints
    * @param {Float32Array} points
    * @return {BBox} returns a float32array with the bbox
    */
    fromPoints: function(points) {
      var bb = BBox.create();
      BBox.setFromPoints(bb, points);
      return bb;
    },
    /**
    * set the values to a BB from a set of points
    * @method setFromPoints
    * @param {BBox} out where to store the result
    * @param {Float32Array} points
    * @return {BBox} returns a float32array with the bbox
    */
    setFromPoints: function(bb, points) {
      var min = bb.subarray(6, 9);
      var max = bb.subarray(9, 12);
      min[0] = points[0];
      min[1] = points[1];
      min[2] = points[2];
      max.set(min);
      for (var i = 3, l = points.length; i < l; i += 3) {
        var x = points[i];
        var y = points[i + 1];
        var z = points[i + 2];
        if (x < min[0]) min[0] = x;
        else if (x > max[0]) max[0] = x;
        if (y < min[1]) min[1] = y;
        else if (y > max[1]) max[1] = y;
        if (z < min[2]) min[2] = z;
        else if (z > max[2]) max[2] = z;
      }
      bb[0] = (min[0] + max[0]) * 0.5;
      bb[1] = (min[1] + max[1]) * 0.5;
      bb[2] = (min[2] + max[2]) * 0.5;
      bb[3] = max[0] - bb[0];
      bb[4] = max[1] - bb[1];
      bb[5] = max[2] - bb[2];
      bb[12] = Math.sqrt(bb[3] * bb[3] + bb[4] * bb[4] + bb[5] * bb[5]);
      return bb;
    },
    /**
    * set the values to a BB from min and max
    * @method setMinMax
    * @param {BBox} out where to store the result
    * @param {vec3} min
    * @param {vec3} max
    * @return {BBox} returns out
    */
    setMinMax: function(bb, min, max) {
      bb[6] = min[0];
      bb[7] = min[1];
      bb[8] = min[2];
      bb[9] = max[0];
      bb[10] = max[1];
      bb[11] = max[2];
      var halfsize = bb.subarray(3, 6);
      vec3.sub(halfsize, max, min);
      vec3.scale(halfsize, halfsize, 0.5);
      bb[0] = max[0] - halfsize[0];
      bb[1] = max[1] - halfsize[1];
      bb[2] = max[2] - halfsize[2];
      bb[12] = vec3.length(bb.subarray(3, 6));
      return bb;
    },
    /**
    * set the values to a BB from center and halfsize
    * @method setCenterHalfsize
    * @param {BBox} out where to store the result
    * @param {vec3} min
    * @param {vec3} max
    * @param {number} radius [optional] (the minimum distance from the center to the further point)
    * @return {BBox} returns out
    */
    setCenterHalfsize: function(bb, center, halfsize, radius) {
      bb[0] = center[0];
      bb[1] = center[1];
      bb[2] = center[2];
      bb[3] = halfsize[0];
      bb[4] = halfsize[1];
      bb[5] = halfsize[2];
      bb[6] = bb[0] - bb[3];
      bb[7] = bb[1] - bb[4];
      bb[8] = bb[2] - bb[5];
      bb[9] = bb[0] + bb[3];
      bb[10] = bb[1] + bb[4];
      bb[11] = bb[2] + bb[5];
      if (radius)
        bb[12] = radius;
      else
        bb[12] = vec3.length(halfsize);
      return bb;
    },
    /**
    * Apply a matrix transformation to the BBox (applies to every corner and recomputes the BB)
    * @method transformMat4
    * @param {BBox} out where to store the result
    * @param {BBox} bb bbox you want to transform
    * @param {mat4} mat transformation
    * @return {BBox} returns out
    */
    transformMat4: function(out, bb, mat) {
      var centerx = bb[0];
      var centery = bb[1];
      var centerz = bb[2];
      var hsx = bb[3];
      var hsy = bb[4];
      var hsz = bb[5];
      var corners = BBox.corners;
      for (var i = 0; i < 8; ++i) {
        var corner = corners[i];
        var result = bbtm_points[i];
        result[0] = hsx * corner[0] + centerx;
        result[1] = hsy * corner[1] + centery;
        result[2] = hsz * corner[2] + centerz;
        mat4.multiplyVec3(result, mat, result);
      }
      return BBox.setFromPoints(out, bbtm_points_buffer);
    },
    /**
    * Computes the eight corners of the BBox and returns it
    * @method getCorners
    * @param {BBox} bb the bounding box
    * @param {Float32Array} result optional, should be 8 * 3
    * @return {Float32Array} returns the 8 corners
    */
    getCorners: function(bb, result) {
      var center = bb;
      var halfsize = bb.subarray(3, 6);
      var corners;
      if (result) {
        result.set(BBox.corners);
        corners = result;
      } else
        corners = new Float32Array(BBox.corners);
      for (var i = 0; i < 8; ++i) {
        var corner = corners.subarray(i * 3, i * 3 + 3);
        vec3.multiply(corner, halfsize, corner);
        vec3.add(corner, corner, center);
      }
      return corners;
    },
    merge: function(out, a, b) {
      var min = out.subarray(6, 9);
      var max = out.subarray(9, 12);
      vec3.min(min, a.subarray(6, 9), b.subarray(6, 9));
      vec3.max(max, a.subarray(9, 12), b.subarray(9, 12));
      return BBox.setMinMax(out, min, max);
    },
    extendToPoint: function(out, p) {
      if (p[0] < out[6]) out[6] = p[0];
      else if (p[0] > out[9]) out[9] = p[0];
      if (p[1] < out[7]) out[7] = p[1];
      else if (p[1] > out[10]) out[10] = p[1];
      if (p[2] < out[8]) out[8] = p[2];
      else if (p[2] > out[11]) out[11] = p[2];
      var min = out.subarray(6, 9);
      var max = out.subarray(9, 12);
      var center = vec3.add(out.subarray(0, 3), min, max);
      vec3.scale(center, center, 0.5);
      vec3.subtract(out.subarray(3, 6), max, center);
      out[12] = vec3.length(out.subarray(3, 6));
      return out;
    },
    clampPoint: function(out, box, point) {
      out[0] = Math.clamp(point[0], box[0] - box[3], box[0] + box[3]);
      out[1] = Math.clamp(point[1], box[1] - box[4], box[1] + box[4]);
      out[2] = Math.clamp(point[2], box[2] - box[5], box[2] + box[5]);
    },
    isPointInside: function(bbox, point) {
      if (bbox[0] - bbox[3] > point[0] || bbox[1] - bbox[4] > point[1] || bbox[2] - bbox[5] > point[2] || bbox[0] + bbox[3] < point[0] || bbox[1] + bbox[4] < point[1] || bbox[2] + bbox[5] < point[2])
        return false;
      return true;
    },
    getCenter: function(bb) {
      return bb.subarray(0, 3);
    },
    getHalfsize: function(bb) {
      return bb.subarray(3, 6);
    },
    getMin: function(bb) {
      return bb.subarray(6, 9);
    },
    getMax: function(bb) {
      return bb.subarray(9, 12);
    },
    getRadius: function(bb) {
      return bb[12];
    }
    //setCenter,setHalfsize not coded, too much work to update all
  };
  function distanceToPlane(plane, point) {
    return vec3.dot(plane, point) + plane[3];
  }
  function planeBoxOverlap(plane, box) {
    var n = plane;
    var d = plane[3];
    var center = box;
    var halfsize = box;
    var radius = Math.abs(halfsize[3] * n[0]) + Math.abs(halfsize[4] * n[1]) + Math.abs(halfsize[5] * n[2]);
    var distance = vec3.dot(n, center) + d;
    if (distance <= -radius)
      return CLIP_OUTSIDE;
    else if (distance <= radius)
      return CLIP_OVERLAP;
    return CLIP_INSIDE;
  }

  // src/mesh.ts
  var TYPED_ARRAY_CTORS = {
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array
  };
  function isDebug() {
    var _a;
    return !!((_a = globalThis.GL) == null ? void 0 : _a.debug);
  }
  var Indexer = class {
    constructor() {
      this.unique = [];
      this.indices = [];
      this.map = {};
    }
    add(obj) {
      const key = JSON.stringify(obj);
      if (!(key in this.map)) {
        this.map[key] = this.unique.length;
        this.unique.push(obj);
      }
      return this.map[key];
    }
  };
  var Buffer2 = class _Buffer {
    constructor(target, data, spacing, stream_type, gl2) {
      if (isDebug()) console.log("GL.Buffer created");
      if (gl2 !== null) gl2 = gl2 || globalThis.gl;
      this.gl = gl2 != null ? gl2 : null;
      this.buffer = null;
      this.target = target;
      this.attribute = null;
      this.normalize = false;
      this.data = data;
      this.spacing = spacing || 3;
      if (this.data && this.gl) this.upload(stream_type);
    }
    /**
     * binds the buffer to a attrib location
     * @method bind
     * @param {number} location the location of the shader  (from shader.attributes[ name ])
     */
    bind(location2, gl2) {
      gl2 = gl2 || this.gl;
      if (!gl2) return;
      gl2.bindBuffer(gl2.ARRAY_BUFFER, this.buffer);
      gl2.enableVertexAttribArray(location2);
      gl2.vertexAttribPointer(location2, this.spacing, this.buffer.gl_type, this.normalize || false, 0, 0);
    }
    /**
     * unbinds the buffer from an attrib location
     * @method unbind
     * @param {number} location the location of the shader
     */
    unbind(location2, gl2) {
      gl2 = gl2 || this.gl;
      if (!gl2) return;
      gl2.disableVertexAttribArray(location2);
    }
    /**
     * Applies an action to every vertex in this buffer
     * @method forEach
     * @param {function} callback to be called for every vertex (or whatever is contained in the buffer)
     */
    forEach(callback) {
      const d = this.data;
      for (let i = 0, s = this.spacing, l = d.length; i < l; i += s) {
        callback(d.subarray(i, i + s), i);
      }
      return this;
    }
    /**
     * Applies a mat4 transform to every triplets in the buffer (assuming they are points)
     * No upload is performed (to ensure efficiency in case there are several operations performed)
     * @method applyTransform
     * @param {mat4} mat
     */
    applyTransform(mat) {
      const d = this.data;
      for (let i = 0, s = this.spacing, l = d.length; i < l; i += s) {
        const v = d.subarray(i, i + s);
        vec3.transformMat4(v, v, mat);
      }
      return this;
    }
    /**
     * Uploads the buffer data (stored in this.data) to the GPU
     * @method upload
     * @param {number} stream_type default gl.STATIC_DRAW (other: gl.DYNAMIC_DRAW, gl.STREAM_DRAW
     */
    upload(stream_type) {
      const spacing = this.spacing || 3;
      const gl2 = this.gl;
      if (!gl2) return;
      if (!this.data) throw "No data supplied";
      let data = this.data;
      if (!data.buffer) throw "Buffers must be typed arrays";
      this.buffer = this.buffer || gl2.createBuffer();
      if (!this.buffer) return;
      this.buffer.length = data.length;
      this.buffer.spacing = spacing;
      switch (data.constructor) {
        case Int8Array:
          this.buffer.gl_type = gl2.BYTE;
          break;
        case Uint8ClampedArray:
        case Uint8Array:
          this.buffer.gl_type = gl2.UNSIGNED_BYTE;
          break;
        case Int16Array:
          this.buffer.gl_type = gl2.SHORT;
          break;
        case Uint16Array:
          this.buffer.gl_type = gl2.UNSIGNED_SHORT;
          break;
        case Int32Array:
          this.buffer.gl_type = gl2.INT;
          break;
        case Uint32Array:
          this.buffer.gl_type = gl2.UNSIGNED_INT;
          break;
        case Float32Array:
          this.buffer.gl_type = gl2.FLOAT;
          break;
        default:
          throw "unsupported buffer type";
      }
      if (this.target == gl2.ARRAY_BUFFER && (this.buffer.gl_type == gl2.INT || this.buffer.gl_type == gl2.UNSIGNED_INT)) {
        console.warn("WebGL does not support UINT32 or INT32 as vertex buffer types, converting to FLOAT");
        this.buffer.gl_type = gl2.FLOAT;
        data = new Float32Array(data);
      }
      gl2.bindBuffer(this.target, this.buffer);
      gl2.bufferData(this.target, data, stream_type || this.stream_type || gl2.STATIC_DRAW);
    }
    //legacy
    compile(stream_type) {
      this.upload(stream_type);
    }
    /**
     * Assign data to buffer and uploads it (it allows range)
     * @method setData
     * @param {ArrayBufferView} data in Float32Array format usually
     * @param {number} offset offset in bytes
     */
    setData(data, offset) {
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
        const new_data_view = new Uint8Array(
          data.buffer,
          data.buffer.byteOffset,
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
    uploadRange(start, size) {
      if (!this.data) throw "No data stored in this buffer";
      const data = this.data;
      if (!data.buffer) throw "Buffers must be typed arrays";
      const view = new Uint8Array(this.data.buffer, start, size);
      const gl2 = this.gl;
      if (!gl2) return;
      gl2.bindBuffer(this.target, this.buffer);
      gl2.bufferSubData(this.target, start, view);
    }
    /**
     * Clones one buffer (it allows to share the same data between both buffers)
     * @method clone
     * @param {boolean} share if you want that both buffers share the same data (default false)
     * return {GL.Buffer} buffer cloned
     */
    clone(share) {
      const buffer = new _Buffer();
      if (share) {
        const src = this;
        const dst = buffer;
        for (const i in src) dst[i] = src[i];
      } else {
        if (this.target) buffer.target = this.target;
        if (this.gl) buffer.gl = this.gl;
        if (this.spacing) buffer.spacing = this.spacing;
        if (this.data) {
          const ctor = this.data.constructor;
          buffer.data = new ctor(this.data);
          buffer.upload();
        }
      }
      return buffer;
    }
    toJSON() {
      if (!this.data) {
        console.error("cannot serialize a mesh without data");
        return null;
      }
      return {
        data_type: getClassName(this.data),
        data: this.data.toJSON(),
        target: this.target,
        attribute: this.attribute,
        spacing: this.spacing
      };
    }
    fromJSON(o) {
      const data_type = TYPED_ARRAY_CTORS[o.data_type] || Float32Array;
      this.data = new data_type(o.data);
      this.target = o.target;
      this.spacing = o.spacing || 3;
      this.attribute = o.attribute;
      this.upload(STATIC_DRAW);
    }
    /**
     * Deletes the content from the GPU and destroys the handler
     * @method delete
     */
    delete() {
      const gl2 = this.gl;
      if (!gl2) return;
      gl2.deleteBuffer(this.buffer);
      this.buffer = null;
    }
  };
  var _Mesh = class _Mesh {
    constructor(vertexbuffers, indexbuffers, options, gl2) {
      if (isDebug()) console.log("GL.Mesh created");
      if (gl2 !== null) {
        gl2 = gl2 || globalThis.gl;
        this.gl = gl2;
      }
      if (this.gl) this._context_id = this.gl.context_id;
      this.vertexBuffers = {};
      this.indexBuffers = {};
      this.info = {
        groups: []
      };
      this._bounding = BBox.create();
      if (vertexbuffers || indexbuffers)
        this.addBuffers(vertexbuffers, indexbuffers, options ? options.stream_type : null);
      if (options) {
        const self = this;
        const opts = options;
        for (const i in opts) self[i] = opts[i];
      }
    }
    get bounding() {
      return this._bounding;
    }
    set bounding(v) {
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
    addBuffer(name, buffer) {
      if (buffer.target == gl.ARRAY_BUFFER) this.vertexBuffers[name] = buffer;
      else this.indexBuffers[name] = buffer;
      if (!buffer.attribute) {
        const info = _Mesh.common_buffers[name];
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
    addBuffers(vertexbuffers, indexbuffers, stream_type) {
      let num_vertices = 0;
      if (this.vertexBuffers["vertices"]) num_vertices = this.vertexBuffers["vertices"].data.length / 3;
      for (const i in vertexbuffers) {
        let data = vertexbuffers[i];
        if (!data) continue;
        if (data.constructor === Buffer2 || data.data) {
          data = data.data;
        } else if (typeof data[0] != "number") {
          let newdata = [];
          const arr = data;
          for (let j = 0, chunk = 1e4; j < arr.length; j += chunk) {
            newdata = Array.prototype.concat.apply(newdata, arr.slice(j, j + chunk));
          }
          data = newdata;
        }
        const stream_info = _Mesh.common_buffers[i];
        if (data.constructor === Array) {
          let datatype = _Mesh.default_datatype;
          if (stream_info && stream_info.type) datatype = stream_info.type;
          data = new datatype(data);
        }
        if (i == "vertices") num_vertices = data.length / 3;
        let spacing = data.length / num_vertices;
        if (stream_info && stream_info.spacing) spacing = stream_info.spacing;
        let attribute = "a_" + i;
        if (stream_info && stream_info.attribute) attribute = stream_info.attribute;
        if (this.vertexBuffers[i]) this.updateVertexBuffer(i, attribute, spacing, data, stream_type);
        else this.createVertexBuffer(i, attribute, spacing, data, stream_type);
      }
      if (indexbuffers)
        for (const i in indexbuffers) {
          let data = indexbuffers[i];
          if (!data) continue;
          if (data.constructor === Buffer2 || data.data) {
            data = data.data;
          }
          if (typeof data[0] != "number") {
            let newdata = [];
            const arr = data;
            for (let k = 0, chunk = 1e4; k < arr.length; k += chunk) {
              newdata = Array.prototype.concat.apply(newdata, arr.slice(k, k + chunk));
            }
            data = newdata;
          }
          if (data.constructor === Array) {
            let datatype = Uint16Array;
            if (num_vertices > 256 * 256) datatype = Uint32Array;
            data = new datatype(data);
          }
          this.createIndexBuffer(i, data);
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
    createVertexBuffer(name, attribute, buffer_spacing, buffer_data, stream_type) {
      const common = _Mesh.common_buffers[name];
      if (!attribute && common) attribute = common.attribute;
      if (!attribute) throw "Buffer added to mesh without attribute name";
      if (!buffer_spacing && common) {
        if (common && common.spacing) buffer_spacing = common.spacing;
        else buffer_spacing = 3;
      }
      if (!buffer_data) {
        const num = this.getNumVertices();
        if (!num) throw "Cannot create an empty buffer in a mesh without vertices (vertices are needed to know the size)";
        buffer_data = new _Mesh.default_datatype(num * buffer_spacing);
      }
      if (!buffer_data.buffer) throw "Buffer data MUST be typed array";
      const buffer = this.vertexBuffers[name] = new Buffer2(ARRAY_BUFFER, buffer_data, buffer_spacing, stream_type, this.gl);
      buffer.name = name;
      buffer.attribute = attribute;
      if (buffer_data.constructor == Uint8Array || buffer_data.constructor == Int8Array || buffer_data.constructor == Uint16Array || buffer_data.constructor == Int16Array || buffer_data.constructor == Uint32Array || buffer_data.constructor == Int32Array) {
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
    updateVertexBuffer(name, attribute, buffer_spacing, buffer_data, stream_type) {
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
    removeVertexBuffer(name, free) {
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
    getVertexBuffer(name) {
      return this.vertexBuffers[name];
    }
    /**
     * Creates a new empty index buffer and attachs it to this mesh
     * @method createIndexBuffer
     * @param {String} name
     * @param {Typed array} data
     * @param {enum} stream_type gl.STATIC_DRAW, gl.DYNAMIC_DRAW, gl.STREAM_DRAW
     */
    createIndexBuffer(name, buffer_data, stream_type) {
      if (buffer_data.constructor === Array) {
        let datatype = Uint16Array;
        const vertices = this.vertexBuffers["vertices"];
        if (vertices) {
          const num_vertices = vertices.data.length / 3;
          if (num_vertices > 256 * 256) datatype = Uint32Array;
          buffer_data = new datatype(buffer_data);
        }
      }
      const buffer = this.indexBuffers[name] = new Buffer2(
        ELEMENT_ARRAY_BUFFER,
        buffer_data,
        0,
        stream_type,
        this.gl
      );
      return buffer;
    }
    /**
     * Returns a vertex buffer
     * @method getBuffer
     * @param {String} name of vertex buffer
     * @return {Buffer} the buffer
     */
    getBuffer(name) {
      return this.vertexBuffers[name];
    }
    /**
     * Returns a index buffer
     * @method getIndexBuffer
     * @param {String} name of index buffer
     * @return {Buffer} the buffer
     */
    getIndexBuffer(name) {
      return this.indexBuffers[name];
    }
    /**
     * Removes an index buffer from the mesh
     * @method removeIndexBuffer
     * @param {String} name "vertices","normals"...
     * @param {Boolean} free if you want to remove the data from the GPU
     */
    removeIndexBuffer(name, free) {
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
    upload(buffer_type) {
      for (const attribute in this.vertexBuffers) {
        const buffer = this.vertexBuffers[attribute];
        buffer.upload(buffer_type);
      }
      for (const name in this.indexBuffers) {
        const buffer = this.indexBuffers[name];
        buffer.upload();
      }
    }
    //LEGACY, plz remove
    compile(buffer_type) {
      this.upload(buffer_type);
    }
    deleteBuffers() {
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
    delete() {
      this.deleteBuffers();
    }
    bindBuffers(shader) {
      for (const name in this.vertexBuffers) {
        const buffer = this.vertexBuffers[name];
        const attribute = buffer.attribute || name;
        const location2 = shader.attributes[attribute];
        if (location2 == null || !buffer.buffer) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer.buffer);
        gl.enableVertexAttribArray(location2);
        gl.vertexAttribPointer(location2, buffer.buffer.spacing, buffer.buffer.gl_type, buffer.normalize || false, 0, 0);
      }
    }
    unbindBuffers(shader) {
      for (const name in this.vertexBuffers) {
        const buffer = this.vertexBuffers[name];
        const attribute = buffer.attribute || name;
        const location2 = shader.attributes[attribute];
        if (location2 == null || !buffer.buffer) continue;
        gl.disableVertexAttribArray(shader.attributes[attribute]);
      }
    }
    /**
     * Creates a clone of the mesh, the datarrays are cloned too
     * @method clone
     */
    clone(gl2) {
      gl2 = gl2 || globalThis.gl;
      const vbs = {};
      const ibs = {};
      for (const i in this.vertexBuffers) {
        const b = this.vertexBuffers[i];
        const ctor = b.data.constructor;
        vbs[i] = new ctor(b.data);
      }
      for (const i in this.indexBuffers) {
        const b = this.indexBuffers[i];
        const ctor = b.data.constructor;
        ibs[i] = new ctor(b.data);
      }
      return new _Mesh(vbs, ibs, void 0, gl2);
    }
    /**
     * Creates a clone of the mesh, but the data-arrays are shared between both meshes (useful for sharing a mesh between contexts)
     * @method clone
     */
    cloneShared(gl2) {
      gl2 = gl2 || globalThis.gl;
      return new _Mesh(this.vertexBuffers, this.indexBuffers, void 0, gl2);
    }
    /**
     * Creates an object with the info of the mesh (useful to transfer to workers)
     * @method toObject
     */
    toObject() {
      const vbs = {};
      const ibs = {};
      for (const i in this.vertexBuffers) {
        const b = this.vertexBuffers[i];
        const ctor = b.data.constructor;
        vbs[i] = {
          spacing: b.spacing,
          data: new ctor(b.data)
          //clone
        };
      }
      for (const i in this.indexBuffers) {
        const b = this.indexBuffers[i];
        const ctor = b.data.constructor;
        ibs[i] = {
          data: new ctor(b.data)
          //clone
        };
      }
      return {
        vertexBuffers: vbs,
        indexBuffers: ibs,
        info: this.info ? cloneObject(this.info) : null,
        bounding: this._bounding.toJSON()
      };
    }
    toJSON() {
      const r = {
        vertexBuffers: {},
        indexBuffers: {},
        info: this.info ? cloneObject(this.info) : null,
        bounding: this._bounding.toJSON()
      };
      for (const i in this.vertexBuffers) r.vertexBuffers[i] = this.vertexBuffers[i].toJSON();
      for (const i in this.indexBuffers) r.indexBuffers[i] = this.indexBuffers[i].toJSON();
      return r;
    }
    fromJSON(o) {
      this.vertexBuffers = {};
      this.indexBuffers = {};
      for (const i in o.vertexBuffers) {
        if (!o.vertexBuffers[i]) continue;
        const buffer = new Buffer2();
        buffer.fromJSON(o.vertexBuffers[i]);
        if (!buffer.attribute && _Mesh.common_buffers[i]) buffer.attribute = _Mesh.common_buffers[i].attribute;
        this.vertexBuffers[i] = buffer;
      }
      for (const i in o.indexBuffers) {
        if (!o.indexBuffers[i]) continue;
        const buffer = new Buffer2();
        buffer.fromJSON(o.indexBuffers[i]);
        this.indexBuffers[i] = buffer;
      }
      if (o.info) this.info = cloneObject(o.info);
      if (o.bounding) this.bounding = o.bounding;
    }
    /**
     * Computes some data about the mesh
     * @method generateMetadata
     */
    generateMetadata() {
      const metadata = {};
      const vertices = this.vertexBuffers["vertices"].data;
      const triangles = this.indexBuffers["triangles"].data;
      metadata.vertices = vertices.length / 3;
      if (triangles) metadata.faces = triangles.length / 3;
      else metadata.faces = vertices.length / 9;
      metadata.indexed = !!this.metadata.faces;
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
    computeWireframe() {
      const index_buffer = this.indexBuffers["triangles"];
      const vertices = this.vertexBuffers["vertices"].data;
      const num_vertices = vertices.length / 3;
      let buffer;
      if (!index_buffer) {
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
        const data = index_buffer.data;
        const indexer = new Indexer();
        for (let i = 0; i < data.length; i += 3) {
          const t = data.subarray(i, i + 3);
          for (let j = 0; j < t.length; j++) {
            const a = t[j], b = t[(j + 1) % t.length];
            indexer.add([Math.min(a, b), Math.max(a, b)]);
          }
        }
        const unique = indexer.unique;
        buffer = num_vertices > 256 * 256 ? new Uint32Array(unique.length * 2) : new Uint16Array(unique.length * 2);
        for (let i = 0, l = unique.length; i < l; ++i) buffer.set(unique[i], i * 2);
      }
      this.createIndexBuffer("wireframe", buffer);
      return this;
    }
    /**
     * Multiplies every normal by -1 and uploads it
     * @method flipNormals
     * @param {enum} stream_type default gl.STATIC_DRAW (other: gl.DYNAMIC_DRAW, gl.STREAM_DRAW)
     */
    flipNormals(stream_type) {
      const normals_buffer = this.vertexBuffers["normals"];
      if (!normals_buffer) return;
      const normals_data = normals_buffer.data;
      const nl = normals_data.length;
      for (let i = 0; i < nl; ++i) normals_data[i] *= -1;
      normals_buffer.upload(stream_type);
      if (!this.indexBuffers["triangles"]) this.computeIndices();
      const triangles_buffer = this.indexBuffers["triangles"];
      const data = triangles_buffer.data;
      const l = data.length;
      for (let i = 0; i < l; i += 3) {
        const tmp = data[i];
        data[i] = data[i + 1];
        data[i + 1] = tmp;
      }
      triangles_buffer.upload(stream_type);
    }
    /**
     * Compute indices for a mesh where vertices are shared
     * @method computeIndices
     */
    computeIndices() {
      const new_vertices = [];
      const new_normals = [];
      const new_coords = [];
      const indices = [];
      const old_vertices_buffer = this.vertexBuffers["vertices"];
      const old_normals_buffer = this.vertexBuffers["normals"];
      const old_coords_buffer = this.vertexBuffers["coords"];
      const old_vertices_data = old_vertices_buffer.data;
      let old_normals_data = null;
      if (old_normals_buffer) old_normals_data = old_normals_buffer.data;
      let old_coords_data = null;
      if (old_coords_buffer) old_coords_data = old_coords_buffer.data;
      const indexer = {};
      const l = old_vertices_data.length / 3;
      let j = 0;
      let l2 = 0;
      for (let i = 0; i < l; ++i) {
        const v = old_vertices_data.subarray(i * 3, (i + 1) * 3);
        const key = v[0] * 1e3 | 0;
        j = 0;
        const candidates = indexer[key];
        if (candidates) {
          l2 = candidates.length;
          for (; j < l2; j++) {
            const v2 = new_vertices[candidates[j]];
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
      this.vertexBuffers = {};
      this.createVertexBuffer("vertices", _Mesh.common_buffers["vertices"].attribute, 3, linearizeArray(new_vertices));
      if (old_normals_data)
        this.createVertexBuffer("normals", _Mesh.common_buffers["normals"].attribute, 3, linearizeArray(new_normals));
      if (old_coords_data)
        this.createVertexBuffer("coords", _Mesh.common_buffers["coords"].attribute, 2, linearizeArray(new_coords));
      this.createIndexBuffer("triangles", indices);
    }
    /**
     * Breaks the indices
     * @method explodeIndices
     */
    explodeIndices(buffer_name) {
      buffer_name = buffer_name || "triangles";
      const indices_buffer = this.getIndexBuffer(buffer_name);
      if (!indices_buffer) return;
      const indices = indices_buffer.data;
      const new_buffers = {};
      for (const i in this.vertexBuffers) {
        const info = _Mesh.common_buffers[i];
        new_buffers[i] = new (info.type || Float32Array)(info.spacing * indices.length);
      }
      for (let i = 0, l = indices.length; i < l; ++i) {
        const index = indices[i];
        for (const jname in this.vertexBuffers) {
          const buffer = this.vertexBuffers[jname];
          const info = _Mesh.common_buffers[jname];
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
    computeNormals(stream_type) {
      const vertices_buffer = this.vertexBuffers["vertices"];
      if (!vertices_buffer) {
        console.error("Cannot compute normals of a mesh without vertices");
        return;
      }
      const vertices = this.vertexBuffers["vertices"].data;
      const normals = new Float32Array(vertices.length);
      let triangles = null;
      if (this.indexBuffers["triangles"]) triangles = this.indexBuffers["triangles"].data;
      const temp = temp_vec3;
      const temp2 = temp2_vec3;
      let i1, i2, i3;
      let v1, v2, v3;
      let n1, n2, n3;
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
        vec3.add(n1, n1, temp);
        vec3.add(n2, n2, temp);
        vec3.add(n3, n3, temp);
      }
      if (triangles)
        for (let a = 0, ln = normals.length; a < ln; a += 3) {
          const n = normals.subarray(a, a + 3);
          vec3.normalize(n, n);
        }
      const normals_buffer = this.vertexBuffers["normals"];
      if (normals_buffer) {
        normals_buffer.data = normals;
        normals_buffer.upload(stream_type);
      } else return this.createVertexBuffer("normals", _Mesh.common_buffers["normals"].attribute, 3, normals);
      return normals_buffer;
    }
    /**
     * Creates a new stream with the tangents
     * @method computeTangents
     */
    computeTangents() {
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
      const vertices = vertices_buffer.data;
      const normals = normals_buffer.data;
      const uvs = uvs_buffer.data;
      const triangles = triangles_buffer.data;
      if (!vertices || !normals || !uvs) return;
      const num_vertices = vertices.length / 3;
      const tangents = new Float32Array(num_vertices * 4);
      const tan1 = new Float32Array(num_vertices * 3 * 2);
      const tan2 = tan1.subarray(num_vertices * 3);
      let a, l;
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
        let r;
        const den = s1 * t2 - s2 * t1;
        if (Math.abs(den) < 1e-9) r = 0;
        else r = 1 / den;
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
        vec3.subtract(temp, t, vec3.scale(temp, n, vec3.dot(n, t)));
        vec3.normalize(temp, temp);
        const w = vec3.dot(vec3.cross(temp2, n, t), tan2.subarray(a, a + 3)) < 0 ? -1 : 1;
        tangents.set([temp[0], temp[1], temp[2], w], a / 3 * 4);
      }
      this.createVertexBuffer("tangents", _Mesh.common_buffers["tangents"].attribute, 4, tangents);
    }
    /**
     * Creates texture coordinates using a triplanar aproximation
     * @method computeTextureCoordinates
     */
    computeTextureCoordinates(stream_type) {
      const vertices_buffer = this.vertexBuffers["vertices"];
      if (!vertices_buffer) {
        console.error("Cannot compute uvs of a mesh without vertices");
        return;
      }
      this.explodeIndices("triangles");
      const vertices = vertices_buffer.data;
      const num_vertices = vertices.length / 3;
      const uvs_buffer = this.vertexBuffers["coords"];
      const uvs = new Float32Array(num_vertices * 2);
      const triangles_buffer = this.indexBuffers["triangles"];
      let triangles = null;
      if (triangles_buffer) triangles = triangles_buffer.data;
      const plane_normal = vec3.create();
      const side1 = vec3.create();
      const side2 = vec3.create();
      const bbox = this.getBoundingBox();
      const bboxcenter = BBox.getCenter(bbox);
      const bboxhs = vec3.create();
      bboxhs.set(BBox.getHalfsize(bbox));
      vec3.scale(bboxhs, bboxhs, 2);
      const num = triangles ? triangles.length : vertices.length / 3;
      for (let a = 0; a < num; a += 3) {
        let v1, v2, v3;
        let uv1, uv2, uv3;
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
        plane_normal[0] = Math.abs(plane_normal[0]);
        plane_normal[1] = Math.abs(plane_normal[1]);
        plane_normal[2] = Math.abs(plane_normal[2]);
        if (plane_normal[0] > plane_normal[1] && plane_normal[0] > plane_normal[2]) {
          uv1[0] = (v1[2] - bboxcenter[2]) / bboxhs[2];
          uv1[1] = (v1[1] - bboxcenter[1]) / bboxhs[1];
          uv2[0] = (v2[2] - bboxcenter[2]) / bboxhs[2];
          uv2[1] = (v2[1] - bboxcenter[1]) / bboxhs[1];
          uv3[0] = (v3[2] - bboxcenter[2]) / bboxhs[2];
          uv3[1] = (v3[1] - bboxcenter[1]) / bboxhs[1];
        } else if (plane_normal[1] > plane_normal[2]) {
          uv1[0] = (v1[0] - bboxcenter[0]) / bboxhs[0];
          uv1[1] = (v1[2] - bboxcenter[2]) / bboxhs[2];
          uv2[0] = (v2[0] - bboxcenter[0]) / bboxhs[0];
          uv2[1] = (v2[2] - bboxcenter[2]) / bboxhs[2];
          uv3[0] = (v3[0] - bboxcenter[0]) / bboxhs[0];
          uv3[1] = (v3[2] - bboxcenter[2]) / bboxhs[2];
        } else {
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
      } else this.createVertexBuffer("coords", _Mesh.common_buffers["coords"].attribute, 2, uvs);
    }
    /**
     * Computes the number of vertices
     * @method getVertexNumber
     */
    getNumVertices() {
      const b = this.vertexBuffers["vertices"];
      if (!b) return 0;
      return b.data.length / b.spacing;
    }
    /**
     * Computes the number of triangles (takes into account indices)
     * @method getNumTriangles
     */
    getNumTriangles() {
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
    static computeBoundingBox(vertices, bb, mask) {
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
      let v;
      for (let i = start * 3; i < vertices.length; i += 3) {
        if (mask && !mask[i / 3]) continue;
        v = vertices.subarray(i, i + 3);
        vec3.min(min, v, min);
        vec3.max(max, v, max);
      }
      if (isNaN(min[0]) || isNaN(min[1]) || isNaN(min[2]) || isNaN(max[0]) || isNaN(max[1]) || isNaN(max[2])) {
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
    getBoundingBox() {
      if (this._bounding) return this._bounding;
      this.updateBoundingBox();
      return this._bounding;
    }
    /**
     * Update bounding information of this mesh
     * @method updateBoundingBox
     */
    updateBoundingBox() {
      const vertices = this.vertexBuffers["vertices"];
      if (!vertices) return;
      _Mesh.computeBoundingBox(vertices.data, this._bounding);
      if (this.info && this.info.groups && this.info.groups.length) this.computeGroupsBoundingBoxes();
    }
    /**
     * Update bounding information for every group submesh
     * @method computeGroupsBoundingBoxes
     */
    computeGroupsBoundingBoxes() {
      let indices = null;
      const indices_buffer = this.getIndexBuffer("triangles");
      if (indices_buffer) indices = indices_buffer.data;
      const vertices_buffer = this.getVertexBuffer("vertices");
      if (!vertices_buffer) return false;
      const vertices = vertices_buffer.data;
      if (!vertices.length) return false;
      const groups = this.info.groups;
      if (!groups) return;
      for (let i = 0; i < groups.length; ++i) {
        const group = groups[i];
        group.bounding = group.bounding || BBox.create();
        let submesh_vertices = null;
        if (indices) {
          const mask = new Uint8Array(vertices.length / 3);
          const s = group.start;
          for (let j = 0, l = group.length; j < l; j += 3) {
            mask[indices[s + j]] = 1;
            mask[indices[s + j + 1]] = 1;
            mask[indices[s + j + 2]] = 1;
          }
          _Mesh.computeBoundingBox(vertices, group.bounding, mask);
        } else {
          submesh_vertices = vertices.subarray(group.start * 3, (group.start + group.length) * 3);
          _Mesh.computeBoundingBox(submesh_vertices, group.bounding);
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
    setBoundingBox(center, half_size) {
      BBox.setCenterHalfsize(this._bounding, center, half_size);
    }
    /**
     * Remove all local memory from the streams (leaving it only in the VRAM) to save RAM
     * @method freeData
     */
    freeData() {
      const self = this;
      for (const attribute in this.vertexBuffers) {
        this.vertexBuffers[attribute].data = null;
        delete self[this.vertexBuffers[attribute].name];
      }
      for (const name in this.indexBuffers) {
        this.indexBuffers[name].data = null;
        delete self[this.indexBuffers[name].name];
      }
    }
    configure(o, options) {
      const vertex_buffers = {};
      const index_buffers = {};
      const opts = options || {};
      for (const j in o) {
        if (!o[j]) continue;
        if (j == "vertexBuffers" || j == "vertex_buffers") {
          const src = o[j];
          for (const k in src) vertex_buffers[k] = src[k];
          continue;
        }
        if (j == "indexBuffers" || j == "index_buffers") {
          const src = o[j];
          for (const k in src) index_buffers[k] = src[k];
          continue;
        }
        if (j == "indices" || j == "lines" || j == "wireframe" || j == "triangles") index_buffers[j] = o[j];
        else if (_Mesh.common_buffers[j]) vertex_buffers[j] = o[j];
        else {
          opts[j] = o[j];
        }
      }
      this.addBuffers(vertex_buffers, index_buffers, opts.stream_type);
      const self = this;
      for (const i in opts) self[i] = opts[i];
      if (!opts.bounding) this.updateBoundingBox();
    }
    /**
     * Returns the amount of memory used by this mesh in bytes (sum of all buffers)
     * @method getMemory
     * @return {number} bytes
     */
    totalMemory() {
      let num = 0 | 0;
      for (const name in this.vertexBuffers) num += this.vertexBuffers[name].data.buffer.byteLength;
      for (const name in this.indexBuffers) num += this.indexBuffers[name].data.buffer.byteLength;
      return num;
    }
    slice(start, length) {
      const new_vertex_buffers = {};
      const indices_buffer = this.indexBuffers["triangles"];
      if (!indices_buffer) {
        console.warn("splice in not indexed not supported yet");
        return null;
      }
      const indices = indices_buffer.data;
      const new_triangles = [];
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
      const new_mesh = new _Mesh(new_vertex_buffers, { triangles: new_triangles }, null, gl);
      new_mesh.updateBoundingBox();
      return new_mesh;
    }
    /**
     * returns a low poly version of the mesh that takes much less memory (but breaks tiling of uvs and smoothing groups)
     * @method simplify
     * @return {Mesh} simplified mesh
     */
    simplify() {
      const bb = this.getBoundingBox();
      const min = BBox.getMin(bb);
      const halfsize = BBox.getHalfsize(bb);
      const range = vec3.scale(vec3.create(), halfsize, 2);
      const newmesh = new _Mesh();
      const temp = vec3.create();
      for (const i in this.vertexBuffers) {
        const buffer = this.vertexBuffers[i];
        const data = buffer.data;
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
        }
        newmesh.addBuffer();
      }
    }
    /**
     * Static method for the class Mesh to create a mesh from a list of common streams
     * @method Mesh.load
     * @param {Object} buffers object will all the buffers
     * @param {Object} options [optional]
     * @param {Mesh} output_mesh [optional] mesh to store the mesh, otherwise is created
     * @param {WebGLContext} gl [optional] if omitted, the global.gl is used
     */
    static load(buffers, options, output_mesh, gl2) {
      options = options || {};
      if (options.no_gl) gl2 = null;
      const mesh = output_mesh || new _Mesh(null, null, null, gl2);
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
    static mergeMeshes(meshes, options) {
      options = options || {};
      const vertex_buffers = {};
      const index_buffers = {};
      const offsets = {};
      const vertex_offsets = [];
      let current_vertex_offset = 0;
      let num_vertices = 0;
      const groups = [];
      const bones = [];
      const bones_by_index = {};
      let num_morphs = 0;
      let morphs = null;
      let mesh = meshes[0].mesh;
      for (let i = 0; i < meshes.length; ++i) {
        const mesh_info = meshes[i];
        mesh = mesh_info.mesh;
        const offset = current_vertex_offset;
        vertex_offsets.push(offset);
        const length = mesh.vertexBuffers["vertices"].data.length / 3;
        current_vertex_offset += length;
        for (const j in mesh.vertexBuffers) {
          if (!vertex_buffers[j]) vertex_buffers[j] = mesh.vertexBuffers[j].data.length;
          else vertex_buffers[j] += mesh.vertexBuffers[j].data.length;
        }
        for (const j in mesh.indexBuffers) {
          if (!index_buffers[j]) index_buffers[j] = mesh.indexBuffers[j].data.length;
          else index_buffers[j] += mesh.indexBuffers[j].data.length;
        }
        const group = {
          name: "mesh_" + i,
          start: offset,
          length,
          material: ""
        };
        const mesh_bones = mesh.bones;
        if (mesh_bones) {
          const prev_bones_by_index = {};
          for (let j = 0; j < mesh_bones.length; ++j) {
            const b = mesh_bones[j];
            if (!bones_by_index[b[0]]) {
              bones_by_index[b[0]] = bones.length;
              bones.push(b);
            }
            prev_bones_by_index[j] = bones_by_index[b[0]];
          }
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
      for (const j in vertex_buffers) {
        let datatype = options[j];
        if (datatype === null) {
          delete vertex_buffers[j];
          continue;
        }
        if (!datatype) {
          let one_buffer = mesh.vertexBuffers[j];
          if (one_buffer) {
            if (one_buffer.data) one_buffer = one_buffer.data;
            if (one_buffer.constructor !== Array) datatype = one_buffer.constructor;
          }
          if (!datatype) datatype = Float32Array;
        }
        vertex_buffers[j] = new datatype(vertex_buffers[j]);
        offsets[j] = 0;
        if (j === "vertices") num_vertices = vertex_buffers[j].length / 3;
      }
      if (num_morphs) {
        morphs = [];
        for (let i = 0; i < num_morphs; ++i) {
          const base_mesh = meshes[0].mesh;
          const base_morphs = base_mesh.morphs;
          const morph_data = {
            name: base_morphs[i].name,
            weight: base_morphs[i].weight,
            buffers: {
              vertices: new Float32Array(num_vertices * 3),
              normals: new Float32Array(num_vertices * 3)
            }
          };
          morphs.push(morph_data);
        }
      }
      for (const j in index_buffers) {
        const datatype = current_vertex_offset < 256 * 256 ? Uint16Array : Uint32Array;
        index_buffers[j] = new datatype(index_buffers[j]);
        offsets[j] = 0;
      }
      function apply_transform(array, start, length, matrix) {
        const l = start + length;
        for (let i = start; i < l; i += 3) {
          const v = array.subarray(i, i + 3);
          vec3.transformMat4(v, v, matrix);
        }
      }
      function apply_transform2D(array, start, length, matrix) {
        const l = start + length;
        for (let i = start; i < l; i += 2) {
          const v = array.subarray(i, i + 2);
          vec2.transformMat3(v, v, matrix);
        }
      }
      function apply_offset(array, start, length, offset) {
        if (!offset) return;
        const l = start + length;
        for (let i = start; i < l; ++i) array[i] += offset;
      }
      for (let i = 0; i < meshes.length; ++i) {
        const mesh_info = meshes[i];
        mesh = mesh_info.mesh;
        const offset = offsets["vertices"];
        for (const j in mesh.vertexBuffers) {
          if (!vertex_buffers[j]) continue;
          vertex_buffers[j].set(mesh.vertexBuffers[j].data, offsets[j]);
          if (mesh_info[j + "_matrix"]) {
            const matrix = mesh_info[j + "_matrix"];
            if (matrix.length == 16)
              apply_transform(vertex_buffers[j], offsets[j], mesh.vertexBuffers[j].data.length, matrix);
            else if (matrix.length == 9)
              apply_transform2D(vertex_buffers[j], offsets[j], mesh.vertexBuffers[j].data.length, matrix);
          }
          offsets[j] += mesh.vertexBuffers[j].data.length;
        }
        for (const j in mesh.indexBuffers) {
          index_buffers[j].set(mesh.indexBuffers[j].data, offsets[j]);
          apply_offset(index_buffers[j], offsets[j], mesh.indexBuffers[j].data.length, vertex_offsets[i]);
          offsets[j] += mesh.indexBuffers[j].data.length;
        }
        if (num_morphs) {
          const mesh_morphs = mesh.morphs;
          for (let j = 0; j < mesh_morphs.length; ++j) {
            const morph = mesh_morphs[j];
            for (const k in morph.buffers) {
              const morph_data = morph.buffers[k];
              morphs[j].buffers[k].set(morph_data, offset);
            }
          }
        }
      }
      const extra = { info: { groups } };
      if (bones.length) extra.bones = bones;
      if (!options.only_data) {
        const merged = new _Mesh(
          vertex_buffers,
          index_buffers,
          extra
        );
        merged.updateBoundingBox();
        if (morphs) merged.morphs = morphs;
        return merged;
      }
      return {
        vertexBuffers: vertex_buffers,
        indexBuffers: index_buffers,
        info: { groups },
        morphs
      };
    }
    /**
     * Returns am empty mesh and loads a mesh and parses it using the Mesh.parsers, by default only OBJ is supported
     * @method Mesh.fromOBJ
     * @param {Array} meshes array containing all the meshes
     */
    static fromURL(url, on_complete, gl2, options) {
      options = options || {};
      gl2 = gl2 || globalThis.gl;
      const pos = url.lastIndexOf(".");
      let extension = url.substr(pos + 1).toLowerCase();
      if (options.extension) extension = options.extension;
      const parser = _Mesh.parsers[extension.toLowerCase()];
      if (!parser) {
        console.error("No parser available in litegl to parse mesh of type", extension);
        return null;
      }
      const mesh = new _Mesh(void 0, void 0, void 0, gl2);
      mesh.ready = false;
      options.binary = _Mesh.binary_file_formats[extension];
      HttpRequest(
        url,
        null,
        function(data) {
          mesh.parse(data, extension, options);
          delete mesh.ready;
          if (on_complete) on_complete.call(mesh, mesh, url, options);
        },
        function() {
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
    parse(data, format, options) {
      options = options || {};
      options.mesh = this;
      format = format.toLowerCase();
      const parser = _Mesh.parsers[format];
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
    encode(format, options) {
      format = format.toLowerCase();
      const encoder = _Mesh.encoders[format];
      if (encoder) return encoder.call(null, this, options);
      throw "GL.Mesh.encode: no encoder found for format " + format;
    }
    /**
     * Returns a shared mesh containing a quad to be used when rendering to the screen
     * Reusing the same quad helps not filling the memory
     * @method getScreenQuad
     * @return {GL.Mesh} the screen quad
     */
    static getScreenQuad(gl2) {
      gl2 = gl2 || globalThis.gl;
      let mesh = gl2.meshes[":screen_quad"];
      if (mesh) return mesh;
      const vertices = new Float32Array([0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0]);
      const coords = new Float32Array([0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1]);
      mesh = new _Mesh({ vertices, coords }, void 0, void 0, gl2);
      return gl2.meshes[":screen_quad"] = mesh;
    }
  };
  // --- static registries and defaults defined in this file ---
  _Mesh.common_buffers = {
    vertices: { spacing: 3, attribute: "a_vertex" },
    vertices2D: { spacing: 2, attribute: "a_vertex2D" },
    normals: { spacing: 3, attribute: "a_normal", normalize: true },
    coords: { spacing: 2, attribute: "a_coord" },
    coords1: { spacing: 2, attribute: "a_coord1" },
    coords2: { spacing: 2, attribute: "a_coord2" },
    colors: { spacing: 4, attribute: "a_color", normalize: true },
    // cant use Uint8Array, dont know how as data comes in another format
    tangents: { spacing: 3, attribute: "a_tangent" },
    bone_indices: { spacing: 4, attribute: "a_bone_indices", type: Uint8Array },
    weights: { spacing: 4, attribute: "a_weights", normalize: true },
    // cant use Uint8Array, dont know how
    extra: { spacing: 1, attribute: "a_extra" },
    extra2: { spacing: 2, attribute: "a_extra2" },
    extra3: { spacing: 3, attribute: "a_extra3" },
    extra4: { spacing: 4, attribute: "a_extra4" }
  };
  _Mesh.default_datatype = Float32Array;
  //Here we store all basic mesh parsers (OBJ, STL) and encoders
  _Mesh.parsers = {};
  _Mesh.encoders = {};
  _Mesh.binary_file_formats = {};
  //extensions that must be downloaded in binary
  _Mesh.compressors = {};
  //used to compress binary meshes
  _Mesh.decompressors = {};
  //used to decompress binary meshes
  _Mesh.EXTENSION = "wbin";
  _Mesh.enable_wbin_compression = true;
  var Mesh = _Mesh;
  function linearizeArray(array, typed_array_class) {
    const generic = array;
    if (generic.constructor === typed_array_class) return array;
    if (generic.constructor !== Array) {
      const ctor2 = typed_array_class || Float32Array;
      return new ctor2(array);
    }
    const ctor = typed_array_class || Float32Array;
    const outer = array;
    const components = outer[0].length;
    const size = outer.length * components;
    const buffer = new ctor(size);
    for (let i = 0; i < outer.length; ++i)
      for (let j = 0; j < components; ++j) buffer[i * components + j] = outer[i][j];
    return buffer;
  }
  var _DynamicMesh = class _DynamicMesh extends Mesh {
    constructor(size, normals, coords, colors, gl2) {
      super(void 0, void 0, void 0, gl2);
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
    resize(size) {
      const buffers = {};
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
    clear() {
      this.current_pos = 0;
    }
    addPoint(vertex, normal, coord, color) {
      if (this.current_pos >= this.max_size) {
        console.warn("DynamicMesh: not enough space, reserve more");
        return false;
      }
      const pos = this.current_pos++;
      this._vertex_data.set(vertex, pos * 3);
      if (this._normal_data) this._normal_data.set(normal || _DynamicMesh.DEFAULT_NORMAL, pos * 3);
      if (this._coord_data) this._coord_data.set(coord || _DynamicMesh.DEFAULT_COORD, pos * 2);
      if (this._color_data) this._color_data.set(color || _DynamicMesh.DEFAULT_COLOR, pos * 4);
      this._must_update = true;
      return true;
    }
    update(force) {
      if (!this._must_update && !force) return this.current_pos;
      this._must_update = false;
      this.getBuffer("vertices").upload(gl.STREAM_DRAW);
      if (this._normal_data) this.getBuffer("normal").upload(gl.STREAM_DRAW);
      if (this._coord_data) this.getBuffer("coord").upload(gl.STREAM_DRAW);
      if (this._color_data) this.getBuffer("color").upload(gl.STREAM_DRAW);
      return this.current_pos;
    }
  };
  _DynamicMesh.DEFAULT_NORMAL = vec3.fromValues(0, 1, 0);
  _DynamicMesh.DEFAULT_COORD = vec2.fromValues(0.5, 0.5);
  _DynamicMesh.DEFAULT_COLOR = vec4.fromValues(1, 1, 1, 1);
  var DynamicMesh = _DynamicMesh;

  // src/shader.ts
  var temp_attribs_array = new Uint8Array(16);
  var temp_attribs_array_zero = new Uint8Array(16);
  var _Shader = class _Shader {
    constructor(vertexSource, fragmentSource, macros) {
      this.attributes = {};
      this.uniformInfo = {};
      this.samplers = {};
      var _a;
      if ((_a = globalThis.GL) == null ? void 0 : _a.debug)
        console.log("GL.Shader created");
      if (!vertexSource || !fragmentSource) throw "GL.Shader source code parameter missing";
      this._context_id = globalThis.gl.context_id;
      const gl2 = this.gl = globalThis.gl;
      const extra_code = _Shader.expandMacros(macros);
      const final_vertexSource = typeof vertexSource === "string" ? _Shader.injectCode(extra_code, vertexSource, gl2) : vertexSource;
      const final_fragmentSource = typeof fragmentSource === "string" ? _Shader.injectCode(extra_code, fragmentSource, gl2) : fragmentSource;
      this.program = gl2.createProgram();
      const vs = typeof vertexSource === "string" ? _Shader.compileSource(VERTEX_SHADER, final_vertexSource) : vertexSource;
      const fs = typeof fragmentSource === "string" ? _Shader.compileSource(FRAGMENT_SHADER, final_fragmentSource) : fragmentSource;
      gl2.attachShader(this.program, vs);
      gl2.attachShader(this.program, fs);
      gl2.linkProgram(this.program);
      this.vs_shader = vs;
      this.fs_shader = fs;
      this.attributes = {};
      this.uniformInfo = {};
      this.samplers = {};
      if (!_Shader.use_async) this.checkLink();
      else this._first_use = true;
    }
    static expandMacros(macros) {
      let extra_code = "";
      if (macros) for (const i in macros) extra_code += "#define " + i + " " + (macros[i] ? macros[i] : "") + "\n";
      return extra_code;
    }
    // this is done to avoid problems with the #version which must be in the first line
    static injectCode(inject_code, code, gl2) {
      const index = code.indexOf("\n");
      const version = gl2 ? "#define WEBGL" + gl2.webgl_version + "\n" : "";
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
    static compileSource(type, source, gl2, shader) {
      const g = gl2 || globalThis.gl;
      const sh = shader || g.createShader(type);
      g.shaderSource(sh, source);
      g.compileShader(sh);
      return sh;
    }
    static parseError(error_str, vs_code, fs_code) {
      if (!error_str) return null;
      const t = error_str.split(" ");
      const nums = t[5].split(":");
      return {
        type: t[0],
        line_number: parseInt(nums[1]),
        line_pos: parseInt(nums[0]),
        line_code: (t[0] == "Fragment" ? fs_code : vs_code).split("\n")[parseInt(nums[1])],
        err: error_str
      };
    }
    /**
     * clears all memory allocated by this shader
     * @method delete
     */
    delete() {
      if (this.program) this.gl.deleteProgram(this.program);
      if (this.vs_shader) this.gl.deleteShader(this.vs_shader);
      if (this.fs_shader) this.gl.deleteShader(this.fs_shader);
      this.gl = null;
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
    updateShader(vertexSource, fragmentSource, macros) {
      const gl2 = this.gl || globalThis.gl;
      if (!this.program) this.program = gl2.createProgram();
      else {
        gl2.detachShader(this.program, this.vs_shader);
        gl2.detachShader(this.program, this.fs_shader);
      }
      const extra_code = _Shader.expandMacros(macros);
      const final_vertexSource = typeof vertexSource === "string" ? _Shader.injectCode(extra_code, vertexSource, gl2) : vertexSource;
      const final_fragmentSource = typeof fragmentSource === "string" ? _Shader.injectCode(extra_code, fragmentSource, gl2) : fragmentSource;
      const vs = typeof vertexSource === "string" ? _Shader.compileSource(VERTEX_SHADER, final_vertexSource) : vertexSource;
      const fs = typeof fragmentSource === "string" ? _Shader.compileSource(FRAGMENT_SHADER, final_fragmentSource) : fragmentSource;
      gl2.attachShader(this.program, vs);
      gl2.attachShader(this.program, fs);
      gl2.linkProgram(this.program);
      this.vs_shader = vs;
      this.fs_shader = fs;
      this.attributes = {};
      this.uniformInfo = {};
      this.samplers = {};
      if (!_Shader.use_async) this.checkLink();
      else this._first_use = true;
    }
    /**
     * It extract all the info about the compiled shader program, all the info about uniforms and attributes.
     * This info is stored so it works faster during rendering.
     * @method extractShaderInfo
     */
    extractShaderInfo() {
      const gl2 = this.gl;
      const l = gl2.getProgramParameter(this.program, gl2.ACTIVE_UNIFORMS);
      for (let i = 0; i < l; ++i) {
        const data = gl2.getActiveUniform(this.program, i);
        if (!data) break;
        let uniformName = data.name;
        const pos = uniformName.indexOf("[");
        if (pos != -1) {
          const pos2 = uniformName.indexOf("].");
          if (pos2 == -1) uniformName = uniformName.substr(0, pos);
        }
        if (data.type == SAMPLER_2D || data.type == SAMPLER_CUBE || data.type == SAMPLER_3D || data.type == INT_SAMPLER_2D || data.type == INT_SAMPLER_CUBE || data.type == INT_SAMPLER_3D || data.type == UNSIGNED_INT_SAMPLER_2D || data.type == UNSIGNED_INT_SAMPLER_CUBE || data.type == UNSIGNED_INT_SAMPLER_3D)
          this.samplers[uniformName] = data.type;
        const func = _Shader.getUniformFunc(data);
        let is_matrix = false;
        if (data.type == FLOAT_MAT2 || data.type == FLOAT_MAT3 || data.type == FLOAT_MAT4) is_matrix = true;
        const type_length = TYPE_LENGTH[data.type] || 1;
        this.uniformInfo[uniformName] = {
          type: data.type,
          func,
          size: data.size,
          type_length,
          is_matrix,
          loc: gl2.getUniformLocation(this.program, uniformName),
          data: new Float32Array(type_length * data.size)
          // prealloc space to assign uniforms that are not typed
        };
      }
      for (let i = 0, l2 = gl2.getProgramParameter(this.program, gl2.ACTIVE_ATTRIBUTES); i < l2; ++i) {
        const data = gl2.getActiveAttrib(this.program, i);
        if (!data) break;
        const func = _Shader.getUniformFunc(data);
        const type_length = TYPE_LENGTH[data.type] || 1;
        this.uniformInfo[data.name] = {
          type: data.type,
          func,
          type_length,
          size: data.size,
          loc: null
        };
        if (data.name !== "gl_VertexID")
          this.attributes[data.name] = gl2.getAttribLocation(this.program, data.name);
      }
    }
    /**
     * Returns if this shader has a uniform with the given name
     * @method hasUniform
     * @param {String} name name of the uniform
     * @return {Boolean}
     */
    hasUniform(name) {
      return this.uniformInfo[name];
    }
    /**
     * Returns if this shader has an attribute with the given name
     * @method hasAttribute
     * @param {String} name name of the attribute
     * @return {Boolean}
     */
    hasAttribute(name) {
      return this.attributes[name];
    }
    /**
     * Tells you which function to call when uploading a uniform according to the data type in the shader
     * Used internally from extractShaderInfo to optimize calls
     * @method Shader.getUniformFunc
     * @param {Object} data info about the uniform
     * @return {Function}
     */
    static getUniformFunc(data) {
      let func;
      switch (data.type) {
        case FLOAT:
          if (data.size == 1) func = gl.uniform1f;
          else func = gl.uniform1fv;
          break;
        case FLOAT_MAT2:
          func = gl.uniformMatrix2fv;
          break;
        case FLOAT_MAT3:
          func = gl.uniformMatrix3fv;
          break;
        case FLOAT_MAT4:
          func = gl.uniformMatrix4fv;
          break;
        case FLOAT_VEC2:
          func = gl.uniform2fv;
          break;
        case FLOAT_VEC3:
          func = gl.uniform3fv;
          break;
        case FLOAT_VEC4:
          func = gl.uniform4fv;
          break;
        case UNSIGNED_INT:
        case INT:
          if (data.size == 1) func = gl.uniform1i;
          else func = gl.uniform1iv;
          break;
        case INT_VEC2:
          func = gl.uniform2iv;
          break;
        case INT_VEC3:
          func = gl.uniform3iv;
          break;
        case INT_VEC4:
          func = gl.uniform4iv;
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
          func = gl.uniform1i;
          break;
        default:
          func = gl.uniform1f;
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
    static fromURL(vs_path, fs_path, _on_complete) {
      const vs_code = "\n			precision highp float;\n			attribute vec3 a_vertex;\n			attribute mat4 u_mvp;\n			void main() { \n				gl_Position = u_mvp * vec4(a_vertex,1.0); \n			}\n		";
      const fs_code = "\n			precision highp float;\n			void main() {\n				gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);\n			}\n			";
      const shader = new _Shader(vs_code, fs_code);
      shader.ready = false;
      let true_vs = null;
      let true_fs = null;
      HttpRequest(vs_path, null, function(code) {
        true_vs = code;
        if (true_fs) compileShader();
      });
      HttpRequest(fs_path, null, function(code) {
        true_fs = code;
        if (true_vs) compileShader();
      });
      function compileShader() {
        const true_shader = new _Shader(true_vs, true_fs);
        for (const i in true_shader) shader[i] = true_shader[i];
        shader.ready = true;
      }
      return shader;
    }
    // check if shader works
    checkLink() {
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
    bind() {
      const gl2 = this.gl;
      if (_Shader.use_async && this._first_use) {
        this.checkLink();
        this._first_use = false;
      }
      gl2.useProgram(this.program);
      gl2._current_shader = this;
    }
    /**
     * Returns the location of a uniform or attribute
     * @method getLocation
     * @param {String} name
     * @return {WebGLUniformLocation} location
     */
    getLocation(name) {
      const info = this.uniformInfo[name];
      if (info) return this.uniformInfo[name].loc;
      return null;
    }
    /**
     * Uploads a set of uniforms to the Shader. You dont need to specify types, they are infered from the shader info.
     * @method uniforms
     * @param {Object} uniforms
     */
    uniforms(uniforms) {
      const gl2 = this.gl;
      if (this._first_use) this.checkLink();
      gl2.useProgram(this.program);
      gl2._current_shader = this;
      for (const name in uniforms) {
        const info = this.uniformInfo[name];
        if (!info) continue;
        this._setUniform(name, uniforms[name]);
      }
      return this;
    }
    // uniforms
    uniformsArray(array) {
      const gl2 = this.gl;
      if (this._first_use) this.checkLink();
      gl2.useProgram(this.program);
      gl2._current_shader = this;
      for (let i = 0, l = array.length; i < l; ++i) {
        const uniforms = array[i];
        for (const name in uniforms) this._setUniform(name, uniforms[name]);
      }
      return this;
    }
    /**
     * Uploads a uniform to the Shader. You dont need to specify types, they are infered from the shader info. Shader must be binded!
     * @method setUniform
     * @param {string} name
     * @param {*} value
     */
    setUniform(name, value) {
      if (this.gl._current_shader != this) this.bind();
      const info = this.uniformInfo[name];
      if (!info) return;
      if (info.loc === null) return;
      if (value == null) return;
      if (value.constructor === Array) {
        info.data.set(value);
        value = info.data;
      }
      if (info.is_matrix) info.func.call(this.gl, info.loc, false, value);
      else info.func.call(this.gl, info.loc, value);
    }
    // skips enabling shader
    _setUniform(name, value) {
      if (this._first_use) this.checkLink();
      const info = this.uniformInfo[name];
      if (!info) return;
      if (info.loc === null) return;
      if (value == null) return;
      if (value.constructor === Array) {
        info.data.set(value);
        value = info.data;
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
    draw(mesh, mode, index_buffer_name) {
      const ibn = index_buffer_name === void 0 ? mode == LINES ? "lines" : "triangles" : index_buffer_name;
      return this.drawBuffers(
        mesh.vertexBuffers,
        ibn ? mesh.indexBuffers[ibn] : null,
        mode === void 0 ? TRIANGLES : mode
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
    drawRange(mesh, mode, start, length, index_buffer_name) {
      const ibn = index_buffer_name === void 0 ? mode == LINES ? "lines" : "triangles" : index_buffer_name;
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
    drawBuffers(vertexBuffers, indexBuffer, mode, range_start, range_length) {
      if (range_length == 0) return this;
      const gl2 = this.gl;
      if (this._first_use) this.checkLink();
      gl2.useProgram(this.program);
      let length = 0;
      const attribs_in_use = temp_attribs_array;
      attribs_in_use.set(temp_attribs_array_zero);
      for (const name in vertexBuffers) {
        const buffer = vertexBuffers[name];
        const attribute = buffer.attribute || name;
        const location2 = this.attributes[attribute];
        if (location2 == null || !buffer.buffer)
          continue;
        attribs_in_use[location2] = 1;
        const glbuffer = buffer.buffer;
        gl2.bindBuffer(gl2.ARRAY_BUFFER, glbuffer);
        gl2.enableVertexAttribArray(location2);
        gl2.vertexAttribPointer(location2, glbuffer.spacing, glbuffer.gl_type, buffer.normalize, 0, 0);
        length = glbuffer.length / glbuffer.spacing;
      }
      let offset = 0;
      if (range_start !== void 0 && range_start > 0)
        offset = range_start;
      if (indexBuffer) length = indexBuffer.buffer.length - offset;
      if (range_length !== void 0 && range_length > 0 && range_length < length)
        length = range_length;
      const BYTES_PER_ELEMENT = indexBuffer && indexBuffer.data ? indexBuffer.data.constructor.BYTES_PER_ELEMENT : 1;
      offset *= BYTES_PER_ELEMENT;
      for (const attribute in this.attributes) {
        const location2 = this.attributes[attribute];
        if (!attribs_in_use[location2]) {
          gl2.disableVertexAttribArray(this.attributes[attribute]);
        }
      }
      if (length && (!indexBuffer || indexBuffer.buffer)) {
        if (indexBuffer) {
          gl2.bindBuffer(gl2.ELEMENT_ARRAY_BUFFER, indexBuffer.buffer);
          gl2.drawElements(mode, length, indexBuffer.buffer.gl_type, offset);
          gl2.bindBuffer(gl2.ELEMENT_ARRAY_BUFFER, null);
        } else {
          gl2.drawArrays(mode, offset, length);
        }
        gl2.draw_calls++;
      }
      return this;
    }
    drawInstanced(mesh, primitive, indices, instanced_uniforms, range_start, range_length, num_intances) {
      if (range_length === 0) return;
      const gl2 = this.gl;
      if (gl2.webgl_version == 1 && !gl2.extensions.ANGLE_instanced_arrays) throw "instancing not supported";
      if (this._first_use) this.checkLink();
      gl2.useProgram(this.program);
      let length = 0;
      const attribs_in_use = temp_attribs_array;
      attribs_in_use.set(temp_attribs_array_zero);
      const vertexBuffers = mesh.vertexBuffers;
      for (const name in vertexBuffers) {
        const buffer = vertexBuffers[name];
        const attribute = buffer.attribute || name;
        const location2 = this.attributes[attribute];
        if (location2 == null || !buffer.buffer)
          continue;
        attribs_in_use[location2] = 1;
        const glbuffer = buffer.buffer;
        gl2.bindBuffer(gl2.ARRAY_BUFFER, glbuffer);
        gl2.enableVertexAttribArray(location2);
        gl2.vertexAttribPointer(location2, glbuffer.spacing, glbuffer.gl_type, buffer.normalize, 0, 0);
        length = glbuffer.length / glbuffer.spacing;
      }
      let indexBuffer = null;
      if (indices) {
        if (typeof indices === "string") indexBuffer = mesh.getIndexBuffer(indices);
        else if (indices instanceof Buffer2) indexBuffer = indices;
      }
      let offset = 0;
      if (range_start !== void 0 && range_start > 0)
        offset = range_start;
      if (indexBuffer) length = indexBuffer.buffer.length - offset;
      if (range_length !== void 0 && range_length > 0 && range_length < length)
        length = range_length;
      const BYTES_PER_ELEMENT = indexBuffer && indexBuffer.data ? indexBuffer.data.constructor.BYTES_PER_ELEMENT : 1;
      offset *= BYTES_PER_ELEMENT;
      for (const attribute in this.attributes) {
        const location2 = this.attributes[attribute];
        if (!attribs_in_use[location2]) {
          gl2.disableVertexAttribArray(this.attributes[attribute]);
        }
      }
      const ext = gl2.extensions.ANGLE_instanced_arrays;
      let batch_length = 0;
      let index = 0;
      for (const uniform in instanced_uniforms) {
        const values = instanced_uniforms[uniform];
        batch_length = values.length;
        const uniformLocation = this.attributes[uniform];
        if (uniformLocation == null) return;
        let element_size = 0;
        let total_size = 0;
        if (values.constructor === Array) {
          const arr = values;
          const first = arr[0];
          element_size = first.constructor === Number ? 1 : first.length;
          total_size = element_size * arr.length;
        } else {
          element_size = this.uniformInfo[uniform].type_length;
          total_size = values.length;
          batch_length = total_size / element_size;
        }
        let data_array = _Shader._instancing_arrays[index];
        if (!data_array || data_array.data.length < total_size)
          data_array = _Shader._instancing_arrays[index] = {
            data: new Float32Array(total_size),
            buffer: gl2.createBuffer()
          };
        data_array.uniform = uniform;
        data_array.element_size = element_size;
        if (values.constructor === Array) {
          const arr = values;
          for (let j = 0; j < arr.length; ++j) data_array.data.set(arr[j], j * element_size);
        } else data_array.data.set(values);
        gl2.bindBuffer(gl2.ARRAY_BUFFER, data_array.buffer);
        gl2.bufferData(gl2.ARRAY_BUFFER, data_array.data, STREAM_DRAW);
        if (element_size == 16) {
          for (let k = 0; k < 4; ++k) {
            gl2.enableVertexAttribArray(uniformLocation + k);
            gl2.vertexAttribPointer(uniformLocation + k, 4, FLOAT, false, 16 * 4, k * 4 * 4);
            if (ext)
              ext.vertexAttribDivisorANGLE(uniformLocation + k, 1);
            else gl2.vertexAttribDivisor(uniformLocation + k, 1);
          }
        } else {
          gl2.enableVertexAttribArray(uniformLocation);
          gl2.vertexAttribPointer(uniformLocation, element_size, FLOAT, false, element_size * 4, 0);
          if (ext)
            ext.vertexAttribDivisorANGLE(uniformLocation, 1);
          else gl2.vertexAttribDivisor(uniformLocation, 1);
        }
        index += 1;
      }
      if (num_intances) batch_length = num_intances;
      if (ext) {
        if (indexBuffer) {
          gl2.bindBuffer(gl2.ELEMENT_ARRAY_BUFFER, indexBuffer.buffer);
          ext.drawElementsInstancedANGLE(
            primitive,
            length,
            indexBuffer.buffer.gl_type,
            offset,
            batch_length
          );
          gl2.bindBuffer(gl2.ELEMENT_ARRAY_BUFFER, null);
        } else ext.drawArraysInstancedANGLE(primitive, offset, length, batch_length);
      } else {
        if (indexBuffer) {
          gl2.bindBuffer(gl2.ELEMENT_ARRAY_BUFFER, indexBuffer.buffer);
          gl2.drawElementsInstanced(
            primitive,
            length,
            indexBuffer.buffer.gl_type,
            offset,
            batch_length
          );
          gl2.bindBuffer(gl2.ELEMENT_ARRAY_BUFFER, null);
        } else gl2.drawArraysInstanced(primitive, offset, length, batch_length);
      }
      for (let i = 0; i < index; ++i) {
        const info = _Shader._instancing_arrays[i];
        const uniformLocation = this.attributes[info.uniform];
        const element_size = info.element_size;
        if (element_size == 16) {
          for (let k = 0; k < 4; ++k) {
            gl2.disableVertexAttribArray(uniformLocation + k);
            if (ext)
              ext.vertexAttribDivisorANGLE(uniformLocation + k, 0);
            else gl2.vertexAttribDivisor(uniformLocation + k, 0);
          }
        } else {
          gl2.enableVertexAttribArray(uniformLocation);
          if (ext)
            ext.vertexAttribDivisorANGLE(uniformLocation, 0);
          else gl2.vertexAttribDivisor(uniformLocation, 0);
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
    static expandImports(code, files) {
      const f = files || _Shader.files;
      const already_imported = {};
      if (!f) throw "Shader.files not initialized, assign files there";
      const replace_import = function(v) {
        const token = v.split('"');
        const id = token[1];
        if (already_imported[id]) return "//already imported: " + id + "\n";
        const file = f[id];
        already_imported[id] = true;
        if (file) return file + "\n";
        return "//import code not found: " + id + "\n";
      };
      return code.replace(/#import\s+"([a-zA-Z0-9_.]+)"\s*\n/g, replace_import);
    }
    static dumpErrorToConsole(err, vscode, fscode) {
      console.error(err);
      let code;
      if (err.indexOf("Fragment") != -1) code = fscode;
      else code = vscode;
      const lines = code.split("\n");
      for (const i in lines) lines[i] = i + "| " + lines[i];
      console.groupCollapsed("Shader code");
      console.log(lines.join("\n"));
      console.groupEnd();
    }
    static convertTo100(code, type) {
      void code;
      void type;
    }
    static convertTo300(code, type) {
      void code;
      void type;
    }
    // helps to check if a variable value is valid to an specific uniform in a shader
    static validateValue(value, uniform_info) {
      if (value === null || value === void 0) return false;
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
          return value.length === 2;
        case INT_VEC3:
        case FLOAT_VEC3:
          return value.length === 3;
        case INT_VEC4:
        case FLOAT_VEC4:
        case FLOAT_MAT2:
          return value.length === 4;
        case FLOAT_MAT3:
          return value.length === 8;
        case FLOAT_MAT4:
          return value.length === 16;
      }
      return true;
    }
    // legacy
    /**
     * Allows to create a simple shader meant to be used to process a texture, instead of having to define the generic Vertex & Fragment Shader code
     * @method Shader.createFX
     * @param {string} code string containg code, like "color = color * 2.0;"
     * @param {string} [uniforms=null] string containg extra uniforms, like "uniform vec3 u_pos;"
     */
    static createFX(code, uniforms, shader) {
      code = _Shader.removeComments(code, true);
      const uniforms_clean = _Shader.removeComments(uniforms, true);
      const macros = {
        FX_CODE: code,
        FX_UNIFORMS: uniforms_clean || ""
      };
      if (!shader) return new _Shader(_Shader.SCREEN_VERTEX_SHADER, _Shader.SCREEN_FRAGMENT_FX, macros);
      shader.updateShader(_Shader.SCREEN_VERTEX_SHADER, _Shader.SCREEN_FRAGMENT_FX, macros);
      return shader;
    }
    /**
     * Given a shader code with some vars inside (like {{varname}}) and an object with the variable values, it will replace them.
     * @method Shader.replaceCodeUsingContext
     * @param {string} code string containg code and vars in {{varname}} format
     * @param {object} context object containing all var values
     */
    static replaceCodeUsingContext(code_template, context) {
      return code_template.replace(/\{\{[a-zA-Z0-9_]*\}\}/g, function(v) {
        v = v.replace(/[{}]/g, "");
        return context[v] || "";
      });
    }
    static removeComments(code, one_line) {
      if (!code) return "";
      const rx = /(\/\*([^*]|[\r\n]|(\*+([^*/]|[\r\n])))*\*+\/)|(\/\/.*)/g;
      code = code.replace(rx, "");
      const lines = code.split("\n");
      const result = [];
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
    toViewport(uniforms) {
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
    static getScreenShader(gl2) {
      const g = gl2 || globalThis.gl;
      let shader = g.shaders[":screen"];
      if (shader) return shader;
      shader = g.shaders[":screen"] = new _Shader(_Shader.SCREEN_VERTEX_SHADER, _Shader.SCREEN_FRAGMENT_SHADER);
      return shader.uniforms({ u_texture: 0 });
    }
    /**
     * Returns a shader ready to render a flat color quad in fullscreen, use with Mesh.getScreenQuad() mesh
     * shader params: vec4 u_color
     * @method Shader.getFlatScreenShader
     */
    static getFlatScreenShader(gl2) {
      const g = gl2 || globalThis.gl;
      let shader = g.shaders[":flat_screen"];
      if (shader) return shader;
      shader = g.shaders[":flat_screen"] = new _Shader(_Shader.SCREEN_VERTEX_SHADER, _Shader.FLAT_FRAGMENT_SHADER);
      return shader.uniforms({ u_color: [1, 1, 1, 1] });
    }
    /**
     * Returns a shader ready to render a colored textured quad in fullscreen, use with Mesh.getScreenQuad() mesh
     * shader params vec4 u_color and sampler2D u_texture
     * @method Shader.getColoredScreenShader
     */
    static getColoredScreenShader(gl2) {
      const g = gl2 || globalThis.gl;
      let shader = g.shaders[":colored_screen"];
      if (shader) return shader;
      shader = g.shaders[":colored_screen"] = new _Shader(
        _Shader.SCREEN_VERTEX_SHADER,
        _Shader.SCREEN_COLORED_FRAGMENT_SHADER
      );
      return shader.uniforms({ u_texture: 0, u_color: vec4.fromValues(1, 1, 1, 1) });
    }
    /**
     * Returns a shader ready to render a quad with transform, use with Mesh.getScreenQuad() mesh
     * shader must have: u_position, u_size, u_viewport, u_transform (mat3)
     * @method Shader.getQuadShader
     */
    static getQuadShader(gl2) {
      const g = gl2 || globalThis.gl;
      const shader = g.shaders[":quad"];
      if (shader) return shader;
      return g.shaders[":quad"] = new _Shader(_Shader.QUAD_VERTEX_SHADER, _Shader.QUAD_FRAGMENT_SHADER);
    }
    /**
     * Returns a shader ready to render part of a texture into the viewport
     * shader must have: u_position, u_size, u_viewport, u_transform, u_texture_area (vec4)
     * @method Shader.getPartialQuadShader
     */
    static getPartialQuadShader(gl2) {
      const g = gl2 || globalThis.gl;
      const shader = g.shaders[":quad2"];
      if (shader) return shader;
      return g.shaders[":quad2"] = new _Shader(_Shader.QUAD_VERTEX_SHADER, _Shader.QUAD2_FRAGMENT_SHADER);
    }
    /**
     * Returns a shader that blends two textures
     * shader must have: u_factor, u_texture, u_texture2
     * @method Shader.getBlendShader
     */
    static getBlendShader(gl2) {
      const g = gl2 || globalThis.gl;
      const shader = g.shaders[":blend"];
      if (shader) return shader;
      return g.shaders[":blend"] = new _Shader(_Shader.SCREEN_VERTEX_SHADER, _Shader.BLEND_FRAGMENT_SHADER);
    }
    /**
     * Returns a shader used to apply gaussian blur to one texture in one axis (you should use it twice to get a gaussian blur)
     * shader params are: vec2 u_offset, float u_intensity
     * @method Shader.getBlurShader
     */
    static getBlurShader(gl2) {
      const g = gl2 || globalThis.gl;
      const existing = g.shaders[":blur"];
      if (existing) return existing;
      const shader = new _Shader(
        _Shader.SCREEN_VERTEX_SHADER,
        "\n			precision highp float;\n			varying vec2 v_coord;\n			uniform sampler2D u_texture;\n			uniform vec2 u_offset;\n			uniform float u_intensity;\n			void main() {\n			   vec4 sum = vec4(0.0);\n			   sum += texture2D(u_texture, v_coord + u_offset * -4.0) * 0.05/0.98;\n			   sum += texture2D(u_texture, v_coord + u_offset * -3.0) * 0.09/0.98;\n			   sum += texture2D(u_texture, v_coord + u_offset * -2.0) * 0.12/0.98;\n			   sum += texture2D(u_texture, v_coord + u_offset * -1.0) * 0.15/0.98;\n			   sum += texture2D(u_texture, v_coord) * 0.16/0.98;\n			   sum += texture2D(u_texture, v_coord + u_offset * 4.0) * 0.05/0.98;\n			   sum += texture2D(u_texture, v_coord + u_offset * 3.0) * 0.09/0.98;\n			   sum += texture2D(u_texture, v_coord + u_offset * 2.0) * 0.12/0.98;\n			   sum += texture2D(u_texture, v_coord + u_offset * 1.0) * 0.15/0.98;\n			   gl_FragColor = u_intensity * sum;\n			}\n			"
      );
      return g.shaders[":blur"] = shader;
    }
    // shader to copy a depth texture into another one
    static getCopyDepthShader(gl2) {
      const g = gl2 || globalThis.gl;
      const existing = g.shaders[":copy_depth"];
      if (existing) return existing;
      const shader = new _Shader(
        _Shader.SCREEN_VERTEX_SHADER,
        "\n			#extension GL_EXT_frag_depth : enable\n			precision highp float;\n			varying vec2 v_coord;\n			uniform sampler2D u_texture;\n			void main() {\n			   gl_FragDepthEXT = texture2D( u_texture, v_coord ).x;\n			   gl_FragColor = vec4(1.0);\n			}\n			"
      );
      return g.shaders[":copy_depth"] = shader;
    }
    static getCubemapShowShader(gl2) {
      const g = gl2 || globalThis.gl;
      const existing = g.shaders[":show_cubemap"];
      if (existing) return existing;
      const shader = new _Shader(
        _Shader.DEFAULT_VERTEX_SHADER,
        "\n			precision highp float;\n			varying vec3 v_normal;\n			uniform samplerCube u_texture;\n			void main() {\n			   gl_FragColor = textureCube( u_texture, v_normal );\n			}\n			"
      );
      shader.uniforms({ u_texture: 0 });
      return g.shaders[":show_cubemap"] = shader;
    }
    // shader to copy a cubemap into another
    static getPolarToCubemapShader(gl2) {
      const g = gl2 || globalThis.gl;
      const existing = g.shaders[":polar_to_cubemap"];
      if (existing) return existing;
      const shader = new _Shader(
        _Shader.SCREEN_VERTEX_SHADER,
        "\n			precision highp float;\n			varying vec2 v_coord;\n			uniform sampler2D u_texture;\n			uniform mat3 u_rotation;\n			void main() {\n				vec2 uv = vec2( v_coord.x, 1.0 - v_coord.y );\n				vec3 dir = normalize( vec3( uv - vec2(0.5), 0.5 ));\n				dir = u_rotation * dir;\n				float u = atan(dir.x,dir.z) / 6.28318531;\n				float v = (asin(dir.y) / 1.57079633) * 0.5 + 0.5;\n				u = mod(u,1.0);\n				v = mod(v,1.0);\n			   gl_FragColor = texture2D( u_texture, vec2(u,v) );\n			}\n			"
      );
      return g.shaders[":polar_to_cubemap"] = shader;
    }
    // shader to copy a cubemap into another
    static getCubemapCopyShader(gl2) {
      const g = gl2 || globalThis.gl;
      const existing = g.shaders[":copy_cubemap"];
      if (existing) return existing;
      const shader = new _Shader(
        _Shader.SCREEN_VERTEX_SHADER,
        "\n			precision highp float;\n			varying vec2 v_coord;\n			uniform samplerCube u_texture;\n			uniform mat3 u_rotation;\n			void main() {\n				vec2 uv = vec2( v_coord.x, 1.0 - v_coord.y );\n				vec3 dir = vec3( uv - vec2(0.5), 0.5 );\n				dir = u_rotation * dir;\n			   gl_FragColor = textureCube( u_texture, dir );\n			}\n			"
      );
      return g.shaders[":copy_cubemap"] = shader;
    }
    // shader to blur a cubemap
    static getCubemapBlurShader(gl2) {
      const g = gl2 || globalThis.gl;
      const existing = g.shaders[":blur_cubemap"];
      if (existing) return existing;
      const shader = new _Shader(
        _Shader.SCREEN_VERTEX_SHADER,
        "\n			#ifndef NUM_SAMPLES\n				#define NUM_SAMPLES 4\n			#endif\n			\n			precision highp float;\n			varying vec2 v_coord;\n			uniform samplerCube u_texture;\n			uniform mat3 u_rotation;\n			uniform vec2 u_offset;\n			uniform float u_intensity;\n			void main() {\n				vec4 sum = vec4(0.0);\n				vec2 uv = vec2( v_coord.x, 1.0 - v_coord.y ) - vec2(0.5);\n				vec3 dir = vec3(0.0);\n				vec4 color = vec4(0.0);\n				for( int x = -2; x <= 2; x++ )\n				{\n					for( int y = -2; y <= 2; y++ )\n					{\n						dir.xy = uv + vec2( u_offset.x * float(x), u_offset.y * float(y)) * 0.5;\n						dir.z = 0.5;\n						dir = u_rotation * dir;\n						color = textureCube( u_texture, dir );\n						color.xyz = color.xyz * color.xyz;/*linearize*/\n						sum += color;\n					}\n				}\n				sum /= 25.0;\n			   gl_FragColor = vec4( sqrt( sum.xyz ), sum.w ) ;\n			}\n			"
      );
      return g.shaders[":blur_cubemap"] = shader;
    }
    /**
     * Returns a shader to apply FXAA antialiasing
     * params are vec2 u_viewportSize, vec2 u_iViewportSize or you can call shader.setup()
     * @method Shader.getFXAAShader
     */
    static getFXAAShader(gl2) {
      const g = gl2 || globalThis.gl;
      const existing = g.shaders[":fxaa"];
      if (existing) return existing;
      const shader = new _Shader(
        _Shader.SCREEN_VERTEX_SHADER,
        "\n			precision highp float;\n			varying vec2 v_coord;\n			uniform sampler2D u_texture;\n			" + _Shader.FXAA_FUNC + "\n			\n			void main() {\n			   gl_FragColor = applyFXAA( u_texture, v_coord * u_viewportSize) ;\n			}\n			"
      );
      const viewport = vec2.fromValues(g.viewport_data[2], g.viewport_data[3]);
      const iviewport = vec2.fromValues(1 / g.viewport_data[2], 1 / g.viewport_data[3]);
      shader.setup = function() {
        viewport[0] = g.viewport_data[2];
        viewport[1] = g.viewport_data[3];
        iviewport[0] = 1 / g.viewport_data[2];
        iviewport[1] = 1 / g.viewport_data[3];
        this.uniforms({ u_viewportSize: viewport, u_iViewportSize: iviewport });
      };
      return g.shaders[":fxaa"] = shader;
    }
    /**
     * Returns a flat shader (useful to render lines)
     * @method Shader.getFlatShader
     */
    static getFlatShader(gl2) {
      const g = gl2 || globalThis.gl;
      const existing = g.shaders[":flat"];
      if (existing) return existing;
      const shader = new _Shader(_Shader.FLAT_VERTEX_SHADER, _Shader.FLAT_FRAGMENT_SHADER);
      shader.uniforms({ u_color: [1, 1, 1, 1] });
      return g.shaders[":flat"] = shader;
    }
  };
  // --- static props ---
  _Shader.use_async = true;
  // https://toji.github.io/shader-perf/
  _Shader._temp_uniform = new Float32Array(16);
  _Shader._instancing_arrays = [];
  /** object with files to #import from, assigned externally */
  _Shader.files = null;
  //**************** SHADERS ***********************************
  _Shader.DEFAULT_VERTEX_SHADER = "\n			precision highp float;\n			attribute vec3 a_vertex;\n			attribute vec3 a_normal;\n			attribute vec2 a_coord;\n			varying vec3 v_position;\n			varying vec3 v_normal;\n			varying vec2 v_coord;\n			uniform mat4 u_model;\n			uniform mat4 u_mvp;\n			void main() {\n				v_position = (u_model * vec4(a_vertex,1.0)).xyz;\n				v_normal = (u_model * vec4(a_normal,0.0)).xyz;\n				v_coord = a_coord;\n				gl_Position = u_mvp * vec4(a_vertex,1.0);\n			}\n			";
  _Shader.SCREEN_VERTEX_SHADER = "\n			precision highp float;\n			attribute vec3 a_vertex;\n			attribute vec2 a_coord;\n			varying vec2 v_coord;\n			void main() { \n				v_coord = a_coord; \n				gl_Position = vec4(a_coord * 2.0 - 1.0, 0.0, 1.0); \n			}\n			";
  _Shader.SCREEN_300_VERTEX_SHADER = "#version 300 es\n			precision highp float;\n			in vec3 a_vertex;\n			in vec2 a_coord;\n			out vec2 v_coord;\n			void main() { \n				v_coord = a_coord; \n				gl_Position = vec4(a_coord * 2.0 - 1.0, 0.0, 1.0); \n			}\n			";
  _Shader.SCREEN_FRAGMENT_SHADER = "\n			precision highp float;\n			uniform sampler2D u_texture;\n			varying vec2 v_coord;\n			void main() {\n				gl_FragColor = texture2D(u_texture, v_coord);\n			}\n			";
  // used in createFX
  _Shader.SCREEN_FRAGMENT_FX = "\n			precision highp float;\n			uniform sampler2D u_texture;\n			varying vec2 v_coord;\n			#ifdef FX_UNIFORMS\n				FX_UNIFORMS\n			#endif\n			void main() {\n				vec2 uv = v_coord;\n				vec4 color = texture2D(u_texture, uv);\n				#ifdef FX_CODE\n					FX_CODE ;\n				#endif\n				gl_FragColor = color;\n			}\n			";
  _Shader.SCREEN_COLORED_FRAGMENT_SHADER = "\n			precision highp float;\n			uniform sampler2D u_texture;\n			uniform vec4 u_color;\n			varying vec2 v_coord;\n			void main() {\n				gl_FragColor = u_color * texture2D(u_texture, v_coord);\n			}\n			";
  _Shader.BLEND_FRAGMENT_SHADER = "\n			precision highp float;\n			uniform sampler2D u_texture;\n			uniform sampler2D u_texture2;\n			uniform float u_factor;\n			varying vec2 v_coord;\n			void main() {\n				gl_FragColor = mix( texture2D(u_texture, v_coord), texture2D(u_texture2, v_coord), u_factor);\n			}\n			";
  // used to paint quads
  _Shader.QUAD_VERTEX_SHADER = "\n			precision highp float;\n			attribute vec3 a_vertex;\n			attribute vec2 a_coord;\n			varying vec2 v_coord;\n			uniform vec2 u_position;\n			uniform vec2 u_size;\n			uniform vec2 u_viewport;\n			uniform mat3 u_transform;\n			void main() { \n				vec3 pos = vec3(u_position + vec2(a_coord.x,1.0 - a_coord.y)  * u_size, 1.0);\n				v_coord = a_coord; \n				pos = u_transform * pos;\n				pos.z = 0.0;\n				//normalize\n				pos.x = (2.0 * pos.x / u_viewport.x) - 1.0;\n				pos.y = -((2.0 * pos.y / u_viewport.y) - 1.0);\n				gl_Position = vec4(pos, 1.0); \n			}\n			";
  _Shader.QUAD_FRAGMENT_SHADER = "\n			precision highp float;\n			uniform sampler2D u_texture;\n			uniform vec4 u_color;\n			varying vec2 v_coord;\n			void main() {\n				gl_FragColor = u_color * texture2D(u_texture, v_coord);\n			}\n			";
  // used to render partially a texture
  _Shader.QUAD2_FRAGMENT_SHADER = "\n			precision highp float;\n			uniform sampler2D u_texture;\n			uniform vec4 u_color;\n			uniform vec4 u_texture_area;\n			varying vec2 v_coord;\n			void main() {\n			    vec2 uv = vec2( mix(u_texture_area.x, u_texture_area.z, v_coord.x), 1.0 - mix(u_texture_area.w, u_texture_area.y, v_coord.y) );\n				gl_FragColor = u_color * texture2D(u_texture, uv);\n			}\n			";
  _Shader.PRIMITIVE2D_VERTEX_SHADER = "\n			precision highp float;\n			attribute vec3 a_vertex;\n			uniform vec2 u_viewport;\n			uniform mat3 u_transform;\n			void main() { \n				vec3 pos = a_vertex;\n				pos = u_transform * pos;\n				pos.z = 0.0;\n				//normalize\n				pos.x = (2.0 * pos.x / u_viewport.x) - 1.0;\n				pos.y = -((2.0 * pos.y / u_viewport.y) - 1.0);\n				gl_Position = vec4(pos, 1.0); \n			}\n			";
  _Shader.FLAT_VERTEX_SHADER = "\n			precision highp float;\n			attribute vec3 a_vertex;\n			uniform mat4 u_mvp;\n			void main() { \n				gl_Position = u_mvp * vec4(a_vertex,1.0); \n			}\n			";
  _Shader.FLAT_FRAGMENT_SHADER = "\n			precision highp float;\n			uniform vec4 u_color;\n			void main() {\n				gl_FragColor = u_color;\n			}\n			";
  _Shader.SCREEN_FLAT_FRAGMENT_SHADER = _Shader.FLAT_FRAGMENT_SHADER;
  // shader to do FXAA (antialiasing)
  _Shader.FXAA_FUNC = "\n	uniform vec2 u_viewportSize;\n	uniform vec2 u_iViewportSize;\n	#define FXAA_REDUCE_MIN   (1.0/ 128.0)\n	#define FXAA_REDUCE_MUL   (1.0 / 8.0)\n	#define FXAA_SPAN_MAX     8.0\n	\n	/* from mitsuhiko/webgl-meincraft based on the code on geeks3d.com */\n	/* fragCoord MUST BE IN PIXELS */\n	vec4 applyFXAA(sampler2D tex, vec2 fragCoord)\n	{\n		vec4 color = vec4(0.0);\n		/*vec2 u_iViewportSize = vec2(1.0 / u_viewportSize.x, 1.0 / u_viewportSize.y);*/\n		vec3 rgbNW = texture2D(tex, (fragCoord + vec2(-1.0, -1.0)) * u_iViewportSize).xyz;\n		vec3 rgbNE = texture2D(tex, (fragCoord + vec2(1.0, -1.0)) * u_iViewportSize).xyz;\n		vec3 rgbSW = texture2D(tex, (fragCoord + vec2(-1.0, 1.0)) * u_iViewportSize).xyz;\n		vec3 rgbSE = texture2D(tex, (fragCoord + vec2(1.0, 1.0)) * u_iViewportSize).xyz;\n		vec3 rgbM  = texture2D(tex, fragCoord  * u_iViewportSize).xyz;\n		vec3 luma = vec3(0.299, 0.587, 0.114);\n		float lumaNW = dot(rgbNW, luma);\n		float lumaNE = dot(rgbNE, luma);\n		float lumaSW = dot(rgbSW, luma);\n		float lumaSE = dot(rgbSE, luma);\n		float lumaM  = dot(rgbM,  luma);\n		float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));\n		float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));\n		\n		vec2 dir;\n		dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));\n		dir.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));\n		\n		float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * (0.25 * FXAA_REDUCE_MUL), FXAA_REDUCE_MIN);\n		\n		float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);\n		dir = min(vec2(FXAA_SPAN_MAX, FXAA_SPAN_MAX), max(vec2(-FXAA_SPAN_MAX, -FXAA_SPAN_MAX), dir * rcpDirMin)) * u_iViewportSize;\n		\n		vec3 rgbA = 0.5 * (texture2D(tex, fragCoord * u_iViewportSize + dir * (1.0 / 3.0 - 0.5)).xyz + \n			texture2D(tex, fragCoord * u_iViewportSize + dir * (2.0 / 3.0 - 0.5)).xyz);\n		vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(tex, fragCoord * u_iViewportSize + dir * -0.5).xyz + \n			texture2D(tex, fragCoord * u_iViewportSize + dir * 0.5).xyz);\n		\n		//return vec4(rgbA,1.0);\n		float lumaB = dot(rgbB, luma);\n		if ((lumaB < lumaMin) || (lumaB > lumaMax))\n			color = vec4(rgbA, 1.0);\n		else\n			color = vec4(rgbB, 1.0);\n		return color;\n	}\n";
  var Shader = _Shader;

  // src/texture.ts
  var blit_viewport = new Float32Array(4);
  var renderQuad_identity = mat3.create();
  var renderQuad_pos = vec2.create();
  var renderQuad_size = vec2.create();
  var renderQuad_white = vec4.fromValues(1, 1, 1, 1);
  var _Texture = class _Texture {
    constructor(width, height, options, gl2) {
      var _a;
      options = options || {};
      gl2 = gl2 || globalThis.gl;
      this.gl = gl2;
      this._context_id = gl2.context_id;
      width = parseInt(width);
      height = parseInt(height);
      if ((_a = globalThis.GL) == null ? void 0 : _a.debug)
        console.log("GL.Texture created: ", width, height);
      this.handler = gl2.createTexture();
      this.width = width;
      this.height = height;
      if (options.depth)
        this.depth = options.depth;
      this.texture_type = options.texture_type || gl2.TEXTURE_2D;
      this.format = options.format || _Texture.DEFAULT_FORMAT;
      this.internalFormat = options.internalFormat || 0;
      this.type = options.type || _Texture.DEFAULT_TYPE;
      this.magFilter = options.magFilter || options.filter || _Texture.DEFAULT_MAG_FILTER;
      this.minFilter = options.minFilter || options.filter || _Texture.DEFAULT_MIN_FILTER;
      this.wrapS = options.wrap || options.wrapS || _Texture.DEFAULT_WRAP_S;
      this.wrapT = options.wrap || options.wrapT || _Texture.DEFAULT_WRAP_T;
      this.data = null;
      if (!_Texture.MAX_TEXTURE_IMAGE_UNITS)
        _Texture.MAX_TEXTURE_IMAGE_UNITS = gl2.getParameter(gl2.MAX_TEXTURE_IMAGE_UNITS);
      this.has_mipmaps = false;
      if (this.format == gl2.DEPTH_COMPONENT && gl2.webgl_version == 1 && !gl2.extensions["WEBGL_depth_texture"])
        throw "Depth Texture not supported";
      if (this.type == gl2.FLOAT && !gl2.extensions["OES_texture_float"] && gl2.webgl_version == 1)
        throw "Float Texture not supported";
      if (this.type == HALF_FLOAT_OES) {
        if (!gl2.extensions["OES_texture_half_float"] && gl2.webgl_version == 1)
          throw "Half Float Texture extension not supported.";
        else if (gl2.webgl_version > 1) {
          console.warn("using HALF_FLOAT_OES in WebGL2 is deprecated, suing HALF_FLOAT instead");
          this.type = this.format == gl2.RGB ? gl2.RGB16F : gl2.RGBA16F;
        }
      }
      if ((!isPowerOfTwo(this.width) || !isPowerOfTwo(this.height)) && //non power of two
      (this.minFilter != gl2.NEAREST && this.minFilter != gl2.LINEAR || //uses mipmaps
      this.wrapS != gl2.CLAMP_TO_EDGE || this.wrapT != gl2.CLAMP_TO_EDGE)) {
        if (!options.ignore_pot) throw "Cannot use texture-wrap or mipmaps in Non-Power-of-Two textures";
        else {
          this.minFilter = this.magFilter = gl2.LINEAR;
          this.wrapS = this.wrapT = gl2.CLAMP_TO_EDGE;
        }
      }
      if (!width || !height) return;
      if (!this.internalFormat) this.computeInternalFormat();
      const type = this.type;
      function toTypedArray(data) {
        if (data.constructor !== Array) return data;
        if (type == FLOAT) return new Float32Array(data);
        if (type == HALF_FLOAT_OES) return new Uint16Array(data);
        return new Uint8Array(data);
      }
      gl2.activeTexture(gl2.TEXTURE0 + _Texture.MAX_TEXTURE_IMAGE_UNITS - 1);
      gl2.bindTexture(this.texture_type, this.handler);
      gl2.texParameteri(this.texture_type, gl2.TEXTURE_MAG_FILTER, this.magFilter);
      gl2.texParameteri(this.texture_type, gl2.TEXTURE_MIN_FILTER, this.minFilter);
      gl2.texParameteri(this.texture_type, gl2.TEXTURE_WRAP_S, this.wrapS);
      gl2.texParameteri(this.texture_type, gl2.TEXTURE_WRAP_T, this.wrapT);
      if (options.anisotropic && gl2.extensions["EXT_texture_filter_anisotropic"])
        gl2.texParameterf(
          TEXTURE_2D,
          gl2.extensions["EXT_texture_filter_anisotropic"].TEXTURE_MAX_ANISOTROPY_EXT,
          options.anisotropic
        );
      let pixel_data = options.pixel_data;
      if (pixel_data && !pixel_data.buffer) {
        if (this.texture_type == TEXTURE_CUBE_MAP) {
          const pd = pixel_data;
          if (pd[0].constructor === Number) {
            const single = toTypedArray(pixel_data);
            pixel_data = [single, single, single, single, single, single];
          } else {
            const arr = pixel_data;
            for (let i = 0; i < arr.length; ++i) arr[i] = toTypedArray(arr[i]);
          }
        } else pixel_data = toTypedArray(pixel_data);
        this.data = pixel_data;
      }
      _Texture.setUploadOptions(options);
      if (this.texture_type == TEXTURE_2D) {
        gl2.texImage2D(
          TEXTURE_2D,
          0,
          this.internalFormat,
          width,
          height,
          0,
          this.format,
          this.type,
          pixel_data || null
        );
        if (isPowerOfTwo(width) && isPowerOfTwo(height) && options.minFilter && options.minFilter != gl2.NEAREST && options.minFilter != gl2.LINEAR) {
          gl2.generateMipmap(this.texture_type);
          this.has_mipmaps = true;
        }
      } else if (this.texture_type == TEXTURE_CUBE_MAP) {
        const facesize = width * width * (this.format == RGBA ? 4 : 3);
        for (let i = 0; i < 6; ++i) {
          let cubemap_data = pixel_data;
          if (cubemap_data) {
            if (cubemap_data.constructor === Array)
              cubemap_data = cubemap_data[i];
            else cubemap_data.subarray(facesize * i, facesize * (i + 1));
          }
          gl2.texImage2D(
            gl2.TEXTURE_CUBE_MAP_POSITIVE_X + i,
            0,
            this.internalFormat,
            this.width,
            this.height,
            0,
            this.format,
            this.type,
            cubemap_data || null
          );
        }
      } else if (this.texture_type == TEXTURE_3D) {
        if (this.gl.webgl_version == 1)
          throw "TEXTURE_3D not supported in WebGL 1. Enable WebGL 2 in the context by passing webgl2:true to the context";
        if (!options.depth) throw "3d texture depth must be set in the options.depth";
        gl2.pixelStorei(gl2.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
        gl2.pixelStorei(gl2.UNPACK_FLIP_Y_WEBGL, 0);
        gl2.texImage3D(
          TEXTURE_3D,
          0,
          this.internalFormat,
          width,
          height,
          options.depth,
          0,
          this.format,
          this.type,
          pixel_data || null
        );
      }
      gl2.bindTexture(this.texture_type, null);
      gl2.activeTexture(gl2.TEXTURE0);
    }
    //because usually you dont want to specify the internalFormat, this tries to guess it from its format
    //check https://webgl2fundamentals.org/webgl/lessons/webgl-data-textures.html for more info
    computeInternalFormat() {
      this.internalFormat = this.format;
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
        }
      } else if (this.format == gl.RGB) {
        if (gl.webgl_version == 2) {
          if (this.type == FLOAT) this.internalFormat = RGB32F;
          else if (this.type == HALF_FLOAT) {
            throw "GL.RGB HALF_FLOAT is not supported, use RGBA instead";
            this.internalFormat = RGB;
          }
        }
      }
    }
    /**
    * Free the texture memory from the GPU, sets the texture handler to null
    * @method delete
    */
    delete() {
      gl.deleteTexture(this.handler);
      this.handler = null;
    }
    getProperties() {
      return {
        width: this.width,
        height: this.height,
        type: this.type,
        format: this.format,
        texture_type: this.texture_type,
        magFilter: this.magFilter,
        minFilter: this.minFilter,
        wrapS: this.wrapS,
        wrapT: this.wrapT
      };
    }
    hasSameProperties(t) {
      if (!t) return false;
      return t.width == this.width && t.height == this.height && t.type == this.type && t.format == this.format && t.texture_type == this.texture_type;
    }
    hasSameSize(t) {
      if (!t) return false;
      return t.width == this.width && t.height == this.height;
    }
    //textures cannot be stored in JSON
    toJSON() {
      return "";
    }
    /**
    * Returns if depth texture is supported by the GPU
    * @method isDepthSupported
    * @return {Boolean} true if supported
    */
    static isDepthSupported() {
      return gl.extensions["WEBGL_depth_texture"] != null;
    }
    /**
    * Binds the texture to one texture unit
    * @method bind
    * @param {number} unit texture unit
    * @return {number} returns the texture unit
    */
    bind(unit) {
      if (unit == void 0) unit = 0;
      const gl2 = this.gl;
      gl2.activeTexture(gl2.TEXTURE0 + unit);
      gl2.bindTexture(this.texture_type, this.handler);
      return unit;
    }
    /**
    * Unbinds the texture
    * @method unbind
    * @param {number} unit texture unit
    * @return {number} returns the texture unit
    */
    unbind(unit) {
      if (unit === void 0) unit = 0;
      const gl2 = this.gl;
      gl2.activeTexture(gl2.TEXTURE0 + unit);
      gl2.bindTexture(this.texture_type, null);
    }
    setParameter(param, value) {
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
    static setUploadOptions(options, gl2) {
      gl2 = gl2 || globalThis.gl;
      if (!_Texture.disable_deprecated) {
        if (options) {
          gl2.pixelStorei(gl2.UNPACK_PREMULTIPLY_ALPHA_WEBGL, options.premultiply_alpha ? 1 : 0);
          gl2.pixelStorei(gl2.UNPACK_FLIP_Y_WEBGL, options.no_flip ? 0 : 1);
        } else {
          gl2.pixelStorei(gl2.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
          gl2.pixelStorei(gl2.UNPACK_FLIP_Y_WEBGL, 1);
        }
      }
      gl2.pixelStorei(gl2.UNPACK_ALIGNMENT, 1);
    }
    //flips image data in Y in place
    static flipYData(data, width, height, numchannels) {
      const Ctor = data.constructor;
      const temp = new Ctor(width * numchannels);
      let pos = 0;
      let lastpos = width * (height - 1) * numchannels;
      const l = Math.floor(height * 0.5);
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
    uploadImage(image, options) {
      this.bind();
      const gl2 = this.gl;
      if (!image) throw "uploadImage parameter must be Image";
      _Texture.setUploadOptions(options, gl2);
      try {
        if (options && options.subimage) {
          if (gl2.webgl_version == 1) gl2.texSubImage2D(gl2.TEXTURE_2D, 0, 0, 0, this.format, this.type, image);
          else
            gl2.texSubImage2D(
              gl2.TEXTURE_2D,
              0,
              0,
              0,
              image.videoWidth || image.width,
              image.videoHeight || image.height,
              this.format,
              this.type,
              image
            );
        } else {
          const w = image.videoWidth || image.width;
          const h = image.videoHeight || image.height;
          if ((w != this.width || h != this.height) && this.width != 1 && this.height != 1)
            console.warn("image uploaded has a different size than texture, resizing it.");
          gl2.texImage2D(gl2.TEXTURE_2D, 0, this.format, this.format, this.type, image);
          this.width = w;
          this.height = h;
        }
        this.data = image;
      } catch (e) {
        console.error(e);
        if (location.protocol == "file:") {
          throw 'image not loaded for security reasons (serve this page over "http://" instead)';
        } else {
          throw "image not loaded for security reasons (image must originate from the same domain as this page or use Cross-Origin Resource Sharing)";
        }
      }
      if (this.minFilter && this.minFilter != gl2.NEAREST && this.minFilter != gl2.LINEAR) {
        gl2.generateMipmap(this.texture_type);
        this.has_mipmaps = true;
      }
      gl2.bindTexture(this.texture_type, null);
    }
    /**
    * Uploads data to the GPU (data must have the appropiate size)
    * @method uploadData
    * @param {ArrayBuffer} data
    * @param {Object} options [optional] upload options (premultiply_alpha, no_flip, cubemap_face, mipmap_level)
    */
    uploadData(data, options, skip_mipmaps) {
      options = options || {};
      if (!data) throw "no data passed";
      const gl2 = this.gl;
      this.bind();
      _Texture.setUploadOptions(options, gl2);
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
        if (gl2.webgl_version == 1) {
          if (data.buffer && data.buffer.constructor == ArrayBuffer)
            gl2.texImage2D(this.texture_type, mipmap_level, internal_format, width, height, 0, this.format, this.type, data);
          else
            gl2.texImage2D(
              this.texture_type,
              mipmap_level,
              internal_format,
              this.format,
              this.type,
              data
            );
        } else if (gl2.webgl_version == 2) {
          if (data.buffer && data.buffer.constructor == ArrayBuffer)
            gl2.texImage2D(this.texture_type, mipmap_level, internal_format, width, height, 0, this.format, this.type, data);
          else
            gl2.texImage2D(this.texture_type, mipmap_level, internal_format, width, height, 0, this.format, this.type, data);
        }
      } else if (this.texture_type == TEXTURE_3D) {
        gl2.pixelStorei(gl2.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
        gl2.pixelStorei(gl2.UNPACK_FLIP_Y_WEBGL, 0);
        gl2.texImage3D(
          this.texture_type,
          mipmap_level,
          internal_format,
          width,
          height,
          this.depth >> mipmap_level,
          0,
          this.format,
          this.type,
          data
        );
      } else if (this.texture_type == TEXTURE_CUBE_MAP)
        gl2.texImage2D(
          gl2.TEXTURE_CUBE_MAP_POSITIVE_X + (options.cubemap_face || 0),
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
      this.data = data;
      if (!skip_mipmaps && this.minFilter && this.minFilter != gl2.NEAREST && this.minFilter != gl2.LINEAR) {
        gl2.generateMipmap(this.texture_type);
        this.has_mipmaps = true;
      }
      gl2.bindTexture(this.texture_type, null);
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
    drawTo(callback, params) {
      const gl2 = this.gl;
      const v = gl2.getViewport();
      const now = getTime();
      const old_fbo = gl2.getParameter(gl2.FRAMEBUFFER_BINDING);
      const framebuffer = gl2._framebuffer = gl2._framebuffer || gl2.createFramebuffer();
      gl2.bindFramebuffer(gl2.FRAMEBUFFER, framebuffer);
      let renderbuffer = null;
      let key = "";
      if (_Texture.use_renderbuffer_pool) {
        if (!gl2._renderbuffers_pool) gl2._renderbuffers_pool = {};
        const pool = gl2._renderbuffers_pool;
        key = this.width + ":" + this.height;
        if (pool[key]) {
          renderbuffer = pool[key];
          renderbuffer.time = now;
          gl2.bindRenderbuffer(gl2.RENDERBUFFER, renderbuffer);
        } else {
          pool[key] = renderbuffer = gl2.createRenderbuffer();
          renderbuffer.time = now;
          renderbuffer.width = this.width;
          renderbuffer.height = this.height;
          gl2.bindRenderbuffer(gl2.RENDERBUFFER, renderbuffer);
          setTimeout(inner_check_destroy.bind(renderbuffer), 1e3 * 60);
        }
      } else {
        renderbuffer = gl2._renderbuffer = gl2._renderbuffer || gl2.createRenderbuffer();
        renderbuffer.width = this.width;
        renderbuffer.height = this.height;
        gl2.bindRenderbuffer(gl2.RENDERBUFFER, renderbuffer);
      }
      if (this.format === gl2.DEPTH_COMPONENT)
        gl2.renderbufferStorage(gl2.RENDERBUFFER, gl2.RGBA4, this.width, this.height);
      else gl2.renderbufferStorage(gl2.RENDERBUFFER, gl2.DEPTH_COMPONENT16, this.width, this.height);
      function inner_check_destroy() {
        const pool = gl2._renderbuffers_pool;
        if (getTime() - this.time >= 1e3 * 60) {
          gl2.deleteRenderbuffer(pool[key]);
          delete pool[key];
        } else setTimeout(inner_check_destroy.bind(this), 1e3 * 60);
      }
      gl2.viewport(0, 0, this.width, this.height);
      gl2._current_texture_drawto = this;
      gl2._current_fbo_color = framebuffer;
      gl2._current_fbo_depth = renderbuffer;
      if (this.texture_type == gl2.TEXTURE_2D) {
        if (this.format !== gl2.DEPTH_COMPONENT) {
          gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.TEXTURE_2D, this.handler, 0);
          gl2.framebufferRenderbuffer(gl2.FRAMEBUFFER, gl2.DEPTH_ATTACHMENT, gl2.RENDERBUFFER, renderbuffer);
        } else {
          gl2.framebufferRenderbuffer(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.RENDERBUFFER, renderbuffer);
          gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.DEPTH_ATTACHMENT, gl2.TEXTURE_2D, this.handler, 0);
        }
        callback(this, params);
      } else if (this.texture_type == gl2.TEXTURE_CUBE_MAP) {
        if (this.format !== gl2.DEPTH_COMPONENT)
          gl2.framebufferRenderbuffer(gl2.FRAMEBUFFER, gl2.DEPTH_ATTACHMENT, gl2.RENDERBUFFER, renderbuffer);
        else gl2.framebufferRenderbuffer(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.RENDERBUFFER, renderbuffer);
        for (let i = 0; i < 6; i++) {
          if (this.format !== gl2.DEPTH_COMPONENT)
            gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.TEXTURE_CUBE_MAP_POSITIVE_X + i, this.handler, 0);
          else
            gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.DEPTH_ATTACHMENT, gl2.TEXTURE_CUBE_MAP_POSITIVE_X + i, this.handler, 0);
          callback(this, i, params);
        }
      }
      this.data = null;
      gl2._current_texture_drawto = null;
      gl2._current_fbo_color = null;
      gl2._current_fbo_depth = null;
      gl2.bindFramebuffer(gl2.FRAMEBUFFER, old_fbo);
      gl2.bindRenderbuffer(gl2.RENDERBUFFER, null);
      gl2.viewport(v[0], v[1], v[2], v[3]);
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
    copyTo(target_texture, shader, uniforms) {
      const gl2 = this.gl;
      if (!target_texture) throw "target_texture required";
      const previous_fbo = gl2.getParameter(gl2.FRAMEBUFFER_BINDING);
      const viewport = gl2.getViewport();
      if (!shader) shader = this.texture_type == gl2.TEXTURE_2D ? Shader.getScreenShader() : Shader.getCubemapCopyShader();
      gl2.disable(gl2.BLEND);
      gl2.disable(gl2.DEPTH_TEST);
      if (shader && uniforms) shader.uniforms(uniforms);
      let fbo = gl2.__copy_fbo;
      if (!fbo) {
        fbo = gl2.createFramebuffer();
        gl2.__copy_fbo = fbo;
      }
      gl2.bindFramebuffer(gl2.FRAMEBUFFER, fbo);
      gl2.viewport(0, 0, target_texture.width, target_texture.height);
      if (this.texture_type == gl2.TEXTURE_2D) {
        if (this.format !== gl2.DEPTH_COMPONENT && this.format !== gl2.DEPTH_STENCIL) {
          {
            gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.TEXTURE_2D, target_texture.handler, 0);
            this.toViewport(shader);
          }
        } else {
          const color_renderbuffer = gl2._color_renderbuffer = gl2._color_renderbuffer || gl2.createRenderbuffer();
          const w = color_renderbuffer.width = target_texture.width;
          const h = color_renderbuffer.height = target_texture.height;
          gl2.bindRenderbuffer(gl2.RENDERBUFFER, color_renderbuffer);
          gl2.renderbufferStorage(gl2.RENDERBUFFER, gl2.RGBA4, w, h);
          gl2.framebufferRenderbuffer(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.RENDERBUFFER, color_renderbuffer);
          const attachment_point = target_texture.format == gl2.DEPTH_STENCIL ? gl2.DEPTH_STENCIL_ATTACHMENT : gl2.DEPTH_ATTACHMENT;
          gl2.framebufferTexture2D(gl2.FRAMEBUFFER, attachment_point, gl2.TEXTURE_2D, target_texture.handler, 0);
          const complete = gl2.checkFramebufferStatus(gl2.FRAMEBUFFER);
          if (complete !== gl2.FRAMEBUFFER_COMPLETE) throw "FBO not complete: " + complete;
          gl2.enable(gl2.DEPTH_TEST);
          gl2.depthFunc(gl2.ALWAYS);
          gl2.colorMask(false, false, false, false);
          shader = Shader.getCopyDepthShader();
          this.toViewport(shader);
          gl2.colorMask(true, true, true, true);
          gl2.disable(gl2.DEPTH_TEST);
          gl2.depthFunc(gl2.LEQUAL);
          gl2.framebufferRenderbuffer(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.RENDERBUFFER, null);
          gl2.framebufferTexture2D(gl2.FRAMEBUFFER, attachment_point, gl2.TEXTURE_2D, null, 0);
        }
      } else if (this.texture_type == gl2.TEXTURE_CUBE_MAP) {
        shader.uniforms({ u_texture: 0 });
        const rot_matrix = temp_mat3;
        for (let i = 0; i < 6; i++) {
          gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.TEXTURE_CUBE_MAP_POSITIVE_X + i, target_texture.handler, 0);
          const face_info = _Texture.cubemap_camera_parameters[i];
          mat3.identity(rot_matrix);
          rot_matrix.set(face_info.right, 0);
          rot_matrix.set(face_info.up, 3);
          rot_matrix.set(face_info.dir, 6);
          this.toViewport(shader, { u_rotation: rot_matrix });
        }
      }
      gl2.setViewport(viewport);
      gl2.bindFramebuffer(gl2.FRAMEBUFFER, previous_fbo);
      if (target_texture.minFilter && target_texture.minFilter != gl2.NEAREST && target_texture.minFilter != gl2.LINEAR) {
        target_texture.bind();
        gl2.generateMipmap(target_texture.texture_type);
        target_texture.has_mipmaps = true;
      }
      target_texture.data = null;
      gl2.bindTexture(target_texture.texture_type, null);
      return this;
    }
    /**
    * Similar to CopyTo, but more specific, only for color texture_2D. It doesnt change the blend flag
    * @method blit
    * @param {GL.Texture} target_texture
    * @param {GL.Shader} [shader=null] optional shader to apply while copying
    * @param {Object} [uniforms=null] optional uniforms for the shader
    */
    blit(target_texture, shader, uniforms) {
      const gl2 = this.gl;
      const viewport = blit_viewport;
      if (this.texture_type != gl2.TEXTURE_2D || this.format === gl2.DEPTH_COMPONENT || this.format === gl2.DEPTH_STENCIL)
        throw "blit only support TEXTURE_2D of RGB or RGBA. use copyTo instead";
      const previous_fbo = gl2.getParameter(gl2.FRAMEBUFFER_BINDING);
      viewport.set(gl2.viewport_data);
      shader = shader || Shader.getScreenShader();
      if (shader && uniforms) shader.uniforms(uniforms);
      let fbo = gl2.__copy_fbo;
      if (!fbo) {
        fbo = gl2.createFramebuffer();
        gl2.__copy_fbo = fbo;
      }
      gl2.bindFramebuffer(gl2.FRAMEBUFFER, fbo);
      gl2.viewport(0, 0, target_texture.width, target_texture.height);
      gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.TEXTURE_2D, target_texture.handler, 0);
      this.bind(0);
      shader.draw(Mesh.getScreenQuad(), gl2.TRIANGLES);
      gl2.setViewport(viewport);
      gl2.bindFramebuffer(gl2.FRAMEBUFFER, previous_fbo);
      target_texture.data = null;
      gl2.bindTexture(target_texture.texture_type, null);
      return this;
    }
    /**
    * Render texture in a quad to full viewport size
    * @method toViewport
    * @param {Shader} shader to apply, otherwise a default textured shader is applied [optional]
    * @param {Object} uniforms for the shader if needed [optional]
    */
    toViewport(shader, uniforms) {
      shader = shader || Shader.getScreenShader();
      const mesh = Mesh.getScreenQuad();
      this.bind(0);
      if (uniforms) shader.uniforms(uniforms);
      shader.draw(mesh, gl.TRIANGLES);
    }
    /**
    * Fills the texture with a constant color (uses gl.clear) or shader
    * @method fill
    * @param {vec4|GL.Shader} color rgba or shader
    * @param {boolean} skip_mipmaps if true the mipmaps wont be updated
    */
    fill(color_or_shader, skip_mipmaps) {
      if (color_or_shader.constructor === Shader) {
        const shader = color_or_shader;
        this.drawTo(function() {
          shader.toViewport();
        });
      } else {
        const color = color_or_shader;
        const old_color = gl.getParameter(gl.COLOR_CLEAR_VALUE);
        gl.clearColor(color[0], color[1], color[2], color[3]);
        this.drawTo(function() {
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
    renderQuad(x, y, w, h, shader, uniforms) {
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
        u_transform: renderQuad_identity
      });
      if (uniforms) shader.uniforms(uniforms);
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
    applyBlur(offsetx, offsety, intensity, output_texture, temp_texture) {
      const gl2 = this.gl;
      if (offsetx === void 0) offsetx = 1;
      if (offsety === void 0) offsety = 1;
      gl2.disable(gl2.DEPTH_TEST);
      gl2.disable(gl2.BLEND);
      output_texture = output_texture || this;
      const is_temp = !temp_texture;
      if (temp_texture === output_texture) throw "cannot use applyBlur in a texture using as temporary itself";
      if (output_texture && this.texture_type !== output_texture.texture_type)
        throw "cannot use applyBlur with textures of different texture_type";
      const current_fbo = gl2.getParameter(gl2.FRAMEBUFFER_BINDING);
      const viewport = gl2.getViewport();
      let fbo = gl2.__copy_fbo;
      if (!fbo) {
        fbo = gl2.createFramebuffer();
        gl2.__copy_fbo = fbo;
      }
      gl2.bindFramebuffer(gl2.FRAMEBUFFER, fbo);
      gl2.viewport(0, 0, this.width, this.height);
      if (this.texture_type === gl2.TEXTURE_2D) {
        const shader = Shader.getBlurShader();
        if (!temp_texture) temp_texture = _Texture.getTemporary(this.width, this.height, this);
        gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.TEXTURE_2D, temp_texture.handler, 0);
        this.toViewport(shader, { u_texture: 0, u_intensity: intensity, u_offset: [0, offsety / this.height] });
        gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.TEXTURE_2D, output_texture.handler, 0);
        gl2.viewport(0, 0, output_texture.width, output_texture.height);
        temp_texture.toViewport(shader, { u_intensity: intensity, u_offset: [offsetx / temp_texture.width, 0] });
        if (is_temp) _Texture.releaseTemporary(temp_texture);
      } else if (this.texture_type === gl2.TEXTURE_CUBE_MAP) {
        const shader = Shader.getCubemapBlurShader();
        shader.uniforms({ u_texture: 0, u_intensity: intensity, u_offset: [offsetx / this.width, offsety / this.height] });
        this.bind(0);
        const mesh = Mesh.getScreenQuad();
        mesh.bindBuffers(shader);
        shader.bind();
        let destination = null;
        if (!temp_texture && output_texture == this)
          destination = temp_texture = _Texture.getTemporary(output_texture.width, output_texture.height, output_texture);
        else destination = output_texture;
        const rot_matrix = temp_mat3;
        for (let i = 0; i < 6; ++i) {
          gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.TEXTURE_CUBE_MAP_POSITIVE_X + i, destination.handler, 0);
          const face_info = _Texture.cubemap_camera_parameters[i];
          mat3.identity(rot_matrix);
          rot_matrix.set(face_info.right, 0);
          rot_matrix.set(face_info.up, 3);
          rot_matrix.set(face_info.dir, 6);
          shader._setUniform("u_rotation", rot_matrix);
          gl2.drawArrays(gl2.TRIANGLES, 0, 6);
        }
        mesh.unbindBuffers(shader);
        if (temp_texture)
          temp_texture.copyTo(output_texture);
        if (temp_texture && is_temp)
          _Texture.releaseTemporary(temp_texture);
      }
      gl2.setViewport(viewport);
      gl2.bindFramebuffer(gl2.FRAMEBUFFER, current_fbo);
      output_texture.data = null;
      if (output_texture.minFilter && output_texture.minFilter != gl2.NEAREST && output_texture.minFilter != gl2.LINEAR) {
        output_texture.bind();
        gl2.generateMipmap(output_texture.texture_type);
        output_texture.has_mipmaps = true;
      }
      gl2.bindTexture(output_texture.texture_type, null);
    }
    /**
    * Loads and uploads a texture from a url
    * @method Texture.fromURL
    * @param {String} url
    * @param {Object} options
    * @param {Function} on_complete
    * @return {Texture} the texture
    */
    static fromURL(url, options, on_complete, gl2) {
      gl2 = gl2 || globalThis.gl;
      options = options || {};
      options = Object.create(options);
      let texture = options.texture || new _Texture(1, 1, options, gl2);
      if (url.length < 64) texture.url = url;
      texture.bind();
      const default_color = options.temp_color || _Texture.loading_color;
      gl2.pixelStorei(gl2.UNPACK_ALIGNMENT, 4);
      const temp_color = options.type == gl2.FLOAT ? new Float32Array(default_color) : new Uint8Array(default_color);
      gl2.texImage2D(gl2.TEXTURE_2D, 0, texture.format, texture.width, texture.height, 0, texture.format, texture.type, temp_color);
      gl2.bindTexture(texture.texture_type, null);
      texture.ready = false;
      let ext = null;
      if (options.extension)
        ext = options.extension;
      if (!ext && url.length < 512) {
        let base = url;
        let pos = url.indexOf("?");
        if (pos != -1) base = url.substr(0, pos);
        pos = base.lastIndexOf(".");
        if (pos != -1) ext = base.substr(pos + 1).toLowerCase();
      }
      if (ext == "dds") {
        const s3tc_ext = gl2.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc") || gl2.getExtension("WEBGL_compressed_texture_s3tc");
        const new_texture = new _Texture(0, 0, options, gl2);
        if (DDS)
          DDS.loadDDSTextureEx(gl2, s3tc_ext, url, new_texture.handler, true, function(t) {
            texture.texture_type = t.texture_type;
            texture.handler = t;
            delete texture.ready;
            if (on_complete) on_complete(texture, url);
          });
      } else if (ext == "tga") {
        HttpRequest(
          url,
          null,
          function(data) {
            const img_data = _Texture.parseTGA(data);
            if (!img_data) return;
            options.texture = texture;
            if (img_data.flipY) options.no_flip = true;
            if (img_data.format == "RGB") texture.format = gl2.RGB;
            texture = _Texture.fromMemory(img_data.width, img_data.height, img_data.pixels, options);
            delete texture.ready;
            if (on_complete) on_complete(texture, url);
          },
          null,
          { binary: true }
        );
      } else {
        const image = new Image();
        image.src = url;
        image.crossOrigin = _Texture.CROSS_ORIGIN_CREDENTIALS;
        image.onload = function() {
          options.texture = texture;
          _Texture.fromImage(image, options);
          delete texture.ready;
          if (on_complete) on_complete(texture, url);
        };
        image.onerror = function() {
          if (on_complete) on_complete(null);
        };
      }
      return texture;
    }
    static parseTGA(data) {
      if (!data || data.constructor !== ArrayBuffer) throw "TGA: data must be ArrayBuffer";
      const bytes = new Uint8Array(data);
      const TGAheader = new Uint8Array([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      const TGAcompare = bytes.subarray(0, 12);
      for (let i = 0; i < TGAcompare.length; i++)
        if (TGAheader[i] != TGAcompare[i]) {
          console.error("TGA header is not valid");
          return null;
        }
      const header = bytes.subarray(12, 18);
      const width = header[1] * 256 + header[0];
      const height = header[3] * 256 + header[2];
      const bpp = header[4];
      const bytesPerPixel = bpp / 8;
      const imageSize = width * height * bytesPerPixel;
      const pixels = new Uint8Array(bytes.subarray(18, 18 + imageSize));
      const flipY = (header[5] & 1 << 5) == 0;
      for (let i = 0; i < imageSize; i += bytesPerPixel) {
        const temp = pixels[i];
        pixels[i] = pixels[i + 2];
        pixels[i + 2] = temp;
      }
      const img = {
        width,
        height,
        bpp,
        bytesPerPixel,
        imageSize,
        pixels,
        flipY,
        format: bpp == 32 ? "RGBA" : "RGB"
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
    static fromImage(image, options) {
      options = options || {};
      const texture = options.texture || new _Texture(image.width, image.height, options);
      texture.uploadImage(image, options);
      texture.bind();
      gl.texParameteri(texture.texture_type, gl.TEXTURE_MAG_FILTER, texture.magFilter || _Texture.DEFAULT_MAG_FILTER);
      gl.texParameteri(texture.texture_type, gl.TEXTURE_MIN_FILTER, texture.minFilter || _Texture.DEFAULT_MIN_FILTER);
      gl.texParameteri(texture.texture_type, gl.TEXTURE_WRAP_S, texture.wrapS || _Texture.DEFAULT_WRAP_S);
      gl.texParameteri(texture.texture_type, gl.TEXTURE_WRAP_T, texture.wrapT || _Texture.DEFAULT_WRAP_T);
      if (isPowerOfTwo(texture.width) && isPowerOfTwo(texture.height) || gl.webgl_version > 1) {
        if (options.minFilter && options.minFilter != gl.NEAREST && options.minFilter != gl.LINEAR) {
          texture.bind();
          gl.generateMipmap(texture.texture_type);
          texture.has_mipmaps = true;
        }
      } else {
        gl.texParameteri(texture.texture_type, gl.TEXTURE_MIN_FILTER, LINEAR);
        gl.texParameteri(texture.texture_type, gl.TEXTURE_WRAP_S, CLAMP_TO_EDGE);
        gl.texParameteri(texture.texture_type, gl.TEXTURE_WRAP_T, CLAMP_TO_EDGE);
        texture.has_mipmaps = false;
      }
      gl.bindTexture(texture.texture_type, null);
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
    static fromVideo(video, options) {
      options = options || {};
      const texture = options.texture || new _Texture(video.videoWidth, video.videoHeight, options);
      texture.bind();
      texture.uploadImage(video, options);
      if (options.minFilter && options.minFilter != gl.NEAREST && options.minFilter != gl.LINEAR) {
        texture.bind();
        gl.generateMipmap(texture.texture_type);
        texture.has_mipmaps = true;
        texture.data = video;
      }
      gl.bindTexture(texture.texture_type, null);
      return texture;
    }
    /**
    * Create a clone of a texture
    * @method Texture.fromTexture
    * @param {Texture} old_texture
    * @param {Object} options
    * @return {Texture} the texture
    */
    static fromTexture(old_texture, options) {
      options = options || {};
      const texture = new _Texture(old_texture.width, old_texture.height, options);
      old_texture.copyTo(texture);
      return texture;
    }
    clone(options) {
      const old_options = this.getProperties();
      if (options) {
        const src = options;
        for (const i in src) old_options[i] = src[i];
      }
      return _Texture.fromTexture(this, old_options);
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
    static fromMemory(width, height, pixels, options) {
      options = options || {};
      const texture = options.texture || new _Texture(width, height, options);
      _Texture.setUploadOptions(options);
      texture.bind();
      if (pixels.constructor === Array) {
        if (options.type == gl.FLOAT) pixels = new Float32Array(pixels);
        else if (options.type == HALF_FLOAT || options.type == HALF_FLOAT_OES)
          pixels = new Uint16Array(pixels);
        else pixels = new Uint8Array(pixels);
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, texture.format, width, height, 0, texture.format, texture.type, pixels);
      texture.width = width;
      texture.height = height;
      texture.data = pixels;
      if (options.minFilter && options.minFilter != gl.NEAREST && options.minFilter != gl.LINEAR) {
        gl.generateMipmap(gl.TEXTURE_2D);
        texture.has_mipmaps = true;
      }
      gl.bindTexture(texture.texture_type, null);
      return texture;
    }
    /**
    * Create a texture from an ArrayBuffer containing the pixels
    * @method Texture.fromDDSInMemory
    * @param {ArrayBuffer} DDS data
    * @param {Object} options
    * @return {Texture} the texture
    */
    static fromDDSInMemory(data, options) {
      options = options || {};
      const texture = options.texture || new _Texture(0, 0, options);
      _Texture.setUploadOptions(options);
      texture.bind();
      const ext = gl.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc") || gl.getExtension("WEBGL_compressed_texture_s3tc");
      if (DDS)
        DDS.loadDDSTextureFromMemoryEx(gl, ext, data, texture, true);
      gl.bindTexture(texture.texture_type, null);
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
    static fromShader(width, height, shader, options) {
      options = options || {};
      const texture = new _Texture(width, height, options);
      texture.drawTo(function() {
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
    static cubemapFromImages(images, options) {
      options = options || {};
      if (images.length != 6) throw "missing images to create cubemap";
      const width = images[0].width;
      const height = images[0].height;
      options.texture_type = gl.TEXTURE_CUBE_MAP;
      let texture;
      if (options.texture) {
        texture = options.texture;
        texture.width = width;
        texture.height = height;
      } else texture = new _Texture(width, height, options);
      _Texture.setUploadOptions(options);
      texture.bind();
      try {
        for (let i = 0; i < 6; i++)
          gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, texture.format, texture.format, texture.type, images[i]);
        texture.data = images;
      } catch (e) {
        if (location.protocol == "file:") {
          throw 'image not loaded for security reasons (serve this page over "http://" instead)';
        } else {
          throw "image not loaded for security reasons (image must originate from the same domain as this page or use Cross-Origin Resource Sharing)";
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
    static cubemapFromImage(image, options) {
      options = options || {};
      if (image.width != image.height / 6 && image.height % 6 != 0 && !options.faces && !options.is_polar) {
        console.error("Cubemap image not valid, only 1x6 (vertical) or 6x3 (cross) formats. Check size:", image.width, image.height);
        return null;
      }
      let width = image.width;
      let height = image.height;
      if (options.is_polar) {
        const size2 = options.size || nearestPowerOfTwo(image.height);
        const temp_tex = _Texture.fromImage(image, { ignore_pot: true, wrap: gl.REPEAT, filter: gl.LINEAR });
        let cubemap = new _Texture(size2, size2, { texture_type: gl.TEXTURE_CUBE_MAP, format: gl.RGBA });
        if (options.texture) {
          const old_tex = options.texture;
          const src = cubemap;
          const dst = old_tex;
          for (const i in src) dst[i] = src[i];
          cubemap = old_tex;
        }
        const rot_matrix = mat3.create();
        const uniforms = { u_texture: 0, u_rotation: rot_matrix };
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        const shader = Shader.getPolarToCubemapShader();
        cubemap.drawTo(function(t, i) {
          const face_info = _Texture.cubemap_camera_parameters[i];
          mat3.identity(rot_matrix);
          rot_matrix.set(face_info.right, 0);
          rot_matrix.set(face_info.up, 3);
          rot_matrix.set(face_info.dir, 6);
          temp_tex.toViewport(shader, uniforms);
        });
        if (options.keep_image) cubemap.img = image;
        return cubemap;
      } else if (options.is_cross !== void 0) {
        options.faces = _Texture.generateCubemapCrossFacesInfo(image.width, options.is_cross);
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
      const images = [];
      for (let i = 0; i < 6; i++) {
        const canvas = createCanvas(size, size);
        const ctx = canvas.getContext("2d");
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
      }
      const texture = _Texture.cubemapFromImages(images, options);
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
    static generateCubemapCrossFacesInfo(width, column) {
      if (column === void 0) column = 1;
      const s = width / 4;
      return [
        { x: 2 * s, y: s, width: s, height: s },
        //+x
        { x: 0, y: s, width: s, height: s },
        //-x
        { x: column * s, y: 0, width: s, height: s },
        //+y
        { x: column * s, y: 2 * s, width: s, height: s },
        //-y
        { x: s, y: s, width: s, height: s },
        //+z
        { x: 3 * s, y: s, width: s, height: s }
        //-z
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
    static cubemapFromURL(url, options, on_complete) {
      options = options || {};
      options = Object.create(options);
      options.texture_type = gl.TEXTURE_CUBE_MAP;
      let texture = options.texture || new _Texture(1, 1, options);
      texture.bind();
      _Texture.setUploadOptions(options);
      const default_color = options.temp_color || [0, 0, 0, 255];
      const temp_color = options.type == gl.FLOAT ? new Float32Array(default_color) : new Uint8Array(default_color);
      for (let i = 0; i < 6; i++)
        gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, texture.format, 1, 1, 0, texture.format, texture.type, temp_color);
      gl.bindTexture(texture.texture_type, null);
      texture.ready = false;
      const image = new Image();
      image.src = url;
      image.onload = function() {
        options.texture = texture;
        texture = _Texture.cubemapFromImage(image, options);
        if (texture) delete texture.ready;
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
    getPixels(cubemap_face, mipmap_level) {
      mipmap_level = mipmap_level || 0;
      const gl2 = this.gl;
      const v = gl2.getViewport();
      const old_fbo = gl2.getParameter(gl2.FRAMEBUFFER_BINDING);
      if (this.format == gl2.DEPTH_COMPONENT) throw "cannot use getPixels in depth textures";
      gl2.disable(gl2.DEPTH_TEST);
      let fbo = gl2.__copy_fbo;
      if (!fbo) {
        fbo = gl2.createFramebuffer();
        gl2.__copy_fbo = fbo;
      }
      gl2.bindFramebuffer(gl2.FRAMEBUFFER, fbo);
      let buffer;
      const width = this.width >> mipmap_level;
      const height = this.height >> mipmap_level;
      gl2.viewport(0, 0, width, height);
      if (this.texture_type == gl2.TEXTURE_2D)
        gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.TEXTURE_2D, this.handler, mipmap_level);
      else if (this.texture_type == gl2.TEXTURE_CUBE_MAP)
        gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.TEXTURE_CUBE_MAP_POSITIVE_X + (cubemap_face || 0), this.handler, mipmap_level);
      let channels = this.format == gl2.RGB ? 3 : 4;
      channels = 4;
      const type = this.type;
      if (type == gl2.UNSIGNED_BYTE) buffer = new Uint8Array(width * height * channels);
      else if (type == HALF_FLOAT || type == HALF_FLOAT_OES)
        buffer = new Uint16Array(width * height * channels);
      else buffer = new Float32Array(width * height * channels);
      gl2.readPixels(0, 0, width, height, channels == 3 ? gl2.RGB : gl2.RGBA, type, buffer);
      gl2.bindFramebuffer(gl2.FRAMEBUFFER, old_fbo);
      gl2.viewport(v[0], v[1], v[2], v[3]);
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
    setPixels(data, no_flip, skip_mipmaps, cubemap_face) {
      const options = { no_flip };
      if (cubemap_face) options.cubemap_face = cubemap_face;
      this.uploadData(data, options, skip_mipmaps);
    }
    /**
    * returns an array with six arrays containing the pixels of every cubemap face
    * @method getCubemapPixels
    * @return {Array} the array that has 6 typed arrays containing the pixels
    */
    getCubemapPixels() {
      if (this.texture_type !== gl.TEXTURE_CUBE_MAP) throw "this texture is not a cubemap";
      return [
        this.getPixels(0),
        this.getPixels(1),
        this.getPixels(2),
        this.getPixels(3),
        this.getPixels(4),
        this.getPixels(5)
      ];
    }
    /**
    * fills a cubemap given an array with typed arrays containing the pixels of 6 faces
    * @method setCubemapPixels
    * @param {Array} data array that has 6 typed arrays containing the pixels
    * @param {bool} noflip if pixels should not be flipped according to Y
    */
    setCubemapPixels(data_array, no_flip) {
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
    toCanvas(canvas, flip_y, max_size) {
      max_size = max_size || 8192;
      const gl2 = this.gl;
      let w = Math.min(this.width, max_size);
      let h = Math.min(this.height, max_size);
      if (this.texture_type == gl2.TEXTURE_CUBE_MAP) {
        w = w * 4;
        h = h * 3;
      }
      canvas = canvas || createCanvas(w, h);
      if (canvas.width != w) canvas.width = w;
      if (canvas.height != h) canvas.height = h;
      let buffer = null;
      if (this.texture_type == gl2.TEXTURE_2D) {
        if (this.width != w || this.height != h || this.type != gl2.UNSIGNED_BYTE) {
          const temp = new _Texture(w, h, { format: gl2.RGBA, filter: gl2.NEAREST });
          this.copyTo(temp);
          buffer = temp.getPixels();
        } else buffer = this.getPixels();
        const ctx = canvas.getContext("2d");
        const pixels = ctx.getImageData(0, 0, w, h);
        pixels.data.set(buffer);
        ctx.putImageData(pixels, 0, 0);
        if (flip_y) {
          const temp = createCanvas(w, h);
          const temp_ctx = temp.getContext("2d");
          temp_ctx.translate(0, temp.height);
          temp_ctx.scale(1, -1);
          temp_ctx.drawImage(canvas, 0, 0, temp.width, temp.height);
          ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
          ctx.drawImage(temp, 0, 0);
        }
      } else if (this.texture_type == gl2.TEXTURE_CUBE_MAP) {
        const temp_canvas = createCanvas(this.width, this.height);
        const temp_ctx = temp_canvas.getContext("2d");
        const info = _Texture.generateCubemapCrossFacesInfo(canvas.width, 1);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        let cubemap = this;
        if (this.type != gl2.UNSIGNED_BYTE) {
          cubemap = new _Texture(this.width, this.height, {
            format: gl2.RGBA,
            texture_type: gl2.TEXTURE_CUBE_MAP,
            filter: gl2.NEAREST,
            type: gl2.UNSIGNED_BYTE
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
    toBinary(flip_y, type) {
      const canvas = this.toCanvas(null, flip_y);
      const data = canvas.toDataURL(type);
      const index = data.indexOf(",");
      const base64_data = data.substr(index + 1);
      const binStr = atob(base64_data);
      const len = binStr.length, arr = new Uint8Array(len);
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
    toBlob(flip_y, type) {
      const arr = this.toBinary(flip_y);
      const blob = new Blob([arr], { type: type || "image/png" });
      return blob;
    }
    //faster depending on the browser
    toBlobAsync(flip_y, type, callback) {
      const canvas = this.toCanvas(null, flip_y);
      if (canvas.toBlob) {
        canvas.toBlob(callback || (() => {
        }), type);
        return;
      }
      const blob = this.toBlob(flip_y, type);
      if (callback) callback(blob);
    }
    /**
    * returns a base64 String containing all the data from the texture
    * @method toBase64
    * @param {boolean} flip_y if you want to flip vertically the image, WebGL saves the images upside down
    * @return {String} the data in base64 format
    */
    toBase64(flip_y) {
      const w = this.width;
      const h = this.height;
      const buffer = this.getPixels();
      let canvas = createCanvas(w, h);
      const ctx = canvas.getContext("2d");
      const pixels = ctx.getImageData(0, 0, w, h);
      pixels.data.set(buffer);
      ctx.putImageData(pixels, 0, 0);
      if (flip_y) {
        const temp_canvas = createCanvas(w, h);
        const temp_ctx = temp_canvas.getContext("2d");
        temp_ctx.translate(0, h);
        temp_ctx.scale(1, -1);
        temp_ctx.drawImage(canvas, 0, 0);
        canvas = temp_canvas;
      }
      const img = canvas.toDataURL("image/png");
      return img;
    }
    /**
    * generates some basic metadata about the image
    * @method generateMetadata
    * @return {Object}
    */
    generateMetadata() {
      const metadata = { width: this.width, height: this.height };
      this.metadata = metadata;
    }
    static compareFormats(a, b) {
      if (!a || !b) return false;
      if (a == b) return true;
      if (a.width != b.width || a.height != b.height || a.type != b.type || //gl.UNSIGNED_BYTE
      a.format != b.format || //gl.RGB
      a.texture_type != b.texture_type)
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
    static blend(a, b, factor, out) {
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
        out.drawTo(function() {
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
    static cubemapToTexture2D(cubemap_texture, size, target_texture, keep_type, yaw) {
      if (!cubemap_texture || cubemap_texture.texture_type != gl.TEXTURE_CUBE_MAP) throw "No cubemap in convert";
      size = size || cubemap_texture.width;
      const type = keep_type ? cubemap_texture.type : gl.UNSIGNED_BYTE;
      yaw = yaw || 0;
      if (!target_texture) target_texture = new _Texture(size * 2, size, { minFilter: gl.NEAREST, type });
      let shader = gl.shaders["cubemap_to_texture2D"];
      if (!shader) {
        shader = gl.shaders["cubemap_to_texture2D"] = new Shader(
          Shader.SCREEN_VERTEX_SHADER,
          "		precision mediump float;\n		#define PI 3.14159265358979323846264\n		uniform samplerCube texture;		varying vec2 v_coord;		uniform float u_yaw;\n		void main() {			float alpha = ((1.0 - v_coord.x) * 2.0) * PI + u_yaw;			float beta = (v_coord.y * 2.0 - 1.0) * PI * 0.5;			vec3 N = vec3( -cos(alpha) * cos(beta), sin(beta), sin(alpha) * cos(beta) );			gl_FragColor = textureCube(texture,N);		}"
        );
      }
      shader.setUniform("u_yaw", yaw);
      target_texture.drawTo(function() {
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
    static getWhiteTexture(gl2) {
      gl2 = gl2 || globalThis.gl;
      const tex = gl2.textures[":white"];
      if (tex) return tex;
      const color = new Uint8Array([255, 255, 255, 255]);
      return gl2.textures[":white"] = new _Texture(1, 1, { pixel_data: color });
    }
    /**
    * returns a black texture of 1x1 pixel
    * @method Texture.getBlackTexture
    * @return {Texture} the black texture
    */
    static getBlackTexture(gl2) {
      gl2 = gl2 || globalThis.gl;
      const tex = gl2.textures[":black"];
      if (tex) return tex;
      const color = new Uint8Array([0, 0, 0, 255]);
      return gl2.textures[":black"] = new _Texture(1, 1, { pixel_data: color });
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
    static getTemporary(width, height, options, gl2) {
      gl2 = gl2 || globalThis.gl;
      if (!gl2._texture_pool) gl2._texture_pool = [];
      let texture_type = TEXTURE_2D;
      let type = _Texture.DEFAULT_TYPE;
      let format = _Texture.DEFAULT_FORMAT;
      if (options) {
        if (options.texture_type) texture_type = options.texture_type;
        if (options.type) type = options.type;
        if (options.format) format = options.format;
      }
      const key = texture_type + ":" + type + ":" + width + "x" + height + ":" + format;
      const pool = gl2._texture_pool;
      for (let i = 0; i < pool.length; ++i) {
        const tex2 = pool[i];
        if (tex2._key != key)
          continue;
        pool.splice(i, 1);
        tex2._pool = 0;
        return tex2;
      }
      const tex = new _Texture(width, height, { type, texture_type, format, filter: gl2.LINEAR });
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
    static releaseTemporary(tex, gl2) {
      var _a;
      gl2 = gl2 || globalThis.gl;
      if (!gl2._texture_pool) gl2._texture_pool = [];
      if (((_a = tex._pool) != null ? _a : 0) > 0) console.warn("this texture is already in the textures pool");
      let pool = gl2._texture_pool;
      if (!pool) pool = gl2._texture_pool = [];
      tex._pool = getTime();
      pool.push(tex);
      if (pool.length > 20) {
        pool.sort(function(a, b) {
          var _a2, _b;
          return ((_a2 = b._pool) != null ? _a2 : 0) - ((_b = a._pool) != null ? _b : 0);
        });
        const last = pool.pop();
        last._pool = 0;
        last.delete();
      }
    }
    //returns the next power of two bigger than size
    static nextPOT(size) {
      return Math.pow(2, Math.ceil(Math.log(size) / Math.log(2)));
    }
  };
  // --- static configuration ---
  _Texture.DEFAULT_TYPE = UNSIGNED_BYTE;
  _Texture.DEFAULT_FORMAT = RGBA;
  _Texture.DEFAULT_MAG_FILTER = LINEAR;
  _Texture.DEFAULT_MIN_FILTER = LINEAR;
  _Texture.DEFAULT_WRAP_S = CLAMP_TO_EDGE;
  _Texture.DEFAULT_WRAP_T = CLAMP_TO_EDGE;
  _Texture.EXTENSION = "png";
  //used when saving it to file
  //used for render to FBOs
  _Texture.framebuffer = null;
  _Texture.renderbuffer = null;
  _Texture.loading_color = new Uint8Array([0, 0, 0, 0]);
  _Texture.use_renderbuffer_pool = true;
  //should improve performance
  _Texture.CROSS_ORIGIN_CREDENTIALS = "Anonymous";
  _Texture.binary_extension = "png";
  _Texture.MAX_TEXTURE_IMAGE_UNITS = 0;
  //When creating cubemaps this is helpful
  //THIS works
  _Texture.cubemap_camera_parameters = [
    { type: "posX", dir: vec3.fromValues(1, 0, 0), up: vec3.fromValues(0, 1, 0), right: vec3.fromValues(0, 0, -1) },
    { type: "negX", dir: vec3.fromValues(-1, 0, 0), up: vec3.fromValues(0, 1, 0), right: vec3.fromValues(0, 0, 1) },
    { type: "posY", dir: vec3.fromValues(0, 1, 0), up: vec3.fromValues(0, 0, -1), right: vec3.fromValues(1, 0, 0) },
    { type: "negY", dir: vec3.fromValues(0, -1, 0), up: vec3.fromValues(0, 0, 1), right: vec3.fromValues(1, 0, 0) },
    { type: "posZ", dir: vec3.fromValues(0, 0, 1), up: vec3.fromValues(0, 1, 0), right: vec3.fromValues(1, 0, 0) },
    { type: "negZ", dir: vec3.fromValues(0, 0, -1), up: vec3.fromValues(0, 1, 0), right: vec3.fromValues(-1, 0, 0) }
  ];
  var Texture = _Texture;

  // src/core.ts
  var last_context_id = 0;
  var reverse = null;
  var dragging = false;
  var last_pos = [0, 0];
  var mobile = void 0;
  function create(options) {
    const opts = options || {};
    let canvas = null;
    if (opts.canvas) {
      if (typeof opts.canvas === "string") {
        canvas = document.getElementById(opts.canvas);
        if (!canvas) throw "Canvas element not found: " + opts.canvas;
      } else {
        canvas = opts.canvas;
      }
    } else {
      let root = null;
      if (opts.container)
        root = opts.container.constructor === String ? document.querySelector(opts.container) : opts.container;
      if (root && !opts.width) {
        const rect = root.getBoundingClientRect();
        opts.width = rect.width;
        opts.height = rect.height;
      }
      canvas = createCanvas(opts.width || 800, opts.height || 600);
      if (root) root.appendChild(canvas);
    }
    if (!("alpha" in opts)) opts.alpha = false;
    let rawgl = null;
    let seq = null;
    if (opts.version === 2) seq = ["webgl2", "experimental-webgl2"];
    else if (opts.version === 1 || opts.version === void 0) seq = ["webgl", "experimental-webgl"];
    else if (opts.version === 0) seq = ["webgl2", "experimental-webgl2", "webgl", "experimental-webgl"];
    if (!seq) throw "Incorrect WebGL version, must be 1 or 2";
    const context_options = {
      alpha: opts.alpha === void 0 ? true : opts.alpha,
      depth: opts.depth === void 0 ? true : opts.depth,
      stencil: opts.stencil === void 0 ? true : opts.stencil,
      antialias: opts.antialias === void 0 ? true : opts.antialias,
      premultipliedAlpha: opts.premultipliedAlpha === void 0 ? true : opts.premultipliedAlpha,
      preserveDrawingBuffer: opts.preserveDrawingBuffer === void 0 ? true : opts.preserveDrawingBuffer
    };
    for (let i = 0; i < seq.length; ++i) {
      try {
        rawgl = canvas.getContext(seq[i], context_options);
      } catch (e) {
      }
      if (rawgl) break;
    }
    if (!rawgl) {
      if (canvas.getContext("webgl")) throw "WebGL supported but not with those parameters";
      throw "WebGL not supported";
    }
    const gl2 = rawgl;
    gl2.webgl_version = gl2.constructor.name === "WebGL2RenderingContext" ? 2 : 1;
    globalThis.gl = gl2;
    canvas.is_webgl = true;
    canvas.gl = gl2;
    gl2.context_id = last_context_id++;
    gl2.extensions = {};
    const available_extensions = gl2.getSupportedExtensions() || [];
    for (let i = 0; i < available_extensions.length; ++i)
      gl2.extensions[available_extensions[i]] = gl2.getExtension(available_extensions[i]);
    if (gl2.webgl_version === 1)
      gl2.HIGH_PRECISION_FORMAT = gl2.extensions["OES_texture_half_float"] ? HALF_FLOAT_OES : gl2.extensions["OES_texture_float"] ? FLOAT : UNSIGNED_BYTE;
    else gl2.HIGH_PRECISION_FORMAT = HALF_FLOAT_OES;
    gl2.max_texture_units = gl2.getParameter(gl2.MAX_TEXTURE_IMAGE_UNITS);
    if (!gl2._viewport_func) {
      gl2._viewport_func = gl2.viewport;
      gl2.viewport_data = new Float32Array([0, 0, gl2.canvas.width, gl2.canvas.height]);
      gl2.viewport = function(a, b, c, d) {
        const v = this.viewport_data;
        v[0] = a | 0;
        v[1] = b | 0;
        v[2] = c | 0;
        v[3] = d | 0;
        this._viewport_func(a, b, c, d);
      };
      gl2.getViewport = function(v) {
        if (v) {
          v[0] = gl2.viewport_data[0];
          v[1] = gl2.viewport_data[1];
          v[2] = gl2.viewport_data[2];
          v[3] = gl2.viewport_data[3];
          return v;
        }
        return new Float32Array(gl2.viewport_data);
      };
      gl2.setViewport = function(v, flip_y) {
        gl2.viewport_data.set(v);
        if (flip_y) gl2.viewport_data[1] = this.drawingBufferHeight - v[1] - v[3];
        this._viewport_func(v[0], gl2.viewport_data[1], v[2], v[3]);
      };
    } else console.warn("Creating LiteGL context over the same canvas twice");
    if (!reverse) {
      const r = {};
      const glRecord = gl2;
      for (const i in glRecord) {
        const val = glRecord[i];
        if (val && val.constructor === Number) r[val] = i;
      }
      reverse = r;
    }
    if (window.glMatrix == void 0)
      throw "glMatrix not found, LiteGL requires glMatrix to be included";
    let last_click_time = 0;
    gl2.shaders = {};
    gl2.textures = {};
    gl2.meshes = {};
    gl2.draw_calls = 0;
    gl2.makeCurrent = function() {
      globalThis.gl = this;
    };
    gl2.execute = function(callback) {
      const old_gl = globalThis.gl;
      globalThis.gl = this;
      callback();
      globalThis.gl = old_gl;
    };
    gl2.animate = function(v) {
      if (v === false) {
        globalThis.cancelAnimationFrame(this._requestFrame_id);
        this._requestFrame_id = null;
        return;
      }
      const post = globalThis.requestAnimationFrame;
      let time = getTime();
      const context = this;
      let last_mouse_buttons = 0;
      function loop() {
        if (gl2.destroyed) return;
        context._requestFrame_id = post(loop);
        const now = getTime();
        const dt = (now - time) * 1e-3;
        if (context.mouse) context.mouse.last_buttons = last_mouse_buttons;
        last_mouse_buttons = context.mouse.buttons;
        if (context.onupdate) context.onupdate(dt);
        LEvent.trigger(context, "update", dt);
        if (context.ondraw) {
          const old_gl = globalThis.gl;
          globalThis.gl = context;
          context.ondraw();
          LEvent.trigger(context, "draw");
          globalThis.gl = old_gl;
        }
        time = now;
      }
      this._requestFrame_id = post(loop);
    };
    gl2.destroy = function() {
      if (onkey_handler) {
        document.removeEventListener("keydown", onkey_handler);
        document.removeEventListener("keyup", onkey_handler);
      }
      const cv = this.canvas;
      if (onmouse_handler) {
        cv.removeEventListener("mousedown", onmouse_handler);
        cv.removeEventListener("mousemove", onmouse_handler);
        cv.removeEventListener("mouseup", onmouse_handler);
        cv.addEventListener("drag", onmouse_handler);
        cv.addEventListener("dragstart", onmouse_handler);
        cv.addEventListener("wheel", onmouse_handler);
      }
      const shaders = this.shaders;
      for (const i in shaders) {
        shaders[i].delete();
        shaders[i] = null;
      }
      this.shaders = {};
      const meshes = this.meshes;
      for (const i in meshes) {
        meshes[i].deleteBuffers();
        meshes[i] = null;
      }
      this.meshes = {};
      const textures = this.textures;
      for (const i in textures) {
        textures[i].delete();
        textures[i] = null;
      }
      this.textures = {};
      if (cv.parentNode) cv.parentNode.removeChild(cv);
      this.destroyed = true;
      if (globalThis.gl === this) globalThis.gl = null;
    };
    const mouse = {
      buttons: 0,
      //this should always be up-to-date with mouse state
      last_buttons: 0,
      //button state in the previous frame
      left_button: false,
      middle_button: false,
      right_button: false,
      position: new Float32Array(2),
      x: 0,
      //in canvas coordinates
      y: 0,
      deltax: 0,
      deltay: 0,
      clientx: 0,
      //in client coordinates
      clienty: 0,
      isInsideRect: function(x, y, w, h, flip_y) {
        let mouse_y = this.y;
        if (flip_y) mouse_y = gl2.canvas.height - mouse_y;
        if (this.x > x && this.x < x + w && mouse_y > y && mouse_y < y + h) return true;
        return false;
      },
      /**
       * returns true if button num is pressed (where num could be GL.LEFT_MOUSE_BUTTON, GL.RIGHT_MOUSE_BUTTON, GL.MIDDLE_MOUSE_BUTTON
       * @method captureMouse
       * @param {boolean} capture_wheel capture also the mouse wheel
       */
      isButtonPressed: function(num) {
        if (num === LEFT_MOUSE_BUTTON) return this.buttons & LEFT_MOUSE_BUTTON_MASK;
        if (num === MIDDLE_MOUSE_BUTTON) return this.buttons & MIDDLE_MOUSE_BUTTON_MASK;
        if (num === RIGHT_MOUSE_BUTTON) return this.buttons & RIGHT_MOUSE_BUTTON_MASK;
        return void 0;
      },
      wasButtonPressed: function(num) {
        let mask = 0;
        if (num === LEFT_MOUSE_BUTTON) mask = LEFT_MOUSE_BUTTON_MASK;
        else if (num === MIDDLE_MOUSE_BUTTON) mask = MIDDLE_MOUSE_BUTTON_MASK;
        else if (num === RIGHT_MOUSE_BUTTON) mask = RIGHT_MOUSE_BUTTON_MASK;
        return this.buttons & mask && !(this.last_buttons & mask);
      }
    };
    gl2.mouse = mouse;
    gl2.captureMouse = function(capture_wheel, translate_touchs) {
      canvas.addEventListener("mousedown", onmouse);
      canvas.addEventListener("mousemove", onmouse);
      canvas.addEventListener("drag", onmouse);
      canvas.addEventListener("dragstart", onmouse);
      if (capture_wheel) {
        canvas.addEventListener("mousewheel", onmouse, false);
        canvas.addEventListener("wheel", onmouse, false);
      }
      canvas.addEventListener("contextmenu", function(e) {
        e.preventDefault();
        return false;
      });
      if (translate_touchs) this.captureTouch(true);
    };
    function onmouse(e) {
      if (gl2.ignore_events) return;
      const old_mouse_mask = gl2.mouse.buttons;
      augmentEvent(e, canvas);
      e.eventType = e.eventType || e.type;
      const now = getTime();
      mouse.dragging = e.dragging;
      mouse.position[0] = e.canvasx;
      mouse.position[1] = e.canvasy;
      mouse.x = e.canvasx;
      mouse.y = e.canvasy;
      mouse.mousex = e.mousex;
      mouse.mousey = e.mousey;
      mouse.canvasx = e.canvasx;
      mouse.canvasy = e.canvasy;
      mouse.clientx = e.mousex;
      mouse.clienty = e.mousey;
      mouse.buttons = e.buttons;
      mouse.left_button = !!(mouse.buttons & LEFT_MOUSE_BUTTON_MASK);
      mouse.middle_button = !!(mouse.buttons & MIDDLE_MOUSE_BUTTON_MASK);
      mouse.right_button = !!(mouse.buttons & RIGHT_MOUSE_BUTTON_MASK);
      if (e.eventType === "mousedown") {
        if (old_mouse_mask === 0) {
          canvas.removeEventListener("mousemove", onmouse);
          const doc = canvas.ownerDocument;
          doc.addEventListener("mousemove", onmouse);
          doc.addEventListener("mouseup", onmouse);
        }
        last_click_time = now;
        if (gl2.onmousedown) gl2.onmousedown(e);
        LEvent.trigger(gl2, "mousedown");
      } else if (e.eventType === "mousemove") {
        if (gl2.onmousemove) gl2.onmousemove(e);
        LEvent.trigger(gl2, "mousemove", e);
      } else if (e.eventType === "mouseup") {
        if (gl2.mouse.buttons === 0) {
          canvas.addEventListener("mousemove", onmouse);
          const doc = canvas.ownerDocument;
          doc.removeEventListener("mousemove", onmouse);
          doc.removeEventListener("mouseup", onmouse);
        }
        e.click_time = now - last_click_time;
        if (gl2.onmouseup) gl2.onmouseup(e);
        LEvent.trigger(gl2, "mouseup", e);
      } else if (e.eventType === "mousewheel" || e.eventType === "wheel" || e.eventType === "DOMMouseScroll") {
        e.eventType = "mousewheel";
        if (e.type === "wheel")
          e.wheel = -e.deltaY;
        else e.wheel = e.wheelDeltaY != null ? e.wheelDeltaY : e.detail * -60;
        e.delta = e.wheelDelta !== void 0 ? e.wheelDelta / 40 : e.deltaY ? -e.deltaY / 3 : 0;
        if (gl2.onmousewheel) gl2.onmousewheel(e);
        LEvent.trigger(gl2, "mousewheel", e);
      } else if (e.eventType === "dragstart") {
        if (gl2.ondragstart) gl2.ondragstart(e);
        LEvent.trigger(gl2, "dragstart", e);
      }
      if (gl2.onmouse) gl2.onmouse(e);
      if (!e.skip_preventDefault) {
        if (e.eventType !== "mousemove") e.stopPropagation();
        e.preventDefault();
        return false;
      }
    }
    const onmouse_handler = onmouse;
    let translate_touches = false;
    if (typeof Hammer !== "undefined") {
      const H = Hammer;
      const mc = new H.Manager(canvas);
      const pinch = new H.Pinch({ threshold: 0.3 });
      if (mc && pinch) {
        mc.add(pinch);
        mc.on("pinch", pinchZoom);
      }
    }
    function pinchZoom(event) {
      const originalEvent = event.srcEvent;
      const type = "wheel";
      const simulatedEvent = document.createEvent("MouseEvent");
      simulatedEvent.initMouseEvent(
        type,
        true,
        true,
        window,
        1,
        originalEvent.screenX,
        originalEvent.screenY,
        originalEvent.clientX,
        originalEvent.clientY,
        false,
        false,
        false,
        false,
        0,
        null
      );
      simulatedEvent.originalEvent = simulatedEvent;
      simulatedEvent.is_touch = true;
      let processPinch = false;
      if (event.additionalEvent === "pinchin") {
        simulatedEvent.deltaY = 1;
        processPinch = true;
      } else if (event.additionalEvent === "pinchout") {
        simulatedEvent.deltaY = -1;
        processPinch = true;
      }
      if (processPinch) {
        simulatedEvent.pinchScaling = event.distance * 0.0312;
        originalEvent.target.dispatchEvent(simulatedEvent);
      }
      originalEvent.preventDefault();
    }
    gl2.captureTouch = function(translate_to_mouse_events) {
      translate_touches = !!translate_to_mouse_events;
      canvas.addEventListener("touchstart", ontouch, true);
      canvas.addEventListener("touchmove", ontouch, true);
      canvas.addEventListener("touchend", ontouch, true);
      canvas.addEventListener("touchcancel", ontouch, true);
      canvas.addEventListener("gesturestart", ongesture);
      canvas.addEventListener("gesturechange", ongesture);
      canvas.addEventListener("gestureend", ongesture);
    };
    function ontouch(e) {
      const touches = e.changedTouches, first = touches[0];
      let type = "";
      if (gl2.ontouch && gl2.ontouch(e) === true) return;
      if (LEvent.trigger(gl2, e.type, e) === true) return;
      if (!translate_touches) return;
      if (e.touches.length && e.changedTouches[0].identifier !== e.touches[0].identifier) return;
      if (touches > 1) return;
      switch (e.type) {
        case "touchstart":
          type = "mousedown";
          break;
        case "touchmove":
          type = "mousemove";
          break;
        case "touchend":
          type = "mouseup";
          break;
        default:
          return;
      }
      const simulatedEvent = document.createEvent("MouseEvent");
      simulatedEvent.initMouseEvent(
        type,
        true,
        true,
        window,
        1,
        first.screenX,
        first.screenY,
        first.clientX,
        first.clientY,
        false,
        false,
        false,
        false,
        0,
        null
      );
      simulatedEvent.originalEvent = simulatedEvent;
      simulatedEvent.is_touch = true;
      first.target.dispatchEvent(simulatedEvent);
      e.preventDefault();
    }
    function ongesture(e) {
      e.eventType = e.type;
      if (gl2.ongesture && gl2.ongesture(e) === false) return;
      if (LEvent.trigger(gl2, e.type, e) === false) return;
      e.preventDefault();
    }
    gl2.keys = {};
    let onkey_handler = null;
    gl2.captureKeys = function(prevent_default, only_canvas) {
      if (onkey_handler) return;
      gl2.keys = {};
      const target = only_canvas ? gl2.canvas : document;
      void target;
      document.addEventListener("keydown", inner);
      document.addEventListener("keyup", inner);
      function inner(e) {
        onkey(e, prevent_default);
      }
      onkey_handler = inner;
    };
    function onkey(e, prevent_default) {
      e.eventType = e.type;
      const target = e.target;
      const target_element = target.nodeName.toLowerCase();
      if (target_element === "input" || target_element === "textarea" || target_element === "select" || target.contentEditable === "true")
        return;
      e.character = String.fromCharCode(e.keyCode).toLowerCase();
      let prev_state = false;
      let key = mapKeyCode(e.keyCode);
      if (!key) key = e.character;
      const modified_key = e.altKey || e.ctrlKey || e.metaKey;
      if (!modified_key) {
        if (key) gl2.keys[key] = e.type === "keydown";
        prev_state = gl2.keys[e.keyCode];
        gl2.keys[e.keyCode] = e.type === "keydown";
      }
      if (prev_state !== gl2.keys[e.keyCode] || modified_key) {
        if (e.type === "keydown" && gl2.onkeydown) gl2.onkeydown(e);
        else if (e.type === "keyup" && gl2.onkeyup) gl2.onkeyup(e);
        LEvent.trigger(gl2, e.type, e);
      }
      if (gl2.onkey) gl2.onkey(e);
      if (prevent_default && (e.isChar || blockable_keys[e.keyIdentifier || e.key])) e.preventDefault();
    }
    gl2.gamepads = null;
    gl2.captureGamepads = function() {
      const nav = navigator;
      const getGamepads = nav.getGamepads || nav.webkitGetGamepads || nav.mozGetGamepads;
      if (!getGamepads) return;
      this.gamepads = getGamepads.call(navigator);
    };
    gl2.getGamepads = function(skip_mapping) {
      const nav = navigator;
      const getGamepads = nav.getGamepads || nav.webkitGetGamepads || nav.mozGetGamepads;
      if (!getGamepads) return;
      const gamepads = getGamepads.call(navigator);
      if (!this.gamepads) this.gamepads = [];
      for (let i = 0; i < 4; i++) {
        const gamepad = gamepads[i];
        if (gamepad && !skip_mapping) addGamepadXBOXmapping(gamepad);
        if (gamepad && !gamepad.prev_buttons) {
          gamepad.prev_buttons = new Uint8Array(32);
          const event = new CustomEvent("gamepadconnected");
          event.eventType = event.type;
          event.gamepad = gamepad;
          if (this.ongamepadconnected) this.ongamepadconnected(event);
          LEvent.trigger(gl2, "gamepadconnected", event);
        }
        if (gamepad) {
          const prev = gamepad.prev_buttons;
          for (let j = 0; j < gamepad.buttons.length; ++j) {
            const button = gamepad.buttons[j];
            button.was_pressed = false;
            if (button.pressed && !prev[j]) {
              button.was_pressed = true;
              const event = new CustomEvent("gamepadButtonDown");
              event.eventType = event.type;
              event.button = button;
              event.which = j;
              event.gamepad = gamepad;
              if (gl2.onbuttondown) gl2.onbuttondown(event);
              LEvent.trigger(gl2, "buttondown", event);
            } else if (!button.pressed && prev[j]) {
              const event = new CustomEvent("gamepadButtonUp");
              event.eventType = event.type;
              event.button = button;
              event.which = j;
              event.gamepad = gamepad;
              if (gl2.onbuttondown) gl2.onbuttondown(event);
              LEvent.trigger(gl2, "buttonup", event);
            }
            prev[j] = button.pressed ? 1 : 0;
          }
        }
      }
      this.gamepads = gamepads;
      return gamepads;
    };
    function addGamepadXBOXmapping(gamepad) {
      const xbox = gamepad.xbox || {
        axes: [],
        buttons: {},
        hat: ""
      };
      xbox.axes["lx"] = gamepad.axes[0];
      xbox.axes["ly"] = gamepad.axes[1];
      xbox.axes["rx"] = gamepad.axes[2];
      xbox.axes["ry"] = gamepad.axes[3];
      xbox.axes["triggers"] = gamepad.axes[4];
      for (let i = 0; i < gamepad.buttons.length; i++) {
        switch (i) {
          case 0:
            xbox.buttons["a"] = gamepad.buttons[i].pressed;
            break;
          case 1:
            xbox.buttons["b"] = gamepad.buttons[i].pressed;
            break;
          case 2:
            xbox.buttons["x"] = gamepad.buttons[i].pressed;
            break;
          case 3:
            xbox.buttons["y"] = gamepad.buttons[i].pressed;
            break;
          case 4:
            xbox.buttons["lb"] = gamepad.buttons[i].pressed;
            break;
          case 5:
            xbox.buttons["rb"] = gamepad.buttons[i].pressed;
            break;
          case 6:
            xbox.buttons["lt"] = gamepad.buttons[i].pressed;
            break;
          case 7:
            xbox.buttons["rt"] = gamepad.buttons[i].pressed;
            break;
          case 8:
            xbox.buttons["back"] = gamepad.buttons[i].pressed;
            break;
          case 9:
            xbox.buttons["start"] = gamepad.buttons[i].pressed;
            break;
          case 10:
            xbox.buttons["ls"] = gamepad.buttons[i].pressed;
            break;
          case 11:
            xbox.buttons["rs"] = gamepad.buttons[i].pressed;
            break;
          case 12:
            if (gamepad.buttons[i].pressed) xbox.hat += "up";
            break;
          case 13:
            if (gamepad.buttons[i].pressed) xbox.hat += "down";
            break;
          case 14:
            if (gamepad.buttons[i].pressed) xbox.hat += "left";
            break;
          case 15:
            if (gamepad.buttons[i].pressed) xbox.hat += "right";
            break;
          case 16:
            xbox.buttons["home"] = gamepad.buttons[i].pressed;
            break;
          default:
        }
      }
      gamepad.xbox = xbox;
    }
    gl2.fullscreen = function() {
      const canvas2 = this.canvas;
      if (canvas2.requestFullScreen) canvas2.requestFullScreen();
      else if (canvas2.webkitRequestFullScreen) canvas2.webkitRequestFullScreen();
      else if (canvas2.mozRequestFullScreen) canvas2.mozRequestFullScreen();
      else console.error("Fullscreen not supported");
    };
    gl2.snapshot = function(startx, starty, areax, areay, skip_reverse) {
      const canvas2 = createCanvas(areax, areay);
      const ctx = canvas2.getContext("2d");
      const pixels = ctx.getImageData(0, 0, canvas2.width, canvas2.height);
      const buffer = new Uint8Array(areax * areay * 4);
      gl2.readPixels(startx, starty, canvas2.width, canvas2.height, gl2.RGBA, gl2.UNSIGNED_BYTE, buffer);
      pixels.data.set(buffer);
      ctx.putImageData(pixels, 0, 0);
      if (skip_reverse) return canvas2;
      const final_canvas = createCanvas(areax, areay);
      const ctx2 = final_canvas.getContext("2d");
      ctx2.translate(0, areay);
      ctx2.scale(1, -1);
      ctx2.drawImage(canvas2, 0, 0);
      return final_canvas;
    };
    function getAndApplyExtension(glctx, name) {
      const ext = glctx.getExtension(name);
      if (!ext) {
        return false;
      }
      const extRecord = ext;
      const glRecord = glctx;
      let suffix = name.split("_")[0];
      const prefix = suffix = "_";
      const suffixRE = new RegExp(suffix + "$");
      const prefixRE = new RegExp("^" + prefix);
      let unprefixedKey = "";
      for (const key in extRecord) {
        const val = extRecord[key];
        if (typeof val === "function") {
          const unsuffixedKey = key.replace(suffixRE, "");
          void unsuffixedKey;
          if (key.substing)
            glRecord[unprefixedKey] = val.bind(ext);
        } else {
          unprefixedKey = key.replace(prefixRE, "");
          glRecord[unprefixedKey] = extRecord[key];
        }
      }
    }
    void getAndApplyExtension;
    const loading_textures = {};
    gl2.loadTexture = function(url, options2, on_load) {
      if (this.textures[url]) return this.textures[url];
      if (loading_textures[url]) return null;
      const img = new Image();
      img.url = url;
      img.onload = function() {
        const texture = Texture.fromImage(img, options2);
        texture.img = img;
        gl2.textures[img.url] = texture;
        delete loading_textures[img.url];
        if (on_load) on_load(texture);
      };
      img.src = url;
      loading_textures[url] = true;
      return null;
    };
    gl2.drawTexture = (function() {
      const identity = mat3.create();
      const pos = vec2.create();
      const size = vec2.create();
      const area = vec4.create();
      const white = vec4.fromValues(1, 1, 1, 1);
      const viewport = vec2.create();
      const _uniforms = {
        u_texture: 0,
        u_position: pos,
        u_color: white,
        u_size: size,
        u_texture_area: area,
        u_viewport: viewport,
        u_transform: identity
      };
      return function(texture, x, y, w, h, tx, ty, tw, th, shader, uniforms) {
        pos[0] = x;
        pos[1] = y;
        if (w === void 0) w = texture.width;
        if (h === void 0) h = texture.height;
        size[0] = w;
        size[1] = h;
        if (tx === void 0) tx = 0;
        if (ty === void 0) ty = 0;
        if (tw === void 0) tw = texture.width;
        if (th === void 0) th = texture.height;
        area[0] = tx / texture.width;
        area[1] = ty / texture.height;
        area[2] = (tx + tw) / texture.width;
        area[3] = (ty + th) / texture.height;
        viewport[0] = this.viewport_data[2];
        viewport[1] = this.viewport_data[3];
        shader = shader || Shader.getPartialQuadShader(this);
        const mesh = Mesh.getScreenQuad(this);
        texture.bind(0);
        shader.uniforms(_uniforms);
        if (uniforms) shader.uniforms(uniforms);
        shader.draw(mesh, gl2.TRIANGLES);
      };
    })();
    canvas.addEventListener(
      "webglcontextlost",
      function(e) {
        e.preventDefault();
        gl2.context_lost = true;
        if (gl2.onlosecontext) gl2.onlosecontext(e);
      },
      false
    );
    gl2.reset = function() {
      gl2.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl2.disable(gl2.BLEND);
      gl2.disable(gl2.CULL_FACE);
      gl2.disable(gl2.DEPTH_TEST);
      gl2.frontFace(gl2.CCW);
      gl2._current_texture_drawto = null;
      gl2._current_fbo_color = null;
      gl2._current_fbo_depth = null;
    };
    gl2.dump = function() {
      console.log("userAgent: ", navigator.userAgent);
      console.log("Supported extensions:");
      const extensions = gl2.getSupportedExtensions() || [];
      console.log(extensions.join(","));
      const info = [
        "VENDOR",
        "VERSION",
        "MAX_VERTEX_ATTRIBS",
        "MAX_VARYING_VECTORS",
        "MAX_VERTEX_UNIFORM_VECTORS",
        "MAX_VERTEX_TEXTURE_IMAGE_UNITS",
        "MAX_FRAGMENT_UNIFORM_VECTORS",
        "MAX_TEXTURE_SIZE",
        "MAX_TEXTURE_IMAGE_UNITS"
      ];
      const glRecord = gl2;
      console.log("WebGL info:");
      for (const i in info) console.log(" * " + info[i] + ": " + gl2.getParameter(glRecord[info[i]]));
      console.log("*************************************************");
    };
    gl2.reset();
    return gl2;
  }
  function mapKeyCode(code) {
    const named = {
      8: "BACKSPACE",
      9: "TAB",
      13: "ENTER",
      16: "SHIFT",
      17: "CTRL",
      27: "ESCAPE",
      32: "SPACE",
      33: "PAGEUP",
      34: "PAGEDOWN",
      35: "END",
      36: "HOME",
      37: "LEFT",
      38: "UP",
      39: "RIGHT",
      40: "DOWN"
    };
    return named[code] || (code >= 65 && code <= 90 ? String.fromCharCode(code) : null);
  }
  function augmentEvent(e, root_element) {
    let offset_left = 0;
    let offset_top = 0;
    void offset_left;
    void offset_top;
    const target = root_element || e.target || globalThis.gl.canvas;
    const b = target.getBoundingClientRect();
    e.mousex = e.clientX - b.left;
    e.mousey = e.clientY - b.top;
    e.canvasx = e.mousex;
    e.canvasy = b.height - e.mousey;
    e.deltax = 0;
    e.deltay = 0;
    if (e.is_touch) {
      globalThis.gl.mouse.buttons = e.which;
    }
    if (document.pointerLockElement === target) {
      e.canvasx = e.mousex = b.width * 0.5;
      e.canvasy = e.mousey = b.height * 0.5;
    }
    if (e.type === "mousedown") {
      dragging = true;
    } else if (e.type === "mousemove") {
    } else if (e.type === "mouseup") {
      if (e.buttons === 0) dragging = false;
    }
    if (e.movementX !== void 0 && !e.is_touch && !isMobile()) {
      e.deltax = e.movementX;
      e.deltay = e.movementY;
    } else {
      e.deltax = e.mousex - last_pos[0];
      e.deltay = e.mousey - last_pos[1];
    }
    last_pos[0] = e.mousex;
    last_pos[1] = e.mousey;
    e.dragging = dragging;
    e.leftButton = !!(globalThis.gl.mouse.buttons & LEFT_MOUSE_BUTTON_MASK);
    e.middleButton = !!(globalThis.gl.mouse.buttons & MIDDLE_MOUSE_BUTTON_MASK);
    e.rightButton = !!(globalThis.gl.mouse.buttons & RIGHT_MOUSE_BUTTON_MASK);
    let buttons_mask = 0;
    if (e.leftButton) buttons_mask = 1;
    if (e.middleButton) buttons_mask |= 2;
    if (e.rightButton) buttons_mask |= 4;
    e.buttons_mask = buttons_mask;
    e.isButtonPressed = function(num) {
      var _a;
      return ((_a = this.buttons_mask) != null ? _a : 0) & 1 << num;
    };
  }
  function isMobile() {
    if (mobile !== void 0) return mobile;
    if (!globalThis.navigator)
      return mobile = false;
    if (navigator.userAgent.match(/iPhone/i) || navigator.userAgent.match(/iPod/i) || navigator.userAgent.match(/iPad/i) || navigator.userAgent.match(/SamsungBrowser/i) || navigator.userAgent.match(/Mobile\ VR/i) || navigator.userAgent.match(/Android/i)) {
      return mobile = true;
    }
    return mobile = false;
  }

  // src/primitives.ts
  Mesh.plane = function(options, gl2) {
    options = options || {};
    options.triangles = [];
    const mesh = {};
    const detailX = options.detailX || options.detail || 1;
    const detailY = options.detailY || options.detail || 1;
    let width = options.width || options.size || 1;
    let height = options.height || options.size || 1;
    const xz = options.xz;
    width *= 0.5;
    height *= 0.5;
    const triangles = [];
    const vertices = [];
    const coords = [];
    const normals = [];
    const N = vec3.fromValues(0, 0, 1);
    if (xz) N.set([0, 1, 0]);
    for (let y = 0; y <= detailY; y++) {
      const t = y / detailY;
      for (let x = 0; x <= detailX; x++) {
        const s = x / detailX;
        if (xz) vertices.push((2 * s - 1) * width, 0, -(2 * t - 1) * height);
        else vertices.push((2 * s - 1) * width, (2 * t - 1) * height, 0);
        coords.push(s, t);
        normals.push(N[0], N[1], N[2]);
        if (x < detailX && y < detailY) {
          const i = x + y * (detailX + 1);
          if (xz) {
            triangles.push(i + 1, i + detailX + 1, i);
            triangles.push(i + 1, i + detailX + 2, i + detailX + 1);
          } else {
            triangles.push(i, i + 1, i + detailX + 1);
            triangles.push(i + detailX + 1, i + 1, i + detailX + 2);
          }
        }
      }
    }
    const bounding = BBox.fromCenterHalfsize([0, 0, 0], xz ? [width, 0, height] : [width, height, 0]);
    const mesh_info = { vertices, normals, coords, triangles };
    void mesh;
    return Mesh.load(mesh_info, { bounding }, null, gl2);
  };
  Mesh.plane2D = function(options, gl2) {
    const vertices = new Float32Array([-1, 1, 1, -1, 1, 1, -1, 1, -1, -1, 1, -1]);
    const coords = new Float32Array([0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0]);
    if (options && options.size) {
      const s = options.size * 0.5;
      for (let i = 0; i < vertices.length; ++i) vertices[i] *= s;
    }
    return new Mesh({ vertices2D: vertices, coords }, null, null, gl2);
  };
  Mesh.point = function(options) {
    void options;
    return new Mesh({ vertices: [0, 0, 0] });
  };
  Mesh.cube = function(options, gl2) {
    options = options || {};
    const halfsize = (options.size || 1) * 0.5;
    const buffers = {};
    buffers.vertices = new Float32Array([-1, 1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1, -1, -1, -1, -1, -1, 1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1, 1, -1, 1, -1, 1, 1, -1, -1, -1, 1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1, -1, 1, -1, 1, 1, -1, 1, -1, -1, -1, 1, -1, 1, -1, -1, -1, -1, -1, -1, 1, -1, 1, 1, 1, 1, 1, -1, -1, 1, -1, -1, 1, 1, 1, 1, 1, -1, -1, -1, 1, -1, -1, 1, -1, 1, -1, -1, -1, 1, -1, 1, -1, -1, 1]);
    for (let i = 0, l = buffers.vertices.length; i < l; ++i) buffers.vertices[i] *= halfsize;
    buffers.normals = new Float32Array([-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0]);
    buffers.coords = new Float32Array([0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    if (options.wireframe)
      buffers.wireframe = new Uint16Array([0, 2, 2, 5, 5, 4, 4, 0, 6, 7, 7, 10, 10, 11, 11, 6, 0, 6, 2, 7, 5, 10, 4, 11]);
    options.bounding = BBox.fromCenterHalfsize([0, 0, 0], [halfsize, halfsize, halfsize]);
    return Mesh.load(buffers, options, null, gl2);
  };
  Mesh.box = function(options, gl2) {
    options = options || {};
    let sizex = options.sizex || 1;
    let sizey = options.sizey || 1;
    let sizez = options.sizez || 1;
    sizex *= 0.5;
    sizey *= 0.5;
    sizez *= 0.5;
    const buffers = {};
    buffers.vertices = new Float32Array([-1, 1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1, -1, -1, -1, -1, -1, 1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1, 1, -1, 1, -1, 1, 1, -1, -1, -1, 1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1, -1, 1, -1, 1, 1, -1, 1, -1, -1, -1, 1, -1, 1, -1, -1, -1, -1, -1, -1, 1, -1, 1, 1, 1, 1, 1, -1, -1, 1, -1, -1, 1, 1, 1, 1, 1, -1, -1, -1, 1, -1, -1, 1, -1, 1, -1, -1, -1, 1, -1, 1, -1, -1, 1]);
    for (let i = 0, l = buffers.vertices.length; i < l; i += 3) {
      buffers.vertices[i] *= sizex;
      buffers.vertices[i + 1] *= sizey;
      buffers.vertices[i + 2] *= sizez;
    }
    buffers.normals = new Float32Array([-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0]);
    buffers.coords = new Float32Array([0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    if (options.wireframe)
      buffers.wireframe = new Uint16Array([0, 2, 2, 5, 5, 4, 4, 0, 6, 7, 7, 10, 10, 11, 11, 6, 0, 6, 2, 7, 5, 10, 4, 11]);
    options.bounding = BBox.fromCenterHalfsize([0, 0, 0], [sizex, sizey, sizez]);
    return Mesh.load(buffers, options, null, gl2);
  };
  Mesh.circle = function(options, gl2) {
    options = options || {};
    const size = options.size || options.radius || 1;
    let slices = Math.ceil(options.slices || 24);
    const xz = options.xz || false;
    const empty = options.empty || false;
    if (slices < 3) slices = 3;
    const delta = 2 * Math.PI / slices;
    const center = vec3.create();
    const A = vec3.create();
    const N = vec3.fromValues(0, 0, 1);
    const uv_center = vec2.fromValues(0.5, 0.5);
    const uv = vec2.create();
    if (xz) N.set([0, 1, 0]);
    const index = xz ? 2 : 1;
    let vertices = new Float32Array(3 * (slices + 1));
    let normals = new Float32Array(3 * (slices + 1));
    let coords = new Float32Array(2 * (slices + 1));
    let triangles = null;
    vertices.set(center, 0);
    normals.set(N, 0);
    coords.set(uv_center, 0);
    let sin = 0;
    let cos = 0;
    for (let i = 0; i < slices; ++i) {
      sin = Math.sin(delta * i);
      cos = Math.cos(delta * i);
      A[0] = sin * size;
      A[index] = cos * size;
      uv[0] = sin * 0.5 + 0.5;
      uv[1] = cos * 0.5 + 0.5;
      vertices.set(A, i * 3 + 3);
      normals.set(N, i * 3 + 3);
      coords.set(uv, i * 2 + 2);
    }
    if (empty) {
      vertices = vertices.subarray(3);
      normals = vertices.subarray(3);
      coords = vertices.subarray(2);
      triangles = null;
    } else {
      triangles = new Uint16Array(3 * slices);
      let offset = 2;
      let offset2 = 1;
      if (xz) {
        offset = 1;
        offset2 = 2;
      }
      let i = 0;
      for (i = 0; i < slices - 1; ++i) {
        triangles[i * 3] = 0;
        triangles[i * 3 + 1] = i + offset;
        triangles[i * 3 + 2] = i + offset2;
      }
      triangles[i * 3] = 0;
      if (xz) {
        triangles[i * 3 + 1] = i + 1;
        triangles[i * 3 + 2] = 1;
      } else {
        triangles[i * 3 + 1] = 1;
        triangles[i * 3 + 2] = i + 1;
      }
    }
    options.bounding = BBox.fromCenterHalfsize([0, 0, 0], xz ? [size, 0, size] : [size, size, 0]);
    const buffers = {
      vertices,
      normals,
      coords,
      triangles
    };
    if (options.wireframe) {
      const wireframe = new Uint16Array(slices * 2);
      for (let i = 0; i < slices; i++) {
        wireframe[i * 2] = i;
        wireframe[i * 2 + 1] = i + 1;
      }
      wireframe[0] = slices;
      buffers.wireframe = wireframe;
    }
    return Mesh.load(buffers, options, null, gl2);
  };
  Mesh.ring = function(options, gl2) {
    options = options || {};
    const size = options.size || options.radius || 1;
    const thickness = options.thickness || size * 0.1;
    let slices = Math.ceil(options.slices || 24);
    const xz = options.xz || false;
    const empty = options.empty || false;
    if (slices < 3) slices = 3;
    const delta = 2 * Math.PI / slices;
    const A = vec3.create();
    const B = vec3.create();
    const N = vec3.fromValues(0, 0, 1);
    const uv = vec2.create();
    if (xz) N.set([0, 1, 0]);
    const index = xz ? 2 : 1;
    let vertices = new Float32Array(3 * (slices * 2 + 2));
    let normals = new Float32Array(3 * (slices * 2 + 2));
    let coords = new Float32Array(2 * (slices * 2 + 2));
    let triangles = null;
    let sin = 0;
    let cos = 0;
    for (let i = 0; i <= slices; ++i) {
      sin = Math.sin(delta * i);
      cos = Math.cos(delta * i);
      A[0] = sin * (size - thickness);
      A[index] = cos * (size - thickness);
      uv[0] = i / slices;
      uv[1] = 0;
      vertices.set(A, i * 6);
      normals.set(N, i * 6);
      coords.set(uv, i * 4);
      B[0] = sin * (size + thickness);
      B[index] = cos * (size + thickness);
      uv[1] = 1;
      vertices.set(B, i * 6 + 3);
      normals.set(N, i * 6 + 3);
      coords.set(uv, i * 4 + 2);
    }
    if (empty) {
      vertices = vertices.subarray(3);
      normals = vertices.subarray(3);
      coords = vertices.subarray(2);
      triangles = null;
    } else {
      triangles = new Uint16Array(6 * slices);
      let offset = 2;
      let offset2 = 1;
      if (xz) {
        offset = 1;
        offset2 = 2;
      }
      for (let i = 0; i < slices; ++i) {
        triangles[i * 6] = i * 2;
        triangles[i * 6 + 1] = i * 2 + offset;
        triangles[i * 6 + 2] = i * 2 + offset2;
        triangles[i * 6 + 3] = i * 2 + offset2;
        triangles[i * 6 + 4] = i * 2 + offset;
        triangles[i * 6 + 5] = i * 2 + 3;
      }
    }
    options.bounding = BBox.fromCenterHalfsize(
      [0, 0, 0],
      xz ? [size + thickness, 0, size + thickness] : [size + thickness, size + thickness, 0]
    );
    const buffers = {
      vertices,
      normals,
      coords,
      triangles
    };
    if (options.wireframe) {
      const wireframe = new Uint16Array(slices * 4);
      for (let i = 0; i < slices; i++) {
        wireframe[i * 4] = i * 2;
        wireframe[i * 4 + 1] = i * 2 + 2;
        wireframe[i * 4 + 2] = i * 2 + 1;
        wireframe[i * 4 + 3] = i * 2 + 3;
      }
      buffers.wireframe = wireframe;
    }
    return Mesh.load(buffers, options, null, gl2);
  };
  Mesh.cylinder = function(options, gl2) {
    options = options || {};
    const radius = options.radius || options.size || 1;
    const height = options.height || options.size || 2;
    const subdivisions = options.subdivisions || 64;
    let vertices = new Float32Array(subdivisions * 6 * 3 * 2);
    let normals = new Float32Array(subdivisions * 6 * 3 * 2);
    let coords = new Float32Array(subdivisions * 6 * 2 * 2);
    const delta = 2 * Math.PI / subdivisions;
    let normal;
    let i = 0;
    for (i = 0; i < subdivisions; ++i) {
      const angle = i * delta;
      normal = [Math.sin(angle), 0, Math.cos(angle)];
      vertices.set([normal[0] * radius, height * 0.5, normal[2] * radius], i * 6 * 3);
      normals.set(normal, i * 6 * 3);
      coords.set([i / subdivisions, 1], i * 6 * 2);
      normal = [Math.sin(angle), 0, Math.cos(angle)];
      vertices.set([normal[0] * radius, height * -0.5, normal[2] * radius], i * 6 * 3 + 3);
      normals.set(normal, i * 6 * 3 + 3);
      coords.set([i / subdivisions, 0], i * 6 * 2 + 2);
      normal = [Math.sin(angle + delta), 0, Math.cos(angle + delta)];
      vertices.set([normal[0] * radius, height * -0.5, normal[2] * radius], i * 6 * 3 + 6);
      normals.set(normal, i * 6 * 3 + 6);
      coords.set([(i + 1) / subdivisions, 0], i * 6 * 2 + 4);
      normal = [Math.sin(angle + delta), 0, Math.cos(angle + delta)];
      vertices.set([normal[0] * radius, height * 0.5, normal[2] * radius], i * 6 * 3 + 9);
      normals.set(normal, i * 6 * 3 + 9);
      coords.set([(i + 1) / subdivisions, 1], i * 6 * 2 + 6);
      normal = [Math.sin(angle), 0, Math.cos(angle)];
      vertices.set([normal[0] * radius, height * 0.5, normal[2] * radius], i * 6 * 3 + 12);
      normals.set(normal, i * 6 * 3 + 12);
      coords.set([i / subdivisions, 1], i * 6 * 2 + 8);
      normal = [Math.sin(angle + delta), 0, Math.cos(angle + delta)];
      vertices.set([normal[0] * radius, height * -0.5, normal[2] * radius], i * 6 * 3 + 15);
      normals.set(normal, i * 6 * 3 + 15);
      coords.set([(i + 1) / subdivisions, 0], i * 6 * 2 + 10);
    }
    const pos = i * 6 * 3;
    const pos_uv = i * 6 * 2;
    const caps_start = pos;
    if (options.caps === false) {
      vertices = vertices.subarray(0, pos);
      normals = normals.subarray(0, pos);
      coords = coords.subarray(0, pos_uv);
    } else {
      const top_center = vec3.fromValues(0, height * 0.5, 0);
      const bottom_center = vec3.fromValues(0, height * -0.5, 0);
      const up = vec3.fromValues(0, 1, 0);
      const down = vec3.fromValues(0, -1, 0);
      for (let j = 0; j < subdivisions; ++j) {
        const angle = j * delta;
        const uv = vec3.fromValues(Math.sin(angle), 0, Math.cos(angle));
        const uv2 = vec3.fromValues(Math.sin(angle + delta), 0, Math.cos(angle + delta));
        vertices.set([uv[0] * radius, height * 0.5, uv[2] * radius], pos + j * 6 * 3);
        normals.set(up, pos + j * 6 * 3);
        coords.set([-uv[0] * 0.5 + 0.5, uv[2] * 0.5 + 0.5], pos_uv + j * 6 * 2);
        vertices.set([uv2[0] * radius, height * 0.5, uv2[2] * radius], pos + j * 6 * 3 + 3);
        normals.set(up, pos + j * 6 * 3 + 3);
        coords.set([-uv2[0] * 0.5 + 0.5, uv2[2] * 0.5 + 0.5], pos_uv + j * 6 * 2 + 2);
        vertices.set(top_center, pos + j * 6 * 3 + 6);
        normals.set(up, pos + j * 6 * 3 + 6);
        coords.set([0.5, 0.5], pos_uv + j * 6 * 2 + 4);
        vertices.set([uv2[0] * radius, height * -0.5, uv2[2] * radius], pos + j * 6 * 3 + 9);
        normals.set(down, pos + j * 6 * 3 + 9);
        coords.set([uv2[0] * 0.5 + 0.5, uv2[2] * 0.5 + 0.5], pos_uv + j * 6 * 2 + 6);
        vertices.set([uv[0] * radius, height * -0.5, uv[2] * radius], pos + j * 6 * 3 + 12);
        normals.set(down, pos + j * 6 * 3 + 12);
        coords.set([uv[0] * 0.5 + 0.5, uv[2] * 0.5 + 0.5], pos_uv + j * 6 * 2 + 8);
        vertices.set(bottom_center, pos + j * 6 * 3 + 15);
        normals.set(down, pos + j * 6 * 3 + 15);
        coords.set([0.5, 0.5], pos_uv + j * 6 * 2 + 10);
      }
    }
    const buffers = {
      vertices,
      normals,
      coords
    };
    options.bounding = BBox.fromCenterHalfsize([0, 0, 0], [radius, height * 0.5, radius]);
    options.info = { groups: [] };
    if (options.caps !== false) {
      options.info.groups.push({ name: "side", start: 0, length: caps_start / 3 });
      options.info.groups.push({ name: "caps", start: caps_start / 3, length: (vertices.length - caps_start) / 3 });
    }
    return Mesh.load(buffers, options, null, gl2);
  };
  Mesh.cone = function(options, gl2) {
    options = options || {};
    const radius = options.radius || options.size || 1;
    const height = options.height || options.size || 2;
    const subdivisions = options.subdivisions || 64;
    const vertices = new Float32Array(subdivisions * 3 * 3 * 2);
    const normals = new Float32Array(subdivisions * 3 * 3 * 2);
    const coords = new Float32Array(subdivisions * 2 * 3 * 2);
    const delta = 2 * Math.PI / subdivisions;
    let normal;
    const normal_y = radius / height;
    const up = [0, 1, 0];
    void up;
    for (let i = 0; i < subdivisions; ++i) {
      const angle = i * delta;
      normal = [Math.sin(angle + delta * 0.5), normal_y, Math.cos(angle + delta * 0.5)];
      vec3.normalize(normal, normal);
      vertices.set([0, height, 0], i * 6 * 3);
      normals.set(normal, i * 6 * 3);
      coords.set([i / subdivisions, 1], i * 6 * 2);
      normal = [Math.sin(angle), normal_y, Math.cos(angle)];
      vertices.set([normal[0] * radius, 0, normal[2] * radius], i * 6 * 3 + 3);
      vec3.normalize(normal, normal);
      normals.set(normal, i * 6 * 3 + 3);
      coords.set([i / subdivisions, 0], i * 6 * 2 + 2);
      normal = [Math.sin(angle + delta), normal_y, Math.cos(angle + delta)];
      vertices.set([normal[0] * radius, 0, normal[2] * radius], i * 6 * 3 + 6);
      vec3.normalize(normal, normal);
      normals.set(normal, i * 6 * 3 + 6);
      coords.set([(i + 1) / subdivisions, 0], i * 6 * 2 + 4);
    }
    const pos = 0;
    const pos_uv = 0;
    const bottom_center = vec3.fromValues(0, 0, 0);
    const down = vec3.fromValues(0, -1, 0);
    for (let i = 0; i < subdivisions; ++i) {
      const angle = i * delta;
      const uv = vec3.fromValues(Math.sin(angle), 0, Math.cos(angle));
      const uv2 = vec3.fromValues(Math.sin(angle + delta), 0, Math.cos(angle + delta));
      vertices.set([uv2[0] * radius, 0, uv2[2] * radius], pos + i * 6 * 3 + 9);
      normals.set(down, pos + i * 6 * 3 + 9);
      coords.set([uv2[0] * 0.5 + 0.5, uv2[2] * 0.5 + 0.5], pos_uv + i * 6 * 2 + 6);
      vertices.set([uv[0] * radius, 0, uv[2] * radius], pos + i * 6 * 3 + 12);
      normals.set(down, pos + i * 6 * 3 + 12);
      coords.set([uv[0] * 0.5 + 0.5, uv[2] * 0.5 + 0.5], pos_uv + i * 6 * 2 + 8);
      vertices.set(bottom_center, pos + i * 6 * 3 + 15);
      normals.set(down, pos + i * 6 * 3 + 15);
      coords.set([0.5, 0.5], pos_uv + i * 6 * 2 + 10);
    }
    const buffers = {
      vertices,
      normals,
      coords
    };
    options.bounding = BBox.fromCenterHalfsize([0, height * 0.5, 0], [radius, height * 0.5, radius]);
    return Mesh.load(buffers, options, null, gl2);
  };
  Mesh.torus = function(options, gl2) {
    options = options || {};
    const outerradius = options.outerradius || options.radius || 1;
    const outerslices = Math.ceil(options.outerslices || options.slices || 24);
    const innerradius = options.innerradius || outerradius * 0.1;
    const innerslices = Math.ceil(options.innerslices || outerslices);
    const angle = options.angle || Math.PI * 2;
    const innerdelta = Math.PI * 2 / innerslices;
    const outerdelta = angle / outerslices;
    const xz = false;
    const index = xz ? 2 : 1;
    const A = vec3.create();
    const N = vec3.fromValues(0, 0, 1);
    const uv = vec2.create();
    const close = angle == Math.PI * 2;
    const cvertices = new Float32Array(3 * innerslices);
    const cnormals = new Float32Array(3 * innerslices);
    let sin = 0;
    let cos = 0;
    for (let i = 0; i < innerslices; ++i) {
      sin = Math.sin(innerdelta * i);
      cos = Math.cos(innerdelta * i);
      A[0] = sin * innerradius;
      A[index] = cos * innerradius;
      uv[0] = sin * 0.5 + 0.5;
      uv[1] = cos * 0.5 + 0.5;
      cvertices.set(A, i * 3);
      vec3.normalize(N, A);
      cnormals.set(N, i * 3);
    }
    const vertices = new Float32Array(3 * outerslices * innerslices);
    const normals = new Float32Array(3 * outerslices * innerslices);
    const coords = new Float32Array(2 * outerslices * innerslices);
    const M = mat4.create();
    const offset = vec3.fromValues(-outerradius, 0, 0);
    const axis = vec3.fromValues(0, 1, 0);
    const triangles = [];
    for (let i = 0; i < outerslices; ++i) {
      mat4.identity(M);
      mat4.rotate(M, M, i * outerdelta, axis);
      mat4.translate(M, M, offset);
      const bindex = i * innerslices;
      let next = innerslices;
      if (i >= outerslices - 1) {
        next = (outerslices - 1) * -innerslices;
        if (!close) next = 0;
      }
      for (let j = 0; j < innerslices; ++j) {
        const cv = cvertices.subarray(j * 3, j * 3 + 3);
        const cn = cnormals.subarray(j * 3, j * 3 + 3);
        mat4.multiplyVec3(A, M, cv);
        mat4.rotateVec3(N, M, cn);
        vertices.set(A, j * 3 + i * 3 * innerslices);
        normals.set(N, j * 3 + i * 3 * innerslices);
        coords.set([i / outerslices, j / innerslices], j * 2 + i * 2 * innerslices);
        const a = bindex + j;
        const b = bindex + (j + 1) % innerslices;
        triangles.push(b, a, a + next, b, a + next, b + next);
      }
    }
    const size = innerradius + outerradius;
    options.bounding = BBox.fromCenterHalfsize(
      [0, 0, 0],
      xz ? [size, innerradius, size] : [size, size, innerradius]
    );
    const buffers = {
      vertices,
      normals,
      coords,
      triangles
    };
    return Mesh.load(buffers, options, null, gl2);
  };
  Mesh.sphere = function(options, gl2) {
    options = options || {};
    const radius = options.radius || options.size || 1;
    const latitudeBands = options.lat || options.subdivisions || 16;
    const longitudeBands = options["long"] || options.subdivisions || 16;
    const vertexPositionData = new Float32Array((latitudeBands + 1) * (longitudeBands + 1) * 3);
    const normalData = new Float32Array((latitudeBands + 1) * (longitudeBands + 1) * 3);
    const textureCoordData = new Float32Array((latitudeBands + 1) * (longitudeBands + 1) * 2);
    const indexData = new Uint16Array(latitudeBands * longitudeBands * 6);
    const latRange = options.hemi ? Math.PI * 0.5 : Math.PI;
    let i = 0, iuv = 0;
    for (let latNumber = 0; latNumber <= latitudeBands; latNumber++) {
      const theta = latNumber * latRange / latitudeBands;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);
      for (let longNumber = 0; longNumber <= longitudeBands; longNumber++) {
        const phi = longNumber * 2 * Math.PI / longitudeBands;
        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);
        const x = cosPhi * sinTheta;
        const y = cosTheta;
        const z = sinPhi * sinTheta;
        const u = 1 - longNumber / longitudeBands;
        const v = 1 - latNumber / latitudeBands;
        vertexPositionData.set([radius * x, radius * y, radius * z], i);
        normalData.set([x, y, z], i);
        textureCoordData.set([u, v], iuv);
        i += 3;
        iuv += 2;
      }
    }
    i = 0;
    for (let latNumber = 0; latNumber < latitudeBands; latNumber++) {
      for (let longNumber = 0; longNumber < longitudeBands; longNumber++) {
        const first = latNumber * (longitudeBands + 1) + longNumber;
        const second = first + longitudeBands + 1;
        indexData.set([second, first, first + 1], i);
        indexData.set([second + 1, second, first + 1], i + 3);
        i += 6;
      }
    }
    const buffers = {
      vertices: vertexPositionData,
      normals: normalData,
      coords: textureCoordData,
      triangles: indexData
    };
    if (options.wireframe) {
      const wireframe = new Uint16Array(longitudeBands * latitudeBands * 4);
      let pos = 0;
      let wi = 0, wj = 0;
      for (wi = 0; wi < latitudeBands; wi++) {
        for (wj = 0; wj < longitudeBands; wj++) {
          wireframe[pos] = wi * (longitudeBands + 1) + wj;
          wireframe[pos + 1] = wi * (longitudeBands + 1) + wj + 1;
          pos += 2;
        }
        wireframe[pos - longitudeBands * 2] = wi * (longitudeBands + 1) + wj;
      }
      for (wi = 0; wi < longitudeBands; wi++)
        for (wj = 0; wj < latitudeBands; wj++) {
          wireframe[pos] = wj * (longitudeBands + 1) + wi;
          wireframe[pos + 1] = (wj + 1) * (longitudeBands + 1) + wi;
          pos += 2;
        }
      buffers.wireframe = wireframe;
    }
    if (options.hemi) options.bounding = BBox.fromCenterHalfsize([0, radius * 0.5, 0], [radius, radius * 0.5, radius]);
    else options.bounding = BBox.fromCenterHalfsize([0, 0, 0], [radius, radius, radius]);
    return Mesh.load(buffers, options, null, gl2);
  };
  Mesh.grid = function(options, gl2) {
    options = options || {};
    let num_lines = options.lines || 11;
    if (num_lines < 0) num_lines = 1;
    const size = options.size || 10;
    const vertexPositionData = new Float32Array(num_lines * 2 * 2 * 3);
    const hsize = size * 0.5;
    let pos = 0;
    let x = -hsize;
    const delta = size / (num_lines - 1);
    for (let i = 0; i < num_lines; i++) {
      vertexPositionData[pos] = x;
      vertexPositionData[pos + 2] = -hsize;
      vertexPositionData[pos + 3] = x;
      vertexPositionData[pos + 5] = hsize;
      vertexPositionData[pos + 6] = hsize;
      vertexPositionData[pos + 8] = x;
      vertexPositionData[pos + 9] = -hsize;
      vertexPositionData[pos + 11] = x;
      x += delta;
      pos += 12;
    }
    return new Mesh({ vertices: vertexPositionData }, null, options, gl2);
  };
  Mesh.icosahedron = function(options, gl2) {
    options = options || {};
    const radius = options.radius || options.size || 1;
    let subdivisions = options.subdivisions === void 0 ? 0 : options.subdivisions;
    if (subdivisions > 6)
      subdivisions = 6;
    const t = (1 + Math.sqrt(5)) / 2;
    const vertices = [
      -1,
      t,
      0,
      1,
      t,
      0,
      -1,
      -t,
      0,
      1,
      -t,
      0,
      0,
      -1,
      t,
      0,
      1,
      t,
      0,
      -1,
      -t,
      0,
      1,
      -t,
      t,
      0,
      -1,
      t,
      0,
      1,
      -t,
      0,
      -1,
      -t,
      0,
      1
    ];
    const normals = [];
    const coords = [];
    let indices = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
    const l = vertices.length;
    for (let i = 0; i < l; i += 3) {
      const mod = Math.sqrt(vertices[i] * vertices[i] + vertices[i + 1] * vertices[i + 1] + vertices[i + 2] * vertices[i + 2]);
      const normalx = vertices[i] / mod;
      const normaly = vertices[i + 1] / mod;
      const normalz = vertices[i + 2] / mod;
      normals.push(normalx, normaly, normalz);
      coords.push(Math.atan2(normalx, normalz), Math.acos(normaly));
      vertices[i] *= radius / mod;
      vertices[i + 1] *= radius / mod;
      vertices[i + 2] *= radius / mod;
    }
    const middles = {};
    function middlePoint(A, B) {
      const key = indices[A] < indices[B] ? indices[A] + ":" + indices[B] : indices[B] + ":" + indices[A];
      const r = middles[key];
      if (r) return r;
      const index = vertices.length / 3;
      vertices.push(
        (vertices[indices[A] * 3] + vertices[indices[B] * 3]) * 0.5,
        (vertices[indices[A] * 3 + 1] + vertices[indices[B] * 3 + 1]) * 0.5,
        (vertices[indices[A] * 3 + 2] + vertices[indices[B] * 3 + 2]) * 0.5
      );
      const mod = Math.sqrt(
        vertices[index * 3] * vertices[index * 3] + vertices[index * 3 + 1] * vertices[index * 3 + 1] + vertices[index * 3 + 2] * vertices[index * 3 + 2]
      );
      const normalx = vertices[index * 3] / mod;
      const normaly = vertices[index * 3 + 1] / mod;
      const normalz = vertices[index * 3 + 2] / mod;
      normals.push(normalx, normaly, normalz);
      coords.push(Math.atan2(normalx, normalz) / Math.PI * 0.5, Math.acos(normaly) / Math.PI);
      vertices[index * 3] *= radius / mod;
      vertices[index * 3 + 1] *= radius / mod;
      vertices[index * 3 + 2] *= radius / mod;
      middles[key] = index;
      return index;
    }
    for (let iR = 0; iR < subdivisions; ++iR) {
      const new_indices = [];
      const li = indices.length;
      for (let i = 0; i < li; i += 3) {
        const MA = middlePoint(i, i + 1);
        const MB = middlePoint(i + 1, i + 2);
        const MC = middlePoint(i + 2, i);
        new_indices.push(indices[i], MA, MC);
        new_indices.push(indices[i + 1], MB, MA);
        new_indices.push(indices[i + 2], MC, MB);
        new_indices.push(MA, MB, MC);
      }
      indices = new_indices;
    }
    options.bounding = BBox.fromCenterHalfsize([0, 0, 0], [radius, radius, radius]);
    return Mesh.load({ vertices, coords, normals, triangles: indices }, options, null, gl2);
  };
  Mesh.shape = function(line, options, gl2) {
    options = options || {};
    if (typeof earcut === "undefined")
      throw "To use GL.Mesh.shape you must download and include earcut.js (do not link it directly!): https://raw.githubusercontent.com/mapbox/earcut/master/src/earcut.js";
    if (!line || !line.length || line.length % 2 == 1)
      throw "GL.Mesh.shape line missing, must be an array of 2D vertices";
    const ext = options.extrude || 0;
    let poly;
    if (line[0].constructor === Array)
      poly = earcut.flatten(line);
    else poly = line;
    const triangulation = earcut(poly).reverse();
    console.log(triangulation);
    const vertices = [];
    const normals = [];
    const uvs = [];
    const minmaxX = [poly[0], poly[1]];
    const minmaxY = [poly[0], poly[1]];
    for (let i = 0; i < poly.length; i += 2) {
      minmaxX[0] = Math.min(minmaxX[0], poly[i]);
      minmaxX[1] = Math.max(minmaxX[1], poly[i]);
      minmaxY[0] = Math.min(minmaxY[0], poly[i + 1]);
      minmaxY[1] = Math.max(minmaxY[1], poly[i + 1]);
    }
    const rangeX = minmaxX[1] - minmaxX[0];
    const rangeY = minmaxY[1] - minmaxY[0];
    const groups = [];
    let indices = [];
    if (ext) {
      indices = [];
      const N = vec3.create();
      const num = poly.length;
      for (let i = 0; i < poly.length; i += 2) {
        const x = poly[i];
        const y = poly[i + 1];
        const x2 = poly[(i + 2) % num];
        const y2 = poly[(i + 3) % num];
        const A = vertices.length / 3;
        vertices.push(x, ext * 0.5, y);
        vertices.push(x, ext * -0.5, y);
        vertices.push(x2, ext * 0.5, y2);
        vertices.push(x2, ext * -0.5, y2);
        vec3.normalize(N, vec3.cross(N, [0, 1, 0], [x2 - x, 0, y2 - y]));
        normals.push(N[0], N[1], N[2], N[0], N[1], N[2], N[0], N[1], N[2], N[0], N[1], N[2]);
        const u = (x - minmaxX[0]) / rangeX;
        const v = (y - minmaxY[0]) / rangeY;
        const u2 = (x2 - minmaxX[0]) / rangeX;
        const v2 = (y2 - minmaxY[0]) / rangeY;
        uvs.push(u, v, u, v, u2, v2, u2, v2);
        indices.push(A, A + 2, A + 1, A + 2, A + 3, A + 1);
      }
      groups.push({ name: "side", start: 0, length: indices.length });
      const offset = vertices.length / 3;
      const start = indices.length;
      for (let i = 0; i < poly.length; i += 2) {
        const x = poly[i];
        const y = poly[i + 1];
        const u = (x - minmaxX[0]) / rangeX;
        const v = (y - minmaxY[0]) / rangeY;
        vertices.push(x, ext * 0.5, y);
        vertices.push(x, ext * -0.5, y);
        normals.push(0, 1, 0, 0, -1, 0);
        uvs.push(u, v, u, v);
      }
      for (let i = 0; i < triangulation.length; i += 3) {
        indices.push(offset + triangulation[i] * 2, offset + triangulation[i + 1] * 2, offset + triangulation[i + 2] * 2);
        indices.push(
          offset + triangulation[i] * 2 + 1,
          offset + triangulation[i + 2] * 2 + 1,
          offset + triangulation[i + 1] * 2 + 1
        );
      }
      groups.push({ name: "caps", start, length: indices.length });
      options.bounding = BBox.fromCenterHalfsize(
        [(minmaxX[0] + minmaxX[1]) * 0.5, 0, (minmaxY[0] + minmaxY[1]) * 0.5],
        [rangeX * 0.5, ext * 0.5, rangeY * 0.5]
      );
    } else {
      for (let i = 0; i < poly.length; i += 2) {
        vertices.push(poly[i], 0, poly[i + 1]);
        normals.push(0, 1, 0);
        uvs.push((poly[i] - minmaxX[0]) / rangeX, (poly[i + 1] - minmaxY[0]) / rangeY);
      }
      indices = triangulation;
      groups.push({ name: "side", start: 0, length: indices.length });
      options.bounding = BBox.fromCenterHalfsize(
        [(minmaxX[0] + minmaxX[1]) * 0.5, 0, (minmaxY[0] + minmaxY[1]) * 0.5],
        [rangeX * 0.5, 0, rangeY * 0.5]
      );
    }
    if (options.xy) {
      for (let i = 0; i < vertices.length; i += 3) {
        swap(vertices, i);
        swap(normals, i);
      }
      if (ext)
        options.bounding = BBox.fromCenterHalfsize(
          [(minmaxX[0] + minmaxX[1]) * 0.5, (minmaxY[0] + minmaxY[1]) * 0.5, 0],
          [rangeX * 0.5, rangeY * 0.5, ext * 0.5]
        );
      else
        options.bounding = BBox.fromCenterHalfsize(
          [(minmaxX[0] + minmaxX[1]) * 0.5, (minmaxY[0] + minmaxY[1]) * 0.5, 0],
          [rangeX * 0.5, rangeY * 0.5, 0]
        );
    }
    options.info = { groups };
    return Mesh.load({ vertices, coords: uvs, normals, triangles: indices }, options, null, gl2);
    function swap(v, pos) {
      const tmp = v[pos + 1];
      v[pos + 1] = v[pos + 2];
      v[pos + 2] = -tmp;
    }
  };

  // src/parsers.ts
  function parseOBJ(text, options) {
    options = options || {};
    const MATNAME_EXTENSION = options.matextension || "";
    const support_uint = true;
    const vertices = [];
    const normals = [];
    const uvs = [];
    const vertices_buffer_data = [];
    const normals_buffer_data = [];
    const uvs_buffer_data = [];
    let group_id = 0;
    let groups = [];
    let current_group_materials = {};
    let last_group_name = null;
    const materials_found = {};
    let mtllib = null;
    let group = createGroup();
    const indices_map = /* @__PURE__ */ new Map();
    let next_index = 0;
    let s = 1;
    if (options.scale) s = options.scale;
    const V_CODE = 1;
    const VT_CODE = 2;
    const VN_CODE = 3;
    const F_CODE = 4;
    const G_CODE = 5;
    const O_CODE = 6;
    const USEMTL_CODE = 7;
    const MTLLIB_CODE = 8;
    const codes = {
      v: V_CODE,
      vt: VT_CODE,
      vn: VN_CODE,
      f: F_CODE,
      g: G_CODE,
      o: O_CODE,
      usemtl: USEMTL_CODE,
      mtllib: MTLLIB_CODE
    };
    let x = 0, y = 0, z = 0;
    const lines = text.split("\n");
    const length = lines.length;
    for (let lineIndex = 0; lineIndex < length; ++lineIndex) {
      let line = lines[lineIndex];
      line = line.replace(/[ \t]+/g, " ").replace(/\s\s*$/, "");
      if (line[line.length - 1] == "\\") {
        lineIndex += 1;
        const next_line = lines[lineIndex].replace(/[ \t]+/g, " ").replace(/\s\s*$/, "");
        line = (line.substr(0, line.length - 1) + next_line).replace(/[ \t]+/g, " ").replace(/\s\s*$/, "");
      }
      if (line[0] == "#") continue;
      if (line == "") continue;
      const tokens = line.split(" ");
      const code = codes[tokens[0]];
      if (code <= VN_CODE) {
        x = parseFloat(tokens[1]);
        y = parseFloat(tokens[2]);
        if (code != VT_CODE)
          z = parseFloat(tokens[3]);
      }
      switch (code) {
        case V_CODE:
          x *= s;
          y *= s;
          z *= s;
          vertices.push(x, y, z);
          break;
        case VT_CODE:
          uvs.push(x, y);
          break;
        case VN_CODE:
          normals.push(x, y, z);
          break;
        case F_CODE: {
          if (tokens.length < 4) continue;
          const polygon_indices = [];
          for (let i = 1; i < tokens.length; ++i) polygon_indices.push(getIndex(tokens[i]));
          group.indices.push(polygon_indices[0], polygon_indices[1], polygon_indices[2]);
          for (let i = 2; i < polygon_indices.length - 1; ++i)
            group.indices.push(polygon_indices[0], polygon_indices[i], polygon_indices[i + 1]);
          break;
        }
        case G_CODE:
        case O_CODE: {
          const name = tokens[1];
          last_group_name = name;
          if (!group.name) group.name = name;
          else {
            current_group_materials = {};
            group = createGroup(name);
          }
          break;
        }
        case USEMTL_CODE:
          changeMaterial(tokens[1]);
          break;
        case MTLLIB_CODE:
          mtllib = tokens[1];
          break;
        default:
      }
    }
    let indices = [];
    let group_index = 0;
    const final_groups = [];
    for (let i = 0; i < groups.length; ++i) {
      const g = groups[i];
      if (!g.indices) continue;
      g.start = group_index;
      g.length = g.indices.length;
      indices = indices.concat(g.indices);
      delete g.indices;
      group_index += g.length;
      final_groups.push(g);
    }
    groups = final_groups;
    const mesh = {};
    if (!vertices.length) {
      console.error("mesh without vertices");
      return null;
    }
    if (options.flip_normals && normals_buffer_data.length) {
      const nrm = normals_buffer_data;
      for (let i = 0; i < nrm.length; ++i) nrm[i] *= -1;
    }
    mesh.vertices = new Float32Array(vertices_buffer_data);
    if (normals_buffer_data.length) mesh.normals = new Float32Array(normals_buffer_data);
    if (uvs_buffer_data.length) mesh.coords = new Float32Array(uvs_buffer_data);
    if (indices && indices.length > 0)
      mesh.triangles = new (support_uint && group_index > 256 * 256 ? Uint32Array : Uint16Array)(
        indices
      );
    mesh.bounding = Mesh.computeBoundingBox(mesh.vertices);
    const info = {};
    if (groups.length > 1) {
      info.groups = groups;
    }
    mesh.info = info;
    if (!mesh.bounding) {
      console.log("empty mesh");
      return null;
    }
    if (options.only_data) return mesh;
    let final_mesh = null;
    final_mesh = Mesh.load(mesh, null, options.mesh);
    return final_mesh;
    function getIndex(str) {
      let pos, tex, nor;
      let f;
      let has_negative = false;
      if (str.indexOf("-") == -1) {
        const index = indices_map.get(str);
        if (index !== void 0) return index;
      } else has_negative = true;
      if (!f)
        f = str.split("/");
      if (f.length == 1) {
        pos = parseInt(f[0]);
        tex = pos;
        nor = pos;
      } else if (f.length == 2) {
        pos = parseInt(f[0]);
        tex = parseInt(f[1]);
        nor = pos;
      } else if (f.length == 3) {
        pos = parseInt(f[0]);
        tex = parseInt(f[1]);
        nor = parseInt(f[2]);
      } else {
        console.log("Problem parsing: unknown number of values per face");
        return -1;
      }
      if (pos < 0) pos = vertices.length / 3 + pos + 1;
      if (nor < 0) nor = normals.length / 2 + nor + 1;
      if (tex < 0) tex = uvs.length / 2 + tex + 1;
      if (has_negative) {
        str = pos + "/" + tex + "/" + nor;
        const found = indices_map.get(str);
        if (found !== void 0) return found;
      }
      pos -= 1;
      tex -= 1;
      nor -= 1;
      vertices_buffer_data.push(vertices[pos * 3 + 0], vertices[pos * 3 + 1], vertices[pos * 3 + 2]);
      if (uvs.length) uvs_buffer_data.push(uvs[tex * 2 + 0], uvs[tex * 2 + 1]);
      if (normals.length) normals_buffer_data.push(normals[nor * 3 + 0], normals[nor * 3 + 1], normals[nor * 3 + 2]);
      const new_index = next_index;
      indices_map.set(str, new_index);
      ++next_index;
      return new_index;
    }
    function createGroup(name) {
      const g = {
        name: name || "",
        material: "",
        start: -1,
        length: -1,
        indices: []
      };
      groups.push(g);
      return g;
    }
    function changeMaterial(material_name) {
      if (!group.material) {
        group.material = material_name + MATNAME_EXTENSION;
        current_group_materials[material_name] = group;
        return group;
      }
      let g = current_group_materials[material_name];
      if (!g) {
        g = createGroup(String(last_group_name) + "_" + material_name);
        g.material = material_name + MATNAME_EXTENSION;
        current_group_materials[material_name] = g;
      }
      group = g;
      return g;
    }
  }
  Mesh.parseOBJ = parseOBJ;
  Mesh.parsers["obj"] = parseOBJ;
  Mesh.encoders["obj"] = function(mesh, _options) {
    const verticesBuffer = mesh.getBuffer("vertices");
    if (!verticesBuffer) return null;
    const lines = [];
    lines.push("# Generated with liteGL.js by Javi Agenjo\n");
    const vertices = verticesBuffer.data;
    for (let i = 0; i < vertices.length; i += 3)
      lines.push("v " + vertices[i].toFixed(4) + " " + vertices[i + 1].toFixed(4) + " " + vertices[i + 2].toFixed(4));
    const normalsBuffer = mesh.getBuffer("normals");
    if (normalsBuffer) {
      lines.push("");
      const normals = normalsBuffer.data;
      for (let i = 0; i < normals.length; i += 3)
        lines.push("vn " + normals[i].toFixed(4) + " " + normals[i + 1].toFixed(4) + " " + normals[i + 2].toFixed(4));
    }
    const coordsBuffer = mesh.getBuffer("coords");
    if (coordsBuffer) {
      lines.push("");
      const coords = coordsBuffer.data;
      for (let i = 0; i < coords.length; i += 2)
        lines.push("vt " + coords[i].toFixed(4) + " " + coords[i + 1].toFixed(4) + "  0.0000");
    }
    let groups = mesh.info.groups;
    const indicesBuffer = mesh.getIndexBuffer("triangles");
    if (indicesBuffer) {
      const indices = indicesBuffer.data;
      if (!groups || !groups.length) groups = [{ start: 0, length: indices.length, name: "mesh" }];
      for (let j = 0; j < groups.length; ++j) {
        const group = groups[j];
        lines.push("g " + group.name);
        let matname = group.material || "mat_" + j;
        if (matname.indexOf(".json") != -1)
          matname = matname.substr(0, matname.indexOf(".json"));
        lines.push("usemtl " + matname);
        const start = group.start;
        const end = start + group.length;
        for (let i = start; i < end; i += 3)
          lines.push(
            "f " + (indices[i] + 1) + "/" + (indices[i] + 1) + "/" + (indices[i] + 1) + " " + (indices[i + 1] + 1) + "/" + (indices[i + 1] + 1) + "/" + (indices[i + 1] + 1) + " " + (indices[i + 2] + 1) + "/" + (indices[i + 2] + 1) + "/" + (indices[i + 2] + 1)
          );
      }
    } else {
      if (!groups || !groups.length) groups = [{ start: 0, length: vertices.length / 3, name: "mesh" }];
      for (let j = 0; j < groups.length; ++j) {
        const group = groups[j];
        lines.push("g " + group.name);
        lines.push("usemtl " + (group.material || "mat_" + j));
        const start = group.start;
        const end = start + group.length;
        for (let i = start; i < end; i += 3)
          lines.push(
            "f " + (i + 1) + "/" + (i + 1) + "/" + (i + 1) + " " + (i + 2) + "/" + (i + 2) + "/" + (i + 2) + " " + (i + 3) + "/" + (i + 3) + "/" + (i + 3)
          );
      }
    }
    return lines.join("\n");
  };
  function parseMesh(text, options) {
    const opts = options || {};
    const mesh = {};
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; ++i) {
      const line = lines[i];
      const type = line[0];
      const t = line.substr(1).split(",");
      const name = t[0];
      if (type == "-") {
        let factor = 1;
        let datatype = Float32Array;
        if (name == "weights" || name == "bone_indices") datatype = Uint8Array;
        if (name == "weights") factor = 255;
        const data = new datatype(Number(t[1]));
        for (let j = 0; j < data.length; ++j) data[j] = Number(t[j + 2]) * factor;
        mesh[name] = data;
      } else if (type == "*") {
        let datatype = Uint16Array;
        if (Number(t[1]) > 256 * 256) datatype = Uint32Array;
        const data = new datatype(Number(t[1]));
        for (let j = 0; j < data.length; ++j) data[j] = Number(t[j + 2]);
        mesh[name] = data;
      } else if (type == "@") {
        if (name == "bones") {
          const bones = [];
          const num_bones = Number(t[1]);
          for (let j = 0; j < num_bones; ++j) {
            const m = t.slice(3 + j * 17, 3 + (j + 1) * 17 - 1).map(Number);
            bones.push([t[2 + j * 17], m]);
          }
          mesh.bones = bones;
        } else if (name == "bind_matrix") mesh.bind_matrix = t.slice(1, 17).map(Number);
        else if (name == "groups") {
          const meshInfo = { groups: [] };
          mesh.info = meshInfo;
          const num_groups = Number(t[1]);
          for (let j = 0; j < num_groups; ++j) {
            const group = {
              name: t[2 + j * 4],
              material: t[2 + j * 4 + 1],
              start: Number(t[2 + j * 4 + 2]),
              length: Number(t[2 + j * 4 + 3])
            };
            meshInfo.groups.push(group);
          }
        }
      } else console.warn("type unknown: " + t[0]);
    }
    if (opts.only_data) return mesh;
    let final_mesh = null;
    final_mesh = Mesh.load(mesh, null, opts.mesh);
    final_mesh.updateBoundingBox();
    return final_mesh;
  }
  Mesh.parsers["mesh"] = parseMesh;
  Mesh.encoders["mesh"] = function(mesh, _options) {
    const lines = [];
    for (const i in mesh.vertexBuffers) {
      const buffer = mesh.vertexBuffers[i];
      const buffer_data = typedArrayToArray(buffer.data);
      if (buffer.normalize && buffer.data.constructor == Uint8Array) {
        for (let j = 0; j < buffer_data.length; ++j) buffer_data[j] /= 255;
      }
      const line = ["-" + i, buffer.data.length, buffer.data, buffer_data];
      lines.push(line.join(","));
    }
    for (const i in mesh.indexBuffers) {
      const buffer = mesh.indexBuffers[i];
      const buffer_data = typedArrayToArray(buffer.data);
      const line = ["*" + i, buffer.data.length, buffer.data, buffer_data];
      lines.push(line.join(","));
    }
    if (mesh.bounding)
      lines.push(["@bounding", typedArrayToArray(mesh.bounding.subarray(0, 6))].join(","));
    if (mesh.info && mesh.info.groups) {
      const groups_info = [];
      for (let j = 0; j < mesh.info.groups.length; ++j) {
        const group = mesh.info.groups[j];
        groups_info.push(group.name, group.material, group.start, group.length);
      }
      lines.push(["@groups", mesh.info.groups.length].concat(groups_info).join(","));
    }
    if (mesh.bones)
      lines.push(["@bones", mesh.bones.length, mesh.bones.flat()].join(","));
    const bind_matrix = mesh.bind_matrix;
    if (bind_matrix) lines.push(["@bind_matrix", typedArrayToArray(bind_matrix)].join(","));
    return lines.join("\n");
  };
  if (typeof WBin !== "undefined" && WBin) WBin.classes["Mesh"] = Mesh;
  Mesh.binary_file_formats["wbin"] = true;
  function fromBinary(data_array, options) {
    const opts = options || {};
    let o;
    if (data_array.constructor == ArrayBuffer) {
      if (typeof WBin === "undefined" || !WBin)
        throw "To use binary meshes you need to install WBin.js from https://github.com/jagenjo/litescene.js/blob/master/src/utils/wbin.js ";
      o = WBin.load(data_array, true);
    } else o = data_array;
    if (!o.info) console.warn("This WBin doesn't seem to contain a mesh. Classname: ", o["@classname"]);
    if (o.format) Mesh.decompress(o);
    const vertex_buffers = {};
    if (o.vertex_buffers) {
      const vb = o.vertex_buffers;
      for (const i in vb) vertex_buffers[vb[i]] = o[vb[i]];
    } else {
      if (o.vertices) vertex_buffers.vertices = o.vertices;
      if (o.normals) vertex_buffers.normals = o.normals;
      if (o.coords) vertex_buffers.coords = o.coords;
      if (o.weights) vertex_buffers.weights = o.weights;
      if (o.bone_indices) vertex_buffers.bone_indices = o.bone_indices;
    }
    const index_buffers = {};
    if (o.index_buffers) {
      const ib = o.index_buffers;
      for (const i in ib) index_buffers[ib[i]] = o[ib[i]];
    } else {
      if (o.triangles) index_buffers.triangles = o.triangles;
      if (o.wireframe) index_buffers.wireframe = o.wireframe;
    }
    const mesh = {
      vertex_buffers,
      index_buffers,
      bounding: o.bounding,
      info: o.info
    };
    if (o.bones) {
      const bones = o.bones;
      mesh.bones = bones;
      for (let i = 0; i < bones.length; ++i) bones[i][1] = mat4.clone(bones[i][1]);
      if (o.bind_matrix) mesh.bind_matrix = mat4.clone(o.bind_matrix);
    }
    if (o.morph_targets) mesh.morph_targets = o.morph_targets;
    if (opts.only_data) return mesh;
    const final_mesh = opts.mesh || new Mesh();
    final_mesh.configure(mesh);
    return final_mesh;
  }
  Mesh.fromBinary = fromBinary;
  Mesh.parsers["wbin"] = fromBinary;
  Mesh.encoders["wbin"] = function(mesh, options) {
    mesh.updateBoundingBox();
    return mesh.toBinary(options);
  };
  Mesh.prototype.toBinary = function(options) {
    if (typeof WBin === "undefined" || !WBin)
      throw "to use Mesh.toBinary you need to have WBin included. Check the repository for wbin.js";
    if (!this.info) this.info = {};
    const o = {
      object_class: "Mesh",
      info: this.info,
      groups: this.groups
    };
    if (this.bones) {
      const bones = [];
      const src = this.bones;
      for (let i = 0; i < src.length; ++i) bones.push([src[i][0], mat4.toArray(src[i][1])]);
      o.bones = bones;
      const bind_matrix = this.bind_matrix;
      if (bind_matrix) o.bind_matrix = bind_matrix;
    }
    if (!this.bounding) this.updateBoundingBox();
    o.bounding = this.bounding;
    const vertex_buffers = [];
    const index_buffers = [];
    for (const i in this.vertexBuffers) {
      const stream = this.vertexBuffers[i];
      const name = stream.name;
      o[name] = stream.data;
      vertex_buffers.push(name);
      if (stream.name == "vertices") this.info.num_vertices = stream.data.length / 3;
    }
    for (const i in this.indexBuffers) {
      const stream = this.indexBuffers[i];
      o[i] = stream.data;
      index_buffers.push(i);
    }
    o.vertex_buffers = vertex_buffers;
    o.index_buffers = index_buffers;
    if (Mesh.enable_wbin_compression)
      Mesh.compress(o);
    const bin = WBin.create(o, "Mesh");
    return bin;
  };
  Mesh.compress = function(o, format) {
    format = format || "bounding_compressed";
    o.format = {
      type: format
    };
    const func = Mesh.compressors[format];
    if (!func) throw "compression format not supported:" + format;
    return func(o);
  };
  Mesh.decompress = function(o) {
    if (!o.format) return;
    const format = o.format;
    const func = Mesh.decompressors[format.type];
    if (!func) throw "decompression format not supported:" + format.type;
    return func(o);
  };
  Mesh.compressors["bounding_compressed"] = function(o) {
    if (!o.vertex_buffers) throw "buffers not found";
    const min = BBox.getMin(o.bounding);
    const max = BBox.getMax(o.bounding);
    const range = vec3.sub(vec3.create(), max, min);
    const vertices = o.vertices;
    const new_vertices = new Uint16Array(vertices.length);
    for (let i = 0; i < vertices.length; i += 3) {
      new_vertices[i] = (vertices[i] - min[0]) / range[0] * 65535;
      new_vertices[i + 1] = (vertices[i + 1] - min[1]) / range[1] * 65535;
      new_vertices[i + 2] = (vertices[i + 2] - min[2]) / range[2] * 65535;
    }
    o.vertices = new_vertices;
    if (o.normals) {
      const normals = o.normals;
      const new_normals = new Uint8Array(normals.length);
      const normals_range = new_normals.constructor == Uint8Array ? 255 : 65535;
      for (let i = 0; i < normals.length; i += 3) {
        new_normals[i] = (normals[i] * 0.5 + 0.5) * normals_range;
        new_normals[i + 1] = (normals[i + 1] * 0.5 + 0.5) * normals_range;
        new_normals[i + 2] = (normals[i + 2] * 0.5 + 0.5) * normals_range;
      }
      o.normals = new_normals;
    }
    if (o.coords) {
      const coords = o.coords;
      const uvs_bounding = [1e4, 1e4, -1e4, -1e4];
      for (let i = 0; i < coords.length; i += 2) {
        const u = coords[i];
        if (uvs_bounding[0] > u) uvs_bounding[0] = u;
        else if (uvs_bounding[2] < u) uvs_bounding[2] = u;
        const v = coords[i + 1];
        if (uvs_bounding[1] > v) uvs_bounding[1] = v;
        else if (uvs_bounding[3] < v) uvs_bounding[3] = v;
      }
      o.format.uvs_bounding = uvs_bounding;
      const new_coords = new Uint16Array(coords.length);
      const range2 = [uvs_bounding[2] - uvs_bounding[0], uvs_bounding[3] - uvs_bounding[1]];
      for (let i = 0; i < coords.length; i += 2) {
        new_coords[i] = (coords[i] - uvs_bounding[0]) / range2[0] * 65535;
        new_coords[i + 1] = (coords[i + 1] - uvs_bounding[1]) / range2[1] * 65535;
      }
      o.coords = new_coords;
    }
    if (o.weights) {
      const weights = o.weights;
      const new_weights = new Uint16Array(weights.length);
      const weights_range = new_weights.constructor == Uint8Array ? 255 : 65535;
      for (let i = 0; i < weights.length; i += 4) {
        new_weights[i] = weights[i] * weights_range;
        new_weights[i + 1] = weights[i + 1] * weights_range;
        new_weights[i + 2] = weights[i + 2] * weights_range;
        new_weights[i + 3] = weights[i + 3] * weights_range;
      }
      o.weights = new_weights;
    }
  };
  Mesh.decompressors["bounding_compressed"] = function(o) {
    const bounding = o.bounding;
    if (!bounding)
      throw "error in mesh decompressing data: bounding not found, cannot use the bounding decompression.";
    const min = BBox.getMin(bounding);
    const max = BBox.getMax(bounding);
    const range = vec3.sub(vec3.create(), max, min);
    const format = o.format;
    const inv8 = 1 / 255;
    const inv16 = 1 / 65535;
    const vertices = o.vertices;
    const new_vertices = new Float32Array(vertices.length);
    for (let i = 0, l = vertices.length; i < l; i += 3) {
      new_vertices[i] = vertices[i] * inv16 * range[0] + min[0];
      new_vertices[i + 1] = vertices[i + 1] * inv16 * range[1] + min[1];
      new_vertices[i + 2] = vertices[i + 2] * inv16 * range[2] + min[2];
    }
    o.vertices = new_vertices;
    if (o.normals && o.normals.constructor != Float32Array) {
      const normals = o.normals;
      const new_normals = new Float32Array(normals.length);
      const inormals_range = normals.constructor == Uint8Array ? inv8 : inv16;
      for (let i = 0, l = normals.length; i < l; i += 3) {
        new_normals[i] = normals[i] * inormals_range * 2 - 1;
        new_normals[i + 1] = normals[i + 1] * inormals_range * 2 - 1;
        new_normals[i + 2] = normals[i + 2] * inormals_range * 2 - 1;
        const N = new_normals.subarray(i, i + 3);
        vec3.normalize(N, N);
      }
      o.normals = new_normals;
    }
    if (o.coords && format.uvs_bounding && o.coords.constructor != Float32Array) {
      const coords = o.coords;
      const uvs_bounding = format.uvs_bounding;
      const range2 = [uvs_bounding[2] - uvs_bounding[0], uvs_bounding[3] - uvs_bounding[1]];
      const new_coords = new Float32Array(coords.length);
      for (let i = 0, l = coords.length; i < l; i += 2) {
        new_coords[i] = coords[i] * inv16 * range2[0] + uvs_bounding[0];
        new_coords[i + 1] = coords[i + 1] * inv16 * range2[1] + uvs_bounding[1];
      }
      o.coords = new_coords;
    }
    if (o.weights && o.weights.constructor != Float32Array) {
      const weights = o.weights;
      const new_weights = new Float32Array(weights.length);
      const iweights_range = weights.constructor == Uint8Array ? inv8 : inv16;
      for (let i = 0, l = weights.length; i < l; i += 4) {
        new_weights[i] = weights[i] * iweights_range;
        new_weights[i + 1] = weights[i + 1] * iweights_range;
        new_weights[i + 2] = weights[i + 2] * iweights_range;
        new_weights[i + 3] = weights[i + 3] * iweights_range;
      }
      o.weights = new_weights;
    }
  };

  // src/fbo.ts
  function isTexture(x) {
    return !!x && x.constructor === Texture;
  }
  var _FBO = class _FBO {
    constructor(textures, depth_texture, stencil, gl2) {
      gl2 = gl2 || globalThis.gl;
      this.gl = gl2;
      this._context_id = gl2.context_id;
      if (textures && textures.constructor !== Array)
        throw "FBO textures must be an Array";
      this.handler = null;
      this.width = -1;
      this.height = -1;
      this.color_textures = [];
      this.depth_texture = null;
      this.stencil = !!stencil;
      this._stencil_enabled = false;
      this._num_binded_textures = 0;
      this.order = null;
      this._depth_renderbuffer = null;
      this._color_renderbuffer = null;
      this.colorRenderbuffer = null;
      this.depthRenderbuffer = null;
      this.multi_sample = false;
      if (textures && textures.length || depth_texture)
        this.setTextures(textures != null ? textures : null, depth_texture != null ? depth_texture : null);
      this._old_fbo_handler = null;
      this._old_viewport = new Float32Array(4);
    }
    /**
     * Changes the textures binded to this FBO
     * @method setTextures
     * @param {Array} color_textures an array containing the color textures, if not supplied a render buffer will be used
     * @param {GL.Texture} depth_texture the depth texture, if not supplied a render buffer will be used
     * @param {Boolean} skip_disable it doenst try to go back to the previous FBO enabled in case there was one
     */
    setTextures(color_textures, depth_texture, skip_disable) {
      if (isTexture(depth_texture)) {
        if (depth_texture.format !== DEPTH_COMPONENT && depth_texture.format !== DEPTH_STENCIL && depth_texture.format !== DEPTH_COMPONENT16 && depth_texture.format !== DEPTH_COMPONENT24 && depth_texture.format !== DEPTH_COMPONENT32F)
          throw "FBO Depth texture must be of format: gl.DEPTH_COMPONENT, gl.DEPTH_STENCIL or gl.DEPTH_COMPONENT16/24/32F (only in webgl2)";
        if (depth_texture.type != UNSIGNED_SHORT && depth_texture.type != UNSIGNED_INT && depth_texture.type != UNSIGNED_INT_24_8_WEBGL && depth_texture.type != FLOAT)
          throw "FBO Depth texture must be of type: gl.UNSIGNED_SHORT, gl.UNSIGNED_INT, gl.UNSIGNED_INT_24_8_WEBGL";
      }
      var same = this.depth_texture == depth_texture;
      if (same && color_textures) {
        if (color_textures.constructor !== Array)
          throw "FBO: color_textures parameter must be an array containing all the textures to be binded in the color";
        if (color_textures.length == this.color_textures.length) {
          for (var i = 0; i < color_textures.length; ++i)
            if (color_textures[i] != this.color_textures[i]) {
              same = false;
              break;
            }
        } else same = false;
      }
      if (this._stencil_enabled !== this.stencil) same = false;
      if (same) return;
      this.color_textures.length = color_textures ? color_textures.length : 0;
      if (color_textures)
        for (var i = 0; i < color_textures.length; ++i)
          this.color_textures[i] = color_textures[i];
      this.depth_texture = depth_texture != null ? depth_texture : null;
      this.update(skip_disable);
    }
    /**
     * Updates the FBO with the new set of textures and buffers
     * @method update
     * @param {Boolean} skip_disable it doenst try to go back to the previous FBO enabled in case there was one
     */
    update(skip_disable) {
      this._old_fbo_handler = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      if (!this.handler) this.handler = gl.createFramebuffer();
      var w = -1, h = -1, type = null, format = null;
      var color_textures = this.color_textures;
      var depth_texture = this.depth_texture;
      if (color_textures && color_textures.length)
        for (var i = 0; i < color_textures.length; i++) {
          var t = color_textures[i];
          if (t.constructor !== Texture)
            throw "FBO can only bind instances of GL.Texture";
          if (w == -1) w = t.width;
          else if (w != t.width) throw "Cannot bind textures with different dimensions";
          if (h == -1) h = t.height;
          else if (h != t.height) throw "Cannot bind textures with different dimensions";
          if (type == null) {
            type = t.type;
            format = t.format;
          } else if (type != t.type)
            throw "Cannot bind textures to a FBO with different pixel formats";
          if (t.texture_type != gl.TEXTURE_2D) throw "Cannot bind a Cubemap to a FBO";
        }
      else {
        var depth_size = depth_texture;
        w = depth_size.width;
        h = depth_size.height;
      }
      this.width = w;
      this.height = h;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.handler);
      var ext = gl.extensions.WEBGL_draw_buffers;
      if (gl.webgl_version == 1 && !ext && color_textures && color_textures.length > 1)
        throw "Rendering to several textures not supported by your browser";
      var target = gl.webgl_version == 1 ? gl.FRAMEBUFFER : gl.DRAW_FRAMEBUFFER;
      gl.framebufferRenderbuffer(target, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
      gl.framebufferRenderbuffer(target, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, null);
      if (isTexture(depth_texture)) {
        if (gl.webgl_version == 1 && !gl.extensions.WEBGL_depth_texture)
          throw "Rendering to depth texture not supported by your browser";
        if (this.stencil && depth_texture.format !== gl.DEPTH_STENCIL)
          console.warn("Stencil cannot be enabled if there is a depth texture with a DEPTH_STENCIL format");
        if (depth_texture.format == gl.DEPTH_STENCIL)
          gl.framebufferTexture2D(target, gl.DEPTH_STENCIL_ATTACHMENT, gl.TEXTURE_2D, depth_texture.handler, 0);
        else
          gl.framebufferTexture2D(target, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth_texture.handler, 0);
      } else {
        var depth_renderbuffer;
        if (depth_texture && depth_texture.constructor === WebGLRenderbuffer && depth_texture.width == w && depth_texture.height == h)
          depth_renderbuffer = this._depth_renderbuffer = depth_texture;
        else {
          depth_renderbuffer = this._depth_renderbuffer = this._depth_renderbuffer || gl.createRenderbuffer();
          depth_renderbuffer.width = w;
          depth_renderbuffer.height = h;
        }
        gl.bindRenderbuffer(gl.RENDERBUFFER, depth_renderbuffer);
        if (this.stencil) {
          gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, w, h);
          gl.framebufferRenderbuffer(target, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, depth_renderbuffer);
        } else {
          gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
          gl.framebufferRenderbuffer(target, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth_renderbuffer);
        }
      }
      if (color_textures && color_textures.length) {
        this.order = [];
        for (var i = 0; i < color_textures.length; i++) {
          var t = color_textures[i];
          gl.framebufferTexture2D(target, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t.handler, 0);
          this.order.push(gl.COLOR_ATTACHMENT0 + i);
        }
      } else {
        var color_renderbuffer = this._color_renderbuffer = this._color_renderbuffer || gl.createRenderbuffer();
        color_renderbuffer.width = w;
        color_renderbuffer.height = h;
        gl.bindRenderbuffer(gl.RENDERBUFFER, color_renderbuffer);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA4, w, h);
        gl.framebufferRenderbuffer(target, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color_renderbuffer);
      }
      var num = color_textures ? color_textures.length : 0;
      for (var i = num; i < this._num_binded_textures; ++i)
        gl.framebufferTexture2D(target, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, null, 0);
      this._num_binded_textures = num;
      this._stencil_enabled = this.stencil;
      if (color_textures && color_textures.length > 1) {
        if (ext) ext.drawBuffersWEBGL(this.order);
        else gl.drawBuffers(this.order);
      }
      var complete = gl.checkFramebufferStatus(target);
      if (complete !== gl.FRAMEBUFFER_COMPLETE) {
        if (format == RGB && (type == FLOAT || type == HALF_FLOAT_OES))
          console.error("Tip: Firefox does not support RGB channel float/half_float textures, you must use RGBA");
        throw "FBO not complete: " + complete;
      }
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      if (!skip_disable) gl.bindFramebuffer(target, this._old_fbo_handler);
    }
    /**
     * Enables this FBO (from now on all the render will be stored in the textures attached to this FBO)
     * It stores the previous viewport to restore it afterwards, and changes it to full FBO size
     * @method bind
     * @param {boolean} keep_old keeps the previous FBO is one was attached to restore it afterwards
     */
    bind(keep_old) {
      if (this.multi_sample) {
        this._old_fbo_handler = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        this._old_viewport.set(gl.viewport_data);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.handler);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.colorRenderbuffer);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRenderbuffer);
        gl.viewport(0, 0, this.width, this.height);
        _FBO.current = this;
        return;
      }
      if (!this.color_textures.length && !this.depth_texture)
        throw "FBO: no textures attached to FBO";
      this._old_viewport.set(gl.viewport_data);
      if (keep_old)
        this._old_fbo_handler = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      else this._old_fbo_handler = null;
      if (this._old_fbo_handler != this.handler)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.handler);
      for (var i = 0; i < this.color_textures.length; ++i)
        this.color_textures[i]._in_current_fbo = true;
      if (isTexture(this.depth_texture)) this.depth_texture._in_current_fbo = true;
      gl.viewport(0, 0, this.width, this.height);
      _FBO.current = this;
    }
    /**
     * Disables this FBO, if it was binded with keep_old then the old FBO is enabled, otherwise it will render to the screen
     * Restores viewport to previous
     * @method unbind
     */
    unbind() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._old_fbo_handler);
      this._old_fbo_handler = null;
      gl.setViewport(this._old_viewport);
      for (var i = 0; i < this.color_textures.length; ++i)
        this.color_textures[i]._in_current_fbo = false;
      if (isTexture(this.depth_texture)) this.depth_texture._in_current_fbo = false;
      _FBO.current = null;
    }
    //binds another FBO without switch back to previous (faster)
    switchTo(next_fbo) {
      next_fbo._old_fbo_handler = this._old_fbo_handler;
      next_fbo._old_viewport.set(this._old_viewport);
      gl.bindFramebuffer(gl.FRAMEBUFFER, next_fbo.handler);
      this._old_fbo_handler = null;
      gl.viewport(0, 0, this.width, this.height);
      for (var i = 0; i < this.color_textures.length; ++i)
        this.color_textures[i]._in_current_fbo = false;
      if (isTexture(this.depth_texture)) this.depth_texture._in_current_fbo = false;
      for (var i = 0; i < next_fbo.color_textures.length; ++i)
        next_fbo.color_textures[i]._in_current_fbo = true;
      if (isTexture(next_fbo.depth_texture)) next_fbo.depth_texture._in_current_fbo = true;
      _FBO.current = next_fbo;
    }
    delete() {
      gl.deleteFramebuffer(this.handler);
      this.handler = null;
    }
    //type: gl.FLOAT, format: gl.RGBA
    static testSupport(type, format) {
      var _a;
      var name = type + ":" + format;
      if (_FBO.supported[name] != null) return _FBO.supported[name];
      var tex = new Texture(1, 1, { format, type });
      try {
        var fbo = new _FBO([tex]);
      } catch (e) {
        var GL_reverse = (_a = globalThis.GL) == null ? void 0 : _a.reverse;
        console.warn(
          "This browser WEBGL implementation doesn't support this FBO format: " + (GL_reverse ? GL_reverse[type] : type) + " " + (GL_reverse ? GL_reverse[format] : format)
        );
        return _FBO.supported[name] = false;
      }
      _FBO.supported[name] = true;
      return true;
    }
    toSingle(index) {
      index = index || 0;
      if (this.color_textures.length < 2) return;
      var order = this.order;
      if (!order) return;
      var ext = gl.extensions.WEBGL_draw_buffers;
      if (ext) ext.drawBuffersWEBGL([order[index]]);
      else gl.drawBuffers([order[index]]);
    }
    toMulti() {
      if (this.color_textures.length < 2) return;
      var order = this.order;
      if (!order) return;
      var ext = gl.extensions.WEBGL_draw_buffers;
      if (ext) ext.drawBuffersWEBGL(order);
      else gl.drawBuffers(order);
    }
    //clears only the secondary buffers (not the main one)
    clearSecondary(color) {
      var order = this.order;
      if (!order || order.length < 2) return;
      var ext = gl.extensions.WEBGL_draw_buffers;
      var new_order = [gl.NONE];
      for (var i = 1; i < order.length; ++i) new_order.push(order[i]);
      if (ext) ext.drawBuffersWEBGL(new_order);
      else gl.drawBuffers(new_order);
      gl.clearColor(color[0], color[1], color[2], color[3]);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (ext) ext.drawBuffersWEBGL(order);
      else gl.drawBuffers(order);
    }
    //WebGL 2
    //allows to render to a FBO that will be multisampled
    makeMultiSample(width, height, samples, options) {
      if (this.gl.webgl_version == 1) throw "cannot use makeMultiSample in webgl 1.0";
      this.width = width;
      this.height = height;
      samples = samples || 4;
      options = options || {};
      var format = options.format || gl.RGBA8;
      var depth_format = gl.DEPTH_COMPONENT16;
      this._old_fbo_handler = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      this.handler = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.handler);
      this.colorRenderbuffer = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.colorRenderbuffer);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, format, this.width, this.height);
      this.depthRenderbuffer = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRenderbuffer);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, depth_format, this.width, this.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.handler);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.colorRenderbuffer);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRenderbuffer);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._old_fbo_handler);
      this._old_fbo_handler = null;
      this.multi_sample = true;
    }
    blitMultisample(fbo) {
      if (!fbo || fbo.constructor !== _FBO) throw "parameter must be GL.FBO";
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.handler);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo.handler);
      gl.blitFramebuffer(
        0,
        0,
        this.width,
        this.height,
        0,
        0,
        this.width,
        this.height,
        gl.COLOR_BUFFER_BIT,
        gl.LINEAR
      );
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._old_fbo_handler);
      this._old_fbo_handler = null;
      gl.setViewport(this._old_viewport);
    }
  };
  //WebGL 1.0 support for certaing FBOs is not very clear and can crash sometimes
  _FBO.current = null;
  _FBO.supported = {};
  var FBO = _FBO;

  // src/raytracer.ts
  var HitTest = class {
    constructor(t, hit, normal, index) {
      this.t = t === void 0 ? Number.MAX_VALUE : t;
      this.hit = hit != null ? hit : null;
      this.normal = normal != null ? normal : null;
      this.face = null;
      this.index = index;
    }
    // ### .mergeWith(other)
    //
    // Changes this object to be the closer of the two hit test results.
    mergeWith(other) {
      if (other.t > 0 && other.t < this.t) {
        this.t = other.t;
        this.hit = other.hit;
        this.normal = other.normal;
        this.face = other.face;
        this.index = other.index;
      }
    }
  };
  var Ray = class {
    constructor(origin, direction) {
      this.origin = vec3.create();
      this.direction = vec3.create();
      this.collision_point = vec3.create();
      this.t = -1;
      if (origin)
        this.origin.set(origin);
      if (direction)
        this.direction.set(direction);
    }
    testPlane(P, N) {
      const r = geo.testRayPlane(this.origin, this.direction, P, N, this.collision_point);
      this.t = geo.last_t;
      return r;
    }
    testSphere(center, radius, max_dist) {
      const r = geo.testRaySphere(this.origin, this.direction, center, radius, this.collision_point, max_dist);
      this.t = geo.last_t;
      return r;
    }
    //box must be in BBox format, check BBox class
    testBBox(bbox, max_dist, model, in_local) {
      const r = geo.testRayBBox(this.origin, this.direction, bbox, model, this.collision_point, max_dist, in_local);
      this.t = geo.last_t;
      return r;
    }
  };
  var _getRayForPixel_ray0 = vec3.create();
  var _getRayForPixel_ray1 = vec3.create();
  var _hittest_inv = mat4.create();
  var Raytracer = class {
    constructor(viewprojection_matrix, viewport) {
      this.viewport = vec4.create();
      this.ray00 = vec3.create();
      this.ray10 = vec3.create();
      this.ray01 = vec3.create();
      this.ray11 = vec3.create();
      this.eye = vec3.create();
      this.setup(viewprojection_matrix, viewport);
    }
    setup(viewprojection_matrix, viewport) {
      const vp = viewport || gl.viewport_data;
      this.viewport.set(vp);
      const minX = vp[0], maxX = minX + vp[2];
      const minY = vp[1], maxY = minY + vp[3];
      vec3.set(this.ray00, minX, minY, 1);
      vec3.set(this.ray10, maxX, minY, 1);
      vec3.set(this.ray01, minX, maxY, 1);
      vec3.set(this.ray11, maxX, maxY, 1);
      vec3.unproject(this.ray00, this.ray00, viewprojection_matrix, vp);
      vec3.unproject(this.ray10, this.ray10, viewprojection_matrix, vp);
      vec3.unproject(this.ray01, this.ray01, viewprojection_matrix, vp);
      vec3.unproject(this.ray11, this.ray11, viewprojection_matrix, vp);
      const eye = this.eye;
      vec3.unproject(eye, eye, viewprojection_matrix, vp);
      vec3.subtract(this.ray00, this.ray00, eye);
      vec3.subtract(this.ray10, this.ray10, eye);
      vec3.subtract(this.ray01, this.ray01, eye);
      vec3.subtract(this.ray11, this.ray11, eye);
    }
    // ### .getRayForPixel(x, y)
    //
    // Returns the ray direction originating from the camera and traveling through the pixel `x, y`.
    getRayForPixel(x, y, out) {
      out = out || vec3.create();
      x = (x - this.viewport[0]) / this.viewport[2];
      y = 1 - (y - this.viewport[1]) / this.viewport[3];
      vec3.lerp(_getRayForPixel_ray0, this.ray00, this.ray10, x);
      vec3.lerp(_getRayForPixel_ray1, this.ray01, this.ray11, x);
      vec3.lerp(out, _getRayForPixel_ray0, _getRayForPixel_ray1, y);
      return vec3.normalize(out, out);
    }
    // ### GL.Raytracer.hitTestBox(origin, ray, min, max)
    //
    // Traces the ray starting from `origin` along `ray` against the axis-aligned box
    // whose coordinates extend from `min` to `max`. Returns a `HitTest` with the
    // information or `null` for no intersection.
    //
    // This implementation uses the [slab intersection method](http://www.siggraph.org/education/materials/HyperGraph/raytrace/rtinter3.htm).
    static hitTestBox(origin, ray, min, max, model) {
      const _hittest_v3 = new Float32Array(10 * 3);
      if (model) {
        const inv = mat4.invert(_hittest_inv, model) || _hittest_inv;
        origin = mat4.multiplyVec3(_hittest_v3.subarray(3, 6), inv, origin);
        ray = mat4.rotateVec3(_hittest_v3.subarray(6, 9), inv, ray);
      }
      const tMin = vec3.subtract(_hittest_v3.subarray(9, 12), min, origin);
      vec3.divide(tMin, tMin, ray);
      const tMax = vec3.subtract(_hittest_v3.subarray(12, 15), max, origin);
      vec3.divide(tMax, tMax, ray);
      const t1 = vec3.min(_hittest_v3.subarray(15, 18), tMin, tMax);
      const t2 = vec3.max(_hittest_v3.subarray(18, 21), tMin, tMax);
      const tNear = vec3.maxValue(t1);
      const tFar = vec3.minValue(t2);
      if (tNear > 0 && tNear <= tFar) {
        const epsilon = 1e-6;
        const hit = vec3.scale(_hittest_v3.subarray(21, 24), ray, tNear);
        vec3.add(hit, origin, hit);
        vec3.addValue(_hittest_v3.subarray(24, 27), min, epsilon);
        vec3.subValue(_hittest_v3.subarray(27, 30), max, epsilon);
        return new HitTest(tNear, hit, vec3.fromValues(
          Number(hit[0] > max[0]) - Number(hit[0] < min[0]),
          Number(hit[1] > max[1]) - Number(hit[1] < min[1]),
          Number(hit[2] > max[2]) - Number(hit[2] < min[2])
        ));
      }
      return null;
    }
    // ### GL.Raytracer.hitTestSphere(origin, ray, center, radius)
    //
    // Traces the ray starting from `origin` along `ray` against the sphere defined
    // by `center` and `radius`. Returns a `HitTest` with the information or `null`
    // for no intersection.
    static hitTestSphere(origin, ray, center, radius) {
      const offset = vec3.subtract(vec3.create(), origin, center);
      const a = vec3.dot(ray, ray);
      const b = 2 * vec3.dot(ray, offset);
      const c = vec3.dot(offset, offset) - radius * radius;
      const discriminant = b * b - 4 * a * c;
      if (discriminant > 0) {
        const t = (-b - Math.sqrt(discriminant)) / (2 * a), hit = vec3.add(vec3.create(), origin, vec3.scale(vec3.create(), ray, t));
        return new HitTest(t, hit, vec3.scale(vec3.create(), vec3.subtract(vec3.create(), hit, center), 1 / radius));
      }
      return null;
    }
    // ### GL.Raytracer.hitTestTriangle(origin, ray, a, b, c)
    //
    // Traces the ray starting from `origin` along `ray` against the triangle defined
    // by the points `a`, `b`, and `c`. Returns a `HitTest` with the information or
    // `null` for no intersection.
    static hitTestTriangle(origin, ray, a, b, c) {
      const ab = vec3.subtract(vec3.create(), b, a);
      const ac = vec3.subtract(vec3.create(), c, a);
      const normal = vec3.cross(vec3.create(), ab, ac);
      vec3.normalize(normal, normal);
      const t = vec3.dot(normal, vec3.subtract(vec3.create(), a, origin)) / vec3.dot(normal, ray);
      if (t > 0) {
        const hit = vec3.add(vec3.create(), origin, vec3.scale(vec3.create(), ray, t));
        const toHit = vec3.subtract(vec3.create(), hit, a);
        const dot00 = vec3.dot(ac, ac);
        const dot01 = vec3.dot(ac, ab);
        const dot02 = vec3.dot(ac, toHit);
        const dot11 = vec3.dot(ab, ab);
        const dot12 = vec3.dot(ab, toHit);
        const divide = dot00 * dot11 - dot01 * dot01;
        const u = (dot11 * dot02 - dot01 * dot12) / divide;
        const v = (dot00 * dot12 - dot01 * dot02) / divide;
        if (u >= 0 && v >= 0 && u + v <= 1) return new HitTest(t, hit, normal);
      }
      return null;
    }
  };

  // src/octree.ts
  var OctreeNode = class {
    //children
    constructor(min, max) {
      this.faces = null;
      //[ Float32Array[10], ... ]
      this.inside = 0;
      this.c = null;
      this.min = min;
      this.max = max;
      this.size = vec3.sub(vec3.create(), max, min);
    }
  };
  var octree_tested_boxes = 0;
  var octree_tested_triangles = 0;
  var _vf_V1 = vec3.create();
  var _vf_V2 = vec3.create();
  var _vf_N = vec3.create();
  var _tr_origin = vec3.create();
  var _tr_direction = vec3.create();
  var _tr_min = vec3.create();
  var _tr_max = vec3.create();
  var _cp_plane = new Float32Array(4);
  var _cp_point = vec3.create();
  var _cp_c1 = vec3.create();
  var _cp_c2 = vec3.create();
  var _cp_c3 = vec3.create();
  var _hb_tMin = vec3.create();
  var _hb_tMax = vec3.create();
  var _hb_inv = vec3.create();
  var _hb_t1 = vec3.create();
  var _hb_t2 = vec3.create();
  var _hb_tmp = vec3.create();
  var _hb_epsilon = 1e-6;
  var _hb_eps = vec3.fromValues(_hb_epsilon, _hb_epsilon, _hb_epsilon);
  var _ht_AB = vec3.create();
  var _ht_AC = vec3.create();
  var _ht_toHit = vec3.create();
  var _ht_tmp = vec3.create();
  var _st_A = vec3.create();
  var _st_B = vec3.create();
  var _st_C = vec3.create();
  var _st_AB = vec3.create();
  var _st_AC = vec3.create();
  var _st_BC = vec3.create();
  var _st_CA = vec3.create();
  var _st_V = vec3.create();
  var _Octree = class _Octree {
    constructor(mesh, start, length) {
      this.total_triangles = 0;
      this.max_node_triangles = 0;
      this.octree_pos_ref = [[0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1], [1, 0, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1]];
      this.root = null;
      this.total_depth = 0;
      this.total_nodes = 0;
      if (mesh)
        this.buildFromMesh(mesh, start, length);
    }
    buildFromMesh(mesh, start, length) {
      this.total_depth = 0;
      this.total_nodes = 0;
      start = start || 0;
      const vertices = mesh.getBuffer("vertices").data;
      const triangles_buffer = mesh.getIndexBuffer("triangles");
      const triangles = triangles_buffer ? triangles_buffer.data : null;
      if (!length)
        length = triangles ? triangles.length : vertices.length / 3;
      let bounding;
      if (triangles)
        bounding = this.computeAABBFromIndices(vertices, triangles, start, length);
      else
        bounding = this.computeAABB(vertices);
      const root = new OctreeNode(bounding.min, bounding.max);
      this.root = root;
      this.total_nodes = 1;
      this.total_triangles = triangles ? triangles.length / 3 : vertices.length / 9;
      this.max_node_triangles = this.total_triangles * _Octree.MAX_NODE_TRIANGLES_RATIO;
      const margin = vec3.create();
      vec3.scale(margin, root.size, _Octree.OCTREE_MARGIN_RATIO);
      if (margin[0] < _Octree.OCTREE_MIN_MARGIN) margin[0] = _Octree.OCTREE_MIN_MARGIN;
      if (margin[1] < _Octree.OCTREE_MIN_MARGIN) margin[1] = _Octree.OCTREE_MIN_MARGIN;
      if (margin[2] < _Octree.OCTREE_MIN_MARGIN) margin[2] = _Octree.OCTREE_MIN_MARGIN;
      vec3.sub(root.min, root.min, margin);
      vec3.add(root.max, root.max, margin);
      root.faces = [];
      const end = start + length;
      if (triangles) {
        for (let i = start; i < end; i += 3) {
          const face = new Float32Array([
            vertices[triangles[i] * 3],
            vertices[triangles[i] * 3 + 1],
            vertices[triangles[i] * 3 + 2],
            vertices[triangles[i + 1] * 3],
            vertices[triangles[i + 1] * 3 + 1],
            vertices[triangles[i + 1] * 3 + 2],
            vertices[triangles[i + 2] * 3],
            vertices[triangles[i + 2] * 3 + 1],
            vertices[triangles[i + 2] * 3 + 2],
            i / 3
          ]);
          if (_Octree.isValidFace(face))
            this.addToNode(face, root, 0);
        }
      } else {
        for (let i = start * 3; i < length * 3; i += 9) {
          const face = new Float32Array(10);
          face.set(vertices.subarray(i, i + 9));
          face[9] = i / 9;
          if (_Octree.isValidFace(face))
            this.addToNode(face, root, 0);
        }
      }
      this.total_nodes = this.trim();
      return root;
    }
    static isValidFace(face) {
      const A = face.subarray(0, 3);
      const B = face.subarray(3, 6);
      const C = face.subarray(6, 9);
      vec3.sub(_vf_V1, B, A);
      vec3.sub(_vf_V2, C, A);
      vec3.cross(_vf_N, _vf_V1, _vf_V2);
      return vec3.length(_vf_N) > 0;
    }
    addToNode(face, node, depth) {
      node.inside += 1;
      if (node.c) {
        const aabb = this.computeAABB(face);
        let added = false;
        for (let i = 0; i < node.c.length; ++i) {
          const child = node.c[i];
          if (_Octree.isInsideAABB(aabb, child)) {
            this.addToNode(face, child, depth + 1);
            added = true;
            break;
          }
        }
        if (!added) {
          if (node.faces == null)
            node.faces = [];
          node.faces.push(face);
        }
      } else {
        if (node.faces == null)
          node.faces = [];
        node.faces.push(face);
        if (node.faces.length > this.max_node_triangles && depth < _Octree.MAX_OCTREE_DEPTH) {
          this.splitNode(node);
          if (this.total_depth < depth + 1)
            this.total_depth = depth + 1;
          const faces = node.faces;
          node.faces = null;
          const children = node.c;
          for (let i = 0; i < faces.length; ++i) {
            const face2 = faces[i];
            const aabb = this.computeAABB(face2);
            let added = false;
            for (let j = 0; j < children.length; ++j) {
              const child = children[j];
              if (_Octree.isInsideAABB(aabb, child)) {
                this.addToNode(face2, child, depth + 1);
                added = true;
                break;
              }
            }
            if (!added) {
              if (node.faces == null)
                node.faces = [];
              node.faces.push(face2);
            }
          }
        }
      }
    }
    splitNode(node) {
      node.c = [];
      const half = [(node.max[0] - node.min[0]) * 0.5, (node.max[1] - node.min[1]) * 0.5, (node.max[2] - node.min[2]) * 0.5];
      for (let i = 0; i < this.octree_pos_ref.length; ++i) {
        const ref = this.octree_pos_ref[i];
        const min = new Float32Array([node.min[0] + half[0] * ref[0], node.min[1] + half[1] * ref[1], node.min[2] + half[2] * ref[2]]);
        const max = new Float32Array([min[0] + half[0], min[1] + half[1], min[2] + half[2]]);
        const newnode = new OctreeNode(min, max);
        this.total_nodes += 1;
        newnode.faces = null;
        newnode.inside = 0;
        node.c.push(newnode);
      }
    }
    //receives typed array with three vertices of a triangle (plus the index)
    computeAABB(vertices) {
      const min = new Float32Array([vertices[0], vertices[1], vertices[2]]);
      const max = new Float32Array(min);
      for (let i = 3; i < vertices.length - 1; i += 3) {
        for (let j = 0; j < 3; j++) {
          if (min[j] > vertices[i + j])
            min[j] = vertices[i + j];
          if (max[j] < vertices[i + j])
            max[j] = vertices[i + j];
        }
      }
      return { min, max };
    }
    computeAABBFromIndices(vertices, indices, start, length) {
      start = start || 0;
      length = length || indices.length;
      const first = indices[start];
      const min = new Float32Array([vertices[first * 3], vertices[first * 3 + 1], vertices[first * 3 + 2]]);
      const max = new Float32Array([vertices[first * 3], vertices[first * 3 + 1], vertices[first * 3 + 2]]);
      for (let i = start + 1; i < start + length; ++i) {
        const index = indices[i] * 3;
        for (let j = 0; j < 3; j++) {
          if (min[j] > vertices[index + j])
            min[j] = vertices[index + j];
          if (max[j] < vertices[index + j])
            max[j] = vertices[index + j];
        }
      }
      return { min, max };
    }
    //remove empty nodes
    trim(node) {
      node = node || this.root || void 0;
      if (!node)
        return 0;
      if (!node.c)
        return 1;
      let num = 1;
      const valid = [];
      const c = node.c;
      for (let i = 0; i < c.length; ++i) {
        if (c[i].inside) {
          valid.push(c[i]);
          num += this.trim(c[i]);
        }
      }
      node.c = valid;
      return num;
    }
    /**
    * Test collision between ray and triangles in the octree
    * @method testRay
    * @param {vec3} origin ray origin position
    * @param {vec3} direction ray direction position
    * @param {number} dist_min
    * @param {number} dist_max
    * @param {number} test_backfaces if rays colliding with the back face must be considered a valid collision
    * @param {number} mode which mode to use (Octree.NEAREST: nearest collision to origin, Octree.FIRST: first collision detected (fastest), Octree.ALL: all collision (slowest)
    * @return {HitTest} object containing pos, normal, index
    */
    testRay(origin, direction, dist_min, dist_max, test_backfaces, mode) {
      octree_tested_boxes = 0;
      octree_tested_triangles = 0;
      mode = mode || _Octree.NEAREST;
      if (!this.root) {
        throw "Error: octree not build";
      }
      _tr_origin.set(origin);
      _tr_direction.set(direction);
      _tr_min.set(this.root.min);
      _tr_max.set(this.root.max);
      const box_test = _Octree.hitTestBox(_tr_origin, _tr_direction, _tr_min, _tr_max);
      if (!box_test)
        return null;
      const test = _Octree.testRayInNode(this.root, _tr_origin, _tr_direction, test_backfaces, mode);
      if (test == null)
        return null;
      if (mode == _Octree.ALL)
        return test;
      const hit_test = test;
      const pos = vec3.scale(vec3.create(), direction, hit_test.t);
      vec3.add(pos, pos, origin);
      hit_test.pos = pos;
      return hit_test;
    }
    //tests collisions with a node of the octree and its children
    //WARNING: cannot use static here, it uses recursion
    static testRayInNode(node, origin, direction, test_backfaces, mode) {
      let prev_test = null;
      octree_tested_boxes += 1;
      if (node.faces)
        for (let i = 0, l = node.faces.length; i < l; ++i) {
          const face = node.faces[i];
          octree_tested_triangles += 1;
          const test = _Octree.hitTestTriangle(origin, direction, face.subarray(0, 3), face.subarray(3, 6), face.subarray(6, 9), test_backfaces);
          if (test == null)
            continue;
          test.index = face[9];
          if (mode == _Octree.FIRST)
            return test;
          if (mode == _Octree.ALL) {
            if (!prev_test)
              prev_test = [];
            prev_test.push(test);
          } else {
            test.face = face;
            if (prev_test)
              prev_test.mergeWith(test);
            else
              prev_test = test;
          }
        }
      const child_min = vec3.create();
      const child_max = vec3.create();
      if (node.c)
        for (let i = 0; i < node.c.length; ++i) {
          const child = node.c[i];
          child_min.set(child.min);
          child_max.set(child.max);
          const box_test = _Octree.hitTestBox(origin, direction, child_min, child_max);
          if (box_test == null)
            continue;
          if (mode != _Octree.ALL && prev_test && box_test.t > prev_test.t)
            continue;
          const test = _Octree.testRayInNode(child, origin, direction, test_backfaces, mode);
          if (test == null)
            continue;
          if (mode == _Octree.FIRST)
            return test;
          if (mode == _Octree.ALL) {
            if (!prev_test)
              prev_test = [];
            prev_test.push(test);
          } else {
            if (prev_test)
              prev_test.mergeWith(test);
            else
              prev_test = test;
          }
        }
      return prev_test;
    }
    /**
    * test collision between sphere and the triangles in the octree (only test if there is any vertex inside the sphere)
    * @method testSphere
    * @param {vec3} origin sphere center
    * @param {number} radius
    * @return {Boolean} true if the sphere collided with the mesh
    */
    testSphere(origin, radius) {
      const center = vec3.clone(origin);
      octree_tested_boxes = 0;
      octree_tested_triangles = 0;
      if (!this.root)
        throw "Error: octree not build";
      const rr = radius * radius;
      if (!_Octree.testSphereBox(center, rr, vec3.clone(this.root.min), vec3.clone(this.root.max)))
        return false;
      return _Octree.testSphereInNode(this.root, center, rr);
    }
    //WARNING: cannot use static here, it uses recursion
    static testSphereInNode(node, origin, radius2) {
      octree_tested_boxes += 1;
      if (node.faces)
        for (let i = 0, l = node.faces.length; i < l; ++i) {
          const face = node.faces[i];
          octree_tested_triangles += 1;
          if (_Octree.testSphereTriangle(origin, radius2, face.subarray(0, 3), face.subarray(3, 6), face.subarray(6, 9)))
            return true;
        }
      const child_min = vec3.create();
      const child_max = vec3.create();
      if (node.c)
        for (let i = 0; i < node.c.length; ++i) {
          const child = node.c[i];
          child_min.set(child.min);
          child_max.set(child.max);
          if (!_Octree.testSphereBox(origin, radius2, child_min, child_max))
            continue;
          if (_Octree.testSphereInNode(child, origin, radius2))
            return true;
        }
      return false;
    }
    //
    //
    /**
    * finds which is the nearest point to a mesh, and also the normal of that point, and returns the distance
    * @method findNearestPoint
    * @param {vec3} v the point to which find the nearest
    * @param {vec3} out where to store the nearest point
    * @param {number} minDist the minimum distance to check
    * @param {vec3} normal [optional] where to store the nearest point normal
    * @return {number} the distance to the nearest point found
    */
    findNearestPoint(v, out, minDist, normal) {
      minDist = minDist || Infinity;
      if (v === out)
        throw "findNearestPoint input point and output cannot be the same";
      if (!this.root)
        throw "Error: octree not build";
      return _Octree.nearestInNode(this.root, v, out, minDist, normal);
    }
    static nearestInNode(node, origin, out, minDist, normal) {
      octree_tested_boxes += 1;
      const current = vec3.create();
      let currentNormal;
      if (normal)
        currentNormal = vec3.create();
      if (node.faces)
        for (let i = 0, l = node.faces.length; i < l; ++i) {
          const face = node.faces[i];
          octree_tested_triangles += 1;
          const A = face.subarray(0, 3);
          const B = face.subarray(3, 6);
          const C = face.subarray(6, 9);
          _Octree.closestPointOnTriangle(origin, A, B, C, current);
          const dist = vec3.dist(current, origin);
          if (dist < minDist) {
            minDist = dist;
            vec3.copy(out, current);
            if (normal)
              geo.computeTriangleNormal(normal, A, B, C);
          }
        }
      if (!node.c)
        return minDist;
      for (let i = 0; i < node.c.length; ++i) {
        const child = node.c[i];
        const distToAABB = _Octree.distanceToBox(origin, child.min, child.max);
        if (distToAABB > minDist)
          continue;
        const dist = _Octree.nearestInNode(child, origin, current, minDist, currentNormal);
        if (dist < minDist) {
          minDist = dist;
          vec3.copy(out, current);
          if (normal && currentNormal)
            vec3.copy(normal, currentNormal);
        }
      }
      return minDist;
    }
    static closestPointOnTriangle(p, a, b, c, out) {
      geo.planeFromTriangle(_cp_plane, a, b, c);
      if (vec3.length(_cp_plane) > 1e-8) {
        geo.projectPointOnPlane(p, a, _cp_plane, _cp_point);
        if (geo.isPointInsideTriangle(_cp_point, a, b, c)) {
          vec3.copy(out, _cp_point);
          return out;
        }
      }
      geo.closestPointToSegment(_cp_point, a, b, _cp_c1);
      geo.closestPointToSegment(_cp_point, b, c, _cp_c2);
      geo.closestPointToSegment(_cp_point, c, a, _cp_c3);
      const mag1 = vec3.sqrDist(_cp_point, _cp_c1);
      const mag2 = vec3.sqrDist(_cp_point, _cp_c2);
      const mag3 = vec3.sqrDist(_cp_point, _cp_c3);
      const min = Math.min(mag1, mag2, mag3);
      if (min === mag1)
        vec3.copy(out, _cp_c1);
      else if (min === mag2)
        vec3.copy(out, _cp_c2);
      else
        vec3.copy(out, _cp_c3);
      return out;
    }
    //test if one bounding is inside or overlapping another bounding
    static isInsideAABB(a, b) {
      if (a.min[0] < b.min[0] || a.min[1] < b.min[1] || a.min[2] < b.min[2] || a.max[0] > b.max[0] || a.max[1] > b.max[1] || a.max[2] > b.max[2])
        return false;
      return true;
    }
    //from https://iquilezles.org/articles/distfunctions/
    static distanceToBox(point, min, max) {
      const centerx = (max[0] + min[0]) * 0.5;
      const centery = (max[1] + min[1]) * 0.5;
      const centerz = (max[2] + min[2]) * 0.5;
      const halfsizex = max[0] - centerx;
      const halfsizey = max[1] - centery;
      const halfsizez = max[2] - centerz;
      let x = Math.abs(point[0] - centerx) - halfsizex;
      let y = Math.abs(point[1] - centery) - halfsizey;
      let z = Math.abs(point[2] - centerz) - halfsizez;
      const d = Math.min(Math.max(x, y, z), 0);
      x = Math.max(x, 0);
      y = Math.max(y, 0);
      z = Math.max(z, 0);
      return Math.sqrt(x * x + y * y + z * z) + d;
    }
    static hitTestBox(origin, ray, box_min, box_max) {
      vec3.subtract(_hb_tMin, box_min, origin);
      vec3.subtract(_hb_tMax, box_max, origin);
      if (vec3.maxValue(_hb_tMin) < 0 && vec3.minValue(_hb_tMax) > 0)
        return new HitTest(0, origin, ray);
      _hb_inv[0] = 1 / ray[0];
      _hb_inv[1] = 1 / ray[1];
      _hb_inv[2] = 1 / ray[2];
      vec3.multiply(_hb_tMin, _hb_tMin, _hb_inv);
      vec3.multiply(_hb_tMax, _hb_tMax, _hb_inv);
      vec3.min(_hb_t1, _hb_tMin, _hb_tMax);
      vec3.max(_hb_t2, _hb_tMin, _hb_tMax);
      const tNear = vec3.maxValue(_hb_t1);
      const tFar = vec3.minValue(_hb_t2);
      if (tNear > 0 && tNear < tFar) {
        const hit = vec3.add(vec3.create(), vec3.scale(_hb_tmp, ray, tNear), origin);
        vec3.add(box_min, box_min, _hb_eps);
        vec3.subtract(box_min, box_min, _hb_eps);
        return new HitTest(tNear, hit, vec3.fromValues(
          Number(hit[0] > box_max[0]) - Number(hit[0] < box_min[0]),
          Number(hit[1] > box_max[1]) - Number(hit[1] < box_min[1]),
          Number(hit[2] > box_max[2]) - Number(hit[2] < box_min[2])
        ));
      }
      return null;
    }
    static hitTestTriangle(origin, ray, A, B, C, test_backfaces) {
      vec3.subtract(_ht_AB, B, A);
      vec3.subtract(_ht_AC, C, A);
      const normal = vec3.cross(vec3.create(), _ht_AB, _ht_AC);
      vec3.normalize(normal, normal);
      if (!test_backfaces && vec3.dot(normal, ray) > 0)
        return null;
      const t = vec3.dot(normal, vec3.subtract(_ht_tmp, A, origin)) / vec3.dot(normal, ray);
      if (t > 0) {
        const hit = vec3.scale(vec3.create(), ray, t);
        vec3.add(hit, hit, origin);
        vec3.subtract(_ht_toHit, hit, A);
        const dot00 = vec3.dot(_ht_AC, _ht_AC);
        const dot01 = vec3.dot(_ht_AC, _ht_AB);
        const dot02 = vec3.dot(_ht_AC, _ht_toHit);
        const dot11 = vec3.dot(_ht_AB, _ht_AB);
        const dot12 = vec3.dot(_ht_AB, _ht_toHit);
        const divide = dot00 * dot11 - dot01 * dot01;
        const u = (dot11 * dot02 - dot01 * dot12) / divide;
        const v = (dot00 * dot12 - dot01 * dot02) / divide;
        if (u >= 0 && v >= 0 && u + v <= 1)
          return new HitTest(t, hit, normal);
      }
      return null;
    }
    //from http://realtimecollisiondetection.net/blog/?p=103
    //radius must be squared
    static testSphereTriangle(P, rr, A_, B_, C_) {
      vec3.sub(_st_A, A_, P);
      vec3.sub(_st_B, B_, P);
      vec3.sub(_st_C, C_, P);
      vec3.sub(_st_AB, _st_B, _st_A);
      vec3.sub(_st_AC, _st_C, _st_A);
      vec3.cross(_st_V, _st_AB, _st_AC);
      const d = vec3.dot(_st_A, _st_V);
      const e = vec3.dot(_st_V, _st_V);
      const sep1 = Number(d * d > rr * e);
      const aa = vec3.dot(_st_A, _st_A);
      const ab = vec3.dot(_st_A, _st_B);
      const ac = vec3.dot(_st_A, _st_C);
      const bb = vec3.dot(_st_B, _st_B);
      const bc = vec3.dot(_st_B, _st_C);
      const cc = vec3.dot(_st_C, _st_C);
      const sep2 = Number(aa > rr) & Number(ab > aa) & Number(ac > aa);
      const sep3 = Number(bb > rr) & Number(ab > bb) & Number(bc > bb);
      const sep4 = Number(cc > rr) & Number(ac > cc) & Number(bc > cc);
      const d1 = ab - aa;
      const d2 = bc - bb;
      const d3 = ac - cc;
      vec3.sub(_st_BC, _st_C, _st_B);
      vec3.sub(_st_CA, _st_A, _st_C);
      const e1 = vec3.dot(_st_AB, _st_AB);
      const e2 = vec3.dot(_st_BC, _st_BC);
      const e3 = vec3.dot(_st_CA, _st_CA);
      const Q1 = vec3.scale(vec3.create(), _st_A, e1);
      vec3.sub(Q1, Q1, vec3.scale(vec3.create(), _st_AB, d1));
      const Q2 = vec3.scale(vec3.create(), _st_B, e2);
      vec3.sub(Q2, Q2, vec3.scale(vec3.create(), _st_BC, d2));
      const Q3 = vec3.scale(vec3.create(), _st_C, e3);
      vec3.sub(Q3, Q3, vec3.scale(vec3.create(), _st_CA, d3));
      const QC = vec3.sub(vec3.create(), vec3.scale(vec3.create(), _st_C, e1), Q1);
      const QA = vec3.sub(vec3.create(), vec3.scale(vec3.create(), _st_A, e2), Q2);
      const QB = vec3.sub(vec3.create(), vec3.scale(vec3.create(), _st_B, e3), Q3);
      const sep5 = Number(vec3.dot(Q1, Q1) > rr * e1 * e1) & Number(vec3.dot(Q1, QC) > 0);
      const sep6 = Number(vec3.dot(Q2, Q2) > rr * e2 * e2) & Number(vec3.dot(Q2, QA) > 0);
      const sep7 = Number(vec3.dot(Q3, Q3) > rr * e3 * e3) & Number(vec3.dot(Q3, QB) > 0);
      const separated = sep1 | sep2 | sep3 | sep4 | sep5 | sep6 | sep7;
      return !separated;
    }
    static testSphereBox(center, radius2, box_min, box_max) {
      let s, d = 0;
      for (let i = 0; i < 3; ++i) {
        if (center[i] < box_min[i]) {
          s = center[i] - box_min[i];
          d += s * s;
        } else if (center[i] > box_max[i]) {
          s = center[i] - box_max[i];
          d += s * s;
        }
      }
      if (d <= radius2) {
        return true;
      }
      return false;
    }
  };
  _Octree.MAX_NODE_TRIANGLES_RATIO = 0.05;
  _Octree.MAX_OCTREE_DEPTH = 8;
  _Octree.OCTREE_MARGIN_RATIO = 0.01;
  _Octree.OCTREE_MIN_MARGIN = 0.1;
  //mode
  _Octree.NEAREST = 0;
  //returns the nearest collision
  _Octree.FIRST = 1;
  //returns the first collision
  _Octree.ALL = 2;
  var Octree = _Octree;

  // src/unwrapper.ts
  var Chart = class {
    constructor() {
      this.width = -1;
      this.height = -1;
      this.x = -1;
      this.y = -1;
      this.area = -1;
      this.edges = [];
      this.triangles = [];
      /** Owning block, set by Block.addChart(). */
      this.block = null;
    }
    addTriangle(Ai, Bi, Ci, A, B, C) {
      for (let i = 0; i < this.edges.length; ++i) {
        const edge = this.edges[i];
        if (edge[0] == Ai) {
        }
      }
    }
    mergeWith(chart) {
    }
    computeInfo() {
    }
  };
  var Block = class {
    constructor() {
      this.by_edge = {};
      this.charts = [];
    }
    addChart(chart) {
      chart.block = this;
      this.charts.push(chart);
    }
    removeChart(chart) {
      const index = this.charts.indexOf(chart);
      if (index != -1) this.charts.splice(index, 1);
      for (const edge of chart.edges) {
        delete this.by_edge[edge[0] + "," + edge[1]];
      }
    }
  };
  var _Unwrapper = class _Unwrapper {
    constructor(mesh, options) {
      const verticesBuffer = mesh.vertexBuffers["vertices"];
      const indicesBuffer = mesh.indexBuffers["triangles"];
      if (!indicesBuffer) {
        console.error("Only can generate UVs from indexed meshes");
        return;
      }
      const vertices = verticesBuffer.data;
      const indices = indicesBuffer.data;
      const num_triangles = indices.length / 3;
      const blocks = [];
      for (let i = 0; i < 6; ++i) blocks[i] = new _Unwrapper.Block();
      const AB = vec3.create();
      const BC = vec3.create();
      const CA = vec3.create();
      const N = vec3.create();
      const BVs = new Float32Array(6);
      const chart_candidates = new Array(3);
      for (let i = 0; i < num_triangles; ++i) {
        const Ai = indices[i * 3];
        const Bi = indices[i * 3 + 1];
        const Ci = indices[i * 3 + 2];
        const A = vertices.subarray(Ai, Ai + 3);
        const B = vertices.subarray(Bi, Bi + 3);
        const C = vertices.subarray(Ci, Ci + 3);
        vec3.sub(AB, B, A);
        vec3.sub(BC, B, C);
        vec3.sub(CA, A, C);
        vec3.cross(N, AB, CA);
        const len = vec3.length(N);
        vec3.scale(N, N, -len);
        let max = -2;
        let block_id = -1;
        BVs[0] = N[0];
        BVs[1] = N[1];
        BVs[2] = N[2];
        BVs[3] = -N[0];
        BVs[4] = -N[1];
        BVs[5] = -N[2];
        for (let j = 0; j < 6; ++j) {
          if (BVs[j] < max) continue;
          block_id = j;
          max = BVs[j];
        }
        const block = blocks[block_id];
        const ABname = Ai + "," + Bi;
        const BCname = Bi + "," + Ci;
        const CAname = Ci + "," + Ai;
        chart_candidates[0] = block.by_edge[ABname];
        chart_candidates[1] = block.by_edge[BCname];
        chart_candidates[2] = block.by_edge[CAname];
        if (chart_candidates[0] && chart_candidates[1] && chart_candidates[0] != chart_candidates[1]) {
          chart_candidates[0].mergeWith(chart_candidates[1]);
          block.removeChart(chart_candidates[1]);
          chart_candidates[1] = null;
        }
        if (chart_candidates[0] && chart_candidates[2] && chart_candidates[0] != chart_candidates[2]) {
          chart_candidates[0].mergeWith(chart_candidates[2]);
          block.removeChart(chart_candidates[2]);
          chart_candidates[2] = null;
        }
        if (chart_candidates[1] && chart_candidates[2] && chart_candidates[1] != chart_candidates[2]) {
          chart_candidates[1].mergeWith(chart_candidates[2]);
          block.removeChart(chart_candidates[2]);
          chart_candidates[2] = null;
        }
        let final_chart = chart_candidates[0] || chart_candidates[1] || chart_candidates[2];
        if (!final_chart) {
          final_chart = new _Unwrapper.Chart();
          block.addChart(final_chart);
        }
        final_chart.addTriangle(A, B, C);
      }
      let final_chart_list = [];
      for (let i = 0; i < blocks.length; ++i) {
        const block = blocks[i];
        if (block) final_chart_list = final_chart_list.concat(block.charts);
      }
      let total_area = 0;
      for (let i = 0; i < final_chart_list.length; ++i) {
        const chart = final_chart_list[i];
        chart.computeInfo();
        total_area += chart.area;
      }
      final_chart_list.sort(function(A, B) {
        return A.area - B.area;
      });
      let area_size = Math.sqrt(total_area);
      for (let i = 0; i < final_chart_list.length; ++i) {
        const chart = final_chart_list[i];
        if (area_size < chart.width) area_size = chart.width;
        if (area_size < chart.height) area_size = chart.height;
      }
      const root = { x: 0, y: 0, width: area_size, height: area_size };
    }
  };
  _Unwrapper.Block = Block;
  _Unwrapper.Chart = Chart;
  var Unwrapper = _Unwrapper;

  // src/index.ts
  var GL = {
    ...constants_exports,
    // reusable scratch vectors/matrices
    temp_vec3,
    temp2_vec3,
    temp_vec4,
    temp_quat,
    temp_mat3,
    temp_mat4,
    // context creation + helpers (core)
    create,
    mapKeyCode,
    augmentEvent,
    isMobile,
    // classes
    Indexer,
    Buffer: Buffer2,
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
    getTime,
    isPowerOfTwo,
    nearestPowerOfTwo,
    nextPowerOfTwo,
    cloneObject,
    createCanvas,
    cloneCanvas,
    extendClass,
    loadFileAtlas,
    processFileAtlas,
    request: HttpRequest,
    // NB: on GL this is `request`; the bare global is `HttpRequest`
    // mutable runtime state (kept live via getters over the core module bindings)
    get last_context_id() {
      return last_context_id;
    },
    get reverse() {
      return reverse;
    },
    get dragging() {
      return dragging;
    },
    get last_pos() {
      return last_pos;
    }
  };
  var glob = globalThis;
  glob.GL = GL;
  glob.LiteGL = GL;
  var globalSymbols = {
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
    DEG2RAD,
    RAD2DEG,
    EPSILON,
    getTime,
    isPowerOfTwo,
    nearestPowerOfTwo,
    nextPowerOfTwo,
    isFunction,
    isArray,
    isNumber,
    getClassName,
    cloneObject,
    regexMap,
    createCanvas,
    cloneCanvas,
    wipeObject,
    extendClass,
    HttpRequest,
    // asymmetric: global name is HttpRequest, GL name is request
    getFileExtension,
    loadFileAtlas,
    processFileAtlas,
    typedArrayToArray,
    RGBToHex,
    HUEToRGB,
    HSLToRGB,
    hexColorToRGBA,
    toHalfFloat
  };
  for (const key in globalSymbols) {
    glob[key] = globalSymbols[key];
  }
  var index_default = GL;
})();
