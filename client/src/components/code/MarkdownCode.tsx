import { type ComponentPropsWithoutRef, lazy, Suspense } from "react";

// The highlighter (Prism + grammars) is a heavy, lazy chunk — it loads only when
// a message actually renders a fenced code block.
const CodeBlock = lazy(() => import("./CodeBlock").then((m) => ({ default: m.CodeBlock })));

/**
 * The `code` renderer for react-markdown. Inline code stays a lightweight
 * `<code>`; a fenced block (has a language, or spans multiple lines) upgrades to
 * the syntax-highlighted CodeBlock, with a plain preformatted fallback shown
 * instantly while the highlighter loads.
 *
 * Pair with a pass-through `pre` (see `markdownComponents`) so the block isn't
 * double-wrapped in a `<pre>`.
 */
export function MarkdownCode({ className, children, ...props }: ComponentPropsWithoutRef<"code">) {
  const text = String(children ?? "").replace(/\n$/, "");
  const match = /language-([\w+#-]+)/.exec(className ?? "");
  const isBlock = !!match || text.includes("\n");

  if (!isBlock) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  return (
    <Suspense
      fallback={
        <pre className="my-2 overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 text-[0.8rem]">
          <code>{text}</code>
        </pre>
      }
    >
      <CodeBlock code={text} language={match?.[1]} />
    </Suspense>
  );
}

/** react-markdown `components` for code: highlighted blocks + un-wrapped `pre`. */
export const markdownComponents = {
  code: MarkdownCode,
  // The CodeBlock owns its own container, so don't wrap it in another <pre>.
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
};
