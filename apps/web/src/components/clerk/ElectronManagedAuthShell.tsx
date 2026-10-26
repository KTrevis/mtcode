import { passkeys } from "@clerk/electron/passkeys";
import { ClerkProvider } from "@clerk/electron/react";
import type { ReactNode } from "react";

import { ManagedRelayAuthProvider } from "../../cloud/managedAuth";
import { clerkAppearance } from "./clerkAppearance";

/** Load only lazily inside desktop; clerk-js is statically bundled and would otherwise enter every
 * client's startup graph. */
export default function ElectronManagedAuthShell({
  publishableKey,
  wrapRelay = true,
  children,
}: {
  readonly publishableKey: string;
  readonly wrapRelay?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <ClerkProvider appearance={clerkAppearance} publishableKey={publishableKey} passkeys={passkeys}>
      {wrapRelay ? <ManagedRelayAuthProvider>{children}</ManagedRelayAuthProvider> : children}
    </ClerkProvider>
  );
}
