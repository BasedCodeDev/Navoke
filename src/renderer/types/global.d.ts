export {};

declare global {
  interface NavokeConfig {
    apiBaseUrl: string;
    dataDir: string;
    projectDir: string | null;
    projectName: string | null;
    recentProjects: Array<{ name: string; path: string; exists: boolean }>;
    projectDialogCancelled?: boolean;
    platform: string;
    pluginRootDir: string | null;
  }

  interface NavokeWindowState {
    isMaximized: boolean;
  }

  interface Window {
    navoke: {
      getConfig(): Promise<NavokeConfig>;
      openProject(path?: string): Promise<NavokeConfig>;
      renameProject(projectPath: string, name: string): Promise<NavokeConfig>;
      selectFiles(options?: {
        title?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
      }): Promise<string[]>;
      openPath(path: string): Promise<string>;
      openExternal(url: string): Promise<void>;
      windowControls?: {
        minimize(): Promise<void>;
        toggleMaximize(): Promise<NavokeWindowState>;
        getState(): Promise<NavokeWindowState>;
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
