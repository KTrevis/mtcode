import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import {
  deriveMonitoringTasks,
  monitoringCategoryLabel,
  formatMonitoringDuration,
} from "@t3tools/client-runtime/state/monitoring";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { AppText as Text } from "../../components/AppText";

export function MonitoringDetails({
  activities,
  onStop,
  active,
}: {
  activities: ReadonlyArray<OrchestrationThreadActivity>;
  onStop: (taskId: string) => Promise<void>;
  active: boolean;
}) {
  const tasks = useMemo(() => deriveMonitoringTasks(activities), [activities]);
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const running = active && tasks.length > 0;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [running]);
  const time = (value: string) =>
    new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  async function stop(id: string) {
    setStopping((current) => new Set(current).add(id));
    setError(null);
    try {
      await onStop(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStopping((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }
  if (!active) return null;
  return (
    <View className="border-b border-border px-4 py-2">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Monitoring details"
        onPress={() => setOpen(!open)}
        className="min-h-11 justify-center"
      >
        <Text className="font-t3-medium text-sm">
          Monitoring
          {tasks.length === 1 && tasks[0] ? ` · ${formatMonitoringDuration(tasks[0], now)}` : ""}
          {` · ${open ? "Hide details" : "Details"}`}
        </Text>
      </Pressable>
      {open ? (
        <ScrollView className="max-h-64">
          {tasks.length === 0 ? (
            <Text className="text-xs text-foreground-muted">
              Waiting for an event. Task details are unavailable.
            </Text>
          ) : (
            tasks.map((task) => (
              <View key={task.id} className="gap-1 border-b border-border py-3">
                <Text className="text-xs text-foreground-muted">
                  {monitoringCategoryLabel[task.category]}
                </Text>
                <Text className="font-t3-medium text-sm">{task.label}</Text>
                <Text className="text-xs text-foreground-muted">
                  {`Running for ${formatMonitoringDuration(task, now)} · ${task.nextWakeAt ? `Check at ${time(task.nextWakeAt)}` : "Waiting for an event"}`}
                </Text>
                <Text className="font-mono text-xs text-foreground-muted" selectable>
                  {task.command}
                </Text>
                {task.result ? (
                  <Text className="text-xs">
                    Checked at {time(task.result.at)} · {task.result.text}
                  </Text>
                ) : null}
                {task.stoppable ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Stop ${task.label}`}
                    disabled={stopping.has(task.id)}
                    onPress={() => void stop(task.id)}
                    className="min-h-11 justify-center"
                  >
                    <Text className="text-sm text-danger-foreground">
                      {stopping.has(task.id) ? "Stopping…" : "Stop"}
                    </Text>
                  </Pressable>
                ) : (
                  <Text className="text-xs text-foreground-muted">
                    This provider supports stopping background work together.
                  </Text>
                )}
              </View>
            ))
          )}
          {error ? (
            <Text accessibilityRole="alert" className="text-xs text-danger-foreground">
              {error}
            </Text>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}
