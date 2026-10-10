import type { LabelMeta, NpcForm, Placement, Region } from "../../../src/world/types.ts";
import {
  type Action,
  type Intent,
  localIntent,
  type Offer,
  offerFor,
  PROMPT_KEYS,
} from "../pure/actions.ts";
import { describeEdge, localAnswer, PROMPTS, type Prompt } from "../pure/dialogueText.ts";
import { addNote, listNotes } from "../pure/progress.ts";
import { labelColor } from "../pure/satchel.ts";
import type { DialogueQuery, DialogueResponse } from "./api.ts";
import { escapeHtml } from "./mapScreen.ts";

export interface DialogueCallbacks {
  isReviewed(issue: number): boolean;
  setReviewed(issue: number, on: boolean): void;
  /** Draw (or clear) connection lines in the world. */
  showEdges(issue: number | null): void;
  onClose(): void;
  /** Server dialogue; null when offline (local templates take over). */
  ask(issue: number, q: DialogueQuery): Promise<DialogueResponse | null>;
  /** Start the hold ring for a physical verb; returns false if one is already running. */
  beginHold(action: Action, key: string, grantId?: string): boolean;
  endHold(key: string): void;
  labelSet(): readonly LabelMeta[];
  repo(): string;
  /** Offline rehearsal needs no grant. */
  offline(): boolean;
}

/** Flat silhouettes for the name plate, one per NPC form. */
export const FORM_ICONS: Record<NpcForm, string> = {
  creature:
    '<path d="M6 9 4 4l5 3h6l5-3-2 5a7 7 0 1 1-12 0Z"/><circle cx="9.5" cy="13" r="1.2" fill="#fff"/><circle cx="14.5" cy="13" r="1.2" fill="#fff"/>',
  villager:
    '<path d="M7 7h10l-1-3H8Zm1 1h8v3H8Z"/><circle cx="12" cy="13" r="2.5"/><path d="M5 22c0-4 3-6 7-6s7 2 7 6Z"/>',
  worker:
    '<path d="M6 10a6 6 0 0 1 12 0v1H6Z"/><rect x="5" y="11" width="14" height="2"/><path d="M5 22c0-4 3-6 7-6s7 2 7 6Z"/><rect x="10" y="17" width="4" height="5" fill="#fff" opacity=".6"/>',
  shade:
    '<path d="M12 2c-4 0-6 4-6 8v6l-2 6h16l-2-6v-6c0-4-2-8-6-8Z"/><circle cx="9.5" cy="10" r="1.3" fill="#fff"/><circle cx="14.5" cy="10" r="1.3" fill="#fff"/>',
};

const LEVELS = 3;

