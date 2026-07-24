// Provides a convenient raytracing interface.

import { geo } from "./geo";

// ### new GL.HitTest([t, hit, normal])
//
// This is the object used to return hit test results. If there are no
// arguments, the constructed argument represents a hit infinitely far
// away.
export class HitTest {
  t: number;
  hit: Float32Array | null;
  normal: Float32Array | null;
  face: Float32Array | null;
  index: number | undefined;
  pos?: Float32Array;

  constructor(t?: number, hit?: Float32Array | null, normal?: Float32Array | null, index?: number) {
    this.t = t === undefined ? Number.MAX_VALUE : t;
    this.hit = hit ?? null;
    this.normal = normal ?? null;
    this.face = null;
    this.index = index;
  }

  // ### .mergeWith(other)
  //
  // Changes this object to be the closer of the two hit test results.
  mergeWith(other: HitTest): void {
    if (other.t > 0 && other.t < this.t) {
      this.t = other.t;
      this.hit = other.hit;
      this.normal = other.normal;
      this.face = other.face;
      this.index = other.index;
    }
  }
}

// ### new GL.Ray( origin, direction )
export class Ray {
  origin: Float32Array;
  direction: Float32Array;
  collision_point: Float32Array;
  t: number;

  constructor(origin?: NumberArray, direction?: NumberArray) {
    this.origin = vec3.create();
    this.direction = vec3.create();
    this.collision_point = vec3.create();
    this.t = -1;

    if (origin)
      this.origin.set(origin);
    if (direction)
      this.direction.set(direction);
  }

  testPlane(P: Vec3Like, N: Vec3Like): boolean {
    const r = geo.testRayPlane(this.origin, this.direction, P, N, this.collision_point);
    this.t = geo.last_t;
    return r;
  }

  testSphere(center: Vec3Like, radius: number, max_dist?: number): boolean {
    const r = geo.testRaySphere(this.origin, this.direction, center, radius, this.collision_point, max_dist);
    this.t = geo.last_t;
    return r;
  }

  //box must be in BBox format, check BBox class
  testBBox(bbox: Float32Array, max_dist?: number, model?: Mat4, in_local?: boolean): boolean {
    const r = geo.testRayBBox(this.origin, this.direction, bbox, model, this.collision_point, max_dist, in_local);
    this.t = geo.last_t;
    return r;
  }
}

// reused scratch used by getRayForPixel (was a closure IIFE in the original)
const _getRayForPixel_ray0: Float32Array = vec3.create();
const _getRayForPixel_ray1: Float32Array = vec3.create();

// reused scratch used by hitTestBox
const _hittest_inv: Float32Array = mat4.create();

// ### new GL.Raytracer()
//
// This will read the current modelview matrix, projection matrix, and viewport,
// reconstruct the eye position, and store enough information to later generate
// per-pixel rays using `getRayForPixel()`.
//
// Example usage:
//
//     var tracer = new GL.Raytracer();
//     var ray = tracer.getRayForPixel(
//       gl.canvas.width / 2,
//       gl.canvas.height / 2);
//       var result = GL.Raytracer.hitTestSphere(
//       tracer.eye, ray, new GL.Vector(0, 0, 0), 1);
export class Raytracer {
  viewport: Float32Array;
  ray00: Float32Array;
  ray10: Float32Array;
  ray01: Float32Array;
  ray11: Float32Array;
  eye: Float32Array;

  constructor(viewprojection_matrix: NumberArray, viewport?: NumberArray) {
    this.viewport = vec4.create();
    this.ray00 = vec3.create();
    this.ray10 = vec3.create();
    this.ray01 = vec3.create();
    this.ray11 = vec3.create();
    this.eye = vec3.create();
    this.setup(viewprojection_matrix, viewport);
  }

  setup(viewprojection_matrix: NumberArray, viewport?: NumberArray): void {
    const vp: NumberArray = viewport || gl.viewport_data;
    this.viewport.set(vp);

    const minX = vp[0], maxX = minX + vp[2];
    const minY = vp[1], maxY = minY + vp[3];

    vec3.set(this.ray00, minX, minY, 1);
    vec3.set(this.ray10, maxX, minY, 1);
    vec3.set(this.ray01, minX, maxY, 1);
    vec3.set(this.ray11, maxX, maxY, 1);
    vec3.unproject(this.ray00, this.ray00, viewprojection_matrix, vp);
    vec3.unproject(this.ray10, this.ray10, viewprojection_matrix, vp);
    vec3.unproject(this.ray01, this.ray01, viewprojection_matrix, vp);
    vec3.unproject(this.ray11, this.ray11, viewprojection_matrix, vp);
    const eye = this.eye;
    vec3.unproject(eye, eye, viewprojection_matrix, vp);
    vec3.subtract(this.ray00, this.ray00, eye);
    vec3.subtract(this.ray10, this.ray10, eye);
    vec3.subtract(this.ray01, this.ray01, eye);
    vec3.subtract(this.ray11, this.ray11, eye);
  }

