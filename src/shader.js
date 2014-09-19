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
	//expand macros
	var extra_code = "";
	if(macros)
		for(var i in macros)
			extra_code += "#define " + i + " " + (macros[i] ? macros[i] : "") + "\n";

	this.program = gl.createProgram();
	gl.attachShader(this.program, Shader.compileSource(gl.VERTEX_SHADER, extra_code + vertexSource));
	gl.attachShader(this.program, Shader.compileSource(gl.FRAGMENT_SHADER, extra_code + fragmentSource));
	gl.linkProgram(this.program);
	if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
		throw 'link error: ' + gl.getProgramInfoLog(this.program);
	}

	//Extract info from the shader
	this.attributes = {}; 
	this.uniformInfo = {};
	this.samplers = {};

	//extract info about the shader to speed up future processes
	this.extractShaderInfo();
}

Shader.compileSource = function(type, source)
{
	var shader = gl.createShader(type);
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		throw (type == gl.VERTEX_SHADER ? "Vertex" : "Fragment") + ' shader compile error: ' + gl.getShaderInfoLog(shader);
	}
	return shader;
}

Shader.prototype.extractShaderInfo = function()
{
	//extract uniforms info
	for(var i = 0, l = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS); i < l; ++i)
	{
		var data = gl.getActiveUniform( this.program, i);
		if(!data) break;

		var uniformName = data.name;

		//arrays have uniformName[0], strip the [] (also data.size tells you if it is an array)
		var pos = uniformName.indexOf("["); 
		if(pos != -1)
		{
			var pos2 = uniformName.indexOf("]."); //leave array of structs though
			if(pos2 == -1)
				uniformName = uniformName.substr(0,pos);
		}

		//store texture samplers
		if(data.type == gl.SAMPLER_2D || data.type == gl.SAMPLER_CUBE)
			this.samplers[ uniformName ] = data.type;
		
		//get which function to call when uploading this uniform
		var func = Shader.getUniformFunc(data);
		var is_matrix = false;
		if(data.type == gl.FLOAT_MAT2 || data.type == gl.FLOAT_MAT3 || data.type == gl.FLOAT_MAT4)
			is_matrix = true;


		//save the info so I the user doesnt have to specify types when uploading data to the shader
		this.uniformInfo[ uniformName ] = { type: data.type, func: func, size: data.size, is_matrix: is_matrix, loc: gl.getUniformLocation(this.program, uniformName) };
	}

	//extract attributes info
	for(var i = 0, l = gl.getProgramParameter(this.program, gl.ACTIVE_ATTRIBUTES); i < l; ++i)
	{
		var data = gl.getActiveAttrib( this.program, i);
		if(!data) break;
		var func = Shader.getUniformFunc(data);
		//this.uniformInfo[ data.name ] = { type: data.gl.getUniformLocation(this.program, data.name) };
		this.uniformInfo[ data.name ] = { type: data.type, func: func, size: data.size, loc: gl.getUniformLocation(this.program, data.name ) };
		this.attributes[ data.name ] = gl.getAttribLocation(this.program, data.name );	
	}
}

//Tells you which function to call when uploading a uniform according to the data type in the shader
Shader.getUniformFunc = function( data )
{
	var func = null;
	switch (data.type)
	{
		case gl.FLOAT: 		
			if(data.size == 1)
				func = gl.uniform1f; 
			else
				func = gl.uniform1fv; 
			break;
		case gl.FLOAT_MAT2: func = gl.uniformMatrix2fv; break;
		case gl.FLOAT_MAT3:	func = gl.uniformMatrix3fv; break;
		case gl.FLOAT_MAT4:	func = gl.uniformMatrix4fv; break;
		case gl.FLOAT_VEC2: func = gl.uniform2fv; break;
		case gl.FLOAT_VEC3: func = gl.uniform3fv; break;
		case gl.FLOAT_VEC4: func = gl.uniform4fv; break;

		case gl.UNSIGNED_INT: 
		case gl.INT: 	  
			if(data.size == 1)
				func = gl.uniform1i; 
			else
				func = gl.uniform1iv; 
			break;
		case gl.INT_VEC2: func = gl.uniform2iv; break;
		case gl.INT_VEC3: func = gl.uniform3iv; break;
		case gl.INT_VEC4: func = gl.uniform4iv; break;

		case gl.SAMPLER_2D:
		case gl.SAMPLER_CUBE:
			func = gl.uniform1i; break;
		default: func = gl.uniform1f; break;
	}	
	return func;
}


