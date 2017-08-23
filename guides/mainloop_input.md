# Main Loop and Input

Every interactive application requires of some basic structure to control the input and the rendering loop.

To simplify those aspects LiteGL comes with some basic functions:


## Main loop

Realtime applications require to constantly render a new frame, this render has to be in sync with the browser rendering pace.
To do this browsers have a function called ```requestAnimationFrame```. LiteGL allows to create a simple animation loop by defining the ondraw and onupdate callback and launching the main loop by calling the ```gl.animate()``` method.

```js
		//create the rendering context
		var container = document.body;
		var gl = GL.create({width: container.offsetWidth, height: container.offsetHeight});
		container.appendChild(gl.canvas);
    
    //define the draw callback
    gl.ondraw = function()
    {
      //...
    }
    
    //define the update callback
    gl.onupdate = function( dt )
    {
      //...
    }

    //start the main loop
    gl.animate();
```

This methods (ondraw and onupdate) will be called **only if the tab is active**.

## Getting the Input

You probably want to get the user input (mouse clicks, keyboard press, gamepad buttons, ...).

To simplify that LiteGL provides some easy to use methods:

### Getting the Keyboard


