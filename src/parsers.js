//***** OBJ parser adapted from SpiderGL implementation *****************
/**
* Parses a OBJ string and returns an object with the info ready to be passed to GL.Mesh.load
* @method Mesh.parseOBJ
* @param {String} data all the OBJ info to be parsed
* @param {Object} options
* @return {Object} mesh information (vertices, coords, normals, indices)
*/

Mesh.parseOBJ = function( text, options )
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

	var V_CODE = 1;
	var VT_CODE = 2;
	var VN_CODE = 3;
	var F_CODE = 4;
	var G_CODE = 5;
	var O_CODE = 6;
	var codes = { v: V_CODE, vt: VT_CODE, vn: VN_CODE, f: F_CODE, g: G_CODE, o: O_CODE };


	var lines = text.split("\n");
	var length = lines.length;
	for (var lineIndex = 0;  lineIndex < length; ++lineIndex) {
		line = lines[lineIndex].replace(/[ \t]+/g, " ").replace(/\s\s*$/, ""); //trim

		if (line[0] == "#") continue;
		if(line == "") continue;

		tokens = line.split(" ");
		var code = codes[ tokens[0] ];

		if(parsingFaces && code == V_CODE) //another mesh?
		{
			indices_offset = index;
			parsingFaces = false;
			//trace("multiple meshes: " + indices_offset);
		}

		//read and parse numbers
		if( code <= VN_CODE ) //v,vt,vn
		{
			x = parseFloat(tokens[1]);
			y = parseFloat(tokens[2]);
			if( code != VT_CODE )
			{
				if(tokens[3] == '\\') //super weird case, OBJ allows to break lines with slashes...
				{
					//HACK! only works if the var is the thirth position...
					++lineIndex;
					line = lines[lineIndex].replace(/[ \t]+/g, " ").replace(/\s\s*$/, ""); //better than trim
					z = parseFloat(line);
				}
				else
					z = parseFloat(tokens[3]);
			}
		}

		if (code == V_CODE) {
			if(flip_axis) //maya and max notation style
				positions.push(-1*x,z,y);
			else
				positions.push(x,y,z);
		}
		else if (code == VT_CODE) {
			texcoords.push(x,y);
		}
		else if (code == VN_CODE) {

			if(flip_normals)  //maya and max notation style
				normals.push(-y,-z,x);
			else
				normals.push(x,y,z);
		}
		else if (code == F_CODE) {
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

					if(i > 3 && skip_indices) //break polygon in triangles
					{
						//first
						var pl = positionsArray.length;
						positionsArray.push( positionsArray[pl - (i-3)*9], positionsArray[pl - (i-3)*9 + 1], positionsArray[pl - (i-3)*9 + 2]);
						positionsArray.push( positionsArray[pl - 3], positionsArray[pl - 2], positionsArray[pl - 1]);
						pl = texcoordsArray.length;
						texcoordsArray.push( texcoordsArray[pl - (i-3)*6], texcoordsArray[pl - (i-3)*6 + 1]);
						texcoordsArray.push( texcoordsArray[pl - 2], texcoordsArray[pl - 1]);
						pl = normalsArray.length;
						normalsArray.push( normalsArray[pl - (i-3)*9], normalsArray[pl - (i-3)*9 + 1], normalsArray[pl - (i-3)*9 + 2]);
						normalsArray.push( normalsArray[pl - 3], normalsArray[pl - 2], normalsArray[pl - 1]);
					}

					//add new vertex
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

					//add new texture coordinate
					x = 0.0;
					y = 0.0;
					if ((tex * 2 + 1) < texcoords.length) {
						hasTex = true;
						x = texcoords[tex*2+0];
						y = texcoords[tex*2+1];
					}
					texcoordsArray.push(x,y);

					//add new normal
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
		else if (code == G_CODE || tokens[0] == "usemtl") {
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

	if(!positions.length)
	{
		console.error("OBJ doesnt have vertices, maybe the file is not a OBJ");
		return null;
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

	if(options.only_data)
		return mesh;

	//creates and returns a GL.Mesh
	var final_mesh = null;
	final_mesh = Mesh.load( mesh, null, options.mesh );
	final_mesh.updateBounding();
	return final_mesh;
}

Mesh.parsers["obj"] = Mesh.parseOBJ;

Mesh.encoders["obj"] = function( mesh, options )
{
	//store vertices
	var verticesBuffer = mesh.getBuffer("vertices");
	if(!verticesBuffer)
		return null;

	var result = "# Generated with liteGL.js by Javi Agenjo\n\n";

	var vertices = verticesBuffer.data;
	for (var i = 0; i < vertices.length; i+=3)
		result += "v " + vertices[i].toFixed(4) + " " + vertices[i+1].toFixed(4) + " " + vertices[i+2].toFixed(4) + "\n";

	//store normals
	var normalsBuffer = mesh.getBuffer("normals");
	if(normalsBuffer)
	{
		result += "\n";
		var normals = normalsBuffer.data;
		for (var i = 0; i < normals.length; i+=3)
			result += "vn " + normals[i].toFixed(4) + " " + normals[i+1].toFixed(4) + " " + normals[i+2].toFixed(4) + "\n";
	}
	
	//store uvs
	var coordsBuffer = mesh.getBuffer("coords");
	if(coordsBuffer)
	{
		result += "\n";
		var coords = coordsBuffer.data;
		for (var i = 0; i < coords.length; i+=2)
			result += "vt " + coords[i].toFixed(4) + " " + coords[i+1].toFixed(4) + " " + " 0.0000\n";
	}

	result += "\ng mesh\n";

	//store faces
	var indicesBuffer = mesh.getIndexBuffer("triangles");
	if(indicesBuffer)
	{
		var indices = indicesBuffer.data;
		for (var i = 0; i < indices.length; i+=3)
			result += "f " + (indices[i]+1) + "/" + (indices[i]+1) + "/" + (indices[i]+1) + " " + (indices[i+1]+1) + "/" + (indices[i+1]+1) + "/" + (indices[i+1]+1) + " " + (indices[i+2]+1) + "/" + (indices[i+2]+1) + "/" + (indices[i+2]+1) + "\n";
	}
	else //no indices
	{
		for (var i = 0; i < (vertices.length / 3); i+=3)
			result += "f " + (i+1) + "/" + (i+1) + "/" + (i+1) + " " + (i+2) + "/" + (i+2) + "/" + (i+2) + " " + (i+3) + "/" + (i+3) + "/" + (i+3) + "\n";
	}
	
	return result;
}

/* BINARYU FORMAT ************************************/

if(global.WBin)
	global.WBin.classes["Mesh"] = Mesh;

Mesh.binary_file_formats["wbin"] = true;

Mesh.parsers["wbin"] = Mesh.fromBinary = function( data_array, options )
{
	if(!global.WBin)
		throw("To use binary meshes you need to install WBin.js from https://github.com/jagenjo/litescene.js/blob/master/src/utils/wbin.js ");

	options = options || {};

	var o = null;
	if( data_array.constructor == ArrayBuffer )
		o = WBin.load( data_array, true );
	else
		o = data_array;

	if(!o.info)
		console.warn("This WBin doesn't seem to contain a mesh. Classname: ", o["@classname"] );

	if( o.format )
		GL.Mesh.decompress( o );

	var vertex_buffers = {};
	if(o.vertex_buffers)
	{
		for(var i in o.vertex_buffers)
			vertex_buffers[ o.vertex_buffers[i] ] = o[ o.vertex_buffers[i] ];
	}
	else
	{
		if(o.vertices) vertex_buffers.vertices = o.vertices;
		if(o.normals) vertex_buffers.normals = o.normals;
		if(o.coords) vertex_buffers.coords = o.coords;
		if(o.weights) vertex_buffers.weights = o.weights;
		if(o.bone_indices) vertex_buffers.bone_indices = o.bone_indices;
	}

	var index_buffers = {};
	if( o.index_buffers )
	{
		for(var i in o.index_buffers)
			index_buffers[ o.index_buffers[i] ] = o[ o.index_buffers[i] ];
	}
	else
	{
		if(o.triangles) index_buffers.triangles = o.triangles;
		if(o.wireframe) index_buffers.wireframe = o.wireframe;
	}

	var mesh = { 
		vertex_buffers: vertex_buffers,
		index_buffers: index_buffers,
		bounding: o.bounding,
		info: o.info
	};

	if(o.bones)
	{
		mesh.bones = o.bones;
		//restore Float32array
		for(var i = 0; i < mesh.bones.length; ++i)
			mesh.bones[i][1] = mat4.clone(mesh.bones[i][1]);
		if(o.bind_matrix)
			mesh.bind_matrix = mat4.clone( o.bind_matrix );		
	}

	if(options.only_data)
		return mesh;

	//build mesh object
	var final_mesh = options.mesh || new GL.Mesh();
	final_mesh.configure( mesh );
	return final_mesh;
}

Mesh.encoders["wbin"] = function( mesh, options )
{
	return mesh.toBinary( options );
}

Mesh.prototype.toBinary = function( options )
{
	if(!global.WBin)
		throw("to use Mesh.toBinary you need to have WBin included. Check the repository for wbin.js");

	if(!this.info)
		this.info = {};

	//clean data
	var o = {
		object_class: "Mesh",
		info: this.info,
		groups: this.groups
	};

	if(this.bones)
	{
		var bones = [];
		//convert to array
		for(var i = 0; i < this.bones.length; ++i)
			bones.push([ this.bones[i][0], mat4.toArray( this.bones[i][1] ) ]);
		o.bones = bones;
		if(this.bind_matrix)
			o.bind_matrix = this.bind_matrix;
	}

	//bounding box
	if(!this.bounding)	
		this.updateBounding();
	o.bounding = this.bounding;

	var vertex_buffers = [];
	var index_buffers = [];

	for(var i in this.vertexBuffers)
	{
		var stream = this.vertexBuffers[i];
		o[ stream.name ] = stream.data;
		vertex_buffers.push( stream.name );

		if(stream.name == "vertices")
			o.info.num_vertices = stream.data.length / 3;
	}

	for(var i in this.indexBuffers)
	{
		var stream = this.indexBuffers[i];
		o[i] = stream.data;
		index_buffers.push( i );
	}

	o.vertex_buffers = vertex_buffers;
	o.index_buffers = index_buffers;

	//compress wbin using the bounding
	if( GL.Mesh.enable_wbin_compression ) //apply compression
		GL.Mesh.compress( o );

	//create pack file
	var bin = WBin.create( o, "Mesh" ); 
	return bin;
}

Mesh.compress = function( o, format )
{
	format = format || "bounding_compressed";
	o.format = {
		type: format
	};

	var func = Mesh.compressors[ format ];
	if(!func)
		throw("compression format not supported:" + format );
	return func( o );
}

Mesh.decompress = function( o )
{
	if(!o.format)
		return;
	var func = Mesh.decompressors[ o.format.type ];
	if(!func)
		throw("decompression format not supported:" + o.format.type );
	return func( o );
}

Mesh.compressors["bounding_compressed"] = function(o)
{
	if(!o.vertex_buffers)
		throw("buffers not found");

	var min = BBox.getMin( o.bounding );
	var max = BBox.getMax( o.bounding );
	var range = vec3.sub( vec3.create(), max, min );

	var vertices = o.vertices;
	var new_vertices = new Uint16Array( vertices.length );
	for(var i = 0; i < vertices.length; i+=3)
	{
		new_vertices[i] = ((vertices[i] - min[0]) / range[0]) * 65535;
		new_vertices[i+1] = ((vertices[i+1] - min[1]) / range[1]) * 65535;
		new_vertices[i+2] = ((vertices[i+2] - min[2]) / range[2]) * 65535;
	}
	o.vertices = new_vertices;		

	if( o.normals )
	{
		var normals = o.normals;
		var new_normals = new Uint8Array( normals.length );
		var normals_range = new_normals.constructor == Uint8Array ? 255 : 65535;
		for(var i = 0; i < normals.length; i+=3)
		{
			new_normals[i] = (normals[i] * 0.5 + 0.5) * normals_range;
			new_normals[i+1] = (normals[i+1] * 0.5 + 0.5) * normals_range;
			new_normals[i+2] = (normals[i+2] * 0.5 + 0.5) * normals_range;
		}
		o.normals = new_normals;
	}

	if( o.coords )
	{
		//compute uv bounding: [minu,minv,maxu,maxv]
		var coords = o.coords;
		var uvs_bounding = [10000,10000,-10000,-10000];
		for(var i = 0; i < coords.length; i+=2)
		{
			var u = coords[i];
			if( uvs_bounding[0] > u ) uvs_bounding[0] = u;
			else if( uvs_bounding[2] < u ) uvs_bounding[2] = u;
			var v = coords[i+1];
			if( uvs_bounding[1] > v ) uvs_bounding[1] = v;
			else if( uvs_bounding[3] < v ) uvs_bounding[3] = v;
		}
		o.format.uvs_bounding = uvs_bounding;

		var new_coords = new Uint16Array( coords.length );
		var range = [ uvs_bounding[2] - uvs_bounding[0], uvs_bounding[3] - uvs_bounding[1] ];
		for(var i = 0; i < coords.length; i+=2)
		{
			new_coords[i] = ((coords[i] - uvs_bounding[0]) / range[0]) * 65535;
			new_coords[i+1] = ((coords[i+1] - uvs_bounding[1]) / range[1]) * 65535;
		}
		o.coords = new_coords;
	}

	if( o.weights )
	{
		var weights = o.weights;
		var new_weights = new Uint16Array( weights.length ); //using only one byte distorts the meshes a lot
		var weights_range = new_weights.constructor == Uint8Array ? 255 : 65535;
		for(var i = 0; i < weights.length; i+=4)
		{
			new_weights[i] = weights[i] * weights_range;
			new_weights[i+1] = weights[i+1] * weights_range;
			new_weights[i+2] = weights[i+2] * weights_range;
			new_weights[i+3] = weights[i+3] * weights_range;
		}
		o.weights = new_weights;
	}
}


Mesh.decompressors["bounding_compressed"] = function(o)
{
	var bounding = o.bounding;
	if(!bounding)
		throw("error in mesh decompressing data: bounding not found, cannot use the bounding decompression.");

	var min = BBox.getMin( bounding );
	var max = BBox.getMax( bounding );
	var range = vec3.sub( vec3.create(), max, min );

	var format = o.format;

	var inv8 = 1 / 255;
	var inv16 = 1 / 65535;
	var vertices = o.vertices;
	var new_vertices = new Float32Array( vertices.length );
	for( var i = 0, l = vertices.length; i < l; i += 3 )
	{
		new_vertices[i] = ((vertices[i] * inv16) * range[0]) + min[0];
		new_vertices[i+1] = ((vertices[i+1] * inv16) * range[1]) + min[1];
		new_vertices[i+2] = ((vertices[i+2] * inv16) * range[2]) + min[2];
	}
	o.vertices = new_vertices;		

	if( o.normals && o.normals.constructor != Float32Array )
	{
		var normals = o.normals;
		var new_normals = new Float32Array( normals.length );
		var inormals_range = normals.constructor == Uint8Array ? inv8 : inv16;
		for( var i = 0, l = normals.length; i < l; i += 3 )
		{
			new_normals[i] = (normals[i] * inormals_range) * 2.0 - 1.0;
			new_normals[i+1] = (normals[i+1] * inormals_range) * 2.0 - 1.0;
			new_normals[i+2] = (normals[i+2] * inormals_range) * 2.0 - 1.0;
			var N = new_normals.subarray(i,i+3);
			vec3.normalize(N,N);
		}
		o.normals = new_normals;
	}

	if( o.coords && format.uvs_bounding && o.coords.constructor != Float32Array )
	{
		var coords = o.coords;
		var uvs_bounding = format.uvs_bounding;
		var range = [ uvs_bounding[2] - uvs_bounding[0], uvs_bounding[3] - uvs_bounding[1] ];
		var new_coords = new Float32Array( coords.length );
		for( var i = 0, l = coords.length; i < l; i += 2 )
		{
			new_coords[i] = (coords[i] * inv16) * range[0] + uvs_bounding[0];
			new_coords[i+1] = (coords[i+1] * inv16) * range[1] + uvs_bounding[1];
		}
		o.coords = new_coords;
	}

	//bones are already in Uint8 format so dont need to compress them further, but weights yes
	if( o.weights && o.weights.constructor != Float32Array ) //do we really need to unpack them? what if we use them like this?
	{
		var weights = o.weights;
		var new_weights = new Float32Array( weights.length );
		var iweights_range = weights.constructor == Uint8Array ? inv8 : inv16;
		for(var i = 0, l = weights.length; i < l; i += 4 )
		{
			new_weights[i] = weights[i] * iweights_range;
			new_weights[i+1] = weights[i+1] * iweights_range;
			new_weights[i+2] = weights[i+2] * iweights_range;
			new_weights[i+3] = weights[i+3] * iweights_range;
		}
		o.weights = new_weights;
	}
}