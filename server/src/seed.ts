import { nanoid } from "nanoid";

import type { UserStatus } from "@shared/index";
import { prisma } from "./prisma";

interface SeedUser {
  id: string;
  username: string;
  displayName: string;
  hue: number;
  status: UserStatus;
}

const mkUser = (
  username: string,
  displayName: string,
  hue: number,
  status: UserStatus,
): SeedUser => ({ id: nanoid(10), username, displayName, hue, status });

/**
 * Populates a believable little workspace the first time the DB is empty so the
 * app looks alive (and screenshots well) before any real users sign in.
 */
export async function seed(): Promise<void> {
  if ((await prisma.user.count()) > 0) return;

  const willow = mkUser("willow", "Willow Vale", 96, "online");
  const fern = mkUser("fern", "Fern Okafor", 150, "online");
  const sol = mkUser("sol", "Sol Castellanos", 42, "away");
  const moss = mkUser("moss", "Moss Byrne", 122, "offline");
  const robin = mkUser("robin", "Robin Asher", 196, "online");
  const people = [willow, fern, sol, moss, robin];

  const start = Date.now() - 1000 * 60 * 60 * 5;
  await prisma.user.createMany({
    data: people.map((u) => ({ ...u, createdAt: new Date(start) })),
  });

  const channelDefs = [
    { key: "general", topic: "Welcome to Verdant 🌱 — say hello!", by: willow },
    { key: "solarpunk", topic: "Greener futures, brighter cities ☀️", by: fern },
    { key: "engineering", topic: "Shipping the canopy, one commit at a time", by: robin },
    { key: "random", topic: "Off-topic, memes and good vibes", by: sol },
  ];

  const channelId: Record<string, string> = {};
  for (const def of channelDefs) {
    const id = nanoid(10);
    channelId[def.key] = id;
    await prisma.channel.create({
      data: {
        id,
        kind: "channel",
        name: def.key,
        topic: def.topic,
        isPrivate: false,
        createdAt: new Date(start),
        createdBy: { connect: { id: def.by.id } },
        members: {
          create: people.map((u) => ({
            user: { connect: { id: u.id } },
            joinedAt: new Date(start),
          })),
        },
      },
    });
  }

  let clock = start;
  const tick = (minutes: number): Date => {
    clock += minutes * 60_000;
    return new Date(clock);
  };

  const script: Array<{
    channel: string;
    author: SeedUser;
    text: string;
    gap: number;
    reacts?: Array<{ emoji: string; by: SeedUser }>;
  }> = [
    { channel: "general", author: willow, text: "Morning everyone 🌿 the greenhouse dashboard is live!", gap: 2, reacts: [{ emoji: "🌱", by: fern }, { emoji: "🎉", by: robin }] },
    { channel: "general", author: robin, text: "Beautiful work Willow. The solar uptime chart is gorgeous.", gap: 3 },
    { channel: "general", author: fern, text: "Adding it to the community wiki today 💚", gap: 4, reacts: [{ emoji: "💚", by: willow }] },
    { channel: "solarpunk", author: fern, text: "New rooftop garden proposal is up for review ☀️🍃", gap: 6, reacts: [{ emoji: "☀️", by: sol }, { emoji: "🍃", by: robin }, { emoji: "🌿", by: willow }] },
    { channel: "solarpunk", author: sol, text: "Love it. Can we get pollinator corridors between the blocks?", gap: 5 },
    { channel: "solarpunk", author: fern, text: "Already sketched — bees first 🐝", gap: 3, reacts: [{ emoji: "🌱", by: sol }] },
    { channel: "engineering", author: robin, text: "Socket reconnection logic merged. Latency down to ~12ms locally 🔥", gap: 7, reacts: [{ emoji: "🔥", by: willow }, { emoji: "👏", by: fern }] },
    { channel: "engineering", author: willow, text: "Blazing. Let's profile the message list virtualisation next.", gap: 4 },
    { channel: "random", author: sol, text: "Found this trailing rosemary for the office windowsill 🌿", gap: 9 },
    { channel: "random", author: robin, text: "It's thriving. Unlike my succulents 😅", gap: 2, reacts: [{ emoji: "🍃", by: sol }] },
  ];

  for (const line of script) {
    const id = channelId[line.channel];
    if (!id) continue;
    await prisma.message.create({
      data: {
        id: nanoid(12),
        content: line.text,
        createdAt: tick(line.gap),
        channel: { connect: { id } },
        author: { connect: { id: line.author.id } },
        ...(line.reacts
          ? {
              reactions: {
                create: line.reacts.map((r) => ({
                  emoji: r.emoji,
                  user: { connect: { id: r.by.id } },
                })),
              },
            }
          : {}),
      },
    });
  }

  console.log(`🌱 Seeded ${people.length} people and ${channelDefs.length} channels`);
}
