// Graph + lens -> world.json. Seeded and deterministic: closing one issue moves nothing else.
import type { ClassifiedIssue } from "../classify/index.ts";
import type { GraphFile, LensAnalysis } from "../graph/types.ts";
import { DIRECTED } from "../graph/types.ts";
import { hash32, rng } from "../io.ts";
import { biomeFor } from "./biome.ts";
import type { Door, LabelMeta, Placement, PlacementEdge, Region, Vec3, World } from "./types.ts";

const DOOR_PRIORITY: Door["edgeType"][] = [
  "blocks",
  "depends-on",
  "parent-of",
  "security",
  "same-code-path",
  "functional",
  "user-journey",
  "duplicate-of",
];
const CELL = 70; // spacing between region origins on the grid
const HUB_SIZE = 30;

function regionSize(count: number): number {
  return Math.max(24, Math.ceil(Math.sqrt(count) * 9));
}

/** Deterministic position inside a region from the issue number alone (never from neighbors). */
function placeInRegion(issue: number, region: Region["bounds"]): Vec3 {
  const r = rng(hash32(`place:${issue}`));
  const x = region.x + 3 + r() * (region.w - 6);
  const z = region.z + 3 + r() * (region.d - 6);
  return [round(x), 0, round(z)];
}

const round = (v: number) => Math.round(v * 100) / 100;

export interface LabelSource {
  name: string;
  color: string;
  description: string;
}

export function buildWorld(
  graph: GraphFile,
  lens: string,
  lenses: string[],
  labels: LabelSource[] = [],
): World {
  const analysis = graph.lenses[lens];
  if (!analysis) throw new Error(`no analysis for lens ${lens}`);
  const byId = new Map(graph.nodes.map((n) => [n.number, n]));
  const members = new Map<string, ClassifiedIssue[]>();
  for (const n of graph.nodes) {
    const r = analysis.regions[String(n.number)] ?? "unsorted";
    (members.get(r) ?? members.set(r, []).get(r))?.push(n);
  }
  // Stable region order: by id, "unsorted" last.
  const regionIds = [...members.keys()].sort((a, b) =>
    a === "unsorted" ? 1 : b === "unsorted" ? -1 : a.localeCompare(b),
  );
  const cols = Math.max(2, Math.ceil(Math.sqrt(regionIds.length + 1)));

  const regions: Region[] = regionIds.map((id, i) => {
    const ms = (members.get(id) as ClassifiedIssue[]).sort((a, b) => a.number - b.number);
    const size = regionSize(ms.length);
    const col = (i + 1) % cols;
    const row = Math.floor((i + 1) / cols);
    const bounds = { x: col * CELL - size / 2, z: row * CELL - size / 2, w: size, d: size };
    // Feel follows the worst case for danger and the typical case for effort (charter: biome).
    const complexity = mean(ms.map((m) => m.complexity));
    const security = Math.max(...ms.map((m) => m.security));
    const kind = mode(ms.map((m) => m.kind));
    const biome = biomeFor(complexity, security, kind);
    const placements: Placement[] = ms.map((m) => {
      const c = analysis.centrality[String(m.number)] ?? 0;
      return {
        issue: m.number,
        title: m.title,
        url: m.url,
        summary: m.summary,
        labels: m.labels,
        position: placeInRegion(m.number, bounds),
        scale: round(0.7 + 1.1 * c),
        form: biome.npcForm,
        centrality: c,
        dimensions: {
          functionalArea: m.functionalArea,
          codeArea: m.codeArea,
          abstraction: m.abstraction,
          security: m.security,
          complexity: m.complexity,
          userFacing: m.userFacing,
          kind: m.kind,
          actionable: m.actionable,
          confidence: m.confidence,
          quarantined: m.quarantined,
        },
        edges: placementEdges(m.number, graph),
      };
    });
    return {
      id,
      label: analysis.regionLabels[id] ?? id,
      bounds,
      entrance: [round(bounds.x + bounds.w / 2), 0, round(bounds.z + bounds.d - 3)],
      biome,
      stats: {
        count: ms.length,
        complexity: round(complexity),
        security: round(security),
        reviewed: 0,
      },
      placements,
    };
  });

  const regionOf = new Map(regions.map((r) => [r.id, r]));
  const doors: Door[] = [];
  // One door per region pair, typed by the strongest bridge; a blocks bridge locks the door
  // into the blocked region.
  const byPair = new Map<
    string,
    { from: Region; to: Region; type: Door["edgeType"]; lock?: ClassifiedIssue | undefined }
  >();
  for (const b of analysis.bridges) {
    const ra = analysis.regions[String(b.source)];
    const rb = analysis.regions[String(b.target)];
    const from = ra && regionOf.get(ra);
    const to = rb && regionOf.get(rb);
    if (!from || !to || from === to) continue;
    const key = [from.id, to.id].sort().join("|");
    const current = byPair.get(key);
    const rank = DOOR_PRIORITY.indexOf(b.type);
    if (!current || rank < DOOR_PRIORITY.indexOf(current.type)) {
      byPair.set(key, {
        from,
        to,
        type: b.type,
        ...(b.type === "blocks" ? { lock: byId.get(b.source) } : {}),
      });
    }
  }
  for (const { from, to, type, lock } of byPair.values()) {
    doors.push(doorBetween(from, to, type, lock));
    doors.push(doorBetween(to, from, type, undefined));
  }
  // Every region gets a portal back to the hub, and the hub a portal to every region.
  const hubBounds = { x: -HUB_SIZE / 2, z: -HUB_SIZE / 2, w: HUB_SIZE, d: HUB_SIZE };
  const portals: Door[] = regions.map((r, i) => {
    const angle = (i / regions.length) * Math.PI * 2;
    const radius = HUB_SIZE / 2 - 4;
    return {
      id: `hub->${r.id}`,
      from: "hub",
      to: r.id,
      kind: "portal",
      position: [round(Math.cos(angle) * radius), 0, round(Math.sin(angle) * radius)],
      facing: round(angle),
      edgeType: "functional",
    };
  });
  for (const r of regions) {
    doors.push({
      id: `${r.id}->hub`,
      from: r.id,
      to: "hub",
      kind: "portal",
      position: [round(r.bounds.x + 3), 0, round(r.bounds.z + r.bounds.d - 3)],
      facing: Math.PI,
      edgeType: "functional",
    });
  }

  return {
    version: 1,
    repo: graph.repo,
    lens,
    lenses,
    builtAt: "",
    graphHash: hash32(JSON.stringify(graph.edges) + JSON.stringify(analysis.regions)).toString(16),
    hub: { id: "hub", bounds: hubBounds, spawn: [0, 0, 8], portals },
    regions,
    doors: doors.sort((a, b) => a.id.localeCompare(b.id)),
    labelSet: labelSetFor(graph.nodes, labels),
  };
}

