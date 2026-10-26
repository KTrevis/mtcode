import { useEffect, useState } from "react";
import { type VoiceTranscriptionProvider } from "@t3tools/contracts";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

import { voiceTranscriptionModelOptions } from "./SettingsPanels.logic";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  listVoiceTranscriptionModels,
  readVoiceTranscriptionEnvironmentStatus,
} from "../../lib/voiceTranscription";

const TRANSCRIPTION_API_KEY_ENV = {
  openai: "OPENAI_API_KEY",
  groq: "GROQ_API_KEY",
} as const;

function VoiceDictationSettingsSection() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const [environmentApiKeys, setEnvironmentApiKeys] = useState({ openai: false, groq: false });
  const [environmentStatusLoading, setEnvironmentStatusLoading] = useState(true);
  const [environmentStatusError, setEnvironmentStatusError] = useState<string | null>(null);
  const [environmentStatusAttempt, setEnvironmentStatusAttempt] = useState(0);
  const [models, setModels] = useState<readonly string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const provider = settings.voiceTranscriptionProvider;
  const apiKey = settings.voiceTranscriptionApiKey;
  const model = settings.voiceTranscriptionModel;
  const selectableModels = voiceTranscriptionModelOptions(models, model);

  /* oxlint-disable react/set-state-in-effect -- Read credential availability from the connected server and cancel stale responses. Loading resets belong to this external request lifecycle. */
  // oxlint-disable-next-line t3code/react-effect-budget -- Read credential availability from the connected server and cancel stale responses.
  useEffect(() => {
    void environmentStatusAttempt;
    let active = true;
    setEnvironmentStatusLoading(true);
    setEnvironmentStatusError(null);
    void readVoiceTranscriptionEnvironmentStatus()
      .then((status) => {
        if (!active) return;
        setEnvironmentApiKeys(status);
        setEnvironmentStatusLoading(false);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setEnvironmentStatusLoading(false);
        setEnvironmentStatusError(
          cause instanceof Error ? cause.message : "Could not check server transcription keys.",
        );
      });
    return () => {
      active = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The retry counter explicitly reloads credential availability from the server.
  }, [environmentStatusAttempt]);
  /* oxlint-enable react/set-state-in-effect */

  const providerLabel = provider === "openai" ? "OpenAI" : "Groq";
  const environmentVariable = TRANSCRIPTION_API_KEY_ENV[provider];
  const hasEnvironmentApiKey = environmentApiKeys[provider];
  const hasApiKey = apiKey.trim().length > 0 || hasEnvironmentApiKey;

  /* oxlint-disable react/set-state-in-effect -- Debounce the remote transcription model catalog request when provider credentials change. Loading resets belong to this external request lifecycle. */
  // oxlint-disable-next-line t3code/react-effect-budget -- Debounce the remote transcription model catalog request when provider credentials change.
  useEffect(() => {
    if (!hasApiKey) {
      setModels([]);
      setModelsLoading(false);
      setModelsError(null);
      return;
    }

    let active = true;
    setModelsLoading(true);
    setModelsError(null);
    const timeout = window.setTimeout(
      () => {
        void listVoiceTranscriptionModels({ provider, apiKey })
          .then((nextModels) => {
            if (!active) return;
            setModels(nextModels);
            setModelsLoading(false);
          })
          .catch((cause: unknown) => {
            if (!active) return;
            setModels([]);
            setModelsLoading(false);
            setModelsError(
              cause instanceof Error ? cause.message : "Could not load transcription models.",
            );
          });
      },
      apiKey.trim() ? 400 : 0,
    );

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [apiKey, hasApiKey, provider]);
  /* oxlint-enable react/set-state-in-effect */

  const modelDescription = !hasApiKey
    ? environmentStatusLoading
      ? `Checking the connected server for ${environmentVariable}…`
      : environmentStatusError
        ? `${environmentStatusError} Add a client key or retry the server check.`
        : `Save an API key to load ${providerLabel} transcription models.`
    : modelsLoading
      ? `Loading models available from ${providerLabel}…`
      : modelsError
        ? modelsError
        : models.length === 0
          ? `${providerLabel} did not return any models.`
          : model && !models.includes(model)
            ? "The saved model was not returned by the provider. Keep it or choose another model."
            : "Choose a model. The microphone appears in the composer after that.";

  return (
    <SettingsSection title="Voice dictation">
      <SettingsRow
        {...searchableSetting("voice-dictation")}
        description="Codex-style dictation: cancel, insert into the end of the draft, or transcribe and send."
        control={
          <Select
            value={provider}
            onValueChange={(value) =>
              updateSettings({
                voiceTranscriptionProvider: value as VoiceTranscriptionProvider,
                voiceTranscriptionApiKey: "",
                voiceTranscriptionModel: "",
                voiceTranscriptionEnabled: false,
              })
            }
          >
            <SelectTrigger className="w-full sm:w-44" aria-label="Transcription provider">
              <SelectValue>{providerLabel}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="openai">
                OpenAI
              </SelectItem>
              <SelectItem hideIndicator value="groq">
                Groq
              </SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title={`${providerLabel} API key`}
        description={
          environmentStatusLoading
            ? `Checking whether ${environmentVariable} is configured on the connected server.`
            : environmentStatusError
              ? `${environmentStatusError} You can still enter a client key.`
              : hasEnvironmentApiKey
                ? `${environmentVariable} is configured on the connected server. A client key overrides it.`
                : `Stored in this client's settings. You can also set ${environmentVariable} on the server.`
        }
        control={
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Input
              type="password"
              autoComplete="off"
              className="w-full sm:w-64"
              value={apiKey}
              onChange={(event) =>
                updateSettings({
                  voiceTranscriptionApiKey: event.target.value,
                  voiceTranscriptionModel: "",
                  voiceTranscriptionEnabled: false,
                })
              }
              placeholder={hasEnvironmentApiKey ? `Using ${environmentVariable}` : "Required"}
              aria-label={`${providerLabel} transcription API key`}
            />
            {environmentStatusError ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() => setEnvironmentStatusAttempt((attempt) => attempt + 1)}
              >
                Retry
              </Button>
            ) : null}
          </div>
        }
      />
      <SettingsRow
        title="Transcription model"
        description={modelDescription}
        control={
          <Select
            value={model}
            disabled={modelsLoading || selectableModels.length === 0}
            onValueChange={(value) => {
              if (value !== null) {
                updateSettings({
                  voiceTranscriptionModel: value,
                  voiceTranscriptionEnabled: true,
                });
              }
            }}
          >
            <SelectTrigger className="w-full sm:w-64" aria-label="Transcription model">
              <SelectValue>
                {model || (modelsLoading ? "Loading models…" : "Select model")}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {selectableModels.map((availableModel) => (
                <SelectItem hideIndicator key={availableModel} value={availableModel}>
                  {availableModel}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    </SettingsSection>
  );
}

export { VoiceDictationSettingsSection };
