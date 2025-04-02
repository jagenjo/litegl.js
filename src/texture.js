/**
* @namespace GL
*/

/**
* Texture class to upload images to the GPU, default is gl.TEXTURE_2D, gl.RGBA of gl.UNSIGNED_BYTE with filters set to gl.LINEAR and wrap to gl.CLAMP_TO_EDGE <br/>
	There is a list of options <br/>
	========================== <br/>
	- texture_type: gl.TEXTURE_2D, gl.TEXTURE_CUBE_MAP, default gl.TEXTURE_2D <br/>
	- format: gl.RGB, gl.RGBA, gl.DEPTH_COMPONENT, default gl.RGBA <br/>
	- type: gl.UNSIGNED_BYTE, gl.UNSIGNED_SHORT, gl.HALF_FLOAT_OES, gl.FLOAT, default gl.UNSIGNED_BYTE <br/>
	- filter: filtering for mag and min: gl.NEAREST or gl.LINEAR, default gl.NEAREST <br/>
	- magFilter: magnifying filter: gl.NEAREST, gl.LINEAR, default gl.NEAREST <br/>
	- minFilter: minifying filter: gl.NEAREST, gl.LINEAR, gl.LINEAR_MIPMAP_LINEAR, default gl.NEAREST <br/>
	- wrap: texture wrapping: gl.CLAMP_TO_EDGE, gl.REPEAT, gl.MIRROR, default gl.CLAMP_TO_EDGE (also accepts wrapT and wrapS for separate settings) <br/>
	- pixel_data: ArrayBufferView with the pixel data to upload to the texture, otherwise the texture will be black (if cubemaps then pass an array[6] with the data for every face)<br/>
	- premultiply_alpha : multiply the color by the alpha value when uploading, default FALSE <br/>
	- no_flip : do not flip in Y, default TRUE <br/>
	- anisotropic : number of anisotropic fetches, default 0 <br/>

	check for more info about formats: https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/texImage2D

* @class Texture
* @param {number} width texture width (any supported but Power of Two allows to have mipmaps), 0 means no memory reserved till its filled
* @param {number} height texture height (any supported but Power of Two allows to have mipmaps), 0 means no memory reserved till its filled
* @param {Object} options Check the list in the description
* @constructor
*/

global.Texture = GL.Texture = function Texture( width, height, options, gl ) {
	options = options || {};

	//used to avoid problems with resources moving between different webgl context
	gl = gl || global.gl;
	this.gl = gl;
	this._context_id = gl.context_id; 

	//round sizes
	width = parseInt(width); 
	height = parseInt(height);

	if(GL.debug)
		console.log("GL.Texture created: ",width,height);

	//create texture handler
	this.handler = gl.createTexture();

	//set settings
	this.width = width;
	this.height = height;
	if(options.depth) //for texture_3d
		this.depth = options.depth; 
	this.texture_type = options.texture_type || gl.TEXTURE_2D; //or gl.TEXTURE_CUBE_MAP
	this.format = options.format || Texture.DEFAULT_FORMAT; //gl.RGBA (if gl.DEPTH_COMPONENT remember type: gl.UNSIGNED_SHORT)
	this.internalFormat = options.internalFormat; //LUMINANCE, and weird formats with bits
	this.type = options.type || Texture.DEFAULT_TYPE; //gl.UNSIGNED_BYTE, gl.UNSIGNED_SHORT, gl.FLOAT or gl.HALF_FLOAT_OES (or gl.HIGH_PRECISION_FORMAT which could be half or float)
	this.magFilter = options.magFilter || options.filter || Texture.DEFAULT_MAG_FILTER;
	this.minFilter = options.minFilter || options.filter || Texture.DEFAULT_MIN_FILTER;
	this.wrapS = options.wrap || options.wrapS || Texture.DEFAULT_WRAP_S; 
	this.wrapT = options.wrap || options.wrapT || Texture.DEFAULT_WRAP_T;
	this.data = null; //where the data came from

	//precompute the max amount of texture units
	if(!Texture.MAX_TEXTURE_IMAGE_UNITS)
		Texture.MAX_TEXTURE_IMAGE_UNITS = gl.getParameter( gl.MAX_TEXTURE_IMAGE_UNITS );

	this.has_mipmaps = false;

	if( this.format == gl.DEPTH_COMPONENT && gl.webgl_version == 1 && !gl.extensions["WEBGL_depth_texture"] )
		throw("Depth Texture not supported");
	if( this.type == gl.FLOAT && !gl.extensions["OES_texture_float"] && gl.webgl_version == 1 )
		throw("Float Texture not supported");
	if( this.type == gl.HALF_FLOAT_OES)
	{
		if( !gl.extensions["OES_texture_half_float"] && gl.webgl_version == 1 )
			throw("Half Float Texture extension not supported.");
		else if( gl.webgl_version > 1 )
		{
			console.warn("using HALF_FLOAT_OES in WebGL2 is deprecated, suing HALF_FLOAT instead");
			this.type = this.format == gl.RGB ? gl.RGB16F : gl.RGBA16F;
		}
	}
	if( (!isPowerOfTwo(this.width) || !isPowerOfTwo(this.height)) && //non power of two
		( (this.minFilter != gl.NEAREST && this.minFilter != gl.LINEAR) || //uses mipmaps
		(this.wrapS != gl.CLAMP_TO_EDGE || this.wrapT != gl.CLAMP_TO_EDGE) ) ) //uses wrap
	{
		if(!options.ignore_pot)
			throw("Cannot use texture-wrap or mipmaps in Non-Power-of-Two textures");
		else
		{
			this.minFilter = this.magFilter = gl.LINEAR;
			this.wrapS = this.wrapT = gl.CLAMP_TO_EDGE;
		}
	}

	//empty textures are allowed to be created
	if(!width || !height)
		return;

	//because sometimes the internal format is not so obvious
	if(!this.internalFormat)
		this.computeInternalFormat();

	//this is done because in some cases the user binds a texture to slot 0 and then creates a new one, which overrides slot 0
	gl.activeTexture( gl.TEXTURE0 + Texture.MAX_TEXTURE_IMAGE_UNITS - 1);
	//I use an invalid gl enum to say this texture is a depth texture, ugly, I know...
	gl.bindTexture( this.texture_type, this.handler);
	gl.texParameteri( this.texture_type, gl.TEXTURE_MAG_FILTER, this.magFilter );
	gl.texParameteri( this.texture_type, gl.TEXTURE_MIN_FILTER, this.minFilter );
	gl.texParameteri( this.texture_type, gl.TEXTURE_WRAP_S, this.wrapS );
	gl.texParameteri( this.texture_type, gl.TEXTURE_WRAP_T, this.wrapT );

	if(options.anisotropic && gl.extensions["EXT_texture_filter_anisotropic"])
		gl.texParameterf( GL.TEXTURE_2D, gl.extensions["EXT_texture_filter_anisotropic"].TEXTURE_MAX_ANISOTROPY_EXT, options.anisotropic);

	var type = this.type;
	var pixel_data = options.pixel_data;
	if(pixel_data && !pixel_data.buffer)
	{
		if( this.texture_type == GL.TEXTURE_CUBE_MAP )
		{
			if(pixel_data[0].constructor === Number) //special case, specify just one face and copy it
			{
				pixel_data = toTypedArray( pixel_data );
				pixel_data = [pixel_data,pixel_data,pixel_data,pixel_data,pixel_data,pixel_data]; 
			}
			else
				for(var i = 0; i < pixel_data.length; ++i)
					pixel_data[i] = toTypedArray( pixel_data[i] );
		}
		else
			pixel_data = toTypedArray( pixel_data );
		this.data = pixel_data;
	}

	function toTypedArray( data )
	{
		if(data.constructor !== Array)
			return data;
		if( type == GL.FLOAT)
			return new Float32Array( data );
		if( type == GL.HALF_FLOAT_OES)
			return new Uint16Array( data );
		return new Uint8Array( data );
	}

	Texture.setUploadOptions(options);

	//here we create all **********************************
	//gl.TEXTURE_1D is not supported by WebGL...
	if(this.texture_type == GL.TEXTURE_2D)
	{
		//create the texture
		gl.texImage2D( GL.TEXTURE_2D, 0, this.internalFormat, width, height, 0, this.format, this.type, pixel_data || null );

		//generate empty mipmaps (necessary?)
		if ( GL.isPowerOfTwo(width) && GL.isPowerOfTwo(height) && options.minFilter && options.minFilter != gl.NEAREST && options.minFilter != gl.LINEAR)
		{
			gl.generateMipmap( this.texture_type );
			this.has_mipmaps = true;
		}
	}
	else if(this.texture_type == GL.TEXTURE_CUBE_MAP)
	{
		var facesize = width*width*(this.format == GL.RGBA ? 4 : 3);
		for(var i = 0; i < 6; ++i)
		{
			var cubemap_data = pixel_data;
			if(cubemap_data)
			{
				if(cubemap_data.constructor === Array) //six arrays
					cubemap_data = cubemap_data[i];
				else //all data mixed in a single array
					cubemap_data.subarray(facesize*i, facesize*(i+1));
			}
			gl.texImage2D( gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, this.internalFormat, this.width, this.height, 0, this.format, this.type, cubemap_data || null );
		}
	}
	else if(this.texture_type == GL.TEXTURE_3D)
	{
		if(this.gl.webgl_version == 1)
			throw("TEXTURE_3D not supported in WebGL 1. Enable WebGL 2 in the context by passing webgl2:true to the context");
		if(!options.depth)
			throw("3d texture depth must be set in the options.depth");
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false ); //standard does not allow this flags for 3D textures
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false );
		gl.texImage3D( GL.TEXTURE_3D, 0, this.internalFormat, width, height, options.depth, 0, this.format, this.type, pixel_data || null );
	}
	gl.bindTexture(this.texture_type, null); //disable
	gl.activeTexture(gl.TEXTURE0);
}

