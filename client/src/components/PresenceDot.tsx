import type { UserStatus } from "@shared/index";
import { cn } from "@/lib/cn";

const STATUS_STYLES: Record<UserStatus, string> = {
  online: "bg-brand-500 shadow-[0_0_6px_var(--color-brand-400)]",
  away: "bg-sun-500",
  offline: "bg-white border border-ink-faint",
};

export function PresenceDot({
  status,
  className,
  ring = "ring-white",
}: {
  status: UserStatus;
  className?: string;
  ring?: string;
}) {
  return (
    <span
      className={cn("block size-2.5 rounded-full ring-2", STATUS_STYLES[status], ring, className)}
      title={status}
    />
  );
}
