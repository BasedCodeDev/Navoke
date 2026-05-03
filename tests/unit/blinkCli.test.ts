import { describe, expect, it } from "vitest";
import { extractSseMessages, parseBlinkArgs, runCli, type WatchRunOptions } from "../../src/cli";

describe("blink CLI", () => {
  it("parses global and run command options", () => {
    expect(
      parseBlinkArgs([
        "--api-url",
        "http://127.0.0.1:4999",
        "run",
        "test.workflow",
        "--input",
        "input.json",
        "--name=Test Run",
        "--agent",
        "codex",
        "--wait"
      ])
    ).toMatchObject({
      kind: "run",
      globals: { apiUrl: "http://127.0.0.1:4999" },
      workflowId: "test.workflow",
      inputFile: "input.json",
      name: "Test Run",
      agentName: "codex",
      wait: true
    });
  });

  it("prints JSON for workflow listing", async () => {
    const stdout: string[] = [];
    const code = await runCli(["workflows"], {
      cwd: "C:\\repo",
      env: {},
      stdout: (line) => stdout.push(line),
      discoverRuntime: async () => ({ apiUrl: "http://api", source: "flag" }),
      request: async <T>() => [{ manifest: { id: "test.workflow" } }] as T
    });

    expect(code).toBe(0);
    expect(JSON.parse(stdout[0])).toMatchObject({
      ok: true,
      apiUrl: "http://api",
      workflows: [{ manifest: { id: "test.workflow" } }]
    });
  });

  it("loads JSON input and sends CLI origin metadata when starting a run", async () => {
    const stdout: string[] = [];
    const requests: Array<{ path: string; body: unknown }> = [];
    const code = await runCli(["run", "test.workflow", "--input", "input.json", "--agent", "codex"], {
      cwd: "C:\\repo",
      env: {},
      pid: 123,
      stdout: (line) => stdout.push(line),
      readFile: () => JSON.stringify({ prompt: "Go" }),
      discoverRuntime: async () => ({ apiUrl: "http://api", source: "flag" }),
      request: async <T>(_apiUrl: string, _method: string, apiPath: string, body: unknown) => {
        requests.push({ path: apiPath, body });
        return { id: "run-1", status: "queued" } as T;
      }
    });

    expect(code).toBe(0);
    expect(requests[0]).toMatchObject({
      path: "/api/runs",
      body: {
        workflowId: "test.workflow",
        input: { prompt: "Go" },
        origin: {
          source: "cli",
          agentName: "codex",
          cwd: "C:\\repo",
          pid: 123,
          cliVersion: "0.1.0"
        }
      }
    });
    expect(JSON.parse(stdout[0])).toMatchObject({ ok: true, run: { id: "run-1" } });
  });

  it("prints newline-delimited JSON when waiting for a run", async () => {
    const stdout: string[] = [];
    const code = await runCli(["run", "test.workflow", "--input", "input.json", "--wait"], {
      cwd: "C:\\repo",
      env: {},
      stdout: (line) => stdout.push(line),
      readFile: () => "{}",
      discoverRuntime: async () => ({ apiUrl: "http://api", source: "flag" }),
      request: async <T>() => ({ id: "run-1", status: "running" }) as T,
      watchRun: async (_apiUrl: string, runId: string, options: WatchRunOptions) => {
        options.stdout(`${JSON.stringify({ type: "run.finished", run: { id: runId, status: "completed" } })}\n`);
        return { id: runId, status: "completed" };
      }
    });

    expect(code).toBe(0);
    expect(stdout.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ type: "run.created", run: { id: "run-1", status: "running" } }),
      { type: "run.finished", run: { id: "run-1", status: "completed" } }
    ]);
  });

  it("prints JSON errors and a usage exit code", async () => {
    const stderr: string[] = [];
    const code = await runCli(["run", "test.workflow"], {
      stderr: (line) => stderr.push(line)
    });

    expect(code).toBe(2);
    expect(JSON.parse(stderr[0])).toMatchObject({
      ok: false,
      error: { exitCode: 2 }
    });
  });

  it("extracts SSE data messages for watch output", () => {
    expect(extractSseMessages('event: ready\ndata: {"ok":true}\n\ndata: {"kind":"run-updated","runId":"1"}\n\npartial')).toEqual({
      messages: ['{"ok":true}', '{"kind":"run-updated","runId":"1"}'],
      remainder: "partial"
    });
  });
});
