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

interface SeedLine {
  channel: string;
  author: SeedUser;
  text: string;
  gap: number;
  reacts?: Array<{ emoji: string; by: SeedUser }>;
}

interface OrchardSpec {
  code: string;
  name: string;
  people: SeedUser[];
  channels: Array<{ key: string; topic: string; by: SeedUser }>;
  script: SeedLine[];
}

async function seedOrchard(spec: OrchardSpec, start: number): Promise<void> {
  const orchardId = nanoid(10);
  await prisma.orchard.create({
    data: { id: orchardId, code: spec.code, name: spec.name, createdAt: new Date(start) },
  });

  for (const u of spec.people) {
    await prisma.user.upsert({
      where: { id: u.id },
      create: { ...u, createdAt: new Date(start) },
      update: {},
    });
    await prisma.orchardMembership.create({
      data: { orchardId, userId: u.id, joinedAt: new Date(start) },
    });
  }

  const channelId: Record<string, string> = {};
  for (const def of spec.channels) {
    const id = nanoid(10);
    channelId[def.key] = id;
    await prisma.channel.create({
      data: {
        id,
        orchard: { connect: { id: orchardId } },
        kind: "channel",
        name: def.key,
        topic: def.topic,
        isPrivate: false,
        createdAt: new Date(start),
        createdBy: { connect: { id: def.by.id } },
        members: {
          create: spec.people.map((u) => ({
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

  for (const line of spec.script) {
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
}

/**
 * Populates two fully-isolated orchards the first time the DB is empty, so the
 * per-orchard scoping is obvious (different members, channels and history).
 */
export async function seed(): Promise<void> {
  if ((await prisma.user.count()) > 0) return;

  const start = Date.now() - 1000 * 60 * 60 * 5;

  const willow = mkUser("willow", "Willow Vale", 96, "online");
  const fern = mkUser("fern", "Fern Okafor", 150, "online");
  const sol = mkUser("sol", "Sol Castellanos", 42, "away");

  const robin = mkUser("robin", "Robin Asher", 196, "online");
  const moss = mkUser("moss", "Moss Byrne", 122, "offline");
  const dale = mkUser("dale", "Dale Whitmore", 280, "online");

  const sunrise: OrchardSpec = {
    code: "SUN",
    name: "Sunrise Orchard",
    people: [willow, fern, sol],
    channels: [
      { key: "general", topic: "Welcome to Sunrise Orchard 🌅 — say hello!", by: willow },
      { key: "harvest", topic: "Picking schedules & yield numbers 🍎", by: fern },
      { key: "random", topic: "Off-topic & good vibes", by: sol },
    ],
    script: [
      { channel: "general", author: willow, text: "Morning team 🌿 row 14 is ready for the scanner today.", gap: 2, reacts: [{ emoji: "🌱", by: fern }] },
      { channel: "general", author: fern, text: "On it — calibrating now.", gap: 3 },
      { channel: "harvest", author: fern, text: "Block A is trending 8% over last week's yield 🍎", gap: 6, reacts: [{ emoji: "🎉", by: willow }, { emoji: "🔥", by: sol }] },
      { channel: "harvest", author: sol, text: "Beautiful. Let's hold the south rows one more day.", gap: 4 },
      { channel: "random", author: sol, text: "Coffee's on in the packing shed ☀️", gap: 8 },
    ],
  };

  const valley: OrchardSpec = {
    code: "VAL",
    name: "Valley Grove",
    people: [robin, moss, dale],
    channels: [
      { key: "general", topic: "Welcome to Valley Grove 🌾 — say hello!", by: robin },
      { key: "logistics", topic: "Bins, trucks & cold storage 🚚", by: dale },
      { key: "weather", topic: "Frost watch and forecasts ❄️", by: moss },
    ],
    script: [
      { channel: "general", author: robin, text: "Hey Valley 👋 new scan drone arrives Thursday.", gap: 2, reacts: [{ emoji: "🎉", by: dale }] },
      { channel: "logistics", author: dale, text: "Two reefer trucks booked for the Friday pull.", gap: 5, reacts: [{ emoji: "👏", by: robin }] },
      { channel: "weather", author: moss, text: "Possible frost Sunday night — prepping the wind machines ❄️", gap: 7, reacts: [{ emoji: "🍃", by: dale }] },
      { channel: "weather", author: robin, text: "Thanks Moss. I'll top off the fuel.", gap: 3 },
    ],
  };

  await seedOrchard(sunrise, start);
  await seedOrchard(valley, start);

  console.log("🌱 Seeded 2 orchards (Sunrise Orchard, Valley Grove)");
}
