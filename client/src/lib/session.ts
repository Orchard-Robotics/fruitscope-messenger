import { rest } from "@/lib/api";
import { disconnectSocket } from "@/lib/socket";
import { useChatStore } from "@/store/store";

/** Sign out: drop the socket, clear the server session + cookie, reset state. */
export async function signOut(): Promise<void> {
  disconnectSocket();
  await rest.logout().catch(() => {}); // best-effort
  useChatStore.getState().signOut();
}
