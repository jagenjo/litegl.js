/** FBO for FrameBufferObjects, FBOs are used to store the render inside one or several textures (include the depth buffer)
* @class FBO
* @param {Array} color_textures an array containing the color textures, if not supplied a render buffer will be used
* @param {GL.Texture} depth_texture the depth texture, if not supplied a render buffer will be used
* @constructor
*/
function FBO( textures, depth_texture, gl )
{
	gl = gl || global.gl;
	this.gl = gl;
	this._context_id = gl.context_id; 

	this.handler = null;
	this.width = -1;
	this.height = -1;
	this.color_textures = [];
	this.depth_texture = null;

	//assign textures
	if((textures && textures.length) || depth_texture)
		this.setTextures( textures, depth_texture );

	//save state
	this._old_fbo = null;
	this._old_viewport = new Float32Array(4);
}

GL.FBO = FBO;

/**
* Changes the textures binded to this FBO
* @method setTextures
* @param {Array} color_textures an array containing the color textures, if not supplied a render buffer will be used
* @param {GL.Texture} depth_texture the depth texture, if not supplied a render buffer will be used
*/
FBO.prototype.setTextures = function( color_textures, depth_texture, skip_disable )
{
	//test if is already binded
	var same = this.depth_texture == depth_texture;
	if( same && color_textures)
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

	this.color_textures = color_textures || [];
	this.depth_texture = depth_texture;

	//compute the W and H (and check they have the same size)
	if(color_textures)
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
	else
	{
		w = depth_texture.width;
		h = depth_texture.height;
	}

	this.width = w;
	this.height = h;

	gl.bindFramebuffer( gl.FRAMEBUFFER, this.handler );

	if(depth_texture && !gl.extensions["WEBGL_depth_texture"])
		throw("Rendering to depth texture not supported by your browser");

	//draw_buffers allow to have more than one color texture binded in a FBO
	var ext = gl.extensions["WEBGL_draw_buffers"];
	if(!ext && color_textures && color_textures.length > 1)
		throw("Rendering to several textures not supported by your browser");

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

	if(color_textures)
	{
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
	}
	else //create renderbuffer to store color
	{
		var renderbuffer = this._renderbuffer = this._renderbuffer || gl.createRenderbuffer();
		renderbuffer.width = w;
		renderbuffer.height = h;
		gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer );
		gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA4, w, h);
		gl.framebufferRenderbuffer( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, renderbuffer );
	}

	//when using more than one texture you need to use the multidraw extension
	if(color_textures && color_textures.length > 1)
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

/**
* Enables this FBO (from now on all the render will be stored in the textures attached to this FBO
* It stores the previous viewport to restore it afterwards, and changes it to full FBO size
* @method bind
* @param {boolean} keep_old keeps the previous FBO is one was attached to restore it afterwards
*/
FBO.prototype.bind = function( keep_old )
{
	if(!this.color_textures.length && !this.depth_texture)
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

/**
* Disables this FBO, if it was binded with keep_old then the old FBO is enabled, otherwise it will render to the screen
* Restores viewport to previous
* @method unbind
*/
FBO.prototype.unbind = function()
{
	gl.bindFramebuffer( gl.FRAMEBUFFER, this._old_fbo );
	this._old_fbo = null;

	gl.setViewport( this._old_viewport );
}


