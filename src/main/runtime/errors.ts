export class ManualActionRequiredError extends Error {
  constructor(
    message: string,
    readonly data?: unknown
  ) {
    super(message);
    this.name = "ManualActionRequiredError";
  }
}

export class WorkflowConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowConfigurationError";
  }
}
