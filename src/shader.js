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
				case 1: gl.uniform1fv(location, value); break; //float
				case 2: gl.uniform2fv(location, value); break; //vec2
				case 3: gl.uniform3fv(location, value); break; //vec3
				case 4: gl.uniform4fv(location, value); break; //vec4
				case 9: gl.uniformMatrix3fv(location, false,  value); break; //matrix3
				case 16: gl.uniformMatrix4fv(location, false, value); break; //matrix4
				default: throw 'don\'t know how to load uniform "' + name + '" of length ' + value.length;
			}
		} else if (isArray(value))
		{
			switch (value.length) {
			case 1: gl.uniform1fv(location, new Float32Array(value)); break; //float
			case 2: gl.uniform2fv(location, new Float32Array(value)); break; //vec2
			case 3: gl.uniform3fv(location, new Float32Array(value)); break; //vec3
			case 4: gl.uniform4fv(location, new Float32Array(value)); break; //vec4
			case 9: gl.uniformMatrix3fv(location, false, new Float32Array([  //matrix3
							value[0], value[3], value[6],
							value[1], value[4], value[7],
							value[2], value[5], value[8]
						  ])); break;
			case 16: gl.uniformMatrix4fv(location, false, new Float32Array([ //matrix4
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