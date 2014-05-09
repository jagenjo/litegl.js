/**
* Texture class to upload images to the GPU, default is gl.TEXTURE_2D, gl.RGBAof gl.UNSIGNED_BYTE with filter gl.LINEAR, and gl.CLAMP_TO_EDGE
	There is a list of options
	==========================
	- texture_type: gl.TEXTURE_2D, gl.TEXTURE_CUBE_MAP
	- format: gl.RGB, gl.RGBA, gl.DEPTH_COMPONENT
	- type: gl.UNSIGNED_BYTE, gl.UNSIGNED_SHORT, gl.HALF_FLOAT_OES, gl.FLOAT
	- filter: filtering for mag and min: gl.NEAREST or gl.LINEAR
	- magFilter: magnifying filter: gl.NEAREST, gl.LINEAR
	- minFilter: minifying filter: gl.NEAREST, gl.LINEAR, gl.LINEAR_MIPMAP_LINEAR
	- premultiply_alpha: multiplies alpha channel by every color channel
	- wrap: texture wrapping: gl.CLAMP_TO_EDGE, gl.REPEAT, gl.MIRROR

* @class Texture
* @param {number} width texture width (any supported but Power of Two allows to have mipmaps), 0 means no memory reserved till its filled
* @param {number} height texture height (any supported but Power of Two allows to have mipmaps), 0 means no memory reserved till its filled
* @param {Object} options Check the list in the description
* @constructor
*/

function Texture(width, height, options) {
	options = options || {};
	width = parseInt(width); 
	height = parseInt(height);
	this.handler = gl.createTexture();
	this.width = width;
	this.height = height;
	this.format = options.format || gl.RGBA; //gl.DEPTH_COMPONENT
	this.type = options.type || gl.UNSIGNED_BYTE; //gl.UNSIGNED_SHORT
	this.texture_type = options.texture_type || gl.TEXTURE_2D;
	this.magFilter = options.magFilter || options.filter || gl.LINEAR;
	this.minFilter = options.minFilter || options.filter || gl.LINEAR;
	this.wrapS = options.wrap || options.wrapS || gl.CLAMP_TO_EDGE;
	this.wrapT = options.wrap || options.wrapT || gl.CLAMP_TO_EDGE;

	this.has_mipmaps = false;

	if(this.format == gl.DEPTH_COMPONENT && !gl.depth_ext)
		throw("Depth Texture not supported");
	if(this.type == gl.FLOAT && !gl.float_ext)
		throw("Float Texture not supported");
	if(this.type == gl.HALF_FLOAT_OES && !gl.half_float_ext)
		throw("Half Float Texture not supported");
	if(( (this.minFilter != gl.NEAREST && this.minFilter != gl.LINEAR) || this.wrapS != gl.CLAMP_TO_EDGE || this.wrapT != gl.CLAMP_TO_EDGE) && (!isPowerOfTwo(this.width) || !isPowerOfTwo(this.height)))
		throw("Cannot use texture-wrap or mipmaps in Non-Power-of-Two textures");

	if(width && height)
	{
		//I use an invalid gl enum to say this texture is a depth texture, ugly, I know...
		gl.bindTexture(this.texture_type, this.handler);
		gl.texParameteri(this.texture_type, gl.TEXTURE_MAG_FILTER, this.magFilter );
		gl.texParameteri(this.texture_type, gl.TEXTURE_MIN_FILTER, this.minFilter );
		gl.texParameteri(this.texture_type, gl.TEXTURE_WRAP_S, this.wrapS );
		gl.texParameteri(this.texture_type, gl.TEXTURE_WRAP_T, this.wrapT );

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

//used for render to FBOs
Texture.framebuffer = null;
Texture.renderbuffer = null;


Texture.prototype.getProperties = function()
{
	return {
		width: this.width,
		height: this.height,
		type: this.type,
		format: this.format,
		texture_type: this.texture_type,
		magFilter: this.magFilter,
		minFilter: this.minFilter,
		wrapS: this.wrapS,
		wrapT: this.wrapT
	};
}


/**
* Returns if depth texture is supported by the GPU
* @method isDepthSupported
*/
Texture.isDepthSupported = function()
{
	return (gl.getExtension("WEBGL_depth_texture") || gl.getExtension("WEBKIT_WEBGL_depth_texture") || gl.getExtension("MOZ_WEBGL_depth_texture")) != null;
}

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

Texture.setUploadOptions = function(options)
{
	if(options) //options that are not stored in the texture should be passed again to avoid reusing unknown state
	{
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!(options.premultiply_alpha) );
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, !(options.no_flip) );
	}
	else
	{
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false );
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true );
	}
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
}

