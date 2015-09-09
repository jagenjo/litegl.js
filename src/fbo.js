//FBO.js for FrameBufferObjects

function FBO( textures, depth_texture )
{
	this.handler = null;
	this.width = -1;
	this.height = -1;
	this.color_textures = [];
	this.depth_texture = null;

	//assign textures
	if(textures && textures.length)
		this.setTextures( textures, depth_texture );

	//save state
	this._old_fbo = null;
	this._old_viewport = new Float32Array(4);
}

GL.FBO = FBO;

FBO.prototype.setTextures = function( color_textures, depth_texture, skip_disable )
{
	//test if is already binded
	var same = this.depth_texture == depth_texture;
	if( same )
	{
		if( color_textures.length == this.color_textures.length )
		{
			for(var i = 0; i < color_textures.length; ++i)
				if( color_textures[i] != this.color_textures[i] )
				{
					same = false;
					break;
				}
		}
		else
			same = false;
	}
		
	if(same)
		return;


	//save state to restore afterwards
	this._old_fbo = gl.getParameter( gl.FRAMEBUFFER_BINDING );

	if(!this.handler)
		this.handler = gl.createFramebuffer();

	var w = -1,
		h = -1,
		type = null;

	var previously_attached = 0;
	if( this.color_textures )
		previously_attached = this.color_textures.length;

	this.color_textures = color_textures;
	this.depth_texture = depth_texture;

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
	else //create a renderbuffer to store depth
	{
		var renderbuffer = this._renderbuffer = this._renderbuffer || gl.createRenderbuffer();
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

	//detach old ones (only is reusing a FBO with a different set of textures)
	for(var i = color_textures.length; i < previously_attached; ++i)
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, null, 0);

	//when using more than one texture you need to use the multidraw extension
	if(color_textures.length > 1)
		ext.drawBuffersWEBGL( this.order );

	//check completion
	var complete = gl.checkFramebufferStatus( gl.FRAMEBUFFER );
	if(complete !== gl.FRAMEBUFFER_COMPLETE)
		throw("FBO not complete: " + complete);


	//restore state
	gl.bindTexture(gl.TEXTURE_2D, null);
	gl.bindRenderbuffer(gl.RENDERBUFFER, null);
	if(!skip_disable)
		gl.bindFramebuffer( gl.FRAMEBUFFER, this._old_fbo );
}

FBO.prototype.bind = function( keep_old )
{
	if(!this.color_textures.length)
		throw("FBO: no textures attached to FBO");
	this._old_viewport.set( gl.viewport_data );

	if(keep_old)
		this._old_fbo = gl.getParameter( gl.FRAMEBUFFER_BINDING );
	else
		this._old_fbo = null;

	if(this._old_fbo != this.handler )
		gl.bindFramebuffer( gl.FRAMEBUFFER, this.handler );
	gl.viewport( 0,0, this.width, this.height );
}

FBO.prototype.unbind = function()
{
	gl.bindFramebuffer( gl.FRAMEBUFFER, this._old_fbo );
	this._old_fbo = null;

	gl.setViewport( this._old_viewport );
}


