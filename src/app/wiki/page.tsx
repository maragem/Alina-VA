import { AppShell } from "@/components/AppShell";
import { WikiClient } from "@/components/wiki/WikiClient";

type WikiPageProps = Readonly<{
  searchParams: Promise<{ project?: string | string[]; page?: string | string[] }>;
}>;

export default async function WikiPage({ searchParams }: WikiPageProps) {
  const parameters = await searchParams;
  const initialProjectId =
    typeof parameters.project === "string" ? parameters.project : undefined;
  const initialPageId = typeof parameters.page === "string" ? parameters.page : undefined;

  return (
    <AppShell activeTab="wiki" footerDetail="Curated, source-tracked knowledge read by ALINA">
      <WikiClient initialProjectId={initialProjectId} initialPageId={initialPageId} />
    </AppShell>
  );
}
