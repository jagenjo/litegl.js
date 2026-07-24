// Mesh primitive factories for litegl.js.
//
// This is a pure ESM SIDE-EFFECT module: importing it augments the `Mesh` class with the static
// factory methods (plane, cube, sphere, ...). The original primitives.js attached these directly to
// GL.Mesh; here they are attached to the imported `Mesh` class instead. The corresponding static
// signatures are declared (declare-only) in mesh.ts, so this module only supplies the implementations.
//
// The module exports nothing.

import { Mesh } from "./mesh";
import type { MeshPrimitiveOptions, TypedArray } from "./mesh";
import type { GLContext } from "./types";
import { BBox } from "./geo";

/**
 * Returns a planar mesh (you can choose how many subdivisions)
 * @method Mesh.plane
 * @param {Object} options valid options: detail, detailX, detailY, size, width, heigth, xz (horizontal plane)
 */
Mesh.plane = function (options?: MeshPrimitiveOptions, gl?: GLContext): Mesh {
  options = options || {};
  options.triangles = [];
  const mesh: Record<string, unknown> = {};
  const detailX = options.detailX || options.detail || 1;
  const detailY = options.detailY || options.detail || 1;
  let width = options.width || options.size || 1;
  let height = options.height || options.size || 1;
  const xz = options.xz;
  width *= 0.5;
  height *= 0.5;

  const triangles: number[] = [];
  const vertices: number[] = [];
  const coords: number[] = [];
  const normals: number[] = [];

  const N = vec3.fromValues(0, 0, 1);
  if (xz) N.set([0, 1, 0]);

  for (let y = 0; y <= detailY; y++) {
    const t = y / detailY;
    for (let x = 0; x <= detailX; x++) {
      const s = x / detailX;
      if (xz) vertices.push((2 * s - 1) * width, 0, -(2 * t - 1) * height);
      else vertices.push((2 * s - 1) * width, (2 * t - 1) * height, 0);
      coords.push(s, t);
      normals.push(N[0], N[1], N[2]);
      if (x < detailX && y < detailY) {
        const i = x + y * (detailX + 1);
        if (xz) {
          //horizontal
          triangles.push(i + 1, i + detailX + 1, i);
          triangles.push(i + 1, i + detailX + 2, i + detailX + 1);
        } else {
          //vertical
          triangles.push(i, i + 1, i + detailX + 1);
          triangles.push(i + detailX + 1, i + 1, i + detailX + 2);
        }
      }
    }
  }

  const bounding = BBox.fromCenterHalfsize([0, 0, 0], xz ? [width, 0, height] : [width, height, 0]);
  const mesh_info: Record<string, number[]> = { vertices: vertices, normals: normals, coords: coords, triangles: triangles };
  void mesh;
  return Mesh.load(mesh_info, { bounding: bounding }, null, gl);
};

/**
 * Returns a 2D Mesh (be careful, stream is vertices2D, used for 2D engines )
 * @method Mesh.plane2D
 */
Mesh.plane2D = function (options?: MeshPrimitiveOptions, gl?: GLContext): Mesh {
  const vertices = new Float32Array([-1, 1, 1, -1, 1, 1, -1, 1, -1, -1, 1, -1]);
  const coords = new Float32Array([0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0]);

  if (options && options.size) {
    const s = options.size * 0.5;
    for (let i = 0; i < vertices.length; ++i) vertices[i] *= s;
  }
  return new Mesh({ vertices2D: vertices, coords: coords }, null, null, gl);
};

/**
 * Returns a point mesh
 * @method Mesh.point
 * @param {Object} options no options
 */
Mesh.point = function (options?: MeshPrimitiveOptions): Mesh {
  void options;
  return new Mesh({ vertices: [0, 0, 0] });
};

/**
 * Returns a cube mesh
 * @method Mesh.cube
 * @param {Object} options valid options: size
 */
Mesh.cube = function (options?: MeshPrimitiveOptions, gl?: GLContext): Mesh {
  options = options || {};
  const halfsize = (options.size || 1) * 0.5;

  const buffers: Record<string, TypedArray> = {};
  //prettier-ignore
  buffers.vertices = new Float32Array([-1,1,-1,-1,-1,+1, -1,1,1,-1,1,-1, -1,-1,-1,-1,-1,+1, 1,1,-1,1,1,1,1,-1,+1,1,1,-1,1,-1,+1,1,-1,-1,-1,1,1,1,-1,1,1,1,1,-1,1,1,-1,-1,1,1,-1,1,-1,1,-1,1,1,-1,1,-1,-1,-1,1,-1,1,-1,-1,-1,-1,-1,-1,1,-1,1,1,1,1,1,-1,-1,1,-1,-1,1,1,1,1,1,-1,-1,-1,1,-1,-1,1,-1,1,-1,-1,-1,1,-1,1,-1,-1,1]);
  for (let i = 0, l = buffers.vertices.length; i < l; ++i) buffers.vertices[i] *= halfsize;

  //prettier-ignore
  buffers.normals = new Float32Array([-1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0]);
  //prettier-ignore
  buffers.coords = new Float32Array([0,1,1,0,1,1,0,1,0,0,1,0,1,1,0,1,0,0,1,1,0,0,1,0,0,1,1,0,1,1,0,1,0,0,1,0,1,1,0,1,0,0,1,1,0,0,1,0,0,1,1,0,1,1,0,1,0,0,1,0,1,1,0,1,0,0,1,1,0,0,1,0]);

  if (options.wireframe)
    buffers.wireframe = new Uint16Array([0, 2, 2, 5, 5, 4, 4, 0, 6, 7, 7, 10, 10, 11, 11, 6, 0, 6, 2, 7, 5, 10, 4, 11]);
  options.bounding = BBox.fromCenterHalfsize([0, 0, 0], [halfsize, halfsize, halfsize]);
  return Mesh.load(buffers, options, null, gl);
};

