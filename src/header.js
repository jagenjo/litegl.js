//litegl.js by Javi Agenjo 2014 @tamat (tamats.com)
//forked from lightgl.js by Evan Wallace (madebyevan.com)
"use strict";

(function(global){

var GL = global.GL = global.LiteGL = {};

if(typeof(glMatrix) == "undefined")
{
	if( typeof(self) != "undefined" ) //worker?
	{
		//DONT DO ANYTHING, whoever included this should also include glMatrix
		//console.log("importing glMatrix from worker");
		//import * as glMatrix from './core/libs/gl-matrix-min.js';		
		//importScripts("./gl-matrix-min.js");
	}
	else if( typeof(window) == "undefined" ) //nodejs?
	{
		if( typeof(SKIP_REQUIRES) === "undefined" )
		{
			console.log("importing glMatrix");
			//import * as glMatrix from './core/libs/gl-matrix-min.js';		
			global.glMatrix = require("./gl-matrix-min.js");
			var glMatrix = global.glMatrix;
			for(var i in glMatrix)
				global[i] = glMatrix[i];
		}
	}
	else if( typeof(glMatrix) == "undefined" )
		throw("litegl.js requires gl-matrix to work. It must be included before litegl.");
}
else
{
	if(!global.vec2)
		throw("litegl.js does not support gl-matrix 3.0, download 2.8 https://github.com/toji/gl-matrix/releases/tag/v2.8.1");
}

//polyfill
global.requestAnimationFrame = global.requestAnimationFrame || global.mozRequestAnimationFrame || global.webkitRequestAnimationFrame || function(callback) { setTimeout(callback, 1000 / 60); };

GL.blockable_keys = {"Up":true,"Down":true,"Left":true,"Right":true};

GL.reverse = null;

//some consts
//https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/button
GL.LEFT_MOUSE_BUTTON = 0;
GL.MIDDLE_MOUSE_BUTTON = 1;
GL.RIGHT_MOUSE_BUTTON = 2;

GL.LEFT_MOUSE_BUTTON_MASK = 1;
GL.RIGHT_MOUSE_BUTTON_MASK = 2;
GL.MIDDLE_MOUSE_BUTTON_MASK = 4;

GL.last_context_id = 0;


//Define WEBGL ENUMS as statics (more to come in WebGL 2)
//sometimes we need some gl enums before having the gl context, solution: define them globally because the specs says they are constant)

GL.COLOR_BUFFER_BIT = 16384;
GL.DEPTH_BUFFER_BIT = 256;
GL.STENCIL_BUFFER_BIT = 1024;

GL.TEXTURE_2D = 3553;
GL.TEXTURE_CUBE_MAP = 34067;
GL.TEXTURE_3D = 32879;

GL.TEXTURE_MAG_FILTER = 10240;
GL.TEXTURE_MIN_FILTER = 10241;
GL.TEXTURE_WRAP_S = 10242;
GL.TEXTURE_WRAP_T = 10243;

GL.BYTE = 5120;
GL.UNSIGNED_BYTE = 5121;
GL.SHORT = 5122;
GL.UNSIGNED_SHORT = 5123;
GL.INT = 5124;
GL.UNSIGNED_INT = 5125;
GL.FLOAT = 5126;
GL.HALF_FLOAT_OES = 36193; //webgl 1.0 only

//webgl2 formats
GL.HALF_FLOAT = 5131; 
GL.DEPTH_COMPONENT16 = 33189;
GL.DEPTH_COMPONENT24 = 33190;
GL.DEPTH_COMPONENT32F = 36012;

GL.FLOAT_VEC2 = 35664;
GL.FLOAT_VEC3 = 35665;
GL.FLOAT_VEC4 = 35666;
GL.INT_VEC2 = 35667;
GL.INT_VEC3 = 35668;
GL.INT_VEC4 = 35669;
GL.BOOL = 35670;
GL.BOOL_VEC2 = 35671;
GL.BOOL_VEC3 = 35672;
GL.BOOL_VEC4 = 35673;
GL.FLOAT_MAT2 = 35674;
GL.FLOAT_MAT3 = 35675;
GL.FLOAT_MAT4 = 35676;

//used to know the amount of data to reserve per uniform
GL.TYPE_LENGTH = {};
GL.TYPE_LENGTH[ GL.FLOAT ] = GL.TYPE_LENGTH[ GL.INT ] = GL.TYPE_LENGTH[ GL.BYTE ] = GL.TYPE_LENGTH[ GL.BOOL ] = 1;
GL.TYPE_LENGTH[ GL.FLOAT_VEC2 ] = GL.TYPE_LENGTH[ GL.INT_VEC2 ] = GL.TYPE_LENGTH[ GL.BOOL_VEC2 ] = 2;
GL.TYPE_LENGTH[ GL.FLOAT_VEC3 ] = GL.TYPE_LENGTH[ GL.INT_VEC3 ] = GL.TYPE_LENGTH[ GL.BOOL_VEC3 ] = 3;
GL.TYPE_LENGTH[ GL.FLOAT_VEC4 ] = GL.TYPE_LENGTH[ GL.INT_VEC4 ] = GL.TYPE_LENGTH[ GL.BOOL_VEC4 ] = 4;
GL.TYPE_LENGTH[ GL.FLOAT_MAT3 ] = 9;
GL.TYPE_LENGTH[ GL.FLOAT_MAT4 ] = 16;

GL.SAMPLER_2D = 35678;
GL.SAMPLER_3D = 35679;
GL.SAMPLER_CUBE = 35680;
GL.INT_SAMPLER_2D = 36298;
GL.INT_SAMPLER_3D = 36299;
GL.INT_SAMPLER_CUBE = 36300;
GL.UNSIGNED_INT_SAMPLER_2D = 36306;
GL.UNSIGNED_INT_SAMPLER_3D = 36307;
GL.UNSIGNED_INT_SAMPLER_CUBE = 36308;

GL.DEPTH_COMPONENT = 6402;
GL.ALPHA = 6406;
GL.RGB = 6407;
GL.RGBA = 6408;
GL.LUMINANCE = 6409;
GL.LUMINANCE_ALPHA = 6410;
GL.DEPTH_STENCIL = 34041;
GL.UNSIGNED_INT_24_8 = GL.UNSIGNED_INT_24_8_WEBGL = 34042;

//webgl2 formats
GL.R8 = 33321;
GL.R16F = 33325;
GL.R32F = 33326;
GL.R8UI = 33330;
GL.RG8 = 33323;
GL.RG16F = 33327;
GL.RG32F = 33328;
GL.RGB8 = 32849;
GL.SRGB8 = 35905;
GL.RGB565 = 36194;
GL.R11F_G11F_B10F = 35898;
GL.RGB9_E5 = 35901;
GL.RGB16F = 34843;
GL.RGB32F = 34837;
GL.RGB8UI = 36221;
GL.RGBA8 = 32856;
GL.RGB5_A1 = 32855;
GL.RGBA16F = 34842;
GL.RGBA32F = 34836;
GL.RGBA8UI = 36220;
GL.RGBA16I = 36232;
GL.RGBA16UI = 36214;
GL.RGBA32I = 36226;
GL.RGBA32UI = 36208;
GL.DEPTH24_STENCIL8 = 35056;

GL.NEAREST = 9728;
GL.LINEAR = 9729;
GL.NEAREST_MIPMAP_NEAREST = 9984;
GL.LINEAR_MIPMAP_NEAREST = 9985;
GL.NEAREST_MIPMAP_LINEAR = 9986;
GL.LINEAR_MIPMAP_LINEAR = 9987;

GL.REPEAT = 10497;
GL.CLAMP_TO_EDGE = 33071;
GL.MIRRORED_REPEAT = 33648;

GL.ZERO = 0;
GL.ONE = 1;
GL.SRC_COLOR = 768;
GL.ONE_MINUS_SRC_COLOR = 769;
GL.SRC_ALPHA = 770;
GL.ONE_MINUS_SRC_ALPHA = 771;
GL.DST_ALPHA = 772;
GL.ONE_MINUS_DST_ALPHA = 773;
GL.DST_COLOR = 774;
GL.ONE_MINUS_DST_COLOR = 775;
GL.SRC_ALPHA_SATURATE = 776;
GL.CONSTANT_COLOR = 32769;
GL.ONE_MINUS_CONSTANT_COLOR = 32770;
GL.CONSTANT_ALPHA = 32771;
GL.ONE_MINUS_CONSTANT_ALPHA = 32772;

GL.VERTEX_SHADER = 35633;
GL.FRAGMENT_SHADER = 35632;

GL.FRONT = 1028;
GL.BACK = 1029;
GL.FRONT_AND_BACK = 1032;

GL.NEVER = 512;
GL.LESS = 513;
GL.EQUAL = 514;
GL.LEQUAL = 515;
GL.GREATER = 516;
GL.NOTEQUAL = 517;
GL.GEQUAL = 518;
GL.ALWAYS = 519;

GL.KEEP = 7680;
GL.REPLACE = 7681;
GL.INCR = 7682;
GL.DECR = 7683;
GL.INCR_WRAP = 34055;
GL.DECR_WRAP = 34056;
GL.INVERT = 5386;

GL.STREAM_DRAW = 35040;
GL.STATIC_DRAW = 35044;
GL.DYNAMIC_DRAW = 35048;

GL.ARRAY_BUFFER = 34962;
GL.ELEMENT_ARRAY_BUFFER = 34963;

GL.POINTS = 0;
GL.LINES = 1;
GL.LINE_LOOP = 2;
GL.LINE_STRIP = 3;
GL.TRIANGLES = 4;
GL.TRIANGLE_STRIP = 5;
GL.TRIANGLE_FAN = 6;

GL.CW = 2304;
GL.CCW = 2305;

GL.CULL_FACE = 2884;
GL.DEPTH_TEST = 2929;
GL.BLEND = 3042;

GL.temp_vec3 = vec3.create();
GL.temp2_vec3 = vec3.create();
GL.temp_vec4 = vec4.create();
GL.temp_quat = quat.create();
GL.temp_mat3 = mat3.create();
GL.temp_mat4 = mat4.create();
