import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";

/** The team the generator designs from an admin's description. */
export interface GeneratedTeam {
  groupName: string;
  bots: Array<{ displayName: string; role: string; systemPrompt: string }>;
}

const MAX_BOTS = 12;

const teamSchema = z.object({
  groupName: z.string().describe("A short, human name for the whole team (2-4 words)."),
  bots: z
    .array(
      z.object({
        displayName: z
          .string()
          .describe("The bot's name — a short person-like or role name, unique within the team."),
        role: z.string().describe("A one-line summary of this bot's role on the team."),
        systemPrompt: z
          .string()
          .describe(
            "The bot's full system prompt: its expertise, personality, and voice. It MUST tell " +
              "the bot it's one member of a team collaborating in a chat channel, and that to hand " +
              "off to a teammate it should @mention them by name.",
          ),
      }),
    )
    .min(1)
    .max(MAX_BOTS),
});

/**
 * Design a cohesive team of chat bots from a natural-language description. Uses
 * Opus to pick complementary roles, names, and strong system prompts. Returns a
 * validated spec; the caller creates the bots + group + channel.
 */
export async function generateBotTeam(opts: {
  description: string;
  count?: number | undefined;
  groupName?: string | undefined;
}): Promise<GeneratedTeam> {
  const n = opts.count && opts.count > 0 ? Math.min(Math.floor(opts.count), MAX_BOTS) : undefined;

  const system = [
    "You design teams of AI chat bots that will collaborate in a team chat channel.",
    "Given a description, produce a cohesive, complementary team — no two bots redundant.",
    "Each bot gets a distinct name, a clear role, and a strong system prompt.",
    "In every system prompt: define the bot's expertise and personality, state that it is one",
    "member of a team working together in a chat channel, and instruct it to @mention a teammate",
    "by name to hand off or ask for input. Keep each bot focused and useful.",
  ].join(" ");

  const prompt = [
    opts.groupName ? `Team name: ${opts.groupName}.` : "",
    n ? `Create exactly ${n} bots.` : "Choose an appropriate number of bots (between 2 and 8).",
    `Description of the team to build:\n${opts.description}`,
  ]
    .filter(Boolean)
    .join("\n");

  const { object } = await generateObject({
    model: anthropic("claude-opus-4-8"),
    schema: teamSchema,
    system,
    prompt,
  });

  const bots = n ? object.bots.slice(0, n) : object.bots;
  return { groupName: opts.groupName?.trim() || object.groupName, bots };
}
