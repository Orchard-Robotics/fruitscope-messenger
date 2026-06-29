import { useEffect, useState } from "react";

import type { User } from "@shared/index";
import { avatarGradient, initials } from "@/lib/avatar";
import { cn } from "@/lib/cn";

interface AvatarProps {
  user: Pick<User, "displayName" | "hue"> & { avatarUrl?: string | null };
  size?: number;
  className?: string;
}

/**
 * Profile picture if the user has one (loaded straight from the CDN/emulator),
 * otherwise a stable hue gradient + initials. If the image fails to load we fall
 * back to the gradient underneath.
 */
export function Avatar({ user, size = 36, className }: AvatarProps) {
  const url = user.avatarUrl ?? null;
  const [broken, setBroken] = useState(false);

  // A new upload changes the URL — clear any previous load error.
  useEffect(() => setBroken(false), [url]);

  const showImage = url && !broken;

  return (
    <div
      className={cn(
        "relative grid shrink-0 select-none place-items-center overflow-hidden rounded-xl font-semibold text-white shadow-sm ring-1 ring-black/5",
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundImage: avatarGradient(user.hue),
        fontSize: Math.round(size * 0.38),
      }}
      aria-hidden
    >
      {!showImage && initials(user.displayName)}
      {showImage && (
        <img
          src={url}
          alt=""
          className="absolute inset-0 size-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      )}
    </div>
  );
}
