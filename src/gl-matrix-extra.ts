/* this file adds some extra functions to gl-matrix library */
// NOTE: glMatrix (vec2/vec3/vec4/mat3/mat4/quat) is an ambient global in this build
// (see globals.d.ts). This module has no exports; it only installs extra static
// methods/constants onto those namespaces and onto Math (pure side-effect module).

Math.clamp = function (v: number, a: number, b: number): number { return (a > v ? a : (b < v ? b : v)); };
Math.lerp = function (a: number, b: number, f: number): number { return a * (1 - f) + b * f; };
Math.lerp01 = function (a: number, b: number, f: number): number { return Math.clamp(a * (1 - f) + b * f, 0, 1); };
Math.iLerp = function (a: number, b: number, v: number): number { return (v - a) / (b - a); };
Math.remap = function (v: number, min: number, max: number, min2: number, max2: number): number { return Math.lerp(min2, max2, Math.iLerp(min, max, v)); };

vec3.ZERO = vec3.fromValues(0, 0, 0);
vec3.FRONT = vec3.fromValues(0, 0, -1);
vec3.UP = vec3.fromValues(0, 1, 0);
vec3.RIGHT = vec3.fromValues(1, 0, 0);

vec2.rotate = function (out: Float32Array, vec: NumberArray, angle_in_rad: number): Float32Array {
	const x = vec[0], y = vec[1];
	const cos = Math.cos(angle_in_rad);
	const sin = Math.sin(angle_in_rad);
	out[0] = x * cos - y * sin;
	out[1] = x * sin + y * cos;
	return out;
};

//for signed angles
vec2.perpdot = function (a: NumberArray, b: NumberArray): number {
	return a[1] * b[0] + -a[0] * b[1];
};

vec2.computeSignedAngle = function (a: NumberArray, b: NumberArray): number {
	return Math.atan2(vec2.perpdot(a, b), vec2.dot(a, b));
};

vec2.random = function (vec: Float32Array, scale?: number): Float32Array {
	scale = scale || 1.0;
	vec[0] = Math.random() * scale;
	vec[1] = Math.random() * scale;
	return vec;
};

vec3.zero = function (a: Float32Array): Float32Array {
	a[0] = a[1] = a[2] = 0.0;
	return a;
};

vec3.minValue = function (a: NumberArray): number {
	if (a[0] < a[1] && a[0] < a[2]) return a[0];
	if (a[1] < a[2]) return a[1];
	return a[2];
};

vec3.maxValue = function (a: NumberArray): number {
	if (a[0] > a[1] && a[0] > a[2]) return a[0];
	if (a[1] > a[2]) return a[1];
	return a[2];
};

vec3.addValue = function (out: Float32Array, a: NumberArray, v: number): void {
	out[0] = a[0] + v;
	out[1] = a[1] + v;
	out[2] = a[2] + v;
};

vec3.subValue = function (out: Float32Array, a: NumberArray, v: number): void {
	out[0] = a[0] - v;
	out[1] = a[1] - v;
	out[2] = a[2] - v;
};

vec3.toArray = function (vec: NumberArray): number[] {
	return [vec[0], vec[1], vec[2]];
};

vec3.rotateX = function (out: Float32Array, vec: NumberArray, angle_in_rad: number): Float32Array {
	const y = vec[1], z = vec[2];
	const cos = Math.cos(angle_in_rad);
	const sin = Math.sin(angle_in_rad);

	out[0] = vec[0];
	out[1] = y * cos - z * sin;
	out[2] = y * sin + z * cos;
	return out;
};

vec3.rotateY = function (out: Float32Array, vec: NumberArray, angle_in_rad: number): Float32Array {
	const x = vec[0], z = vec[2];
	const cos = Math.cos(angle_in_rad);
	const sin = Math.sin(angle_in_rad);

	out[0] = x * cos - z * sin;
	out[1] = vec[1];
	out[2] = x * sin + z * cos;
	return out;
};

