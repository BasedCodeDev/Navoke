import type { WorkflowDefinition, WorkflowPluginMetadata, WorkflowRegistry, WorkflowRegistration } from "../runtime/types";
import type { PluginManager } from "../plugins/pluginManager";
import { WORKFLOW_PLUGIN_API_VERSION } from "../plugins/types";

export const BUILTIN_WORKFLOW_PLUGIN: WorkflowPluginMetadata = {
  id: "based-blink.builtin",
  name: "Based BLINK Built-ins",
  version: "0.1.0",
  source: "builtin",
  apiVersion: WORKFLOW_PLUGIN_API_VERSION,
  capabilities: ["filesystem.artifacts", "browser", "extension.chatgpt"]
};

export function createBuiltInWorkflowRegistry(): WorkflowRegistry {
  const workflows: WorkflowDefinition[] = [];
  return new Map(workflows.map((workflow) => [workflow.manifest.id, registerBuiltInWorkflow(workflow)]));
}

export function createWorkflowRegistry(pluginManager?: PluginManager): WorkflowRegistry {
  const registry = createBuiltInWorkflowRegistry();
  for (const registration of pluginManager?.listWorkflowRegistrations() ?? []) {
    if (registry.has(registration.definition.manifest.id)) {
      continue;
    }
    registry.set(registration.definition.manifest.id, registration);
  }
  return registry;
}

export function registerBuiltInWorkflow(definition: WorkflowDefinition): WorkflowRegistration {
  return {
    definition,
    plugin: BUILTIN_WORKFLOW_PLUGIN
  };
}
