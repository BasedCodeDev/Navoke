import { describe, expect, it } from "vitest";
import type { WorkflowSummary } from "../../src/renderer/lib/api";
import { buildWorkflowInputFromValues, createInitialWorkflowValues } from "../../src/renderer/lib/workflowForm";

describe("workflow form helpers", () => {
  it("normalizes single file fields and numeric values from manifest-driven forms", () => {
    const workflow = {
      manifest: {
        inputFields: [
          {
            name: "modelFile",
            label: "Model file",
            type: "fileList",
            fileValue: "single",
            maxFiles: 1,
            fileFilters: [{ name: "Models", extensions: ["obj", "fbx", "zip"] }]
          },
          { name: "width", label: "Image width", type: "number", defaultValue: 1024 },
          { name: "backgroundColor", label: "Background", type: "text", defaultValue: "" }
        ]
      }
    } as WorkflowSummary;

    expect(createInitialWorkflowValues(workflow)).toEqual({
      modelFile: [],
      width: 1024,
      backgroundColor: ""
    });

    expect(
      buildWorkflowInputFromValues(workflow, {
        modelFile: ["C:\\tmp\\model.zip"],
        width: "512",
        backgroundColor: ""
      })
    ).toEqual({
      modelFile: "C:\\tmp\\model.zip",
      width: 512,
      backgroundColor: ""
    });
  });
});