function pips(value: number, cls = ""): string {
  const n = Math.max(0, Math.min(LEVELS, Math.round(value)));
  const dots = Array.from({ length: LEVELS }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`);
  return `<span class="pips ${cls}">${dots.join("")}</span>`;
}

type BubbleState = "pending" | "posted" | "practice" | "private";

interface Bubble {
  text: string;
  state: BubbleState;
}

export class Dialogue {
  private root: HTMLElement;
  open = false;
  current: Placement | null = null;
  /** Things said this session, per issue, so reopening the panel keeps the seals. */
  private bubbles = new Map<number, Bubble[]>();

  constructor(private cb: DialogueCallbacks) {
    const root = document.getElementById("dialogue");
    if (!root) throw new Error("missing #dialogue");
    this.root = root;
  }

  show(p: Placement, region: Region): void {
    this.open = true;
    this.current = p;
    this.root.classList.remove("hidden");
    const d = p.dimensions;
    const q = d.quarantined;
    const reviewed = this.cb.isReviewed(p.issue);
    const labelSet = this.cb.labelSet();
    this.root.innerHTML = `<div class="panel ${reviewed ? "reviewed" : ""}">
      <div class="nameplate">
        <svg class="form-icon" viewBox="0 0 24 24" aria-hidden="true">${FORM_ICONS[p.form] ?? FORM_ICONS.villager}</svg>
        <span class="issue">#${p.issue}</span>
        <span class="title">${escapeHtml(p.title)}</span>
        <span class="reviewed-seal" title="Reviewed">✓</span>
      </div>
      ${q ? `<div class="quarantine-seal">Quarantined</div>` : ""}
      <div class="speech-body">
        <div class="speech-top">
          <div class="labels" id="dlg-labels">${p.labels.map((l) => `<span style="border-color:${labelColor(labelSet, l)}">${escapeHtml(l)}</span>`).join("")}</div>
        </div>
        <div class="dims">
          <span>area <b>${escapeHtml(d.functionalArea)}</b></span>
          <span>code <b>${escapeHtml(d.codeArea)}</b></span>
          <span>kind <b>${escapeHtml(d.kind)}</b></span>
          <span>complexity ${pips(d.complexity)}</span>
          <span>risk ${pips(d.security, "risk")}</span>
          <span>actionable <b class="num">${Math.round(d.actionable * 100)}%</b></span>
          <span>centrality <b class="num">${p.centrality.toFixed(2)}</b></span>
        </div>
        ${q ? `<p class="warn">This issue's text looked like a prompt injection. I will only answer from my record; the reply box is sealed.</p>` : ""}
        <div class="chips" id="dlg-prompts">${PROMPTS.map((t, i) => `<button class="chip" data-prompt="${i}" type="button">${t}</button>`).join("")}</div>
        <div class="answer" id="dlg-answer">…</div>
        <ul class="edge-list" id="dlg-edges"></ul>
        <div class="bubbles" id="dlg-bubbles"></div>
        <div class="offer" id="dlg-offer"></div>
        <div class="row">
          <input id="dlg-input" placeholder="Say something to #${p.issue}…" ${q ? "disabled" : ""} autocomplete="off" />
          <button class="btn" id="dlg-send" type="button" ${q ? "disabled" : ""}>Send</button>
        </div>
      </div>
      <div class="speech-actions">
        <button class="btn primary ${reviewed ? "done" : ""}" id="dlg-review" type="button">${reviewed ? "✓ Reviewed" : "Mark reviewed"}</button>
        <a class="btn" href="${escapeHtml(p.url)}" target="_blank" rel="noreferrer">Open on GitHub</a>
        <span class="spacer"></span>
        <button class="btn" id="dlg-close" type="button"><span class="keycap">Esc</span>Close</button>
      </div>
    </div>`;
    const panel = this.root.querySelector<HTMLElement>(".panel");
    const answer = this.root.querySelector<HTMLElement>("#dlg-answer");
    const edges = this.root.querySelector<HTMLElement>("#dlg-edges");
    const chips = [...this.root.querySelectorAll<HTMLElement>("[data-prompt]")];
    const setAnswer = (text: string, thinking = false) => {
      if (!answer) return;
      answer.textContent = text;
      answer.classList.toggle("thinking", thinking);
      answer.style.animation = "none";
      void answer.offsetWidth;
      answer.style.animation = "";
    };
    const showEdges = () => {
      this.cb.showEdges(p.issue);
      if (edges) edges.innerHTML = p.edges.map((e) => edgeItem(e)).join("");
    };
    for (const b of chips) {
      b.addEventListener("click", () => {
        for (const c of chips) c.classList.toggle("active", c === b);
        const prompt = PROMPTS[Number(b.dataset.prompt)] as Prompt;
        this.clearOffer();
        // Local answer first (instant), then the server's if it is there.
        setAnswer(localAnswer(prompt, p, region));
        if (prompt === "Who are you connected to?") showEdges();
        void this.cb.ask(p.issue, { prompt: PROMPT_KEYS[prompt] }).then((r) => {
          if (!this.open || this.current !== p || !r?.reply) return;
          if (!b.classList.contains("active")) return;
          setAnswer(r.reply);
        });
      });
    }
    const input = this.root.querySelector<HTMLInputElement>("#dlg-input");
    const send = async () => {
      const text = input?.value.trim();
      if (!text || !input) return;
      input.value = "";
      for (const c of chips) c.classList.remove("active");
      this.clearOffer();
      setAnswer("…", true);
      const r = await this.cb.ask(p.issue, { text });
      if (!this.open || this.current !== p) return;
      let intent: Intent;
      let grantId: string | undefined;
      if (r) {
        setAnswer(r.reply || "…");
        intent = r.intent ?? localIntent(text, p.labels);
        grantId = r.grantId;
      } else {
        intent = localIntent(text, p.labels);
        setAnswer(offlineReply(text, intent, p));
      }
      if (intent.quarantined) {
        this.renderOffer({ kind: "wheel" }, p, text, undefined, true);
        return;
      }
      this.renderOffer(offerFor(intent), p, text, grantId, false);
    };
    this.root.querySelector("#dlg-send")?.addEventListener("click", () => void send());
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void send();
      e.stopPropagation();
    });
    input?.addEventListener("keyup", (e) => e.stopPropagation());
    const reviewBtn = this.root.querySelector<HTMLButtonElement>("#dlg-review");
    reviewBtn?.addEventListener("click", () => {
      const on = !this.cb.isReviewed(p.issue);
      this.cb.setReviewed(p.issue, on);
      // Update in place so the confirm animation plays instead of re-rendering.
      if (!this.open) return;
      panel?.classList.toggle("reviewed", on);
      reviewBtn.textContent = on ? "✓ Reviewed" : "Mark reviewed";
      reviewBtn.classList.toggle("done", on);
      reviewBtn.classList.remove("confirm");
      void reviewBtn.offsetWidth;
      if (on) reviewBtn.classList.add("confirm");
      const seal = this.root.querySelector<HTMLElement>(".reviewed-seal");
      if (seal) {
        seal.classList.remove("stamp");
        void seal.offsetWidth;
        if (on) seal.classList.add("stamp");
      }
    });
    this.root.querySelector("#dlg-close")?.addEventListener("click", () => this.hide());
    this.renderBubbles(p.issue);
    chips[0]?.click();
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.current = null;
    this.root.classList.add("hidden");
    this.cb.endHold("pointer");
    this.cb.showEdges(null);
    this.cb.onClose();
  }

  /** Re-render the label strip after a give or take. */
  refreshLabels(p: Placement): void {
    if (!this.open || this.current !== p) return;
    const el = this.root.querySelector<HTMLElement>("#dlg-labels");
    if (!el) return;
    const labelSet = this.cb.labelSet();
    el.innerHTML = p.labels
      .map((l) => `<span style="border-color:${labelColor(labelSet, l)}">${escapeHtml(l)}</span>`)
      .join("");
  }

  /** A comment finished: seal its bubble as posted or practice. */
  markPosted(issue: number, text: string, state: "posted" | "practice"): void {
    const list = this.bubbles.get(issue) ?? [];
    const b = list.find((x) => x.text === text && x.state === "pending");
    if (b) b.state = state;
    else list.push({ text, state });
    this.bubbles.set(issue, list);
    this.renderBubbles(issue);
  }

  // ---- offers: the physical verb for what you said ----------------------------------------

  private clearOffer(): void {
    const o = this.root.querySelector<HTMLElement>("#dlg-offer");
    if (o) o.innerHTML = "";
  }

  private renderOffer(
    offer: Offer,
    p: Placement,
    text: string,
    grantId: string | undefined,
    sealed: boolean,
  ): void {
    const o = this.root.querySelector<HTMLElement>("#dlg-offer");
    if (!o) return;
    const labelSet = this.cb.labelSet();
    const verb = (label: string, action: Action, color: string, needsGrant: boolean) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip verb";
      b.style.setProperty("--tc", color);
      b.innerHTML = `${escapeHtml(label)}<span class="keycap key-sm">hold</span>`;
      if (needsGrant && !grantId && !this.offlineGrantOk()) {
        b.disabled = true;
        b.title = "the server issued no grant for this";
      }
      const start = (e: Event) => {
        e.preventDefault();
        if (b.disabled) return;
        if (action.type === "comment") this.pushBubble(p.issue, text, "pending");
        if (this.cb.beginHold(action, "pointer", grantId)) b.classList.add("holding");
      };
      const stop = () => {
        b.classList.remove("holding");
        this.cb.endHold("pointer");
        const list = this.bubbles.get(p.issue);
        if (list?.at(-1)?.state === "pending") {
          // Still pending after release means the hold was cancelled (commit seals it fast).
          window.setTimeout(() => {
            const l = this.bubbles.get(p.issue);
            const last = l?.at(-1);
            if (last?.state === "pending" && l) {
              l.pop();
              this.renderBubbles(p.issue);
            }
          }, 150);
        }
      };
      b.addEventListener("pointerdown", start);
      b.addEventListener("pointerup", stop);
      b.addEventListener("pointerleave", stop);
      b.addEventListener("pointercancel", stop);
      b.addEventListener("keydown", (e) => {
        if ((e.code === "Enter" || e.code === "Space") && !e.repeat) start(e);
      });
      b.addEventListener("keyup", (e) => {
        if (e.code === "Enter" || e.code === "Space") stop();
      });
      return b;
    };
    const lead = (t: string) => {
      const s = document.createElement("span");
      s.className = "lead";
      s.textContent = t;
      return s;
    };
    const plain = (t: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = t;
      b.addEventListener("click", onClick);
      return b;
    };
    o.innerHTML = "";
    if (sealed) {
      o.append(lead("sealed: this issue is quarantined, nothing can be posted"));
      return;
    }
    switch (offer.kind) {
      case "give": {
        const label = offer.label;
        if (p.labels.includes(label)) {
          o.append(lead(`#${p.issue} already wears ${label}`));
          return;
        }
        o.append(
          lead("that sounds like a badge"),
          verb(
            `Give ${label}?`,
            { type: "label-add", issue: p.issue, payload: { label } },
            labelColor(labelSet, label),
            false,
          ),
        );
        return;
      }
      case "take": {
        const label = offer.label;
        o.append(
          lead("that sounds like taking a badge"),
          verb(
            `Take ${label}?`,
            { type: "label-remove", issue: p.issue, payload: { label } },
            labelColor(labelSet, label),
            false,
          ),
        );
        return;
      }
      case "release":
        o.append(
          lead("that sounds like a release"),
          verb(
            `Release #${p.issue}?`,
            { type: "close", issue: p.issue, payload: { reason: "completed" } },
            "var(--ok)",
            true,
          ),
          verb(
            "Send through the hourglass?",
            { type: "close", issue: p.issue, payload: { reason: "not_planned" } },
            "var(--portal)",
            true,
          ),
        );
        return;
      default:
        o.append(
          lead("what do you want to do with that?"),
          verb("Say it", { type: "comment", issue: p.issue, payload: { text } }, "var(--ok)", true),
          plain("Just thinking", () => {
            addNote(localStorage, this.cb.repo(), p.issue, text);
            this.pushBubble(p.issue, text, "private");
            this.clearOffer();
          }),
          plain("Ask", () => {
            this.clearOffer();
            const s = lead("asked, nothing posted");
            o.append(s);
          }),
        );
    }
  }

  /** Offline proposals need no grant: the whole thing is a rehearsal. */
  private offlineGrantOk(): boolean {
    return this.cb.offline();
  }

  private pushBubble(issue: number, text: string, state: BubbleState): void {
    const list = this.bubbles.get(issue) ?? [];
    list.push({ text, state });
    this.bubbles.set(issue, list);
    this.renderBubbles(issue);
  }

  private renderBubbles(issue: number): void {
    const el = this.root.querySelector<HTMLElement>("#dlg-bubbles");
    if (!el || this.current?.issue !== issue) return;
    const notes = listNotes(localStorage, this.cb.repo(), issue);
    const session = this.bubbles.get(issue) ?? [];
    const items: Bubble[] = [
      ...notes
        .filter((n) => !session.some((b) => b.state === "private" && b.text === n))
        .map((text) => ({ text, state: "private" as const })),
      ...session,
    ];
    const seal: Record<BubbleState, string> = {
      pending: "sending",
      posted: "posted",
      practice: "practice",
      private: "private",
    };
    el.innerHTML = items
      .map(
        (b) =>
          `<div class="bubble ${b.state}"><span class="seal">${seal[b.state]}</span>${escapeHtml(b.text)}</div>`,
      )
      .join("");
  }
}