/**
 * Returns a cube mesh of a given size
 * @method Mesh.cube
 * @param {Object} options valid options: size, sizex, sizey, sizez
 */
Mesh.box = function (options?: MeshPrimitiveOptions, gl?: GLContext): Mesh {
  options = options || {};
  let sizex = options.sizex || 1;
  let sizey = options.sizey || 1;
  let sizez = options.sizez || 1;
  sizex *= 0.5;
  sizey *= 0.5;
  sizez *= 0.5;

  const buffers: Record<string, TypedArray> = {};
  //prettier-ignore
  buffers.vertices = new Float32Array([-1,1,-1,-1,-1,+1,-1,1,1,-1,1,-1,-1,-1,-1,-1,-1,+1,1,1,-1,1,1,1,1,-1,+1,1,1,-1,1,-1,+1,1,-1,-1,-1,1,1,1,-1,1,1,1,1,-1,1,1,-1,-1,1,1,-1,1,-1,1,-1,1,1,-1,1,-1,-1,-1,1,-1,1,-1,-1,-1,-1,-1,-1,1,-1,1,1,1,1,1,-1,-1,1,-1,-1,1,1,1,1,1,-1,-1,-1,1,-1,-1,1,-1,1,-1,-1,-1,1,-1,1,-1,-1,1]);
  for (let i = 0, l = buffers.vertices.length; i < l; i += 3) {
    buffers.vertices[i] *= sizex;
    buffers.vertices[i + 1] *= sizey;
    buffers.vertices[i + 2] *= sizez;
  }

  //prettier-ignore
  buffers.normals = new Float32Array([-1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0]);
  //prettier-ignore
  buffers.coords = new Float32Array([0,1,1,0,1,1,0,1,0,0,1,0,1,1,0,1,0,0,1,1,0,0,1,0,0,1,1,0,1,1,0,1,0,0,1,0,1,1,0,1,0,0,1,1,0,0,1,0,0,1,1,0,1,1,0,1,0,0,1,0,1,1,0,1,0,0,1,1,0,0,1,0]);

  if (options.wireframe)
    buffers.wireframe = new Uint16Array([0, 2, 2, 5, 5, 4, 4, 0, 6, 7, 7, 10, 10, 11, 11, 6, 0, 6, 2, 7, 5, 10, 4, 11]);

  options.bounding = BBox.fromCenterHalfsize([0, 0, 0], [sizex, sizey, sizez]);

  return Mesh.load(buffers, options, null, gl);
};

/**
 * Returns a circle mesh
 * @method Mesh.circle
 * @param {Object} options valid options: size,radius, xz = in xz plane, otherwise xy plane
 */
Mesh.circle = function (options?: MeshPrimitiveOptions, gl?: GLContext): Mesh {
  options = options || {};
  const size = options.size || options.radius || 1;
  let slices = Math.ceil(options.slices || 24);
  const xz = options.xz || false;
  const empty = options.empty || false;
  if (slices < 3) slices = 3;
  const delta = (2 * Math.PI) / slices;

  const center = vec3.create();
  const A = vec3.create();
  const N = vec3.fromValues(0, 0, 1);
  const uv_center = vec2.fromValues(0.5, 0.5);
  const uv = vec2.create();

  if (xz) N.set([0, 1, 0]);

  const index = xz ? 2 : 1;

  let vertices = new Float32Array(3 * (slices + 1));
  let normals = new Float32Array(3 * (slices + 1));
  let coords = new Float32Array(2 * (slices + 1));
  let triangles: Uint16Array | null = null;

  //the center is always the same
  vertices.set(center, 0);
  normals.set(N, 0);
  coords.set(uv_center, 0);

  let sin = 0;
  let cos = 0;

  //compute vertices
  for (let i = 0; i < slices; ++i) {
    sin = Math.sin(delta * i);
    cos = Math.cos(delta * i);

    A[0] = sin * size;
    A[index] = cos * size;
    uv[0] = sin * 0.5 + 0.5;
    uv[1] = cos * 0.5 + 0.5;
    vertices.set(A, i * 3 + 3);
    normals.set(N, i * 3 + 3);
    coords.set(uv, i * 2 + 2);
  }

  if (empty) {
    vertices = vertices.subarray(3);
    normals = vertices.subarray(3);
    coords = vertices.subarray(2);
    triangles = null;
  } else {
    triangles = new Uint16Array(3 * slices);
    let offset = 2;
    let offset2 = 1;
    if (xz) {
      offset = 1;
      offset2 = 2;
    }

    //compute indices
    let i = 0;
    for (i = 0; i < slices - 1; ++i) {
      triangles[i * 3] = 0;
      triangles[i * 3 + 1] = i + offset;
      triangles[i * 3 + 2] = i + offset2;
    }

    triangles[i * 3] = 0;
    if (xz) {
      triangles[i * 3 + 1] = i + 1;
      triangles[i * 3 + 2] = 1;
    } else {
      triangles[i * 3 + 1] = 1;
      triangles[i * 3 + 2] = i + 1;
    }
  }

  options.bounding = BBox.fromCenterHalfsize([0, 0, 0], xz ? [size, 0, size] : [size, size, 0]);

  const buffers: Record<string, TypedArray | null> = {
    vertices: vertices,
    normals: normals,
    coords: coords,
    triangles: triangles,
  };

  if (options.wireframe) {
    const wireframe = new Uint16Array(slices * 2);
    for (let i = 0; i < slices; i++) {
      wireframe[i * 2] = i;
      wireframe[i * 2 + 1] = i + 1;
    }
    wireframe[0] = slices;
    buffers.wireframe = wireframe;
  }

  return Mesh.load(buffers, options, null, gl);
};

