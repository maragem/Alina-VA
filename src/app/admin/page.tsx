import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { UatEvaluation } from "@/components/admin/UatEvaluation";

export default function AdminPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <AppShell
      activeTab="admin"
      footerDetail="UAT benchmark and evaluation exports"
    >
      <UatEvaluation />
    </AppShell>
  );
}