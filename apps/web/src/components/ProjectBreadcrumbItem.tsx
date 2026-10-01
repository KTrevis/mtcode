import type { ProjectFaviconProject } from "./ProjectFavicon";
import { ProjectFavicon } from "./ProjectFavicon";
import { WorkspaceBreadcrumbItem, WorkspaceBreadcrumbText } from "./WorkspaceBreadcrumb";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function ProjectBreadcrumbItem({
  project,
  onNewThread,
}: {
  readonly project: ProjectFaviconProject;
  readonly onNewThread: () => void;
}) {
  return (
    <WorkspaceBreadcrumbItem className="shrink">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={`New thread in ${project.title}`}
              onClick={onNewThread}
              className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
        >
          <ProjectFavicon project={project} className="size-3.5" />
          <WorkspaceBreadcrumbText className="max-w-40">{project.title}</WorkspaceBreadcrumbText>
        </TooltipTrigger>
        <TooltipPopup side="top">New thread in {project.title}</TooltipPopup>
      </Tooltip>
    </WorkspaceBreadcrumbItem>
  );
}
