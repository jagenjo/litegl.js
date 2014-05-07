"use strict";

//polyfill
window.requestAnimationFrame = window.requestAnimationFrame || window.mozRequestAnimationFrame || window.webkitRequestAnimationFrame || function(callback) { setTimeout(callback, 1000 / 60); };


/**
* The static module that contains all the features
* @class GL
*/
var GL = {
	blockable_keys: {"Up":true,"Down":true,"Left":true,"Right":true},

	//some consts
	LEFT_MOUSE_BUTTON: 1,
	RIGHT_MOUSE_BUTTON: 3,
	MIDDLE_MOUSE_BUTTON: 2,

	/**
	* creates a new WebGL canvas
	* @method create
	* @param {Object} options supported are: width, height
	* @return {gl} gl context for webgl
	*/
	create: function(options) {
		options = options || {};
		var canvas = null;
		if(options.canvas)
		{
			if(typeof(options.canvas) == "string")
			{
				canvas = document.getElementById( options.canvas );
				if(!canvas) throw("Canvas element not found: " + options.canvas );
			}
			else 
				canvas = options.canvas;
		}
		else
			canvas = createCanvas(  options.width || 800, options.height || 600 );

		if (!('alpha' in options)) options.alpha = false;
		try { gl = canvas.getContext('webgl', options); } catch (e) {}
		try { gl = gl || canvas.getContext('experimental-webgl', options); } catch (e) {}
		if (!gl) { throw 'WebGL not supported'; }

		//get some useful extensions
		gl.derivatives_supported = gl.getExtension('OES_standard_derivatives') || false ;
		gl.depth_ext = gl.getExtension("WEBGL_depth_texture") || gl.getExtension("WEBKIT_WEBGL_depth_texture") || gl.getExtension("MOZ_WEBGL_depth_texture");

		//for float textures
		gl.float_ext = gl.getExtension("OES_texture_float");
		gl.float_ext_linear = gl.getExtension("OES_texture_float_linear");
		gl.half_float_ext = gl.getExtension("OES_texture_half_float");
		gl.half_float_ext_linear = gl.getExtension("OES_texture_half_float_linear");
		gl.HALF_FLOAT_OES = 0x8D61; 
		gl.max_texture_units = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
		gl.HIGH_PRECISION_FORMAT = gl.half_float_ext ? gl.HALF_FLOAT_OES : (gl.float_ext ? gl.FLOAT : gl.UNSIGNED_BYTE); //because Firefox dont support half float

		//viewport hack to retrieve it without using getParameter (which is slow)
		gl._viewport_func = gl.viewport;
		gl.viewport_data = new Float32Array([0,0,gl.canvas.width,gl.canvas.height]);
		gl.viewport = function(a,b,c,d) { this.viewport_data.set([a,b,c,d]); this._viewport_func(a,b,c,d); }
		gl.getViewport = function() { return new Float32Array( gl.viewport_data ); };
		
		//just some checks
		if(typeof(glMatrix) == "undefined")
			throw("glMatrix not found, LiteGL requires glMatrix to be included");

		var last_click_time = 0;
		gl.mouse_buttons = 0;		


		/**
		* Launch animation loop (calls gl.onupdate and gl.ondraw every frame)
		* @method gl.animate
		*/
		gl.animate = function() {
			var post = window.requestAnimationFrame;
			var time = getTime();
			var context = this;

			//loop only if browser tab visible
			function loop() {
				post(loop); //do it first, in case it crashes

				var now = getTime();
				var dt = (now - time) / 1000;

				if (context.onupdate) context.onupdate(dt);
				if (context.ondraw) context.ondraw();
				time = now;
			}
			post(loop); //launch main loop
		}	

		/**
		* Tells the system to capture mouse events on the canvas. This will trigger onmousedown, onmousemove, onmouseup, onmousewheel callbacks in the canvas.
		* @method gl.captureMouse
		* @param {boolean} capture_wheel capture also the mouse wheel
		*/
		gl.captureMouse = function(capture_wheel) {

			canvas.addEventListener("mousedown", onmouse);
			canvas.addEventListener("mousemove", onmouse);
			if(capture_wheel)
			{
				canvas.addEventListener("mousewheel", onmouse, false);
				canvas.addEventListener("wheel", onmouse, false);
				//canvas.addEventListener("DOMMouseScroll", onmouse, false);
			}
			//prevent right click context menu
			canvas.addEventListener("contextmenu", function(e) { e.preventDefault(); return false; });

			canvas.addEventListener("touchstart", ontouch, true);
			canvas.addEventListener("touchmove", ontouch, true);
			canvas.addEventListener("touchend", ontouch, true);
			canvas.addEventListener("touchcancel", ontouch, true);   
		}

		function onmouse(e) {
			var old_mouse_mask = gl.mouse_buttons;
			GL.augmentEvent(e, canvas);
			e.eventType = e.eventType || e.type; //type cannot be overwritten, so I make a clone to allow me to overwrite
			var now = getTime();

			if(e.eventType == "mousedown")
			{
				if(old_mouse_mask == 0) //no mouse button was pressed till now
				{
					canvas.removeEventListener("mousemove", onmouse);
					document.addEventListener("mousemove", onmouse);
					document.addEventListener("mouseup", onmouse);
				}
				last_click_time = now;

				if(gl.onmousedown) gl.onmousedown(e);
			}
			else if(e.eventType == "mousemove" && gl.onmousemove)
			{ 
				//move should be propagated (otherwise other components may fail)
				e.click_time = now - last_click_time;
				gl.onmousemove(e); 
				return; 
			} 
			else if(e.eventType == "mouseup")
			{
				if(gl.mouse_buttons == 0) //no more buttons pressed
				{
					canvas.addEventListener("mousemove", onmouse);
					document.removeEventListener("mousemove", onmouse);
					document.removeEventListener("mouseup", onmouse);
				}
				e.click_time = now - last_click_time;
				last_click_time = now;

				if(gl.onmouseup) gl.onmouseup(e);
			}
			else if(gl.onmousewheel && (e.eventType == "mousewheel" || e.eventType == "wheel" || e.eventType == "DOMMouseScroll"))
			{ 
				e.eventType = "mousewheel";
				if(e.type == "wheel")
					e.wheel = -e.deltaY;
				else
					e.wheel = (e.wheelDeltaY != null ? e.wheelDeltaY : e.detail * -60);
				gl.onmousewheel(e);
			}

			e.stopPropagation();
			e.preventDefault();
			return false;
		}

		//translates touch events in mouseevents
		function ontouch(e)
		{
			var touches = event.changedTouches,
				first = touches[0],
				type = "";

			 switch(event.type)
			{
				case "touchstart": type = "mousedown"; break;
				case "touchmove":  type = "mousemove"; break;        
				case "touchend":   type = "mouseup"; break;
				default: return;
			}

			var simulatedEvent = document.createEvent("MouseEvent");
			simulatedEvent.initMouseEvent(type, true, true, window, 1,
									  first.screenX, first.screenY,
									  first.clientX, first.clientY, false,
									  false, false, false, 0/*left*/, null);
			first.target.dispatchEvent(simulatedEvent);
			event.preventDefault();
		}

		/**
		* Tells the system to capture key events on the canvas. This will trigger onkey
		* @method gl.captureKeys
		* @param {boolean} prevent_default prevent default behaviour (like scroll on the web, etc)
		*/
		gl.captureKeys = function( prevent_default ) {
			gl.keys = {};
			document.addEventListener("keydown", function(e) { onkey(e, prevent_default); });
			document.addEventListener("keyup", function(e) { onkey(e, prevent_default); });
		}

		function onkey(e, prevent_default)
		{
			//trace(e);
			e.eventType = e.type; //type cannot be overwritten, so I make a clone to allow me to overwrite

			var target_element = e.target.nodeName.toLowerCase();
			if(target_element == "input" || target_element == "textarea" || target_element == "select")
				return;

			e.character = String.fromCharCode(e.keyCode).toLowerCase();

			if (!e.altKey && !e.ctrlKey && !e.metaKey) {
				var key = GL.mapKeyCode(e.keyCode);
				if (key) gl.keys[key] = e.type == "keydown";
				gl.keys[e.keyCode] = e.type == "keydown";
			}

			if(e.type == "keydown" && gl.onkeydown) gl.onkeydown(e);
			else if(e.type == "keyup" && gl.onkeyup) gl.onkeyup(e);

			if(prevent_default && (e.isChar || GL.blockable_keys[e.keyIdentifier || e.key ]) )
				e.preventDefault();
		}

		//gamepads
		gl.gamepads = null;
		function onButton(e, pressed)
		{
			console.log(e);
			if(pressed && gl.onbuttondown) gl.onbuttondown(e);
			else if(!pressed && gl.onbuttonup) gl.onbuttonup(e);
		}

		/**
		* Tells the system to capture gamepad events on the canvas. 
		* @method gl.captureGamepads
		*/
		gl.captureGamepads = function()
		{
			var getGamepads = navigator.getGamepads || navigator.webkitGetGamepads || navigator.mozGetGamepads; 
			if(!getGamepads) return;
			this.gamepads = getGamepads.call(navigator);

			//only in firefox
			window.addEventListener("gamepadButtonDown", function(e) { onButton(e, true); }, false);
			window.addEventListener("MozGamepadButtonDown", function(e) { onButton(e, true); }, false);
			window.addEventListener("WebkitGamepadButtonDown", function(e) { onButton(e, true); }, false);
			window.addEventListener("gamepadButtonUp", function(e) { onButton(e, false); }, false);
			window.addEventListener("MozGamepadButtonUp", function(e) { onButton(e, false); }, false);
			window.addEventListener("WebkitGamepadButtonUp", function(e) { onButton(e, false); }, false);
		}

		/**
		* returns the detected gamepads on the system
		* @method gl.getGamepads
		*/
		gl.getGamepads = function()
		{
			//gamepads
			var getGamepads = navigator.getGamepads || navigator.webkitGetGamepads || navigator.mozGetGamepads; 
			if(!getGamepads) return;
			var gamepads = getGamepads.call(navigator);
			var gamepad = null;
			for(var i = 0; i < 4; i++)
				if (gamepads[i])
				{
					gamepad = gamepads[i];
					if(this.gamepads) //launch connected gamepads: NOT TESTED
					{
						if(!this.gamepads[i] && gamepads[i] && this.ongamepadconnected)
							this.ongamepadconnected(gamepad);
						else if(this.gamepads[i] && !gamepads[i] && this.ongamepaddisconnected)
							this.ongamepaddisconnected(this.gamepads[i]);
					}
				}
			this.gamepads = gamepads;
			return gamepads;
		}

		gl.fullscreen = function()
		{
			var canvas = this.canvas;
			if(canvas.requestFullScreen)
				canvas.requestFullScreen();
			else if(canvas.webkitRequestFullScreen)
				canvas.webkitRequestFullScreen();
			else if(canvas.mozRequestFullScreen)
				canvas.mozRequestFullScreen();
			else
				console.error("Fullscreen not supported");
		}

		return gl;
	},

	mapKeyCode: function(code) {
		var named = {
			8: 'BACKSPACE',
			9: 'TAB',
			13: 'ENTER',
			16: 'SHIFT',
			27: 'ESCAPE',
			32: 'SPACE',
			37: 'LEFT',
			38: 'UP',
			39: 'RIGHT',
			40: 'DOWN'
		};
		return named[code] || (code >= 65 && code <= 90 ? String.fromCharCode(code) : null);
	},

	//add useful info to the event
	dragging: false,
	last_pos: null,

	augmentEvent: function(e, root_element)
	{
		var offset_left = 0;
		var offset_top = 0;
		var b = null;

		root_element = root_element || e.target || gl.canvas;
		b = root_element.getBoundingClientRect();
			
		e.mousex = e.pageX - b.left;
		e.mousey = e.pageY - b.top;
		e.canvasx = e.mousex;
		e.canvasy = b.height - e.mousey;
		e.deltax = 0;
		e.deltay = 0;
		
		//console.log("WHICH: ",e.which," BUTTON: ",e.button, e.type);

		if(e.type == "mousedown")
		{
			this.dragging = true;
			gl.mouse_buttons |= (1 << e.which); //enable
		}
		else if (e.type == "mousemove")
		{
			//trace(e.mousex + " " + e.mousey);
		}
		else if (e.type == "mouseup")
		{
			gl.mouse_buttons = gl.mouse_buttons & ~(1 << e.which);
			//console.log("BUT:", e.button, "MASK:", gl.mouse_buttons);
			if(gl.mouse_buttons == 0)
				this.dragging = false;
		}

		if(this.last_pos)
		{
			e.deltax = e.mousex - this.last_pos[0];
			e.deltay = e.mousey - this.last_pos[1];
		}

		this.last_pos = [e.mousex, e.mousey];
		e.dragging = this.dragging;
		e.buttons_mask = gl.mouse_buttons;			

		e.leftButton = gl.mouse_buttons & (1<<GL.LEFT_MOUSE_BUTTON);
		e.rightButton = gl.mouse_buttons & (1<<GL.RIGHT_MOUSE_BUTTON);
		e.isButtonPressed = function(num) { return this.buttons_mask & (1<<num); }
	},

	Buffer: Buffer,
	Mesh: Mesh,
	Texture: Texture,
	Shader: Shader,

	//mini textures manager
	textures: {},
	_loading_textures: {},

	loadTexture: function(url, options, on_load)
	{
		if(this.textures[url]) return this.textures[url];
		if(this._loading_textures[url]) return null;
		var img = new Image();
		img.url = url;
		img.onload = function()
		{
			var texture = GL.Texture.fromImage(this, options);
			texture.img = this;
			GL.textures[this.url] = texture;
			delete GL._loading_textures[this.url];
			if(on_load) on_load(texture);
		} 
		img.src = url;
		this._loading_textures[url] = true;
		return null;
	}


};


//Define WEBGL ENUMS as statics
//sometimes I need some gl enums before having the gl context, solution: define them globally because the specs says they are constant:

GL.BYTE = 5120;
GL.UNSIGNED_BYTE = 5121;
GL.SHORT = 5122;
GL.UNSIGNED_SHORT = 5123;
GL.INT = 5124;
GL.UNSIGNED_INT = 5125;
GL.FLOAT = 5126;
GL.UNSIGNED_BYTE = 5125;

GL.ZERO = 0;
GL.ONE = 1;
GL.SRC_COLOR = 768;
GL.ONE_MINUS_SRC_COLOR = 769;
GL.SRC_ALPHA = 770;
GL.ONE_MINUS_SRC_ALPHA = 771;
GL.DST_ALPHA = 772;
GL.ONE_MINUS_DST_ALPHA = 773;
GL.DST_COLOR = 774;
GL.ONE_MINUS_DST_COLOR = 775;
GL.SRC_ALPHA_SATURATE = 776;
GL.CONSTANT_COLOR = 32769;
GL.ONE_MINUS_CONSTANT_COLOR = 32770;
GL.CONSTANT_ALPHA = 32771;
GL.ONE_MINUS_CONSTANT_ALPHA = 32772;



