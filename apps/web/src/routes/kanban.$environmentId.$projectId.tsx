import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES,
  type AssetResource,
  type EnvironmentId,
  type KanbanCard,
  type KanbanImage,
} from "@t3tools/contracts";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { runAttachmentUploadCycle } from "@t3tools/client-runtime/state/attachments";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveNewThreadRuntimeMode } from "@t3tools/shared/serverSettings";
import { GitBranchIcon, Trash2Icon, XIcon } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";

import { KanbanBoard, reorderKanbanCard, type KanbanColumn } from "../components/KanbanBoard";

import { isElectron } from "../env";
import { usePaginatedBranches } from "../state/queries";
import {
  Combobox,
  ComboboxTrigger,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
  ComboboxStatus,
} from "../components/ui/combobox";
import { useProjects, useServerConfigs } from "../state/entities";
import { newMessageId, newThreadId, randomHex, randomUUID } from "../lib/utils";
import { projectEnvironment } from "../state/projects";
import { threadEnvironment } from "../state/threads";
import { resolveDefaultProviderModelSelection } from "../providerInstances";
import { attachmentEnvironment } from "../state/attachments";
import { readPreparedConnection } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { appAtomRegistry } from "../rpc/atomRegistry";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ProjectFavicon } from "../components/ProjectFavicon";
import { RightPanelSheet } from "../components/RightPanelSheet";
import { ExpandedImageDialog } from "../components/chat/ExpandedImageDialog";
import {
  expandedImageKey,
  type ExpandedImagePreview,
} from "../components/chat/ExpandedImagePreview";
import { useAssetUrls } from "../assets/assetUrls";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { SheetHeader, SheetTitle } from "../components/ui/sheet";
import { SidebarInset } from "../components/ui/sidebar";
import { Textarea } from "../components/ui/textarea";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "../components/WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";