/**
 * Returns a ring mesh
 * @method Mesh.ring
 * @param {Object} options valid options: radius, thickness, xz = in xz plane, otherwise xy plane
 */
Mesh.ring = function (options?: MeshPrimitiveOptions, gl?: GLContext): Mesh {
  options = options || {};
  const size = options.size || options.radius || 1;
  const thickness = options.thickness || size * 0.1;
  let slices = Math.ceil(options.slices || 24);
  const xz = options.xz || false;
  const empty = options.empty || false;
  if (slices < 3) slices = 3;
  const delta = (2 * Math.PI) / slices;

  const A = vec3.create();
  const B = vec3.create();
  const N = vec3.fromValues(0, 0, 1);
  const uv = vec2.create();

  if (xz) N.set([0, 1, 0]);

  const index = xz ? 2 : 1;

  let vertices = new Float32Array(3 * (slices * 2 + 2));
  let normals = new Float32Array(3 * (slices * 2 + 2));
  let coords = new Float32Array(2 * (slices * 2 + 2));
  let triangles: Uint16Array | null = null;

  let sin = 0;
  let cos = 0;

  //compute vertices
  for (let i = 0; i <= slices; ++i) {
    sin = Math.sin(delta * i);
    cos = Math.cos(delta * i);

    A[0] = sin * (size - thickness);
    A[index] = cos * (size - thickness);
    uv[0] = i / slices;
    uv[1] = 0;
    vertices.set(A, i * 6);
    normals.set(N, i * 6);
    coords.set(uv, i * 4);

    B[0] = sin * (size + thickness);
    B[index] = cos * (size + thickness);
    uv[1] = 1;
    vertices.set(B, i * 6 + 3);
    normals.set(N, i * 6 + 3);
    coords.set(uv, i * 4 + 2);
  }

  if (empty) {
    vertices = vertices.subarray(3);
    normals = vertices.subarray(3);
    coords = vertices.subarray(2);
    triangles = null;
  } else {
    triangles = new Uint16Array(6 * slices);
    let offset = 2;
    let offset2 = 1;
    if (xz) {
      offset = 1;
      offset2 = 2;
    }

    //compute indices
    for (let i = 0; i < slices; ++i) {
      triangles[i * 6] = i * 2;
      triangles[i * 6 + 1] = i * 2 + offset;
      triangles[i * 6 + 2] = i * 2 + offset2;
      triangles[i * 6 + 3] = i * 2 + offset2;
      triangles[i * 6 + 4] = i * 2 + offset;
      triangles[i * 6 + 5] = i * 2 + 3;
    }
  }

  options.bounding = BBox.fromCenterHalfsize(
    [0, 0, 0],
    xz ? [size + thickness, 0, size + thickness] : [size + thickness, size + thickness, 0]
  );

  const buffers: Record<string, TypedArray | null> = {
    vertices: vertices,
    normals: normals,
    coords: coords,
    triangles: triangles,
  };

  if (options.wireframe) {
    const wireframe = new Uint16Array(slices * 4);
    for (let i = 0; i < slices; i++) {
      wireframe[i * 4] = i * 2;
      wireframe[i * 4 + 1] = i * 2 + 2;
      wireframe[i * 4 + 2] = i * 2 + 1;
      wireframe[i * 4 + 3] = i * 2 + 3;
    }
    buffers.wireframe = wireframe;
  }
  return Mesh.load(buffers, options, null, gl);
};

/**
 * Returns a cube mesh
 * @method Mesh.cylinder
 * @param {Object} options valid options: radius, height, subdivisions
 */
