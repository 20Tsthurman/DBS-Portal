import { requireCurrentClient } from "@/lib/currentClient";
import { MessageThread } from "@/components/messages/MessageThread";

export const dynamic = "force-dynamic";

export default async function ClientMessagesPage() {
  const client = await requireCurrentClient();

  return (
    <section>
      <header className="mb-8">
        <p className="eyebrow mb-3">Your Portal — Messages</p>
        <h1 className="page-title">Messages with Kelsey</h1>
      </header>
      <div
        className="mx-auto flex flex-col h-[calc(100dvh-180px)] min-h-[420px] lg:h-[calc(100vh-220px)] lg:min-h-[480px]"
        style={{
          maxWidth: 800,
          border: "1px solid var(--border)",
        }}
      >
        <MessageThread clientId={client.id} viewerRole="client" />
      </div>
    </section>
  );
}
