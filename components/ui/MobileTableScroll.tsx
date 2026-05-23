import type { ReactNode } from "react";

interface MobileTableScrollProps {
  children: ReactNode;
  /** Minimum width applied to the inner content below lg so columns don't crush. */
  minWidth?: number;
}

export function MobileTableScroll({
  children,
  minWidth = 720,
}: MobileTableScrollProps) {
  return (
    <div>
      <p
        className="mb-2 flex items-center gap-2 lg:hidden"
        style={{
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          fontWeight: 500,
        }}
      >
        <span>Swipe to see more</span>
        <span aria-hidden="true">→</span>
      </p>
      <div className="relative">
        <div
          className="overflow-x-auto"
          style={{
            border: "1px solid var(--border)",
            backgroundColor: "var(--surface-raised)",
          }}
        >
          <div
            className="lg:!min-w-0"
            style={{ minWidth }}
          >
            {children}
          </div>
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-10 lg:hidden"
          style={{
            background:
              "linear-gradient(to right, rgba(242,237,228,0) 0%, rgba(242,237,228,1) 100%)",
          }}
        />
      </div>
    </div>
  );
}
