import * as THREE from "three";
import type { Vec3 } from "../../../src/world/types.ts";
import { type Bounds, clampToBounds, EYE_HEIGHT } from "../pure/collision.ts";
import type { Settings } from "./settings.ts";

const WALK = 5;
const SPRINT = 9;
const GRAVITY = 20;
const JUMP = 6.5;

/** First-person controller: pointer lock, WASD, mouse look, sprint, jump, head bob. */
export class Player {
  readonly camera: THREE.PerspectiveCamera;
  position = new THREE.Vector3(0, EYE_HEIGHT, 0);
  yaw = 0;
  pitch = 0;
  bounds: Bounds = { x: -10, z: -10, w: 20, d: 20 };
  locked = false;
  private keys = new Set<string>();
  private vy = 0;
  private bobT = 0;
  /** When true, input is ignored (an overlay is open). */
  inputBlocked = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private settings: Settings,
  ) {
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.1, 400);
    this.camera.rotation.order = "YXZ";
    canvas.addEventListener("click", () => {
      if (!this.inputBlocked && !this.locked) canvas.requestPointerLock();
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.keys.clear();
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.locked || this.inputBlocked) return;
      const s = 0.0022 * this.settings.sensitivity;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s;
      this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch));
    });
    document.addEventListener("keydown", (e) => {
      if (this.inputBlocked) return;
      this.keys.add(e.code);
    });
    document.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  lock(): void {
    if (!this.locked) this.canvas.requestPointerLock();
  }

  unlock(): void {
    if (this.locked) document.exitPointerLock();
  }

  applySettings(): void {
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
  }

  teleport(pos: Vec3, yaw?: number): void {
    this.position.set(pos[0], EYE_HEIGHT, pos[2]);
    this.vy = 0;
    if (yaw !== undefined) this.yaw = yaw;
    this.keys.clear();
    this.sync();
  }

  get pos(): Vec3 {
    return [this.position.x, this.position.y, this.position.z];
  }

  get moving(): boolean {
    return ["KeyW", "KeyA", "KeyS", "KeyD"].some((k) => this.keys.has(k));
  }

  update(dt: number): void {
    const k = this.keys;
    const speed = k.has("ShiftLeft") || k.has("ShiftRight") ? SPRINT : WALK;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    let mx = 0;
    let mz = 0;
    if (!this.inputBlocked && this.locked) {
      if (k.has("KeyW")) [mx, mz] = [mx + fx, mz + fz];
      if (k.has("KeyS")) [mx, mz] = [mx - fx, mz - fz];
      if (k.has("KeyD")) [mx, mz] = [mx + rx, mz + rz];
      if (k.has("KeyA")) [mx, mz] = [mx - rx, mz - rz];
      if (k.has("Space") && this.position.y <= EYE_HEIGHT + 1e-3) this.vy = JUMP;
    }
    const len = Math.hypot(mx, mz);
    if (len > 0) {
      mx /= len;
      mz /= len;
      this.bobT += dt * speed;
    }
    this.position.x += mx * speed * dt;
    this.position.z += mz * speed * dt;
    this.vy -= GRAVITY * dt;
    this.position.y += this.vy * dt;
    const clamped = clampToBounds(this.pos, this.bounds);
    this.position.set(clamped[0], clamped[1], clamped[2]);
    if (this.position.y <= EYE_HEIGHT) this.vy = Math.max(0, this.vy);
    this.sync(len > 0);
  }

  private sync(moving = false): void {
    this.camera.position.copy(this.position);
    if (moving && !this.settings.reducedMotion) {
      this.camera.position.y += Math.sin(this.bobT * 1.6) * 0.04;
    }
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
