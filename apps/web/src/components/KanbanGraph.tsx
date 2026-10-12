import { memo, useCallback, useMemo, useState, type FormEvent } from "react";
import type { KanbanCard } from "@t3tools/contracts";
import { unfinishedKanbanDependencies } from "@t3tools/shared/kanban";
import {
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { CheckIcon, GripVerticalIcon, LockKeyholeIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./ui/tooltip";
import {
  connectKanbanTickets,
  disconnectKanbanTickets,
  layoutKanbanTickets,
  reconcileKanbanGraphNodes,
} from "./kanbanGraphUtils";
import "@xyflow/react/dist/style.css";
import "./KanbanGraph.css";

type TicketNode = Node<
  {
    card: KanbanCard;
    blockers: readonly KanbanCard[];
    onOpen: (id: string) => void;
  },
  "ticket"
>;

const TicketNodeView = memo(function TicketNodeView({ data, selected }: NodeProps<TicketNode>) {
  const { card, blockers, onOpen } = data;
  const status = blockers.length
    ? `Blocked by: ${blockers.map((ticket) => ticket.title).join(", ")}`
    : "All dependencies are done";
  return (
    <article
      className={`w-60 rounded-lg border bg-background p-3 shadow-sm ${selected ? "border-ring ring-1 ring-ring" : "border-border"}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        aria-label={`Prerequisites for ${card.title}`}
      />
      <div
        data-graph-drag-handle
        className="mb-2 flex cursor-grab items-center gap-2 text-xs text-muted-foreground active:cursor-grabbing"
      >
        <GripVerticalIcon aria-hidden="true" className="size-3" />
        <span className="flex-1">{card.column}</span>
        {card.dependsOn?.length ? (
          <Tooltip>
            <TooltipTrigger render={<span role="img" aria-label={status} />}>
              <span className="flex items-center gap-1">
                {blockers.length ? (
                  <>
                    <LockKeyholeIcon aria-hidden="true" className="size-3" />
                    {blockers.length}
                  </>
                ) : (
                  <CheckIcon aria-hidden="true" className="size-3" />
                )}
              </span>
            </TooltipTrigger>
            <TooltipPopup>{status}</TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      <button
        type="button"
        className="line-clamp-3 w-full cursor-pointer break-words rounded-sm text-left text-sm font-medium hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onOpen(card.id)}
      >
        {card.title}
      </button>
      <Handle
        type="source"
        position={Position.Right}
        aria-label={`Connect ${card.title} to a dependent ticket`}
      />
    </article>
  );
});
const nodeTypes = { ticket: TicketNodeView };

export function KanbanGraph({
  cards,
  disabled,
  selectedCardId,
  onOpen,
  onChange,
  onAdd,
}: {
  cards: readonly KanbanCard[];
  disabled: boolean;
  selectedCardId: string | undefined;
  onOpen: (id: string) => void;
  onChange: (cards: readonly KanbanCard[]) => Promise<boolean>;
  onAdd: (title: string) => Promise<boolean>;
}) {
  const [nodeState, setNodeState] = useState<TicketNode[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const layout = useMemo(() => layoutKanbanTickets(cards), [cards]);
  const nodeData = useMemo(
    () =>
      new Map(
        cards.map((card) => [
          card.id,
          {
            card,
            blockers: unfinishedKanbanDependencies(card, cards),
            onOpen,
          },
        ]),
      ),
    [cards, onOpen],
  );
  const nodes = useMemo<TicketNode[]>(
    () =>
      reconcileKanbanGraphNodes<TicketNode>(
        cards.map((card) => ({
          id: card.id,
          type: "ticket" as const,
          data: nodeData.get(card.id)!,
          position: layout[card.id]!,
          ...(selectedCardId !== undefined ? { selected: card.id === selectedCardId } : {}),
          dragHandle: "[data-graph-drag-handle]",
          deletable: false,
          ariaLabel: card.title,
        })),
        nodeState,
      ),
    [cards, nodeData, nodeState, layout, selectedCardId],
  );
  const edges = useMemo<Edge[]>(
    () =>
      cards.flatMap((card) =>
        (card.dependsOn ?? []).map((source) => ({
          id: JSON.stringify([source, card.id]),
          source,
          target: card.id,
          type: "smoothstep",
          selected: selectedEdgeId === JSON.stringify([source, card.id]),
          markerEnd: { type: MarkerType.ArrowClosed },
          ariaLabel: `${card.title} depends on ${cards.find((ticket) => ticket.id === source)?.title ?? source}`,
          deletable: !disabled,
        })),
      ),
    [cards, selectedEdgeId, disabled],
  );
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId);
  const isValidConnection = useCallback(
    (connection: Connection | Edge) =>
      !disabled && connectKanbanTickets(cards, connection.source, connection.target) !== null,
    [cards, disabled],
  );
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!disabled && title.trim() && (await onAdd(title.trim()))) setTitle("");
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <form className="flex w-72 items-center gap-1" onSubmit={add}>
          <Input
            nativeInput
            size="sm"
            aria-label="New graph ticket"
            placeholder="Add a ticket…"
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={disabled}
          />
          <Button
            type="submit"
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Add graph ticket"
            disabled={disabled || !title.trim()}
          >
            <PlusIcon className="size-4" />
          </Button>
        </form>
        <Button
          size="sm"
          variant="ghost-muted"
          onClick={() =>
            setNodeState(nodes.map((node) => ({ ...node, position: layout[node.id]! })))
          }
        >
          Arrange
        </Button>
        <span className="text-xs text-muted-foreground">
          Connect right to left: A → B means B depends on A.
        </span>
      </div>
      <div
        data-kanban-graph
        className="relative min-h-0 flex-1"
        aria-label="Ticket dependency graph"
      >
        <ReactFlow<TicketNode>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={(changes) =>
            setNodeState((current) =>
              applyNodeChanges(changes, reconcileKanbanGraphNodes(nodes, current)),
            )
          }
          onEdgesChange={(changes) => {
            for (const change of changes)
              if (change.type === "select") {
                setSelectedEdgeId((current) =>
                  change.selected ? change.id : current === change.id ? null : current,
                );
              }
          }}
          isValidConnection={isValidConnection}
          onConnect={(connection) => {
            const next = connectKanbanTickets(cards, connection.source, connection.target);
            if (!disabled && next) void onChange(next);
          }}
          onBeforeDelete={async ({ edges: removed }) => {
            if (!disabled && removed.length)
              await onChange(disconnectKanbanTickets(cards, removed));
            return false;
          }}
          onPaneClick={() => setSelectedEdgeId(null)}
          nodesConnectable={!disabled}
          nodesDraggable={!disabled}
          edgesReconnectable={false}
          deleteKeyCode={disabled ? null : ["Backspace", "Delete"]}
          zoomOnDoubleClick={false}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.15}
          maxZoom={2}
        >
          <Background gap={24} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
        {!cards.length ? (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Add tickets, then connect them to define dependencies.
          </p>
        ) : null}
      </div>
      {selectedEdge ? (
        <div className="flex shrink-0 items-center gap-3 text-xs">
          <span className="min-w-0 flex-1 truncate">{selectedEdge.ariaLabel}</span>
          <Button
            size="sm"
            variant="ghost-muted"
            disabled={disabled}
            onClick={() => void onChange(disconnectKanbanTickets(cards, [selectedEdge]))}
          >
            <Trash2Icon className="size-3" />
            Remove dependency
          </Button>
        </div>
      ) : null}
    </div>
  );
}
