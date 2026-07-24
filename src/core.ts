// The heart of litegl.js: GL.create() builds a WebGL context and augments it with dozens of extra
// members (input handling, asset caches, viewport helpers, main loop, ...). Ported from core.js.
//
// Pure ESM: functions/state are exported with their ORIGINAL names; a later index.ts re-attaches them
// to the GL namespace and window. Module-level mutable state that used to live on the GL object
// (last_context_id, reverse, dragging, last_pos, mobile) is exported as `let` so index.ts can expose
// it via getters.

import { Texture } from "./texture";
import { Shader } from "./shader";
import { Mesh } from "./mesh";
import { LEvent } from "./levent";
import { createCanvas, getTime } from "./utils";
import {
  LEFT_MOUSE_BUTTON,
  MIDDLE_MOUSE_BUTTON,
  RIGHT_MOUSE_BUTTON,
  LEFT_MOUSE_BUTTON_MASK,
  MIDDLE_MOUSE_BUTTON_MASK,
  RIGHT_MOUSE_BUTTON_MASK,
  blockable_keys,
  HALF_FLOAT_OES,
  FLOAT,
  UNSIGNED_BYTE,
} from "./constants";
import type { CreateContextOptions, GLContext, LiteGLMouse } from "./types";

// ---------------------------------------------------------------------------
// Module-level mutable state (was stored on the GL object via `this`)
// ---------------------------------------------------------------------------

/** Incremented for each context created, used as gl.context_id. */
export let last_context_id = 0;

/** Reverse map from a WebGL enum value to its name (built lazily on first create). */
export let reverse: Record<number, string> | null = null;

/** Whether the mouse is currently being dragged (updated by augmentEvent). */
export let dragging = false;

/** Last mouse position (in client coords), used to compute deltas in augmentEvent. */
export let last_pos: [number, number] = [0, 0];

/** Cached result of the mobile-device sniff (undefined until isMobile() runs once). */
export let mobile: boolean | undefined = undefined;

// ---------------------------------------------------------------------------
// Local helper types
// ---------------------------------------------------------------------------

/** Navigator with the legacy, vendor-prefixed getGamepads variants. */
interface GetGamepadsNavigator extends Navigator {
  webkitGetGamepads?: () => (Gamepad | null)[];
  mozGetGamepads?: () => (Gamepad | null)[];
}

/** Xbox-style remapping bolted onto a gamepad by addGamepadXBOXmapping. */
interface XboxMapping {
  axes: Record<string, number>;
  buttons: Record<string, boolean>;
  hat: string;
}

/** A gamepad with the extra fields litegl attaches. */
interface MappedGamepad extends Gamepad {
  prev_buttons?: Uint8Array;
  xbox?: XboxMapping;
}

/** A gamepad button with the extra `was_pressed` flag litegl attaches. */
interface MappedButton extends GamepadButton {
  was_pressed?: boolean;
}

/** A CustomEvent carrying the gamepad payload litegl dispatches. */
interface GamepadCustomEvent extends CustomEvent {
  gamepad?: Gamepad;
  which?: number;
  button?: GamepadButton;
}

/** The subset of the (optional) Hammer.js pinch event litegl reads. */
interface HammerPinchEvent {
  srcEvent: MouseEvent;
  additionalEvent?: string;
  distance: number;
}

/** The subset of the (optional) Hammer.js API litegl uses. */
interface HammerManagerInstance {
  add(recognizer: unknown): void;
  on(event: string, handler: (event: HammerPinchEvent) => void): void;
}
interface HammerStatic {
  Manager: new (element: HTMLElement) => HammerManagerInstance;
  Pinch: new (options: { threshold: number }) => unknown;
}

/** An <img> decorated with the source url so onload can cache it. */
interface LoadingImage extends HTMLImageElement {
  url?: string;
}

// ---------------------------------------------------------------------------
// GL.create
// ---------------------------------------------------------------------------

/**
 * The global scope that contains all the classes from LiteGL and also all the enums of WebGL so you
 * dont need to create a context to use the values.
 * @class GL
 */

/**
 * creates a new WebGL context (it can create the canvas or use an existing one)
 * @method create
 * @param {Object} options supported are:
 * - width
 * - height
 * - canvas
 * - container (string or element)
 * @return {WebGLRenderingContext} webgl context with all the extra functions (check gl in the doc for more info)
 */
