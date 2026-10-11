import * as THREE from "three";

export interface LabelOptions {
  color?: string;
  background?: string;
  fontSize?: number;
  /** World height of the sprite in units. */
  height?: number;
}

/** A billboard sprite drawn from a canvas. Cheap enough for one per NPC/door. */
export function makeLabelSprite(lines: string[], opts: LabelOptions = {}): THREE.Sprite {
  const fontSize = opts.fontSize ?? 28;
  const pad = 12;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
  const widths = lines.map((l) => ctx.measureText(l).width);
  const w = Math.ceil(Math.max(64, ...widths) + pad * 2);
  const h = Math.ceil(lines.length * fontSize * 1.25 + pad * 2);
  canvas.width = w;
  canvas.height = h;
  ctx.fillStyle = opts.background ?? "rgba(10,12,18,0.75)";
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 10);
  ctx.fill();
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
  ctx.fillStyle = opts.color ?? "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  lines.forEach((line, i) => {
    ctx.fillText(line, w / 2, pad + i * fontSize * 1.25);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: true, transparent: true });
  const sprite = new THREE.Sprite(material);
  const height = opts.height ?? 0.6;
  sprite.scale.set((height * w) / h, height, 1);
  return sprite;
}

export function disposeSprite(sprite: THREE.Sprite): void {
  const mat = sprite.material;
  mat.map?.dispose();
  mat.dispose();
}
