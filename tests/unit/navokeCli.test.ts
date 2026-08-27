import { describe, expect, it, vi } from "vitest";
import { DEFAULT_API_URL, extractSseMessages, parseNavokeArgs, runCli, watchRun, type WatchRunOptions } from "../../src/cli";

describe("Navoke CLI", () => {
  it("parses global and run command options", () => {
    expect(
      parseNavokeArgs([
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

  it("parses library run command options", () => {
    expect(
      parseNavokeArgs([
        "--project",
        "C:\\project",
        "library",
        "run",
        "entry-1",
        "--name",
        "Library Run",
        "--input-overrides",
        "overrides.json",
        "--agent=codex",
        "--wait"
      ])
    ).toMatchObject({
      kind: "library-run",
      globals: { projectPath: "C:\\project" },
      entryId: "entry-1",
      name: "Library Run",
      inputOverridesFile: "overrides.json",
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

  it("resolves legacy workflow IDs to the canonical manifest", async () => {
    const stdout: string[] = [];
    const code = await runCli(["workflow", "based-blink.example"], {
      cwd: "C:\\repo",
      env: {},
      stdout: (line) => stdout.push(line),
      discoverRuntime: async () => ({ apiUrl: "http://api", source: "flag" }),
      request: async <T>() => [{ manifest: { id: "navoke.example" } }] as T
    });

    expect(code).toBe(0);
    expect(JSON.parse(stdout[0])).toMatchObject({ workflow: { manifest: { id: "navoke.example" } } });
  });

  it("prints JSON for library listing and entries", async () => {
    const stdout: string[] = [];
    const requests: Array<{ method: string; path: string }> = [];
    const code = await runCli(["library"], {
      cwd: "C:\\repo",
      env: {},
      stdout: (line) => stdout.push(line),
      discoverRuntime: async () => ({ apiUrl: "http://api", source: "flag" }),
      request: async <T>(_apiUrl: string, method: string, apiPath: string) => {
        requests.push({ method, path: apiPath });
        return [{ id: "entry-1", name: "Reusable" }] as T;
      }
    });

    expect(code).toBe(0);
    expect(requests).toEqual([{ method: "GET", path: "/api/library" }]);
    expect(JSON.parse(stdout[0])).toMatchObject({ ok: true, entries: [{ id: "entry-1" }] });

    stdout.length = 0;
    requests.length = 0;
    const getCode = await runCli(["library", "get", "entry-1"], {
      cwd: "C:\\repo",
      env: {},
      stdout: (line) => stdout.push(line),
      discoverRuntime: async () => ({ apiUrl: "http://api", source: "flag" }),
      request: async <T>(_apiUrl: string, method: string, apiPath: string) => {
        requests.push({ method, path: apiPath });
        return { id: "entry-1", name: "Reusable" } as T;
      }
    });

    expect(getCode).toBe(0);
    expect(requests).toEqual([{ method: "GET", path: "/api/library/entry-1" }]);
    expect(JSON.parse(stdout[0])).toMatchObject({ ok: true, entry: { id: "entry-1" } });
  });

  it("allows read-only commands to use the default runtime fallback", async () => {
    const stdout: string[] = [];
    const requests: Array<{ method: string; path: string }> = [];
    const code = await runCli(["status"], {
      cwd: "C:\\repo",
      env: {},
      stdout: (line) => stdout.push(line),
      discoverRuntime: async () => ({ apiUrl: DEFAULT_API_URL, source: "default" }),
      request: async <T>(_apiUrl: string, method: string, apiPath: string) => {
        requests.push({ method, path: apiPath });
        return { ok: true } as T;
      }
    });

    expect(code).toBe(0);
    expect(requests).toEqual([
      { method: "GET", path: "/api/health" },
      { method: "GET", path: "/api/system" }
    ]);
    expect(JSON.parse(stdout[0])).toMatchObject({
      ok: true,
      apiUrl: DEFAULT_API_URL,
      runtimeSource: "default"
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

  it("starts a run from a library entry with overrides and CLI origin metadata", async () => {
    const stdout: string[] = [];
    const requests: Array<{ path: string; body: unknown }> = [];
    const code = await runCli(
      ["library", "run", "entry-1", "--name", "From Library", "--input-overrides", "overrides.json", "--agent", "codex"],
      {
        cwd: "C:\\repo",
        env: {},
        pid: 123,
        stdout: (line) => stdout.push(line),
        readFile: () => JSON.stringify({ prompt: "Override" }),
        discoverRuntime: async () => ({ apiUrl: "http://api", source: "flag" }),
        request: async <T>(_apiUrl: string, _method: string, apiPath: string, body: unknown) => {
          requests.push({ path: apiPath, body });
          return { id: "run-1", status: "queued" } as T;
        }
      }
    );

    expect(code).toBe(0);
    expect(requests[0]).toMatchObject({
      path: "/api/library/entry-1/runs",
      body: {
        name: "From Library",
        inputOverrides: { prompt: "Override" },
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

  it("refuses to start a run through the default runtime fallback", async () => {
    const stderr: string[] = [];
    const requests: unknown[] = [];
    const code = await runCli(["run", "test.workflow", "--input", "input.json", "--agent", "codex"], {
      cwd: "C:\\repo",
      env: {},
      stderr: (line) => stderr.push(line),
      readFile: () => {
        throw new Error("input should not be read");
      },
      discoverRuntime: async () => ({ apiUrl: DEFAULT_API_URL, source: "default" }),
      request: async <T>() => {
        requests.push({});
        return {} as T;
      }
    });

    expect(code).toBe(2);
    expect(requests).toEqual([]);
    expect(JSON.parse(stderr[0])).toMatchObject({
      ok: false,
      error: {
        exitCode: 2,
        message: expect.stringContaining('Refusing to run mutating command "run" using the default Navoke API')
      }
    });
  });

  for (const [command, args] of [
    ["plugin-install", ["plugin-install", "C:\\plugin"]],
    ["library-run", ["library", "run", "entry-1"]],
    ["pause", ["pause", "run-1"]],
    ["resume", ["resume", "run-1"]],
    ["cancel", ["cancel", "run-1"]],
    ["delete", ["delete", "run-1"]]
  ] as const) {
    it(`refuses ${command} through the default runtime fallback`, async () => {
      const stderr: string[] = [];
      const requests: unknown[] = [];
      const code = await runCli([...args], {
        cwd: "C:\\repo",
        env: {},
        stderr: (line) => stderr.push(line),
        discoverRuntime: async () => ({ apiUrl: DEFAULT_API_URL, source: "default" }),
        request: async <T>() => {
          requests.push({});
          return {} as T;
        }
      });

      expect(code).toBe(2);
      expect(requests).toEqual([]);
      expect(JSON.parse(stderr[0])).toMatchObject({
        ok: false,
        error: {
          exitCode: 2,
          message: expect.stringContaining(`mutating command "${command}"`)
        }
      });
    });
  }

  it("refuses to start a run when a stale runtime file fell back to the default port", async () => {
    const stderr: string[] = [];
    const code = await runCli(["run", "test.workflow", "--input", "input.json"], {
      cwd: "C:\\repo",
      env: {},
      stderr: (line) => stderr.push(line),
      discoverRuntime: async () => ({
        apiUrl: DEFAULT_API_URL,
        source: "default",
        staleRuntimeFile: "C:\\repo\\.navoke\\runtime.json"
      })
    });

    expect(code).toBe(2);
    expect(JSON.parse(stderr[0])).toMatchObject({
      ok: false,
      error: {
        exitCode: 2,
        message: expect.stringContaining("runtime.json")
      }
    });
  });

  it("starts a run through an explicit project runtime file", async () => {
    const stdout: string[] = [];
    const requests: Array<{ path: string; body: unknown }> = [];
    const code = await runCli(["--project", "C:\\project", "run", "test.workflow", "--input", "input.json"], {
      cwd: "C:\\repo",
      env: {},
      stdout: (line) => stdout.push(line),
      readFile: () => JSON.stringify({ prompt: "Go" }),
      discoverRuntime: async (input) => {
        expect(input.projectPath).toBe("C:\\project");
        return { apiUrl: "http://127.0.0.1:4333", source: "runtime-file", runtimeFile: "C:\\project\\.navoke\\runtime.json" };
      },
      request: async <T>(_apiUrl: string, _method: string, apiPath: string, body: unknown) => {
        requests.push({ path: apiPath, body });
        return { id: "run-1", status: "queued" } as T;
      }
    });

    expect(code).toBe(0);
    expect(requests[0]).toMatchObject({ path: "/api/runs" });
    expect(JSON.parse(stdout[0])).toMatchObject({
      ok: true,
      runtimeSource: "runtime-file",
      runtimeFile: "C:\\project\\.navoke\\runtime.json"
    });
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

  it("prints newline-delimited JSON when waiting for a library run", async () => {
    const stdout: string[] = [];
    const code = await runCli(["library", "run", "entry-1", "--wait"], {
      cwd: "C:\\repo",
      env: {},
      stdout: (line) => stdout.push(line),
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

  it("emits a distinct manual action event while watching a run", async () => {
    const stdout: string[] = [];
    const originalFetch = globalThis.fetch;
    let detailRequestCount = 0;
    const encoder = new TextEncoder();
    globalThis.fetch = vi.fn(async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ kind: "run-updated", runId: "run-1" })}\n\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ kind: "run-updated", runId: "run-1" })}\n\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ kind: "run-updated", runId: "run-1" })}\n\n`));
          controller.close();
        }
      });
      return new Response(stream, { status: 200 });
    }) as typeof fetch;

    try {
      const finalRun = await watchRun("http://api", "run-1", {
        stdout: (line) => stdout.push(line),
        request: async <T>() => {
          detailRequestCount += 1;
          const run =
            detailRequestCount === 1
              ? { id: "run-1", status: "running", currentStep: "Starting" }
              : detailRequestCount <= 3
                ? { id: "run-1", status: "waiting_manual", currentStep: "Complete verification" }
                : { id: "run-1", status: "completed", currentStep: "Completed" };
          return { run, events: [], artifacts: [] } as T;
        }
      });

      expect(finalRun).toMatchObject({ status: "completed" });
      expect(stdout.map((line) => JSON.parse(line)).filter((item) => item.type === "manual_action.required")).toEqual([
        expect.objectContaining({
          runId: "run-1",
          status: "waiting_manual",
          currentStep: "Complete verification"
        })
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
