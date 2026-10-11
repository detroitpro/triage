// One generated character per NPC form (charter "Look": characters). The prompts are the
// review surface for the asset kit: change the look here, then rerun the pipeline.
import type { CharacterSpec } from "./meshy.ts";

const STYLE =
  "3D character concept render in the style of a modern stylized battle-royale game (Fortnite-like): " +
  "slightly exaggerated cartoon proportions, larger head and hands, expressive friendly face, " +
  "smooth clean shapes, soft studio lighting, hand-painted materials. Full body, front view, " +
  "standing in A-pose, arms away from the body, legs apart and fully visible, nothing in the hands, " +
  "plain white background, no base, no text";

const TEXTURE =
  "hand-painted stylized PBR textures, soft gradients, saturated but warm palette, clean color blocks, " +
  "subtle edge wear, no logos, no text";

/** Meshy animation library ids (GET /openapi/v1/animations/library). */
const ACTIONS = { idle: 0, talk: 313, react: 28, leave: 41 } as const;

export const CHARACTERS: Record<string, CharacterSpec> = {
  villager: {
    form: "villager",
    prompt: `${STYLE}. A village craftsperson: linen shirt with rolled sleeves, short leather apron, soft felt hat, satchel strap across the chest, warm earthy colours`,
    texturePrompt: `${TEXTURE}. Linen cream shirt, brown leather apron, olive felt hat`,
    heightMeters: 1.75,
    actions: ACTIONS,
  },
  worker: {
    form: "worker",
    prompt: `${STYLE}. An industrial engineer: hard hat, safety visor pushed up, high-visibility orange vest with reflective stripes over a blue work shirt, sturdy boots, tool belt`,
    texturePrompt: `${TEXTURE}. Orange hi-vis vest with silver reflective stripes, navy work clothes, yellow hard hat`,
    heightMeters: 1.8,
    actions: ACTIONS,
  },
  creature: {
    form: "creature",
    prompt: `${STYLE}. A small friendly forest critter that stands upright on two legs like a person: round fluffy body, big ears, short tail, mitten-like hands, cream and soft brown fur`,
    texturePrompt: `${TEXTURE}. Cream belly, soft brown fur, pink inner ears`,
    heightMeters: 1.3,
    actions: ACTIONS,
  },
  shade: {
    form: "shade",
    prompt: `${STYLE}. A hooded dungeon wraith in a short tattered cloak that ends above the knees, thin dark legs and arms clearly visible, glowing eyes under the hood, slate blue and charcoal`,
    texturePrompt: `${TEXTURE}. Charcoal cloak with slate blue trim, faint glowing blue eyes`,
    heightMeters: 1.85,
    // Dark cloth in a dark biome: a faint self-light and a hover (the eyes glow in the texture).
    selfLight: 0.15,
    hover: 0.25,
    actions: ACTIONS,
  },
};
