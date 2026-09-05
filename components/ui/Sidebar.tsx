"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useUser } from "@clerk/nextjs";
import { useMobileNav } from "./MobileNavProvider";

export interface SidebarNavItem {
  label: string;
  href: string;
  badge?: number;
  /**
   * Opt-in `data-tour` anchor for a guided tour, e.g. "nav-review".
   *
   * This component is SHARED with the owner layout, so the attribute is never
   * hardcoded here — only the client nav in app/client/layout.tsx populates
   * it. Left undefined, React omits the attribute entirely and Kelsey's
   * sidebar renders exactly the markup it did before tours existed.
   */
  tourId?: string;
}

export interface SidebarNavSection {
  /** Optional uppercase muted label above the group. Omit for a headingless
   *  group (the client nav and the trailing Settings group). */
  heading?: string;
  items: SidebarNavItem[];
}

interface SidebarProps {
  eyebrow: string;
  navSections: SidebarNavSection[];
}

export function Sidebar({ eyebrow, navSections }: SidebarProps) {
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
        // h-dvh, not h-screen: on iOS `100vh` is the *large* viewport (URL bar
        // hidden), so with the browser chrome showing this fixed drawer ran
        // ~100px taller than the visible area and the account row below the
        // nav was unreachable. `dvh` tracks the visible viewport instead.
        className={`fixed left-0 top-0 z-40 flex h-dvh w-60 flex-col transition-transform duration-200 ease-out lg:translate-x-0 ${
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

      {/* overscroll-contain: sizing the drawer to the visible viewport is what
          finally makes this region overflow, so its scroll behaviour now
          matters. Without this, dragging past either end chains the scroll to
          the page behind the drawer on iOS. */}
      <nav className="flex-1 overflow-y-auto overscroll-contain py-4">
        {navSections.map((section, sectionIndex) => (
          <div
            key={section.heading ?? `section-${sectionIndex}`}
            // Divider before every group after the first. For the trailing
            // headingless Settings group this reads as a deliberate separator.
            className={sectionIndex > 0 ? "mt-4 pt-4 border-t" : undefined}
            style={
              sectionIndex > 0
                ? { borderColor: "rgba(255,255,255,0.08)" }
                : undefined
            }
          >
            {section.heading && (
              <p
                className="px-6 pb-2"
                style={{
                  color: "rgba(255,255,255,0.4)",
                  fontSize: "10px",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  fontWeight: 500,
                }}
              >
                {section.heading}
              </p>
            )}
            {section.items.map((item) => {
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
                  data-tour={item.tourId}
                  className="flex items-center justify-between gap-3 px-6 py-2.5 text-sm transition-colors"
                  style={{
                    color: isActive ? "#FFFFFF" : "rgba(255,255,255,0.55)",
                    backgroundColor: isActive
                      ? "rgba(255,255,255,0.06)"
                      : "transparent",
                    borderLeft: isActive
                      ? "3px solid var(--accent)"
                      : "3px solid transparent",
                    // 3px of the 24px column inset is the left rule, transparent
                    // when inactive, so labels sit at x 24 in both states.
                    paddingLeft: "calc(1.5rem - 3px)",
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
          </div>
        ))}
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