Texture.DEFAULT_TYPE = GL.UNSIGNED_BYTE;
Texture.DEFAULT_FORMAT = GL.RGBA;
Texture.DEFAULT_MAG_FILTER = GL.LINEAR;
Texture.DEFAULT_MIN_FILTER = GL.LINEAR;
Texture.DEFAULT_WRAP_S = GL.CLAMP_TO_EDGE;
Texture.DEFAULT_WRAP_T = GL.CLAMP_TO_EDGE;
Texture.EXTENSION = "png"; //used when saving it to file

//used for render to FBOs
Texture.framebuffer = null;
Texture.renderbuffer = null;
Texture.loading_color = new Uint8Array([0,0,0,0]);
Texture.use_renderbuffer_pool = true; //should improve performance

Texture.CROSS_ORIGIN_CREDENTIALS = "Anonymous";

//because usually you dont want to specify the internalFormat, this tries to guess it from its format
//check https://webgl2fundamentals.org/webgl/lessons/webgl-data-textures.html for more info
Texture.prototype.computeInternalFormat = function()
{
	this.internalFormat = this.format; //default

	if( gl.webgl_version == 1 )
	{
		if( this.type == GL.HALF_FLOAT )
		{
			console.warn("webgl 1 does not use HALF_FLOAT, converting to HALF_FLOAT_OES")
			this.type = GL.HALF_FLOAT_OES;
		}
	}
	else
	{
		if( this.type == GL.HALF_FLOAT_OES )
		{
			console.warn("webgl 2 does not use HALF_FLOAT_OES, converting to HALF_FLOAT")
			this.type = GL.HALF_FLOAT;
		}		
	}

	//automatic selection of internal format for depth textures to avoid problems between webgl1 and 2
	if( this.format == GL.DEPTH_COMPONENT || this.format === GL.DEPTH_STENCIL )
	{
		this.minFilter = GL.NEAREST;

		if( gl.webgl_version == 2 ) 
		{
			if( this.type === GL.UNSIGNED_INT_24_8 && this.format === GL.DEPTH_STENCIL)
				this.internalFormat = GL.DEPTH24_STENCIL8; 
			else if(this.type === GL.FLOAT && this.format === GL.DEPTH_STENCIL)
				this.internalFormat = gl.FLOAT_32_UNSIGNED_INT_24_8_REV;
			else if( this.type == GL.UNSIGNED_SHORT )
				this.internalFormat = GL.DEPTH_COMPONENT16;
			else if( this.type == GL.UNSIGNED_INT )
				this.internalFormat = GL.DEPTH_COMPONENT24;
			else if( this.type == GL.FLOAT )
				this.internalFormat = GL.DEPTH_COMPONENT32F;
			else 
				throw("unsupported type for a depth texture");
		}
		else if( gl.webgl_version == 1 )
		{
			if( this.type == GL.FLOAT )
				throw("WebGL 1.0 does not support float depth textures");
			this.internalFormat = GL.DEPTH_COMPONENT;
		}
	}
	else if( this.format == gl.RGBA )
	{
		if( gl.webgl_version == 2 ) 
		{
			if( this.type == GL.FLOAT )
				this.internalFormat = GL.RGBA32F;
			else if( this.type == GL.HALF_FLOAT )
				this.internalFormat = GL.RGBA16F;
			/*
			else if( this.type == GL.UNSIGNED_SHORT )
			{
				this.internalFormat = GL.RGBA16UI;
				this.format = gl.RGBA_INTEGER;
			}
			else if( this.type == GL.UNSIGNED_INT )
			{
				this.internalFormat = GL.RGBA32UI;
				this.format = gl.RGBA_INTEGER;
			}
			*/
		}
	}
	else if( this.format == gl.RGB )
	{
		if( gl.webgl_version == 2 ) 
		{
			if( this.type == GL.FLOAT )
				this.internalFormat = GL.RGB32F;
			else if( this.type == GL.HALF_FLOAT )
			{
				throw "GL.RGB HALF_FLOAT is not supported, use RGBA instead";
				this.internalFormat = GL.RGB; //not GL.RGB16F
			}
		}
	}
}

/**
* Free the texture memory from the GPU, sets the texture handler to null
* @method delete
*/
Texture.prototype.delete = function()
{
	gl.deleteTexture( this.handler );
	this.handler = null;
}

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

Texture.prototype.hasSameProperties = function(t)
{
	if(!t)
		return false;
	return t.width == this.width && 
		t.height == this.height &&
		t.type == this.type &&
		t.format == this.format &&
		t.texture_type == this.texture_type;
}

Texture.prototype.hasSameSize = function(t)
{
	if(!t)
		return false;
	return t.width == this.width && t.height == this.height;
}
//textures cannot be stored in JSON
Texture.prototype.toJSON = function()
{
	return "";
}


/**
* Returns if depth texture is supported by the GPU
* @method isDepthSupported
* @return {Boolean} true if supported
*/
Texture.isDepthSupported = function()
{
	return gl.extensions["WEBGL_depth_texture"] != null;
}

/**
* Binds the texture to one texture unit
* @method bind
* @param {number} unit texture unit
* @return {number} returns the texture unit
*/
Texture.prototype.bind = function( unit ) {
	if(unit == undefined)
		unit = 0;
	var gl = this.gl;

	//TODO: if the texture is not uploaded, must be upload now

	//bind
	gl.activeTexture(gl.TEXTURE0 + unit);
	gl.bindTexture( this.texture_type, this.handler );
	return unit;
}

/**
* Unbinds the texture 
* @method unbind
* @param {number} unit texture unit
* @return {number} returns the texture unit
*/
Texture.prototype.unbind = function(unit) {
	if(unit === undefined)
		unit = 0;
	var gl = this.gl;
	gl.activeTexture(gl.TEXTURE0 + unit );
	gl.bindTexture(this.texture_type, null);
}


Texture.prototype.setParameter = function(param,value) {
	this.bind(0);
	this.gl.texParameteri( this.texture_type, param, value );
	switch(param)
	{
		case this.gl.TEXTURE_MAG_FILTER: this.magFilter = value; break;
		case this.gl.TEXTURE_MIN_FILTER: this.minFilter = value; break;
		case this.gl.TEXTURE_WRAP_S: this.wrapS = value; break;
		case this.gl.TEXTURE_WRAP_T: this.wrapT = value; break;
	}
}

/**
* Unbinds the texture 
* @method Texture.setUploadOptions
* @param {Object} options a list of options to upload the texture
* - premultiply_alpha : multiply the color by the alpha value, default FALSE
* - no_flip : do not flip in Y, default TRUE
*/
Texture.setUploadOptions = function(options, gl)
{
	gl = gl || global.gl;

	//FIREFOX throws a warning because this cannot be used with arraybuffers as you are in charge or applying it manually...
	if(!Texture.disable_deprecated)
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
	}

	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
}

//flips image data in Y in place
Texture.flipYData = function( data, width, height, numchannels )
{
	var temp = new data.constructor( width * numchannels );
	var pos = 0;
	var lastpos = width * (height-1) * numchannels;
	var l = Math.floor(height*0.5); //middle
	for(var i = 0; i < l; ++i)
	{
		var row = data.subarray(pos, pos + width*numchannels);
		var row2 = data.subarray(lastpos, lastpos + width*numchannels);
		temp.set( row );
		row.set( row2 );
		row2.set( temp );
		pos += width * numchannels;
		lastpos -= width * numchannels;
		if(pos > lastpos)
			break;
	}
}

/**
* Given an Image/Canvas/Video it uploads it to the GPU
* @method uploadImage
* @param {Image} img
* @param {Object} options [optional] upload options (premultiply_alpha, no_flip)
*/
Texture.prototype.uploadImage = function( image, options )
{
	this.bind();
	var gl = this.gl;
	if(!image)
		throw("uploadImage parameter must be Image");

	Texture.setUploadOptions(options, gl);

	try {
		if(options && options.subimage) //upload partially
		{
			if(gl.webgl_version == 1)
				gl.texSubImage2D( gl.TEXTURE_2D, 0, 0,0, this.format, this.type, image );
			else
				gl.texSubImage2D( gl.TEXTURE_2D, 0, 0,0,image.videoWidth || image.width, image.videoHeight || image.height, this.format, this.type, image );
		}
		else
		{
			var w = image.videoWidth || image.width;
			var h = image.videoHeight || image.height;
			if((w != this.width || h != this.height) && (this.width != 1 && this.height != 1))
				console.warn("image uploaded has a different size than texture, resizing it.");
			gl.texImage2D( gl.TEXTURE_2D, 0, this.format, this.format, this.type, image );
			this.width = w;
			this.height = h;
		}
		this.data = image;
	} catch (e) {
		console.error(e);
		if (location.protocol == 'file:') {
			throw 'image not loaded for security reasons (serve this page over "http://" instead)';
		} else {
			throw 'image not loaded for security reasons (image must originate from the same ' +
			'domain as this page or use Cross-Origin Resource Sharing)';
		}
	}

	//TODO: add expand transparent pixels option

	//generate mipmaps
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
* @param {Object} options [optional] upload options (premultiply_alpha, no_flip, cubemap_face, mipmap_level)
*/
Texture.prototype.uploadData = function( data, options, skip_mipmaps )
{
	options = options || {};
	if(!data)
		throw("no data passed");
	var gl = this.gl;
	this.bind();
	Texture.setUploadOptions(options, gl);
	var mipmap_level = options.mipmap_level || 0;
	var width = this.width;
	var height = this.height;
	width = width >> mipmap_level; 
	height = height >> mipmap_level;
	var internal_format = this.internalFormat || this.format;

	if( this.type == GL.HALF_FLOAT_OES && data.constructor === Float32Array )
		console.warn("cannot uploadData to a HALF_FLOAT texture from a Float32Array, must be Uint16Array. To upload it we recomment to create a FLOAT texture, upload data there and copy to your HALF_FLOAT.");

	if( this.texture_type == GL.TEXTURE_2D )
	{
		if(gl.webgl_version == 1)
		{
			if(data.buffer && data.buffer.constructor == ArrayBuffer)
				gl.texImage2D(this.texture_type, mipmap_level, internal_format, width, height, 0, this.format, this.type, data);
			else
				gl.texImage2D(this.texture_type, mipmap_level, internal_format, this.format, this.type, data);
		}
		else if(gl.webgl_version == 2) //webgl forces to use width and height
		{
			if(data.buffer && data.buffer.constructor == ArrayBuffer)
				gl.texImage2D(this.texture_type, mipmap_level, internal_format, width, height, 0, this.format, this.type, data);
			else
				gl.texImage2D(this.texture_type, mipmap_level, internal_format, width, height, 0, this.format, this.type, data);
		}
	}
	else if( this.texture_type == GL.TEXTURE_3D )
	{
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false ); //standard does not allow this flags for 3D textures
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false );
		gl.texImage3D( this.texture_type, mipmap_level, internal_format, width, height, this.depth >> mipmap_level, 0, this.format, this.type, data);
	}
	else if( this.texture_type == GL.TEXTURE_CUBE_MAP )
		gl.texImage2D( gl.TEXTURE_CUBE_MAP_POSITIVE_X + (options.cubemap_face || 0), mipmap_level, internal_format, width, height, 0, this.format, this.type, data);
	else
		throw("cannot uploadData for this texture type");

	this.data = data; //should I clone it?

	if (!skip_mipmaps && this.minFilter && this.minFilter != gl.NEAREST && this.minFilter != gl.LINEAR) {
		gl.generateMipmap(this.texture_type);
		this.has_mipmaps = true;
	}
	gl.bindTexture(this.texture_type, null); //disable
}

