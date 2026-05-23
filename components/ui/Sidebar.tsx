"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useUser } from "@clerk/nextjs";
import { useMobileNav } from "./MobileNavProvider";

export interface SidebarNavItem {
  label: string;
  href: string;
  badge?: number;
}

interface SidebarProps {
  eyebrow: string;
  navItems: SidebarNavItem[];
}

export function Sidebar({ eyebrow, navItems }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useUser();
  const { isOpen, close } = useMobileNav();
  const displayName =
    user?.fullName ||
    user?.primaryEmailAddress?.emailAddress ||
    "Signed in";

  return (
    <>
      <div
        onClick={close}
        aria-hidden="true"
        className={`fixed inset-0 z-30 bg-black/50 lg:hidden ${
          isOpen ? "block" : "hidden"
        }`}
      />
      <aside
        className={`fixed left-0 top-0 z-40 flex h-screen w-60 flex-col transition-transform duration-200 ease-out lg:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ backgroundColor: "var(--sidebar-bg)" }}
      >
      <div
        className="px-6 pt-8 pb-10 border-b"
        style={{ borderColor: "rgba(255,255,255,0.08)" }}
      >
        <h1
          style={{
            fontFamily: "var(--font-playfair), serif",
            color: "#FFFFFF",
            fontSize: "18px",
            fontWeight: 500,
            letterSpacing: "-0.01em",
          }}
        >
          Digital Bloom Socials
        </h1>
        <p
          className="mt-2"
          style={{
            color: "rgba(255,255,255,0.55)",
            fontSize: "11px",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            fontWeight: 500,
          }}
        >
          {eyebrow}
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto py-4">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const hasBadge = typeof item.badge === "number" && item.badge > 0;
          const badgeLabel = hasBadge
            ? item.badge! > 99
              ? "99+"
              : String(item.badge)
            : null;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center justify-between gap-3 px-6 py-2.5 text-sm transition-colors"
              style={{
                color: isActive ? "#FFFFFF" : "rgba(255,255,255,0.55)",
                backgroundColor: isActive
                  ? "rgba(255,255,255,0.06)"
                  : "transparent",
                borderLeft: isActive
                  ? "3px solid var(--accent)"
                  : "3px solid transparent",
                paddingLeft: isActive ? "calc(1.5rem - 3px)" : "1.5rem",
                fontWeight: isActive ? 600 : 400,
              }}
            >
              <span className="truncate">{item.label}</span>
              {badgeLabel && (
                <span
                  style={{
                    backgroundColor: "var(--accent)",
                    color: "#FFFFFF",
                    padding: "2px 8px",
                    fontSize: 11,
                    fontWeight: 600,
                    minWidth: 28,
                    textAlign: "center",
                    lineHeight: "14px",
                    borderRadius: 0,
                  }}
                >
                  {badgeLabel}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div
        className="flex items-center gap-3 border-t px-6 py-4"
        style={{
          borderColor: "rgba(255,255,255,0.08)",
          backgroundColor: "var(--sidebar-deep)",
        }}
      >
        <UserButton
          appearance={{
            elements: {
              avatarBox: "h-8 w-8",
            },
          }}
        />
        <span
          className="truncate text-sm"
          style={{ color: "rgba(255,255,255,0.85)" }}
          title={displayName}
        >
          {displayName}
        </span>
      </div>
      </aside>
    </>
  );
}
