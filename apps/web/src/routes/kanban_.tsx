import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { useMemo } from "react";

import { isElectron } from "../env";
import { ProjectFavicon } from "../components/ProjectFavicon";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbText,
} from "../components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../components/WorkspacePageContainer";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { SidebarInset } from "../components/ui/sidebar";
import { useProjects } from "../state/entities";
import { useEnvironments } from "../state/environments";

function KanbanListPage() {
  const projects = useProjects();
  const { environments } = useEnvironments();
  const environmentLabels = new Map(
    environments.map((environment) => [environment.environmentId, environment.label]),
  );
  const sortedProjects = useMemo(
    () =>
      [...projects].sort(
        (a, b) => a.title.localeCompare(b.title) || a.workspaceRoot.localeCompare(b.workspaceRoot),
      ),
    [projects],
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <WorkspacePageHeader electron={isElectron} className="bg-background">
        <WorkspaceBreadcrumb ariaLabel="Kanban breadcrumb">
          <WorkspaceBreadcrumbItem current>
            <WorkspaceBreadcrumbText>Kanban</WorkspaceBreadcrumbText>
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
      </WorkspacePageHeader>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Project boards</h1>
            <p className="text-sm text-muted-foreground">Choose a project to open its Kanban.</p>
          </div>
          {sortedProjects.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">
              No projects yet. Add a project to create a Kanban board.
            </p>
          ) : (
            <ul className="divide-y divide-border/70">
              {sortedProjects.map((project) => (
                <li key={`${project.environmentId}:${project.id}`}>
                  <Link
                    to="/kanban/$environmentId/$projectId"
                    params={{ environmentId: project.environmentId, projectId: project.id }}
                    className="group flex min-w-0 items-center gap-3 rounded-md px-2 py-3 hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ProjectFavicon project={project} className="size-5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{project.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {environments.length > 1
                          ? `${environmentLabels.get(project.environmentId) ?? "Environment"} · `
                          : ""}
                        {project.workspaceRoot}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {project.kanbanCards?.length ?? 0}{" "}
                      {project.kanbanCards?.length === 1 ? "ticket" : "tickets"}
                    </span>
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </WorkspacePageContainer>
      </main>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/kanban_")({
  component: KanbanListPage,
});