vec3.rotateZ = function (out: Float32Array, vec: NumberArray, angle_in_rad: number): Float32Array {
	const x = vec[0], y = vec[1];
	const cos = Math.cos(angle_in_rad);
	const sin = Math.sin(angle_in_rad);

	out[0] = x * cos - y * sin;
	out[1] = x * sin + y * cos;
	out[2] = vec[2];
	return out;
};

vec3.angle = function (a: NumberArray, b: NumberArray): number {
	return Math.acos(vec3.dot(a, b));
};

vec3.signedAngle = function (from: NumberArray, to: NumberArray, axis: NumberArray): number {
	const unsignedAngle = vec3.angle(from, to);
	const cross_x = from[1] * to[2] - from[2] * to[1];
	const cross_y = from[2] * to[0] - from[0] * to[2];
	const cross_z = from[0] * to[1] - from[1] * to[0];
	const sign = Math.sign(axis[0] * cross_x + axis[1] * cross_y + axis[2] * cross_z);
	return unsignedAngle * sign;
};

vec3.random = function (vec: Float32Array, scale?: number): Float32Array {
	scale = scale || 1.0;
	vec[0] = Math.random() * scale;
	vec[1] = Math.random() * scale;
	vec[2] = Math.random() * scale;
	return vec;
};

/**
* converts from cartesian to polar
* @method cartesianToPolar
* @param {vec3} out
* @param {vec3} v
* @return {vec3} returns [radius,inclination,azimuth]
*/
vec3.cartesianToPolar = function (out: Float32Array | null, v: NumberArray): Float32Array {
	out = out || vec3.create();
	const x = v[0];
	const y = v[1];
	const z = v[2];
	out[0] = Math.sqrt(x * x + y * y + z * z); //radius
	out[1] = Math.asin(y / out[0]); //inclination
	out[2] = Math.atan2(x, z); //azimuth
	return out;
};

/**
* converts from polar to cartesian
* @method polarToCartesian
* @param {vec3} out
* @param {vec3} v [r,lat,long] or [radius,inclination,azimuth]
* @return {vec3} returns out
*/
vec3.polarToCartesian = function (out: Float32Array, v: NumberArray): Float32Array {
	const r = v[0];
	const lat = v[1];
	const lon = v[2];
	out[0] = r * Math.cos(lat) * Math.sin(lon);
	out[1] = r * Math.sin(lat);
	out[2] = r * Math.cos(lat) * Math.cos(lon);
	return out;
};

/**
* reflects a vector over a normal
* @method reflect
* @param {vec3} out
* @param {vec3} v
* @param {vec3} n
* @return {vec3} reflected vector
*/
vec3.reflect = function (out: Float32Array, v: NumberArray, n: NumberArray): Float32Array {
	const x = v[0]; const y = v[1]; const z = v[2];
	vec3.scale(out, n, -2 * vec3.dot(v, n));
	out[0] += x;
	out[1] += y;
	out[2] += z;
	return out;
};

/* VEC4 */
vec4.random = function (vec: Float32Array, scale?: number): Float32Array {
	scale = scale || 1.0;
	vec[0] = Math.random() * scale;
	vec[1] = Math.random() * scale;
	vec[2] = Math.random() * scale;
	vec[3] = Math.random() * scale;
	return vec;
};

vec4.toArray = function (vec: NumberArray): number[] {
	return [vec[0], vec[1], vec[2], vec[3]];
};


/** MATRIX ********************/
mat3.IDENTITY = mat3.create();
mat4.IDENTITY = mat4.create();

mat4.toArray = function (mat: NumberArray): number[] {
	return [mat[0], mat[1], mat[2], mat[3], mat[4], mat[5], mat[6], mat[7], mat[8], mat[9], mat[10], mat[11], mat[12], mat[13], mat[14], mat[15]];
};

