// The webcam frame as a fullscreen, cover-fitted, optionally mirrored background.
import { Mesh, PlaneGeometry, ShaderMaterial, type Texture } from 'three'

export interface Background {
  mesh: Mesh
  setFit(uvScale: [number, number], mirror: boolean): void
  setDim(d: number): void
}

export function createBackground(map: Texture): Background {
  const material = new ShaderMaterial({
    uniforms: { uMap: { value: map }, uScale: { value: [1, 1] }, uMirror: { value: 1 }, uDim: { value: 0.8 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec2 uScale;
      uniform float uMirror;
      uniform float uDim;
      varying vec2 vUv;
      void main() {
        vec2 uv = 0.5 + (vUv - 0.5) * uScale;
        if (uMirror > 0.5) uv.x = 1.0 - uv.x;
        gl_FragColor = vec4(texture2D(uMap, uv).rgb * uDim, 1.0);
        #include <colorspace_fragment>
      }`,
    depthTest: false,
    depthWrite: false,
  })
  const mesh = new Mesh(new PlaneGeometry(2, 2), material)
  mesh.frustumCulled = false
  mesh.renderOrder = -1
  return {
    mesh,
    setFit(uvScale, mirror) {
      material.uniforms.uScale.value = uvScale
      material.uniforms.uMirror.value = mirror ? 1 : 0
    },
    setDim(d) { material.uniforms.uDim.value = d },
  }
}
