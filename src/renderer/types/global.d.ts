export {};

declare global {
  interface WorkflowAutomationConfig {
    apiBaseUrl: string;
    dataDir: string;
    projectDir: string | null;
    recentProjects: Array<{ name: string; path: string; exists: boolean }>;
    projectDialogCancelled?: boolean;
    platform: string;
  }

  interface Window {
    workflowAutomation: {
      getConfig(): Promise<WorkflowAutomationConfig>;
      openProject(path?: string): Promise<WorkflowAutomationConfig>;
      selectFiles(options?: {
        title?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
      }): Promise<string[]>;
      openPath(path: string): Promise<string>;
      openExternal(url: string): Promise<void>;
    };
  }

  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        alt?: string;
        "camera-controls"?: boolean | string;
        "auto-rotate"?: boolean | string;
        exposure?: string;
      };
    }
  }
}
