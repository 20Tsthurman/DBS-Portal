"use client";

import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import type { SidebarNavItem } from "./Sidebar";
import { useMobileNav } from "./MobileNavProvider";

interface TopBarProps {
  navItems: SidebarNavItem[];
  fallbackTitle: string;
}

function resolveTitle(
  pathname: string,
  navItems: SidebarNavItem[],
  fallbackTitle: string
): string {
  const match =
    navItems.find((item) => pathname === item.href) ||
    navItems.find((item) => pathname.startsWith(`${item.href}/`));
  return match?.label ?? fallbackTitle;
}

export function TopBar({ navItems, fallbackTitle }: TopBarProps) {
  const pathname = usePathname();
  const title = resolveTitle(pathname, navItems, fallbackTitle);
  const { open } = useMobileNav();

  return (
    <header
      className="flex h-14 items-center justify-between border-b pr-4 lg:pr-8"
      style={{
        backgroundColor: "var(--surface-raised)",
        borderColor: "var(--border)",
      }}
    >
      <div className="flex items-center">
        <button
          type="button"
          onClick={open}
          aria-label="Open navigation menu"
          className="flex items-center justify-center lg:hidden"
          style={{
            width: 44,
            height: 44,
            color: "var(--text-primary)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="square"
            strokeLinejoin="miter"
            aria-hidden="true"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span
          className="pl-4 text-sm font-semibold lg:pl-8"
          style={{
            color: "var(--text-primary)",
            letterSpacing: "0.02em",
          }}
        >
          {title}
        </span>
      </div>
      <UserButton
        appearance={{
          elements: {
            avatarBox: "h-8 w-8",
          },
        }}
      />
    </header>
  );
}