Mesh.cylinder = function (options?: MeshPrimitiveOptions, gl?: GLContext): Mesh {
  options = options || {};
  const radius = options.radius || options.size || 1;
  const height = options.height || options.size || 2;
  const subdivisions = options.subdivisions || 64;

  let vertices = new Float32Array(subdivisions * 6 * 3 * 2);
  let normals = new Float32Array(subdivisions * 6 * 3 * 2);
  let coords = new Float32Array(subdivisions * 6 * 2 * 2);
  //not indexed because caps have different normals and uvs so...

  const delta = (2 * Math.PI) / subdivisions;
  let normal: number[];
  let i = 0;
  for (i = 0; i < subdivisions; ++i) {
    const angle = i * delta;

    normal = [Math.sin(angle), 0, Math.cos(angle)];
    vertices.set([normal[0] * radius, height * 0.5, normal[2] * radius], i * 6 * 3);
    normals.set(normal, i * 6 * 3);
    coords.set([i / subdivisions, 1], i * 6 * 2);

    normal = [Math.sin(angle), 0, Math.cos(angle)];
    vertices.set([normal[0] * radius, height * -0.5, normal[2] * radius], i * 6 * 3 + 3);
    normals.set(normal, i * 6 * 3 + 3);
    coords.set([i / subdivisions, 0], i * 6 * 2 + 2);

    normal = [Math.sin(angle + delta), 0, Math.cos(angle + delta)];
    vertices.set([normal[0] * radius, height * -0.5, normal[2] * radius], i * 6 * 3 + 6);
    normals.set(normal, i * 6 * 3 + 6);
    coords.set([(i + 1) / subdivisions, 0], i * 6 * 2 + 4);

    normal = [Math.sin(angle + delta), 0, Math.cos(angle + delta)];
    vertices.set([normal[0] * radius, height * 0.5, normal[2] * radius], i * 6 * 3 + 9);
    normals.set(normal, i * 6 * 3 + 9);
    coords.set([(i + 1) / subdivisions, 1], i * 6 * 2 + 6);

    normal = [Math.sin(angle), 0, Math.cos(angle)];
    vertices.set([normal[0] * radius, height * 0.5, normal[2] * radius], i * 6 * 3 + 12);
    normals.set(normal, i * 6 * 3 + 12);
    coords.set([i / subdivisions, 1], i * 6 * 2 + 8);

    normal = [Math.sin(angle + delta), 0, Math.cos(angle + delta)];
    vertices.set([normal[0] * radius, height * -0.5, normal[2] * radius], i * 6 * 3 + 15);
    normals.set(normal, i * 6 * 3 + 15);
    coords.set([(i + 1) / subdivisions, 0], i * 6 * 2 + 10);
  }

  const pos = i * 6 * 3;
  const pos_uv = i * 6 * 2;
  const caps_start = pos;

  //caps
  if (options.caps === false) {
    //finalize arrays
    vertices = vertices.subarray(0, pos);
    normals = normals.subarray(0, pos);
    coords = coords.subarray(0, pos_uv);
  } else {
    const top_center = vec3.fromValues(0, height * 0.5, 0);
    const bottom_center = vec3.fromValues(0, height * -0.5, 0);
    const up = vec3.fromValues(0, 1, 0);
    const down = vec3.fromValues(0, -1, 0);
    for (let j = 0; j < subdivisions; ++j) {
      const angle = j * delta;

      const uv = vec3.fromValues(Math.sin(angle), 0, Math.cos(angle));
      const uv2 = vec3.fromValues(Math.sin(angle + delta), 0, Math.cos(angle + delta));

      vertices.set([uv[0] * radius, height * 0.5, uv[2] * radius], pos + j * 6 * 3);
      normals.set(up, pos + j * 6 * 3);
      coords.set([-uv[0] * 0.5 + 0.5, uv[2] * 0.5 + 0.5], pos_uv + j * 6 * 2);

      vertices.set([uv2[0] * radius, height * 0.5, uv2[2] * radius], pos + j * 6 * 3 + 3);
      normals.set(up, pos + j * 6 * 3 + 3);
      coords.set([-uv2[0] * 0.5 + 0.5, uv2[2] * 0.5 + 0.5], pos_uv + j * 6 * 2 + 2);

      vertices.set(top_center, pos + j * 6 * 3 + 6);
      normals.set(up, pos + j * 6 * 3 + 6);
      coords.set([0.5, 0.5], pos_uv + j * 6 * 2 + 4);

      //bottom
      vertices.set([uv2[0] * radius, height * -0.5, uv2[2] * radius], pos + j * 6 * 3 + 9);
      normals.set(down, pos + j * 6 * 3 + 9);
      coords.set([uv2[0] * 0.5 + 0.5, uv2[2] * 0.5 + 0.5], pos_uv + j * 6 * 2 + 6);

      vertices.set([uv[0] * radius, height * -0.5, uv[2] * radius], pos + j * 6 * 3 + 12);
      normals.set(down, pos + j * 6 * 3 + 12);
      coords.set([uv[0] * 0.5 + 0.5, uv[2] * 0.5 + 0.5], pos_uv + j * 6 * 2 + 8);

      vertices.set(bottom_center, pos + j * 6 * 3 + 15);
      normals.set(down, pos + j * 6 * 3 + 15);
      coords.set([0.5, 0.5], pos_uv + j * 6 * 2 + 10);
    }
  }

  const buffers: Record<string, TypedArray> = {
    vertices: vertices,
    normals: normals,
    coords: coords,
  };
  options.bounding = BBox.fromCenterHalfsize([0, 0, 0], [radius, height * 0.5, radius]);
  options.info = { groups: [] };

  if (options.caps !== false) {
    options.info.groups.push({ name: "side", start: 0, length: caps_start / 3 });
    options.info.groups.push({ name: "caps", start: caps_start / 3, length: (vertices.length - caps_start) / 3 });
  }

  return Mesh.load(buffers, options, null, gl);
};

/**
 * Returns a cone mesh
 * @method Mesh.cone
 * @param {Object} options valid options: radius, height, subdivisions
 */
