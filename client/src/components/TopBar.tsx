import { Menu, Search } from "lucide-react";
import { useState } from "react";

import type { User } from "@shared/index";
import { AccountMenu } from "./AccountMenu";
import { Avatar } from "./Avatar";
import { Logo } from "./Logo";
import { NotificationBell } from "./NotificationBell";
import { PresenceDot } from "./PresenceDot";

/**
 * Global top bar (Slack-style): brand on the left, a centered search box, and the
 * account avatar + menu on the right — so those controls aren't crammed into the
 * narrow sidebar.
 */
export function TopBar({
  me,
  onOpenSearch,
  onOpenNav,
  onOpenPrefs,
  onEditProfile,
  onOpenUserManagement,
  onSignOut,
}: {
  me: User;
  onOpenSearch: () => void;
  onOpenNav: () => void;
  onOpenPrefs: () => void;
  onEditProfile: () => void;
  onOpenUserManagement: () => void;
  onSignOut: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-raised px-3">
      <button
        onClick={onOpenNav}
        className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-dim transition hover:bg-surface-2 md:hidden"
        aria-label="Open menu"
      >
        <Menu className="size-5" />
      </button>

      <div className="flex shrink-0 items-center gap-2">
        <Logo className="size-7" />
        <span className="hidden font-display text-sm font-bold text-ink sm:block">
          FruitScope Messenger
        </span>
      </div>

      <div className="flex flex-1 justify-center">
        <button
          onClick={onOpenSearch}
          className="flex w-full max-w-md items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-left text-ink-faint transition hover:border-brand-300 hover:text-ink-dim"
        >
          <Search className="size-4" />
          <span className="flex-1 text-sm">Search messages, channels, people…</span>
          <kbd className="hidden rounded border border-line bg-raised px-1.5 py-0.5 text-[10px] font-medium text-ink-faint sm:block">
            ⌘K
          </kbd>
        </button>
      </div>

      <NotificationBell />

      <div className="relative shrink-0">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="grid place-items-center rounded-lg p-0.5 transition hover:bg-surface-2"
          title="Account & preferences"
        >
          <span className="relative block">
            <Avatar user={me} size={32} />
            <PresenceDot
              status={me.status}
              className="absolute -bottom-0.5 -right-0.5"
              ring="ring-raised"
            />
          </span>
        </button>

        {menuOpen && (
          <AccountMenu
            me={me}
            onClose={() => setMenuOpen(false)}
            onOpenPrefs={onOpenPrefs}
            onEditProfile={onEditProfile}
            onOpenUserManagement={onOpenUserManagement}
            onSignOut={onSignOut}
          />
        )}
      </div>
    </header>
  );
}