mat4.setUpAndOrthonormalize = function (out: Float32Array, m: Float32Array, up: NumberArray): void {
	if (m != out)
		mat4.copy(out, m);
	const right = out.subarray(0, 3);
	vec3.normalize(out.subarray(4, 7), up);
	const front = out.subarray(8, 11);
	vec3.cross(right, up, front);
	vec3.normalize(right, right);
	vec3.cross(front, right, up);
	vec3.normalize(front, front);
};

mat4.multiplyVec3 = function (out: Float32Array, m: NumberArray, a: NumberArray): Float32Array {
	const x = a[0], y = a[1], z = a[2];
	out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
	out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
	out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
	return out;
};

//from https://github.com/hughsk/from-3d-to-2d/blob/master/index.js
//m should be a projection matrix (or a VP or MVP)
//projects vector from 3D to 2D and returns the value in normalized screen space
mat4.projectVec3 = function (out: Float32Array, m: NumberArray, a: NumberArray): Float32Array {
	const ix = a[0];
	const iy = a[1];
	const iz = a[2];

	const ox = m[0] * ix + m[4] * iy + m[8] * iz + m[12];
	const oy = m[1] * ix + m[5] * iy + m[9] * iz + m[13];
	const oz = m[2] * ix + m[6] * iy + m[10] * iz + m[14];
	const ow = m[3] * ix + m[7] * iy + m[11] * iz + m[15];

	out[0] = (ox / ow + 1) / 2;
	out[1] = (oy / ow + 1) / 2;
	out[2] = (oz / ow + 1) / 2;
	return out;
};


//from https://github.com/hughsk/from-3d-to-2d/blob/master/index.js
vec3.project = function (out: Float32Array, vec: NumberArray, mvp: NumberArray, viewport?: NumberArray): Float32Array {
	viewport = viewport || globalThis.gl.viewport_data;

	const m = mvp;

	const ix = vec[0];
	const iy = vec[1];
	const iz = vec[2];

	const ox = m[0] * ix + m[4] * iy + m[8] * iz + m[12];
	const oy = m[1] * ix + m[5] * iy + m[9] * iz + m[13];
	const oz = m[2] * ix + m[6] * iy + m[10] * iz + m[14];
	const ow = m[3] * ix + m[7] * iy + m[11] * iz + m[15];

	const projx =     (ox / ow + 1) / 2;
	const projy = 1 - (oy / ow + 1) / 2;
	const projz =     (oz / ow + 1) / 2;

	out[0] = projx * viewport[2] + viewport[0];
	out[1] = projy * viewport[3] + viewport[1];
	out[2] = projz; //ow
	return out;
};

const unprojectMat = mat4.create();
const unprojectVec = vec4.create();

vec3.unproject = function (out: Float32Array, vec: NumberArray, viewprojection: NumberArray, viewport: NumberArray): Float32Array | null {

	const m = unprojectMat;
	const v = unprojectVec;

	v[0] = (vec[0] - viewport[0]) * 2.0 / viewport[2] - 1.0;
	v[1] = (vec[1] - viewport[1]) * 2.0 / viewport[3] - 1.0;
	v[2] = 2.0 * vec[2] - 1.0;
	v[3] = 1.0;

	if (!mat4.invert(m, viewprojection))
		return null;

	vec4.transformMat4(v, v, m);
	if (v[3] === 0.0)
		return null;

	out[0] = v[0] / v[3];
	out[1] = v[1] / v[3];
	out[2] = v[2] / v[3];

	return out;
};

//without translation
mat4.rotateVec3 = function (out: Float32Array, m: NumberArray, a: NumberArray): Float32Array {
	const x = a[0], y = a[1], z = a[2];
	out[0] = m[0] * x + m[4] * y + m[8] * z;
	out[1] = m[1] * x + m[5] * y + m[9] * z;
	out[2] = m[2] * x + m[6] * y + m[10] * z;
	return out;
};

