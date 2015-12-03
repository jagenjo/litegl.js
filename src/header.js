//litegl.js by Javi Agenjo 2014 @tamat (tamats.com)
//forked from lightgl.js by Evan Wallace (madebyevan.com)
"use strict";

(function(global){

/**
* The static module that contains all the features
* @class GL
*/
var GL = global.GL = {};


//polyfill
global.requestAnimationFrame = global.requestAnimationFrame || global.mozRequestAnimationFrame || global.webkitRequestAnimationFrame || function(callback) { setTimeout(callback, 1000 / 60); };

GL.blockable_keys = {"Up":true,"Down":true,"Left":true,"Right":true};

//some consts
GL.LEFT_MOUSE_BUTTON = 1;
GL.RIGHT_MOUSE_BUTTON = 3;
GL.MIDDLE_MOUSE_BUTTON = 2;
GL.last_context_id = 0;


//Define WEBGL ENUMS as statics
//sometimes I need some gl enums before having the gl context, solution: define them globally because the specs says they are constant:

GL.BYTE = 5120;
GL.UNSIGNED_BYTE = 5121;
GL.SHORT = 5122;
GL.UNSIGNED_SHORT = 5123;
GL.INT = 5124;
GL.UNSIGNED_INT = 5125;
GL.FLOAT = 5126;

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

