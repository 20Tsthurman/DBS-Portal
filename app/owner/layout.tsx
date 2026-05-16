import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { type SidebarNavItem } from "@/components/ui/Sidebar";
import { SidebarWithUnread } from "@/components/ui/SidebarWithUnread";
import { TopBar } from "@/components/ui/TopBar";

const ownerNav: SidebarNavItem[] = [
  { label: "Dashboard", href: "/owner/dashboard" },
  { label: "Clients", href: "/owner/clients" },
  { label: "Shoots", href: "/owner/shoots" },
  { label: "Calendar", href: "/owner/calendar" },
  { label: "Time Tracker", href: "/owner/time" },
  { label: "Financials", href: "/owner/financials" },
  { label: "Messages", href: "/owner/messages" },
  { label: "Settings", href: "/owner/settings" },
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

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: "var(--surface-base)" }}
    >
      <SidebarWithUnread
        eyebrow="Owner Portal"
        navItems={ownerNav}
        viewerRole="owner"
      />
      <div className="ml-60 flex min-h-screen flex-col">
        <TopBar navItems={ownerNav} fallbackTitle="Owner Portal" />
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