mat4.fromTranslationFrontTop = function (out: Float32Array, pos: NumberArray, front: NumberArray, top: NumberArray): Float32Array {
	vec3.cross(out.subarray(0, 3), front, top);
	out.set(top, 4);
	out.set(front, 8);
	out.set(pos, 12);
	return out;
};


mat4.translationMatrix = function (v: NumberArray): Float32Array {
	const out = mat4.create();
	out[12] = v[0];
	out[13] = v[1];
	out[14] = v[2];
	return out;
};

mat4.setTranslation = function (out: Float32Array, v: NumberArray): Float32Array {
	out[12] = v[0];
	out[13] = v[1];
	out[14] = v[2];
	return out;
};


mat4.getTranslation = function (out: Float32Array, matrix: NumberArray): Float32Array {
	out[0] = matrix[12];
	out[1] = matrix[13];
	out[2] = matrix[14];
	return out;
};

//returns the matrix without rotation
mat4.toRotationMat4 = function (out: Float32Array, mat: NumberArray): Float32Array {
	mat4.copy(out, mat);
	out[12] = out[13] = out[14] = 0.0;
	return out;
};

mat4.swapRows = function (out: Float32Array, mat: Float32Array, row: number, row2: number): Float32Array {
	if (out != mat) {
		mat4.copy(out, mat);
		out[4 * row] = mat[4 * row2];
		out[4 * row + 1] = mat[4 * row2 + 1];
		out[4 * row + 2] = mat[4 * row2 + 2];
		out[4 * row + 3] = mat[4 * row2 + 3];
		out[4 * row2] = mat[4 * row];
		out[4 * row2 + 1] = mat[4 * row + 1];
		out[4 * row2 + 2] = mat[4 * row + 2];
		out[4 * row2 + 3] = mat[4 * row + 3];
		return out;
	}

	// NOTE: original referenced an undeclared `matrix` here; it is the same array as `mat` (out==mat branch).
	const temp = new Float32Array(mat.subarray(row * 4, row * 5));
	mat.set(mat.subarray(row2 * 4, row2 * 5), row * 4);
	mat.set(temp, row2 * 4);
	return out;
};

//used in skinning
mat4.scaleAndAdd = function (out: Float32Array, mat: NumberArray, mat2: NumberArray, v: number): Float32Array {
	out[0] = mat[0] + mat2[0] * v; 	out[1] = mat[1] + mat2[1] * v; 	out[2] = mat[2] + mat2[2] * v; 	out[3] = mat[3] + mat2[3] * v;
	out[4] = mat[4] + mat2[4] * v; 	out[5] = mat[5] + mat2[5] * v; 	out[6] = mat[6] + mat2[6] * v; 	out[7] = mat[7] + mat2[7] * v;
	out[8] = mat[8] + mat2[8] * v; 	out[9] = mat[9] + mat2[9] * v; 	out[10] = mat[10] + mat2[10] * v; 	out[11] = mat[11] + mat2[11] * v;
	out[12] = mat[12] + mat2[12] * v;  out[13] = mat[13] + mat2[13] * v; 	out[14] = mat[14] + mat2[14] * v; 	out[15] = mat[15] + mat2[15] * v;
	return out;
};

quat.fromAxisAngle = function (axis: NumberArray, rad: number): Float32Array {
	const out = quat.create();
	rad = rad * 0.5;
	const s = Math.sin(rad);
	out[0] = s * axis[0];
	out[1] = s * axis[1];
	out[2] = s * axis[2];
	out[3] = Math.cos(rad);
	return out;
};

