import { ArrowRight } from "lucide-react";
import { useState } from "react";

import { LOGIN_URL } from "@/lib/api";
import { Logo } from "./Logo";

/** Friendly copy for the `?login_error=…` codes set by the OIDC callback. */
const ERROR_COPY: Record<string, string> = {
  unconfigured: "Sign-in isn't configured yet. Please try again later.",
  unavailable: "The sign-in service is temporarily unavailable. Please try again.",
  expired: "Your sign-in attempt timed out. Please try again.",
  auth_failed: "We couldn't sign you in. Please try again.",
  no_orchard: "Your FruitScope account isn't assigned to an orchard yet.",
};

export function Login({ error }: { error?: string | null }) {
  const [busy, setBusy] = useState(false);

  const signIn = () => {
    setBusy(true);
    window.location.href = LOGIN_URL;
  };

  return (
    <div className="glow glow-breathe relative grid min-h-dvh place-items-center overflow-hidden px-6">
      <div className="anim-card-in relative z-10 w-full max-w-md rounded-3xl border border-line bg-raised p-8 shadow-floating">
        <div className="mb-7 flex items-center gap-3">
          <Logo className="size-12" />
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
              FruitScope Messenger
            </h1>
            <p className="text-sm text-ink-dim">Fast, real-time team chat.</p>
          </div>
        </div>

        <p className="mb-6 text-sm text-ink-dim">
          Sign in with your FruitScope account to join your orchard's workspace.
        </p>

        {error && (
          <p className="mb-4 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
            {ERROR_COPY[error] ?? "Something went wrong signing in. Please try again."}
          </p>
        )}

        <button
          type="button"
          onClick={signIn}
          disabled={busy}
          className="group flex w-full items-center justify-center gap-2 rounded-full bg-brand-500 px-4 py-3 font-semibold text-white shadow-soft transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Redirecting…" : "Sign in with FruitScope"}
          <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
        </button>

        <p className="mt-6 text-center text-xs text-ink-faint">
          You'll be redirected to login.fruitscope.com to authenticate.
        </p>
      </div>
    </div>
  );
}
