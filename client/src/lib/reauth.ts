import { useChatStore } from "@/store/store";

let inFlight = false;

/**
 * Canary stalled because the FruitScope session expired. First try to refresh it
 * silently in a hidden iframe (prompt=none) — if the SSO session is still valid
 * the server refreshes the token and auto-resumes Canary, no interaction. If that
 * fails (needs interaction, cookies blocked, timeout), surface a "sign in to
 * continue" prompt instead.
 */
export function handleCanaryReauth(): void {
  if (inFlight) return;
  inFlight = true;

  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.setAttribute("title", "reauth");
  iframe.src = "/api/auth/login?silent=1";

  const finish = (ok: boolean): void => {
    window.clearTimeout(timer);
    window.removeEventListener("message", onMessage);
    iframe.remove();
    inFlight = false;
    // On success the server already resumed Canary — just clear any prompt.
    useChatStore.getState().setReauthNeeded(!ok);
  };

  const onMessage = (e: MessageEvent): void => {
    if (e.origin !== window.location.origin) return;
    const data = e.data as { type?: string; ok?: boolean } | undefined;
    if (data?.type !== "fruitscope-reauth") return;
    finish(data.ok === true);
  };

  const timer = window.setTimeout(() => finish(false), 6000);
  window.addEventListener("message", onMessage);
  document.body.appendChild(iframe);
}
