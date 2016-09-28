# Introduction to LiteGL #

When developing OpenGL applications programmers have to remember lots of functions with complex names that receive several parameters of very specific types.
The nature of this syntax is to make it more powerful and flexible but could lead to very slow advance when developing common 3D applications.

This problem gets even worse in WebGL due to the nature of the Javascript language (soft-typing, garbage collection) and the browser restrictions (safety limitations, async calls).

The aim of LiteGL is to reduce this gap by wrapping most of the common WebGL 1.0 calls inside classes that represent clearer concepts (like Texture, Shader or Mesh).
And adding some very useful extra functions that most 3D application will eventually need (mesh parsing, texture copying, a pool of useful shaders,...).

Also it adds the necessary functions for any browser realtime application (canvas creation, input handling, events system).

Keep in mind that LiteGL wont free you from knowing WebGL, you still will need to do regular WebGL calls to handle the GPU attributes, or to do more specific actions on Textures, Meshes, etc.
But LiteGL should make it much easier to cope with the regular actions.

LiteGL has been using in several projects over the last 4 years with very good results. From weekend GameJam projects to professional applications or open source projects.

It is in a very mature state and almost 100% bug free.

Although I keep polishing it, the library is finished and no bigger changes are expected in the future (while we wait to WebGL 2.0 to be deployed globally).

LiteGL is based in LightGL.js by Evan Wallace, but some major changes were made to achieve better performance and clarity.


## Classes ##

There are three classes that any WebGL developer need to make any basic 3D application: Meshes, Shaders, Textures.

### GL.Mesh ##

The GL.Mesh contains the geometry that must be rendered in an object.
It is just a container for several GL.Buffer which is the class that sends the data to the GPU, but GL.Mesh makes it easier to work with.

### GL.Texture ##


### GL.Shader ##
