import { Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { rest } from "@/lib/api";
import { useChatStore } from "@/store/store";
import { Avatar } from "./Avatar";
import { Modal } from "./Modal";

const MAX_MB = 8;

export function ProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useChatStore((s) => s.me);
  const setMe = useChatStore((s) => s.setMe);

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local object-URL preview of the chosen file (revoked on change/unmount).
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Reset transient state each time the modal closes.
  useEffect(() => {
    if (!open) {
      setFile(null);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  if (!me) return null;

  const pick = (f: File | null): void => {
    setError(null);
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("Please choose an image file");
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setError(`Image too large (max ${MAX_MB}MB)`);
      return;
    }
    setFile(f);
  };

  const save = async (): Promise<void> => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      setMe(await rest.uploadAvatar(file));
      setFile(null);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setMe(await rest.removeAvatar());
      setFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove photo");
    } finally {
      setBusy(false);
    }
  };

  // Show the pending file if one is chosen, otherwise the current avatar.
  const previewUser = {
    displayName: me.displayName,
    hue: me.hue,
    avatarUrl: preview ?? me.avatarUrl,
  };

  return (
    <Modal open={open} onClose={onClose} title="Profile picture">
      <div className="flex flex-col items-center gap-5">
        <Avatar user={previewUser} size={128} className="rounded-2xl" />

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex w-full flex-col gap-2">
          {!file && (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-brand-500 px-4 py-2.5 font-semibold text-white shadow-soft transition hover:bg-brand-600 disabled:opacity-50"
            >
              <Upload className="size-4" /> {me.avatarUrl ? "Change photo" : "Upload a photo"}
            </button>
          )}

          {file && (
            <div className="flex gap-2">
              <button
                onClick={() => void save()}
                disabled={busy}
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-brand-500 px-4 py-2.5 font-semibold text-white shadow-soft transition hover:bg-brand-600 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save photo"}
              </button>
              <button
                onClick={() => {
                  setFile(null);
                  setError(null);
                }}
                disabled={busy}
                className="rounded-full border border-line px-4 py-2.5 font-medium text-ink-dim transition hover:bg-surface-2 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          )}

          {me.avatarUrl && !file && (
            <button
              onClick={() => void remove()}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 font-medium text-ink-dim transition hover:bg-danger/5 hover:text-danger disabled:opacity-50"
            >
              <Trash2 className="size-4" /> Remove photo
            </button>
          )}
        </div>

        <p className="text-center text-xs text-ink-faint">
          PNG, JPEG, WebP or GIF · up to {MAX_MB}MB · squared automatically
        </p>
      </div>
    </Modal>
  );
}
