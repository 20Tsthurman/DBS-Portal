import { SignIn } from "@clerk/nextjs";

const ERROR_MESSAGES: Record<string, string> = {
  invitation_required:
    "This portal is invite-only. Use the link in the invitation email Kelsey sent you to set up your account.",
  not_invited:
    "We couldn't find a client record for this email. Please ask Kelsey to send you an invitation.",
  account_conflict:
    "This client record is already linked to a different account. Contact Kelsey for help.",
  no_email: "No email address is associated with this account.",
};

interface SignInPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const { error } = params;
  const errorMessage = error ? ERROR_MESSAGES[error] : null;

  return (
    <main
      className="flex min-h-screen items-center justify-center px-6 py-16"
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
          Client Portal
        </p>
        <h1
          className="mb-10 text-center"
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

        {errorMessage && (
          <div
            role="alert"
            className="mb-6"
            style={{
              padding: "12px 14px",
              border: "1px solid var(--status-danger)",
              backgroundColor: "rgba(122,48,64,0.08)",
              color: "var(--status-danger)",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {errorMessage}
          </div>
        )}

        <SignIn
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
