import { useAtomCommand } from "~/state/use-atom-command";
import {
  monitoringCategoryLabel,
  formatMonitoringDuration,
  type MonitoringTask,
} from "@t3tools/client-runtime/state/monitoring";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { threadEnvironment } from "~/state/threads";
import { Button } from "./ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "./ui/popover";

export function MonitoringDetails({
  tasks,
  environmentId,
  threadId,
}: {
  tasks: ReadonlyArray<MonitoringTask>;
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const stop = useAtomCommand(threadEnvironment.interruptTurn, "stop monitoring task");
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const running = tasks.length > 0;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [running]);
  const time = (value: string) =>
    new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  async function stopTask(id: string) {
    setError(null);
    setStopping((current) => new Set(current).add(id));
    try {
      const result = await stop({ environmentId, input: { threadId, taskId: id } });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        setError(String(squashAtomCommandFailure(result)));
      }
    } finally {
      setStopping((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }
  return (
    <Popover>
      <PopoverTrigger render={<Button size="xs" variant="ghost" />} aria-label="Monitoring details">
        Monitoring
        {tasks.length === 1 && tasks[0] ? ` · ${formatMonitoringDuration(tasks[0], now)}` : null}
      </PopoverTrigger>
      <PopoverPopup width="lg" side="top" align="end">
        <PopoverTitle>Monitoring</PopoverTitle>
        <div className="mt-3 max-h-80 space-y-3 overflow-y-auto">
          {tasks.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Waiting for an event. Task details are unavailable.
            </p>
          ) : (
            tasks.map((task) => (
              <section
                key={task.id}
                className="border-b border-border/50 pb-3 last:border-0 last:pb-0"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-2xs text-muted-foreground">
                      {monitoringCategoryLabel[task.category]}
                    </p>
                    <p className="break-words text-sm font-medium">{task.label}</p>
                  </div>
                  {task.stoppable ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={stopping.has(task.id)}
                      aria-label={`Stop ${task.label}`}
                      onClick={() => void stopTask(task.id)}
                    >
                      {stopping.has(task.id) ? "Stopping…" : "Stop"}
                    </Button>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {`Running for ${formatMonitoringDuration(task, now)} · ${task.nextWakeAt ? `Check at ${time(task.nextWakeAt)}` : "Waiting for an event"}`}
                </p>
                <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-2xs text-muted-foreground">
                  {task.command}
                </pre>
                {task.result ? (
                  <p className="mt-2 whitespace-pre-wrap break-words text-xs">
                    Checked at {time(task.result.at)} · {task.result.text}
                  </p>
                ) : null}
                {!task.stoppable ? (
                  <p className="mt-1 text-2xs text-muted-foreground">
                    This provider supports stopping background work together.
                  </p>
                ) : null}
              </section>
            ))
          )}
          {error ? (
            <p role="alert" className="text-xs text-destructive-foreground">
              {error}
            </p>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
