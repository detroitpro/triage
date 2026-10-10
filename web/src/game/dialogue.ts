import type { NpcForm, Placement, Region } from "../../../src/world/types.ts";
import { describeEdge, localAnswer, PROMPTS, type Prompt } from "../pure/dialogueText.ts";
import { escapeHtml } from "./mapScreen.ts";

export interface DialogueCallbacks {
  isReviewed(issue: number): boolean;
  setReviewed(issue: number, on: boolean): void;
  /** Draw (or clear) connection lines in the world. */
  showEdges(issue: number | null): void;
  onClose(): void;
  fetchFn?: typeof fetch;
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

export class Dialogue {
  private root: HTMLElement;
  open = false;
  current: Placement | null = null;

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
          <div class="labels">${p.labels.map((l) => `<span>${escapeHtml(l)}</span>`).join("")}</div>
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
    for (const b of chips) {
      b.addEventListener("click", () => {
        for (const c of chips) c.classList.toggle("active", c === b);
        const prompt = PROMPTS[Number(b.dataset.prompt)] as Prompt;
        setAnswer(localAnswer(prompt, p, region));
        if (prompt === "Who are you connected to?") {
          this.cb.showEdges(p.issue);
          if (edges) edges.innerHTML = p.edges.map((e) => edgeItem(e)).join("");
        }
      });
    }
    const input = this.root.querySelector<HTMLInputElement>("#dlg-input");
    const send = async () => {
      const text = input?.value.trim();
      if (!text || !input) return;
      input.value = "";
      for (const c of chips) c.classList.remove("active");
      setAnswer("…", true);
      const reply = await postDialogue(p.issue, text, this.cb.fetchFn ?? fetch);
      setAnswer(reply);
    };
    this.root.querySelector("#dlg-send")?.addEventListener("click", () => void send());
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void send();
      e.stopPropagation();
    });
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
    chips[0]?.click();
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.current = null;
    this.root.classList.add("hidden");
    this.cb.showEdges(null);
    this.cb.onClose();
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

export async function postDialogue(
  issue: number,
  text: string,
  fetchFn: typeof fetch,
): Promise<string> {
  try {
    const res = await fetchFn("/api/dialogue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issue, text }),
    });
    if (!res.ok) return "dialogue server not running (dry run)";
    const data = (await res.json()) as { reply?: string; text?: string };
    return data.reply ?? data.text ?? JSON.stringify(data);
  } catch {
    return "dialogue server not running (dry run)";
  }
}
