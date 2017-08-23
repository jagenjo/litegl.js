# Main Loop and Input

Every interactive application requires of some basic structure to control the input and the rendering loop.

To simplify those aspects LiteGL comes with some basic functions:


## Main loop

Realtime applications require to constantly render a new frame, this render has to be in sync with the browser rendering pace.
To do this browsers have a function called requestAnimationFrame. LiteGL allows to create a simple animation loop using
the ```gl.animate()``` method and the call back onrender.
