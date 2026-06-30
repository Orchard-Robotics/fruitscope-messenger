import { Bot, Building2, MessagesSquare, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import { BotsSection } from "./BotsSection";
import { ConversationsSection } from "./ConversationsSection";
import { MembersSection } from "./MembersSection";
import { WorkspacesSection } from "./WorkspacesSection";

type Section = "members" | "bots" | "workspaces" | "conversations";

const NAV: ReadonlyArray<readonly [Section, typeof Users, string]> = [
  ["members", Users, "Members"],
  ["bots", Bot, "Bots"],
  ["workspaces", Building2, "Workspaces"],
  ["conversations", MessagesSquare, "Conversations"],
];

/** Admin-only console: members + view-as, bot management, workspaces (create +
 *  sync), and the conversation monitor — one cohesive surface. */
export function AdminConsole({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [section, setSection] = useState<Section>("members");

  useEffect(() => {
    if (!open) return;
    setSection("members");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="anim-fade-in fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="anim-card-in relative z-10 flex h-[44rem] max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-line bg-raised shadow-2xl shadow-ink/10">
        {/* Left nav */}
        <nav className="flex w-52 shrink-0 flex-col border-r border-line bg-surface p-3">
          <div className="flex items-center justify-between gap-2 px-2 pb-3">
            <p className="font-display text-base font-bold text-ink">Admin console</p>
            <button
              onClick={onClose}
              className="grid size-7 place-items-center rounded-lg text-ink-dim transition hover:bg-surface-2 hover:text-ink"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
          {NAV.map(([key, Icon, label]) => (
            <button
              key={key}
              onClick={() => setSection(key)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition",
                section === key
                  ? "bg-brand-500/12 font-medium text-brand-700"
                  : "text-ink-dim hover:bg-surface-2 hover:text-ink",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </nav>

        {/* Active section */}
        <div className="flex min-h-0 flex-1 flex-col">
          {section === "members" && <MembersSection />}
          {section === "bots" && <BotsSection />}
          {section === "workspaces" && <WorkspacesSection />}
          {section === "conversations" && <ConversationsSection />}
        </div>
      </div>
    </div>,
    document.body,
  );
}
