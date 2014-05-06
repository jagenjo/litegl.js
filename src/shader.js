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
	var extra_code = "";
	//expand macros
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

	//Extract info from the shader
	this.attributes = {};
	this.uniformLocations = {};
	var isSampler = {};
		regexMap(/uniform\s+sampler(1D|2D|3D|Cube)\s+(\w+)\s*;/g, vertexSource + fragmentSource, function(groups) {
		isSampler[groups[2]] = 1;
	});
	this.isSampler = isSampler;

	//extract uniform and attribs locations to speed up future processes
	for(var i = 0, l = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS); i < l; ++i)
	{
		var data = gl.getActiveUniform( this.program, i);
		if(!data) break;
		var uniformName = data.name;
		//* disabled because WebGL do not allow to upload random size arrays to the GPU...
		var pos = uniformName.indexOf("["); //arrays have uniformName[0], strip the []
		if(pos != -1)
			uniformName = uniformName.substr(0,pos);
		//*/
		this.uniformLocations[ uniformName ] = gl.getUniformLocation(this.program, uniformName);
	}

	for(var i = 0, l = gl.getProgramParameter(this.program, gl.ACTIVE_ATTRIBUTES); i < l; ++i)
	{
		var data = gl.getActiveAttrib( this.program, i);
		if(!data) break;
		this.uniformLocations[ data.name ] = gl.getUniformLocation(this.program, data.name);
		this.attributes[ data.name ] = gl.getAttribLocation(this.program, data.name );	
	}
}

/* TODO, I dont like the idea of creating a shader which is not complete till files are retrieved
Shader.fromFiles = function( vs_path, ps_path )
{
	var vs_code = null;
	var fs_code = null;
	
}
*/

/**
* Uploads a set of uniforms to the Shader
* @method uniforms
* @param {Object} uniforms
*/

Shader._temp_uniform = new Float32Array(16);

Shader.prototype.uniforms = function(uniforms) {

	gl.useProgram(this.program);
	//var last_slot = 0;

	for (var name in uniforms) {
		var location = this.uniformLocations[name];
		if (!location) continue;

		var value = uniforms[name];
		if(value == null) continue;
		if(value.constructor == Float32Array)
		{
			switch (value.length) {
				case 1: gl.uniform1fv(location, value); break; //float
				case 2: gl.uniform2fv(location, value); break; //vec2
				case 3: gl.uniform3fv(location, value); break; //vec3
				case 4: gl.uniform4fv(location, value); break; //vec4
				case 9: gl.uniformMatrix3fv(location, false,  value); break; //matrix3
				case 16: gl.uniformMatrix4fv(location, false, value); break; //matrix4
				default: 
					if(value.length % 16 == 0) //HACK for bones
						gl.uniformMatrix4fv(location, false, value ); //mat4
					else
						gl.uniform1fv(location, value); 
					break; //n float

				//default: throw 'don\'t know how to load uniform "' + name + '" of length ' + value.length;
			}
		} 
		else if (isArray(value)) //non-typed arrays
		{
			switch (value.length) {
			case 1: gl.uniform1f(location, value); break; //float
			case 2: gl.uniform2f(location, value[0], value[1] ); break; //vec2
			case 3: gl.uniform3f(location, value[0], value[1], value[2] ); break; //vec3
			case 4: gl.uniform4f(location, value[0], value[1], value[2], value[3] ); break; //vec4
			case 9: Shader._temp_uniform.set( value ); gl.uniformMatrix3fv(location, false, Shader._temp_uniform ); break; //mat3
			case 16: Shader._temp_uniform.set( value ); gl.uniformMatrix4fv(location, false, Shader._temp_uniform ); break; //mat4
			default: 
				Shader._temp_uniform.set( value ); 
				if(value.length % 16 == 0)
					gl.uniformMatrix4fv(location, false, Shader._temp_uniform ); //mat4
				else
					gl.uniform1fv(location, Shader._temp_uniform); 
				break; //n float
			//default: throw 'don\'t know how to load uniform "' + name + '" of length ' + value.length;
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


//Now some common shaders everybody needs

//Screen shader: used to render one texture into another
Shader.getScreenShader = function()
{
	if(gl._screen_shader)
		return gl._screen_shader;

	var shader = new GL.Shader("\n\
			precision highp float;\n\
			attribute vec3 a_vertex;\n\
			attribute vec2 a_coord;\n\
			varying vec2 coord;\n\
			void main() { \n\
				coord = a_coord; \n\
				gl_Position = vec4(coord * 2.0 - 1.0, 0.0, 1.0); \n\
			}\n\
			","\n\
			precision highp float;\n\
			uniform sampler2D texture;\n\
			varying vec2 coord;\n\
			void main() {\n\
				gl_FragColor = texture2D(texture, coord);\n\
			}\n\
			");
	gl._screen_shader = shader;
	return gl._screen_shader;
}

//Blur shader
Shader.getBlurShader = function()
{
	if(gl._blur_shader)
		return gl._blur_shader;

	var shader = new GL.Shader("\n\
			precision highp float;\n\
			attribute vec3 a_vertex;\n\
			attribute vec2 a_coord;\n\
			varying vec2 v_coord;\n\
			void main() {\n\
				v_coord = a_coord; gl_Position = vec4(v_coord * 2.0 - 1.0, 0.0, 1.0);\n\
			}\n\
			","\n\
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