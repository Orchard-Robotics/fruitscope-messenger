import { cn } from "@/lib/cn";

/** The FruitScope mark (red fruit + green leaves), served from /public. */
export function Logo({ className }: { className?: string }) {
  return (
    <img
      src="/fruitscope-logo.svg"
      alt="FruitScope"
      draggable={false}
      className={cn("select-none", className)}
    />
  );
}