//When creating cubemaps this is helpful

/*THIS WORKS old
Texture.cubemap_camera_parameters = [
	{ type:"posX", dir: vec3.fromValues(-1,0,0), 	up: vec3.fromValues(0,1,0),	right: vec3.fromValues(0,0,-1) },
	{ type:"negX", dir: vec3.fromValues(1,0,0),		up: vec3.fromValues(0,1,0),	right: vec3.fromValues(0,0,1) },
	{ type:"posY", dir: vec3.fromValues(0,-1,0), 	up: vec3.fromValues(0,0,-1), right: vec3.fromValues(1,0,0) },
	{ type:"negY", dir: vec3.fromValues(0,1,0),		up: vec3.fromValues(0,0,1),	right: vec3.fromValues(-1,0,0) },
	{ type:"posZ", dir: vec3.fromValues(0,0,-1), 	up: vec3.fromValues(0,1,0),	right: vec3.fromValues(1,0,0) },
	{ type:"negZ", dir: vec3.fromValues(0,0,1),		up: vec3.fromValues(0,1,0),	right: vec3.fromValues(-1,0,0) }
];
*/

//THIS works
Texture.cubemap_camera_parameters = [
	{ type:"posX", dir: vec3.fromValues(1,0,0), 	up: vec3.fromValues(0,1,0),	right: vec3.fromValues(0,0,-1) },
	{ type:"negX", dir: vec3.fromValues(-1,0,0),	up: vec3.fromValues(0,1,0),	right: vec3.fromValues(0,0,1) },
	{ type:"posY", dir: vec3.fromValues(0,1,0), 	up: vec3.fromValues(0,0,-1), right: vec3.fromValues(1,0,0) },
	{ type:"negY", dir: vec3.fromValues(0,-1,0),	up: vec3.fromValues(0,0,1),	right: vec3.fromValues(1,0,0) },
	{ type:"posZ", dir: vec3.fromValues(0,0,1), 	up: vec3.fromValues(0,1,0),	right: vec3.fromValues(1,0,0) },
	{ type:"negZ", dir: vec3.fromValues(0,0,-1),	up: vec3.fromValues(0,1,0),	right: vec3.fromValues(-1,0,0) }
];



/**
* Render to texture using FBO, just pass the callback to a rendering function and the content of the texture will be updated
* If the texture is a cubemap, the callback will be called six times, once per face, the number of the face is passed as a second parameter
* for further info about how to set up the propper cubemap camera, check the GL.Texture.cubemap_camera_parameters with the direction and up vector for every face.
*
* Keep in mind that it tries to reuse the last renderbuffer for the depth, and if it cannot (different size) it creates a new one (throwing the old)
* @method drawTo
* @param {Function} callback function that does all the rendering inside this texture
*/
Texture.prototype.drawTo = function(callback, params)
{
	var gl = this.gl;

	//if(this.format == gl.DEPTH_COMPONENT)
	//	throw("cannot use drawTo in depth textures, use Texture.drawToColorAndDepth");

	var v = gl.getViewport();
	var now = GL.getTime();

	var old_fbo = gl.getParameter( gl.FRAMEBUFFER_BINDING );

	var framebuffer = gl._framebuffer = gl._framebuffer || gl.createFramebuffer();
	gl.bindFramebuffer( gl.FRAMEBUFFER, framebuffer );

	//this code allows to reuse old renderbuffers instead of creating and destroying them for every frame
	var renderbuffer = null;

	if( Texture.use_renderbuffer_pool ) //create a renderbuffer pool
	{
		if(!gl._renderbuffers_pool)
			gl._renderbuffers_pool = {};
		//generate unique key for this renderbuffer
		var key = this.width + ":" + this.height;

		//reuse or create new one
		if( gl._renderbuffers_pool[ key ] ) //Reuse old
		{
			renderbuffer = gl._renderbuffers_pool[ key ];
			renderbuffer.time = now;
			gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer );
		}
		else
		{
			//create temporary buffer
			gl._renderbuffers_pool[ key ] = renderbuffer = gl.createRenderbuffer();
			renderbuffer.time = now;
			renderbuffer.width = this.width;
			renderbuffer.height = this.height;
			gl.bindRenderbuffer( gl.RENDERBUFFER, renderbuffer );

			//destroy after one minute 
			setTimeout( inner_check_destroy.bind(renderbuffer), 1000*60 );
		}
	}
	else
	{
		renderbuffer = gl._renderbuffer = gl._renderbuffer || gl.createRenderbuffer();
		renderbuffer.width = this.width;
		renderbuffer.height = this.height;
		gl.bindRenderbuffer( gl.RENDERBUFFER, renderbuffer );
	}


	//bind render buffer for depth or color
	if( this.format === gl.DEPTH_COMPONENT )
		gl.renderbufferStorage( gl.RENDERBUFFER, gl.RGBA4, this.width, this.height);
	else
		gl.renderbufferStorage( gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, this.width, this.height);


	//clears memory from unused buffer
	function inner_check_destroy()
	{
		if( GL.getTime() - this.time >= 1000*60 )
		{
			//console.log("Buffer cleared");
			gl.deleteRenderbuffer( gl._renderbuffers_pool[ key ] );
			delete gl._renderbuffers_pool[ key ];
		}
		else
			setTimeout( inner_check_destroy.bind(this), 1000*60 );
	}


	//create to store depth
	/*
	if (this.width != renderbuffer.width || this.height != renderbuffer.height ) {
	  renderbuffer.width = this.width;
	  renderbuffer.height = this.height;
	  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, this.width, this.height);
	}
	*/

	gl.viewport(0, 0, this.width, this.height);

	//if(gl._current_texture_drawto)
	//	throw("Texture.drawTo: Cannot use drawTo from inside another drawTo");

	gl._current_texture_drawto = this;
	gl._current_fbo_color = framebuffer;
	gl._current_fbo_depth = renderbuffer;

	if(this.texture_type == gl.TEXTURE_2D)
	{
		if( this.format !== gl.DEPTH_COMPONENT )
		{
			gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.handler, 0 );
			gl.framebufferRenderbuffer( gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer );
		}
		else
		{
			gl.framebufferRenderbuffer( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, renderbuffer );
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D,  this.handler, 0);
		}
		callback(this, params);
	}
	else if(this.texture_type == gl.TEXTURE_CUBE_MAP)
	{
		//bind the fixed ones out of the loop to save calls
		if( this.format !== gl.DEPTH_COMPONENT )
			gl.framebufferRenderbuffer( gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer );
		else
			gl.framebufferRenderbuffer( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, renderbuffer );

		//for every face of the cubemap
		for(var i = 0; i < 6; i++)
		{
			if( this.format !== gl.DEPTH_COMPONENT )
				gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, this.handler, 0);
			else
				gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,  this.handler, 0 );
			callback(this,i, params);
		}
	}

	this.data = null;

	gl._current_texture_drawto = null;
	gl._current_fbo_color = null;
	gl._current_fbo_depth = null;

	gl.bindFramebuffer( gl.FRAMEBUFFER, old_fbo );
	gl.bindRenderbuffer(gl.RENDERBUFFER, null);
	gl.viewport(v[0], v[1], v[2], v[3]);

	return this;
}

