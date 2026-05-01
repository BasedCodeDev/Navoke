export {};

declare global {
  interface Window {
    workflowAutomation: {
      getConfig(): Promise<{ apiBaseUrl: string; dataDir: string; platform: string }>;
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
