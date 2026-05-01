import type { WorkflowDefinition } from "../runtime/types";
import { chatGptExtensionImageTransformWorkflow } from "./chatGptExtensionWorkflow";
import { hunyuanImageToModelWorkflow } from "./hunyuanWorkflow";

export function createWorkflowRegistry(): Map<string, WorkflowDefinition> {
  const workflows = [
    chatGptExtensionImageTransformWorkflow,
    hunyuanImageToModelWorkflow
  ];
  return new Map(workflows.map((workflow) => [workflow.manifest.id, workflow]));
}
