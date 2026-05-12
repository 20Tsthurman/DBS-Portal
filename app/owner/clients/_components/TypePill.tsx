import type { ClientType } from "@/lib/supabase";

const styles: Record<ClientType, { bg: string; fg: string; label: string }> = {
  brand: { bg: "var(--sidebar-bg)", fg: "#FFFFFF", label: "Brand" },
  bride: { bg: "var(--accent)", fg: "#FFFFFF", label: "Bride" },
};

export function TypePill({ type }: { type: ClientType }) {
  const s = styles[type];
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}
