litegl.js
=========

Litegl.js is a library that wraps WebGL to make it more user-friendly by creating classes for managing different items like Buffer, Mesh, Texture, Shader and other common aspects of any WebGL applications.

It helps simplifying working with WebGL without having to handle all the low-level calls but without losing any freedom.

Some features are:

* Easy context creation
* Classes for: 
	- *Meshes and Buffers*: Fill a buffer easily and upload it to the GPU
	- *Textures*: load, fill, clone, copy (even blur) for TEXTURE_2D and TEXTURE_CUBE_MAP
	- *Shaders*: compile from string, from file, insert preprocessor macros, extracts all the uniform locations 
	- *FrameBufferObjects*: to render to a texture, to multiple textures, to depth texture.
* Some basic primitive shapes (plane, cube, sphere, cylinder, hemisphere).
* OBJ parser and encoder (easy to add new ones)
* Loaders for Images and Meshes from URL (uses a placeholder till its loaded)
* Uses typed-arrays for everything (uses glMatrix for all operations)
* No garbage generated (reuses containers)
* Basic Raytracing (for ray-sphere, ray-aabb, ray-plane, and ray-mesh)
* Events system 
* Cross-browser input handling for mouse, keyboard and gamepad
* Supports multiple WebGL contexts
* Supports WebGL1 and WebGL2
* Octree class that support ray-test, sphere-test and find nearest point to mesh

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

For a list of similar libraries check [this list](https://qiita.com/cx20/items/0fa19c96aa6470d98807)

If you need something more high-level like ThreeJS check [Rendeer.js](https://github.com/jagenjo/rendeer.js), my own SceneGraph + Renderer library that supports GLTF, Skeletal Animation and PBR rendering.

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

For better understanding of all the features and how to use them check the [guides](guides) folder.

Documentation
-------------
The doc folder contains the documentation. For info about [glmatrix.net](http://glmatrix.net/) check the documentation in its website.

Check the [guides](guides) folder to see how to use all the features.

Utils
-----

It includes several commands in the utils folder to generate doc, check errors and build minifyed version.


Feedback
--------

You can write any feedback to javi.agenjo@gmail.com