/*
Texture.drawTo = function( color_textures, callback, depth_texture )
{
	var w = -1,
		h = -1,
		type = null;

	if(!color_textures && !depth_texture)
		throw("Textures missing in drawTo");

	if(color_textures && color_textures.length)
	{
		for(var i = 0; i < color_textures.length; i++)
		{
			var t = color_textures[i];
			if(w == -1) 
				w = t.width;
			else if(w != t.width)
				throw("Cannot use Texture.drawTo if textures have different dimensions");
			if(h == -1) 
				h = t.height;
			else if(h != t.height)
				throw("Cannot use Texture.drawTo if textures have different dimensions");
			if(type == null) //first one defines the type
				type = t.type;
			else if (type != t.type)
				throw("Cannot use Texture.drawTo if textures have different data type, all must have the same type");
		}
	}
	else
	{
		w = depth_texture.width;
		h = depth_texture.height;
	}

	var ext = gl.extensions["WEBGL_draw_buffers"];
	if(!ext && color_textures && color_textures.length > 1)
		throw("Rendering to several textures not supported");

	var v = gl.getViewport();
	gl._framebuffer =  gl._framebuffer || gl.createFramebuffer();
	gl.bindFramebuffer( gl.FRAMEBUFFER,  gl._framebuffer );

	gl.viewport( 0, 0, w, h );

	var renderbuffer = null;
	if( depth_texture && depth_texture.format !== gl.DEPTH_COMPONENT || depth_texture.type != gl.UNSIGNED_INT )
		throw("Depth texture must be of format: gl.DEPTH_COMPONENT and type: gl.UNSIGNED_INT");

	if( depth_texture )
	{
		gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth_texture.handler, 0);
	}
	else //create a temporary depth renderbuffer
	{
		//create renderbuffer for depth
		renderbuffer = gl._renderbuffer = gl._renderbuffer || gl.createRenderbuffer();
		renderbuffer.width = w;
		renderbuffer.height = h;
		gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer );
		gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);

		gl.framebufferRenderbuffer( gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer );
	}

	if( color_textures )
	{
		var order = []; //draw_buffers request the use of an array with the order of the attachments
		for(var i = 0; i < color_textures.length; i++)
		{
			var t = color_textures[i];
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t.handler, 0);
			order.push( gl.COLOR_ATTACHMENT0 + i );
		}

		if(color_textures.length > 1)
			ext.drawBuffersWEBGL( order );
	}
	else //create temporary color render buffer
	{
		var color_renderbuffer = this._color_renderbuffer = this._color_renderbuffer || gl.createRenderbuffer();
		color_renderbuffer.width = w;
		color_renderbuffer.height = h;

		gl.bindRenderbuffer( gl.RENDERBUFFER, color_renderbuffer );
		gl.renderbufferStorage( gl.RENDERBUFFER, gl.RGBA4, w, h );

		gl.framebufferRenderbuffer( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color_renderbuffer );
	}

	var complete = gl.checkFramebufferStatus( gl.FRAMEBUFFER );
	if(complete !== gl.FRAMEBUFFER_COMPLETE)
		throw("FBO not complete: " + complete);

	callback();

	//clear data
	if(color_textures.length)
		for(var i = 0; i < color_textures.length; ++i)
			color_textures[i].data = null;

	gl.bindFramebuffer(gl.FRAMEBUFFER, null);

	gl.viewport(v[0], v[1], v[2], v[3]);
}

Texture.drawToColorAndDepth = function( color_texture, depth_texture, callback ) {
	var gl = color_texture.gl; //static function

	if(depth_texture.width != color_texture.width || depth_texture.height != color_texture.height)
		throw("Different size between color texture and depth texture");

	var v = gl.getViewport();

	gl._framebuffer =  gl._framebuffer || gl.createFramebuffer();

	gl.bindFramebuffer( gl.FRAMEBUFFER,  gl._framebuffer);

	gl.viewport(0, 0, color_texture.width, color_texture.height);

	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color_texture.handler, 0);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,  gl.TEXTURE_2D, depth_texture.handler, 0);

	callback();

	color_texture.data = null;
	depth_texture.data = null;

	gl.bindFramebuffer(gl.FRAMEBUFFER, null);

	gl.viewport(v[0], v[1], v[2], v[3]);
}
*/


/**
* Copy content of one texture into another
* TODO: check using copyTexImage2D
* @method copyTo
* @param {GL.Texture} target_texture
* @param {GL.Shader} [shader=null] optional shader to apply while copying
* @param {Object} [uniforms=null] optional uniforms for the shader
*/
Texture.prototype.copyTo = function( target_texture, shader, uniforms ) {
	var that = this;
	var gl = this.gl;
	if(!target_texture)
		throw("target_texture required");

	//save state
	var previous_fbo = gl.getParameter( gl.FRAMEBUFFER_BINDING );
	var viewport = gl.getViewport(); 

	if(!shader)
		shader = this.texture_type == gl.TEXTURE_2D ? GL.Shader.getScreenShader() : GL.Shader.getCubemapCopyShader();

	//render
	gl.disable( gl.BLEND );
	gl.disable( gl.DEPTH_TEST );
	if(shader && uniforms)
		shader.uniforms( uniforms );

	//reuse fbo
	var fbo = gl.__copy_fbo;
	if(!fbo)
		fbo = gl.__copy_fbo = gl.createFramebuffer();
	gl.bindFramebuffer( gl.FRAMEBUFFER, fbo );

	gl.viewport(0,0,target_texture.width, target_texture.height);
	if(this.texture_type == gl.TEXTURE_2D)
	{
		//regular color texture
		if(this.format !== gl.DEPTH_COMPONENT && this.format !== gl.DEPTH_STENCIL )
		{
			/* doesnt work
			if( this.width == target_texture.width && this.height == target_texture.height && this.format == target_texture.format)
			{
				gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.handler, 0);
				gl.bindTexture( target_texture.texture_type, target_texture.handler );
				gl.copyTexImage2D( target_texture.texture_type, 0, this.format, 0, 0, target_texture.width, target_texture.height, 0);
			}
			else
			*/
			{
				gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target_texture.handler, 0);
				this.toViewport( shader );
			}
		}
		else //copying a depth texture is harder
		{
			var color_renderbuffer = gl._color_renderbuffer = gl._color_renderbuffer || gl.createRenderbuffer();
			var w = color_renderbuffer.width = target_texture.width;
			var h = color_renderbuffer.height = target_texture.height;
			
			//attach color render buffer
			gl.bindRenderbuffer( gl.RENDERBUFFER, color_renderbuffer );
			gl.renderbufferStorage( gl.RENDERBUFFER, gl.RGBA4, w, h );
			gl.framebufferRenderbuffer( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color_renderbuffer );

			//attach depth texture
			var attachment_point = target_texture.format == gl.DEPTH_STENCIL ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT;
			gl.framebufferTexture2D( gl.FRAMEBUFFER, attachment_point, gl.TEXTURE_2D, target_texture.handler, 0);

			var complete = gl.checkFramebufferStatus( gl.FRAMEBUFFER ); //this line is slow according to Mozilla?
			if(complete !== gl.FRAMEBUFFER_COMPLETE)
				throw("FBO not complete: " + complete);

			//enable depth test?
			gl.enable( gl.DEPTH_TEST );
			gl.depthFunc( gl.ALWAYS );
			gl.colorMask( false,false,false,false );
			//call shader that overwrites depth values
			shader = GL.Shader.getCopyDepthShader();
			this.toViewport( shader );
			gl.colorMask( true,true,true,true );
			gl.disable( gl.DEPTH_TEST );
			gl.depthFunc( gl.LEQUAL );
			gl.framebufferRenderbuffer( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, null );
			gl.framebufferTexture2D( gl.FRAMEBUFFER, attachment_point, gl.TEXTURE_2D, null, 0);
		}
	}
	else if(this.texture_type == gl.TEXTURE_CUBE_MAP)
	{
		shader.uniforms({u_texture: 0});
		var rot_matrix = GL.temp_mat3;
		for(var i = 0; i < 6; i++)
		{
			gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, target_texture.handler, 0);
			var face_info = GL.Texture.cubemap_camera_parameters[ i ];
			mat3.identity( rot_matrix );
			rot_matrix.set( face_info.right, 0 );
			rot_matrix.set( face_info.up, 3 );
			rot_matrix.set( face_info.dir, 6 );
			//mat3.invert(rot_matrix,rot_matrix);
			this.toViewport( shader,{ u_rotation: rot_matrix });
		}
	}
	
	//restore previous state
	gl.setViewport(viewport); //restore viewport
	gl.bindFramebuffer( gl.FRAMEBUFFER, previous_fbo ); //restore fbo

	//generate mipmaps when needed
	if (target_texture.minFilter && target_texture.minFilter != gl.NEAREST && target_texture.minFilter != gl.LINEAR) {
		target_texture.bind();
		gl.generateMipmap(target_texture.texture_type);
		target_texture.has_mipmaps = true;
	}

	target_texture.data = null;
	gl.bindTexture( target_texture.texture_type, null ); //disable
	return this;
}


/**
* Similar to CopyTo, but more specific, only for color texture_2D. It doesnt change the blend flag
* @method blit
* @param {GL.Texture} target_texture
* @param {GL.Shader} [shader=null] optional shader to apply while copying
* @param {Object} [uniforms=null] optional uniforms for the shader
*/
Texture.prototype.blit = (function(){ 
	var viewport = new Float32Array(4);	
	
	return function( target_texture, shader, uniforms ) {
		var that = this;
		var gl = this.gl;

		if ( this.texture_type != gl.TEXTURE_2D || this.format === gl.DEPTH_COMPONENT || this.format === gl.DEPTH_STENCIL )
			throw("blit only support TEXTURE_2D of RGB or RGBA. use copyTo instead");

		//save state
		var previous_fbo = gl.getParameter( gl.FRAMEBUFFER_BINDING );
		viewport.set( gl.viewport_data ); 

		shader = shader || GL.Shader.getScreenShader();
		if(shader && uniforms)
			shader.uniforms( uniforms );

		//reuse fbo
		var fbo = gl.__copy_fbo;
		if(!fbo)
			fbo = gl.__copy_fbo = gl.createFramebuffer();
		gl.bindFramebuffer( gl.FRAMEBUFFER, fbo );

		gl.viewport(0,0,target_texture.width, target_texture.height);
		gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target_texture.handler, 0);

		this.bind(0);
		shader.draw( GL.Mesh.getScreenQuad(), gl.TRIANGLES );
		
		//restore previous state
		gl.setViewport(viewport); //restore viewport
		gl.bindFramebuffer( gl.FRAMEBUFFER, previous_fbo ); //restore fbo

		target_texture.data = null;
		gl.bindTexture( target_texture.texture_type, null ); //disable
		return this;
	}
})();

/**
* Render texture in a quad to full viewport size
* @method toViewport
* @param {Shader} shader to apply, otherwise a default textured shader is applied [optional]
* @param {Object} uniforms for the shader if needed [optional]
*/
Texture.prototype.toViewport = function(shader, uniforms)
{
	shader = shader || Shader.getScreenShader();
	var mesh = Mesh.getScreenQuad();
	this.bind(0);
	//shader.uniforms({u_texture: 0}); //never changes
	if(uniforms)
		shader.uniforms(uniforms);
	shader.draw( mesh, gl.TRIANGLES );
}