Mesh.cone = function (options?: MeshPrimitiveOptions, gl?: GLContext): Mesh {
  options = options || {};
  const radius = options.radius || options.size || 1;
  const height = options.height || options.size || 2;
  const subdivisions = options.subdivisions || 64;

  const vertices = new Float32Array(subdivisions * 3 * 3 * 2);
  const normals = new Float32Array(subdivisions * 3 * 3 * 2);
  const coords = new Float32Array(subdivisions * 2 * 3 * 2);
  //not indexed because caps have different normals and uvs so...

  const delta = (2 * Math.PI) / subdivisions;
  let normal: number[];
  const normal_y = radius / height;
  const up = [0, 1, 0];
  void up;

  for (let i = 0; i < subdivisions; ++i) {
    const angle = i * delta;

    normal = [Math.sin(angle + delta * 0.5), normal_y, Math.cos(angle + delta * 0.5)];
    vec3.normalize(normal as unknown as Float32Array, normal);
    //normal = up;
    vertices.set([0, height, 0], i * 6 * 3);
    normals.set(normal, i * 6 * 3);
    coords.set([i / subdivisions, 1], i * 6 * 2);

    normal = [Math.sin(angle), normal_y, Math.cos(angle)];
    vertices.set([normal[0] * radius, 0, normal[2] * radius], i * 6 * 3 + 3);
    vec3.normalize(normal as unknown as Float32Array, normal);
    normals.set(normal, i * 6 * 3 + 3);
    coords.set([i / subdivisions, 0], i * 6 * 2 + 2);

    normal = [Math.sin(angle + delta), normal_y, Math.cos(angle + delta)];
    vertices.set([normal[0] * radius, 0, normal[2] * radius], i * 6 * 3 + 6);
    vec3.normalize(normal as unknown as Float32Array, normal);
    normals.set(normal, i * 6 * 3 + 6);
    coords.set([(i + 1) / subdivisions, 0], i * 6 * 2 + 4);
  }

  const pos = 0; //i*3*3;
  const pos_uv = 0; //i*3*2;

  //cap
  const bottom_center = vec3.fromValues(0, 0, 0);
  const down = vec3.fromValues(0, -1, 0);
  for (let i = 0; i < subdivisions; ++i) {
    const angle = i * delta;

    const uv = vec3.fromValues(Math.sin(angle), 0, Math.cos(angle));
    const uv2 = vec3.fromValues(Math.sin(angle + delta), 0, Math.cos(angle + delta));

    //bottom
    vertices.set([uv2[0] * radius, 0, uv2[2] * radius], pos + i * 6 * 3 + 9);
    normals.set(down, pos + i * 6 * 3 + 9);
    coords.set([uv2[0] * 0.5 + 0.5, uv2[2] * 0.5 + 0.5], pos_uv + i * 6 * 2 + 6);

    vertices.set([uv[0] * radius, 0, uv[2] * radius], pos + i * 6 * 3 + 12);
    normals.set(down, pos + i * 6 * 3 + 12);
    coords.set([uv[0] * 0.5 + 0.5, uv[2] * 0.5 + 0.5], pos_uv + i * 6 * 2 + 8);

    vertices.set(bottom_center, pos + i * 6 * 3 + 15);
    normals.set(down, pos + i * 6 * 3 + 15);
    coords.set([0.5, 0.5], pos_uv + i * 6 * 2 + 10);
  }

  const buffers: Record<string, TypedArray> = {
    vertices: vertices,
    normals: normals,
    coords: coords,
  };
  options.bounding = BBox.fromCenterHalfsize([0, height * 0.5, 0], [radius, height * 0.5, radius]);

  return Mesh.load(buffers, options, null, gl);
};

/**
 * Returns a torus mesh (warning, it reuses vertices in the last loop so UVs will be messed up, sorry)
 * @method Mesh.torus
 * @param {Object} options valid options: innerradius, outerradius, innerslices, outerslices
 */
Mesh.torus = function (options?: MeshPrimitiveOptions, gl?: GLContext): Mesh {
  options = options || {};
  const outerradius = options.outerradius || options.radius || 1;
  const outerslices = Math.ceil(options.outerslices || options.slices || 24);
  const innerradius = options.innerradius || outerradius * 0.1;
  const innerslices = Math.ceil(options.innerslices || outerslices);
  const angle = options.angle || Math.PI * 2;

  const innerdelta = (Math.PI * 2) / innerslices;
  const outerdelta = angle / outerslices;
  const xz = false;
  const index = xz ? 2 : 1;

  const A = vec3.create();
  const N = vec3.fromValues(0, 0, 1);
  const uv = vec2.create();
  const close = angle == Math.PI * 2;

  //circle vertices
  const cvertices = new Float32Array(3 * innerslices);
  const cnormals = new Float32Array(3 * innerslices);

  let sin = 0;
  let cos = 0;
  //compute circle vertices
  for (let i = 0; i < innerslices; ++i) {
    sin = Math.sin(innerdelta * i);
    cos = Math.cos(innerdelta * i);
    A[0] = sin * innerradius;
    A[index] = cos * innerradius;
    uv[0] = sin * 0.5 + 0.5;
    uv[1] = cos * 0.5 + 0.5;
    cvertices.set(A, i * 3);
    vec3.normalize(N, A);
    cnormals.set(N, i * 3);
  }

  const vertices = new Float32Array(3 * outerslices * innerslices);
  const normals = new Float32Array(3 * outerslices * innerslices);
  const coords = new Float32Array(2 * outerslices * innerslices);

  const M = mat4.create();
  const offset = vec3.fromValues(-outerradius, 0, 0);
  const axis = vec3.fromValues(0, 1, 0);

  const triangles: number[] = [];

  //compute vertices
  for (let i = 0; i < outerslices; ++i) {
    mat4.identity(M);
    mat4.rotate(M, M, i * outerdelta, axis);
    mat4.translate(M, M, offset);

    const bindex = i * innerslices;
    let next = innerslices;
    if (i >= outerslices - 1) {
      next = (outerslices - 1) * -innerslices;
      if (!close) next = 0;
    }

    for (let j = 0; j < innerslices; ++j) {
      const cv = cvertices.subarray(j * 3, j * 3 + 3);
      const cn = cnormals.subarray(j * 3, j * 3 + 3);
      mat4.multiplyVec3(A, M, cv);
      mat4.rotateVec3(N, M, cn);
      vertices.set(A, j * 3 + i * 3 * innerslices);
      normals.set(N, j * 3 + i * 3 * innerslices);
      coords.set([i / outerslices, j / innerslices], j * 2 + i * 2 * innerslices);

      const a = bindex + j;
      const b = bindex + ((j + 1) % innerslices);
      triangles.push(b, a, a + next, b, a + next, b + next);
    }
  }

  const size = innerradius + outerradius;
  options.bounding = BBox.fromCenterHalfsize(
    [0, 0, 0],
    xz ? [size, innerradius, size] : [size, size, innerradius]
  );
  const buffers: Record<string, number[] | TypedArray> = {
    vertices: vertices,
    normals: normals,
    coords: coords,
    triangles: triangles,
  };
  return Mesh.load(buffers, options, null, gl);
};

