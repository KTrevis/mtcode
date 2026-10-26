import { LocalSkySettings } from "./LocalSkySettings";
import { isLocalSky, SKY_OPTIONS } from "../../artwork/skyArtwork";
import { useRef, useState } from "react";
import {
  DEFAULT_APP_ICON_SELECTION,
  DEFAULT_SIDEBAR_ARTWORK_SELECTION,
  MAX_CUSTOM_APP_ICON_BYTES,
  MAX_CUSTOM_SIDEBAR_ARTWORK_BYTES,
} from "@t3tools/contracts/settings";
import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

function SidebarArtworkRow() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const custom = settings.customSidebarArtworks;
  const selection = settings.sidebarArtwork;

  const options = [
    { value: "night", label: "Night sky" },
    { value: "day", label: "Blueprint" },
    { value: "local-day-night", label: "Local day & night" },
    { value: "local-weather", label: "Local day, night & weather" },
    ...SKY_OPTIONS,
    { value: "none", label: "None" },
    ...custom.map((artwork) => ({ value: artwork.id, label: artwork.name })),
  ];

  const onPickFile = async (file: File) => {
    setAddError(null);
    if (file.size > MAX_CUSTOM_SIDEBAR_ARTWORK_BYTES * 0.7) {
      // base64 inflates by ~4/3, so the on-disk limit is hit before the file one.
      setAddError("That image is too large. Pick one under about 350 KB.");
      return;
    }
    const image = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
    if (image === null || !image.startsWith("data:image/")) {
      setAddError("That file could not be read as an image.");
      return;
    }
    const id = `art_${Math.random().toString(36).slice(2, 10)}`;
    const name = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Artwork";
    updateSettings({
      customSidebarArtworks: [...custom, { id, name, image, createdAt: new Date().toISOString() }],
      sidebarArtwork: id,
    });
  };

  const removeArtwork = (id: string) => {
    updateSettings({
      customSidebarArtworks: custom.filter((artwork) => artwork.id !== id),
      ...(selection === id ? { sidebarArtwork: DEFAULT_SIDEBAR_ARTWORK_SELECTION } : {}),
    });
  };

  return (
    <SettingsRow
      {...searchableSetting("sidebar-artwork")}
      description="Artwork behind the sidebar header. Your own artwork syncs to every client signed in here."
      resetAction={
        selection !== DEFAULT_SIDEBAR_ARTWORK_SELECTION ? (
          <SettingResetButton
            label="sidebar artwork"
            onClick={() => updateSettings({ sidebarArtwork: DEFAULT_SIDEBAR_ARTWORK_SELECTION })}
          />
        ) : null
      }
      control={
        <div className="flex w-full flex-col items-end gap-2">
          <Select
            value={selection}
            onValueChange={(value) => {
              if (typeof value === "string") updateSettings({ sidebarArtwork: value });
            }}
          >
            <SelectTrigger className="w-full sm:w-60" aria-label="Sidebar artwork">
              <SelectValue>
                {options.find((option) => option.value === selection)?.label ?? "None"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {options.map((option) => (
                <SelectItem hideIndicator key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          {isLocalSky(selection) ? <LocalSkySettings /> : null}
          <div className="flex items-center gap-2">
            {custom.some((artwork) => artwork.id === selection) ? (
              <Button size="xs" variant="ghost" onClick={() => removeArtwork(selection ?? "")}>
                Remove
              </Button>
            ) : null}
            <Button size="xs" variant="outline" onClick={() => fileInputRef.current?.click()}>
              Add artwork
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void onPickFile(file);
            }}
          />
          {addError !== null ? <span className="text-2xs text-destructive">{addError}</span> : null}
        </div>
      }
    />
  );
}

function AppIconRow() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const custom = settings.customAppIcons;
  const selection = settings.appIcon;

  const options = [
    { value: "default", label: "KT Code" },
    { value: "light", label: "Light: black mark" },
    { value: "dark", label: "Dark: white mark" },
    { value: "match-artwork", label: "Match sidebar artwork" },
    { value: "local-day-night", label: "Local day & night" },
    { value: "local-weather", label: "Local day, night & weather" },
    ...SKY_OPTIONS,
    ...custom.map((icon) => ({ value: icon.id, label: icon.name })),
  ];

  const onPickFile = async (file: File) => {
    setAddError(null);
    if (file.size > MAX_CUSTOM_APP_ICON_BYTES * 0.7) {
      setAddError("That image is too large. Pick one under about 350 KB.");
      return;
    }
    const image = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
    // Electron's nativeImage reads PNG and JPEG only, so an SVG would save
    // fine here and then silently fail to draw.
    if (image === null || !/^data:image\/(png|jpeg|jpg)/.test(image)) {
      setAddError("Use a square PNG or JPEG.");
      return;
    }
    const id = `icon_${Math.random().toString(36).slice(2, 10)}`;
    const name = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Icon";
    updateSettings({
      customAppIcons: [...custom, { id, name, image, createdAt: new Date().toISOString() }],
      appIcon: id,
    });
  };

  const removeIcon = (id: string) => {
    updateSettings({
      customAppIcons: custom.filter((icon) => icon.id !== id),
      ...(selection === id ? { appIcon: DEFAULT_APP_ICON_SELECTION } : {}),
    });
  };

  return (
    <SettingsRow
      {...searchableSetting("app-icon")}
      description="Icon this app wears in the Dock and window. Your own icons sync to every client signed in here."
      resetAction={
        selection !== DEFAULT_APP_ICON_SELECTION ? (
          <SettingResetButton
            label="app icon"
            onClick={() => updateSettings({ appIcon: DEFAULT_APP_ICON_SELECTION })}
          />
        ) : null
      }
      control={
        <div className="flex w-full flex-col items-end gap-2">
          <Select
            value={selection}
            onValueChange={(value) => {
              if (typeof value === "string") updateSettings({ appIcon: value });
            }}
          >
            <SelectTrigger className="w-full sm:w-60" aria-label="App icon">
              <SelectValue>
                {options.find((option) => option.value === selection)?.label ?? "KT Code"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {options.map((option) => (
                <SelectItem hideIndicator key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          {isLocalSky(selection) ? <LocalSkySettings /> : null}
          {selection === "match-artwork" ? (
            <p className="max-w-sm text-xs text-muted-foreground">
              Keeps the MT mark and follows your sidebar artwork, including local daylight and
              weather. Applies to the running desktop app.
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            {custom.some((icon) => icon.id === selection) ? (
              <Button size="xs" variant="ghost" onClick={() => removeIcon(selection ?? "")}>
                Remove
              </Button>
            ) : null}
            <Button size="xs" variant="outline" onClick={() => fileInputRef.current?.click()}>
              Upload icon
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void onPickFile(file);
            }}
          />
          {addError !== null ? <span className="text-2xs text-destructive">{addError}</span> : null}
        </div>
      }
    />
  );
}

export { SidebarArtworkRow, AppIconRow };