/**
* Fills the texture with a constant color (uses gl.clear) or shader
* @method fill
* @param {vec4|GL.Shader} color rgba or shader
* @param {boolean} skip_mipmaps if true the mipmaps wont be updated
*/
Texture.prototype.fill = function(color_or_shader, skip_mipmaps )
{
	if(color_or_shader.constructor === GL.Shader)
	{
		var shader = color_or_shader;
		this.drawTo( function() {
			shader.toViewport();
		});
	}
	else
	{
		var color = color_or_shader;
		var old_color = gl.getParameter( gl.COLOR_CLEAR_VALUE );
		gl.clearColor( color[0], color[1], color[2], color[3] );
		this.drawTo( function() {
			gl.clear( gl.COLOR_BUFFER_BIT );	
		});
		gl.clearColor( old_color[0], old_color[1], old_color[2], old_color[3] );
	}

	if (!skip_mipmaps && this.minFilter && this.minFilter != gl.NEAREST && this.minFilter != gl.LINEAR ) {
		this.bind();
		gl.generateMipmap( this.texture_type );
		this.has_mipmaps = true;
	}
}

/**
* Render texture in a quad of specified area
* @method renderQuad
* @param {number} x
* @param {number} y
* @param {number} width
* @param {number} height
*/
Texture.prototype.renderQuad = (function() {
	//static variables: less garbage
	var identity = mat3.create();
	var pos = vec2.create();
	var size = vec2.create();
	var white = vec4.fromValues(1,1,1,1);

	return (function(x,y,w,h, shader, uniforms)
	{
		pos[0] = x;	pos[1] = y;
		size[0] = w; size[1] = h;

		shader = shader || Shader.getQuadShader(this.gl);
		var mesh = Mesh.getScreenQuad(this.gl);
		this.bind(0);
		shader.uniforms({u_texture: 0, u_position: pos, u_color: white, u_size: size, u_viewport: gl.viewport_data.subarray(2,4), u_transform: identity });
		if(uniforms)
			shader.uniforms(uniforms);
		shader.draw( mesh, gl.TRIANGLES );
	});
})();


/**
* Applies a blur filter of 5x5 pixels to the texture (be careful using it, it is slow)
* @method applyBlur
* @param {Number} offsetx scalar that multiplies the offset when fetching pixels horizontally (default 1)
* @param {Number} offsety scalar that multiplies the offset when fetching pixels vertically (default 1)
* @param {Number} intensity scalar that multiplies the result (default 1)
* @param {Texture} output_texture [optional] if not passed the output is the own texture
* @param {Texture} temp_texture blur needs a temp texture, if not supplied it will use the temporary textures pool
* @return {Texture} returns the temp_texture in case you want to reuse it
*/
Texture.prototype.applyBlur = function( offsetx, offsety, intensity, output_texture, temp_texture )
{
	var that = this;
	var gl = this.gl;
	if(offsetx === undefined)
		offsetx = 1;
	if(offsety === undefined)
		offsety = 1;
	gl.disable( gl.DEPTH_TEST );
	gl.disable( gl.BLEND );
	output_texture = output_texture || this;
	var is_temp = !temp_texture;

	//if(this === output_texture && this.texture_type === gl.TEXTURE_CUBE_MAP )
	//	throw("cannot use applyBlur in a texture with itself when blurring a CUBE_MAP");
	if(temp_texture === output_texture)
		throw("cannot use applyBlur in a texture using as temporary itself");

	if(output_texture && this.texture_type !== output_texture.texture_type )
		throw("cannot use applyBlur with textures of different texture_type");

	//if(this.width != output_texture.width || this.height != output_texture.height)
	//	throw("cannot use applyBlur with an output texture of different size, it doesnt work");

	//save state
	var current_fbo = gl.getParameter( gl.FRAMEBUFFER_BINDING );
	var viewport = gl.getViewport(); 

	//reuse fbo
	var fbo = gl.__copy_fbo;
	if(!fbo)
		fbo = gl.__copy_fbo = gl.createFramebuffer();
	gl.bindFramebuffer( gl.FRAMEBUFFER, fbo );
	gl.viewport(0,0, this.width, this.height);

	if( this.texture_type === gl.TEXTURE_2D )
	{
		var shader = GL.Shader.getBlurShader();

		if(!temp_texture)
			temp_texture = GL.Texture.getTemporary( this.width, this.height, this );

		//horizontal blur
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, temp_texture.handler, 0);
		this.toViewport( shader, {u_texture: 0, u_intensity: intensity, u_offset: [0, offsety / this.height ] });

		//vertical blur
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output_texture.handler, 0);
		gl.viewport(0,0,output_texture.width, output_texture.height);
		temp_texture.toViewport( shader, {u_intensity: intensity, u_offset: [offsetx / temp_texture.width, 0] });

		if(is_temp)
			GL.Texture.releaseTemporary( temp_texture );
	}
	else if( this.texture_type === gl.TEXTURE_CUBE_MAP )
	{
		//var weights = new Float32Array([ 0.16/0.98, 0.15/0.98, 0.12/0.98, 0.09/0.98, 0.05/0.98 ]);
		//var weights = new Float32Array([ 0.05/0.98, 0.09/0.98, 0.12/0.98, 0.15/0.98, 0.16/0.98, 0.15/0.98, 0.12/0.98, 0.09/0.98, 0.05/0.98, 0.0 ]); //extra 0 to avoid mat3
		var shader = GL.Shader.getCubemapBlurShader();
		shader.uniforms({u_texture: 0, u_intensity: intensity, u_offset: [ offsetx / this.width, offsety / this.height ] });
		this.bind(0);
		var mesh = Mesh.getScreenQuad();
		mesh.bindBuffers( shader );
		shader.bind();

		var destination = null;
		
		if(!temp_texture && output_texture == this) //we need a temporary texture
			destination = temp_texture = GL.Texture.getTemporary( output_texture.width, output_texture.height, output_texture );
		else
			destination = output_texture; //blur directly to output texture

		var rot_matrix = GL.temp_mat3;
		for(var i = 0; i < 6; ++i)
		{
			gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, destination.handler, 0);
			var face_info = GL.Texture.cubemap_camera_parameters[ i ];
			mat3.identity(rot_matrix);
			rot_matrix.set( face_info.right, 0 );
			rot_matrix.set( face_info.up, 3 );
			rot_matrix.set( face_info.dir, 6 );
			//mat3.invert(rot_matrix,rot_matrix);
			shader._setUniform( "u_rotation", rot_matrix );
			gl.drawArrays( gl.TRIANGLES, 0, 6 );
		}

		mesh.unbindBuffers( shader );

		if(temp_texture) //copy back 
			temp_texture.copyTo( output_texture );

		if(temp_texture && is_temp) //release temp
			GL.Texture.releaseTemporary( temp_texture );
	}

	//restore previous state
	gl.setViewport(viewport); //restore viewport
	gl.bindFramebuffer( gl.FRAMEBUFFER, current_fbo ); //restore fbo

	output_texture.data = null;

	//generate mipmaps when needed
	if (output_texture.minFilter && output_texture.minFilter != gl.NEAREST && output_texture.minFilter != gl.LINEAR) {
		output_texture.bind();
		gl.generateMipmap(output_texture.texture_type);
		output_texture.has_mipmaps = true;
	}

	gl.bindTexture( output_texture.texture_type, null ); //disable
}


/**
* Loads and uploads a texture from a url
* @method Texture.fromURL
* @param {String} url
* @param {Object} options
* @param {Function} on_complete
* @return {Texture} the texture
*/
Texture.fromURL = function( url, options, on_complete, gl ) {
	gl = gl || global.gl;

	options = options || {};
	options = Object.create(options); //creates a new options using the old one as prototype

	var texture = options.texture || new GL.Texture(1, 1, options, gl);

	if(url.length < 64)
		texture.url = url;
	texture.bind();
	var default_color = options.temp_color || Texture.loading_color;
	//Texture.setUploadOptions(options);
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
	var temp_color = options.type == gl.FLOAT ? new Float32Array(default_color) : new Uint8Array(default_color);
	gl.texImage2D( gl.TEXTURE_2D, 0, texture.format, texture.width, texture.height, 0, texture.format, texture.type, temp_color );
	gl.bindTexture( texture.texture_type, null ); //disable
	texture.ready = false;

	var ext = null;
	if( options.extension ) //to force format
		ext = options.extension;

	if(!ext && url.length < 512) //avoid base64 urls
	{
		var base = url;
		var pos = url.indexOf("?");
		if(pos != -1)
			base = url.substr(0,pos);
		pos = base.lastIndexOf(".");
		if(pos != -1)
			ext = base.substr(pos+1).toLowerCase();
	}

	if( ext == "dds")
	{
		var ext = gl.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc") || gl.getExtension("WEBGL_compressed_texture_s3tc");
		var new_texture = new GL.Texture(0,0, options, gl);
		DDS.loadDDSTextureEx(gl, ext, url, new_texture.handler, true, function(t) {
			texture.texture_type = t.texture_type;
			texture.handler = t;
			delete texture["ready"]; //texture.ready = true;
			if(on_complete)
				on_complete(texture, url);
		});
	}
	else if( ext == "tga" )
	{
		HttpRequest( url, null, function(data) {
			var img_data = GL.Texture.parseTGA(data);
			if(!img_data)
				return;
			options.texture = texture;
			if(img_data.flipY)
				options.no_flip = true;
			if(img_data.format == "RGB")
				texture.format = gl.RGB;
			texture = GL.Texture.fromMemory( img_data.width, img_data.height, img_data.pixels, options );
			delete texture["ready"]; //texture.ready = true;
			if(on_complete)
				on_complete( texture, url );
		},null,{ binary: true });
	}
	else //png,jpg,webp,...
	{
		var image = new Image();
		image.src = url;
		image.crossOrigin = Texture.CROSS_ORIGIN_CREDENTIALS; //to please the CORS gods
		var that = this;
		image.onload = function()
		{
			options.texture = texture;
			GL.Texture.fromImage(this, options);
			delete texture["ready"]; //texture.ready = true;
			if(on_complete)
				on_complete(texture, url);
		}
		image.onerror = function()
		{
			if(on_complete)
				on_complete(null);
		}
	}

	return texture;
};

