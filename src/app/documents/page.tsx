import { AppShell } from "@/components/AppShell";
import { DocumentsCorpus } from "@/components/documents/DocumentsCorpus";

export default function DocumentsPage() {
  return (
    <AppShell
      activeTab="documents"
      footerDetail="Files available to the Haystack index"
    >
      <DocumentsCorpus />
    </AppShell>
  );
}