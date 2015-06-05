/**
* Shader class to upload programs to the GPU
* @class Shader
* @constructor
* @param {String} vertexSource
* @param {String} fragmentSource
* @param {Object} macros (optional) precompiler macros to be applied when compiling
*/
global.Shader = GL.Shader = function Shader(vertexSource, fragmentSource, macros)
{
	//used to avoid problems with resources moving between different webgl context
	this._context_id = global.gl.context_id; 
	var gl = this.gl = global.gl;

	//expand macros
	var extra_code = "";
	if(macros)
		for(var i in macros)
			extra_code += "#define " + i + " " + (macros[i] ? macros[i] : "") + "\n";

	this.program = gl.createProgram();
	gl.attachShader(this.program, Shader.compileSource(gl.VERTEX_SHADER, extra_code + vertexSource),gl);
	gl.attachShader(this.program, Shader.compileSource(gl.FRAGMENT_SHADER, extra_code + fragmentSource),gl);
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

/**
* Compiles one single shader source (could be gl.VERTEX_SHADER or gl.FRAGMENT_SHADER) and returns the webgl shader handler 
* Used internaly to compile the vertex and fragment shader.
* It throws an exception if there is any error in the code
* @method Shader.compileSource
* @param {Number} type could be gl.VERTEX_SHADER or gl.FRAGMENT_SHADER
* @param {String} source the source file to compile
* @return {WebGLHandler}
*/
Shader.compileSource = function(type, source, gl)
{
	gl = gl || global.gl;
	var shader = gl.createShader(type);
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		throw (type == gl.VERTEX_SHADER ? "Vertex" : "Fragment") + ' shader compile error: ' + gl.getShaderInfoLog(shader);
	}
	return shader;
}

/**
* It extract all the info about the compiled shader program, all the info about uniforms and attributes.
* This info is stored so it works faster during rendering.
* @method extractShaderInfo
*/
Shader.prototype.extractShaderInfo = function()
{
	var gl = this.gl;
	
	var l = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS);

	//extract uniforms info
	for(var i = 0; i < l; ++i)
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

/**
* Returns if this shader has a uniform with the given name
* @method hasUniform
* @param {String} name name of the uniform
* @return {Boolean}
*/
Shader.prototype.hasUniform = function(name)
{
	return this.uniformInfo[name];
}

/**
* Returns if this shader has an attribute with the given name
* @method hasAttribute
* @param {String} name name of the attribute
* @return {Boolean}
*/
Shader.prototype.hasAttribute = function(name)
{
	return this.attributes[name];
}


/**
* Tells you which function to call when uploading a uniform according to the data type in the shader
* Used internally from extractShaderInfo to optimize calls 
* @method Shader.getUniformFunc
* @param {Object} data info about the uniform
* @return {Function}
*/
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

/**
* Create a shader from two urls. While the system is fetching the two urls, the shader contains a dummy shader that renders black.
* @method Shader.fromURL
* @param {String} vs_path the url to the vertex shader
* @param {String} fs_path the url to the fragment shader
* @param {Function} on_complete [Optional] a callback to call once the shader is ready.
* @return {Shader}
*/
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
* Uploads a set of uniforms to the Shader. You dont need to specify types, they are infered from the shader info.
* @method uniforms
* @param {Object} uniforms
*/
Shader._temp_uniform = new Float32Array(16);

Shader.prototype.uniforms = function(uniforms) {
	var gl = this.gl;
	gl.useProgram(this.program);

	for (var name in uniforms)
		this._assing_uniform(uniforms, name, gl );

	return this;
}//uniforms

Shader.prototype.uniformsArray = function(array) {
	var gl = this.gl;
	gl.useProgram(this.program);

	for(var i = 0, l = array.length; i < l; ++i)
	{
		var uniforms = array[i];
		for (var name in uniforms)
			this._assing_uniform(uniforms, name, gl );
	}

	return this;
}

Shader.prototype._assing_uniform = function(uniforms, name, gl)
{
	var info = this.uniformInfo[name];
	if (!info)
		return;

	var value = uniforms[name];
	if(value == null) 
		return;

	if(value.constructor === Array)
		value = new Float32Array(value);  //garbage generated...

	if(info.is_matrix)
		info.func.call( gl, info.loc, false, value );
	else
		info.func.call( gl, info.loc, value );
}

