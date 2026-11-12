// Soap film: thin-film interference (Airy reflectance of a water film in air, integrated over the visible
// spectrum), a swirling thickness field that drains downward and thins before a pop, reflecting a
// procedural studio plus the webcam image. Premultiplied output: the film adds reflected light and dims
// what is behind it by its reflectance.
import { CustomBlending, DoubleSide, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, Vector3, type Texture } from 'three'

/** Uniforms every film shares (by reference). */
export interface SharedFilmUniforms {
  uTime: { value: number }
  uVideo: { value: Texture | null }
  uIntensity: { value: number }
  uSwirl: { value: number }
  uThickness: { value: number }
  uMirror: { value: number }
}

export function sharedFilmUniforms(): SharedFilmUniforms {
  return {
    uTime: { value: 0 },
    uVideo: { value: null },
    uIntensity: { value: 1 },
    uSwirl: { value: 1 },
    uThickness: { value: 1 },
    uMirror: { value: 1 },
  }
}

export type FilmMaterial = ShaderMaterial & {
  uniforms: SharedFilmUniforms & {
    uFade: { value: number }
    uThin: { value: number }
    uCenter: { value: Vector3 }
    uExtent: { value: number }
    uWobble: { value: number }
    uSeed: { value: number }
  }
}

const vertexShader = /* glsl */ `
attribute vec3 aNoise;
uniform float uTime;
uniform float uWobble;
uniform float uSeed;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vNoise;

void main() {
  vec3 p = position;
  if (uWobble > 0.0) {
    float t = uTime + uSeed * 17.0;
    float w = 0.55 * sin(t * 3.1 + aNoise.x * 3.0 + aNoise.y * 1.3)
            + 0.30 * sin(t * 2.3 - aNoise.y * 4.0 + aNoise.z * 2.1)
            + 0.15 * sin(t * 5.3 + aNoise.z * 5.0);
    p += normal * uWobble * w;
  }
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vNoise = aNoise + uSeed * vec3(3.1, 7.7, 1.9);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uSwirl;
uniform float uThickness;
uniform float uFade;
uniform float uThin;
uniform vec3 uCenter;
uniform float uExtent;
uniform float uMirror;
uniform sampler2D uVideo;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vNoise;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s / 0.9375;
}

// Film thickness in nm.
float thickness() {
  float t = uTime * uSwirl;
  vec3 q = vNoise * 1.1;
  vec3 warp = vec3(fbm(q + vec3(0.0, 0.0, 0.11 * t)), fbm(q + vec3(5.2, 1.3, -0.13 * t)), fbm(q + vec3(2.7, 8.1, 0.07 * t)));
  float n = fbm(q + 2.2 * (warp - 0.5) + vec3(0.0, -0.05 * t, 0.0));
  // Gravity drains the film: thin on top, thick at the bottom.
  float drain = clamp(0.5 - 0.5 * (vWorldPos.y - uCenter.y) / max(uExtent, 1e-4), 0.0, 1.0);
  float d = mix(120.0, 720.0, drain * drain * 0.6 + 0.4 * drain);
  d *= 0.45 + 1.1 * n;
  // Just before popping the film turns black: far thinner than the shortest wavelength.
  d *= mix(1.0, 0.06, uThin);
  return d * uThickness;
}

// Wyman, Sloan & Shirley 2013: analytic fit of the CIE 1931 colour matching functions.
float g(float x, float mu, float s1, float s2) {
  float t = (x - mu) / (x < mu ? s1 : s2);
  return exp(-0.5 * t * t);
}
vec3 cie(float l) {
  return vec3(
    1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2),
    0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1),
    1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8));
}
const mat3 XYZ2RGB = mat3(3.2406, -0.9689, 0.0557, -1.5372, 1.8758, -0.2040, -0.4986, 0.0415, 1.0570);

// Reflectance (linear RGB) of a film of thickness d (nm), index 1.33, seen at cos(incidence) = ci.
vec3 interference(float d, float ci) {
  const float n = 1.33;
  float st2 = (1.0 - ci * ci) / (n * n);
  float ct = sqrt(max(0.0, 1.0 - st2));
  // Single-interface reflectance (Schlick, F0 = 0.02).
  float r = 0.02 + 0.98 * pow(1.0 - ci, 5.0);
  vec3 xyz = vec3(0.0);
  vec3 white = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float l = 400.0 + 27.0 * float(i);
    float delta = 12.566371 * n * d * ct / l;
    // Airy sum of a symmetric film: 2R(1 − cos δ) / (1 + R² − 2R cos δ).
    float R = 2.0 * r * (1.0 - cos(delta)) / (1.0 + r * r - 2.0 * r * cos(delta));
    vec3 c = cie(l);
    xyz += R * c;
    white += c;
  }
  vec3 rgb = XYZ2RGB * xyz;
  vec3 w = XYZ2RGB * white;
  return max(rgb / w, 0.0);
}

vec3 environment(vec3 dir) {
  float up = 0.5 + 0.5 * dir.y;
  vec3 col = mix(vec3(0.05, 0.055, 0.07), vec3(0.55, 0.62, 0.75), up * up);
  // Two soft boxes: the window glints that make a bubble read as a bubble.
  col += vec3(5.0, 4.8, 4.5) * smoothstep(0.93, 0.975, dot(dir, normalize(vec3(-0.55, 0.65, 0.55))));
  col += vec3(2.6, 2.8, 3.2) * smoothstep(0.95, 0.99, dot(dir, normalize(vec3(0.7, 0.35, 0.65))));
  // What the camera sees, as if around it: the film reflects the room and you.
  vec2 uv = vec2(mix(dir.x, -dir.x, uMirror), dir.y) * 0.45 + 0.5;
  vec3 video = texture2D(uVideo, clamp(uv, 0.0, 1.0)).rgb;
  return col + video * 0.35;
}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;
  float ci = clamp(dot(N, V), 0.0, 1.0);
  float d = thickness();
  vec3 refl = interference(d, ci);
  vec3 L = environment(reflect(-V, N));
  vec3 col = refl * L * uIntensity * 1.1;
  // A faint rim keeps the outline legible on busy backgrounds.
  col += vec3(0.04) * pow(1.0 - ci, 3.0) * uIntensity;
  float a = clamp(dot(refl, vec3(0.3333)) * 1.2, 0.0, 0.7) * uFade;
  gl_FragColor = vec4(col * uFade, a);
  #include <colorspace_fragment>
}
`

export function createFilmMaterial(shared: SharedFilmUniforms): FilmMaterial {
  const m = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      ...shared,
      uFade: { value: 0 },
      uThin: { value: 0 },
      uCenter: { value: new Vector3() },
      uExtent: { value: 0.1 },
      uWobble: { value: 0 },
      uSeed: { value: Math.random() },
    },
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    premultipliedAlpha: true,
  })
  return m as FilmMaterial
}
