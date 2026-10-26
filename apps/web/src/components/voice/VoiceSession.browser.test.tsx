import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";

vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => () => {} }));
import { VoiceSessionProvider, useVoiceSession } from "./VoiceSession";

function Controls({ version }: { readonly version: number }) {
  const voice = useVoiceSession();
  return (
    <>
      <button type="button" onClick={voice.start}>
        Start fixture voice
      </button>
      <output aria-label="Fixture voice status">
        {version}: {voice.status}: {voice.errorMessage}
      </output>
    </>
  );
}

it("keeps a voice error visible across provider rerenders", async () => {
  await using screen = await render(
    <VoiceSessionProvider>
      <Controls version={1} />
    </VoiceSessionProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Start fixture voice" }));
  await expect
    .element(screen.getByRole("status", { name: "Fixture voice status" }))
    .toHaveTextContent("1: error: Open a task before starting voice.");
  await screen.rerender(
    <VoiceSessionProvider>
      <Controls version={2} />
    </VoiceSessionProvider>,
  );
  await expect
    .element(screen.getByRole("status", { name: "Fixture voice status" }))
    .toHaveTextContent("2: error: Open a task before starting voice.");
  await screen.unmount();
});