//from https://answers.unity.com/questions/467614/what-is-the-source-code-of-quaternionlookrotation.html
quat.lookRotation = (function () {
	const vector = vec3.create();
	const vector2 = vec3.create();
	const vector3 = vec3.create();

	return function (q: Float32Array, front: NumberArray, up: NumberArray): Float32Array {
		vec3.normalize(vector, front);
		vec3.cross(vector2, up, vector);
		vec3.normalize(vector2, vector2);
		vec3.cross(vector3, vector, vector2);

		const m00 = vector2[0];
		const m01 = vector2[1];
		const m02 = vector2[2];
		const m10 = vector3[0];
		const m11 = vector3[1];
		const m12 = vector3[2];
		const m20 = vector[0];
		const m21 = vector[1];
		const m22 = vector[2];

		const num8 = (m00 + m11) + m22;

		if (num8 > 0) {
			let num = Math.sqrt(num8 + 1);
			q[3] = num * 0.5;
			num = 0.5 / num;
			q[0] = (m12 - m21) * num;
			q[1] = (m20 - m02) * num;
			q[2] = (m01 - m10) * num;
			return q;
		}
		if ((m00 >= m11) && (m00 >= m22)) {
			const num7 = Math.sqrt(((1 + m00) - m11) - m22);
			const num4 = 0.5 / num7;
			q[0] = 0.5 * num7;
			q[1] = (m01 + m10) * num4;
			q[2] = (m02 + m20) * num4;
			q[3] = (m12 - m21) * num4;
			return q;
		}
		if (m11 > m22) {
			const num6 = Math.sqrt(((1 + m11) - m00) - m22);
			const num3 = 0.5 / num6;
			q[0] = (m10 + m01) * num3;
			q[1] = 0.5 * num6;
			q[2] = (m21 + m12) * num3;
			q[3] = (m20 - m02) * num3;
			return q;
		}
		const num5 = Math.sqrt(((1 + m22) - m00) - m11);
		const num2 = 0.5 / num5;
		q[0] = (m20 + m02) * num2;
		q[1] = (m21 + m12) * num2;
		q[2] = 0.5 * num5;
		q[3] = (m01 - m10) * num2;
		return q;
	};
})();

/*
quat.toEuler = function(out, quat) {
	var q = quat;
	var heading, attitude, bank;

	if( (q[0]*q[1] + q[2]*q[3]) == 0.5 )
	{
		heading = 2 * Math.atan2(q[0],q[3]);
		bank = 0;
		attitude = 0; //�?
	}
	else if( (q[0]*q[1] + q[2]*q[3]) == 0.5 )
	{
		heading = -2 * Math.atan2(q[0],q[3]);
		bank = 0;
		attitude = 0; //�?
	}
	else
	{
		heading = Math.atan2( 2*(q[1]*q[3] - q[0]*q[2]) , 1 - 2 * (q[1]*q[1] - q[2]*q[2]) );
		attitude = Math.asin( 2*(q[0]*q[1] - q[2]*q[3]) );
		bank = Math.atan2( 2*(q[0]*q[3] - q[1]*q[2]), 1 - 2*(q[0]*q[0] - q[2]*q[2]) );
	}

	if(!out)
		out = vec3.create();
	vec3.set(out, heading, attitude, bank);
	return out;
}
*/

/*
//FROM https://en.wikipedia.org/wiki/Conversion_between_quaternions_and_Euler_angles
//doesnt work well
quat.toEuler = function(out, q)
{
    var yaw = Math.atan2(2*q[0]*q[3] + 2*q[1]*q[2], 1 - 2*q[2]*q[2] - 2*q[3]*q[3]);
    var pitch = Math.asin(2*q[0]*q[2] - 2*q[3]*q[1]);
    var roll = Math.atan2(2*q[0]*q[1] + 2*q[2]*q[3], 1 - 2*q[1]*q[1] - 2*q[2]*q[2]);
	if(!out)
		out = vec3.create();
	vec3.set(out, yaw, pitch, roll);
	return out;
}

quat.fromEuler = function(out, vec) {
	var yaw = vec[0];
	var pitch = vec[1];
	var roll = vec[2];

	var C1 = Math.cos(yaw*0.5);
	var C2 = Math.cos(pitch*0.5);
	var C3 = Math.cos(roll*0.5);
	var S1 = Math.sin(yaw*0.5);
	var S2 = Math.sin(pitch*0.5);
	var S3 = Math.sin(roll*0.5);

	var x = C1*C2*C3 + S1*S2*S3;
	var y = S1*C2*C3 - C1*S2*S3;
	var z = C1*S2*C3 + S1*C2*S3;
	var w = C1*C2*S3 - S1*S2*C3;

	quat.set(out, x,y,z,w );
	quat.normalize(out,out); //necessary?
	return out;
}
*/

