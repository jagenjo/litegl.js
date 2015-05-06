//FBO.js for FrameBufferObjects

function FBO( textures, depth_texture )
{
	this.handler = null;

	this.color_textures = textures;
	this.depth_texture = depth_texture;

	this.init();
}

GL.FBO = FBO;

FBO.prototype.init = function()
{
	if(!this.handler)
		this.handler = gl.createFramebuffer();

	var w = -1,
		h = -1,
		type = null;

	var color_textures = this.color_textures;
	var depth_texture = this.depth_texture;

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

	this.width = w;
	this.height = h;

	gl.bindFramebuffer( gl.FRAMEBUFFER, this.handler );

	var ext = gl.extensions["WEBGL_draw_buffers"];
	if(!ext && color_textures.length > 1)
		throw("Rendering to several textures not supported");

	if( depth_texture )
	{
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth_texture.handler, 0);
	}
	else //create a temporary renderbuffer
	{
		var renderbuffer = gl.createRenderbuffer();
		renderbuffer.width = w;
		renderbuffer.height = h;
		gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer );
		gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
		gl.framebufferRenderbuffer( gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer );
	}

	this.order = []; //draw_buffers request the use of an array with the order of the attachments
	for(var i = 0; i < color_textures.length; i++)
	{
		var t = color_textures[i];

		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t.handler, 0);
		this.order.push( gl.COLOR_ATTACHMENT0 + i );
	}

	if(color_textures.length > 1)
		ext.drawBuffersWEBGL( this.order );

	var complete = gl.checkFramebufferStatus( gl.FRAMEBUFFER );
	if(complete !== gl.FRAMEBUFFER_COMPLETE)
		throw("FBO not complete: " + complete);

	//disable all
	gl.bindFramebuffer( gl.FRAMEBUFFER, null );
	gl.bindTexture(gl.TEXTURE_2D, null);
	gl.bindRenderbuffer(gl.RENDERBUFFER, null);
}


FBO.prototype.bind = function( keep_old )
{
	if(keep_old)
	{
		this._old_fbo = gl.getParameter( gl.FRAMEBUFFER_BINDING );
		if(!this._old_viewport)
			this._old_viewport = gl.getViewport(); 
		else
			this._old_viewport.set( gl.viewport_data );
	}
	else
	{
		this._old_fbo = null;
		this._old_viewport = null;
	}


	gl.bindFramebuffer( gl.FRAMEBUFFER, this.handler );
	gl.viewport( 0,0, this.width, this.height );
}

FBO.prototype.unbind = function()
{
	if(this._old_fbo)
	{
		gl.bindFramebuffer( gl.FRAMEBUFFER, this._old_fbo );
		var v = this._old_viewport;
		gl.viewport( v[0], v[1], v[2], v[3] );
		this._old_fbo = null;
	}
	else
	{
		gl.bindFramebuffer( gl.FRAMEBUFFER, null );
		gl.viewport( 0,0, gl.canvas.width, gl.canvas.height );
	}
}


