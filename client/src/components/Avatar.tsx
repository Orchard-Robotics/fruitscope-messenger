import type { User } from "@shared/index";
import { avatarGradient, initials } from "@/lib/avatar";
import { cn } from "@/lib/cn";

interface AvatarProps {
  user: Pick<User, "displayName" | "hue">;
  size?: number;
  className?: string;
}

export function Avatar({ user, size = 36, className }: AvatarProps) {
  return (
    <div
      className={cn(
        "grid shrink-0 select-none place-items-center rounded-xl font-semibold text-white shadow-sm",
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
      {initials(user.displayName)}
    </div>
  );
}