/**
 * Returns a sphere mesh
 * @method Mesh.sphere
 * @param {Object} options valid options: radius, lat, long, subdivisions, hemi
 */
Mesh.sphere = function (options?: MeshPrimitiveOptions, gl?: GLContext): Mesh {
  options = options || {};
  const radius = options.radius || options.size || 1;
  const latitudeBands = options.lat || options.subdivisions || 16;
  const longitudeBands = (options["long"] as number) || options.subdivisions || 16;

  const vertexPositionData = new Float32Array((latitudeBands + 1) * (longitudeBands + 1) * 3);
  const normalData = new Float32Array((latitudeBands + 1) * (longitudeBands + 1) * 3);
  const textureCoordData = new Float32Array((latitudeBands + 1) * (longitudeBands + 1) * 2);
  const indexData = new Uint16Array(latitudeBands * longitudeBands * 6);
  const latRange = options.hemi ? Math.PI * 0.5 : Math.PI;

  let i = 0,
    iuv = 0;
  for (let latNumber = 0; latNumber <= latitudeBands; latNumber++) {
    const theta = (latNumber * latRange) / latitudeBands;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let longNumber = 0; longNumber <= longitudeBands; longNumber++) {
      const phi = (longNumber * 2 * Math.PI) / longitudeBands;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      const x = cosPhi * sinTheta;
      const y = cosTheta;
      const z = sinPhi * sinTheta;
      const u = 1 - longNumber / longitudeBands;
      const v = 1 - latNumber / latitudeBands;

      vertexPositionData.set([radius * x, radius * y, radius * z], i);
      normalData.set([x, y, z], i);
      textureCoordData.set([u, v], iuv);
      i += 3;
      iuv += 2;
    }
  }

  i = 0;
  for (let latNumber = 0; latNumber < latitudeBands; latNumber++) {
    for (let longNumber = 0; longNumber < longitudeBands; longNumber++) {
      const first = latNumber * (longitudeBands + 1) + longNumber;
      const second = first + longitudeBands + 1;

      indexData.set([second, first, first + 1], i);
      indexData.set([second + 1, second, first + 1], i + 3);
      i += 6;
    }
  }

  const buffers: Record<string, number[] | TypedArray> = {
    vertices: vertexPositionData,
    normals: normalData,
    coords: textureCoordData,
    triangles: indexData,
  };

  if (options.wireframe) {
    const wireframe = new Uint16Array(longitudeBands * latitudeBands * 4);
    let pos = 0;
    let wi = 0,
      wj = 0;
    for (wi = 0; wi < latitudeBands; wi++) {
      for (wj = 0; wj < longitudeBands; wj++) {
        wireframe[pos] = wi * (longitudeBands + 1) + wj;
        wireframe[pos + 1] = wi * (longitudeBands + 1) + wj + 1;
        pos += 2;
      }
      wireframe[pos - longitudeBands * 2] = wi * (longitudeBands + 1) + wj;
    }

    for (wi = 0; wi < longitudeBands; wi++)
      for (wj = 0; wj < latitudeBands; wj++) {
        wireframe[pos] = wj * (longitudeBands + 1) + wi;
        wireframe[pos + 1] = (wj + 1) * (longitudeBands + 1) + wi;
        pos += 2;
      }
    buffers.wireframe = wireframe;
  }

  if (options.hemi) options.bounding = BBox.fromCenterHalfsize([0, radius * 0.5, 0], [radius, radius * 0.5, radius]);
  else options.bounding = BBox.fromCenterHalfsize([0, 0, 0], [radius, radius, radius]);
  return Mesh.load(buffers, options, null, gl);
};

/**
 * Returns a grid mesh (must be rendered using gl.LINES)
 * @method Mesh.grid
 * @param {Object} options valid options: size, lines
 */
Mesh.grid = function (options?: MeshPrimitiveOptions, gl?: GLContext): Mesh {
  options = options || {};
  let num_lines = (options.lines as unknown as number) || 11;
  if (num_lines < 0) num_lines = 1;
  const size = options.size || 10;

  const vertexPositionData = new Float32Array(num_lines * 2 * 2 * 3);
  const hsize = size * 0.5;
  let pos = 0;
  let x = -hsize;
  const delta = size / (num_lines - 1);

  for (let i = 0; i < num_lines; i++) {
    vertexPositionData[pos] = x;
    vertexPositionData[pos + 2] = -hsize;
    vertexPositionData[pos + 3] = x;
    vertexPositionData[pos + 5] = hsize;

    vertexPositionData[pos + 6] = hsize;
    vertexPositionData[pos + 8] = x;
    vertexPositionData[pos + 9] = -hsize;
    vertexPositionData[pos + 11] = x;

    x += delta;
    pos += 12;
  }

  return new Mesh({ vertices: vertexPositionData }, null, options, gl);
};

