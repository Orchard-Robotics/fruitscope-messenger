import { create } from "zustand";

import type { CanaryConversation } from "@/lib/canary";

/**
 * Shared UI state for Canary, so the sidebar (which lists conversations under the
 * pinned Canary row) and the chat panel stay in sync.
 *
 * The panel is the source of truth: it publishes the active orchard + its
 * conversation list + which conversation is open. The sidebar reads those and,
 * to open one, raises an `openRequest` the panel consumes (after also opening the
 * Canary DM so the panel is on screen).
 */
interface CanaryUiState {
  /** The orchard the listed conversations belong to. */
  orchard: string;
  conversations: CanaryConversation[];
  activeConversationId: string | null;
  /** Whether the conversation tree is expanded under the sidebar's Canary row. */
  expanded: boolean;
  /** A request (from the sidebar) for the panel to open a conversation. */
  openRequest: { id: string; token: number } | null;

  /** Panel → store: publish the current orchard + conversation list. */
  publish: (orchard: string, conversations: CanaryConversation[]) => void;
  setActiveConversationId: (id: string | null) => void;
  setExpanded: (expanded: boolean) => void;
  /** Sidebar → panel: ask the panel to open a conversation. */
  requestOpen: (id: string) => void;
  consumeOpenRequest: () => void;
}

export const useCanaryUi = create<CanaryUiState>((set) => ({
  orchard: "",
  conversations: [],
  activeConversationId: null,
  expanded: false,
  openRequest: null,

  publish: (orchard, conversations) => set({ orchard, conversations }),
  setActiveConversationId: (activeConversationId) => set({ activeConversationId }),
  setExpanded: (expanded) => set({ expanded }),
  requestOpen: (id) =>
    set((s) => ({
      activeConversationId: id,
      openRequest: { id, token: (s.openRequest?.token ?? 0) + 1 },
    })),
  consumeOpenRequest: () => set({ openRequest: null }),
}));
