import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { UatEvaluation } from "@/components/admin/UatEvaluation";
import { UserManagement } from "@/components/admin/UserManagement";
import { getCurrentUser } from "@/lib/currentUser";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") notFound();

  return (
    <AppShell activeTab="admin" footerDetail="User accounts and evaluation tools">
      <UserManagement currentUserId={user.id} />
      {process.env.NODE_ENV === "development" ? <UatEvaluation /> : null}
    </AppShell>
  );
}
