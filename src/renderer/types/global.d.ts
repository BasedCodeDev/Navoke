export {};

declare global {
  interface BasedBlinkConfig {
    apiBaseUrl: string;
    dataDir: string;
    projectDir: string | null;
    projectName: string | null;
    recentProjects: Array<{ name: string; path: string; exists: boolean }>;
    projectDialogCancelled?: boolean;
    platform: string;
    pluginRootDir: string | null;
  }

  interface BasedBlinkWindowState {
    isMaximized: boolean;
  }

  interface Window {
    basedBlink: {
      getConfig(): Promise<BasedBlinkConfig>;
      openProject(path?: string): Promise<BasedBlinkConfig>;
      renameProject(projectPath: string, name: string): Promise<BasedBlinkConfig>;
      selectFiles(options?: {
        title?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
      }): Promise<string[]>;
      openPath(path: string): Promise<string>;
      openExternal(url: string): Promise<void>;
      windowControls?: {
        minimize(): Promise<void>;
        toggleMaximize(): Promise<BasedBlinkWindowState>;
        getState(): Promise<BasedBlinkWindowState>;
        close(): Promise<void>;
      };
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
