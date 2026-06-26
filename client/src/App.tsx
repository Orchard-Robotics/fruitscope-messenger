import { useEffect, useRef, useState } from "react";

import { rest } from "@/lib/api";
import { connectSocket, disconnectSocket } from "@/lib/socket";
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

  // Resume an existing session from the httpOnly cookie on first load.
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    const store = useChatStore.getState();
    void (async () => {
      try {
        const me = await rest.me();
        store.signIn(me);
        connectSocket();
        store.loadBootstrap(await rest.bootstrap());
      } catch {
        disconnectSocket();
        store.setSession("anon");
      }
    })();
  }, []);

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
