import { useStableCallback } from "./useStableCallback";
import { useEffect, useState } from "react";
import type {
  DesktopComputerUsePermission,
  DesktopComputerUsePermissionsState,
} from "@t3tools/contracts";

function isDesktopHost(): boolean {
  return typeof window !== "undefined" && window.desktopBridge !== undefined;
}

function isMissingPermission(permission: DesktopComputerUsePermission): boolean {
  return permission.status !== "granted" && permission.status !== "notRequired";
}

export function useComputerUsePermissions() {
  const [state, setState] = useState<DesktopComputerUsePermissionsState | null>(null);

  const refresh = useStableCallback(async () => {
    const bridge = window.desktopBridge;
    if (!bridge?.getComputerUsePermissions) {
      setState(null);
      return;
    }
    try {
      setState(await bridge.getComputerUsePermissions());
    } catch {
      setState(null);
    }
  });

  // oxlint-disable-next-line t3code/react-effect-budget -- Desktop privacy grants change outside React when the user returns from system settings.
  useEffect(() => {
    if (!isDesktopHost() || window.desktopBridge?.getComputerUsePermissions === undefined) {
      return;
    }
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const id = window.setInterval(() => void refresh(), 4000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(id);
    };
  }, [refresh]);

  const missing = state?.permissions.filter(isMissingPermission) ?? [];

  const openPermission = async (permission: DesktopComputerUsePermission) => {
    await window.desktopBridge?.openComputerUsePrivacySettings?.(permission.kind);
    window.setTimeout(() => void refresh(), 1500);
  };

  return {
    missing,
    openPermission,
    supported: isDesktopHost() && window.desktopBridge?.getComputerUsePermissions !== undefined,
  };
}
