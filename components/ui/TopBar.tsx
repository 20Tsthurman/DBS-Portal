"use client";

import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import type { SidebarNavItem } from "./Sidebar";

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

  return (
    <header
      className="flex h-14 items-center justify-between border-b px-8"
      style={{
        backgroundColor: "var(--surface-raised)",
        borderColor: "var(--border)",
      }}
    >
      <span
        className="text-sm font-semibold"
        style={{
          color: "var(--text-primary)",
          letterSpacing: "0.02em",
        }}
      >
        {title}
      </span>
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