function offlineReply(text: string, intent: Intent, p: Placement): string {
  switch (intent.choice) {
    case "verify":
      return `You want to release me. The server is away, so this would be a rehearsal: hold the chip and watch what happens.`;
    case "label":
      return `A badge, then: ${intent.label}. Offline I can only wear it as a ghost.`;
    case "defer":
      return `Later it is. I will wait where I stand.`;
    case "need_more":
      return `I only know my record: "${p.title}". The server is away, so I cannot think harder than that.`;
    default:
      return `I heard: "${text}". The server is away; nothing can be posted, but you can rehearse it.`;
  }
}

function edgeItem(e: Placement["edges"][number]): string {
  const color = EDGE_COLORS[e.type] ?? "#ffffff";
  const arrow = e.direction === "out" ? "→" : e.direction === "in" ? "←" : "↔";
  return `<li title="${escapeHtml(describeEdge(e))}"><i class="edge-glyph ${e.type}" style="--c:${color}"></i><span class="num">${arrow} #${e.to}</span><span class="type">${e.type}</span><span class="w num">${Math.round(e.weight * 100)}%</span></li>`;
}

export const EDGE_COLORS: Record<string, string> = {
  blocks: "#f87171",
  "depends-on": "#fb923c",
  "parent-of": "#facc15",
  "duplicate-of": "#a78bfa",
  "same-code-path": "#38bdf8",
  functional: "#4ade80",
  "user-journey": "#f472b6",
  security: "#ef4444",
};