Shader.fromURL = function( vs_path, fs_path, on_complete )
{
	//create simple shader first
	var vs_code = "\n\
			precision highp float;\n\
			attribute vec3 a_vertex;\n\
			attribute mat4 u_mvp;\n\
			void main() { \n\
				gl_Position = u_mvp * vec4(a_vertex,1.0); \n\
			}\n\
		";
	var fs_code = "\n\
			precision highp float;\n\
			void main() {\n\
				gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);\n\
			}\n\
			";
	
	var shader = new GL.Shader(vs_code, fs_code);
	shader.ready = false;

	var true_vs = null;
	var true_fs = null;

	HttpRequest( vs_path, null, function(vs_code) {
		true_vs = vs_code;
		if(true_fs)
			compileShader();
	});

	HttpRequest( fs_path, null, function(fs_code) {
		true_fs = fs_code;
		if(true_vs)
			compileShader();
	});

	function compileShader()
	{
		var true_shader = new GL.Shader(true_vs, true_fs);
		for(var i in true_shader)
			shader[i] = true_shader[i];
		shader.ready = true;
	}

	return shader;
}


/**
* Uploads a set of uniforms to the Shader
* @method uniforms
* @param {Object} uniforms
*/

Shader._temp_uniform = new Float32Array(16);

Shader.prototype.uniforms = function(uniforms) {

	gl.useProgram(this.program);

	for (var name in uniforms) {
		var info = this.uniformInfo[name];
		if (!info)
			continue;

		var value = uniforms[name];
		if(value == null) continue;

		if(value.constructor === Array)
			value = new Float32Array(value);  //garbage...

		if(info.is_matrix)
			info.func.call( gl, info.loc, false, value );
		else
			info.func.call( gl, info.loc, value );
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

//this two variables are a hack to avoid memory allocation on drawCalls
Shader._temp_attribs_array = new Uint8Array(16);
Shader._temp_attribs_array_zero = new Uint8Array(16); //should be filled with zeros always

Shader.prototype.drawBuffers = function(vertexBuffers, indexBuffer, mode, range_start, range_length)
{
	if(range_length == 0) return;

	gl.useProgram(this.program); //this could be removed assuming every shader is called with some uniforms 

	// enable attributes as necessary.
	var length = 0;
	var attribs_in_use = Shader._temp_attribs_array; //hack to avoid garbage
	attribs_in_use.set( Shader._temp_attribs_array_zero ); //reset

	for (var name in vertexBuffers)
	{
		var buffer = vertexBuffers[name];
		var attribute = buffer.attribute || name;
		//precompute attribute locations in shader
		var location = this.attributes[attribute];// || gl.getAttribLocation(this.program, attribute);

		if (location == null || !buffer.buffer) //-1 changed for null
			continue; //ignore this buffer

		attribs_in_use[location] = 1; //mark it as used

		//this.attributes[attribute] = location;
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer.buffer);
		gl.enableVertexAttribArray(location);

		gl.vertexAttribPointer(location, buffer.buffer.spacing, buffer.buffer.gl_type, false, 0, 0);
		length = buffer.buffer.length / buffer.buffer.spacing;
	}

	//range rendering
	var offset = 0;
	if(range_start > 0) //render a polygon range
		offset = range_start * (indexBuffer ? indexBuffer.constructor.BYTES_PER_ELEMENT : 1); //in bytes (Uint16 == 2 bytes)

	if(range_length > 0)
		length = range_length;
	else if (indexBuffer)
		length = indexBuffer.buffer.length - offset;

	// Force to disable buffers in this shader that are not in this mesh
	for (var attribute in this.attributes)
	{
		var location = this.attributes[attribute];
		if (!(attribs_in_use[location])) {
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

Shader.SCREEN_VERTEX_SHADER = "\n\
			precision highp float;\n\
			attribute vec3 a_vertex;\n\
			attribute vec2 a_coord;\n\
			varying vec2 v_coord;\n\
			void main() { \n\
				v_coord = a_coord; \n\
				gl_Position = vec4(a_coord * 2.0 - 1.0, 0.0, 1.0); \n\
			}\n\
			";

Shader.SCREEN_FRAGMENT_SHADER = "\n\
			precision highp float;\n\
			uniform sampler2D u_texture;\n\
			varying vec2 v_coord;\n\
			void main() {\n\
				gl_FragColor = texture2D(u_texture, v_coord);\n\
			}\n\
			";

Shader.SCREEN_FLAT_FRAGMENT_SHADER = "\n\
			precision highp float;\n\
			uniform vec4 u_color;\n\
			varying vec2 v_coord;\n\
			void main() {\n\
				gl_FragColor = u_color;\n\
			}\n\
			";

//used to paint quads
Shader.QUAD_VERTEX_SHADER = "\n\
			precision highp float;\n\
			attribute vec3 a_vertex;\n\
			attribute vec2 a_coord;\n\
			varying vec2 v_coord;\n\
			uniform vec2 u_position;\n\
			uniform vec2 u_size;\n\
			uniform vec2 u_viewport;\n\
			uniform mat3 u_transform;\n\
			void main() { \n\
				v_coord = vec2(a_coord.x, 1.0 - a_coord.y); \n\
				vec3 pos = vec3(u_position + a_coord * u_size, 1.0);\n\
				pos = u_transform * pos;\n\
				pos.z = 0.0;\n\
				//normalize\n\
				pos.x = (2.0 * pos.x / u_viewport.x) - 1.0;\n\
				pos.y = -((2.0 * pos.y / u_viewport.y) - 1.0);\n\
				gl_Position = vec4(pos, 1.0); \n\
			}\n\
			";

Shader.QUAD_FRAGMENT_SHADER = "\n\
			precision highp float;\n\
			uniform sampler2D u_texture;\n\
			uniform vec4 u_color;\n\
			varying vec2 v_coord;\n\
			void main() {\n\
				gl_FragColor = u_color * texture2D(u_texture, v_coord);\n\
			}\n\
			";

Shader.PRIMITIVE2D_VERTEX_SHADER = "\n\
			precision highp float;\n\
			attribute vec3 a_vertex;\n\
			uniform vec2 u_viewport;\n\
			uniform mat3 u_transform;\n\
			void main() { \n\
				vec3 pos = a_vertex;\n\
				pos = u_transform * pos;\n\
				pos.z = 0.0;\n\
				//normalize\n\
				pos.x = (2.0 * pos.x / u_viewport.x) - 1.0;\n\
				pos.y = -((2.0 * pos.y / u_viewport.y) - 1.0);\n\
				gl_Position = vec4(pos, 1.0); \n\
			}\n\
			";

/**
* Renders a fullscreen quad with this shader applied
* @method toViewport
* @param {object} uniforms
*/
Shader.prototype.toViewport = function(uniforms)
{
	var mesh = Mesh.getScreenQuad();
	if(uniforms)
		this.uniforms(uniforms);
	this.draw( mesh );
}

//Now some common shaders everybody needs

/**
* Returns a shader ready to render a quad in fullscreen, use with Mesh.getScreenQuad() mesh
* @method Shader.getScreenShader
*/
Shader.getScreenShader = function()
{
	if(gl._screen_shader)
		return gl._screen_shader;

	var shader = new GL.Shader( Shader.SCREEN_VERTEX_SHADER, Shader.SCREEN_FRAGMENT_SHADER);
	gl._screen_shader = shader;
	return gl._screen_shader;
}

/**
* Returns a shader ready to render a quad with transform, use with Mesh.getScreenQuad() mesh
* shader must have: u_position, u_size, u_viewport, u_transform (mat3)
* @method Shader.getQuadShader
*/
Shader.getQuadShader = function()
{
	if(gl._quad_shader)
		return gl._quad_shader;

	var shader = new GL.Shader( Shader.QUAD_VERTEX_SHADER, Shader.QUAD_FRAGMENT_SHADER );
	gl._quad_shader = shader;
	return gl._quad_shader;
}

//Blur shader
Shader.getBlurShader = function()
{
	if(gl._blur_shader)
		return gl._blur_shader;

	var shader = new GL.Shader( Shader.SCREEN_VERTEX_SHADER,"\n\
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
	gl._blur_shader = shader;
	return gl._blur_shader;
}