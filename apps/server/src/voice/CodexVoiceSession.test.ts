// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - drives a real Codex-shaped child process from a temp dir.
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, expect, it } from "@effect/vitest";
import { CodexVoiceSession } from "./CodexVoiceSession.ts";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(
  mode: string,
  askAgent: (prompt: string, signal: AbortSignal) => Promise<string>,
) {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-voice-test-"));
  cleanups.push(() => NodeFSP.rm(dir, { recursive: true, force: true }));
  const script = NodePath.join(dir, "app-server");
  const spokenPath = NodePath.join(dir, "spoken.json");
  const handledPath = NodePath.join(dir, "handled.json");
  const waitForWrite = (name: string) =>
    new Promise<void>((resolve) => {
      const watcher = NodeFS.watch(dir, (_event, filename) => {
        if (filename === name) {
          watcher.close();
          resolve();
        }
      });
      cleanups.push(() => watcher.close());
    });
  const handled = waitForWrite("handled.json");
  const spoken = waitForWrite("spoken.json");
  await NodeFSP.writeFile(
    script,
    `
import { createInterface } from 'node:readline';
import { writeFileSync, renameSync } from 'node:fs';
let replies = 0;
const write = (path, value) => { writeFileSync(path+'.tmp',value); renameSync(path+'.tmp',path); };
const send = (v) => process.stdout.write(JSON.stringify(v)+'\\n');
createInterface({input:process.stdin}).on('line', l => {
  const m=JSON.parse(l);
  if(typeof m.id === 'string' && m.id.startsWith('tool-')) {
    replies += 1;
    if(replies === ${JSON.stringify(mode === "repeat" ? 3 : 1)}) write(${JSON.stringify(handledPath)}, 'done');
  }
  if(m.method==='initialize') send({id:m.id,result:{}});
  if(m.method==='account/read') send({id:m.id,result:{account:{type:${JSON.stringify(mode === "apikey" ? "apiKey" : "chatgpt")}}}});
  if(m.method==='thread/start') send({id:m.id,result:{thread:{id:'test-thread'}}});
  if(m.method==='thread/realtime/start') {
    send({id:m.id,result:{}});
    if(${JSON.stringify(mode)}==='error') send({method:'thread/realtime/error',params:{message:'Voice entitlement unavailable'}});
    else {
      send({method:'thread/realtime/sdp',params:{sdp:'answer-sdp'}});
      send({id:'tool-1',method:'item/tool/call',params:{tool:'ask_selected_agent',arguments:{prompt:'Ask Claude for the result'}}});
      // GPT-Live repeats the handoff for a single spoken request.
      if(${JSON.stringify(mode)}==='repeat') {
        send({id:'tool-2',method:'item/tool/call',params:{tool:'ask_selected_agent',arguments:{prompt:'Ask Claude for the result'}}});
        send({id:'tool-3',method:'item/tool/call',params:{tool:'ask_selected_agent',arguments:{prompt:'Ask Claude for the result'}}});
      }
    }
  }
  if(m.method==='thread/realtime/appendSpeech') { send({id:m.id,result:{}}); write(${JSON.stringify(spokenPath)}, JSON.stringify(m.params)); }
  if(m.method==='thread/realtime/stop') process.exit(0);
});
process.stdin.on('end',()=>process.exit(0));
`,
  );
  // Node treats "app-server" as the script, matching the real executable's argv.
  const session = new CodexVoiceSession({
    command: process.execPath,
    args: ["app-server"],
    cwd: dir,
    askAgent,
  });
  cleanups.push(() => session.close());
  return { session, spokenPath, handled, spoken };
}

it("waits for the SDP notification and routes a tool request to the selected agent", async () => {
  let complete!: (value: string) => void;
  const asked = new Promise<string>((resolve) => {
    complete = resolve;
  });
  const { session } = await fixture("ok", async (prompt) => {
    complete(prompt);
    return "Claude's answer";
  });
  expect(await session.start("offer-sdp")).toBe("answer-sdp");
  expect(await asked).toBe("Ask Claude for the result");
  expect(session.renew()).toBeUndefined();
  session.close();
  expect(session.renew()).toBe("Voice session ended.");
});

it("keeps a repeat ping quiet instead of asking the agent twice", async () => {
  const asked: string[] = [];
  const { session, handled } = await fixture("repeat", async (prompt) => {
    asked.push(prompt);
    return "Claude's answer";
  });
  await session.start("offer-sdp");
  await handled;
  expect(asked).toHaveLength(1);
});

it("runs one turn when GPT-Live repeats a handoff for the same request", async () => {
  let asked = 0;
  let release!: (value: string) => void;
  const answer = new Promise<string>((resolve) => {
    release = resolve;
  });
  const { session, handled } = await fixture("repeat", async () => {
    asked += 1;
    return answer;
  });
  await session.start("offer-sdp");
  await handled;
  release("Claude's answer");
  await answer;
  expect(asked).toBe(1);
});

it("hands the agent reply back into the conversation", async () => {
  let release!: (value: string) => void;
  const answer = new Promise<string>((resolve) => {
    release = resolve;
  });
  const { session, spokenPath, handled, spoken } = await fixture("ok", () => answer);
  await session.start("offer-sdp");
  await handled;
  release("17 times 23 is 391.");
  await answer;
  await spoken;
  expect(JSON.parse(await NodeFSP.readFile(spokenPath, "utf8")).text).toContain(
    "17 times 23 is 391.",
  );
});

it("does not mistake an RPC acknowledgement for a working voice connection", async () => {
  const { session } = await fixture("error", async () => "unused");
  await expect(session.start("offer-sdp")).rejects.toThrow("Voice entitlement unavailable");
});

it("requires ChatGPT login and never silently falls back to paid API authentication", async () => {
  const { session } = await fixture("apikey", async () => "unused");
  await expect(session.start("offer-sdp")).rejects.toThrow(
    "Sign in to Codex with your ChatGPT account",
  );
});

it("aborts pending handoff waits when voice closes", async () => {
  let received!: (value: AbortSignal) => void;
  const asked = new Promise<AbortSignal>((resolve) => {
    received = resolve;
  });
  const { session } = await fixture("ok", async (_prompt, signal) => {
    received(signal);
    return new Promise((resolve) =>
      signal.addEventListener("abort", () => resolve("ended"), { once: true }),
    );
  });
  await session.start("offer-sdp");
  const signal = await asked;
  session.close();
  expect(signal.aborted).toBe(true);
});
