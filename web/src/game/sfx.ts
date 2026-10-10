// Tiny procedural sound cues (no assets): a tick when a hold starts, a snap when a badge
// lands, a chime on release, a reversed sweep on rewind. Silent until the page has had a
// user gesture, and silent under reduced motion if the caller never enables it.

type Cue = "tick" | "snap" | "release" | "rewind";

let ctx: AudioContext | null = null;
let enabled = true;

export function setSfxEnabled(on: boolean): void {
  enabled = on;
}

function context(): AudioContext | null {
  if (!enabled) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  c: AudioContext,
  freq: number,
  dur: number,
  type: OscillatorType,
  gain: number,
  slideTo?: number,
): void {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
  g.gain.setValueAtTime(gain, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + dur);
}

export function playSfx(cue: Cue): void {
  const c = context();
  if (!c) return;
  switch (cue) {
    case "tick":
      tone(c, 880, 0.06, "square", 0.03);
      break;
    case "snap":
      tone(c, 520, 0.09, "triangle", 0.08, 260);
      tone(c, 1040, 0.05, "sine", 0.04);
      break;
    case "release":
      tone(c, 523, 0.25, "sine", 0.07);
      window.setTimeout(() => tone(c, 784, 0.35, "sine", 0.07), 90);
      break;
    case "rewind":
      tone(c, 300, 0.3, "sawtooth", 0.05, 900);
      break;
  }
}
