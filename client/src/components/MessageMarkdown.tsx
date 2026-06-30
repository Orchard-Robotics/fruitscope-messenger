import { memo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import type { ID } from "@shared/index";
import { cn } from "@/lib/cn";
import { useChatStore } from "@/store/store";

const MENTION_RE = /<@([A-Za-z0-9_-]+)>/g;

/**
 * Renders message text as Slack-style markdown — bold/italic/strike, code +
 * code blocks, lists, blockquotes, links — with `<@userId>` mentions as pills
 * and single newlines preserved (remark-breaks). Mentions are encoded as
 * `mention:` links so they compose with surrounding markdown, then swapped for
 * pills by the link renderer.
 */
export const MessageMarkdown = memo(function MessageMarkdown({
  content,
  meId,
}: {
  content: string;
  meId: ID;
}) {
  const md = content.replace(MENTION_RE, (_m, id: string) => `[@](mention:${id})`);

  return (
    <div
      className={cn(
        "text-[15px] leading-relaxed text-ink/90",
        "[&_p]:my-0 [&_p+p]:mt-2 break-words",
        "[&_a]:font-medium [&_a]:text-brand-600 [&_a]:underline [&_a]:underline-offset-2",
        "[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:my-0.5",
        "[&_strong]:font-semibold [&_em]:italic [&_del]:line-through [&_del]:text-ink/60",
        "[&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]",
        "[&_pre]:my-1.5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-surface-2 [&_pre]:p-2.5",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-2.5 [&_blockquote]:text-ink/75",
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        // Keep mention: links (default transform would strip the scheme); still
        // sanitize everything else (e.g. javascript:).
        urlTransform={(url) => (url.startsWith("mention:") ? url : defaultUrlTransform(url))}
        components={{
          a({ href, children }) {
            if (href?.startsWith("mention:")) {
              return <Mention userId={href.slice("mention:".length)} isMe={href.slice("mention:".length) === meId} />;
            }
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
        }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
});

function Mention({ userId, isMe }: { userId: ID; isMe: boolean }) {
  const name = useChatStore((s) => s.users[userId]?.displayName);
  return (
    <span
      className={cn(
        "rounded px-1 font-medium",
        isMe ? "bg-amber-200/80 text-amber-900" : "bg-brand-500/12 text-brand-700",
      )}
    >
      @{name ?? "someone"}
    </span>
  );
}
