import { redirect } from "next/navigation";
import { SignUp } from "@clerk/nextjs";

interface SignUpPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const params = await searchParams;
  const ticket = params["__clerk_ticket"];
  const status = params["__clerk_status"];

  // Invite-only: this app has no public signup. The only valid way to
  // reach this page is via a Clerk invitation link, which Clerk decorates
  // with both __clerk_ticket and __clerk_status=sign_up. Anything else
  // gets bounced to sign-in with a clear message.
  //
  // The <SignUp /> component below reads __clerk_ticket from
  // window.location at mount time to (a) lock the email field to the
  // invited address and (b) consume the invitation, which is what causes
  // its publicMetadata to transfer onto the new user.
  if (typeof ticket !== "string" || status !== "sign_up") {
    redirect("/sign-in?error=invitation_required");
  }

  return (
    <main
      className="flex min-h-dvh items-center justify-center px-6 py-8"
      style={{ backgroundColor: "var(--sidebar-bg)" }}
    >
      <div
        className="w-full max-w-md border px-10 py-12"
        style={{
          backgroundColor: "var(--surface-base)",
          borderColor: "var(--border)",
        }}
      >
        <p
          className="mb-3 text-center"
          style={{
            color: "var(--text-muted)",
            fontSize: "11px",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            fontWeight: 500,
          }}
        >
          Accept Invitation
        </p>
        <h1
          className="mb-3 text-center"
          style={{
            fontFamily: "var(--font-playfair), serif",
            color: "var(--text-primary)",
            fontSize: "28px",
            fontWeight: 500,
            letterSpacing: "-0.01em",
          }}
        >
          Digital Bloom Socials
        </h1>
        <p
          className="mb-8 text-center"
          style={{
            color: "var(--text-body)",
            fontSize: "13px",
            lineHeight: 1.6,
          }}
        >
          Set up your account to access your client portal.
        </p>

        <SignUp
          forceRedirectUrl="/finalizing"
          appearance={{
            variables: {
              colorPrimary: "#A8788A",
              colorBackground: "#E8E4D8",
              colorText: "#1A2B1C",
              colorTextSecondary: "#4B5C4E",
              colorInputBackground: "#F2EDE4",
              colorInputText: "#1A2B1C",
              borderRadius: "0px",
              fontFamily: "var(--font-dm-sans), system-ui, sans-serif",
            },
            elements: {
              rootBox: "w-full",
              card: "bg-transparent border-0 p-0 shadow-none",
              header: "hidden",
              footer: "hidden",
              formButtonPrimary:
                "bg-[#A8788A] hover:bg-[#A8788A] text-white text-sm font-semibold uppercase tracking-wide px-5 py-2.5 normal-case-off",
              formFieldInput:
                "border border-[#D8D4C8] bg-[#F2EDE4] text-[#1A2B1C] px-3 py-2",
              formFieldLabel:
                "text-[#4B5C4E] text-xs uppercase tracking-wide font-medium",
              socialButtonsBlockButton:
                "border border-[#D8D4C8] bg-[#F2EDE4] text-[#1A2B1C] hover:bg-[#E8E4D8]",
              dividerLine: "bg-[#D8D4C8]",
              dividerText: "text-[#7A8B7C]",
              identityPreviewText: "text-[#1A2B1C]",
              identityPreviewEditButton: "text-[#A8788A]",
              footerActionLink: "text-[#A8788A] hover:text-[#A8788A]",
            },
          }}
        />
      </div>
    </main>
  );
}
