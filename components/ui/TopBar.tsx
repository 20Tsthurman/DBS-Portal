"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import type { SidebarNavSection } from "./Sidebar";
import { useMobileNav } from "./MobileNavProvider";

interface TopBarProps {
  navSections: SidebarNavSection[];
  fallbackTitle: string;
  /**
   * Optional widget rendered just before the UserButton. The owner layout
   * passes the persistent <TimerPill/> here; the client layout omits it.
   */
  rightSlot?: ReactNode;
}

function resolveTitle(
  pathname: string,
  navSections: SidebarNavSection[],
  fallbackTitle: string
): string {
  // Flatten sections → items so the title still derives from the current path.
  const items = navSections.flatMap((section) => section.items);
  const match =
    items.find((item) => pathname === item.href) ||
    items.find((item) => pathname.startsWith(`${item.href}/`));
  return match?.label ?? fallbackTitle;
}

export function TopBar({ navSections, fallbackTitle, rightSlot }: TopBarProps) {
  const pathname = usePathname();
  const title = resolveTitle(pathname, navSections, fallbackTitle);
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
      <div className="flex items-center gap-3 pl-3">
        {rightSlot}
        <UserButton
          appearance={{
            elements: {
              avatarBox: "h-8 w-8",
            },
          }}
        />
      </div>
    </header>
  );
}
