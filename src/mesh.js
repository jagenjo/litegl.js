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