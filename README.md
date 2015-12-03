litegl.js
=========

Litegl.js is a library that wraps WebGL to make it more user-friendly by creating classes for managing different items like Buffer, Mesh, Texture, Shader and other common aspects of any WebGL applications.
It is a fork from [LightGL.js](https://github.com/evanw/lightgl.js/) by [Evan Wallace](http://madebyevan.com), but some major changes have been made.
Some of the main differences:

 * Matrices have been replaced by glMatrix
 * Meshes are forced to be stored in ArrayBuffer formats
 * Meshes support range rendering with offset
 * Removed fixed pipeline behaviour
 * Better event handling (mouse position, mouse wheel, dragging)
 * Textures expanded to support Arraybuffers and Cubemaps
 * Events system to trigger events from any object
 * Support for multiple WebGL contexts in the same page

This library has been used in several projects like [Rendeer.js](https://github.com/jagenjo/rendeer.js) or [Canvas2DtoWebGL](https://github.com/jagenjo/Canvas2DtoWebGL).</p>


Demos
-----
Demos are included in the Examples folder but you can check them in [this website](http://tamats.com/projects/litegl/examples).

Usage
-----

Include the library and dependencies
```html
<script src="js/gl-matrix-min.js"></script>
<script src="js/litegl.js"></script>
```

Create the context
```js
var gl = GL.create({width:800, height:600});
```

Attach to DOM
```js
document.getElementById("mycontainer").appendChild( gl.canvas )
```

Get user input
```js
gl.captureMouse();
gl.onmousedown = function(e) { ... }

gl.captureKeys();
gl.onkey = function(e) { ... }
```

Compile shader
```js
var shader = new GL.Shader( vertex_shader_code, fragment_shader_code );
```

Create Mesh
```js
var mesh = new GL.Mesh({vertices:[-1,-1,0, 1,-1,0, 0,1,0], coords:[0,0, 1,0, 0.5,1]});
```

Load a texture
```js
var texture = GL.Texture.fromURL("image.jpg", { minFilter: gl.LINEAR_MIPMAP_LINEAR });
```


Render
```js
gl.ondraw = function() {
	texture.bind(0);
	var my_uniforms = { u_texture: 0, u_color: [1,1,1,1] };
	shader.uniforms( my_uniforms ).draw( mesh );
}

gl.animate(); //calls the requestAnimFrame constantly, which will call ondraw
```


Documentation
-------------
The doc folder contains the documentation. For info about [http://glmatrix.com](glMatrix) check the documentation in its website.

Utils
-----

It includes several commands in the utils folder to generate doc, check errors and build minifyed version.


Feedback
--------

You can write any feedback to javi.agenjo@gmail.com
