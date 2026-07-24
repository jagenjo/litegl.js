// Shared type definitions for litegl.js.
//
// The most important type here is `GLContext`: `GL.create()` returns a native WebGL context that has
// been augmented at runtime with dozens of extra members. This interface describes that augmented
// object so the whole library can be strictly typed against it.

import type { Texture } from "./texture";
import type { Mesh } from "./mesh";
import type { Shader } from "./shader";

/** Options accepted by GL.create(). */
export interface CreateContextOptions {
  canvas?: HTMLCanvasElement | string;
  container?: HTMLElement | string;
  width?: number;
  height?: number;
  /** 1 = webgl1, 2 = webgl2, 0 = latest available, undefined = webgl1 */
  version?: 0 | 1 | 2;
  alpha?: boolean;
  depth?: boolean;
  stencil?: boolean;
  antialias?: boolean;
  premultipliedAlpha?: boolean;
  preserveDrawingBuffer?: boolean;
}

/** Map of loaded WebGL extensions, keyed by extension name. */
export interface GLExtensionsMap {
  [name: string]: unknown;
  OES_standard_derivatives?: OES_standard_derivatives | null;
  OES_element_index_uint?: OES_element_index_uint | null;
  OES_texture_float?: OES_texture_float | null;
  OES_texture_float_linear?: OES_texture_float_linear | null;
  OES_texture_half_float?: OES_texture_half_float | null;
  OES_texture_half_float_linear?: OES_texture_half_float_linear | null;
  OES_vertex_array_object?: OES_vertex_array_object | null;
  EXT_texture_filter_anisotropic?: EXT_texture_filter_anisotropic | null;
  EXT_color_buffer_float?: unknown;
  EXT_sRGB?: EXT_sRGB | null;
  WEBGL_depth_texture?: WEBGL_depth_texture | null;
  WEBGL_draw_buffers?: WEBGL_draw_buffers | null;
  ANGLE_instanced_arrays?: ANGLE_instanced_arrays | null;
}

/** State of the mouse, kept up-to-date on gl.mouse when captureMouse() is active. */
export interface LiteGLMouse {
  buttons: number;
  last_buttons: number;
  left_button: boolean;
  middle_button: boolean;
  right_button: boolean;
  position: Float32Array;
  x: number;
  y: number;
  deltax: number;
  deltay: number;
  clientx: number;
  clienty: number;
  dragging?: boolean;
  mousex?: number;
  mousey?: number;
  canvasx?: number;
  canvasy?: number;
  isInsideRect(x: number, y: number, w: number, h: number, flip_y?: boolean): boolean;
  isButtonPressed(num: number): number | undefined;
  wasButtonPressed(num: number): number | boolean | undefined;
}

/** A pointer/mouse event handler as used by the gl.onmouse* hooks. */
export type GLEventHandler = (event: MouseEvent) => void | boolean;
export type GLKeyEventHandler = (event: KeyboardEvent) => void;

/**
 * A WebGL rendering context augmented by GL.create() with the extra properties and methods litegl
 * relies on. It structurally extends WebGL2RenderingContext (a WebGL1 context is cast to it and
 * gated on `webgl_version`).
 */
export interface GLContext extends WebGL2RenderingContext {
  // --- info / capabilities ---
  webgl_version: number;
  context_id: number;
  extensions: GLExtensionsMap;
  derivatives_supported?: boolean;
  HIGH_PRECISION_FORMAT: number;
  max_texture_units: number;

  // --- asset caches ---
  shaders: Record<string, Shader>;
  textures: Record<string, Texture>;
  meshes: Record<string, Mesh>;
  draw_calls: number;

  // --- viewport helpers ---
  _viewport_func: (x: number, y: number, width: number, height: number) => void;
  viewport_data: Float32Array;
  getViewport(v?: Float32Array): Float32Array;
  setViewport(v: NumberArray, flip_y?: boolean): void;

  // --- lifecycle / main loop ---
  makeCurrent(): void;
  execute(callback: () => void): void;
  animate(v?: boolean): void;
  destroy(): void;
  reset(): void;
  dump(): void;
  destroyed?: boolean;
  context_lost?: boolean;
  _requestFrame_id?: number | null;

  // --- input: mouse / touch ---
  mouse: LiteGLMouse;
  captureMouse(capture_wheel?: boolean, translate_touchs?: boolean): void;
  captureTouch(translate_to_mouse_events?: boolean): void;
  ignore_events?: boolean;

  // --- input: keyboard ---
  keys: Record<string, boolean>;
  captureKeys(prevent_default?: boolean, only_canvas?: boolean): void;

  // --- input: gamepads ---
  gamepads: (Gamepad | null)[] | null;
  captureGamepads(): void;
  getGamepads(skip_mapping?: boolean): (Gamepad | null)[] | undefined;

  // --- utility ---
  fullscreen(): void;
  snapshot(startx: number, starty: number, areax: number, areay: number, skip_reverse?: boolean): HTMLCanvasElement;
  loadTexture(url: string, options?: Record<string, unknown>, on_load?: (texture: Texture) => void): Texture | null;
  drawTexture(
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
  ): void;

  // --- optional user event hooks ---
  onupdate?: (dt: number) => void;
  ondraw?: () => void;
  onmouse?: GLEventHandler;
  onmousedown?: GLEventHandler;
  onmousemove?: GLEventHandler;
  onmouseup?: GLEventHandler;
  onmousewheel?: GLEventHandler;
  ondragstart?: GLEventHandler;
  ontouch?: (event: TouchEvent) => boolean | void;
  ongesture?: (event: Event) => boolean | void;
  onkey?: GLKeyEventHandler;
  onkeydown?: GLKeyEventHandler;
  onkeyup?: GLKeyEventHandler;
  onbuttondown?: (event: Event) => void;
  ongamepadconnected?: (event: Event) => void;
  onlosecontext?: (event: Event) => void;

  // --- internal render state shared across modules ---
  _current_texture_drawto: Texture | null;
  _current_fbo_color: unknown;
  _current_fbo_depth: unknown;
  _current_shader?: Shader | null;
  _framebuffer?: WebGLFramebuffer | null;
  _renderbuffer?: WebGLRenderbuffer | null;
  _color_renderbuffer?: WebGLRenderbuffer | null;
  _renderbuffers_pool?: Record<string, WebGLRenderbuffer[]>;
  _texture_pool?: Texture[];
  __copy_fbo?: import("./fbo").FBO;
}

declare global {
  // eslint-disable-next-line no-var
  var gl: GLContext;

  interface Window {
    gl: GLContext;
    glMatrix?: unknown;
  }

  interface HTMLCanvasElement {
    is_webgl?: boolean;
    gl?: GLContext;
  }
}
