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
        style={{
          height: "calc(100vh - 220px)",
          minHeight: 480,
          maxWidth: 800,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border)",
        }}
      >
        <MessageThread clientId={client.id} viewerRole="client" />
      </div>
    </section>
  );
}