Texture.parseTGA = function(data)
{
	if(!data || data.constructor !== ArrayBuffer)
		throw( "TGA: data must be ArrayBuffer");
	data = new Uint8Array(data);
	var TGAheader = new Uint8Array( [0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0] );
	var TGAcompare = data.subarray(0,12);
	for(var i = 0; i < TGAcompare.length; i++)
		if(TGAheader[i] != TGAcompare[i])
		{
			console.error("TGA header is not valid");
			return null; //not a TGA
		}

	var header = data.subarray(12,18);
	var img = {};
	img.width = header[1] * 256 + header[0];
	img.height = header[3] * 256 + header[2];
	img.bpp = header[4];
	img.bytesPerPixel = img.bpp / 8;
	img.imageSize = img.width * img.height * img.bytesPerPixel;
	img.pixels = data.subarray(18,18+img.imageSize);
	img.pixels = new Uint8Array( img.pixels ); 	//clone
	img.flipY = ((header[5] & (1<<5)) == 0); //needs swap in Y
	//TGA comes in BGR format so we swap it, this is slooooow
	for(var i = 0; i < img.imageSize; i+= img.bytesPerPixel)
	{
		var temp = img.pixels[i];
		img.pixels[i] = img.pixels[i+2];
		img.pixels[i+2] = temp;
	}
	img.format = img.bpp == 32 ? "RGBA" : "RGB";
	return img;
}

/**
* Create a texture from an Image
* @method Texture.fromImage
* @param {Image} image
* @param {Object} options
* @return {Texture} the texture
*/
Texture.fromImage = function( image, options ) {
	options = options || {};

	var texture = options.texture || new GL.Texture( image.width, image.height, options);
	texture.uploadImage( image, options ); //options could have a prototype 

	texture.bind();
	gl.texParameteri(texture.texture_type, gl.TEXTURE_MAG_FILTER, texture.magFilter || Texture.DEFAULT_MAG_FILTER );
	gl.texParameteri(texture.texture_type, gl.TEXTURE_MIN_FILTER, texture.minFilter || Texture.DEFAULT_MIN_FILTER );
	gl.texParameteri(texture.texture_type, gl.TEXTURE_WRAP_S, texture.wrapS || Texture.DEFAULT_WRAP_S );
	gl.texParameteri(texture.texture_type, gl.TEXTURE_WRAP_T, texture.wrapT || Texture.DEFAULT_WRAP_T );

	if ((GL.isPowerOfTwo(texture.width) && GL.isPowerOfTwo(texture.height)) || gl.webgl_version > 1)
	{
		if( options.minFilter && options.minFilter != gl.NEAREST && options.minFilter != gl.LINEAR)
		{
			texture.bind();
			gl.generateMipmap(texture.texture_type);
			texture.has_mipmaps = true;
		}
	}
	else
	{
		//no mipmaps supported
		gl.texParameteri(texture.texture_type, gl.TEXTURE_MIN_FILTER, GL.LINEAR );
		//gl.texParameteri(texture.texture_type, gl.TEXTURE_MAG_FILTER, GL.LINEAR );
		gl.texParameteri(texture.texture_type, gl.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE );
		gl.texParameteri(texture.texture_type, gl.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE );
		texture.has_mipmaps = false;
	}
	gl.bindTexture(texture.texture_type, null); //disable
	texture.data = image;
	if(options.keep_image)
		texture.img = image;
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
	texture.uploadImage( video, options );
	if (options.minFilter && options.minFilter != gl.NEAREST && options.minFilter != gl.LINEAR) {
		texture.bind();
		gl.generateMipmap(texture.texture_type);
		texture.has_mipmaps = true;
		texture.data = video;
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
Texture.fromTexture = function( old_texture, options) {
	options = options || {};
	var texture = new GL.Texture( old_texture.width, old_texture.height, options );
	old_texture.copyTo( texture );
	return texture;
};

Texture.prototype.clone = function( options )
{
	var old_options = this.getProperties();
	if(options)
		for(var i in options)
			old_options[i] = options[i];
	return Texture.fromTexture( this, old_options);
}

/**
* Create a texture from an ArrayBuffer containing the pixels
* @method Texture.fromTexture
* @param {number} width
* @param {number} height
* @param {ArrayBuffer} pixels
* @param {Object} options
* @return {Texture} the texture
*/
Texture.fromMemory = function( width, height, pixels, options) //format in options as format
{
	options = options || {};

	var texture = options.texture || new GL.Texture(width, height, options);
	Texture.setUploadOptions(options);
	texture.bind();

	if(pixels.constructor === Array)
	{
		if(options.type == gl.FLOAT)
			pixels = new Float32Array( pixels );
		else if(options.type == GL.HALF_FLOAT || options.type == GL.HALF_FLOAT_OES) 
			pixels = new Uint16Array( pixels ); //gl.UNSIGNED_SHORT_4_4_4_4 is only for texture that are SHORT per pixel, not per channel!
		else 
			pixels = new Uint8Array( pixels );
	}

	gl.texImage2D( gl.TEXTURE_2D, 0, texture.format, width, height, 0, texture.format, texture.type, pixels );
	texture.width = width;
	texture.height = height;
	texture.data = pixels;
	if (options.minFilter && options.minFilter != gl.NEAREST && options.minFilter != gl.LINEAR) {
		gl.generateMipmap(gl.TEXTURE_2D);
		texture.has_mipmaps = true;
	}
	gl.bindTexture(texture.texture_type, null); //disable
	return texture;
};

/**
* Create a texture from an ArrayBuffer containing the pixels
* @method Texture.fromDDSInMemory
* @param {ArrayBuffer} DDS data
* @param {Object} options
* @return {Texture} the texture
*/
Texture.fromDDSInMemory = function(data, options) //format in options as format
{
	options = options || {};

	var texture = options.texture || new GL.Texture(0, 0, options);
	GL.Texture.setUploadOptions(options);
	texture.bind();

	var ext = gl.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc") || gl.getExtension("WEBGL_compressed_texture_s3tc");
	DDS.loadDDSTextureFromMemoryEx(gl, ext, data, texture, true );

	gl.bindTexture(texture.texture_type, null); //disable
	return texture;
};

/**
* Create a generative texture from a shader ( must GL.Shader.getScreenShader as reference for the shader )
* @method Texture.fromShader
* @param {number} width
* @param {number} height
* @param {Shader} shader
* @param {Object} options
* @return {Texture} the texture
*/
Texture.fromShader = function(width, height, shader, options) {
	options = options || {};
	
	var texture = new GL.Texture( width, height, options );
	//copy content
	texture.drawTo(function() {
		gl.disable( gl.BLEND ); 
		gl.disable( gl.DEPTH_TEST );
		gl.disable( gl.CULL_FACE );
		var mesh = Mesh.getScreenQuad();
		shader.draw( mesh );
	});

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

	var width = images[0].width;
	var height = images[0].height;
	options.texture_type = gl.TEXTURE_CUBE_MAP;

	var texture = null;
	
	if(options.texture)
	{
		texture = options.texture;
		texture.width = width;
		texture.height = height;
	}
	else
		texture = new GL.Texture( width, height, options );

	Texture.setUploadOptions(options);
	texture.bind();

	try {

		for(var i = 0; i < 6; i++)
			gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X+i, 0, texture.format, texture.format, texture.type, images[i]);
		texture.data = images;
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

	texture.unbind();
	return texture;
};

/**
* Create a cubemap texture from a single image that contains all six images 
* If it is a cross, it must be horizontally aligned, and options.is_cross must be equal to the column where the top and bottom are located (usually 1 or 2)
* otherwise it assumes the 6 images are arranged vertically, in the order of OpenGL: +X, -X, +Y, -Y, +Z, -Z
* @method Texture.cubemapFromImage
* @param {Image} image
* @param {Object} options
* @return {Texture} the texture
*/
Texture.cubemapFromImage = function( image, options ) {
	options = options || {};

	if(image.width != (image.height / 6) && image.height % 6 != 0 && !options.faces && !options.is_polar )
	{
		console.error( "Cubemap image not valid, only 1x6 (vertical) or 6x3 (cross) formats. Check size:", image.width, image.height );
		return null;
	}

	var width = image.width;
	var height = image.height;

	if(options.is_polar)
	{
		var size = options.size || GL.nearestPowerOfTwo( image.height );
		var temp_tex = GL.Texture.fromImage( image, { ignore_pot:true, wrap: gl.REPEAT, filter: gl.LINEAR } );
		var cubemap = new GL.Texture( size, size, { texture_type: gl.TEXTURE_CUBE_MAP, format: gl.RGBA });
		if(options.texture)
		{
			var old_tex = options.texture;
			for(var i in cubemap)
				old_tex[i] = cubemap[i];
			cubemap = old_tex;
		}
		var rot_matrix = mat3.create();
		var uniforms = { u_texture:0, u_rotation: rot_matrix };
		gl.disable( gl.DEPTH_TEST );
		gl.disable( gl.BLEND );
		var shader = GL.Shader.getPolarToCubemapShader();
		cubemap.drawTo(function(t,i){
			var face_info = GL.Texture.cubemap_camera_parameters[ i ];
			mat3.identity( rot_matrix );
			rot_matrix.set( face_info.right, 0 );
			rot_matrix.set( face_info.up, 3 );
			rot_matrix.set( face_info.dir, 6 );
			temp_tex.toViewport( shader, uniforms );
		});
		if(options.keep_image)
			cubemap.img = image;
		return cubemap;
	}
	else if(options.is_cross !== undefined)
	{
		options.faces = Texture.generateCubemapCrossFacesInfo(image.width, options.is_cross);
		width = height = image.width / 4;
	}
	else if(options.faces)
	{
		width = options.width || options.faces[0].width;
		height = options.height || options.faces[0].height;
	}
	else
		height /= 6;

	if(width != height)
	{
		console.log("Texture not valid, width and height for every face must be square");
		return null;
	}

	var size = width;
	options.no_flip = true;

	var images = [];
	for(var i = 0; i < 6; i++)
	{
		var canvas = createCanvas( size, size );
		var ctx = canvas.getContext("2d");
		if(options.faces)
			ctx.drawImage(image, options.faces[i].x, options.faces[i].y, options.faces[i].width || size, options.faces[i].height || size, 0,0, size, size );
		else
			ctx.drawImage(image, 0, height*i, width, height, 0,0, size, size );
		images.push(canvas);
		//document.body.appendChild(canvas); //debug
	}

	var texture = Texture.cubemapFromImages(images, options);
	if(options.keep_image)
		texture.img = image;
	return texture;
};

/**
* Given the width and the height of an image, and in which column is the top and bottom sides of the cubemap, it gets the info to pass to Texture.cubemapFromImage in options.faces
* @method Texture.generateCubemapCrossFaces
* @param {number} width of the CROSS image (not the side image)
* @param {number} column the column where the top and the bottom is located
* @return {Object} object to pass to Texture.cubemapFromImage in options.faces
*/
Texture.generateCubemapCrossFacesInfo = function(width, column)
{
	if(column === undefined)
		column = 1;
	var s = width / 4;

	return [
		{ x: 2*s, y: s, width: s, height: s }, //+x
		{ x: 0, y: s, width: s, height: s }, //-x
		{ x: column*s, y: 0, width: s, height: s }, //+y
		{ x: column*s, y: 2*s, width: s, height: s }, //-y
		{ x: s, y: s, width: s, height: s }, //+z
		{ x: 3*s, y: s, width: s, height: s } //-z
	];
}

/**
* Create a cubemap texture from a single image url that contains the six images
* if it is a cross, it must be horizontally aligned, and options.is_cross must be equal to the column where the top and bottom are located (usually 1 or 2)
* otherwise it assumes the 6 images are arranged vertically.
* @method Texture.cubemapFromURL
* @param {Image} image
* @param {Object} options
* @param {Function} on_complete callback
* @return {Texture} the texture
*/
Texture.cubemapFromURL = function( url, options, on_complete ) {
	options = options || {};
	options = Object.create(options); //creates a new options using the old one as prototype
	options.texture_type = gl.TEXTURE_CUBE_MAP;
	var texture = options.texture || new GL.Texture(1, 1, options);

	texture.bind();
	Texture.setUploadOptions(options);
	var default_color = options.temp_color || [0,0,0,255];
	var temp_color = options.type == gl.FLOAT ? new Float32Array(default_color) : new Uint8Array(default_color);

	for(var i = 0; i < 6; i++)
		gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X+i, 0, texture.format, 1, 1, 0, texture.format, texture.type, temp_color);
	gl.bindTexture(texture.texture_type, null); //disable
	texture.ready = false;

	var image = new Image();
	image.src = url;
	var that = this;
	image.onload = function()
	{
		options.texture = texture;
		texture = GL.Texture.cubemapFromImage(this, options);
		if(texture)
			delete texture["ready"]; //texture.ready = true;
		if(on_complete)
			on_complete(texture);
	}

	return texture;	
};

/**
* returns an ArrayBuffer with the pixels in the texture, they are fliped in Y
* Warn: If cubemap it only returns the pixels of the first face! use getCubemapPixels instead
* @method getPixels
* @param {number} cubemap_face [optional] the index of the cubemap face to read (ignore if texture_2D)
* @param {number} mipmap level [optional, default is 0]
* @return {ArrayBuffer} the data ( Uint8Array, Uint16Array or Float32Array )
*/
Texture.prototype.getPixels = function( cubemap_face, mipmap_level )
{
	mipmap_level = mipmap_level || 0;
	var gl = this.gl;
	var v = gl.getViewport();
	var old_fbo = gl.getParameter( gl.FRAMEBUFFER_BINDING );

	if(this.format == gl.DEPTH_COMPONENT)
		throw("cannot use getPixels in depth textures");

	gl.disable( gl.DEPTH_TEST );

	//reuse fbo
	var fbo = gl.__copy_fbo;
	if(!fbo)
		fbo = gl.__copy_fbo = gl.createFramebuffer();
	gl.bindFramebuffer( gl.FRAMEBUFFER, fbo );

	var buffer = null;

	var width = this.width >> mipmap_level;
	var height = this.height >> mipmap_level;
	gl.viewport(0, 0, width, height);

	if(this.texture_type == gl.TEXTURE_2D)
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.handler, mipmap_level);
	else if(this.texture_type == gl.TEXTURE_CUBE_MAP)
		gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + (cubemap_face || 0), this.handler, mipmap_level);

	var channels = this.format == gl.RGB ? 3 : 4;
	channels = 4; //WEBGL DOES NOT SUPPORT READING 3 CHANNELS ONLY, YET...
	var type = this.type;
	//type = gl.UNSIGNED_BYTE; //WEBGL DOES NOT SUPPORT READING FLOAT seems, YET... 23/5/18 now it seems it does now

	if(type == gl.UNSIGNED_BYTE)
		buffer = new Uint8Array( width * height * channels );
	else if(type == GL.HALF_FLOAT || type == GL.HALF_FLOAT_OES) //previously half float couldnot be read
		buffer = new Uint16Array( width * height * channels ); //gl.UNSIGNED_SHORT_4_4_4_4 is only for texture that are SHORT per pixel, not per channel!
	else 
		buffer = new Float32Array( width * height * channels );

	gl.readPixels( 0,0, width, height, channels == 3 ? gl.RGB : gl.RGBA, type, buffer ); //NOT SUPPORTED FLOAT or RGB BY WEBGL YET

	//restore
	gl.bindFramebuffer(gl.FRAMEBUFFER, old_fbo );
	gl.viewport(v[0], v[1], v[2], v[3]);
	return buffer;
}

