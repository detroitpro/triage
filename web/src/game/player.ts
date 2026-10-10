import * as THREE from "three";
import type { Vec3 } from "../../../src/world/types.ts";
import { type Bounds, clampToBounds, EYE_HEIGHT } from "../pure/collision.ts";
import { approach, easeOutCubic, pulse, TweenManager } from "../pure/tween.ts";
import type { Settings } from "./settings.ts";

const WALK = 5;
const SPRINT = 9;
const GRAVITY = 20;
const JUMP = 6.5;
/** Time constants (seconds) for the velocity approach curve. */
const ACCEL_TAU = 0.09;
const DECEL_TAU = 0.13;
const AIR_TAU = 0.35;
/** Sprint widens the view by this many degrees, eased over ~0.2 s. */
const SPRINT_FOV = 7;
const FOV_TAU = 0.07;
/** Head bob. */
const BOB_FREQ = 1.9;
const BOB_AMP_WALK = 0.03;
const BOB_AMP_SPRINT = 0.055;
const BOB_SWAY = 0.5;
/** Landing dip depth in world units at full impact. */
const LAND_DIP = 0.09;
const LAND_MIN_SPEED = 3;
const TRAVEL_FOV_PULL = 6;

/**
 * First-person controller: pointer lock, WASD, mouse look, sprint, jump.
 * Motion has acceleration and deceleration curves, a sprint FOV ease, speed-tied head
 * bob, a landing dip and a FOV pull on travel. The reduced-motion setting disables bob,
 * dip and sprint zoom; the FOV pull still runs but shorter.
 */
export class Player {
  readonly camera: THREE.PerspectiveCamera;
  position = new THREE.Vector3(0, EYE_HEIGHT, 0);
  yaw = 0;
  pitch = 0;
  bounds: Bounds = { x: -10, z: -10, w: 20, d: 20 };
  locked = false;
  /** When true, input is ignored (an overlay is open). */
  inputBlocked = false;
  /** Horizontal velocity in world units per second. */
  readonly velocity = new THREE.Vector2(0, 0);
  private keys = new Set<string>();
  private vy = 0;
  private grounded = true;
  private bobT = 0;
  private bobAmp = 0;
  private fovNow: number;
  private fovPunch = 0;
  private dip = 0;
  private fx = new TweenManager();

