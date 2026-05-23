import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { type SidebarNavItem } from "@/components/ui/Sidebar";
import { SidebarWithUnread } from "@/components/ui/SidebarWithUnread";
import { TopBar } from "@/components/ui/TopBar";
import { MobileNavProvider } from "@/components/ui/MobileNavProvider";

const clientNav: SidebarNavItem[] = [
  { label: "My Project", href: "/client/dashboard" },
  { label: "Messages", href: "/client/messages" },
  { label: "Book a Shoot", href: "/client/book" },
  { label: "Files & Content", href: "/client/files" },
  { label: "Invoices", href: "/client/invoices" },
];

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  const role = user?.publicMetadata?.role as string | undefined;

  if (!user) {
    redirect("/sign-in");
  }
  if (role !== "client") {
    redirect("/");
  }

  return (
    <MobileNavProvider>
      <div
        className="min-h-screen"
        style={{ backgroundColor: "var(--surface-base)" }}
      >
        <SidebarWithUnread
          eyebrow="Client Portal"
          navItems={clientNav}
          viewerRole="client"
        />
        <div className="flex min-h-screen flex-col lg:ml-60">
          <TopBar navItems={clientNav} fallbackTitle="Client Portal" />
          <main className="flex-1 p-4 lg:p-8">{children}</main>
        </div>
      </div>
    </MobileNavProvider>
  );
}
