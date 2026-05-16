import { fetchInboxClients } from "./_lib/queries";
import { MessagesInbox } from "./_components/MessagesInbox";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OwnerMessagesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const raw = params.clientId;
  const initialSelectedId =
    typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;

  const clients = await fetchInboxClients();

  return (
    <section>
      <header className="mb-8">
        <p className="eyebrow mb-3">Owner — Messages</p>
        <h1 className="page-title">Messages</h1>
      </header>
      <MessagesInbox
        initialClients={clients}
        initialSelectedId={initialSelectedId}
      />
    </section>
  );
}
