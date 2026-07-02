import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import c from "react-syntax-highlighter/dist/esm/languages/prism/c";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import docker from "react-syntax-highlighter/dist/esm/languages/prism/docker";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import graphql from "react-syntax-highlighter/dist/esm/languages/prism/graphql";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import kotlin from "react-syntax-highlighter/dist/esm/languages/prism/kotlin";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import php from "react-syntax-highlighter/dist/esm/languages/prism/php";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import ruby from "react-syntax-highlighter/dist/esm/languages/prism/ruby";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import scss from "react-syntax-highlighter/dist/esm/languages/prism/scss";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import swift from "react-syntax-highlighter/dist/esm/languages/prism/swift";
import toml from "react-syntax-highlighter/dist/esm/languages/prism/toml";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";

import { cn } from "@/lib/cn";
import { usePrefs } from "@/store/prefs";

// Register a curated set of common languages (PrismLight keeps the bundle lean).
const LANGS: Record<string, Parameters<typeof SyntaxHighlighter.registerLanguage>[1]> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  docker,
  go,
  graphql,
  java,
  javascript,
  json,
  jsx,
  kotlin,
  markdown,
  markup,
  php,
  python,
  ruby,
  rust,
  scss,
  sql,
  swift,
  toml,
  tsx,
  typescript,
  yaml,
};
for (const [name, def] of Object.entries(LANGS)) SyntaxHighlighter.registerLanguage(name, def);

// Friendly aliases → registered language names.
const ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  html: "markup",
  xml: "markup",
  svg: "markup",
  "c++": "cpp",
  cs: "csharp",
  rs: "rust",
  golang: "go",
  rb: "ruby",
  kt: "kotlin",
  dockerfile: "docker",
  gql: "graphql",
  postgres: "sql",
  psql: "sql",
};

const LABELS: Record<string, string> = {
  markup: "HTML",
  cpp: "C++",
  csharp: "C#",
  tsx: "TSX",
  jsx: "JSX",
  graphql: "GraphQL",
  css: "CSS",
  scss: "SCSS",
  sql: "SQL",
  json: "JSON",
  yaml: "YAML",
  toml: "TOML",
  php: "PHP",
};

function resolveLang(raw: string | undefined): string {
  const l = (raw ?? "").toLowerCase();
  return ALIASES[l] ?? l;
}
function label(lang: string, raw: string | undefined): string {
  if (LABELS[lang]) return LABELS[lang] as string;
  const base = lang || (raw ?? "");
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "code";
}

/**
 * A syntax-highlighted code block: language label, line numbers, a copy button,
 * and theme-aware highlighting. Loaded lazily (the highlighter + grammars are a
 * separate chunk), so it only weighs in when a message actually contains code.
 */
export function CodeBlock({ code, language }: { code: string; language?: string | undefined }) {
  const theme = usePrefs((s) => s.theme);
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-color-scheme: dark)").matches);

  const lang = resolveLang(language);
  const registered = lang in LANGS;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable */
    }
  };

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-line">
      <div className="flex items-center justify-between border-b border-line bg-surface-2/70 px-3 py-1">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          {label(lang, language)}
        </span>
        <button
          onClick={() => void copy()}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-ink-faint transition hover:bg-surface-2 hover:text-ink"
          title="Copy code"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <SyntaxHighlighter
        language={registered ? lang : "text"}
        style={dark ? oneDark : oneLight}
        showLineNumbers
        wrapLongLines={false}
        customStyle={{
          margin: 0,
          padding: "0.75rem 0",
          background: "transparent",
          fontSize: "0.8rem",
        }}
        codeTagProps={{ style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } }}
        lineNumberStyle={{ minWidth: "2.5em", paddingRight: "1em", opacity: 0.4, userSelect: "none" }}
        className={cn(dark ? "bg-ink/95" : "bg-surface")}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
