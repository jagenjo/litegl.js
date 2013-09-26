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
function getTime()
{
	return new Date().getTime();
}


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

Mesh.prototype.addVertexBuffer = function(name, attribute) {
	var buffer = this.vertexBuffers[attribute] = new Buffer(gl.ARRAY_BUFFER, Float32Array);
	buffer.name = name;
	this[name] = []; //this created a regular array

	if (Mesh.common_buffers[name])
		buffer.spacing = Mesh.common_buffers[name].size;
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

	var center = vec3.scale( vec3.add(min,max, vec3.create() ), 0.5);
	var half_size = vec3.subtract( max, center, vec3.create() );

	this.bounding.aabb_center = vec3.toArray( center );
	this.bounding.aabb_half = vec3.toArray( half_size );
	this.bounding.aabb_min = vec3.toArray(min);
	this.bounding.aabb_max = vec3.toArray(max);
	this.bounding.radius = vec3.length( half_size );
}

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
* @param {Object} options valid options: detail, detailX, detailY, xz
*/
Mesh.plane = function(options) {
	options = options || {};
	options.triangles = [];
	var mesh = new Mesh(options);
	var detailX = options.detailX || options.detail || 1;
	var detailY = options.detailY || options.detail || 1;
	var xz = options.xz;

	var triangles = mesh.triangles;
	var vertices = mesh.vertices;
	var coords = mesh.coords;
	var normals = mesh.normals;

	for (var y = 0; y <= detailY; y++) {
	var t = y / detailY;
	for (var x = 0; x <= detailX; x++) {
	  var s = x / detailX;
	  if(xz)
		  vertices.push(2 * s - 1, 0, 2 * t - 1);
	  else
		  vertices.push(2 * s - 1, 2 * t - 1, 0);
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
		aabb_half: xz ? [s,0,s] : [s,s,0],
		aabb_min: xz ? [-s,0,-s] : [-s,-s,0],
		aabb_max: xz ? [s,0,s] : [s,s,0],
		radius: vec3.length([s,0,s])
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

/**
* Texture class to upload images to the GPU
* @class Texture
* @constructor
*/
function Texture(width, height, options) {
	options = options || {};
	if(typeof(width) != "number" || typeof(height) != "number")
		throw("GL.Texture width and height must be number");
	this.handler = gl.createTexture();
	this.width = width;
	this.height = height;
	this.format = options.format || gl.RGBA; //gl.DEPTH_COMPONENT
	this.type = options.type || gl.UNSIGNED_BYTE; //gl.UNSIGNED_SHORT
	this.texture_type = options.texture_type || gl.TEXTURE_2D;
	this.magFilter = options.magFilter || options.filter || gl.LINEAR;
	this.minFilter = options.minFilter || options.filter || gl.LINEAR;


	this.has_mipmaps = false;

	if(this.format == gl.DEPTH_COMPONENT)
	{
		this.depth_ext = gl.getExtension("WEBGL_depth_texture") || gl.getExtension("WEBKIT_WEBGL_depth_texture") || gl.getExtension("MOZ_WEBGL_depth_texture");
		if(!this.depth_ext)
			throw("Depth Texture not supported");
	}

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
		gl.texParameteri(this.texture_type, gl.TEXTURE_WRAP_S, options.wrap || options.wrapS || gl.CLAMP_TO_EDGE);
		gl.texParameteri(this.texture_type, gl.TEXTURE_WRAP_T, options.wrap || options.wrapT || gl.CLAMP_TO_EDGE);

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
* Given an Image it uploads it to the GPU
* @method uploadImage
* @param {Image} img
*/
Texture.prototype.uploadImage = function(image)
{
	this.bind();
	try {
		gl.texImage2D(gl.TEXTURE_2D, 0, this.format, this.format, this.type, image);
		this.width = image.width;
		this.height = image.height;
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
		if(!Shader.screen_shader.shader)
			Shader.screen_shader.shader = new GL.Shader( Shader.screen_shader.vertex_shader, Shader.screen_shader.pixel_shader );
		gl.disable( gl.BLEND );
		gl.disable( gl.DEPTH_TEST );
		gl.disable( gl.CULL_FACE );

		var vertices = new Float32Array(18);
		var coords = [-1,-1, 1,1, -1,1,  -1,-1, 1,-1, 1,1 ];

		var mesh = new GL.Mesh.load({
			vertices: vertices,
			coords: coords});
		that.bind(0);
		Shader.screen_shader.shader.uniforms({texture: 0}).draw( mesh, gl.TRIANGLES );
	});

	if (target_texture.minFilter && target_texture.minFilter != gl.NEAREST && target_texture.minFilter != gl.LINEAR) {
		target_texture.bind();
		gl.generateMipmap(target_texture.texture_type);
		target_texture.has_mipmaps = true;
	}
	gl.bindTexture(target_texture.texture_type, null); //disable
}

/**
* Render texture to full viewport size
* @method toScreen
* @param {Shader} shader to apply, otherwise a default textured shader is applied
* @param {Object} uniforms for the shader if needed
*/
Texture.prototype.toScreen = function(shader, uniforms)
{
	//create default shader
	if(!Shader.screen_shader.shader)
		Shader.screen_shader.shader = new GL.Shader( Shader.screen_shader.vertex_shader, Shader.screen_shader.pixel_shader );

	shader = shader || Shader.screen_shader.shader;
	if(!Shader.screen_shader.mesh)
	{
		var vertices = new Float32Array(18);
		var coords = new Float32Array([-1,-1, 1,1, -1,1,  -1,-1, 1,-1, 1,1 ]);
		Shader.screen_shader.mesh = new GL.Mesh.load({
			vertices: vertices,
			coords: coords});
	}
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
* @method toScreen
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
* @param {Object} macros precompiler macros to be applied when compiling
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
				case 1: gl.uniform1fv(location, value); break;
				case 2: gl.uniform2fv(location, value); break;
				case 3: gl.uniform3fv(location, value); break;
				case 4: gl.uniform4fv(location, value); break;
				case 9: gl.uniformMatrix3fv(location, false,  value); break; //changed to false
				case 16: gl.uniformMatrix4fv(location, false, value); break;
				default: throw 'don\'t know how to load uniform "' + name + '" of length ' + value.length;
			}
		} else if (isArray(value))
		{
			switch (value.length) {
			case 1: gl.uniform1fv(location, new Float32Array(value)); break;
			case 2: gl.uniform2fv(location, new Float32Array(value)); break;
			case 3: gl.uniform3fv(location, new Float32Array(value)); break;
			case 4: gl.uniform4fv(location, new Float32Array(value)); break;
			case 9: gl.uniformMatrix3fv(location, false, new Float32Array([
							value[0], value[3], value[6],
							value[1], value[4], value[7],
							value[2], value[5], value[8]
						  ])); break;
			case 16: gl.uniformMatrix4fv(location, false, new Float32Array([
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
* Renders a mesh using this shader
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

//used to render one texture into another
Shader.screen_shader = {
	vertex_shader: "\n\
			precision highp float;\n\
			attribute vec3 a_vertex;\n\
			attribute vec2 a_coord;\n\
			varying vec2 coord;\n\
			void main() { \n\
				coord = a_coord; \n\
				gl_Position = vec4(coord * 2.0 - 1.0, 0.0, 1.0); \n\
			}\n\
			",
	pixel_shader: "\n\
			precision highp float;\n\
			uniform sampler2D texture;\n\
			varying vec2 coord;\n\
			void main() {\n\
				gl_FragColor = texture2D(texture, coord);\n\
			}\n\
			"
};

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

		gl.derivatives_supported = gl.getExtension('OES_standard_derivatives') || false ;

		//trigger the mainLoop if no other context has been created before
		if (this.contexts.length == 0) GL.animate();

		//add this canvas to the context that may need update(dt) events
		this.contexts.push(gl);

		var last_click_time = 0;
		function onmouse(e) {
			GL.augmentEvent(e, canvas);
			if(e.type == "mousedown")
			{
				canvas.removeEventListener("mousemove", onmouse);
				document.addEventListener("mousemove", onmouse);
				document.addEventListener("mouseup", onmouse);
				last_click_time = new Date().getTime();

				if(gl.onmousedown) gl.onmousedown(e);
			}
			else if(e.type == "mousemove" && gl.onmousemove)
			{ 
				//move should be propagated (otherwise other components may fail)
				var now = new Date().getTime();
				e.click_time = now - last_click_time;
				gl.onmousemove(e); 
				return; 
			} 
			else if(e.type == "mouseup")
			{
				canvas.addEventListener("mousemove", onmouse);
				document.removeEventListener("mousemove", onmouse);
				document.removeEventListener("mouseup", onmouse);
				var now = new Date().getTime();
				e.click_time = now - last_click_time;
				last_click_time = now;

				if(gl.onmouseup) gl.onmouseup(e);
			}
			else if(gl.onmousewheel && (e.type == "mousewheel" || e.type == "DOMMouseScroll"))
			{ 
				e.wheel = (e.wheelDeltaY != null ? e.wheelDeltaY : e.detail * -60);
				gl.onmousewheel(e);
			}

			e.stopPropagation();
			e.preventDefault();
			return false;
		}

		/**
		* Tells the system to capture mouse events on the canvas. This will trigger onmousedown, onmousemove, onmouseup, onmousewheel callbacks in the canvas.
		* @method gl.captureMouse
		* @param {boolean} capture_wheel capture also the mouse wheel
		*/
		gl.captureMouse = function(capture_wheel) {
			gl.keys = {};
			canvas.addEventListener("mousedown", onmouse);
			canvas.addEventListener("mousemove", onmouse);
			if(capture_wheel)
			{
				canvas.addEventListener("mousewheel", onmouse, false);
				canvas.addEventListener("DOMMouseScroll", onmouse, false);
			}
		}

		function onkey(e, prevent_default)
		{
			//trace(e);

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

		/**
		* Tells the system to capture key events on the canvas. This will trigger onkey
		* @method gl.captureKeys
		* @param {boolean} prevent_default prevent default behaviour (like scroll on the web, etc)
		*/
		gl.captureKeys = function( prevent_default ) {
			document.addEventListener("keydown", function(e) { onkey(e, prevent_default); });
			document.addEventListener("keyup", function(e) { onkey(e, prevent_default); });
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
		e.deltaX = 0;
		e.deltaY = 0;

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
			e.deltaX = e.mousex - this.last_pos[0];
			e.deltaY = e.mousey - this.last_pos[1];
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

		//update online if tab visible
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



