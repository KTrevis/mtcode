import { useEffect, type ReactNode } from "react";

import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { setSelfHostedNotificationConnections } from "./selfHostedNotifications";

export function SelfHostedNotificationsProvider(props: { readonly children: ReactNode }) {
  const { savedConnectionsById } = useSavedRemoteConnections();

  // oxlint-disable-next-line t3code/react-effect-budget -- Synchronize saved server connections with the external notification subscription manager.
  useEffect(() => {
    setSelfHostedNotificationConnections(Object.values(savedConnectionsById));
  }, [savedConnectionsById]);

  return props.children;
}
