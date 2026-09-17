import { SimpleRagClient } from "../../components/global/SimpleRagClient";
import { AppShell } from "@/components/AppShell";

type GlobalPageProps = Readonly<{
  searchParams: Promise<{
    conversation?: string | string[];
    project?: string | string[];
  }>;
}>;

export default async function GlobalPage({ searchParams }: GlobalPageProps) {
  const parameters = await searchParams;
  const initialConversationId =
    typeof parameters.conversation === "string"
      ? parameters.conversation
      : undefined;
  const initialProjectId =
    typeof parameters.project === "string" ? parameters.project : undefined;

  return (
    <AppShell activeTab="global" footerDetail="Source-grounded answers">
      <SimpleRagClient
        initialConversationId={initialConversationId}
        initialProjectId={initialProjectId}
      />
    </AppShell>
  );
}
