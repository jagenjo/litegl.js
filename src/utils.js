//litegl.js (Javi Agenjo 2014 @tamat)
//forked from lightgl.js by Evan Wallace (madebyevan.com)
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
	//return new Date().getTime();
  return performance.now();
}

function isFunction(obj) {
  return !!(obj && obj.constructor && obj.call && obj.apply);
}

function isArray(obj) {
  return (obj && obj.constructor === Array );
  //var str = Object.prototype.toString.call(obj);
  //return str == '[object Array]' || str == '[object Float32Array]';
}

function isNumber(obj) {
  return (obj != null && obj.constructor === Number );
}


/* SLOW because accepts booleans
function isNumber(obj) {
  var str = Object.prototype.toString.call(obj);
  return str == '[object Number]' || str == '[object Boolean]';
}
*/

//given a regular expression, a text and a callback, it calls the function every time it finds it
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

function cloneCanvas(c) {
    var canvas = document.createElement('canvas');
    canvas.width = c.width;
    canvas.height = c.height;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(c,0,0);
    return canvas;
}


String.prototype.replaceAll = function(words){
	var str = this;
	for(var i in words)
		str = str.split(i).join(words[i]);
    return str;
};

//avoid errors when Typed array is expected and regular array is found
//Array.prototype.subarray = Array.prototype.slice;
Object.defineProperty(Array.prototype, "subarray", { value: Array.prototype.slice, enumerable: false });


// remove all properties on obj, effectively reverting it to a new object (to reduce garbage)
function wipeObject(obj)
{
  for (var p in obj)
  {
    if (obj.hasOwnProperty(p))
      delete obj[p];
  }
};

function HttpRequest(url,data)
{
  var xhr = new XMLHttpRequest();
  xhr.open('POST', url, true);
  xhr.onload = function()
  {
    var response = this.response;
    if(this.status != 200)
    {
      LEvent.trigger(xhr,"fail",this.status);
      return;
    }
  }
  xhr.onerror = function(err)
  {
    LEvent.trigger(xhr,"fail",err);
  }

  return xhr;
}

//cheap simple promises
Object.defineProperty( XMLHttpRequest.prototype, "done", { enumerable: false, value: function(callback)
{
  LEvent.bind(this,"done", function(e,err) { callback(err); } );
  return this;
}});

Object.defineProperty( XMLHttpRequest.prototype, "fail", { enumerable: false, value: function(callback)
{
  LEvent.bind(this,"fail", function(e,err) { callback(err); } );
  return this;
}});