// Reusable scratch vectors/matrices to avoid per-call allocations. Exposed as GL.temp_* for API
// compatibility. Evaluated after bootstrap.ts has verified glMatrix is present.

export const temp_vec3: Float32Array = vec3.create();
export const temp2_vec3: Float32Array = vec3.create();
export const temp_vec4: Float32Array = vec4.create();
export const temp_quat: Float32Array = quat.create();
export const temp_mat3: Float32Array = mat3.create();
export const temp_mat4: Float32Array = mat4.create();