quat.toEuler = function (out: Float32Array | null, q: NumberArray): Float32Array {
	const heading = Math.atan2(2 * q[1] * q[3] - 2 * q[0] * q[2], 1 - 2 * q[1] * q[1] - 2 * q[2] * q[2]);
	const attitude = Math.asin(2 * q[0] * q[1] + 2 * q[2] * q[3]);
	const bank = Math.atan2(2 * q[0] * q[3] - 2 * q[1] * q[2], 1 - 2 * q[0] * q[0] - 2 * q[2] * q[2]);
	if (!out)
		out = vec3.create();
	vec3.set(out, heading, attitude, bank);
	return out;
};

quat.fromEuler = function (out: Float32Array, vec: NumberArray): Float32Array {
	const heading = vec[0];
	const attitude = vec[1];
	const bank = vec[2];

	const C1 = Math.cos(heading); //yaw
	const C2 = Math.cos(attitude); //pitch
	const C3 = Math.cos(bank); //roll
	const S1 = Math.sin(heading);
	const S2 = Math.sin(attitude);
	const S3 = Math.sin(bank);

	let w = Math.sqrt(1.0 + C1 * C2 + C1 * C3 - S1 * S2 * S3 + C2 * C3) * 0.5;
	if (w == 0.0) {
		w = 0.000001;
		//quat.set(out, 0,0,0,1 );
		//return out;
	}

	const x = (C2 * S3 + C1 * S3 + S1 * S2 * C3) / (4.0 * w);
	const y = (S1 * C2 + S1 * C3 + C1 * S2 * S3) / (4.0 * w);
	const z = (-S1 * S3 + C1 * S2 * C3 + S2) / (4.0 * w);
	quat.set(out, x, y, z, w);
	quat.normalize(out, out);
	return out;
};


//not tested, it gives weird results sometimes
quat.fromMat4 = function (out: Float32Array, m: NumberArray): void {
	const trace = m[0] + m[5] + m[10];
	if (trace > 0.0) {
		const s = Math.sqrt(trace + 1.0);
		out[3] = s * 0.5;//w
		const recip = 0.5 / s;
		out[0] = (m[9] - m[6]) * recip; //2,1  1,2
		out[1] = (m[8] - m[2]) * recip; //0,2  2,0
		out[2] = (m[4] - m[1]) * recip; //1,0  0,1
	}
	else {
		let i = 0;
		if (m[5] > m[0])
			i = 1;
		if (m[10] > m[i * 4 + i])
			i = 2;
		const j = (i + 1) % 3;
		const k = (j + 1) % 3;
		const s = Math.sqrt(m[i * 4 + i] - m[j * 4 + j] - m[k * 4 + k] + 1.0);
		out[i] = 0.5 * s;
		const recip = 0.5 / s;
		out[3] = (m[k * 4 + j] - m[j * 4 + k]) * recip;//w
		out[j] = (m[j * 4 + i] + m[i * 4 + j]) * recip;
		out[k] = (m[k * 4 + i] + m[i * 4 + k]) * recip;
	}
	quat.normalize(out, out);
};

//col according to common matrix notation, here are stored as rows
vec3.getMat3Column = function (out: Float32Array, m: NumberArray, index: number): Float32Array {
	out[0] = m[index * 3];
	out[1] = m[index * 3 + 1];
	out[2] = m[index * 3 + 2];
	return out;
};

