// WebGL enum mirrors and library constants.
//
// These are exposed as statics on the `GL` namespace (see index.ts) so values are available before
// a WebGL context exists — the WebGL spec guarantees they are constant. Ported verbatim from the
// original header.js.

export const COLOR_BUFFER_BIT = 16384;
export const DEPTH_BUFFER_BIT = 256;
export const STENCIL_BUFFER_BIT = 1024;

export const TEXTURE_2D = 3553;
export const TEXTURE_CUBE_MAP = 34067;
export const TEXTURE_3D = 32879;

export const TEXTURE_MAG_FILTER = 10240;
export const TEXTURE_MIN_FILTER = 10241;
export const TEXTURE_WRAP_S = 10242;
export const TEXTURE_WRAP_T = 10243;

export const BYTE = 5120;
export const UNSIGNED_BYTE = 5121;
export const SHORT = 5122;
export const UNSIGNED_SHORT = 5123;
export const INT = 5124;
export const UNSIGNED_INT = 5125;
export const FLOAT = 5126;
export const HALF_FLOAT_OES = 36193; // webgl 1.0 only

// webgl2 formats
export const HALF_FLOAT = 5131;
export const DEPTH_COMPONENT16 = 33189;
export const DEPTH_COMPONENT24 = 33190;
export const DEPTH_COMPONENT32F = 36012;

export const FLOAT_VEC2 = 35664;
export const FLOAT_VEC3 = 35665;
export const FLOAT_VEC4 = 35666;
export const INT_VEC2 = 35667;
export const INT_VEC3 = 35668;
export const INT_VEC4 = 35669;
export const BOOL = 35670;
export const BOOL_VEC2 = 35671;
export const BOOL_VEC3 = 35672;
export const BOOL_VEC4 = 35673;
export const FLOAT_MAT2 = 35674;
export const FLOAT_MAT3 = 35675;
export const FLOAT_MAT4 = 35676;

export const SAMPLER_2D = 35678;
export const SAMPLER_3D = 35679;
export const SAMPLER_CUBE = 35680;
export const INT_SAMPLER_2D = 36298;
export const INT_SAMPLER_3D = 36299;
export const INT_SAMPLER_CUBE = 36300;
export const UNSIGNED_INT_SAMPLER_2D = 36306;
export const UNSIGNED_INT_SAMPLER_3D = 36307;
export const UNSIGNED_INT_SAMPLER_CUBE = 36308;

export const DEPTH_COMPONENT = 6402;
export const ALPHA = 6406;
export const RGB = 6407;
export const RGBA = 6408;
export const LUMINANCE = 6409;
export const LUMINANCE_ALPHA = 6410;
export const DEPTH_STENCIL = 34041;
export const UNSIGNED_INT_24_8 = 34042;
export const UNSIGNED_INT_24_8_WEBGL = 34042;

// webgl2 formats
export const R8 = 33321;
export const R16F = 33325;
export const R32F = 33326;
export const R8UI = 33330;
export const RG8 = 33323;
export const RG16F = 33327;
export const RG32F = 33328;
export const RGB8 = 32849;
export const SRGB8 = 35905;
export const RGB565 = 36194;
export const R11F_G11F_B10F = 35898;
export const RGB9_E5 = 35901;
export const RGB16F = 34843;
export const RGB32F = 34837;
export const RGB8UI = 36221;
export const RGBA8 = 32856;
export const RGB5_A1 = 32855;
export const RGBA16F = 34842;
export const RGBA32F = 34836;
export const RGBA8UI = 36220;
export const RGBA16I = 36232;
export const RGBA16UI = 36214;
export const RGBA32I = 36226;
export const RGBA32UI = 36208;
export const DEPTH24_STENCIL8 = 35056;

export const NEAREST = 9728;
export const LINEAR = 9729;
export const NEAREST_MIPMAP_NEAREST = 9984;
export const LINEAR_MIPMAP_NEAREST = 9985;
export const NEAREST_MIPMAP_LINEAR = 9986;
export const LINEAR_MIPMAP_LINEAR = 9987;

