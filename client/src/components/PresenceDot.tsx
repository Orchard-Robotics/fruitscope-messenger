import type { UserStatus } from "@shared/index";
import { cn } from "@/lib/cn";

const STATUS_STYLES: Record<UserStatus, string> = {
  online: "bg-leaf-400 shadow-[0_0_6px_var(--color-leaf-400)]",
  away: "bg-sun-400",
  offline: "bg-transparent border border-sage-500",
};

export function PresenceDot({
  status,
  className,
  ring = "ring-bark-900",
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
