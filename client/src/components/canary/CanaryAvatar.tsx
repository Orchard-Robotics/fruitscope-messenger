import { Bird } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * Canary's avatar — a warm canary-yellow tile with a bird glyph, matching the
 * FruitScope AI assistant's look so the bot reads as distinct from people.
 */
export function CanaryAvatar({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center rounded-xl shadow-sm ring-1 ring-black/5",
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundImage: "linear-gradient(135deg, #fde68a 0%, #f6c544 55%, #e0a915 100%)",
      }}
      aria-hidden
    >
      <Bird className="text-amber-900" style={{ width: size * 0.58, height: size * 0.58 }} />
    </div>
  );
}
