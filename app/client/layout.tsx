import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { Sidebar, type SidebarNavItem } from "@/components/ui/Sidebar";
import { TopBar } from "@/components/ui/TopBar";

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
    <div
      className="min-h-screen"
      style={{ backgroundColor: "var(--surface-base)" }}
    >
      <Sidebar eyebrow="Client Portal" navItems={clientNav} />
      <div className="ml-60 flex min-h-screen flex-col">
        <TopBar navItems={clientNav} fallbackTitle="Client Portal" />
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
