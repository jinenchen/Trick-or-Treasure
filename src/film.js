// One low-resolution camera feed per player. The interface stays full resolution.
import * as THREE from 'three';

export class Film {
  constructor(renderer) {
    this.renderer = renderer;
    this.targets = [];
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        feed: { value: null },
        resolution: { value: new THREE.Vector2(1, 1) },
        time: { value: 0 },
        danger: { value: 0 },
        reduced: { value: 0 },
        brightness: { value: 1 },
        shock: { value: 0 },
        blackout: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: `
        uniform sampler2D feed;
        uniform vec2 resolution;
        uniform float time, danger, reduced, brightness, shock, blackout;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float radial = dot(p, p);
          vec2 uv = vUv + p * radial * 0.003 * (1.0 - reduced);
          uv += p * shock * 0.014 * (1.0 - reduced);
          uv = clamp(uv, 0.5 / resolution, 1.0 - 0.5 / resolution);
          vec3 col = texture2D(feed, uv).rgb;
          // Slight lens separation lives at the edge, never on the aim point.
          float bleed = (0.35 + danger * 0.5 + shock * 2.0) * radial * (1.0 - reduced) / resolution.x;
          col.r = texture2D(feed, clamp(uv + vec2(bleed, 0.0), 0.5 / resolution, 1.0 - 0.5 / resolution)).r;
          col *= brightness;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          col = gl_FragColor.rgb;
          float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(lum), col, 0.62);
          // Sick fluorescent shadows, nicotine highlights, restrained black floor.
          col *= mix(vec3(0.86, 0.94, 0.86), vec3(1.05, 1.01, 0.90), smoothstep(0.05, 0.75, lum));
          col = max(vec3(0.0), (col - 0.012) * 1.04);
          float vignette = smoothstep(0.18, 1.8, radial);
          col *= 1.0 - vignette * (0.38 + danger * 0.10);
          float grain = hash(floor(vUv * resolution) + floor(time * 24.0)) - 0.5;
          col += grain * 0.035 * (1.0 - reduced) * (0.45 + sqrt(max(lum, 0.0)));
          // Fine ordered dithering keeps the shadows from looking digitally smooth.
          vec2 pixel = floor(vUv * resolution);
          float dither = mod(pixel.x + mod(pixel.y, 2.0), 2.0) - 0.5;
          col += dither * 0.007 * (1.0 - reduced);
          gl_FragColor = vec4(clamp(col, 0.0, 1.0) * (1.0 - blackout), 1.0);
        }
      `,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  render(scene, camera, { index = 0, x = 0, width, height, time, danger = 0, reduced = false, brightness = 1, shock = 0, blackout = 0 }) {
    const r = this.renderer;
    const scale = Math.min(1, 540 / height, 1000 / width);
    const rw = Math.max(1, Math.round(width * scale));
    const rh = Math.max(1, Math.round(height * scale));
    let target = this.targets[index];
    if (!target) {
      target = this.targets[index] = new THREE.WebGLRenderTarget(rw, rh, {
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
        type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false,
      });
    }
    if (target.width !== rw || target.height !== rh) target.setSize(rw, rh);
    r.setScissorTest(false);
    r.setRenderTarget(target);
    r.setViewport(0, 0, rw, rh);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.setViewport(x, 0, width, height);
    r.setScissor(x, 0, width, height);
    r.setScissorTest(true);
    const u = this.material.uniforms;
    u.feed.value = target.texture;
    u.resolution.value.set(rw, rh);
    u.time.value = time;
    u.danger.value = danger;
    u.reduced.value = reduced ? 1 : 0;
    u.brightness.value = brightness;
    u.shock.value = shock;
    u.blackout.value = blackout;
    r.render(this.scene, this.camera);
  }
}
