import { Leaf } from "lucide-react";
import { useEffect, useRef } from "react";

import { rest, tokenStore } from "@/lib/api";
import { connectSocket, disconnectSocket } from "@/lib/socket";
import { useChatStore } from "@/store/store";
import { Login } from "./components/Login";
import { Workspace } from "./components/Workspace";

export function App() {
  const session = useChatStore((s) => s.session);
  const didInit = useRef(false);

  // Resume an existing session from a stored token on first load.
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    const store = useChatStore.getState();
    const token = tokenStore.get();
    if (!token) {
      store.setSession("anon");
      return;
    }

    void (async () => {
      try {
        const me = await rest.me(token);
        store.signIn(token, me);
        connectSocket(token);
        store.loadBootstrap(await rest.bootstrap(token));
      } catch {
        tokenStore.clear();
        disconnectSocket();
        store.signOut();
      }
    })();
  }, []);

  const handleLogin = async (username: string, displayName?: string) => {
    const store = useChatStore.getState();
    const { token, user } = await rest.login(username, displayName);
    tokenStore.set(token);
    store.signIn(token, user);
    connectSocket(token);
    store.loadBootstrap(await rest.bootstrap(token));
  };

  return (
    <>
      <div className="aurora" aria-hidden>
        <span />
        <span />
        <span />
      </div>

      {session === "loading" ? (
        <Splash />
      ) : session === "anon" ? (
        <Login onLogin={handleLogin} />
      ) : (
        <Workspace />
      )}
    </>
  );
}

function Splash() {
  return (
    <div className="relative grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-3 text-ink-dim">
        <div className="grid size-12 animate-pulse place-items-center rounded-2xl bg-gradient-to-br from-leaf-400 to-leaf-600 text-bark-950">
          <Leaf className="size-6" strokeWidth={2.5} />
        </div>
        <p className="text-sm">Growing your grove…</p>
      </div>
    </div>
  );
}
