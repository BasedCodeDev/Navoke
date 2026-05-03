module.exports = {
  createWorkflows(sdk) {
    const z = sdk.schema.z;
    const inputSchema = z.object({
      delayMs: z.number().int().min(100).max(15000).default(8000)
    });
    const outputSchema = z.object({
      artifactIds: z.array(z.string()),
      summary: z.string()
    });

    return [
      {
        manifest: {
          id: "based-blink.test.cli-visible",
          title: "CLI Visible Test Workflow",
          description: "Deterministic workflow used by the CLI-origin e2e test.",
          category: "utility",
          version: "0.1.0",
          concurrency: 1,
          inputFields: [
            {
              name: "delayMs",
              label: "Delay",
              type: "number",
              required: false,
              defaultValue: 8000
            }
          ],
          outputKinds: ["json"],
          requiresBrowser: false
        },
        inputSchema,
        outputSchema,
        async run(input, ctx) {
          await ctx.step("CLI integration started", 25, { delayMs: input.delayMs });
          await ctx.event("cli-visible.started", "CLI visible fixture is running.", { delayMs: input.delayMs });
          await sdk.sleep(input.delayMs, ctx.signal);
          await ctx.step("CLI integration completed", 100);
          return { artifactIds: [], summary: "CLI integration complete." };
        }
      }
    ];
  }
};
