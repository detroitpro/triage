import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { POST } from "../../../src/world/post.ts";
import type { Biome, BiomePost } from "../../../src/world/types.ts";
import { biomeKind } from "./MaterialLibrary.ts";

/**
 * The finishing pass (charter "Look"): bloom on authored emissive, one colour-grade pass
 * (saturation, contrast, warmth, vignette), then tone mapping and sRGB. Every number comes
 * from the biome; the client only falls back by biome kind for world files built before
 * biomes carried `post`. Also owns the scene's image-based light.
 */
export interface PostOptions {
  /**
   * Scale applied to the size UnrealBloomPass is given. The pass halves it again for its
   * first mip, so 1 means half-resolution bloom (high tier) and 0.5 quarter (low tier).
   */
  bloomScale: number;
  /** MSAA samples on the scene target (the canvas's own antialias does not apply here). */
  samples: number;
}

/** The biome's post block; older world files fall back to the same table by biome kind. */
export function postFor(biome: Biome): BiomePost {
  return biome.post ?? POST[biomeKind(biome)] ?? POST.meadow;
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
      c.rgb *= mix(1.0, 1.0 - smoothstep(0.3, 0.85, d), uVignette);
      gl_FragColor = c;
    }`,
};

export class PostStack {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private size = new THREE.Vector2();
  private env: THREE.Texture;
  /** Scene-pass numbers of the last frame, and the post passes' own draw calls. */
  private sceneCounts = { calls: 0, triangles: 0 };
  postCalls = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    camera: THREE.Camera,
    options: PostOptions,
  ) {
    renderer.getSize(this.size);
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: options.samples,
    });
    this.composer = new EffectComposer(renderer, target);
    // The ping-pong target only ever holds fullscreen passes: no MSAA there.
    this.composer.renderTarget2.samples = 0;
    // Record the scene pass's own counts: info would otherwise report only the last pass.
    const info = renderer.info;
    const scenePass = new RenderPass(scene, camera);
    const renderScene = scenePass.render.bind(scenePass);
    scenePass.render = (...args: Parameters<RenderPass["render"]>) => {
      const before = { calls: info.render.calls, triangles: info.render.triangles };
      renderScene(...args);
      this.sceneCounts.calls = info.render.calls - before.calls;
      this.sceneCounts.triangles = info.render.triangles - before.triangles;
    };
    this.composer.addPass(scenePass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.3, 0.85);
    // Bloom runs below render resolution; the composer resizes passes, so scale here, once.
    const bloomSetSize = this.bloom.setSize.bind(this.bloom);
    this.bloom.setSize = (w: number, h: number) =>
      bloomSetSize(
        Math.max(1, Math.round(w * options.bloomScale)),
        Math.max(1, Math.round(h * options.bloomScale)),
      );
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.setSize(this.size.x, this.size.y);

    // A neutral studio environment so metal, glass, and painted surfaces read as materials.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    this.env = pmrem.fromScene(room, 0.04).texture;
    scene.environment = this.env;
    room.dispose();
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
  }

  /** Follow the renderer's pixel ratio (dynamic resolution): one reallocation per change. */
  syncPixelRatio(): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
  }

  render(): void {
    const info = this.renderer.info;
    info.autoReset = false;
    info.reset();
    this.composer.render();
    // Diagnostics and the perf harness compare scene draw calls against the M7 budget.
    this.postCalls = info.render.calls - this.sceneCounts.calls;
    info.render.calls = this.sceneCounts.calls;
    info.render.triangles = this.sceneCounts.triangles;
  }

  dispose(): void {
    this.composer.dispose();
    this.bloom.dispose();
    this.env.dispose();
  }
}
