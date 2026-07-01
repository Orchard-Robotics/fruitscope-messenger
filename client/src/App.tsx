import { useEffect, useRef, useState } from "react";

import { rest } from "@/lib/api";
import { clearMessageLink, openMessageLink, readMessageLink } from "@/lib/messageLink";
import { ensureNotificationPermission } from "@/lib/notifications";
import { connectSocket, disconnectSocket } from "@/lib/socket";
import { usePrefs } from "@/store/prefs";
import { useChatStore } from "@/store/store";
import { Login } from "./components/Login";
import { Logo } from "./components/Logo";
import { Workspace } from "./components/Workspace";

/** Pull (and clear) a `?login_error=…` left by the OIDC callback redirect. */
function takeLoginError(): string | null {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("login_error");
  if (!code) return null;
  params.delete("login_error");
  const qs = params.toString();
  window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  return code;
}

export function App() {
  const session = useChatStore((s) => s.session);
  const didInit = useRef(false);
  const [loginError] = useState(takeLoginError);
  // Capture any shared message deep link before bootstrap, then open it after.
  const [deepLink] = useState(readMessageLink);

  // Resume an existing session from the httpOnly cookie on first load.
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    const store = useChatStore.getState();
    void (async () => {
      try {
        // `bootstrap` already includes `me`, so skip a separate `/me` round-trip.
        // Open the socket in parallel with the bootstrap fetch so first paint
        // isn't gated on a request waterfall.
        connectSocket();
        store.loadBootstrap(await rest.bootstrap());
        // Now the channels are loaded — if we arrived via a message link, jump to it.
        if (deepLink) {
          void openMessageLink(deepLink.channelId, deepLink.messageId);
          clearMessageLink();
        }
        // Ask for desktop-notification permission so @mentions can alert you
        // (best-effort; if the browser defers it, the Preferences toggle re-asks).
        if (usePrefs.getState().mentionNotifications) void ensureNotificationPermission();
      } catch {
        disconnectSocket();
        store.setSession("anon");
      }
    })();
  }, [deepLink]);

  if (session === "loading") return <Splash />;
  if (session === "anon") return <Login error={loginError} />;
  return <Workspace />;
}

function Splash() {
  return (
    <div className="relative grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-3 text-ink-dim">
        <Logo className="size-12 animate-pulse" />
        <p className="text-sm">Loading FruitScope Messenger…</p>
      </div>
    </div>
  );
}