mat3.setColumn = function (out: Float32Array, v: NumberArray, index: number): Float32Array {
	out[index * 3] = v[0];
	out[index * 3 + 1] = v[1];
	out[index * 3 + 2] = v[2];
	return out;
};


//http://matthias-mueller-fischer.ch/publications/stablePolarDecomp.pdf
//reusing the previous quaternion as an indicator to keep perpendicularity
quat.fromMat3AndQuat = (function () {
	const temp_mat3 = mat3.create();
	const temp_quat = quat.create();
	const Rcol0 = vec3.create();
	const Rcol1 = vec3.create();
	const Rcol2 = vec3.create();
	const Acol0 = vec3.create();
	const Acol1 = vec3.create();
	const Acol2 = vec3.create();
	const RAcross0 = vec3.create();
	const RAcross1 = vec3.create();
	const RAcross2 = vec3.create();
	const omega = vec3.create();

	return function (q: Float32Array, A: NumberArray, max_iter?: number): Float32Array {
		max_iter = max_iter || 25;
		for (let iter = 0; iter < max_iter; ++iter) {
			const R = mat3.fromQuat(temp_mat3, q);
			vec3.getMat3Column(Rcol0, R, 0);
			vec3.getMat3Column(Rcol1, R, 1);
			vec3.getMat3Column(Rcol2, R, 2);
			vec3.getMat3Column(Acol0, A, 0);
			vec3.getMat3Column(Acol1, A, 1);
			vec3.getMat3Column(Acol2, A, 2);
			vec3.cross(RAcross0, Rcol0, Acol0);
			vec3.cross(RAcross1, Rcol1, Acol1);
			vec3.cross(RAcross2, Rcol2, Acol2);
			vec3.add(omega, RAcross0, RAcross1);
			vec3.add(omega, omega, RAcross2);
			const d = 1.0 / Math.abs(vec3.dot(Rcol0, Acol0) + vec3.dot(Rcol1, Acol1) + vec3.dot(Rcol2, Acol2)) + 1.0e-9;
			vec3.scale(omega, omega, d);
			const w = vec3.length(omega);
			if (w < 1.0e-9)
				break;
			vec3.scale(omega, omega, 1 / w); //normalize
			quat.setAxisAngle(temp_quat, omega, w);
			quat.mul(q, temp_quat, q);
			quat.normalize(q, q);
		}
		return q;
	};
})();

//http://number-none.com/product/IK%20with%20Quaternion%20Joint%20Limits/
quat.rotateToFrom = (function () {
	const tmp = vec3.create();
	return function (out: Float32Array | null, v1: NumberArray, v2: NumberArray): Float32Array {
		out = out || quat.create();
		const axis = vec3.cross(tmp, v1, v2);
		const dot = vec3.dot(v1, v2);
		if (dot < -1 + 0.01) {
			out[0] = 0;
			out[1] = 1;
			out[2] = 0;
			out[3] = 0;
			return out;
		}
		out[0] = axis[0] * 0.5;
		out[1] = axis[1] * 0.5;
		out[2] = axis[2] * 0.5;
		out[3] = (1 + dot) * 0.5;
		quat.normalize(out, out);
		return out;
	};
})();

quat.lookAt = (function () {
	const axis = vec3.create();

	return function (out: Float32Array, forwardVector: NumberArray, up: NumberArray): Float32Array {
		const dot = vec3.dot(vec3.FRONT, forwardVector);

		if (Math.abs(dot - (-1.0)) < 0.000001) {
			out.set(vec3.UP);
			out[3] = Math.PI;
			return out;
		}
		if (Math.abs(dot - 1.0) < 0.000001) {
			return quat.identity(out);
		}

		const rotAngle = Math.acos(dot);
		vec3.cross(axis, vec3.FRONT, forwardVector);
		vec3.normalize(axis, axis);
		quat.setAxisAngle(out, axis, rotAngle);
		return out;
	};
})();