/**
* Given an Image/Canvas/Video it uploads it to the GPU
* @method uploadImage
* @param {Image} img
* @param {Object} options [optional] upload options (premultiply_alpha, no_flip)
*/
Texture.prototype.uploadImage = function(image, options)
{
	this.bind();

	Texture.setUploadOptions(options);

	try {
		gl.texImage2D(gl.TEXTURE_2D, 0, this.format, this.format, this.type, image);
		this.width = image.videoWidth || image.width;
		this.height = image.videoHeight || image.height;
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
* @param {Object} options [optional] upload options (premultiply_alpha, no_flip)
*/
Texture.prototype.uploadData = function(data, options )
{
	this.bind();
	Texture.setUploadOptions(options);

	gl.texImage2D(this.texture_type, 0, this.format, this.width, this.height, 0, this.format, this.type, data);
	if (this.minFilter && this.minFilter != gl.NEAREST && this.minFilter != gl.LINEAR) {
		gl.generateMipmap(texture.texture_type);
		this.has_mipmaps = true;
	}
	gl.bindTexture(this.texture_type, null); //disable
}

/**
* Render to texture using FBO, just pass the callback to a rendering function and the content of the texture will be updated
* @method drawTo
* @param {Function} callback function that does all the rendering inside this texture
*/
Texture.prototype.drawTo = function(callback, params) {
	//var v = gl.getParameter(gl.VIEWPORT);
	var v = gl.getViewport();

	Texture.framebuffer = Texture.framebuffer || gl.createFramebuffer();
	Texture.renderbuffer = Texture.renderbuffer || gl.createRenderbuffer();

	var framebuffer = Texture.framebuffer;
	var renderbuffer = Texture.renderbuffer;

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
		callback(this, params);
	}
	else if(this.texture_type == gl.TEXTURE_CUBE_MAP)
	{
		for(var i = 0; i < 6; i++)
		{
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X+i, this.handler, 0);
			gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer);
			callback(this,i, params);
		}
	}

	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.bindRenderbuffer(gl.RENDERBUFFER, null);
	gl.viewport(v[0], v[1], v[2], v[3]);

	return this;
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
		gl.disable( gl.BLEND );
		gl.disable( gl.DEPTH_TEST );
		gl.disable( gl.CULL_FACE );
		that.toViewport();
	});

	if (target_texture.minFilter && target_texture.minFilter != gl.NEAREST && target_texture.minFilter != gl.LINEAR) {
		target_texture.bind();
		gl.generateMipmap(target_texture.texture_type);
		target_texture.has_mipmaps = true;
	}
	gl.bindTexture(target_texture.texture_type, null); //disable

	return this;
}

/**
* Render texture in a quad to full viewport size
* @method toViewport
* @param {Shader} shader to apply, otherwise a default textured shader is applied
* @param {Object} uniforms for the shader if needed
*/
Texture.prototype.toViewport = function(shader, uniforms)
{
	shader = shader || Shader.getScreenShader();
	var mesh = Mesh.getScreenQuad();
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
* Applies a blur filter of one pixel to the texture (be careful using it, it is slow)
* @method applyBlur
* @param {Number} offsetx scalar that multiplies the offset when fetching pixels horizontally (default 1)
* @param {Number} offsety scalar that multiplies the offset when fetching pixels vertically (default 1)
* @param {Number} intensity scalar that multiplies the result (default 1)
* @param {Texture} temp_texture blur needs a temp texture, if not supplied it will create a new one each time!
* @return {Texture} returns the temp_texture in case you want to reuse it
*/
Texture.prototype.applyBlur = function(offsetx, offsety, intensity, temp_texture)
{
	var self = this;
	var shader = Shader.getBlurShader();
	if(!temp_texture)
		temp_texture = new GL.Texture(this.width, this.height, this.getProperties() );

	offsetx = offsetx / this.width;
	offsety = offsety / this.height;
	gl.disable( gl.DEPTH_TEST );
	gl.disable( gl.BLEND );

	temp_texture.drawTo( function() {
		self.toViewport(shader, {u_intensity: intensity, u_offset: [0, offsety ] });
	});	

	this.drawTo( function() {
		temp_texture.toViewport(shader, {u_intensity: intensity, u_offset: [offsetx, 0] });
	});	
	return temp_texture;
}


/**
* Similar to drawTo but it also stores the depth in a depth texture
* @method drawToColorAndDepth
* @param {Texture} color_texture
* @param {Texture} depth_texture
* @param {Function} callback
*/
Texture.drawToColorAndDepth = function(color_texture, depth_texture, callback) {

	if(depth_texture.width != color_texture.width || depth_texture.height != color_texture.height)
		throw("Different size between color texture and depth texture");

	var v = gl.getViewport();

	Texture.framebuffer = Texture.framebuffer || gl.createFramebuffer();

	gl.bindFramebuffer(gl.FRAMEBUFFER, Texture.framebuffer);

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
	texture.uploadImage(image, options);
	if (options.minFilter && options.minFilter != gl.NEAREST && options.minFilter != gl.LINEAR) {
		texture.bind();
		gl.generateMipmap(texture.texture_type);
		texture.has_mipmaps = true;
	}
	gl.bindTexture(texture.texture_type, null); //disable
	return texture;
};

/**
* Create a texture from a Video
* @method Texture.fromVideo
* @param {Video} video
* @param {Object} options
* @return {Texture} the texture
*/
Texture.fromVideo = function(video, options) {
	options = options || {};

	var texture = options.texture || new GL.Texture(video.videoWidth, video.videoHeight, options);
	texture.bind();
	texture.uploadImage(video, options);
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

Texture.compareFormats = function(a,b)
{
	if(!a || !b) return false;
	if(a == b) return true;
	if(a.width != b.width || a.height != b.height || a.type != b.type || a.texture_type != b.texture_type) 
		return false;
	return true;
}