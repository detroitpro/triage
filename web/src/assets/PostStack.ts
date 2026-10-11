import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { Biome, BiomePost } from "../../../src/world/types.ts";
import { biomeKind } from "./MaterialLibrary.ts";

/**
 * The finishing pass (charter "Look"): bloom on authored emissive, one colour-grade pass
 * (saturation, contrast, warmth, vignette), then tone mapping and sRGB. Every number comes
 * from the biome; the client only falls back by biome kind for world files built before
 * biomes carried `post`. Also owns the scene's image-based light.
 */
export interface PostOptions {
  /** Bloom resolution as a fraction of the render size: 0.5 on high, 0.25 on low. */
  bloomScale: number;
  /** MSAA samples on the scene target (the canvas's own antialias does not apply here). */
  samples: number;
}

const FALLBACK: Record<string, BiomePost> = {
  meadow: {
    bloom: 0.35,
    bloomThreshold: 1.05,
    saturation: 1.15,
    contrast: 1.06,
    warmth: 0.12,
    vignette: 0.25,
    environment: 0.22,
  },
  plaza: {
    bloom: 0.35,
    bloomThreshold: 1.05,
    saturation: 1.1,
    contrast: 1.05,
    warmth: 0.1,
    vignette: 0.25,
    environment: 0.22,
  },
  village: {
    bloom: 0.45,
    bloomThreshold: 1.02,
    saturation: 1.1,
    contrast: 1.08,
    warmth: 0.18,
    vignette: 0.35,
    environment: 0.18,
  },
  industrial: {
    bloom: 0.55,
    bloomThreshold: 1.0,
    saturation: 0.95,
    contrast: 1.12,
    warmth: -0.08,
    vignette: 0.4,
    environment: 0.12,
  },
  dungeon: {
    bloom: 0.7,
    bloomThreshold: 0.95,
    saturation: 0.9,
    contrast: 1.15,
    warmth: -0.05,
    vignette: 0.55,
    environment: 0.04,
  },
};

export function postFor(biome: Biome): BiomePost {
  return biome.post ?? FALLBACK[biomeKind(biome)] ?? (FALLBACK.meadow as BiomePost);
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSaturation: { value: 1 },
    uContrast: { value: 1 },
    uWarmth: { value: 0 },
    uVignette: { value: 0 },
  },
  vertexShader: `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  // Linear HDR in, linear HDR out: OutputPass tone maps afterwards.
  fragmentShader: `uniform sampler2D tDiffuse;
    uniform float uSaturation, uContrast, uWarmth, uVignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSaturation);
      // Contrast around mid grey in a log-ish space so shadows keep their detail.
      c.rgb = pow(max(c.rgb, 0.0), vec3(uContrast)) * pow(0.18, 1.0 - uContrast);
      c.rgb *= vec3(1.0 + uWarmth * 0.12, 1.0 + uWarmth * 0.02, 1.0 - uWarmth * 0.12);
      float d = distance(vUv, vec2(0.5));
      c.rgb *= mix(1.0, smoothstep(0.85, 0.3, d), uVignette);
      gl_FragColor = c;
    }`,
};

export class PostStack {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private size = new THREE.Vector2();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    camera: THREE.Camera,
    private readonly options: PostOptions,
  ) {
    renderer.getSize(this.size);
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: options.samples,
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(this.bloomSize(), 0.4, 0.3, 0.85);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.setSize(this.size.x, this.size.y);
    // A neutral studio environment so metal, glass, and painted surfaces read as materials.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }

  apply(biome: Biome): void {
    const p = postFor(biome);
    this.bloom.enabled = p.bloom > 0;
    this.bloom.strength = p.bloom;
    this.bloom.threshold = p.bloomThreshold;
    const u = this.grade.uniforms as typeof GradeShader.uniforms;
    u.uSaturation.value = p.saturation;
    u.uContrast.value = p.contrast;
    u.uWarmth.value = p.warmth;
    u.uVignette.value = p.vignette;
    this.scene.environmentIntensity = p.environment;
  }

  /** CSS size of the canvas. */
  setSize(width: number, height: number): void {
    this.size.set(width, height);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
    const b = this.bloomSize();
    this.bloom.setSize(b.x, b.y);
  }

  /** Follow the renderer's pixel ratio (dynamic resolution). */
  syncPixelRatio(): void {
    this.setSize(this.size.x, this.size.y);
  }

  render(): void {
    this.composer.render();
  }

  private bloomSize(): THREE.Vector2 {
    const pr = this.renderer.getPixelRatio() * this.options.bloomScale;
    return new THREE.Vector2(
      Math.max(1, Math.round(this.size.x * pr)),
      Math.max(1, Math.round(this.size.y * pr)),
    );
  }
}
