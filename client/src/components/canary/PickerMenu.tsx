import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";

export interface PickerItem {
  value: string;
  label: string;
  sublabel?: string;
}

/**
 * A prominent, obviously-clickable picker (vs an easy-to-miss native <select>):
 * a labeled pill button that opens a popover menu, with a search box once the
 * list is long (admins can have many orchards). Closes on outside-click / Escape.
 */
export function PickerMenu({
  icon,
  label,
  value,
  placeholder,
  items,
  onSelect,
  primary = false,
  align = "right",
  emptyText = "Nothing to choose",
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  placeholder: string;
  items: PickerItem[];
  onSelect: (value: string) => void;
  primary?: boolean;
  align?: "left" | "right";
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = items.find((i) => i.value === value);
  const searchable = items.length > 7;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => i.label.toLowerCase().includes(q) || i.sublabel?.toLowerCase().includes(q),
    );
  }, [items, query]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          setOpen((v) => !v);
          setQuery("");
        }}
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition",
          primary
            ? "border-brand-300 bg-brand-500/10 text-brand-700 hover:bg-brand-500/15"
            : "border-line bg-surface text-ink-dim hover:bg-surface-2 hover:text-ink",
        )}
      >
        <span className={cn("shrink-0", primary ? "text-brand-600" : "text-ink-faint")}>{icon}</span>
        <span className="flex flex-col items-start leading-tight">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            {label}
          </span>
          <span className={cn("max-w-[11rem] truncate", !current && "text-ink-faint")}>
            {current ? current.label : placeholder}
          </span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 transition", open && "rotate-180")} />
      </button>

      {open && (
        <div
          className={cn(
            "absolute z-50 mt-1.5 w-72 max-w-[80vw] overflow-hidden rounded-xl border border-line bg-raised shadow-2xl shadow-ink/10",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {searchable && (
            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
              <Search className="size-4 shrink-0 text-ink-faint" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}…`}
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
          )}
          <ul className="max-h-72 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-ink-faint">{query ? "No matches" : emptyText}</li>
            )}
            {filtered.map((item) => {
              const selected = item.value === value;
              return (
                <li key={item.value}>
                  <button
                    onClick={() => {
                      onSelect(item.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition",
                      selected ? "bg-brand-500/12 text-brand-700" : "text-ink hover:bg-surface-2",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.label}</span>
                      {item.sublabel && (
                        <span className="block truncate text-xs text-ink-faint">{item.sublabel}</span>
                      )}
                    </span>
                    {selected && <Check className="size-4 shrink-0 text-brand-600" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
