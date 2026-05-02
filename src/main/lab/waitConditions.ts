export type LabElementState = "visible" | "hidden" | "enabled" | "disabled";

export type LabWaitCondition =
  | {
      kind: "element";
      selector: string;
      state: LabElementState;
      timeoutMs?: number;
    }
  | {
      kind: "text";
      text: string;
      state: "present" | "absent";
      timeoutMs?: number;
    }
  | {
      kind: "image-count";
      selector?: string;
      minCount: number;
      previousFingerprints?: string[];
      timeoutMs?: number;
    }
  | {
      kind: "stop-button";
      selector?: string;
      state: "visible" | "hidden";
      timeoutMs?: number;
    }
  | {
      kind: "chatgpt-submit-ready";
      selectors?: {
        composer?: string;
        submitButton?: string;
        stopButton?: string;
        fileInput?: string;
      };
      timeoutMs?: number;
    }
  | {
      kind: "network-idle";
      timeoutMs?: number;
    };

export interface LabWaitPageState {
  bodyText: string;
  element?: {
    selector: string;
    count: number;
    visible: boolean;
    disabled: boolean;
  };
  imageFingerprints: string[];
  stopButtonVisible: boolean;
  chatGptSubmit?: {
    composerFound: boolean;
    composerVisible: boolean;
    submitFound: boolean;
    submitVisible: boolean;
    submitEnabled: boolean;
    stopButtonVisible: boolean;
    stopButtonLabel?: string | null;
    fileInputFound: boolean;
    visibleButtons: string[];
    imageCount: number;
  };
  networkIdle?: boolean;
}

export interface LabWaitEvaluation {
  satisfied: boolean;
  reason: string;
  diagnostics: Record<string, unknown>;
}

export function evaluateWaitCondition(condition: LabWaitCondition, state: LabWaitPageState): LabWaitEvaluation {
  switch (condition.kind) {
    case "element":
      return evaluateElementCondition(condition, state);
    case "text":
      return evaluateTextCondition(condition, state);
    case "image-count":
      return evaluateImageCountCondition(condition, state);
    case "stop-button":
      return {
        satisfied: condition.state === "visible" ? state.stopButtonVisible : !state.stopButtonVisible,
        reason:
          condition.state === "visible"
            ? state.stopButtonVisible
              ? "Stop button is visible."
              : "Stop button is not visible yet."
            : state.stopButtonVisible
              ? "Stop button is still visible."
              : "Stop button is hidden.",
        diagnostics: { stopButtonVisible: state.stopButtonVisible }
      };
    case "chatgpt-submit-ready":
      return evaluateChatGptSubmitReadyCondition(state);
    case "network-idle":
      return {
        satisfied: state.networkIdle === true,
        reason: state.networkIdle === true ? "Network is idle." : "Network is not idle yet.",
        diagnostics: { networkIdle: state.networkIdle ?? null }
      };
  }
}

export function defaultWaitTimeoutMs(condition: LabWaitCondition): number {
  return condition.timeoutMs ?? (condition.kind === "network-idle" ? 15_000 : condition.kind === "chatgpt-submit-ready" ? 120_000 : 30_000);
}

export function waitConditionLabel(condition: LabWaitCondition): string {
  if (condition.kind === "element") return `Wait for ${condition.selector} ${condition.state}`;
  if (condition.kind === "text") return `Wait for text ${condition.state}: ${condition.text}`;
  if (condition.kind === "image-count") return `Wait for ${condition.minCount} image(s)`;
  if (condition.kind === "stop-button") return `Wait for stop button ${condition.state}`;
  if (condition.kind === "chatgpt-submit-ready") return "Wait for ChatGPT submit ready";
  return "Wait for network idle";
}

function evaluateChatGptSubmitReadyCondition(state: LabWaitPageState): LabWaitEvaluation {
  const submit = state.chatGptSubmit;
  if (!submit) {
    return {
      satisfied: false,
      reason: "ChatGPT submit state was not captured.",
      diagnostics: {}
    };
  }

  const satisfied = submit.composerFound && submit.composerVisible && submit.submitFound && submit.submitVisible && submit.submitEnabled && !submit.stopButtonVisible;
  const reason = satisfied
    ? "ChatGPT submit button is ready."
    : submit.stopButtonVisible
      ? "ChatGPT generation is still active; stop button is visible."
      : !submit.composerFound
        ? "ChatGPT composer was not found."
        : !submit.submitFound
          ? "ChatGPT submit button was not found."
          : !submit.submitVisible
            ? "ChatGPT submit button is not visible."
            : !submit.submitEnabled
              ? "ChatGPT submit button is still disabled, likely while uploads or processing finish."
              : "ChatGPT submit button is not ready.";

  return {
    satisfied,
    reason,
    diagnostics: submit
  };
}

function evaluateElementCondition(
  condition: Extract<LabWaitCondition, { kind: "element" }>,
  state: LabWaitPageState
): LabWaitEvaluation {
  const element = state.element;
  const count = element?.count ?? 0;
  const visible = element?.visible ?? false;
  const disabled = element?.disabled ?? false;
  const satisfied =
    condition.state === "hidden"
      ? count === 0 || !visible
      : condition.state === "visible"
        ? count > 0 && visible
        : condition.state === "enabled"
          ? count > 0 && visible && !disabled
          : count > 0 && disabled;

  return {
    satisfied,
    reason: satisfied
      ? `Element ${condition.selector} is ${condition.state}.`
      : `Element ${condition.selector} is not ${condition.state}.`,
    diagnostics: {
      selector: condition.selector,
      count,
      visible,
      disabled
    }
  };
}

function evaluateTextCondition(
  condition: Extract<LabWaitCondition, { kind: "text" }>,
  state: LabWaitPageState
): LabWaitEvaluation {
  const haystack = state.bodyText.toLowerCase();
  const needle = condition.text.toLowerCase();
  const present = needle.length > 0 && haystack.includes(needle);
  const satisfied = condition.state === "present" ? present : !present;
  return {
    satisfied,
    reason: satisfied ? `Text is ${condition.state}.` : `Text is not ${condition.state} yet.`,
    diagnostics: {
      text: condition.text,
      state: condition.state,
      bodyTextLength: state.bodyText.length
    }
  };
}

function evaluateImageCountCondition(
  condition: Extract<LabWaitCondition, { kind: "image-count" }>,
  state: LabWaitPageState
): LabWaitEvaluation {
  const previous = new Set(condition.previousFingerprints ?? []);
  const newFingerprints = state.imageFingerprints.filter((fingerprint) => !previous.has(fingerprint));
  const satisfied = newFingerprints.length >= condition.minCount;
  return {
    satisfied,
    reason: satisfied
      ? `Found ${newFingerprints.length} new image fingerprint(s).`
      : `Found ${newFingerprints.length} new image fingerprint(s); waiting for ${condition.minCount}.`,
    diagnostics: {
      selector: condition.selector ?? null,
      currentCount: state.imageFingerprints.length,
      newCount: newFingerprints.length,
      minCount: condition.minCount
    }
  };
}