  constructor(
    private canvas: HTMLCanvasElement,
    private settings: Settings,
  ) {
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.1, 400);
    this.camera.rotation.order = "YXZ";
    this.fovNow = settings.fov;
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
    this.fovNow = this.settings.fov;
    this.camera.fov = this.fovNow + this.fovPunch;
    this.camera.updateProjectionMatrix();
  }

  /** Move instantly (door, portal, map travel). Resets motion and plays the arrival pull. */
  teleport(pos: Vec3, yaw?: number): void {
    this.position.set(pos[0], EYE_HEIGHT, pos[2]);
    this.vy = 0;
    this.grounded = true;
    this.velocity.set(0, 0);
    this.bobAmp = 0;
    if (yaw !== undefined) this.yaw = yaw;
    this.keys.clear();
    this.travelPulse();
    this.sync();
  }

  /** Short FOV pull that settles on arrival; the fade in game.ts covers the cut. */
  travelPulse(): void {
    const dur = this.settings.reducedMotion ? 0.2 : 0.5;
    const amount = this.settings.reducedMotion ? TRAVEL_FOV_PULL * 0.4 : TRAVEL_FOV_PULL;
    this.fx.tween(
      dur,
      (t) => {
        this.fovPunch = amount * (1 - t);
      },
      easeOutCubic,
    );
  }

  /** Additive FOV kick (degrees), decays back on its own. */
  punchFov(degrees: number, durationSec = 0.35): void {
    const start = this.fovPunch + degrees;
    this.fx.tween(
      durationSec,
      (t) => {
        this.fovPunch = start * (1 - t);
      },
      easeOutCubic,
    );
  }

  get pos(): Vec3 {
    return [this.position.x, this.position.y, this.position.z];
  }

  get moving(): boolean {
    return ["KeyW", "KeyA", "KeyS", "KeyD"].some((k) => this.keys.has(k));
  }

  get sprinting(): boolean {
    return this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
  }

  /** Current ground speed as a fraction of sprint speed, 0..1. */
  get speedRatio(): number {
    return Math.min(1, this.velocity.length() / SPRINT);
  }

  update(dt: number): void {
    const k = this.keys;
    const sprint = this.sprinting;
    const speed = sprint ? SPRINT : WALK;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    let mx = 0;
    let mz = 0;
    const canMove = !this.inputBlocked && this.locked;
    if (canMove) {
      if (k.has("KeyW")) [mx, mz] = [mx + fx, mz + fz];
      if (k.has("KeyS")) [mx, mz] = [mx - fx, mz - fz];
      if (k.has("KeyD")) [mx, mz] = [mx + rx, mz + rz];
      if (k.has("KeyA")) [mx, mz] = [mx - rx, mz - rz];
      if (k.has("Space") && this.grounded) {
        this.vy = JUMP;
        this.grounded = false;
      }
    }
    const len = Math.hypot(mx, mz);
    if (len > 0) {
      mx /= len;
      mz /= len;
    }
    // Velocity follows the wanted direction with an exponential curve: quick to
    // start, a little slower to stop, floaty in the air.
    const tau = !this.grounded ? AIR_TAU : len > 0 ? ACCEL_TAU : DECEL_TAU;
    this.velocity.x = approach(this.velocity.x, mx * speed, dt, tau);
    this.velocity.y = approach(this.velocity.y, mz * speed, dt, tau);
    if (this.velocity.lengthSq() < 1e-4) this.velocity.set(0, 0);
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.y * dt;
    // Vertical.
    const wasAirborne = !this.grounded;
    this.vy -= GRAVITY * dt;
    this.position.y += this.vy * dt;
    const clamped = clampToBounds(this.pos, this.bounds);
    this.position.set(clamped[0], clamped[1], clamped[2]);
    if (this.position.y <= EYE_HEIGHT + 1e-4) {
      if (wasAirborne && this.vy < -LAND_MIN_SPEED) this.land(-this.vy);
      this.grounded = true;
      this.vy = Math.max(0, this.vy);
    }
    // Head bob amplitude blends with ground speed so it fades out instead of cutting.
    const ratio = this.grounded ? this.speedRatio : 0;
    const wantAmp = this.settings.reducedMotion
      ? 0
      : ratio * (BOB_AMP_WALK + (BOB_AMP_SPRINT - BOB_AMP_WALK) * Math.max(0, ratio * 2 - 1));
    this.bobAmp = approach(this.bobAmp, wantAmp, dt, 0.12);
    this.bobT += dt * this.velocity.length() * BOB_FREQ;
    // Sprint FOV ease.
    const zoom = sprint && len > 0 && !this.settings.reducedMotion ? SPRINT_FOV : 0;
    this.fovNow = approach(this.fovNow, this.settings.fov + zoom, dt, FOV_TAU);
    this.fx.update(dt);
    const fov = this.fovNow + this.fovPunch;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.sync();
  }

  private land(impact: number): void {
    if (this.settings.reducedMotion) return;
    const depth = LAND_DIP * Math.min(1, impact / JUMP);
    const curve = pulse(0.3);
    this.fx.tween(
      0.32,
      (t) => {
        this.dip = -depth * curve(t);
      },
      (t) => t,
    );
  }

  private sync(): void {
    this.camera.position.copy(this.position);
    const bobY = Math.sin(this.bobT * 2) * this.bobAmp;
    const sway = Math.sin(this.bobT) * this.bobAmp * BOB_SWAY;
    this.camera.position.y += bobY + this.dip;
    // Lateral sway along the camera's right vector.
    this.camera.position.x += Math.cos(this.yaw) * sway;
    this.camera.position.z += -Math.sin(this.yaw) * sway;
    const roll = this.settings.reducedMotion ? 0 : -sway * 0.6;
    this.camera.rotation.set(this.pitch, this.yaw, roll);
  }
}
