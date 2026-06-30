/** Markdown formatting actions applied to a textarea selection (Slack-style). */
export type MdKind =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "codeblock"
  | "quote"
  | "bullet"
  | "ordered"
  | "link";

export interface MdResult {
  value: string;
  selStart: number;
  selEnd: number;
}

/** Inline wrappers + a placeholder used when there's no selection. */
const WRAP: Partial<Record<MdKind, { open: string; close: string; placeholder: string }>> = {
  bold: { open: "**", close: "**", placeholder: "bold text" },
  italic: { open: "_", close: "_", placeholder: "italic" },
  strike: { open: "~~", close: "~~", placeholder: "strikethrough" },
  code: { open: "`", close: "`", placeholder: "code" },
};

/** Apply a markdown transform to `value[start..end]`; returns the new value + selection. */
export function applyMarkdown(value: string, start: number, end: number, kind: MdKind): MdResult {
  const sel = value.slice(start, end);

  const wrap = WRAP[kind];
  if (wrap) {
    const inner = sel || wrap.placeholder;
    const next = value.slice(0, start) + wrap.open + inner + wrap.close + value.slice(end);
    const s = start + wrap.open.length;
    return { value: next, selStart: s, selEnd: s + inner.length };
  }

  if (kind === "link") {
    const text = sel || "link text";
    const url = "https://";
    const inserted = `[${text}](${url})`;
    const next = value.slice(0, start) + inserted + value.slice(end);
    const urlStart = start + 1 + text.length + 2; // "[" + text + "]("
    return { value: next, selStart: urlStart, selEnd: urlStart + url.length };
  }

  if (kind === "codeblock") {
    const inner = sel || "code";
    const before = value.slice(0, start);
    const lead = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    const block = `${lead}\`\`\`\n${inner}\n\`\`\``;
    const next = before + block + value.slice(end);
    const s = start + lead.length + 4; // after the leading "```\n"
    return { value: next, selStart: s, selEnd: s + inner.length };
  }

  // Line-prefix kinds: quote / bullet / ordered — prefix every selected line.
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEndIdx = value.indexOf("\n", end);
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const block = lines
    .map((line, i) => `${kind === "quote" ? "> " : kind === "bullet" ? "- " : `${i + 1}. `}${line}`)
    .join("\n");
  const next = value.slice(0, lineStart) + block + value.slice(lineEnd);
  return { value: next, selStart: lineStart, selEnd: lineStart + block.length };
}
