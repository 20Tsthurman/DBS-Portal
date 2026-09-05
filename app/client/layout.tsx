import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { type SidebarNavSection } from "@/components/ui/Sidebar";
import { SidebarWithUnread } from "@/components/ui/SidebarWithUnread";
import { TopBar } from "@/components/ui/TopBar";
import { MobileNavProvider } from "@/components/ui/MobileNavProvider";

// Single headingless section → renders flat, exactly as before (no header, no divider).
//
// `tourId` marks the three links the client onboarding tour points at on
// desktop. It is set HERE rather than in Sidebar because that component is
// shared with the owner layout; see SidebarNavItem.tourId. The same list is
// also handed to TopBar, which only reads label/href to resolve the page
// title, so the extra field is inert there.
const clientNav: SidebarNavSection[] = [
  {
    items: [
      { label: "My Project", href: "/client/dashboard" },
      // Above Messages on purpose: when a month is out for review this is the
      // reason the client opened the portal at all.
      { label: "Review & Approve", href: "/client/review", tourId: "nav-review" },
      { label: "Messages", href: "/client/messages", tourId: "nav-messages" },
      { label: "Book a Shoot", href: "/client/book" },
      { label: "Files & Content", href: "/client/files", tourId: "nav-files" },
      { label: "Invoices", href: "/client/invoices" },
    ],
  },
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
          navSections={clientNav}
          viewerRole="client"
        />
        <div className="flex min-h-screen flex-col lg:ml-60">
          <TopBar
            navSections={clientNav}
            fallbackTitle="Client Portal"
            menuButtonTourId="mobile-menu"
          />
          <main className="flex-1 p-4 lg:p-8">{children}</main>
        </div>
      </div>
    </MobileNavProvider>
  );
}