function CardBranchPicker({
  environmentId,
  workspaceRoot,
  branch,
  onChange,
}: {
  environmentId: EnvironmentId;
  workspaceRoot: string;
  branch: string | null;
  onChange: (branch: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const branches = usePaginatedBranches({
    environmentId,
    cwd: open ? workspaceRoot : null,
    query: deferredQuery,
  });
  const names = branches.refs.map((ref) => ref.name);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Combobox
        items={names}
        filteredItems={names}
        filter={null}
        value={branch}
        onValueChange={onChange}
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setQuery("");
        }}
      >
        <ComboboxTrigger render={<Button variant="outline" size="sm" aria-label="Ticket branch" />}>
          <GitBranchIcon className="size-4" />
          <span className="max-w-64 truncate">{branch ?? "Attach branch"}</span>
        </ComboboxTrigger>
        <ComboboxPopup>
          <ComboboxSearchInput
            aria-label="Search branches"
            placeholder="Search branches…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ComboboxList>
            {(name: string) => (
              <ComboboxItem key={name} value={name}>
                {name}
              </ComboboxItem>
            )}
          </ComboboxList>
          <ComboboxEmpty>
            {branches.isPending && branches.data === null
              ? "Loading…"
              : branches.error
                ? "Could not load branches."
                : "No branches found."}
          </ComboboxEmpty>
          {branches.error ? (
            <ComboboxStatus>
              {branches.error}
              <Button size="sm" variant="ghost" onClick={branches.refresh}>
                Retry
              </Button>
            </ComboboxStatus>
          ) : branches.data?.nextCursor != null ? (
            <ComboboxStatus>
              <Button
                size="sm"
                variant="ghost"
                disabled={branches.isFetchingNextPage}
                onClick={branches.loadNext}
              >
                {branches.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </ComboboxStatus>
          ) : null}
        </ComboboxPopup>
      </Combobox>
      {branch ? (
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Detach branch"
          onClick={() => onChange(null)}
        >
          <XIcon className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

function CardDetails({
  card,
  environmentId,
  workspaceRoot,
  saving,
  closeRequested,
  onRequestClose,
  onClosed,
  onCancelClose,
  onSave,
  onAddImage,
}: {
  card: KanbanCard;
  environmentId: EnvironmentId;
  workspaceRoot: string;
  saving: boolean;
  closeRequested: boolean;
  onRequestClose: () => void;
  onClosed: () => void;
  onCancelClose: () => void;
  onSave: (
    title: string,
    description: string,
    images: readonly KanbanImage[],
    branch: string | null,
  ) => Promise<boolean>;
  onAddImage: (file: File) => Promise<KanbanImage | null>;
}) {
  const [title, setTitle] = useState(card.title);
  const [branch, setBranch] = useState(card.branch ?? null);
  const [description, setDescription] = useState(card.description ?? "");
  const [uploading, setUploading] = useState(false);
  const [addedImages, setAddedImages] = useState<readonly KanbanImage[]>([]);
  const [removedImageIds, setRemovedImageIds] = useState<readonly string[]>([]);
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);
  const [failedDraftKey, setFailedDraftKey] = useState<string | null>(null);
  const images = useMemo(
    () => [
      ...(card.images ?? []).filter((image) => !removedImageIds.includes(image.id)),
      ...addedImages.filter(
        (image) =>
          !removedImageIds.includes(image.id) &&
          !(card.images ?? []).some((savedImage) => savedImage.id === image.id),
      ),
    ],
    [card.images, addedImages, removedImageIds],
  );
  const changed =
    branch !== (card.branch ?? null) ||
    title.trim() !== card.title ||
    description !== (card.description ?? "") ||
    images.length !== (card.images?.length ?? 0) ||
    images.some((image, index) => image.id !== card.images?.[index]?.id);
  const draftKey = JSON.stringify([
    title.trim(),
    description,
    branch,
    images.map((image) => image.id),
  ]);
  const imageResources = useMemo<AssetResource[]>(
    () =>
      images.map((image) => ({
        _tag: "attachment",
        attachmentId: image.attachment.id,
      })),
    [images],
  );
  const imageUrls = useAssetUrls(environmentId, imageResources);

  useEffect(() => {
    if (saving || uploading) return;
    if (!changed) {
      if (closeRequested) {
        const timer = setTimeout(onClosed, 0);
        return () => clearTimeout(timer);
      }
      return;
    }
    if (!title.trim() || failedDraftKey === draftKey) {
      if (closeRequested) {
        const timer = setTimeout(onCancelClose, 0);
        return () => clearTimeout(timer);
      }
      return;
    }
    const timer = setTimeout(
      () => {
        void onSave(title.trim(), description, images, branch).then((saved) => {
          if (!saved) {
            setFailedDraftKey(draftKey);
            if (closeRequested) onCancelClose();
          }
        });
      },
      closeRequested ? 0 : 600,
    );
    return () => clearTimeout(timer);
  }, [
    saving,
    uploading,
    changed,
    closeRequested,
    title,
    description,
    branch,
    images,
    draftKey,
    failedDraftKey,
    onSave,
    onClosed,
    onCancelClose,
  ]);

  const pasteImage = (file: File, start: number, end: number) => {
    if (uploading) return;
    if (images.length >= 10) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not add image",
          description: "A card can contain up to 10 images.",
        }),
      );
      return;
    }
    if (description.length + file.name.length + 65 > 4_000) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not add image",
          description: "The description is too long for another image reference.",
        }),
      );
      return;
    }
    setUploading(true);
    void onAddImage(file)
      .then((image) => {
        if (!image) return;
        const token = `![${file.name.replace(/[\\\]]/g, "")}](kanban-image:${image.id})`;
        const next = description.slice(0, start) + token + description.slice(end);
        setAddedImages((current) => [...current, image]);
        setDescription(next);
      })
      .finally(() => setUploading(false));
  };

  const removeImage = useCallback((id: string) => {
    setDescription((current) =>
      current.replace(new RegExp(`!\\[[^\\]]*\\]\\(kanban-image:${id}\\)`, "g"), ""),
    );
    setRemovedImageIds((current) => [...current, id]);
  }, []);

  const openImage = (id: string) => {
    const available = images.flatMap((image, index) => {
      const src = imageUrls[index];
      return src
        ? [{ id: image.id, src, name: image.attachment.name, resource: imageResources[index]! }]
        : [];
    });
    const index = available.findIndex((image) => image.id === id);
    if (index < 0) return;
    setExpandedImage({
      images: available.map(({ src, name, resource }) => ({
        src,
        name,
        actionsSource: {
          kind: "image",
          name,
          src,
          asset: { environmentId, resource },
        },
      })),
      index,
    });
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="flex-row items-center justify-between">
        <SheetTitle className="min-w-0">{card.title}</SheetTitle>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Close card"
          onClick={onRequestClose}
        >
          <XIcon className="size-4" />
        </Button>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6">
        <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="kanban-card-title">
          Title
          <Input
            nativeInput
            id="kanban-card-title"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <CardBranchPicker
          environmentId={environmentId}
          workspaceRoot={workspaceRoot}
          branch={branch}
          onChange={setBranch}
        />
        <div className="flex flex-col gap-3">
          <label htmlFor="kanban-card-description" className="text-sm font-medium">
            Description
          </label>
          {images.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {images.map((image, index) => (
                <div
                  key={image.id}
                  className="group relative size-20 shrink-0 overflow-hidden rounded-lg border bg-muted"
                >
                  {imageUrls[index] ? (
                    <button
                      type="button"
                      className="size-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      aria-label={`Preview ${image.attachment.name}`}
                      onClick={() => openImage(image.id)}
                    >
                      <img src={imageUrls[index]} alt="" className="size-full object-cover" />
                    </button>
                  ) : (
                    <span className="flex size-full items-center justify-center text-xs text-muted-foreground">
                      Loading…
                    </span>
                  )}
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/70 px-1 py-0.5 text-3xs text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                    {image.attachment.name}
                  </span>
                  <span className="pointer-events-none absolute right-1 top-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="media-close"
                      aria-label={`Delete ${image.attachment.name}`}
                      disabled={uploading}
                      onClick={() => removeImage(image.id)}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <Textarea
            id="kanban-card-description"
            value={description}
            maxLength={4_000}
            onChange={(event) => setDescription(event.target.value)}
            onPaste={(event) => {
              const image =
                Array.from(event.clipboardData.files).find((file) =>
                  file.type.startsWith("image/"),
                ) ??
                Array.from(event.clipboardData.items)
                  .find((item) => item.kind === "file" && item.type.startsWith("image/"))
                  ?.getAsFile();
              if (!image) return;
              event.preventDefault();
              pasteImage(
                image,
                event.currentTarget.selectionStart,
                event.currentTarget.selectionEnd,
              );
            }}
            disabled={uploading}
            placeholder="Write Markdown, or paste an image…"
          />
          {uploading ? (
            <span className="text-xs text-muted-foreground">Uploading image…</span>
          ) : null}
        </div>
      </div>
      {saving || changed ? (
        <div className="flex items-center justify-between border-t px-6 py-3 text-xs text-muted-foreground">
          <span>
            {saving
              ? "Saving…"
              : !title.trim()
                ? "Title required"
                : failedDraftKey === draftKey
                  ? "Changes not saved"
                  : "Unsaved changes"}
          </span>
          {failedDraftKey === draftKey ? (
            <Button
              type="button"
              size="sm"
              variant="ghost-muted"
              onClick={() => setFailedDraftKey(null)}
            >
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
      {expandedImage ? (
        <ExpandedImageDialog
          key={expandedImageKey(expandedImage)}
          preview={expandedImage}
          onClose={() => setExpandedImage(null)}
        />
      ) : null}
    </div>
  );
}

function KanbanPage() {
  const { environmentId, projectId } = Route.useParams();
  const { cardId } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const project = projects.find(
    (candidate) => candidate.environmentId === environmentId && candidate.id === projectId,
  );
  const updateProject = useAtomCommand(projectEnvironment.update, { reportFailure: false });
  const startThreadTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const [pending, setPending] = useState<{
    cards: readonly KanbanCard[];
    baseUpdatedAt: string;
  } | null>(null);
  const [launchingCardId, setLaunchingCardId] = useState<string | null>(null);
  const [closeRequested, setCloseRequested] = useState(false);
  const saving =
    pending !== null &&
    project !== undefined &&
    project.updatedAt === pending.baseUpdatedAt &&
    JSON.stringify(project.kanbanCards ?? []) !== JSON.stringify(pending.cards);
  const cards = saving ? pending.cards : (project?.kanbanCards ?? []);
  const selectedCard = cards.find((card) => card.id === cardId);

  const save = async (next: readonly KanbanCard[]) => {
    if (!project || saving) return false;
    setPending({ cards: next, baseUpdatedAt: project.updatedAt });
    const result = await updateProject({
      environmentId: project.environmentId,
      input: {
        projectId: project.id,
        kanbanCards: [...next],
        kanbanExpectedUpdatedAt: project.updatedAt,
      },
    });
    if (result._tag === "Failure") {
      setPending(null);
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not save Kanban",
            description: error instanceof Error ? error.message : "Try again.",
          }),
        );
      }
      return false;
    }
    return true;
  };
  const addImage = async (file: File): Promise<KanbanImage | null> => {
    if (!project || !selectedCard) return null;
    const mimeType = PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES.find(
      (type) => type === file.type.toLowerCase(),
    );
    if (!mimeType || file.size === 0 || file.size > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not add image",
          description: "Choose a PNG, JPEG, GIF, or WebP image under 10 MB.",
        }),
      );
      return null;
    }
    const upload = await runAttachmentUploadCycle({
      registry: appAtomRegistry,
      createUploadUrl: attachmentEnvironment.createUploadUrl,
      remove: attachmentEnvironment.remove,
      environmentId: project.environmentId,
      upload: { name: file.name, mimeType, sizeBytes: file.size },
      resolveUploadUrl: (relativeUrl) => {
        const connection = readPreparedConnection(project.environmentId);
        return connection ? resolveAssetUrl(connection.httpBaseUrl, relativeUrl) : null;
      },
      transport: (url) => {
        const controller = new AbortController();
        return {
          abort: () => controller.abort(),
          done: fetch(url, {
            method: "POST",
            headers: { "Content-Type": mimeType },
            body: file,
            signal: controller.signal,
          }).then((response) => {
            if (!response.ok) throw new Error(`Upload rejected (${response.status})`);
          }),
        };
      },
    });
    if (upload.status !== "uploaded") {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not add image",
          description: upload.status === "failed" ? String(upload.error) : "Upload cancelled.",
        }),
      );
      return null;
    }
    return {
      id: randomUUID(),
      attachment: {
        type: "image",
        id: upload.attachmentId,
        name: file.name,
        mimeType,
        sizeBytes: file.size,
      },
    };
  };
  const move = async (id: string, column: KanbanColumn, index?: number) => {
    const card = cards.find((candidate) => candidate.id === id);
    if (!card || !project || saving || launchingCardId !== null) return false;
    if (card.column === column && index === undefined) return false;
    if (column !== "AI" || card.column === column) {
      return save(reorderKanbanCard(cards, id, column, index));
    }

    const config = serverConfigs.get(project.environmentId);
    const settings =
      config && resolveProjectSettings(config.settings, project.id, project).settings;
    const modelSelection =
      config &&
      resolveDefaultProviderModelSelection(config.providers, settings?.defaultModelSelection);
    if (!modelSelection || !settings) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not start agent",
          description: "Choose an available default model for this project first.",
        }),
      );
      return false;
    }

    if (config.environment.capabilities.requiredWorktreeBootstrap !== true) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not start agent",
          description: "Update this server before starting Kanban tickets in worktrees.",
        }),
      );
      return false;
    }

    const threadId = newThreadId();
    const createdAt = new Date().toISOString();
    const runtimeMode = resolveNewThreadRuntimeMode(settings, modelSelection.instanceId);
    setLaunchingCardId(id);
    const progressToast = toastManager.add({
      type: "loading",
      title: "Starting agent",
      description: card.title,
    });
    const result = await startThreadTurn({
      environmentId: project.environmentId,
      input: {
        threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: `Implement this Kanban ticket in the project.\n\n# ${card.title}\n\n${card.description?.trim() || "No description provided."}${card.images?.length ? "\n\nThe kanban-image references in the description correspond to the attached images, in the same order." : ""}`,
          attachments: (card.images ?? []).map((image) => image.attachment),
        },
        modelSelection,
        titleSeed: card.title,
        runtimeMode,
        interactionMode: "default",
        bootstrap: {
          createThread: {
            projectId: project.id,
            title: card.title,
            modelSelection,
            runtimeMode,
            interactionMode: "default",
            branch: card.branch ?? null,
            worktreePath: null,
            createdAt,
          },
          prepareWorktree: {
            projectCwd: project.workspaceRoot,
            baseBranch: card.branch ?? "HEAD",
            branch: buildTemporaryWorktreeBranchName(randomHex),
            requireWorktree: true,
          },
          runSetupScript: true,
        },
        createdAt,
      },
    });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.update(
        progressToast,
        stackedThreadToast({
          type: "error",
          title: "Could not start agent",
          description: error instanceof Error ? error.message : "Try again.",
        }),
      );
      setLaunchingCardId(null);
      return false;
    }
    const moved = await save(
      reorderKanbanCard(cards, id, column, index).map((candidate) =>
        candidate.id === id ? { ...candidate, agentThreadId: threadId } : candidate,
      ),
    );
    toastManager.update(progressToast, {
      type: moved ? "success" : "error",
      title: moved ? "Agent started" : "Agent started, but ticket could not move",
      description: moved ? card.title : "Find the new thread in the project sidebar.",
    });
    setLaunchingCardId(null);
    return moved;
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <WorkspacePageHeader electron={isElectron} className="relative bg-background">
        <WorkspaceBreadcrumb ariaLabel="Kanban breadcrumb" className="flex-1 overflow-clip">
          <WorkspaceBreadcrumbItem className="shrink">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {project ? <ProjectFavicon project={project} className="size-3.5" /> : null}
              <WorkspaceBreadcrumbText className="max-w-40">
                {project?.title ?? "Project unavailable"}
              </WorkspaceBreadcrumbText>
            </span>
          </WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator>
            <WorkspaceBreadcrumbText>/</WorkspaceBreadcrumbText>
          </WorkspaceBreadcrumbSeparator>
          <WorkspaceBreadcrumbItem current>
            <WorkspaceBreadcrumbText>Kanban</WorkspaceBreadcrumbText>
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
      </WorkspacePageHeader>
      <main className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-6">
        <KanbanBoard
          key={`${environmentId}:${projectId}`}
          cards={cards}
          environmentId={environmentId}
          disabled={saving || launchingCardId !== null || !project}
          detailsOpen={selectedCard !== undefined}
          onAdd={(title, column) => save([...cards, { id: randomUUID(), title, column }])}
          onOpen={(id) => {
            setCloseRequested(false);
            void navigate({ search: { cardId: id } });
          }}
          onDelete={(id) => void save(cards.filter((card) => card.id !== id))}
          onMove={move}
        />
      </main>
      <RightPanelSheet
        open={selectedCard !== undefined}
        onClose={() => setCloseRequested(true)}
        animationDurationMs={200}
      >
        {selectedCard ? (
          <CardDetails
            key={selectedCard.id}
            card={selectedCard}
            environmentId={project!.environmentId}
            workspaceRoot={project!.workspaceRoot}
            saving={saving}
            closeRequested={closeRequested}
            onRequestClose={() => setCloseRequested(true)}
            onClosed={() => {
              void navigate({ search: {}, replace: true });
              setCloseRequested(false);
            }}
            onCancelClose={() => setCloseRequested(false)}
            onSave={(title, description, images, branch) =>
              save(
                cards.map((card) =>
                  card.id === selectedCard.id
                    ? { ...card, title, description, images: [...images], branch }
                    : card,
                ),
              )
            }
            onAddImage={addImage}
          />
        ) : null}
      </RightPanelSheet>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/kanban/$environmentId/$projectId")({
  validateSearch: (raw: Record<string, unknown>): { cardId?: string } =>
    typeof raw.cardId === "string" && raw.cardId ? { cardId: raw.cardId } : {},
  component: KanbanPage,
});