/**
* uploads some pixels to the texture (see uploadData method for more options)
* @method setPixels
* @param {ArrayBuffer} data gl.UNSIGNED_BYTE or gl.FLOAT data
* @param {Boolean} no_flip do not flip in Y 
* @param {Boolean} skip_mipmaps do not update mipmaps when possible
* @param {Number} cubemap_face if the texture is a cubemap, which face
*/
Texture.prototype.setPixels = function( data, no_flip, skip_mipmaps, cubemap_face )
{
	var options = { no_flip: no_flip };
	if(cubemap_face)
		options.cubemap_face = cubemap_face;
	this.uploadData( data, options, skip_mipmaps );
}

/**
* returns an array with six arrays containing the pixels of every cubemap face
* @method getCubemapPixels
* @return {Array} the array that has 6 typed arrays containing the pixels 
*/
Texture.prototype.getCubemapPixels = function()
{
	if(this.texture_type !== gl.TEXTURE_CUBE_MAP)
		throw("this texture is not a cubemap");
	return [ this.getPixels(0),	this.getPixels(1), this.getPixels(2), this.getPixels(3), this.getPixels(4), this.getPixels(5) ];
}

/**
* fills a cubemap given an array with typed arrays containing the pixels of 6 faces
* @method setCubemapPixels
* @param {Array} data array that has 6 typed arrays containing the pixels 
* @param {bool} noflip if pixels should not be flipped according to Y
*/
Texture.prototype.setCubemapPixels = function( data_array, no_flip )
{
	if(this.texture_type !== gl.TEXTURE_CUBE_MAP)
		throw("this texture is not a cubemap, it should be created with { texture_type: gl.TEXTURE_CUBE_MAP }");
	for(var i = 0; i < 6; ++i)
		this.setPixels( data_array[i], no_flip, i != 5, i );
}

/**
* Copy texture content to a canvas
* @method toCanvas
* @param {Canvas} canvas must have the same size, if different the canvas will be resized
* @param {boolean} flip_y optional, flip vertically
* @param {Number} max_size optional, if it is supplied the canvas wont be bigger of max_size (the image will be scaled down)
*/
Texture.prototype.toCanvas = function( canvas, flip_y, max_size )
{
	max_size = max_size || 8192;
	var gl = this.gl;

	var w = Math.min( this.width, max_size );
	var h = Math.min( this.height, max_size );

	//cross
	if(this.texture_type == gl.TEXTURE_CUBE_MAP)
	{
		w = w * 4;
		h = h * 3;
	}

	canvas = canvas || createCanvas( w, h );
	if(canvas.width != w) 
		canvas.width = w;
	if(canvas.height != h)
		canvas.height = h;

	var buffer = null;
	if(this.texture_type == gl.TEXTURE_2D )
	{
		if(this.width != w || this.height != h || this.type != gl.UNSIGNED_BYTE) //resize image to fit the canvas
		{
			//create a temporary texture
			var temp = new GL.Texture(w,h,{ format: gl.RGBA, filter: gl.NEAREST });
			this.copyTo( temp );	
			buffer = temp.getPixels();
		}
		else
			buffer = this.getPixels();

		var ctx = canvas.getContext("2d");
		var pixels = ctx.getImageData(0,0,w,h);
		pixels.data.set( buffer );
		ctx.putImageData(pixels,0,0);

		if(flip_y)
		{
			var temp = createCanvas(w,h);
			var temp_ctx = temp.getContext("2d");
			temp_ctx.translate(0,temp.height);
			temp_ctx.scale(1,-1);
			temp_ctx.drawImage( canvas, 0, 0, temp.width, temp.height );
			ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
			ctx.drawImage( temp, 0, 0 );
		}
	}
	else if(this.texture_type == gl.TEXTURE_CUBE_MAP )
	{
		var temp_canvas = createCanvas( this.width, this.height );
		var temp_ctx = temp_canvas.getContext("2d");
		var info = GL.Texture.generateCubemapCrossFacesInfo( canvas.width, 1 );
		var ctx = canvas.getContext("2d");
		ctx.fillStyle = "black";
		ctx.fillRect(0,0,canvas.width, canvas.height );

		var cubemap = this;
		if(this.type != gl.UNSIGNED_BYTE) //convert pixels to uint8 as it is the only supported format by the canvas
		{
			//create a temporary texture
			cubemap = new GL.Texture( this.width, this.height, { format: gl.RGBA, texture_type: gl.TEXTURE_CUBE_MAP, filter: gl.NEAREST, type: gl.UNSIGNED_BYTE });
			this.copyTo( cubemap );
		}

		for(var i = 0; i < 6; i++)
		{
			var pixels = temp_ctx.getImageData(0,0, temp_canvas.width, temp_canvas.height );
			buffer = cubemap.getPixels(i);
			pixels.data.set( buffer );
			temp_ctx.putImageData(pixels,0,0);
			ctx.drawImage( temp_canvas, info[i].x, info[i].y, temp_canvas.width, temp_canvas.height );
		}
	}

	return canvas;
}