/**
* Renders a mesh using this shader, remember to use the function uniforms before to enable the shader
* @method draw
* @param {Mesh} mesh
* @param {number} mode could be gl.LINES, gl.POINTS, gl.TRIANGLES, gl.TRIANGLE_STRIP, gl.TRIANGLE_FAN
* @param {String} index_buffer_name the name of the index buffer, if not provided triangles will be assumed
*/
Shader.prototype.draw = function(mesh, mode, index_buffer_name ) {
	index_buffer_name = index_buffer_name === undefined ? (mode == gl.LINES ? 'lines' : 'triangles') : index_buffer_name;
	this.drawBuffers(mesh.vertexBuffers,
	  index_buffer_name ? mesh.indexBuffers[ index_buffer_name ] : null,
	  arguments.length < 2 ? gl.TRIANGLES : mode);
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
Shader.prototype.drawRange = function(mesh, mode, start, length, index_buffer_name )
{
	index_buffer_name = index_buffer_name === undefined ? (mode == gl.LINES ? 'lines' : 'triangles') : index_buffer_name;

	this.drawBuffers(mesh.vertexBuffers,
	  index_buffer_name ? mesh.indexBuffers[ index_buffer_name ] : null,
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
var temp_attribs_array = new Uint8Array(16);
var temp_attribs_array_zero = new Uint8Array(16); //should be filled with zeros always

Shader.prototype.drawBuffers = function(vertexBuffers, indexBuffer, mode, range_start, range_length)
{
	if(range_length == 0) return;

	var gl = this.gl;

	gl.useProgram(this.program); //this could be removed assuming every shader is called with some uniforms 

	// enable attributes as necessary.
	var length = 0;
	var attribs_in_use = temp_attribs_array; //hack to avoid garbage
	attribs_in_use.set( temp_attribs_array_zero ); //reset

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
		offset = range_start * ( (indexBuffer && indexBuffer.data) ? indexBuffer.data.constructor.BYTES_PER_ELEMENT : 1); //in bytes (Uint16 == 2 bytes)

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
		gl.drawElements(mode, length, indexBuffer.buffer.gl_type, offset); //gl.UNSIGNED_SHORT
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
	  } else {
		gl.drawArrays(mode, offset, length);
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
Shader.expandImports = function(code, files)
{
	files = files || Shader.files;

	var already_imported = {}; //avoid to import two times the same code
	if( !files )
		throw("Shader.files not initialized, assign files there");

	var replace_import = function(v)
	{
		var token = v.split("\"");
		var id = token[1];
		if( already_imported[id] )
			return "//already imported: " + id + "\n";
		var file = files[id];
		already_imported[ id ] = true;
		if(file)
			return file;
		return "//import code not found: " + id + "\n";
	}

	//return code.replace(/#import\s+\"(\w+)\"\s*\n/g, replace_import );
	return code.replace(/#import\s+\"([a-zA-Z0-9_\.]+)\"\s*\n/g, replace_import );
}

//**************** SHADERS ***********************************

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

//used in createFX
Shader.SCREEN_FRAGMENT_FX = "\n\
			precision highp float;\n\
			uniform sampler2D u_texture;\n\
			varying vec2 v_coord;\n\
			#ifdef FX_UNIFORMS\n\
				FX_UNIFORMS\n\
			#endif\n\
			void main() {\n\
				vec2 uv = v_coord;\n\
				vec4 color = texture2D(u_texture, uv);\n\
				#ifdef FX_CODE\n\
					FX_CODE ;\n\
				#endif\n\
				gl_FragColor = color;\n\
			}\n\
			";

Shader.SCREEN_COLORED_FRAGMENT_SHADER = "\n\
			precision highp float;\n\
			uniform sampler2D u_texture;\n\
			uniform vec4 u_color;\n\
			varying vec2 v_coord;\n\
			void main() {\n\
				gl_FragColor = u_color * texture2D(u_texture, v_coord);\n\
			}\n\
			";

Shader.SCREEN_FLAT_FRAGMENT_SHADER = "\n\
			precision highp float;\n\
			uniform vec4 u_color;\n\
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
				vec3 pos = vec3(u_position + vec2(a_coord.x,1.0 - a_coord.y)  * u_size, 1.0);\n\
				v_coord = a_coord; \n\
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

//used to render partially a texture
Shader.QUAD2_FRAGMENT_SHADER = "\n\
			precision highp float;\n\
			uniform sampler2D u_texture;\n\
			uniform vec4 u_color;\n\
			uniform vec4 u_texture_area;\n\
			varying vec2 v_coord;\n\
			void main() {\n\
			    vec2 uv = vec2( mix(u_texture_area.x, u_texture_area.z, v_coord.x), 1.0 - mix(u_texture_area.w, u_texture_area.y, v_coord.y) );\n\
				gl_FragColor = u_color * texture2D(u_texture, uv);\n\
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

Shader.FLAT_VERTEX_SHADER = "\n\
			precision highp float;\n\
			attribute vec3 a_vertex;\n\
			uniform mat4 u_mvp;\n\
			void main() { \n\
				gl_Position = u_mvp * vec4(a_vertex,1.0); \n\
			}\n\
			";

Shader.FLAT_FRAGMENT_SHADER = "\n\
			precision highp float;\n\
			uniform vec4 u_color;\n\
			void main() {\n\
				gl_FragColor = u_color;\n\
			}\n\
			";

/**
* Allows to create a simple shader meant to be used to process a texture, instead of having to define the generic Vertex & Fragment Shader code
* @method Shader.createFX
* @param {string} code string containg code, like "color = color * 2.0;"
* @param {string} [uniforms=null] string containg extra uniforms, like "uniform vec3 u_pos;"
*/
Shader.createFX = function(code, uniforms)
{
	var macros = {
		FX_CODE: code,
		FX_UNIFORMS: uniforms || ""
	}
	return new GL.Shader( GL.Shader.SCREEN_VERTEX_SHADER, GL.Shader.SCREEN_FRAGMENT_FX, macros );
}

/**
* Renders a fullscreen quad with this shader applied
* @method toViewport
* @param {object} uniforms
*/
Shader.prototype.toViewport = function(uniforms)
{
	var mesh = GL.Mesh.getScreenQuad();
	if(uniforms)
		this.uniforms(uniforms);
	this.draw( mesh );
}

//Now some common shaders everybody needs

/**
* Returns a shader ready to render a textured quad in fullscreen, use with Mesh.getScreenQuad() mesh
* shader params sampler2D u_texture
* @method Shader.getScreenShader
*/
Shader.getScreenShader = function(gl)
{
	gl = gl || global.gl;
	var shader = gl.shaders[":screen"];
	if(shader)
		return shader;
	shader = gl.shaders[":screen"] = new GL.Shader( Shader.SCREEN_VERTEX_SHADER, Shader.SCREEN_FRAGMENT_SHADER );
	return shader.uniforms({u_texture:0}); //do it the first time so I dont have to do it every time
}

/**
* Returns a shader ready to render a colored textured quad in fullscreen, use with Mesh.getScreenQuad() mesh
* shader params vec4 u_color and sampler2D u_texture
* @method Shader.getColoredScreenShader
*/
Shader.getColoredScreenShader = function(gl)
{
	gl = gl || global.gl;
	var shader = gl.shaders[":colored_screen"];
	if(shader)
		return shader;
	shader = gl.shaders[":colored_screen"] = new GL.Shader( Shader.SCREEN_VERTEX_SHADER, Shader.SCREEN_COLORED_FRAGMENT_SHADER );
	return shader.uniforms({u_texture:0, u_color: vec4.fromValues(1,1,1,1) }); //do it the first time so I dont have to do it every time
}

/**
* Returns a shader ready to render a quad with transform, use with Mesh.getScreenQuad() mesh
* shader must have: u_position, u_size, u_viewport, u_transform (mat3)
* @method Shader.getQuadShader
*/
Shader.getQuadShader = function(gl)
{
	gl = gl || global.gl;
	var shader = gl.shaders[":quad"];
	if(shader)
		return shader;
	return gl.shaders[":quad"] = new GL.Shader( Shader.QUAD_VERTEX_SHADER, Shader.QUAD_FRAGMENT_SHADER );
}

/**
* Returns a shader ready to render part of a texture into the viewport
* shader must have: u_position, u_size, u_viewport, u_transform, u_texture_area (vec4)
* @method Shader.getPartialQuadShader
*/
Shader.getPartialQuadShader = function(gl)
{
	gl = gl || global.gl;
	var shader = gl.shaders[":quad2"];
	if(shader)
		return shader;
	return gl.shaders[":quad2"] = new GL.Shader( Shader.QUAD_VERTEX_SHADER, Shader.QUAD2_FRAGMENT_SHADER );
}

/**
* Returns a shader used to apply gaussian blur to one texture in one axis (you should use it twice to get a gaussian blur)
* shader params are: vec2 u_offset, float u_intensity
* @method Shader.getBlurShader
*/
Shader.getBlurShader = function(gl)
{
	gl = gl || global.gl;
	var shader = gl.shaders[":blur"];
	if(shader)
		return shader;

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
	return gl.shaders[":blur"] = shader;
}

Shader.FXAA_FUNC = "\n\
	uniform vec2 u_viewportSize;\n\
	uniform vec2 u_iViewportSize;\n\
	#define FXAA_REDUCE_MIN   (1.0/ 128.0)\n\
	#define FXAA_REDUCE_MUL   (1.0 / 8.0)\n\
	#define FXAA_SPAN_MAX     8.0\n\
	\n\
	/* from mitsuhiko/webgl-meincraft based on the code on geeks3d.com */\n\
	vec4 applyFXAA(sampler2D tex, vec2 fragCoord)\n\
	{\n\
		vec4 color = vec4(0.0);\n\
		/*vec2 u_iViewportSize = vec2(1.0 / u_viewportSize.x, 1.0 / u_viewportSize.y);*/\n\
		vec3 rgbNW = texture2D(tex, (fragCoord + vec2(-1.0, -1.0)) * u_iViewportSize).xyz;\n\
		vec3 rgbNE = texture2D(tex, (fragCoord + vec2(1.0, -1.0)) * u_iViewportSize).xyz;\n\
		vec3 rgbSW = texture2D(tex, (fragCoord + vec2(-1.0, 1.0)) * u_iViewportSize).xyz;\n\
		vec3 rgbSE = texture2D(tex, (fragCoord + vec2(1.0, 1.0)) * u_iViewportSize).xyz;\n\
		vec3 rgbM  = texture2D(tex, fragCoord  * u_iViewportSize).xyz;\n\
		vec3 luma = vec3(0.299, 0.587, 0.114);\n\
		float lumaNW = dot(rgbNW, luma);\n\
		float lumaNE = dot(rgbNE, luma);\n\
		float lumaSW = dot(rgbSW, luma);\n\
		float lumaSE = dot(rgbSE, luma);\n\
		float lumaM  = dot(rgbM,  luma);\n\
		float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));\n\
		float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));\n\
		\n\
		vec2 dir;\n\
		dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));\n\
		dir.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));\n\
		\n\
		float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * (0.25 * FXAA_REDUCE_MUL), FXAA_REDUCE_MIN);\n\
		\n\
		float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);\n\
		dir = min(vec2(FXAA_SPAN_MAX, FXAA_SPAN_MAX), max(vec2(-FXAA_SPAN_MAX, -FXAA_SPAN_MAX), dir * rcpDirMin)) * u_iViewportSize;\n\
		\n\
		vec3 rgbA = 0.5 * (texture2D(tex, fragCoord * u_iViewportSize + dir * (1.0 / 3.0 - 0.5)).xyz + \n\
			texture2D(tex, fragCoord * u_iViewportSize + dir * (2.0 / 3.0 - 0.5)).xyz);\n\
		vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(tex, fragCoord * u_iViewportSize + dir * -0.5).xyz + \n\
			texture2D(tex, fragCoord * u_iViewportSize + dir * 0.5).xyz);\n\
		\n\
		return vec4(rgbA,1.0);\n\
		float lumaB = dot(rgbB, luma);\n\
		if ((lumaB < lumaMin) || (lumaB > lumaMax))\n\
			color = vec4(rgbA, 1.0);\n\
		else\n\
			color = vec4(rgbB, 1.0);\n\
		return color;\n\
	}\n\
";

/**
* Returns a shader to apply FXAA antialiasing
* params are vec2 u_viewportSize, mat4 u_iViewportSize
* @method Shader.getFXAAShader
*/
Shader.getFXAAShader = function(gl)
{
	gl = gl || global.gl;
	var shader = gl.shaders[":fxaa"];
	if(shader)
		return shader;

	var shader = new GL.Shader( Shader.SCREEN_VERTEX_SHADER,"\n\
			precision highp float;\n\
			varying vec2 v_coord;\n\
			uniform sampler2D u_texture;\n\
			" + Shader.FXAA_FUNC + "\n\
			\n\
			void main() {\n\
			   gl_FragColor = applyFXAA( u_texture, v_coord * u_viewportSize) ;\n\
			}\n\
			");

	return gl.shaders[":fxaa"] = shader;
}

/**
* Returns a flat shader (useful to render lines)
* @method Shader.getFlatShader
*/
Shader.getFlatShader = function(gl)
{
	gl = gl || global.gl;
	var shader = gl.shaders[":flat"];
	if(shader)
		return shader;

	var shader = new GL.Shader( Shader.FLAT_VERTEX_SHADER,Shader.FLAT_FRAGMENT_SHADER);
	shader.uniforms({u_color:[1,1,1,1]});
	return gl.shaders[":flat"] = shader;
}