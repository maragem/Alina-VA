import { AppShell } from "@/components/AppShell";
import { ProjectDetailClient } from "@/components/projects/ProjectDetailClient";

type ProjectPageProps = Readonly<{ params: Promise<{ projectId: string }> }>;

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = await params;
  return (
    <AppShell activeTab="projects" footerDetail="Project grouping and access control">
      <ProjectDetailClient projectId={projectId} />
    </AppShell>
  );
}