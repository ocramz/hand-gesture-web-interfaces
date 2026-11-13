// A minimal 3D vector: a structural {x, y, z}, so three.js's Vector3 (or any other vector class with x, y,
// z fields) can be passed wherever the library takes or fills a Vec3. Helpers write into `out` and return it.

export interface Vec3 {
  x: number
  y: number
  z: number
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })

export function setVec3<T extends Vec3>(out: T, x: number, y: number, z: number): T {
  out.x = x
  out.y = y
  out.z = z
  return out
}

export const copyVec3 = <T extends Vec3>(out: T, a: Vec3): T => setVec3(out, a.x, a.y, a.z)
export const subVec3 = <T extends Vec3>(out: T, a: Vec3, b: Vec3): T => setVec3(out, a.x - b.x, a.y - b.y, a.z - b.z)
export const scaleVec3 = <T extends Vec3>(out: T, a: Vec3, s: number): T => setVec3(out, a.x * s, a.y * s, a.z * s)
/** out = a + b·s */
export const addScaledVec3 = <T extends Vec3>(out: T, a: Vec3, b: Vec3, s: number): T =>
  setVec3(out, a.x + b.x * s, a.y + b.y * s, a.z + b.z * s)
export const dotVec3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const crossVec3 = <T extends Vec3>(out: T, a: Vec3, b: Vec3): T =>
  setVec3(out, a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
export const lengthSqVec3 = (a: Vec3): number => dotVec3(a, a)
export const lengthVec3 = (a: Vec3): number => Math.sqrt(dotVec3(a, a))
export const distanceVec3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

/** out = a / |a| (a zero vector stays zero). */
export function normalizeVec3<T extends Vec3>(out: T, a: Vec3): T {
  const len = lengthVec3(a)
  return scaleVec3(out, a, len > 0 ? 1 / len : 0)
}
