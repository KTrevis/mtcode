// @effect-diagnostics globalTimers:off -- Bound Electron promises at the native callback boundary.
import type { DesktopPreviewNavigateOptions } from "@t3tools/contracts";
import type * as NodeEvents from "node:events";
import type { WebContents } from "electron";

/** Listen before loadURL so readiness belongs to the new navigation. */
export async function navigateWebContents(
  wc: Pick<WebContents, "loadURL"> & Pick<NodeEvents.EventEmitter, "once" | "off">,
  url: string,
  options?: DesktopPreviewNavigateOptions,
): Promise<void> {
  const readiness = options?.readiness ?? "load";
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onReady: () => void = () => {};
  try {
    const domReady = new Promise<void>((resolve) => {
      onReady = resolve;
      if (readiness === "domContentLoaded") wc.once("dom-ready", onReady);
    });
    const loaded = wc.loadURL(url);
    if (readiness === "none") {
      // Load failures are also reported by the manager's did-fail-load listener.
      void loaded.catch(() => undefined);
      return;
    }
    await Promise.race([
      loaded,
      ...(readiness === "domContentLoaded" ? [domReady] : []),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Preview navigation did not reach ${readiness} readiness.`)),
          options?.timeoutMs ?? 15_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    if (readiness === "domContentLoaded") wc.off("dom-ready", onReady);
  }
}
