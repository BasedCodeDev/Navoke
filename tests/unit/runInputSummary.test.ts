import { describe, expect, it } from "vitest";
import type { WorkflowSummary } from "../../src/renderer/lib/api";
import { runPromptInputSummary } from "../../src/renderer/lib/runInputSummary";

const referenceFilesKey = ["reference", "Images"].join("");
const itemFilesKey = ["subject", "Images"].join("");
const setupPromptKey = ["master", "Prompt"].join("");
const itemInstructionKey = ["subject", "Instruction"].join("");

describe("runInputSummary", () => {
  it("summarizes prompt-like text fields from the workflow manifest", () => {
    const items = runPromptInputSummary(
      {
        [referenceFilesKey]: ["C:\\tmp\\ref.png"],
        [itemFilesKey]: ["C:\\tmp\\subject.png"],
        [setupPromptKey]: "Use this style for the transformation.",
        [itemInstructionKey]: "Remove the face.",
        selectors: { composer: "#prompt" }
      },
      workflowWithFields([
        { name: referenceFilesKey, label: "Reference images", type: "fileList" },
        { name: itemFilesKey, label: "Subject images", type: "fileList" },
        { name: setupPromptKey, label: "Master prompt", type: "textarea" },
        { name: itemInstructionKey, label: "Per-subject instruction", type: "textarea" },
        { name: "selectors", label: "Selector config", type: "json" }
      ])
    );

    expect(items).toEqual([
      {
        name: setupPromptKey,
        label: "Master prompt",
        value: "Use this style for the transformation.",
        multiline: false
      },
      {
        name: itemInstructionKey,
        label: "Per-subject instruction",
        value: "Remove the face.",
        multiline: false
      }
    ]);
  });

  it("falls back to known prompt keys when the workflow manifest is unavailable", () => {
    expect(runPromptInputSummary({ [setupPromptKey]: "Setup text", [itemInstructionKey]: "Per-subject text" })).toEqual([
      { name: setupPromptKey, label: "Master Prompt", value: "Setup text", multiline: false },
      { name: itemInstructionKey, label: "Subject Instruction", value: "Per-subject text", multiline: false }
    ]);
  });

  it("formats prompt arrays and skips blank prompt values", () => {
    const items = runPromptInputSummary(
      {
        prompts: ["Back view", " ", "Side view"],
        [["master", "Prompt", "Suffix"].join("")]: ""
      },
      workflowWithFields([{ name: "prompts", label: "Prompts", type: "stringList" }])
    );

    expect(items).toEqual([
      {
        name: "prompts",
        label: "Prompts",
        value: "1. Back view\n\n2. Side view",
        multiline: true
      }
    ]);
  });
});

function workflowWithFields(inputFields: WorkflowSummary["manifest"]["inputFields"]): WorkflowSummary {
  return {
    manifest: {
      id: "test.workflow",
      title: "Test Workflow",
      description: "Test workflow.",
      category: "test",
      version: "0.1.0",
      concurrency: 1,
      requiresBrowser: false,
      outputKinds: [],
      inputFields
    },
    plugin: {
      id: "test.plugin",
      name: "Test Plugin",
      version: "0.1.0",
      source: "user",
      apiVersion: "1",
      capabilities: []
    },
    availability: { status: "available" }
  };
}