/**
* returns the texture file in binary format 
* @method toBinary
* @param {Boolean} flip_y
* @return {ArrayBuffer} the arraybuffer of the file containing the image
*/
Texture.binary_extension = "png";
Texture.prototype.toBinary = function(flip_y, type)
{
	//dump to canvas
	var canvas = this.toCanvas(null,flip_y);
	//use the slow method (because its sync)
	var data = canvas.toDataURL( type );
	var index = data.indexOf(",");
	var base64_data = data.substr(index+1);
	var binStr = atob( base64_data );
	var len = binStr.length,
	arr = new Uint8Array(len);
	for (var i=0; i<len; ++i ) {
		arr[i] = binStr.charCodeAt(i);
	}
	return arr;
}

/**
* returns a Blob containing all the data from the texture
* @method toBlob
* @return {Blob} the blob containing the data
*/
Texture.prototype.toBlob = function(flip_y, type)
{
	var arr = this.toBinary( flip_y );
	var blob = new Blob( [arr], {type: type || 'image/png'} );
	return blob;
}

//faster depending on the browser
Texture.prototype.toBlobAsync = function(flip_y, type, callback)
{
	//dump to canvas
	var canvas = this.toCanvas(null,flip_y);

	//some browser support a fast way to blob a canvas
	if(canvas.toBlob)
	{
		canvas.toBlob( callback, type );
		return;
	}

	//use the slow method
	var blob = this.toBlob( flip_y, type );
	if(callback)
		callback(blob);
}


/**
* returns a base64 String containing all the data from the texture
* @method toBase64
* @param {boolean} flip_y if you want to flip vertically the image, WebGL saves the images upside down
* @return {String} the data in base64 format
*/
Texture.prototype.toBase64 = function( flip_y )
{
	var w = this.width;
	var h = this.height;

	//Read pixels form WebGL
	var buffer = this.getPixels();

	//dump to canvas so we can encode it
	var canvas = createCanvas(w,h);
	var ctx = canvas.getContext("2d");
	var pixels = ctx.getImageData(0,0,w,h);
	pixels.data.set( buffer );
	ctx.putImageData(pixels,0,0);

	if(flip_y)
	{
		var temp_canvas = createCanvas(w,h);
		var temp_ctx = temp_canvas.getContext("2d");
		temp_ctx.translate(0,h);
		temp_ctx.scale(1,-1);
		temp_ctx.drawImage( canvas, 0, 0);
		canvas = temp_canvas;
	}

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
	if(!a || !b) 
		return false;
	if(a == b) 
		return true;

	if( a.width != b.width || 
		a.height != b.height || 
		a.type != b.type || //gl.UNSIGNED_BYTE
		a.format != b.format || //gl.RGB
		a.texture_type != b.texture_type) //gl.TEXTURE_2D
		return false;
	return true;
}

/**
* blends texture A and B and stores the result in OUT
* @method blend
* @param {Texture} a
* @param {Texture} b
* @param {Texture} out [optional]
* @return {Object}
*/
Texture.blend = function( a, b, factor, out )
{
	if(!a || !b) 
		return false;
	if(a == b) 
	{
		if(out)
			a.copyTo(out);
		else
			a.toViewport();
		return true;
	}

	gl.disable( gl.BLEND );
	gl.disable( gl.DEPTH_TEST );
	gl.disable( gl.CULL_FACE );

	var shader = GL.Shader.getBlendShader();
	var mesh = GL.Mesh.getScreenQuad();
	b.bind(1);
	shader.uniforms({u_texture: 0, u_texture2: 1, u_factor: factor});

	if(out)
	{
		out.drawTo( function(){
			if(a == out || b == out)
				throw("Blend output cannot be the same as the input");
			a.bind(0);
			shader.draw( mesh, gl.TRIANGLES );
		});
		return true;
	}

	a.bind(0);
	shader.draw( mesh, gl.TRIANGLES );
	return true;
}

Texture.cubemapToTexture2D = function( cubemap_texture, size, target_texture, keep_type, yaw )
{
	if(!cubemap_texture || cubemap_texture.texture_type != gl.TEXTURE_CUBE_MAP)
		throw("No cubemap in convert");

	size = size || cubemap_texture.width;
	var type = keep_type ? cubemap_texture.type : gl.UNSIGNED_BYTE;
	yaw = yaw || 0;
	if(!target_texture)
		target_texture = new GL.Texture(size*2,size,{ minFilter: gl.NEAREST, type: type });
	var shader = gl.shaders["cubemap_to_texture2D"];
	if(!shader)
	{
		shader = gl.shaders["cubemap_to_texture2D"] = new GL.Shader( GL.Shader.SCREEN_VERTEX_SHADER, '\
		precision mediump float;\n\
		#define PI 3.14159265358979323846264\n\
		uniform samplerCube texture;\
		varying vec2 v_coord;\
		uniform float u_yaw;\n\
		void main() {\
			float alpha = ((1.0 - v_coord.x) * 2.0) * PI + u_yaw;\
			float beta = (v_coord.y * 2.0 - 1.0) * PI * 0.5;\
			vec3 N = vec3( -cos(alpha) * cos(beta), sin(beta), sin(alpha) * cos(beta) );\
			gl_FragColor = textureCube(texture,N);\
		}');
	}
	shader.setUniform("u_yaw", yaw );
	target_texture.drawTo(function() {
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.CULL_FACE);
		gl.disable(gl.BLEND);
		cubemap_texture.toViewport( shader );
	});
	return target_texture;
}

/**
* returns a white texture of 1x1 pixel 
* @method Texture.getWhiteTexture
* @return {Texture} the white texture
*/
Texture.getWhiteTexture = function( gl )
{
	gl = gl || global.gl;
	var tex = gl.textures[":white"];
	if(tex)
		return tex;

	var color = new Uint8Array([255,255,255,255]);
	return gl.textures[":white"] = new GL.Texture(1,1,{ pixel_data: color });
}

/**
* returns a black texture of 1x1 pixel 
* @method Texture.getBlackTexture
* @return {Texture} the black texture
*/
Texture.getBlackTexture = function( gl )
{
	gl = gl || global.gl;
	var tex = gl.textures[":black"];
	if(tex)
		return tex;
	var color = new Uint8Array([0,0,0,255]);
	return gl.textures[":black"] = new GL.Texture(1,1,{ pixel_data: color });
}


/**
* Returns a texture from the texture pool, if none matches the specifications it creates one
* @method Texture.getTemporary
* @param {Number} width the texture width
* @param {Number} height the texture height
* @param {Object|Texture} options to specifiy texture_type,type,format, it can be an object or another texture
* @param {WebGLContext} gl [optional]
* @return {Texture} the textures that matches this settings
*/
Texture.getTemporary = function( width, height, options, gl )
{
	gl = gl || global.gl;

	if(!gl._texture_pool)
		gl._texture_pool = [];

	var result = null;

	var texture_type = GL.TEXTURE_2D;
	var type = Texture.DEFAULT_TYPE;
	var format = Texture.DEFAULT_FORMAT;

	if(options)
	{
		if(options.texture_type)
			texture_type = options.texture_type;
		if(options.type)
			type = options.type;
		if(options.format)
			format = options.format;
	}

	//var key = (type&0xFFFF) + ((width&0xFFFF)<<16) + ((height&0xFFFF)<<32); // 64bits key: 0x0000 type width height WRONG
	var key = texture_type + ":" + type + ":" + width + "x" + height + ":" + format;

	//iterate
	var pool = gl._texture_pool;
	for(var i = 0; i < pool.length; ++i)
	{
		var tex = pool[i];
		if( tex._key != key ) //|| tex.texture_type != texture_type || tex.format != format )
			continue;
		//remove from the pool
		pool.splice(i,1); 
		tex._pool = 0;
		return tex; //return
	}

	//not found, create it
	var tex = new GL.Texture( width, height, { type: type, texture_type: texture_type, format: format, filter: gl.LINEAR });
	tex._key = key;
	tex._pool = 0;
	return tex;
}

/**
* Given a texture it adds it to the texture pool so it can be reused in the future
* @method Texture.releaseTemporary
* @param {GL.Texture} tex
* @param {WebGLContext} gl [optional]
*/

Texture.releaseTemporary = function( tex, gl )
{
	gl = gl || global.gl;

	if(!gl._texture_pool)
		gl._texture_pool = [];

	//if pool is greater than zero means this texture is already inside
	if( tex._pool > 0 )
		console.warn("this texture is already in the textures pool");

	var pool = gl._texture_pool;
	if(!pool)
		pool = gl._texture_pool = [];
	tex._pool = getTime();
	pool.push( tex );

	//do not store too much textures in the textures pool
	if( pool.length > 20 )
	{
		pool.sort( function(a,b) { return b._pool - a._pool } ); //sort by time
		//pool.sort( function(a,b) { return a._key - b._key } ); //sort by size
		var tex = pool.pop(); //free the last one
		tex._pool = 0;
		tex.delete();
	}
}

//returns the next power of two bigger than size
Texture.nextPOT = function( size )
{
	return Math.pow( 2, Math.ceil( Math.log(size) / Math.log(2) ) );
}