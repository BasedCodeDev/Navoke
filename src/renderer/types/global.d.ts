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
    browserExtensionDir: string | null;
  }

  interface NavokeWindowState {
    isMaximized: boolean;
  }

  type NavokeAgentSetupTarget = "codex" | "claude";
  type NavokeAgentSetupComponentStatus = "missing" | "current" | "outdated" | "error";

  interface NavokeAgentSkillSetupStatus {
    target: NavokeAgentSetupTarget;
    label: string;
    path: string;
    status: NavokeAgentSetupComponentStatus;
    installedVersion?: string;
    error?: string;
  }

  interface NavokeAgentCliSetupStatus {
    path: string;
    status: NavokeAgentSetupComponentStatus;
    pathConfigured: boolean;
    verified: boolean;
    error?: string;
  }

  interface NavokeAgentSetupStatus {
    supported: boolean;
    appVersion: string;
    firstRunSeen: boolean;
    targets: NavokeAgentSetupTarget[];
    agents: NavokeAgentSkillSetupStatus[];
    cli: NavokeAgentCliSetupStatus;
    needsAttention: boolean;
  }

  interface NavokeAgentSetupInstallResult {
    status: NavokeAgentSetupStatus;
    errors: string[];
  }

  interface Window {
    navoke: {
      getConfig(): Promise<NavokeConfig>;
      getAgentSetupStatus(): Promise<NavokeAgentSetupStatus>;
      installAgentSetup(targets: NavokeAgentSetupTarget[]): Promise<NavokeAgentSetupInstallResult>;
      saveAgentSetupPreferences(targets: NavokeAgentSetupTarget[]): Promise<NavokeAgentSetupStatus>;
      dismissFirstRunAgentSetup(): Promise<NavokeAgentSetupStatus>;
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
