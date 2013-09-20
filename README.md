litegl.js
=========

Litegl.js is a library that wraps WebGL to make it more user-friendly by creating classes for managing different items like Buffer, Mesh, Texture, Shader and other common aspects of any WebGL applications.
It is a fork from [LightGL.js](https://github.com/evanw/lightgl.js/) by [Evan Wallace](http://madebyevan.com), but some major changes have been made.
Some of the main differences:

 * Matrices have been replaced by glMatrix
 * Meshes are forced to be stored in ArrayBuffer formats
 * Meshes support range rendering with offset</li>
 * Removed fixed pipeline behaviour
 * Better event handling (mouse position, mouse wheel, dragging)
 * Textures expanded to support Arraybuffers and Cubemaps

Demos
-----
Demos are included in the Examples folder but you can check them in [this website](http://tamats.com/webglstudio/litegl/#examples).

Usage
-----

Include the library and dependencies
```html
<script src="js/gl-matrix-min.js"></script>
<script src="js/dds.js"></script>
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

Hook events
```js
gl.ondraw = function() { ... }
gl.onupdate = function(dt) { ... }
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
var shader = new Shader( vertex_shader_code, fragment_shader_code);
```

Create Mesh
```js
var mesh = Mesh.cube();
```

Render
```js
shader.uniforms( my_uniforms ).draw( mesh );
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
