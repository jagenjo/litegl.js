
var gl;
var DEG2RAD = 0.0174532925;
var RAD2DEG = 57.295779578552306;
var EPSILON = 0.000001;

var global = window; //todo: change this to be common js

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
if(typeof(performance) != "undefined")
  global.getTime = performance.now.bind(performance);
else
  global.getTime = Date.now.bind( Date );



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

//copy methods from origin to target
function extendClass( target, origin ) {
	for(var i in origin) //copy class properties
	{
		if(target.hasOwnProperty(i))
			continue;
		target[i] = origin[i];
	}

	if(origin.prototype) //copy prototype properties
		for(var i in origin.prototype) //only enumerables
		{
			if(!origin.prototype.hasOwnProperty(i)) 
				continue;

			if(target.prototype.hasOwnProperty(i)) //avoid overwritting existing ones
				continue;

			//copy getters 
			if(origin.prototype.__lookupGetter__(i))
				target.prototype.__defineGetter__(i, origin.prototype.__lookupGetter__(i));
			else 
				target.prototype[i] = origin.prototype[i];

			//and setters
			if(origin.prototype.__lookupSetter__(i))
				target.prototype.__defineSetter__(i, origin.prototype.__lookupSetter__(i));
		}
}




//simple http request
function HttpRequest(url,params, callback, error, sync)
{
	if(params)
	{
		var params_str = null;
		var params_arr = [];
		for(var i in params)
			params_arr.push(i + "=" + params[i]);
		params_str = params_arr.join("&");
		url = url + "?" + params_str;
	}

	var xhr = new XMLHttpRequest();
	xhr.open('GET', url, !sync);
	xhr.onload = function()
	{
		var response = this.response;
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

	xhr.onerror = function(err)
	{
		LEvent.trigger(xhr,"fail",err);
	}

	xhr.send();

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


//allows to pack several (text)files inside one single file (useful for shaders)
//every file must start with \filename.ext  or /filename.ext
function loadFileAtlas(url, callback, sync)
{
	var deferred_callback = null;

	HttpRequest(url, null, function(data) {
		var files = processFileAtlas(data); 
		if(callback)
			callback(files);
		if(deferred_callback)
			deferred_callback(files);
	}, alert, sync);

	return { done: function(callback) { deferred_callback = callback; } };

	function processFileAtlas(data, callback)
	{
		//var reg = /^[a-z0-9/_]+$/i;
		var lines = data.split("\n");
		var files = {};
		var file = [];
		var filename = "";
		for(var i in lines)
		{
			var line = lines[i].trim();
			if(!line.length)
				continue;
			if( line[0] == "\\") // || (line[0] == '/' && reg.test( line[1] ) ) //allow to use forward slash instead of backward slash
			{
				if(!filename)
				{
					filename = line.substr(1);
					continue;
				}
				inner_newfile();
			}
			else
				file.push(line);
		}

		if(filename)
			inner_newfile();

		function inner_newfile()
		{
			var resource = file.join("\n");
			files[ filename ] = resource;
			file.length = 0;
			filename = line.substr(1);
		}

		return files;
	}
}

