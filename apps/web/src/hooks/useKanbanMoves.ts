import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { KanbanColumn } from "../components/KanbanBoard";

export function useKanbanMoves(
  busy: boolean,
  onMove: (id: string, column: KanbanColumn, index?: number) => Promise<boolean>,
) {
  const [moves, setMoves] = useState<
    {
      id: string;
      column: KanbanColumn;
      index: number | undefined;
      resolve: (moved: boolean) => void;
    }[]
  >([]);
  const running = useRef(false);
  const persistMove = useEffectEvent(onMove);

  // Wait for both the command and its projected project update before the next move.
  // oxlint-disable-next-line t3code/react-effect-budget -- Serialize remote mutations until their projected board updates arrive.
  useEffect(() => {
    const move = moves[0];
    if (busy || running.current || !move) return;
    running.current = true;
    void persistMove(move.id, move.column, move.index)
      .then(move.resolve, () => move.resolve(false))
      .finally(() => {
        running.current = false;
        setMoves((current) => current.slice(1));
      });
  }, [busy, moves]);

  const enqueue = (id: string, column: KanbanColumn, index?: number) =>
    new Promise<boolean>((resolve) => {
      setMoves((current) => [...current, { id, column, index, resolve }]);
    });

  return { moves, enqueue };
}
