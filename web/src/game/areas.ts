import { POST } from "../../../src/world/post.ts";
import type { Biome, Door, Hub, Placement, Region, World } from "../../../src/world/types.ts";
import type { Bounds } from "../pure/collision.ts";

export const HUB_ID = "hub";

/** The hub is not a region in the contract; the client gives it a fixed plaza look. */
export const HUB_BIOME: Biome = {
  name: "plaza",
  ambient: 0.8,
  sun: 0.9,
  sky: "#b8d8f0",
  fog: { color: "#d6e6f5", density: 0.003 },
  palette: { ground: "#9aa5b1", wall: "#c7ced6", accent: "#ffd166", npc: "#888888" },
  enclosure: "open",
  props: [],
  npcForm: "villager",
  sound: "town",
  post: { ...POST.plaza },
};

/** A region or the hub, normalized so the renderer can treat them alike. */
export interface Area {
  id: string;
  label: string;
  bounds: Bounds;
  entrance: [number, number, number];
  biome: Biome;
  placements: Placement[];
  doors: Door[];
  region: Region | null;
}

export function hubArea(world: World): Area {
  const hub: Hub = world.hub;
  return {
    id: HUB_ID,
    label: "Hub",
    bounds: hub.bounds,
    entrance: hub.spawn,
    biome: HUB_BIOME,
    placements: [],
    doors: hub.portals,
    region: null,
  };
}

export function regionArea(world: World, region: Region): Area {
  return {
    id: region.id,
    label: region.label,
    bounds: region.bounds,
    entrance: region.entrance,
    biome: region.biome,
    placements: region.placements,
    doors: world.doors.filter((d) => d.from === region.id),
    region,
  };
}

export function findArea(world: World, id: string): Area | null {
  if (id === HUB_ID) return hubArea(world);
  const r = world.regions.find((x) => x.id === id);
  return r ? regionArea(world, r) : null;
}

export function areaLabel(world: World, id: string): string {
  if (id === HUB_ID) return "Hub";
  return world.regions.find((r) => r.id === id)?.label ?? id;
}

export function findPlacement(
  world: World,
  issue: number,
): { region: Region; placement: Placement } | null {
  for (const region of world.regions) {
    const placement = region.placements.find((p) => p.issue === issue);
    if (placement) return { region, placement };
  }
  return null;
}