export const REPEAT = 10497;
export const CLAMP_TO_EDGE = 33071;
export const MIRRORED_REPEAT = 33648;

export const ZERO = 0;
export const ONE = 1;
export const SRC_COLOR = 768;
export const ONE_MINUS_SRC_COLOR = 769;
export const SRC_ALPHA = 770;
export const ONE_MINUS_SRC_ALPHA = 771;
export const DST_ALPHA = 772;
export const ONE_MINUS_DST_ALPHA = 773;
export const DST_COLOR = 774;
export const ONE_MINUS_DST_COLOR = 775;
export const SRC_ALPHA_SATURATE = 776;
export const CONSTANT_COLOR = 32769;
export const ONE_MINUS_CONSTANT_COLOR = 32770;
export const CONSTANT_ALPHA = 32771;
export const ONE_MINUS_CONSTANT_ALPHA = 32772;

export const VERTEX_SHADER = 35633;
export const FRAGMENT_SHADER = 35632;

export const FRONT = 1028;
export const BACK = 1029;
export const FRONT_AND_BACK = 1032;

export const NEVER = 512;
export const LESS = 513;
export const EQUAL = 514;
export const LEQUAL = 515;
export const GREATER = 516;
export const NOTEQUAL = 517;
export const GEQUAL = 518;
export const ALWAYS = 519;

export const KEEP = 7680;
export const REPLACE = 7681;
export const INCR = 7682;
export const DECR = 7683;
export const INCR_WRAP = 34055;
export const DECR_WRAP = 34056;
export const INVERT = 5386;

export const STREAM_DRAW = 35040;
export const STATIC_DRAW = 35044;
export const DYNAMIC_DRAW = 35048;

export const ARRAY_BUFFER = 34962;
export const ELEMENT_ARRAY_BUFFER = 34963;

export const POINTS = 0;
export const LINES = 1;
export const LINE_LOOP = 2;
export const LINE_STRIP = 3;
export const TRIANGLES = 4;
export const TRIANGLE_STRIP = 5;
export const TRIANGLE_FAN = 6;

export const CW = 2304;
export const CCW = 2305;

export const CULL_FACE = 2884;
export const DEPTH_TEST = 2929;
export const BLEND = 3042;

// mouse button ids/masks
// https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/button
export const LEFT_MOUSE_BUTTON = 0;
export const MIDDLE_MOUSE_BUTTON = 1;
export const RIGHT_MOUSE_BUTTON = 2;

export const LEFT_MOUSE_BUTTON_MASK = 1;
export const RIGHT_MOUSE_BUTTON_MASK = 2;
export const MIDDLE_MOUSE_BUTTON_MASK = 4;

export const blockable_keys: Record<string, boolean> = {
  Up: true,
  Down: true,
  Left: true,
  Right: true,
};

// used to know the amount of data to reserve per uniform (indexed by GL uniform type enum)
export const TYPE_LENGTH: Record<number, number> = {};
TYPE_LENGTH[FLOAT] = TYPE_LENGTH[INT] = TYPE_LENGTH[BYTE] = TYPE_LENGTH[BOOL] = 1;
TYPE_LENGTH[FLOAT_VEC2] = TYPE_LENGTH[INT_VEC2] = TYPE_LENGTH[BOOL_VEC2] = 2;
TYPE_LENGTH[FLOAT_VEC3] = TYPE_LENGTH[INT_VEC3] = TYPE_LENGTH[BOOL_VEC3] = 3;
TYPE_LENGTH[FLOAT_VEC4] = TYPE_LENGTH[INT_VEC4] = TYPE_LENGTH[BOOL_VEC4] = 4;
TYPE_LENGTH[FLOAT_MAT3] = 9;
TYPE_LENGTH[FLOAT_MAT4] = 16;
