import { Loader2, MessageSquareHeart, WifiOff } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { channelTitle, isCanaryDm, isSelfDm } from "@/lib/channel";
import { signOut } from "@/lib/session";
import { useChatStore } from "@/store/store";
import { ChannelHeader } from "./ChannelHeader";
import { Composer } from "./Composer";
import { MasqueradeBanner } from "./MasqueradeBanner";
import { MessageList } from "./MessageList";
import { UserManagementModal } from "./UserManagementModal";

// Code-split: the Canary panel pulls in the AI SDK + markdown renderer, which
// shouldn't weigh down the initial chat bundle. It loads when first opened.
const CanaryPanel = lazy(() =>
  import("./canary/CanaryPanel").then((m) => ({ default: m.CanaryPanel })),
);
import { PreferencesModal } from "./PreferencesModal";
import { ProfileModal } from "./ProfileModal";
import { SearchModal } from "./SearchModal";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function Workspace() {
  const me = useChatStore((s) => s.me);
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const channel = useChatStore((s) => (activeChannelId ? s.channels[activeChannelId] : undefined));
  const users = useChatStore((s) => s.users);
  const meId = me?.id;
  const connected = useChatStore((s) => s.connected);
  // A jump (search result) bumps this for the active channel; it's in the
  // MessageList key so the list remounts centered on the target.
  const jumpToken = useChatStore((s) =>
    s.jumpTarget?.channelId === activeChannelId ? s.jumpTarget.token : 0,
  );

  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);

  // Cmd/Ctrl+K opens search (Slack's quick switcher shortcut).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isCanary = !!channel && !!meId && isCanaryDm(channel, users, meId);

  const placeholder = useMemo(() => {
    if (!channel || !meId) return "Message";
    if (channel.kind === "channel") return `Message #${channel.name}`;
    if (isSelfDm(channel, meId)) return "Jot something down";
    return `Message ${channelTitle(channel, users, meId)}`;
  }, [channel, users, meId]);

  return (
    <div className="relative z-10 flex h-dvh flex-col overflow-hidden">
      <MasqueradeBanner />
      {me && (
        <TopBar
          me={me}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenNav={() => setNavOpen(true)}
          onOpenPrefs={() => setPrefsOpen(true)}
          onEditProfile={() => setProfileOpen(true)}
          onOpenUserManagement={() => setUsersOpen(true)}
          onSignOut={() => void signOut()}
        />
      )}

      <div className="relative flex min-h-0 flex-1">
        {/* Drawer backdrop (mobile only) */}
        {navOpen && (
          <div
            className="absolute inset-0 z-20 bg-black/40 backdrop-blur-sm md:hidden"
            onClick={() => setNavOpen(false)}
          />
        )}

        <Sidebar navOpen={navOpen} onNavigate={() => setNavOpen(false)} />

        <main className="relative flex min-w-0 flex-1 flex-col">
          {!connected && <ConnectionBanner />}
          {channel && activeChannelId ? (
            isCanary ? (
              // Canary's DM is the embedded FruitScope AI assistant, not a thread.
              <Suspense fallback={<PanelLoading />}>
                <CanaryPanel />
              </Suspense>
            ) : (
              <>
                <ChannelHeader />
                <MessageList key={`${activeChannelId}:${jumpToken}`} channelId={activeChannelId} />
                <Composer channelId={activeChannelId} placeholder={placeholder} />
              </>
            )
          ) : (
            <EmptyState />
          )}
        </main>
      </div>

      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <PreferencesModal
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        onEditPhoto={() => {
          setPrefsOpen(false);
          setProfileOpen(true);
        }}
      />
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
      <UserManagementModal open={usersOpen} onClose={() => setUsersOpen(false)} />
    </div>
  );
}

function PanelLoading() {
  return (
    <div className="grid flex-1 place-items-center text-ink-dim">
      <Loader2 className="size-6 animate-spin" />
    </div>
  );
}

function ConnectionBanner() {
  return (
    <div className="flex items-center justify-center gap-2 bg-sun-500/10 py-1.5 text-xs font-medium text-sun-500">
      <WifiOff className="size-3.5" />
      Reconnecting…
    </div>
  );
}

function EmptyState() {
  return (
    <div className="grid flex-1 place-items-center px-6 text-center">
      <div>
        <div className="mx-auto grid size-16 place-items-center rounded-3xl bg-brand-50 text-brand-600">
          <MessageSquareHeart className="size-8" />
        </div>
        <p className="mt-4 font-display text-lg font-semibold text-ink">Pick a place to talk</p>
        <p className="mt-1 text-sm text-ink-dim">Choose a channel or a person from the menu.</p>
      </div>
    </div>
  );
}