  // ### .getRayForPixel(x, y)
  //
  // Returns the ray direction originating from the camera and traveling through the pixel `x, y`.
  getRayForPixel(x: number, y: number, out?: Float32Array): Float32Array {
    out = out || vec3.create();
    x = (x - this.viewport[0]) / this.viewport[2];
    y = 1 - (y - this.viewport[1]) / this.viewport[3];
    vec3.lerp(_getRayForPixel_ray0, this.ray00, this.ray10, x);
    vec3.lerp(_getRayForPixel_ray1, this.ray01, this.ray11, x);
    vec3.lerp(out, _getRayForPixel_ray0, _getRayForPixel_ray1, y);
    return vec3.normalize(out, out);
  }

  // ### GL.Raytracer.hitTestBox(origin, ray, min, max)
  //
  // Traces the ray starting from `origin` along `ray` against the axis-aligned box
  // whose coordinates extend from `min` to `max`. Returns a `HitTest` with the
  // information or `null` for no intersection.
  //
  // This implementation uses the [slab intersection method](http://www.siggraph.org/education/materials/HyperGraph/raytrace/rtinter3.htm).
  static hitTestBox(origin: NumberArray, ray: NumberArray, min: NumberArray, max: NumberArray, model?: NumberArray): HitTest | null {
    const _hittest_v3 = new Float32Array(10 * 3); //reuse memory to speedup

    if (model) {
      const inv = mat4.invert(_hittest_inv, model) || _hittest_inv;
      origin = mat4.multiplyVec3(_hittest_v3.subarray(3, 6), inv, origin);
      ray = mat4.rotateVec3(_hittest_v3.subarray(6, 9), inv, ray);
    }

    const tMin = vec3.subtract(_hittest_v3.subarray(9, 12), min, origin);
    vec3.divide(tMin, tMin, ray);

    const tMax = vec3.subtract(_hittest_v3.subarray(12, 15), max, origin);
    vec3.divide(tMax, tMax, ray);

    const t1 = vec3.min(_hittest_v3.subarray(15, 18), tMin, tMax);
    const t2 = vec3.max(_hittest_v3.subarray(18, 21), tMin, tMax);

    const tNear = vec3.maxValue(t1);
    const tFar = vec3.minValue(t2);

    if (tNear > 0 && tNear <= tFar) {
      const epsilon = 1.0e-6;
      const hit = vec3.scale(_hittest_v3.subarray(21, 24), ray, tNear);
      vec3.add(hit, origin, hit);

      vec3.addValue(_hittest_v3.subarray(24, 27), min, epsilon);
      vec3.subValue(_hittest_v3.subarray(27, 30), max, epsilon);

      return new HitTest(tNear, hit, vec3.fromValues(
        Number(hit[0] > max[0]) - Number(hit[0] < min[0]),
        Number(hit[1] > max[1]) - Number(hit[1] < min[1]),
        Number(hit[2] > max[2]) - Number(hit[2] < min[2])
      ));
    }

    return null;
  }

  // ### GL.Raytracer.hitTestSphere(origin, ray, center, radius)
  //
  // Traces the ray starting from `origin` along `ray` against the sphere defined
  // by `center` and `radius`. Returns a `HitTest` with the information or `null`
  // for no intersection.
  static hitTestSphere(origin: NumberArray, ray: NumberArray, center: NumberArray, radius: number): HitTest | null {
    const offset = vec3.subtract(vec3.create(), origin, center);
    const a = vec3.dot(ray, ray);
    const b = 2 * vec3.dot(ray, offset);
    const c = vec3.dot(offset, offset) - radius * radius;
    const discriminant = b * b - 4 * a * c;

    if (discriminant > 0) {
      const t = (-b - Math.sqrt(discriminant)) / (2 * a),
        hit = vec3.add(vec3.create(), origin, vec3.scale(vec3.create(), ray, t));
      return new HitTest(t, hit, vec3.scale(vec3.create(), vec3.subtract(vec3.create(), hit, center), 1.0 / radius));
    }

    return null;
  }

  // ### GL.Raytracer.hitTestTriangle(origin, ray, a, b, c)
  //
  // Traces the ray starting from `origin` along `ray` against the triangle defined
  // by the points `a`, `b`, and `c`. Returns a `HitTest` with the information or
  // `null` for no intersection.
  static hitTestTriangle(origin: NumberArray, ray: NumberArray, a: NumberArray, b: NumberArray, c: NumberArray): HitTest | null {
    const ab = vec3.subtract(vec3.create(), b, a);
    const ac = vec3.subtract(vec3.create(), c, a);
    const normal = vec3.cross(vec3.create(), ab, ac);
    vec3.normalize(normal, normal);
    const t = vec3.dot(normal, vec3.subtract(vec3.create(), a, origin)) / vec3.dot(normal, ray);

    if (t > 0) {
      const hit = vec3.add(vec3.create(), origin, vec3.scale(vec3.create(), ray, t));
      const toHit = vec3.subtract(vec3.create(), hit, a);
      const dot00 = vec3.dot(ac, ac);
      const dot01 = vec3.dot(ac, ab);
      const dot02 = vec3.dot(ac, toHit);
      const dot11 = vec3.dot(ab, ab);
      const dot12 = vec3.dot(ab, toHit);
      const divide = dot00 * dot11 - dot01 * dot01;
      const u = (dot11 * dot02 - dot01 * dot12) / divide;
      const v = (dot00 * dot12 - dot01 * dot02) / divide;
      if (u >= 0 && v >= 0 && u + v <= 1) return new HitTest(t, hit, normal);
    }

    return null;
  }
}
