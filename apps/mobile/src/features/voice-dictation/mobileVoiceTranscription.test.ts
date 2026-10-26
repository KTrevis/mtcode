import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  configuredMobileVoiceTranscriber,
  transcribeMobileVoiceRecording,
} from "./mobileVoiceTranscription";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("transcribeMobileVoiceRecording", () => {
  it.each([
    {
      provider: "openai" as const,
      apiKey: " openai-secret ",
      model: "gpt-4o-transcribe",
      endpoint: "https://api.openai.com/v1/audio/transcriptions",
    },
    {
      provider: "groq" as const,
      apiKey: " groq-secret ",
      model: "whisper-large-v3-turbo",
      endpoint: "https://api.groq.com/openai/v1/audio/transcriptions",
    },
  ])("sends an iPhone recording directly to $provider", async (config) => {
    const entries: Array<[string, unknown]> = [];
    vi.stubGlobal(
      "FormData",
      class {
        append(name: string, value: unknown) {
          entries.push([name, value]);
        }
      },
    );
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ text: " hello " }));

    await expect(
      transcribeMobileVoiceRecording("file:///recording.m4a", config, fetchMock),
    ).resolves.toBe("hello");

    expect(fetchMock).toHaveBeenCalledWith(
      config.endpoint,
      expect.objectContaining({
        method: "POST",
        headers: { authorization: `Bearer ${config.apiKey.trim()}` },
      }),
    );
    expect(entries).toEqual([
      ["model", config.model],
      [
        "file",
        {
          uri: "file:///recording.m4a",
          name: "recording.m4a",
          type: "audio/mp4",
        },
      ],
    ]);
  });

  it("includes the provider error when the request fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ error: { message: "Unknown model" } }, { status: 400 }));

    await expect(
      transcribeMobileVoiceRecording(
        "file:///recording.m4a",
        {
          provider: "groq",
          apiKey: "groq-secret",
          model: "future-model",
        },
        fetchMock,
      ),
    ).rejects.toThrow("Unknown model");
  });
});

it("uses configured cloud transcription and honors preparation cancellation", async () => {
  const config = { provider: "groq" as const, apiKey: "key", model: "whisper-large-v3-turbo" };
  expect(configuredMobileVoiceTranscriber({ ...config, apiKey: " " })).toBeNull();
  const transcriber = configuredMobileVoiceTranscriber(config)!;
  const active = await transcriber.prepare({ signal: new AbortController().signal });
  expect(active.locale).toBe("auto");
  const cancelled = new AbortController();
  cancelled.abort();
  await expect(transcriber.prepare({ signal: cancelled.signal })).rejects.toThrow();
});