/**
 * Returns a icosahedron mesh (useful to create spheres by subdivision)
 * @method Mesh.icosahedron
 * @param {Object} options valid options: radius, subdivisions (max: 6)
 */
Mesh.icosahedron = function (options?: MeshPrimitiveOptions, gl?: GLContext): Mesh {
  options = options || {};
  const radius = options.radius || options.size || 1;
  let subdivisions = options.subdivisions === undefined ? 0 : options.subdivisions;
  if (subdivisions > 6)
    //dangerous
    subdivisions = 6;

  const t = (1.0 + Math.sqrt(5)) / 2.0;
  //prettier-ignore
  const vertices: number[] = [-1,t,0, 1,t,0, -1,-t,0, 1,-t,0,
					0,-1,t, 0,1,t, 0,-1,-t, 0,1,-t,
					t,0,-1, t,0,1, -t,0,-1, -t,0,1];
  const normals: number[] = [];
  const coords: number[] = [];
  //prettier-ignore
  let indices: number[] = [0,11,5, 0,5,1, 0,1,7, 0,7,10, 0,10,11, 1,5,9, 5,11,4, 11,10,2, 10,7,6, 7,1,8, 3,9,4, 3,4,2, 3,2,6, 3,6,8, 3,8,9, 4,9,5, 2,4,11, 6,2,10, 8,6,7, 9,8,1 ];

  //normalize
  const l = vertices.length;
  for (let i = 0; i < l; i += 3) {
    const mod = Math.sqrt(vertices[i] * vertices[i] + vertices[i + 1] * vertices[i + 1] + vertices[i + 2] * vertices[i + 2]);
    const normalx = vertices[i] / mod;
    const normaly = vertices[i + 1] / mod;
    const normalz = vertices[i + 2] / mod;
    normals.push(normalx, normaly, normalz);
    coords.push(Math.atan2(normalx, normalz), Math.acos(normaly));
    vertices[i] *= radius / mod;
    vertices[i + 1] *= radius / mod;
    vertices[i + 2] *= radius / mod;
  }

  const middles: Record<string, number> = {};

  //A,B = index of vertex in vertex array
  function middlePoint(A: number, B: number): number {
    const key = indices[A] < indices[B] ? indices[A] + ":" + indices[B] : indices[B] + ":" + indices[A];
    const r = middles[key];
    if (r) return r;
    const index = vertices.length / 3;
    vertices.push(
      (vertices[indices[A] * 3] + vertices[indices[B] * 3]) * 0.5,
      (vertices[indices[A] * 3 + 1] + vertices[indices[B] * 3 + 1]) * 0.5,
      (vertices[indices[A] * 3 + 2] + vertices[indices[B] * 3 + 2]) * 0.5
    );

    const mod = Math.sqrt(
      vertices[index * 3] * vertices[index * 3] +
        vertices[index * 3 + 1] * vertices[index * 3 + 1] +
        vertices[index * 3 + 2] * vertices[index * 3 + 2]
    );
    const normalx = vertices[index * 3] / mod;
    const normaly = vertices[index * 3 + 1] / mod;
    const normalz = vertices[index * 3 + 2] / mod;
    normals.push(normalx, normaly, normalz);
    coords.push((Math.atan2(normalx, normalz) / Math.PI) * 0.5, Math.acos(normaly) / Math.PI);
    vertices[index * 3] *= radius / mod;
    vertices[index * 3 + 1] *= radius / mod;
    vertices[index * 3 + 2] *= radius / mod;

    middles[key] = index;
    return index;
  }

  for (let iR = 0; iR < subdivisions; ++iR) {
    const new_indices: number[] = [];
    const li = indices.length;
    for (let i = 0; i < li; i += 3) {
      const MA = middlePoint(i, i + 1);
      const MB = middlePoint(i + 1, i + 2);
      const MC = middlePoint(i + 2, i);
      new_indices.push(indices[i], MA, MC);
      new_indices.push(indices[i + 1], MB, MA);
      new_indices.push(indices[i + 2], MC, MB);
      new_indices.push(MA, MB, MC);
    }
    indices = new_indices;
  }

  options.bounding = BBox.fromCenterHalfsize([0, 0, 0], [radius, radius, radius]);

  return Mesh.load({ vertices: vertices, coords: coords, normals: normals, triangles: indices }, options, null, gl);
};

/**
 * Returns a closed shape from a 2D closed line, it can be extruded!
 * @method Mesh.shape
 * @param {Object} options valid options: extrude, xy
 */
