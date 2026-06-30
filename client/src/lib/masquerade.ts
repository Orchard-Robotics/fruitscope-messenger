import { rest } from "@/lib/api";

/**
 * Start/stop masquerading. Both reload the app so everything — bootstrap, the
 * socket, the whole GUI — re-initializes as the EFFECTIVE user (the masqueraded
 * user, or back to the admin). A reload is the simplest way to guarantee no stale
 * identity lingers in the socket or store.
 */
export async function startMasquerade(userId: string): Promise<void> {
  await rest.masquerade(userId);
  window.location.reload();
}

export async function stopMasquerade(): Promise<void> {
  await rest.stopMasquerade();
  window.location.reload();
}
