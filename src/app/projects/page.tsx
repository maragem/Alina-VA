import { AppShell } from "@/components/AppShell";
import { ProjectsClient } from "@/components/projects/ProjectsClient";

export default function ProjectsPage() {
  return (
    <AppShell activeTab="projects" footerDetail="Project grouping and access control">
      <ProjectsClient />
    </AppShell>
  );
}