Mesh.shape = function (line: number[] | number[][], options?: MeshPrimitiveOptions, gl?: GLContext): Mesh {
  options = options || {};
  if (typeof earcut === "undefined")
    throw "To use GL.Mesh.shape you must download and include earcut.js (do not link it directly!): https://raw.githubusercontent.com/mapbox/earcut/master/src/earcut.js";
  if (!line || !line.length || line.length % 2 == 1)
    throw "GL.Mesh.shape line missing, must be an array of 2D vertices";
  const ext = options.extrude || 0;
  let poly: number[];
  if ((line[0] as unknown as { constructor: unknown }).constructor === Array)
    poly = earcut.flatten(line as number[][]) as unknown as number[];
  else poly = line as number[];
  const triangulation: number[] = earcut(poly).reverse();
  console.log(triangulation);
  const vertices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  //bounding
  const minmaxX = [poly[0], poly[1]];
  const minmaxY = [poly[0], poly[1]];
  for (let i = 0; i < poly.length; i += 2) {
    minmaxX[0] = Math.min(minmaxX[0], poly[i]);
    minmaxX[1] = Math.max(minmaxX[1], poly[i]);
    minmaxY[0] = Math.min(minmaxY[0], poly[i + 1]);
    minmaxY[1] = Math.max(minmaxY[1], poly[i + 1]);
  }
  const rangeX = minmaxX[1] - minmaxX[0];
  const rangeY = minmaxY[1] - minmaxY[0];
  const groups: Array<{ name: string; start: number; length: number }> = [];
  let indices: number[] = [];
  if (ext) {
    indices = [];
    const N = vec3.create();
    //side
    const num = poly.length;
    for (let i = 0; i < poly.length; i += 2) {
      const x = poly[i];
      const y = poly[i + 1];
      const x2 = poly[(i + 2) % num];
      const y2 = poly[(i + 3) % num];
      const A = vertices.length / 3;
      vertices.push(x, ext * 0.5, y); //top
      vertices.push(x, ext * -0.5, y); //bottom
      vertices.push(x2, ext * 0.5, y2); //top next
      vertices.push(x2, ext * -0.5, y2); //bottom next
      vec3.normalize(N, vec3.cross(N, [0, 1, 0], [x2 - x, 0, y2 - y]));
      normals.push(N[0], N[1], N[2], N[0], N[1], N[2], N[0], N[1], N[2], N[0], N[1], N[2]);
      const u = (x - minmaxX[0]) / rangeX;
      const v = (y - minmaxY[0]) / rangeY;
      const u2 = (x2 - minmaxX[0]) / rangeX;
      const v2 = (y2 - minmaxY[0]) / rangeY;
      uvs.push(u, v, u, v, u2, v2, u2, v2);
      indices.push(A, A + 2, A + 1, A + 2, A + 3, A + 1);
    }
    groups.push({ name: "side", start: 0, length: indices.length });

    //caps
    const offset = vertices.length / 3;
    const start = indices.length;
    for (let i = 0; i < poly.length; i += 2) {
      const x = poly[i];
      const y = poly[i + 1];
      const u = (x - minmaxX[0]) / rangeX;
      const v = (y - minmaxY[0]) / rangeY;
      vertices.push(x, ext * 0.5, y); //top
      vertices.push(x, ext * -0.5, y); //bottom
      normals.push(0, 1, 0, 0, -1, 0);
      uvs.push(u, v, u, v);
    }

    for (let i = 0; i < triangulation.length; i += 3) {
      indices.push(offset + triangulation[i] * 2, offset + triangulation[i + 1] * 2, offset + triangulation[i + 2] * 2);
      indices.push(
        offset + triangulation[i] * 2 + 1,
        offset + triangulation[i + 2] * 2 + 1,
        offset + triangulation[i + 1] * 2 + 1
      );
    }
    groups.push({ name: "caps", start: start, length: indices.length });

    options.bounding = BBox.fromCenterHalfsize(
      [(minmaxX[0] + minmaxX[1]) * 0.5, 0, (minmaxY[0] + minmaxY[1]) * 0.5],
      [rangeX * 0.5, ext * 0.5, rangeY * 0.5]
    );
  } //flat
  else {
    //cap
    for (let i = 0; i < poly.length; i += 2) {
      vertices.push(poly[i], 0, poly[i + 1]);
      normals.push(0, 1, 0);
      uvs.push((poly[i] - minmaxX[0]) / rangeX, (poly[i + 1] - minmaxY[0]) / rangeY);
    }
    indices = triangulation;
    groups.push({ name: "side", start: 0, length: indices.length });
    options.bounding = BBox.fromCenterHalfsize(
      [(minmaxX[0] + minmaxX[1]) * 0.5, 0, (minmaxY[0] + minmaxY[1]) * 0.5],
      [rangeX * 0.5, 0, rangeY * 0.5]
    );
  }

  if (options.xy) {
    for (let i = 0; i < vertices.length; i += 3) {
      swap(vertices, i);
      swap(normals, i);
    }
    if (ext)
      options.bounding = BBox.fromCenterHalfsize(
        [(minmaxX[0] + minmaxX[1]) * 0.5, (minmaxY[0] + minmaxY[1]) * 0.5, 0],
        [rangeX * 0.5, rangeY * 0.5, ext * 0.5]
      );
    else
      options.bounding = BBox.fromCenterHalfsize(
        [(minmaxX[0] + minmaxX[1]) * 0.5, (minmaxY[0] + minmaxY[1]) * 0.5, 0],
        [rangeX * 0.5, rangeY * 0.5, 0]
      );
  }

  options.info = { groups: groups };

  return Mesh.load({ vertices: vertices, coords: uvs, normals: normals, triangles: indices }, options, null, gl);

  function swap(v: number[], pos: number): void {
    const tmp = v[pos + 1];
    v[pos + 1] = v[pos + 2];
    v[pos + 2] = -tmp;
  }
};
