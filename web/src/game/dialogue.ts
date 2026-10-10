import type { Placement, Region } from "../../../src/world/types.ts";
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
    this.root.innerHTML = `<div class="panel">
      <h2>#${p.issue} ${escapeHtml(p.title)}</h2>
      <div class="labels">${p.labels.map((l) => `<span>${escapeHtml(l)}</span>`).join("")}</div>
      <p style="font-size:14px">${escapeHtml(p.summary)}</p>
      <div class="dims">area ${escapeHtml(d.functionalArea)} · code ${escapeHtml(d.codeArea)} · complexity ${d.complexity} · security ${d.security} · kind ${escapeHtml(d.kind)} · actionable ${Math.round(d.actionable * 100)}% · centrality ${p.centrality.toFixed(2)}</div>
      ${q ? `<p class="warn">Quarantined: this issue's text looked like a prompt injection. Dialogue is read-only.</p>` : ""}
      <div id="dlg-prompts">${PROMPTS.map((t, i) => `<button class="btn" data-prompt="${i}" type="button">${t}</button>`).join("")}</div>
      <div class="answer" id="dlg-answer">…</div>
      <ul class="edge-list" id="dlg-edges"></ul>
      <div class="row">
        <input id="dlg-input" placeholder="Say something to #${p.issue}…" ${q ? "disabled" : ""} />
        <button class="btn" id="dlg-send" type="button" ${q ? "disabled" : ""}>Send</button>
      </div>
      <div class="row">
        <button class="btn ${this.cb.isReviewed(p.issue) ? "" : "primary"}" id="dlg-review" type="button">${this.cb.isReviewed(p.issue) ? "Unmark reviewed" : "Mark reviewed"}</button>
        <a class="btn" href="${escapeHtml(p.url)}" target="_blank" rel="noreferrer">Open on GitHub</a>
        <button class="btn" id="dlg-close" type="button">Close (Esc)</button>
      </div>
    </div>`;
    const answer = this.root.querySelector<HTMLElement>("#dlg-answer");
    const edges = this.root.querySelector<HTMLElement>("#dlg-edges");
    for (const b of this.root.querySelectorAll<HTMLElement>("[data-prompt]")) {
      b.addEventListener("click", () => {
        const prompt = PROMPTS[Number(b.dataset.prompt)] as Prompt;
        if (answer) answer.textContent = localAnswer(prompt, p, region);
        if (prompt === "Who are you connected to?") {
          this.cb.showEdges(p.issue);
          if (edges)
            edges.innerHTML = p.edges
              .map(
                (e) =>
                  `<li><span style="color:${EDGE_COLORS[e.type]}">●</span> ${escapeHtml(describeEdge(e))}</li>`,
              )
              .join("");
        }
      });
    }
    const input = this.root.querySelector<HTMLInputElement>("#dlg-input");
    const send = async () => {
      const text = input?.value.trim();
      if (!text || !input) return;
      input.value = "";
      if (answer) answer.textContent = "…";
      const reply = await postDialogue(p.issue, text, this.cb.fetchFn ?? fetch);
      if (answer) answer.textContent = reply;
    };
    this.root.querySelector("#dlg-send")?.addEventListener("click", () => void send());
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void send();
      e.stopPropagation();
    });
    this.root.querySelector("#dlg-review")?.addEventListener("click", () => {
      this.cb.setReviewed(p.issue, !this.cb.isReviewed(p.issue));
      this.show(p, region);
    });
    this.root.querySelector("#dlg-close")?.addEventListener("click", () => this.hide());
    const firstBtn = this.root.querySelector<HTMLElement>("[data-prompt]");
    firstBtn?.click();
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
