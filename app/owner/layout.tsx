import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { type SidebarNavSection } from "@/components/ui/Sidebar";
import { SidebarWithUnread } from "@/components/ui/SidebarWithUnread";
import { TopBar } from "@/components/ui/TopBar";
import { TimerPill } from "@/components/ui/TimerPill";
import { MobileNavProvider } from "@/components/ui/MobileNavProvider";
import { getActiveTimer } from "@/app/owner/tasks/_actions";

const ownerNav: SidebarNavSection[] = [
  { heading: "Overview", items: [{ label: "Dashboard", href: "/owner/dashboard" }] },
  {
    heading: "Clients",
    items: [
      { label: "Clients", href: "/owner/clients" },
      { label: "Calendar", href: "/owner/calendar" },
      { label: "Shoots", href: "/owner/shoots" },
      { label: "Messages", href: "/owner/messages" },
    ],
  },
  {
    heading: "Work",
    items: [
      { label: "Tasks", href: "/owner/tasks" },
      { label: "Time Tracker", href: "/owner/time" },
    ],
  },
  {
    heading: "Finances",
    items: [
      { label: "Financials", href: "/owner/financials" },
      { label: "Invoices", href: "/owner/invoices" },
    ],
  },
  // Trailing headingless group: divider separates Settings, no header label.
  { items: [{ label: "Settings", href: "/owner/settings" }] },
];

export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  const role = user?.publicMetadata?.role as string | undefined;

  if (!user) {
    redirect("/sign-in");
  }
  if (role !== "owner") {
    redirect("/");
  }

  // Seed the persistent top-bar timer from the DB; the pill takes over ticking
  // client-side. Mounted once here so it survives navigation across owner pages.
  const activeTimer = await getActiveTimer();

  return (
    <MobileNavProvider>
      <div
        className="min-h-screen"
        style={{ backgroundColor: "var(--surface-base)" }}
      >
        <SidebarWithUnread
          eyebrow="Owner Portal"
          navSections={ownerNav}
          viewerRole="owner"
        />
        <div className="flex min-h-screen flex-col lg:ml-60">
          <TopBar
            navSections={ownerNav}
            fallbackTitle="Owner Portal"
            rightSlot={<TimerPill initialTimer={activeTimer} />}
          />
          <main className="flex-1 p-4 lg:p-8">{children}</main>
        </div>
      </div>
    </MobileNavProvider>
  );
}