export function create(options?: CreateContextOptions): GLContext {
  const opts: CreateContextOptions = options || {};
  let canvas: HTMLCanvasElement | null = null;
  if (opts.canvas) {
    if (typeof opts.canvas === "string") {
      canvas = document.getElementById(opts.canvas) as HTMLCanvasElement | null;
      if (!canvas) throw "Canvas element not found: " + opts.canvas;
    } else {
      canvas = opts.canvas;
    }
  } else {
    let root: Element | null = null;
    if (opts.container)
      root =
        opts.container.constructor === String
          ? document.querySelector(opts.container as string)
          : (opts.container as HTMLElement);
    if (root && !opts.width) {
      const rect = root.getBoundingClientRect();
      opts.width = rect.width;
      opts.height = rect.height;
    }

    canvas = createCanvas(opts.width || 800, opts.height || 600);
    if (root) root.appendChild(canvas);
  }

  if (!("alpha" in opts)) opts.alpha = false;

  /**
   * the webgl context returned by GL.create, its a WebGLRenderingContext with some extra methods added
   * @class gl
   */
  let rawgl: WebGLRenderingContext | WebGL2RenderingContext | null = null;

  let seq: string[] | null = null;
  if (opts.version === 2) seq = ["webgl2", "experimental-webgl2"];
  else if (opts.version === 1 || opts.version === undefined) seq = ["webgl", "experimental-webgl"];
  else if (opts.version === 0) seq = ["webgl2", "experimental-webgl2", "webgl", "experimental-webgl"];

  if (!seq) throw "Incorrect WebGL version, must be 1 or 2";

  const context_options: WebGLContextAttributes = {
    alpha: opts.alpha === undefined ? true : opts.alpha,
    depth: opts.depth === undefined ? true : opts.depth,
    stencil: opts.stencil === undefined ? true : opts.stencil,
    antialias: opts.antialias === undefined ? true : opts.antialias,
    premultipliedAlpha: opts.premultipliedAlpha === undefined ? true : opts.premultipliedAlpha,
    preserveDrawingBuffer: opts.preserveDrawingBuffer === undefined ? true : opts.preserveDrawingBuffer,
  };

  for (let i = 0; i < seq.length; ++i) {
    try {
      rawgl = canvas.getContext(seq[i], context_options) as
        | WebGLRenderingContext
        | WebGL2RenderingContext
        | null;
    } catch (e) {
      /* ignore */
    }
    if (rawgl) break;
  }

  if (!rawgl) {
    if (canvas.getContext("webgl")) throw "WebGL supported but not with those parameters";
    throw "WebGL not supported";
  }

  const gl = rawgl as GLContext;

  //context globals
  gl.webgl_version = gl.constructor.name === "WebGL2RenderingContext" ? 2 : 1;
  globalThis.gl = gl;
  canvas.is_webgl = true;
  canvas.gl = gl;
  gl.context_id = last_context_id++;

  //get some common extensions for webgl 1
  gl.extensions = {};

  const available_extensions = gl.getSupportedExtensions() || [];
  for (let i = 0; i < available_extensions.length; ++i)
    gl.extensions[available_extensions[i]] = gl.getExtension(available_extensions[i]);

  if (gl.webgl_version === 1)
    gl.HIGH_PRECISION_FORMAT = gl.extensions["OES_texture_half_float"]
      ? HALF_FLOAT_OES
      : gl.extensions["OES_texture_float"]
      ? FLOAT
      : UNSIGNED_BYTE; //because Firefox dont support half float
  else gl.HIGH_PRECISION_FORMAT = HALF_FLOAT_OES;

  gl.max_texture_units = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);

  //viewport hack to retrieve it without using getParameter (which is slow and generates garbage)
  if (!gl._viewport_func) {
    gl._viewport_func = gl.viewport;
    gl.viewport_data = new Float32Array([0, 0, gl.canvas.width, gl.canvas.height]); //32000 max viewport, I guess its fine
    gl.viewport = function (this: GLContext, a: number, b: number, c: number, d: number): void {
      const v = this.viewport_data;
      v[0] = a | 0;
      v[1] = b | 0;
      v[2] = c | 0;
      v[3] = d | 0;
      this._viewport_func(a, b, c, d);
    };
    gl.getViewport = function (v?: Float32Array): Float32Array {
      if (v) {
        v[0] = gl.viewport_data[0];
        v[1] = gl.viewport_data[1];
        v[2] = gl.viewport_data[2];
        v[3] = gl.viewport_data[3];
        return v;
      }
      return new Float32Array(gl.viewport_data);
    };
    gl.setViewport = function (this: GLContext, v: NumberArray, flip_y?: boolean): void {
      gl.viewport_data.set(v);
      if (flip_y) gl.viewport_data[1] = this.drawingBufferHeight - v[1] - v[3];
      this._viewport_func(v[0], gl.viewport_data[1], v[2], v[3]);
    };
  } else console.warn("Creating LiteGL context over the same canvas twice");

  //reverse names helper (assuming no names repeated)
  if (!reverse) {
    const r: Record<number, string> = {};
    const glRecord = gl as unknown as Record<string, unknown>;
    for (const i in glRecord) {
      const val = glRecord[i];
      if (val && (val as { constructor: unknown }).constructor === Number) r[val as number] = i;
    }
    reverse = r;
  }

  //just some checks
  if (window.glMatrix == undefined)
    throw "glMatrix not found, LiteGL requires glMatrix to be included";

  let last_click_time = 0;

  //some global containers, use them to reuse assets
  gl.shaders = {};
  gl.textures = {};
  gl.meshes = {};

  gl.draw_calls = 0;

  /**
   * sets this context as the current global gl context (in case you have more than one)
   * @method makeCurrent
   */
  gl.makeCurrent = function (this: GLContext): void {
    globalThis.gl = this;
  };

  /**
   * executes callback inside this webgl context
   * @method execute
   * @param {Function} callback
   */
  gl.execute = function (this: GLContext, callback: () => void): void {
    const old_gl = globalThis.gl;
    globalThis.gl = this;
    callback();
    globalThis.gl = old_gl;
  };

  /**
   * Launch animation loop (calls gl.onupdate and gl.ondraw every frame)
   * example: gl.ondraw = function(){ ... }   or  gl.onupdate = function(dt) { ... }
   * @method animate
   */
  gl.animate = function (this: GLContext, v?: boolean): void {
    if (v === false) {
      globalThis.cancelAnimationFrame(this._requestFrame_id as number);
      this._requestFrame_id = null;
      return;
    }

    const post = globalThis.requestAnimationFrame;
    let time = getTime();
    const context = this;
    let last_mouse_buttons = 0;

    //loop only if browser tab visible
    function loop(): void {
      if (gl.destroyed) return; //to stop rendering once it is destroyed

      context._requestFrame_id = post(loop); //do it first, in case it crashes

      const now = getTime();
      const dt = (now - time) * 0.001;
      if (context.mouse) context.mouse.last_buttons = last_mouse_buttons;
      last_mouse_buttons = context.mouse.buttons;
      if (context.onupdate) context.onupdate(dt);
      LEvent.trigger(context, "update", dt);
      if (context.ondraw) {
        //make sure the ondraw is called using this gl context (in case there is more than one)
        const old_gl = globalThis.gl;
        globalThis.gl = context;
        //call ondraw
        context.ondraw();
        LEvent.trigger(context, "draw");
        //restore old context
        globalThis.gl = old_gl;
      }
      time = now;
    }
    this._requestFrame_id = post(loop); //launch main loop
  };

  /**
   * Destroy this WebGL context (removes also the Canvas from the DOM)
   * @method destroy
   */
  gl.destroy = function (this: GLContext): void {
    //unbind global events
    if (onkey_handler) {
      document.removeEventListener("keydown", onkey_handler);
      document.removeEventListener("keyup", onkey_handler);
    }

    const cv = this.canvas as HTMLCanvasElement;
    if (onmouse_handler) {
      cv.removeEventListener("mousedown", onmouse_handler);
      cv.removeEventListener("mousemove", onmouse_handler);
      cv.removeEventListener("mouseup", onmouse_handler);
      cv.addEventListener("drag", onmouse_handler);
      cv.addEventListener("dragstart", onmouse_handler);
      cv.addEventListener("wheel", onmouse_handler);
    }

    //clear all containers
    const shaders = this.shaders as Record<string, Shader | null>;
    for (const i in shaders) {
      shaders[i]!.delete();
      shaders[i] = null;
    }
    this.shaders = {};
    const meshes = this.meshes as Record<string, Mesh | null>;
    for (const i in meshes) {
      meshes[i]!.deleteBuffers();
      meshes[i] = null;
    }
    this.meshes = {};
    const textures = this.textures as Record<string, Texture | null>;
    for (const i in textures) {
      textures[i]!.delete();
      textures[i] = null;
    }
    this.textures = {};

    if (cv.parentNode) cv.parentNode.removeChild(cv);
    this.destroyed = true;
    if (globalThis.gl === this) globalThis.gl = null as unknown as GLContext;
  };

  const mouse: LiteGLMouse = {
    buttons: 0, //this should always be up-to-date with mouse state
    last_buttons: 0, //button state in the previous frame
    left_button: false,
    middle_button: false,
    right_button: false,
    position: new Float32Array(2),
    x: 0, //in canvas coordinates
    y: 0,
    deltax: 0,
    deltay: 0,
    clientx: 0, //in client coordinates
    clienty: 0,
    isInsideRect: function (x: number, y: number, w: number, h: number, flip_y?: boolean): boolean {
      let mouse_y = this.y;
      if (flip_y) mouse_y = gl.canvas.height - mouse_y;
      if (this.x > x && this.x < x + w && mouse_y > y && mouse_y < y + h) return true;
      return false;
    },

    /**
     * returns true if button num is pressed (where num could be GL.LEFT_MOUSE_BUTTON, GL.RIGHT_MOUSE_BUTTON, GL.MIDDLE_MOUSE_BUTTON
     * @method captureMouse
     * @param {boolean} capture_wheel capture also the mouse wheel
     */
    isButtonPressed: function (num: number): number | undefined {
      if (num === LEFT_MOUSE_BUTTON) return this.buttons & LEFT_MOUSE_BUTTON_MASK;
      if (num === MIDDLE_MOUSE_BUTTON) return this.buttons & MIDDLE_MOUSE_BUTTON_MASK;
      if (num === RIGHT_MOUSE_BUTTON) return this.buttons & RIGHT_MOUSE_BUTTON_MASK;
      return undefined;
    },

    wasButtonPressed: function (num: number): number | boolean | undefined {
      let mask = 0;
      if (num === LEFT_MOUSE_BUTTON) mask = LEFT_MOUSE_BUTTON_MASK;
      else if (num === MIDDLE_MOUSE_BUTTON) mask = MIDDLE_MOUSE_BUTTON_MASK;
      else if (num === RIGHT_MOUSE_BUTTON) mask = RIGHT_MOUSE_BUTTON_MASK;
      return this.buttons & mask && !(this.last_buttons & mask);
    },
  };
  gl.mouse = mouse;

  /**
   * Tells the system to capture mouse events on the canvas.
   * This will trigger onmousedown, onmousemove, onmouseup, onmousewheel callbacks assigned in the gl context
   * example: gl.onmousedown = function(e){ ... }
   * The event is a regular MouseEvent with some extra parameters
   * @method captureMouse
   * @param {boolean} capture_wheel capture also the mouse wheel
   */
  gl.captureMouse = function (this: GLContext, capture_wheel?: boolean, translate_touchs?: boolean): void {
    canvas!.addEventListener("mousedown", onmouse);
    canvas!.addEventListener("mousemove", onmouse);
    canvas!.addEventListener("drag", onmouse);
    canvas!.addEventListener("dragstart", onmouse);
    if (capture_wheel) {
      canvas!.addEventListener("mousewheel", onmouse as unknown as EventListener, false);
      canvas!.addEventListener("wheel", onmouse, false);
      //canvas.addEventListener("DOMMouseScroll", onmouse, false); //deprecated or non-standard
    }
    //prevent right click context menu
    canvas!.addEventListener("contextmenu", function (e: Event) {
      e.preventDefault();
      return false;
    });

    if (translate_touchs) this.captureTouch(true);
  };

  function onmouse(e: MouseEvent): boolean | void {
    if (gl.ignore_events) return;
    //console.log(e.type); //debug
    const old_mouse_mask = gl.mouse.buttons;
    augmentEvent(e, canvas!);
    e.eventType = e.eventType || e.type; //type cannot be overwritten, so I make a clone to allow me to overwrite
    const now = getTime();

    //gl.mouse info
    mouse.dragging = e.dragging;
    mouse.position[0] = e.canvasx;
    mouse.position[1] = e.canvasy;
    mouse.x = e.canvasx;
    mouse.y = e.canvasy;
    mouse.mousex = e.mousex;
    mouse.mousey = e.mousey;
    mouse.canvasx = e.canvasx;
    mouse.canvasy = e.canvasy;
    mouse.clientx = e.mousex;
    mouse.clienty = e.mousey;
    mouse.buttons = e.buttons;
    mouse.left_button = !!(mouse.buttons & LEFT_MOUSE_BUTTON_MASK);
    mouse.middle_button = !!(mouse.buttons & MIDDLE_MOUSE_BUTTON_MASK);
    mouse.right_button = !!(mouse.buttons & RIGHT_MOUSE_BUTTON_MASK);

    if (e.eventType === "mousedown") {
      if (old_mouse_mask === 0) {
        //no mouse button was pressed till now
        canvas!.removeEventListener("mousemove", onmouse);
        const doc = canvas!.ownerDocument;
        doc.addEventListener("mousemove", onmouse);
        doc.addEventListener("mouseup", onmouse);
      }
      last_click_time = now;

      if (gl.onmousedown) gl.onmousedown(e);
      LEvent.trigger(gl, "mousedown");
    } else if (e.eventType === "mousemove") {
      if (gl.onmousemove) gl.onmousemove(e);
      LEvent.trigger(gl, "mousemove", e);
    } else if (e.eventType === "mouseup") {
      if (gl.mouse.buttons === 0) {
        //no more buttons pressed
        canvas!.addEventListener("mousemove", onmouse);
        const doc = canvas!.ownerDocument;
        doc.removeEventListener("mousemove", onmouse);
        doc.removeEventListener("mouseup", onmouse);
      }
      e.click_time = now - last_click_time;
      //last_click_time = now; //commented to avoid reseting click time when unclicking two mouse buttons

      if (gl.onmouseup) gl.onmouseup(e);
      LEvent.trigger(gl, "mouseup", e);
    } else if (e.eventType === "mousewheel" || e.eventType === "wheel" || e.eventType === "DOMMouseScroll") {
      e.eventType = "mousewheel";
      if (e.type === "wheel")
        e.wheel = -(e as WheelEvent).deltaY; //in firefox deltaY is 1 while in Chrome is 120
      else e.wheel = e.wheelDeltaY != null ? e.wheelDeltaY : e.detail * -60;

      //from stack overflow
      //firefox doesnt have wheelDelta
      e.delta =
        e.wheelDelta !== undefined
          ? e.wheelDelta / 40
          : (e as WheelEvent).deltaY
          ? -(e as WheelEvent).deltaY / 3
          : 0;
      //console.log(e.delta);
      if (gl.onmousewheel) gl.onmousewheel(e);

      LEvent.trigger(gl, "mousewheel", e);
    } else if (e.eventType === "dragstart") {
      if (gl.ondragstart) gl.ondragstart(e);
      LEvent.trigger(gl, "dragstart", e);
    }

    if (gl.onmouse) gl.onmouse(e);

    if (!e.skip_preventDefault) {
      if (e.eventType !== "mousemove") e.stopPropagation();
      e.preventDefault();
      return false;
    }
  }
  const onmouse_handler = onmouse;

  let translate_touches = false;

  //if Hammer lib available, use it for pinch
  if (typeof Hammer !== "undefined") {
    const H = Hammer as HammerStatic;
    const mc = new H.Manager(canvas!);
    const pinch = new H.Pinch({ threshold: 0.3 });
    if (mc && pinch) {
      mc.add(pinch);
      mc.on("pinch", pinchZoom);
    }
  }

  function pinchZoom(event: HammerPinchEvent): void {
    const originalEvent = event.srcEvent;
    const type = "wheel";
    const simulatedEvent = document.createEvent("MouseEvent") as MouseEvent & { deltaY: number };
    simulatedEvent.initMouseEvent(
      type,
      true,
      true,
      window,
      1,
      originalEvent.screenX,
      originalEvent.screenY,
      originalEvent.clientX,
      originalEvent.clientY,
      false,
      false,
      false,
      false,
      0 /*left*/,
      null
    );
    simulatedEvent.originalEvent = simulatedEvent;
    simulatedEvent.is_touch = true;
    let processPinch = false;
    if (event.additionalEvent === "pinchin") {
      simulatedEvent.deltaY = 1;
      processPinch = true;
    } else if (event.additionalEvent === "pinchout") {
      simulatedEvent.deltaY = -1;
      processPinch = true;
    }
    if (processPinch) {
      simulatedEvent.pinchScaling = event.distance * 0.0312;
      originalEvent.target!.dispatchEvent(simulatedEvent);
    }

    //if we block this touch (to avoid weird canvas draggings) then we are blocking the gestures
    originalEvent.preventDefault();
  }

  gl.captureTouch = function (translate_to_mouse_events?: boolean): void {
    translate_touches = !!translate_to_mouse_events;

    canvas!.addEventListener("touchstart", ontouch, true);
    canvas!.addEventListener("touchmove", ontouch, true);
    canvas!.addEventListener("touchend", ontouch, true);
    canvas!.addEventListener("touchcancel", ontouch, true);

    canvas!.addEventListener("gesturestart", ongesture);
    canvas!.addEventListener("gesturechange", ongesture);
    canvas!.addEventListener("gestureend", ongesture);
  };

  //translates touch events in mouseevents
  function ontouch(e: TouchEvent): void {
    const touches = e.changedTouches,
      first = touches[0];
    let type = "";

    if (gl.ontouch && gl.ontouch(e) === true) return;

    if (LEvent.trigger(gl, e.type, e) === true) return;

    if (!translate_touches) return;

    //ignore secondary touches
    if (e.touches.length && e.changedTouches[0].identifier !== e.touches[0].identifier) return;

    if ((touches as unknown as number) > 1) return;

    switch (e.type) {
      case "touchstart":
        type = "mousedown";
        break;
      case "touchmove":
        type = "mousemove";
        break;
      case "touchend":
        type = "mouseup";
        break;
      default:
        return;
    }

    const simulatedEvent = document.createEvent("MouseEvent") as MouseEvent;
    simulatedEvent.initMouseEvent(
      type,
      true,
      true,
      window,
      1,
      first.screenX,
      first.screenY,
      first.clientX,
      first.clientY,
      false,
      false,
      false,
      false,
      0 /*left*/,
      null
    );
    simulatedEvent.originalEvent = simulatedEvent;
    simulatedEvent.is_touch = true;
    first.target.dispatchEvent(simulatedEvent);

    //if we block this touch (to avoid weird canvas draggings) then we are blocking the gestures
    e.preventDefault();
  }

  function ongesture(e: Event): void {
    e.eventType = e.type;

    if (gl.ongesture && gl.ongesture(e) === false) return;

    if (LEvent.trigger(gl, e.type, e) === false) return;

    e.preventDefault();
  }

  gl.keys = {};

  /**
   * Tells the system to capture key events on the canvas. This will trigger onkey
   * @method captureKeys
   * @param {boolean} prevent_default prevent default behaviour (like scroll on the web, etc)
   * @param {boolean} only_canvas only caches keyboard events if they happen when the canvas is in focus
   */
  let onkey_handler: ((e: KeyboardEvent) => void) | null = null;
  gl.captureKeys = function (prevent_default?: boolean, only_canvas?: boolean): void {
    if (onkey_handler) return;
    gl.keys = {};

    const target = only_canvas ? gl.canvas : document;
    void target;

    document.addEventListener("keydown", inner);
    document.addEventListener("keyup", inner);
    function inner(e: KeyboardEvent): void {
      onkey(e, prevent_default);
    }
    onkey_handler = inner;
  };

  function onkey(e: KeyboardEvent, prevent_default?: boolean): void {
    e.eventType = e.type; //type cannot be overwritten, so I make a clone to allow me to overwrite

    const target = e.target as HTMLElement;
    const target_element = target.nodeName.toLowerCase();
    if (
      target_element === "input" ||
      target_element === "textarea" ||
      target_element === "select" ||
      target.contentEditable === "true"
    )
      return;

    e.character = String.fromCharCode(e.keyCode).toLowerCase();
    let prev_state = false;
    let key = mapKeyCode(e.keyCode);
    if (!key) key = e.character; //this key doesnt look like an special key

    const modified_key = e.altKey || e.ctrlKey || e.metaKey;

    //regular key
    if (!modified_key) {
      if (key) gl.keys[key] = e.type === "keydown";
      prev_state = gl.keys[e.keyCode];
      gl.keys[e.keyCode] = e.type === "keydown";
    }

    //avoid repetition if key stays pressed
    if (prev_state !== gl.keys[e.keyCode] || modified_key) {
      if (e.type === "keydown" && gl.onkeydown) gl.onkeydown(e);
      else if (e.type === "keyup" && gl.onkeyup) gl.onkeyup(e);
      LEvent.trigger(gl, e.type, e);
    }

    if (gl.onkey) gl.onkey(e);

    if (prevent_default && (e.isChar || blockable_keys[e.keyIdentifier || e.key])) e.preventDefault();
  }

  //gamepads
  gl.gamepads = null;

  /**
   * Tells the system to capture gamepad events on the canvas.
   * @method captureGamepads
   */
  gl.captureGamepads = function (this: GLContext): void {
    const nav = navigator as GetGamepadsNavigator;
    const getGamepads = nav.getGamepads || nav.webkitGetGamepads || nav.mozGetGamepads;
    if (!getGamepads) return;
    this.gamepads = getGamepads.call(navigator);
  };

  /**
   * returns the detected gamepads on the system
   * @method getGamepads
   * @param {bool} skip_mapping if set to true it returns the basic gamepad, otherwise it returns a class with mapping info to XBOX controller
   */
  gl.getGamepads = function (this: GLContext, skip_mapping?: boolean): (Gamepad | null)[] | undefined {
    //gamepads
    const nav = navigator as GetGamepadsNavigator;
    const getGamepads = nav.getGamepads || nav.webkitGetGamepads || nav.mozGetGamepads;
    if (!getGamepads) return;
    const gamepads = getGamepads.call(navigator);
    if (!this.gamepads) this.gamepads = [];

    //iterate to generate events
    for (let i = 0; i < 4; i++) {
      const gamepad = gamepads[i] as MappedGamepad | null; //current state

      if (gamepad && !skip_mapping) addGamepadXBOXmapping(gamepad);

      //launch connected gamepads events
      if (gamepad && !gamepad.prev_buttons) {
        gamepad.prev_buttons = new Uint8Array(32);
        const event = new CustomEvent("gamepadconnected") as GamepadCustomEvent;
        event.eventType = event.type;
        event.gamepad = gamepad;
        if (this.ongamepadconnected) this.ongamepadconnected(event);
        LEvent.trigger(gl, "gamepadconnected", event);
      }

      //seek buttons changes to trigger events
      if (gamepad) {
        const prev = gamepad.prev_buttons!;
        for (let j = 0; j < gamepad.buttons.length; ++j) {
          const button = gamepad.buttons[j] as MappedButton;
          button.was_pressed = false;
          if (button.pressed && !prev[j]) {
            button.was_pressed = true;
            const event = new CustomEvent("gamepadButtonDown") as GamepadCustomEvent;
            event.eventType = event.type;
            event.button = button;
            event.which = j;
            event.gamepad = gamepad;
            if (gl.onbuttondown) gl.onbuttondown(event);
            LEvent.trigger(gl, "buttondown", event);
          } else if (!button.pressed && prev[j]) {
            const event = new CustomEvent("gamepadButtonUp") as GamepadCustomEvent;
            event.eventType = event.type;
            event.button = button;
            event.which = j;
            event.gamepad = gamepad;
            if (gl.onbuttondown) gl.onbuttondown(event);
            LEvent.trigger(gl, "buttonup", event);
          }

          prev[j] = button.pressed ? 1 : 0;
        }
      }
    }
    this.gamepads = gamepads;
    return gamepads;
  };

  function addGamepadXBOXmapping(gamepad: MappedGamepad): void {
    //xbox controller mapping
    const xbox: XboxMapping = gamepad.xbox || {
      axes: [] as unknown as Record<string, number>,
      buttons: {},
      hat: "",
    };
    xbox.axes["lx"] = gamepad.axes[0];
    xbox.axes["ly"] = gamepad.axes[1];
    xbox.axes["rx"] = gamepad.axes[2];
    xbox.axes["ry"] = gamepad.axes[3];
    xbox.axes["triggers"] = gamepad.axes[4];

    for (let i = 0; i < gamepad.buttons.length; i++) {
      switch (
        i //I use a switch to ensure that a player with another gamepad could play
      ) {
        case 0:
          xbox.buttons["a"] = gamepad.buttons[i].pressed;
          break;
        case 1:
          xbox.buttons["b"] = gamepad.buttons[i].pressed;
          break;
        case 2:
          xbox.buttons["x"] = gamepad.buttons[i].pressed;
          break;
        case 3:
          xbox.buttons["y"] = gamepad.buttons[i].pressed;
          break;
        case 4:
          xbox.buttons["lb"] = gamepad.buttons[i].pressed;
          break;
        case 5:
          xbox.buttons["rb"] = gamepad.buttons[i].pressed;
          break;
        case 6:
          xbox.buttons["lt"] = gamepad.buttons[i].pressed;
          break;
        case 7:
          xbox.buttons["rt"] = gamepad.buttons[i].pressed;
          break;
        case 8:
          xbox.buttons["back"] = gamepad.buttons[i].pressed;
          break;
        case 9:
          xbox.buttons["start"] = gamepad.buttons[i].pressed;
          break;
        case 10:
          xbox.buttons["ls"] = gamepad.buttons[i].pressed;
          break;
        case 11:
          xbox.buttons["rs"] = gamepad.buttons[i].pressed;
          break;
        case 12:
          if (gamepad.buttons[i].pressed) xbox.hat += "up";
          break;
        case 13:
          if (gamepad.buttons[i].pressed) xbox.hat += "down";
          break;
        case 14:
          if (gamepad.buttons[i].pressed) xbox.hat += "left";
          break;
        case 15:
          if (gamepad.buttons[i].pressed) xbox.hat += "right";
          break;
        case 16:
          xbox.buttons["home"] = gamepad.buttons[i].pressed;
          break;
        default:
      }
    }
    gamepad.xbox = xbox;
  }

  /**
   * launches de canvas in fullscreen mode
   * @method fullscreen
   */
  gl.fullscreen = function (this: GLContext): void {
    const canvas = this.canvas as HTMLCanvasElement & {
      requestFullScreen?: () => void;
      webkitRequestFullScreen?: () => void;
      mozRequestFullScreen?: () => void;
    };
    if (canvas.requestFullScreen) canvas.requestFullScreen();
    else if (canvas.webkitRequestFullScreen) canvas.webkitRequestFullScreen();
    else if (canvas.mozRequestFullScreen) canvas.mozRequestFullScreen();
    else console.error("Fullscreen not supported");
  };

  /**
   * returns a canvas with a snapshot of an area
   * this is safer than using the canvas itself due to internals of webgl
   * @method snapshot
   * @param {Number} startx viewport x coordinate
   * @param {Number} starty viewport y coordinate from bottom
   * @param {Number} areax viewport area width
   * @param {Number} areay viewport area height
   * @return {Canvas} canvas
   */
  gl.snapshot = function (
    startx: number,
    starty: number,
    areax: number,
    areay: number,
    skip_reverse?: boolean
  ): HTMLCanvasElement {
    const canvas = createCanvas(areax, areay);
    const ctx = canvas.getContext("2d")!;
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const buffer = new Uint8Array(areax * areay * 4);
    gl.readPixels(startx, starty, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, buffer);

    pixels.data.set(buffer);
    ctx.putImageData(pixels, 0, 0);

    if (skip_reverse) return canvas;

    //flip image
    const final_canvas = createCanvas(areax, areay);
    const ctx2 = final_canvas.getContext("2d")!;
    ctx2.translate(0, areay);
    ctx2.scale(1, -1);
    ctx2.drawImage(canvas, 0, 0);

    return final_canvas;
  };

  //from https://webgl2fundamentals.org/webgl/lessons/webgl1-to-webgl2.html
  function getAndApplyExtension(glctx: WebGL2RenderingContext, name: string): boolean | void {
    const ext: unknown = glctx.getExtension(name);
    if (!ext) {
      return false;
    }
    const extRecord = ext as Record<string, unknown>;
    const glRecord = glctx as unknown as Record<string, unknown>;
    let suffix = name.split("_")[0];
    const prefix = (suffix = "_");
    const suffixRE = new RegExp(suffix + "$");
    const prefixRE = new RegExp("^" + prefix);
    let unprefixedKey = "";
    for (const key in extRecord) {
      const val = extRecord[key];
      if (typeof val === "function") {
        // remove suffix (eg: bindVertexArrayOES -> bindVertexArray)
        const unsuffixedKey = key.replace(suffixRE, "");
        void unsuffixedKey;
        if ((key as unknown as { substing?: unknown }).substing)
          glRecord[unprefixedKey] = (val as (...args: unknown[]) => unknown).bind(ext);
      } else {
        unprefixedKey = key.replace(prefixRE, "");
        glRecord[unprefixedKey] = extRecord[key];
      }
    }
  }
  void getAndApplyExtension;

  //mini textures manager
  const loading_textures: Record<string, boolean> = {};
  /**
   * returns a texture and caches it inside gl.textures[]
   * @method loadTexture
   * @param {String} url
   * @param {Object} options (same options as when creating a texture)
   * @param {Function} callback function called once the texture is loaded
   * @return {Texture} texture
   */
  gl.loadTexture = function (
    this: GLContext,
    url: string,
    options?: Record<string, unknown>,
    on_load?: (texture: Texture) => void
  ): Texture | null {
    if (this.textures[url]) return this.textures[url];

    if (loading_textures[url]) return null;

    const img = new Image() as LoadingImage;
    img.url = url;
    img.onload = function (): void {
      const texture = Texture.fromImage(img, options as Parameters<typeof Texture.fromImage>[1]);
      texture.img = img;
      gl.textures[img.url!] = texture;
      delete loading_textures[img.url!];
      if (on_load) on_load(texture);
    };
    img.src = url;
    loading_textures[url] = true;
    return null;
  };

  /**
   * draws a texture to the viewport
   * @method drawTexture
   * @param {Texture} texture
   * @param {number} x in viewport coordinates
   * @param {number} y in viewport coordinates
   * @param {number} w in viewport coordinates
   * @param {number} h in viewport coordinates
   * @param {number} tx texture x in texture coordinates
   * @param {number} ty texture y in texture coordinates
   * @param {number} tw texture width in texture coordinates
   * @param {number} th texture height in texture coordinates
   */
  gl.drawTexture = (function () {
    //static variables: less garbage
    const identity = mat3.create();
    const pos = vec2.create();
    const size = vec2.create();
    const area = vec4.create();
    const white = vec4.fromValues(1, 1, 1, 1);
    const viewport = vec2.create();
    const _uniforms = {
      u_texture: 0,
      u_position: pos,
      u_color: white,
      u_size: size,
      u_texture_area: area,
      u_viewport: viewport,
      u_transform: identity,
    };

    return function (
      this: GLContext,
      texture: Texture,
      x: number,
      y: number,
      w?: number,
      h?: number,
      tx?: number,
      ty?: number,
      tw?: number,
      th?: number,
      shader?: Shader,
      uniforms?: Record<string, unknown>
    ): void {
      pos[0] = x;
      pos[1] = y;
      if (w === undefined) w = texture.width;
      if (h === undefined) h = texture.height;
      size[0] = w;
      size[1] = h;

      if (tx === undefined) tx = 0;
      if (ty === undefined) ty = 0;
      if (tw === undefined) tw = texture.width;
      if (th === undefined) th = texture.height;

      area[0] = tx / texture.width;
      area[1] = ty / texture.height;
      area[2] = (tx + tw) / texture.width;
      area[3] = (ty + th) / texture.height;

      viewport[0] = this.viewport_data[2];
      viewport[1] = this.viewport_data[3];

      shader = shader || Shader.getPartialQuadShader(this);
      const mesh = Mesh.getScreenQuad(this);
      texture.bind(0);
      shader.uniforms(_uniforms);
      if (uniforms) shader.uniforms(uniforms as Parameters<typeof shader.uniforms>[0]);
      shader.draw(mesh, gl.TRIANGLES);
    };
  })();

  canvas.addEventListener(
    "webglcontextlost",
    function (e: Event) {
      e.preventDefault();
      gl.context_lost = true;
      if (gl.onlosecontext) gl.onlosecontext(e);
    },
    false
  );

  /**
   * use it to reset the the initial gl state
   * @method gl.reset
   */
  gl.reset = function (this: GLContext): void {
    //viewport
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    //flags
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.frontFace(gl.CCW);

    //texture
    gl._current_texture_drawto = null;
    gl._current_fbo_color = null;
    gl._current_fbo_depth = null;
  };

  gl.dump = function (): void {
    console.log("userAgent: ", navigator.userAgent);
    console.log("Supported extensions:");
    const extensions = gl.getSupportedExtensions() || [];
    console.log(extensions.join(","));
    const info = [
      "VENDOR",
      "VERSION",
      "MAX_VERTEX_ATTRIBS",
      "MAX_VARYING_VECTORS",
      "MAX_VERTEX_UNIFORM_VECTORS",
      "MAX_VERTEX_TEXTURE_IMAGE_UNITS",
      "MAX_FRAGMENT_UNIFORM_VECTORS",
      "MAX_TEXTURE_SIZE",
      "MAX_TEXTURE_IMAGE_UNITS",
    ];
    const glRecord = gl as unknown as Record<string, number>;
    console.log("WebGL info:");
    for (const i in info) console.log(" * " + info[i] + ": " + gl.getParameter(glRecord[info[i]]));
    console.log("*************************************************");
  };

  //Reset state
  gl.reset();

  //Return
  return gl;
}

