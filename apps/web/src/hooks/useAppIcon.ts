import { useEffect, useState } from "react";

import { usePrimarySettings } from "./useSettings";
import { useSidebarStageBackdropVariant } from "../components/SidebarStageBackdrop";
import { isLocalSky, SKY_OPTIONS, skyIconKey } from "../artwork/skyArtwork";
import {
  BLUEPRINT_ICON_BACKGROUND,
  renderArtworkAppIcon,
  renderSkyAppIcon,
} from "../artwork/appIconArtwork";

// Keeps the running app's icon in step with the account's choice.
export function useAppIcon(): void {
  const { selection, custom } = usePrimarySettings((settings) => ({
    selection: settings.appIcon,
    custom: settings.customAppIcons,
  }));
  const artworkMode =
    selection === "match-artwork" ||
    isLocalSky(selection) ||
    SKY_OPTIONS.some((option) => option.value === selection);
  const artwork = useSidebarStageBackdropVariant(
    true,
    selection === "match-artwork" ? undefined : artworkMode ? selection : "none",
  );
  const sky = artwork?.kind === "sky" ? artwork.conditions : undefined;
  // The icon only moves when its coarser rounding of the sky does, so the sky
  // is held until then and the repaint does not re-run on every tick.
  const skyKey = sky ? skyIconKey(sky) : null;
  const [iconSky, setIconSky] = useState({ key: skyKey, sky });
  if (iconSky.key !== skyKey) setIconSky({ key: skyKey, sky });
  // The Nightly scene is the shipped tile itself, so it wears the shipped icon.
  // It is also where a local sky lands before it has a location or a forecast,
  // and redrawing it from the raw layers loses the tile's glass and shape.
  const background =
    artwork?.kind === "custom"
      ? artwork.image
      : artwork?.kind === "dev"
        ? BLUEPRINT_ICON_BACKGROUND
        : null;

  // oxlint-disable-next-line t3code/react-effect-budget -- Synchronize artwork with the Electron application icon.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const setIcon = window.desktopBridge?.setAppIcon;
    if (setIcon === undefined) return;
    let cancelled = false;
    if (artworkMode) {
      const current = iconSky.sky;
      if (current === undefined && background === null) {
        void setIcon({ id: "default" }).catch(() => undefined);
      } else {
        // A sky recolours the shipped tile; anything else is cropped artwork.
        void (current ? renderSkyAppIcon(current) : renderArtworkAppIcon(background!))
          .then((image) => {
            if (!cancelled) return setIcon({ id: "artwork", image });
          })
          .catch(() => {
            if (!cancelled) void setIcon({ id: "default" }).catch(() => undefined);
          });
      }
      return () => {
        cancelled = true;
      };
    }
    const own = custom.find((icon) => icon.id === selection);
    void setIcon(own ? { id: own.id, image: own.image } : { id: selection }).catch(() => undefined);
  }, [custom, selection, artworkMode, background, iconSky]);
}
