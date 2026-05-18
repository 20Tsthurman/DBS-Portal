import { requireCurrentClient } from "@/lib/currentClient";
import { fetchMyFiles } from "./_lib/queries";
import { FilesList } from "./_components/FilesList";

export const dynamic = "force-dynamic";

export default async function ClientFilesPage() {
  const client = await requireCurrentClient();
  const files = await fetchMyFiles(client.id);

  return (
    <section>
      <header style={{ marginBottom: 24 }}>
        <p className="eyebrow mb-3">Client — Files &amp; Content</p>
        <h1 className="page-title">Files &amp; Content</h1>
        <p
          style={{
            marginTop: 8,
            fontSize: 14,
            color: "var(--text-body)",
          }}
        >
          Download the deliverables and reference materials Kelsey has shared
          with you.
        </p>
      </header>

      <FilesList files={files} />
    </section>
  );
}
