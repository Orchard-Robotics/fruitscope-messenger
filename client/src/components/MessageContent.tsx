import type { ID } from "@shared/index";
import { MessageMarkdown } from "./MessageMarkdown";

/**
 * Renders a message: Slack-style markdown formatting + `<@userId>` mention pills.
 * (See MessageMarkdown for the markdown + mention handling.)
 */
export function MessageContent({ content, meId }: { content: string; meId: ID }) {
  return <MessageMarkdown content={content} meId={meId} />;
}
