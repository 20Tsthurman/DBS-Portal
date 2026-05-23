import type { CSSProperties, ReactNode } from "react";

interface MobileCardListProps {
  children: ReactNode;
  className?: string;
}

export function MobileCardList({ children, className }: MobileCardListProps) {
  return (
    <div className={`flex flex-col gap-3 ${className ?? ""}`}>{children}</div>
  );
}

interface MobileCardProps {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}

export function MobileCard({ children, style, className }: MobileCardProps) {
  return (
    <div
      className={`flex flex-col border ${className ?? ""}`}
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface-raised)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

interface MobileCardHeaderProps {
  title: ReactNode;
  badge?: ReactNode;
  subtitle?: ReactNode;
}

export function MobileCardHeader({
  title,
  badge,
  subtitle,
}: MobileCardHeaderProps) {
  return (
    <div
      className="flex items-start justify-between gap-3 border-b px-4 py-3"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="min-w-0 flex-1">
        <div
          style={{
            fontFamily: "var(--font-playfair), serif",
            fontSize: 16,
            fontWeight: 500,
            color: "var(--text-primary)",
            lineHeight: 1.3,
            wordBreak: "break-word",
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {subtitle}
          </div>
        )}
      </div>
      {badge && <div className="flex-shrink-0">{badge}</div>}
    </div>
  );
}

interface MobileCardFieldProps {
  label: string;
  children: ReactNode;
}

export function MobileCardField({ label, children }: MobileCardFieldProps) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2 first:pt-3 last:pb-3">
      <span
        className="flex-shrink-0"
        style={{
          fontSize: 11,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <span
        className="min-w-0 text-right"
        style={{
          fontSize: 14,
          color: "var(--text-body)",
          wordBreak: "break-word",
        }}
      >
        {children}
      </span>
    </div>
  );
}

interface MobileCardActionsProps {
  children: ReactNode;
  align?: "start" | "end" | "stretch";
}

export function MobileCardActions({
  children,
  align = "stretch",
}: MobileCardActionsProps) {
  const justify =
    align === "end"
      ? "justify-end"
      : align === "start"
        ? "justify-start"
        : "justify-stretch";
  return (
    <div
      className={`flex flex-wrap items-center gap-2 border-t px-4 py-3 ${justify} [&_button]:min-h-[44px] [&_button]:px-3 [&_a]:inline-flex [&_a]:min-h-[44px] [&_a]:items-center [&_a]:px-3`}
      style={{ borderColor: "var(--border)" }}
    >
      {children}
    </div>
  );
}
