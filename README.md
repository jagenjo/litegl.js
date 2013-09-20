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