export function mapKeyCode(code: number): string | null {
  const named: Record<number, string> = {
    8: "BACKSPACE",
    9: "TAB",
    13: "ENTER",
    16: "SHIFT",
    17: "CTRL",
    27: "ESCAPE",
    32: "SPACE",
    33: "PAGEUP",
    34: "PAGEDOWN",
    35: "END",
    36: "HOME",
    37: "LEFT",
    38: "UP",
    39: "RIGHT",
    40: "DOWN",
  };
  return named[code] || (code >= 65 && code <= 90 ? String.fromCharCode(code) : null);
}

//adds extra info to the MouseEvent (coordinates in canvas axis, deltas and button state)
export function augmentEvent(e: MouseEvent, root_element?: HTMLElement): void {
  let offset_left = 0;
  let offset_top = 0;
  void offset_left;
  void offset_top;

  const target: HTMLElement =
    root_element || (e.target as HTMLElement | null) || (globalThis.gl.canvas as HTMLElement);
  const b = target.getBoundingClientRect();

  e.mousex = e.clientX - b.left;
  e.mousey = e.clientY - b.top;
  e.canvasx = e.mousex;
  e.canvasy = b.height - e.mousey;
  e.deltax = 0;
  e.deltay = 0;

  if (e.is_touch) {
    globalThis.gl.mouse.buttons = e.which;
  }

  if (document.pointerLockElement === target) {
    e.canvasx = e.mousex = b.width * 0.5;
    e.canvasy = e.mousey = b.height * 0.5;
  }

  if (e.type === "mousedown") {
    dragging = true;
    //gl.mouse.buttons |= (1 << e.which); //enable
  } else if (e.type === "mousemove") {
    /* no-op */
  } else if (e.type === "mouseup") {
    //gl.mouse.buttons = gl.mouse.buttons & ~(1 << e.which);
    if (e.buttons === 0) dragging = false;
  }

  if (e.movementX !== undefined && !e.is_touch && !isMobile()) {
    //pointer lock (mobile gives always zero)
    //console.log( e.movementX )
    e.deltax = e.movementX;
    e.deltay = e.movementY;
  } else {
    e.deltax = e.mousex - last_pos[0];
    e.deltay = e.mousey - last_pos[1];
  }
  last_pos[0] = e.mousex;
  last_pos[1] = e.mousey;

  //insert info in event
  e.dragging = dragging;
  e.leftButton = !!(globalThis.gl.mouse.buttons & LEFT_MOUSE_BUTTON_MASK);
  e.middleButton = !!(globalThis.gl.mouse.buttons & MIDDLE_MOUSE_BUTTON_MASK);
  e.rightButton = !!(globalThis.gl.mouse.buttons & RIGHT_MOUSE_BUTTON_MASK);
  //shitty non-coherent API, e.buttons use 1:left,2:right,4:middle) but e.button uses (0:left,1:middle,2:right)
  let buttons_mask = 0;
  if (e.leftButton) buttons_mask = 1;
  if (e.middleButton) buttons_mask |= 2;
  if (e.rightButton) buttons_mask |= 4;
  e.buttons_mask = buttons_mask;
  e.isButtonPressed = function (this: MouseEvent, num: number): number {
    return (this.buttons_mask ?? 0) & (1 << num);
  };
}

/**
 * Tells you if the app is running on a mobile device (iOS or Android)
 * @method isMobile
 * @return {boolean} true if is running on a iOS or Android device
 */
export function isMobile(): boolean {
  if (mobile !== undefined) return mobile;

  if (!globalThis.navigator)
    //server side js?
    return (mobile = false);

  if (
    navigator.userAgent.match(/iPhone/i) ||
    navigator.userAgent.match(/iPod/i) ||
    navigator.userAgent.match(/iPad/i) ||
    navigator.userAgent.match(/SamsungBrowser/i) ||
    navigator.userAgent.match(/Mobile\ VR/i) ||
    navigator.userAgent.match(/Android/i)
  ) {
    return (mobile = true);
  }
  return (mobile = false);
}
