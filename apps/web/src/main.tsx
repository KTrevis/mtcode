import { ConnectProvidersRoot, useConnectProviders } from "./cloud/connectProviderContext";
import { providerHasRelay } from "./cloud/connectProviders";
import React from "react";
import ReactDOM from "react-dom/client";

import "@fontsource-variable/inter";
import "./index.css";

import { hasCloudPublicConfig } from "./cloud/publicConfig";
import { isElectron } from "./env";
import { startAppServices } from "./appInit";
import { AppRoot } from "./AppRoot";
import { clearChunkReloadGuard, reloadOnceForChunkLoadError } from "./lib/chunkReloadGuard";

const router = startAppServices();

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

const ConnectManagedAuthShell = React.lazy(() =>
  isElectron
    ? import("./components/clerk/ElectronManagedAuthShell")
    : import("./components/clerk/BrowserManagedAuthShell"),
);

function ConnectAuthGate({ children }: { readonly children: React.ReactNode }) {
  const { embedded } = useConnectProviders();
  const publishableKey = embedded?.clerkPublishableKey ?? clerkPublishableKey;
  if (!publishableKey || (!embedded && !hasCloudPublicConfig())) return children;
  return (
    <React.Suspense fallback={null}>
      <ConnectManagedAuthShell
        key={embedded?.id ?? "clerk"}
        publishableKey={publishableKey}
        wrapRelay={embedded ? providerHasRelay(embedded) : true}
      >
        {children}
      </ConnectManagedAuthShell>
    </React.Suspense>
  );
}

let chunkLoadFailed = false;
let reloadScheduled = false;
window.addEventListener("vite:preloadError", (event) => {
  chunkLoadFailed = true;
  if (reloadOnceForChunkLoadError()) {
    reloadScheduled = true;
    event.preventDefault();
  }
});

const app = <AppRoot router={router} />;

// Split by runtime to keep Clerk out of local startup and clerk-js out of browser builds.
const managedAuthShellModule =
  clerkPublishableKey && hasCloudPublicConfig()
    ? isElectron
      ? import("./components/clerk/ElectronManagedAuthShell")
      : import("./components/clerk/BrowserManagedAuthShell")
    : null;

export const startup = Promise.all([
  managedAuthShellModule?.then((module) => module.default) ?? null,
  router.load(),
])
  .then(() => {
    // Route chunk failures resolve router.load() and surface later through the error boundary.
    if (reloadScheduled) return;
    if (!chunkLoadFailed) clearChunkReloadGuard();
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <ConnectProvidersRoot>
          <ConnectAuthGate>{app}</ConnectAuthGate>
        </ConnectProvidersRoot>
      </React.StrictMode>,
    );
  })
  .catch((error: unknown) => {
    if (reloadScheduled) return;
    throw error;
  });
