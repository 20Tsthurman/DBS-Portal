import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

// min-h-[44px] is the iOS/WCAG touch-target floor; py-2.5 alone rendered 40px.
// Safe across all 21 call sites — the shared Button is only used for page-header
// CTAs, panel footers and settings forms, never inside a table row or inline
// editor (those use their own local action styles).
const baseClasses =
  "inline-flex min-h-[44px] items-center justify-center px-5 py-2.5 text-sm font-semibold uppercase tracking-wide transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const variantStyles: Record<Variant, { backgroundColor: string; color: string }> = {
  primary: { backgroundColor: "var(--accent)", color: "#FFFFFF" },
  secondary: { backgroundColor: "var(--sidebar-bg)", color: "#FFFFFF" },
};

export function Button({
  variant = "primary",
  children,
  className,
  style,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={[baseClasses, className].filter(Boolean).join(" ")}
      style={{ ...variantStyles[variant], ...style }}
    >
      {children}
    </button>
  );
}
