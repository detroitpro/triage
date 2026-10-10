export interface TriageItem {
  source?: string;
  title?: string;
  body: string;
}

/** Accepts a JSON object (`{ title, body, source }`) or plain text (treated as the body). */
export function parseItem(raw: string): TriageItem {
  const text = raw.trim();
  if (text.startsWith("{")) {
    const data: unknown = JSON.parse(text);
    if (
      typeof data !== "object" ||
      data === null ||
      typeof (data as TriageItem).body !== "string"
    ) {
      throw new Error("JSON input must be an object with a string `body`");
    }
    const { source, title, body } = data as TriageItem;
    return {
      body,
      ...(typeof source === "string" ? { source } : {}),
      ...(typeof title === "string" ? { title } : {}),
    };
  }
  if (!text) throw new Error("empty input");
  return { body: text };
}
