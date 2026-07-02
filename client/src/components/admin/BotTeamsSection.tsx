import { Bot, Hash, Loader2, Sparkles, Trash2, Users2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { BotTeam, ModelCatalog, Orchard } from "@shared/index";
import { rest } from "@/lib/api";
import { useChatStore } from "@/store/store";
import { Avatar } from "../Avatar";

const errText = (e: unknown): string => (e instanceof Error ? e.message : "Something went wrong.");

/**
 * Admin-only: describe a team of bots, and an LLM designs them (names + system
 * prompts), creates them under a group, and mirrors the group as a channel in the
 * chosen workspace. Also lists + deletes existing teams.
 */
export function BotTeamsSection() {
  const [teams, setTeams] = useState<BotTeam[] | null>(null);
  const [workspaces, setWorkspaces] = useState<Orchard[]>([]);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = () => rest.adminBotTeams().then(setTeams).catch((e) => setLoadError(errText(e)));

  useEffect(() => {
    Promise.all([rest.adminBotTeams(), rest.adminWorkspaces(), rest.llmModels()])
      .then(([t, w, c]) => {
        setTeams(t);
        setWorkspaces(w);
        setCatalog(c);
      })
      .catch((e) => setLoadError(errText(e)));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-5 py-4">
        <span className="grid size-8 place-items-center rounded-lg bg-brand-500/15 text-brand-600">
          <Users2 className="size-4" />
        </span>
        <div>
          <h2 className="text-sm font-bold text-ink">Bot teams</h2>
          <p className="text-xs text-ink-faint">
            Describe a team — an LLM builds the bots, groups them, and makes a channel.
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        {catalog && <CreateTeam workspaces={workspaces} catalog={catalog} onCreated={refresh} />}

        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-faint">
            Existing teams
          </h3>
          {loadError && <p className="text-sm text-danger">{loadError}</p>}
          {!teams && !loadError && (
            <p className="flex items-center gap-2 text-sm text-ink-faint">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </p>
          )}
          {teams && teams.length === 0 && (
            <p className="text-sm text-ink-faint">No teams yet. Create one above.</p>
          )}
          <div className="space-y-3">
            {(teams ?? []).map((team) => (
              <TeamCard key={team.id} team={team} onDeleted={refresh} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateTeam({
  workspaces,
  catalog,
  onCreated,
}: {
  workspaces: Orchard[];
  catalog: ModelCatalog;
  onCreated: () => void;
}) {
  const currentOrchardId = useChatStore((s) => s.orchard?.id);
  const [description, setDescription] = useState("");
  const [orchardId, setOrchardId] = useState(currentOrchardId ?? workspaces[0]?.id ?? "");
  const [groupName, setGroupName] = useState("");
  const [count, setCount] = useState<string>("");
  const [model, setModel] = useState(catalog.defaultModelId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const valid = description.trim().length > 0 && orchardId !== "";

  const generate = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const n = count.trim() ? Math.max(1, Math.min(12, Number(count))) : undefined;
      const team = await rest.createBotTeam({
        description: description.trim(),
        orchardId,
        model,
        ...(n ? { count: n } : {}),
        ...(groupName.trim() ? { groupName: groupName.trim() } : {}),
      });
      setDone(`Created "${team.name}" — ${team.bots.length} bots + a channel.`);
      setDescription("");
      setGroupName("");
      setCount("");
      onCreated();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="size-4 text-brand-600" />
        <h3 className="text-sm font-bold text-ink">Create a team</h3>
      </div>

      <label className="block text-xs font-semibold text-ink-dim">
        Describe the team
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="e.g. A product squad for the AVM orchard: a PM to prioritize, two engineers (frontend + backend), a designer, and a QA that stress-tests ideas. They should debate and hand off to each other."
          className="mt-1 w-full resize-y rounded-lg border border-line bg-surface-2/40 px-3 py-2 text-sm font-normal text-ink outline-none focus:border-brand-400"
        />
      </label>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="text-xs font-semibold text-ink-dim">
          Workspace
          <select
            value={orchardId}
            onChange={(e) => setOrchardId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm font-normal text-ink outline-none focus:border-brand-400"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-ink-dim">
          # of bots
          <input
            value={count}
            onChange={(e) => setCount(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="auto"
            inputMode="numeric"
            className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm font-normal text-ink outline-none focus:border-brand-400"
          />
        </label>
        <label className="col-span-2 text-xs font-semibold text-ink-dim">
          Model
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm font-normal text-ink outline-none focus:border-brand-400"
          >
            {catalog.catalog.map((group) => (
              <optgroup
                key={group.provider}
                label={group.authed ? group.label : `${group.label} (no key)`}
              >
                {group.models.map((m) => (
                  <option key={m.id} value={m.id} disabled={!group.authed}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-3 block text-xs font-semibold text-ink-dim">
        Team name <span className="font-normal text-ink-faint">(optional — the LLM names it if blank)</span>
        <input
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="e.g. AVM Product Squad"
          className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal text-ink outline-none focus:border-brand-400"
        />
      </label>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {done && <p className="mt-3 text-sm text-brand-700">{done}</p>}

      <button
        onClick={() => void generate()}
        disabled={!valid || busy}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {busy ? "Assembling your team…" : "Generate team"}
      </button>
    </div>
  );
}

function TeamCard({ team, onDeleted }: { team: BotTeam; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      await rest.deleteBotTeam(team.id);
      onDeleted();
    } catch (e) {
      setError(errText(e));
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Users2 className="size-4 shrink-0 text-brand-600" />
            <span className="truncate font-semibold text-ink">{team.name}</span>
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-dim">
              {team.orchard.name}
            </span>
          </div>
          {team.channelId && (
            <span className="mt-1 inline-flex items-center gap-1 text-xs text-ink-faint">
              <Hash className="size-3" /> mirrored as a channel
            </span>
          )}
        </div>
        {confirming ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => void remove()}
              disabled={deleting}
              className="rounded-md bg-danger px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete team"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-md px-2 py-1 text-xs font-medium text-ink-dim hover:bg-surface-2"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            title="Delete team (bots + channel)"
            className="grid size-7 shrink-0 place-items-center rounded-md text-ink-faint transition hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>

      {team.description && <p className="mt-2 text-xs text-ink-dim">{team.description}</p>}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {team.bots.map((bot) => (
          <div key={bot.id} className="flex items-center gap-2 rounded-lg bg-surface-2/40 px-2 py-1.5">
            <Avatar user={bot} size={24} className="rounded-lg" />
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{bot.displayName}</span>
            <Bot className="size-3.5 shrink-0 text-ink-faint" />
          </div>
        ))}
        {team.bots.length === 0 && <span className="text-xs text-ink-faint">No bots.</span>}
      </div>
    </div>
  );
}
