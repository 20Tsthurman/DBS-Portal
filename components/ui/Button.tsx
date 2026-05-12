import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

const baseClasses =
  "inline-flex items-center justify-center px-5 py-2.5 text-sm font-semibold uppercase tracking-wide transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

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
