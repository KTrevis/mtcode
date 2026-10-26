import { ClerkProvider } from "@clerk/react";
import type { ReactNode } from "react";

import { ManagedRelayAuthProvider } from "../../cloud/managedAuth";
import { clerkAppearance } from "./clerkAppearance";

/** Lazy-load Clerk so cloudless local mode never downloads it. */
export default function BrowserManagedAuthShell({
  publishableKey,
  wrapRelay = true,
  children,
}: {
  readonly publishableKey: string;
  readonly wrapRelay?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <ClerkProvider appearance={clerkAppearance} publishableKey={publishableKey}>
      {wrapRelay ? <ManagedRelayAuthProvider>{children}</ManagedRelayAuthProvider> : children}
    </ClerkProvider>
  );
}