/** Every repo label as a token, with how many open issues wear it. Unknown labels on issues are added. */
export function labelSetFor(nodes: ClassifiedIssue[], labels: LabelSource[]): LabelMeta[] {
  const counts = new Map<string, number>();
  for (const n of nodes) for (const l of n.labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  const out = new Map<string, LabelMeta>();
  for (const l of labels) out.set(l.name, { ...l, count: counts.get(l.name) ?? 0 });
  for (const [name, count] of counts) {
    if (!out.has(name)) out.set(name, { name, color: "9e9e9e", description: "", count });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function doorBetween(
  from: Region,
  to: Region,
  edgeType: Door["edgeType"],
  lockedBy: ClassifiedIssue | undefined,
): Door {
  // Place the door on the wall of `from` nearest to `to`.
  const fx = from.bounds.x + from.bounds.w / 2;
  const fz = from.bounds.z + from.bounds.d / 2;
  const tx = to.bounds.x + to.bounds.w / 2;
  const tz = to.bounds.z + to.bounds.d / 2;
  const dx = tx - fx;
  const dz = tz - fz;
  const horizontal = Math.abs(dx) >= Math.abs(dz);
  const offset = rng(hash32(`door:${from.id}:${to.id}`))() * 0.5 - 0.25;
  const position: Vec3 = horizontal
    ? [
        round(dx > 0 ? from.bounds.x + from.bounds.w - 1.5 : from.bounds.x + 1.5),
        0,
        round(fz + offset * from.bounds.d),
      ]
    : [
        round(fx + offset * from.bounds.w),
        0,
        round(dz > 0 ? from.bounds.z + from.bounds.d - 1.5 : from.bounds.z + 1.5),
      ];
  const facing = round(Math.atan2(dx, dz));
  return {
    id: `${from.id}->${to.id}:${edgeType}`,
    from: from.id,
    to: to.id,
    kind: "door",
    position,
    facing,
    edgeType,
    ...(lockedBy ? { locked: { by: lockedBy.number, title: lockedBy.title } } : {}),
  };
}

function placementEdges(issue: number, graph: GraphFile): PlacementEdge[] {
  const out: PlacementEdge[] = [];
  for (const e of graph.edges) {
    if (e.source === issue)
      out.push({
        to: e.target,
        type: e.type,
        direction: DIRECTED[e.type] ? "out" : "none",
        weight: e.weight,
      });
    else if (e.target === issue)
      out.push({
        to: e.source,
        type: e.type,
        direction: DIRECTED[e.type] ? "in" : "none",
        weight: e.weight,
      });
  }
  return out.sort((a, b) => a.to - b.to || a.type.localeCompare(b.type));
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function mode(xs: string[]): string {
  const counts = new Map<string, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "other";
}

/** Invariants the graph-auditor agent checks. */
export function validateWorld(w: World, _analysis?: LensAnalysis): string[] {
  const errors: string[] = [];
  const ids = new Set(w.regions.map((r) => r.id));
  for (const d of w.doors) {
    if (!ids.has(d.from) && d.from !== "hub") errors.push(`door ${d.id} from unknown region`);
    if (!ids.has(d.to) && d.to !== "hub") errors.push(`door ${d.id} to unknown region`);
  }
  const reachable = new Set(w.hub.portals.map((p) => p.to));
  for (const r of w.regions)
    if (!reachable.has(r.id)) errors.push(`region ${r.id} unreachable from hub`);
  for (const r of w.regions) {
    for (const p of r.placements) {
      const [x, , z] = p.position;
      if (
        x < r.bounds.x ||
        x > r.bounds.x + r.bounds.w ||
        z < r.bounds.z ||
        z > r.bounds.z + r.bounds.d
      ) {
        errors.push(`#${p.issue} placed outside ${r.id}`);
      }
    }
  }
  return errors;
}
