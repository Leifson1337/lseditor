import { ExtensionService as BaseExtensionService } from './ExtensionService';

export interface ExtensionContribution {
  id: string; // extension id (folder name usually)
  extensionPath: string; // Absolute path to extension folder
  manifest: any;
  viewsContainers?: {
    activitybar?: any[];
    [key: string]: any;
  };
  views?: {
    [key: string]: any[];
  };
  commands?: any[];
}

export class ExtensionService {
  private static instance: ExtensionService;
  private userDataPath: string | null = null;
  private extensionsPath: string | null = null;
  private contributions: Map<string, ExtensionContribution> = new Map();
  private listeners: ((contributions: ExtensionContribution[]) => void)[] = [];
  // Cache for icon base64 data to avoid repeated reads
  private iconCache: Map<string, string> = new Map();

  private constructor() {
    this.init();
  }

  public static getInstance(): ExtensionService {
    if (!ExtensionService.instance) {
      ExtensionService.instance = new ExtensionService();
    }
    return ExtensionService.instance;
  }

  private async init() {
    if (typeof window !== 'undefined' && window.electron) {
      this.userDataPath = await window.electron.ipcRenderer.invoke('app:getUserDataPath');
      // Also try to get project path if possible, but this is a global service.
      if (this.userDataPath) {
        this.extensionsPath = `${this.userDataPath}\\extensions`;
        this.loadExtensions();
      }
    }
  }

  public async loadExtensions() {
    if (!this.extensionsPath || !window.electron) return;

    try {
      const exists = await window.electron.ipcRenderer.invoke('fs:checkPathExistsAndIsDirectory', this.extensionsPath);
      if (!exists) return;

      const entries = await window.electron.ipcRenderer.invoke('fs:readDir', this.extensionsPath);
      if (!Array.isArray(entries)) return;

      const newContributions = new Map<string, ExtensionContribution>();

      for (const entry of entries) {
        if (!entry.isDirectory) continue;
        const extPath = `${this.extensionsPath}\\${entry.name}`;
        const packageJsonPath = `${extPath}\\package.json`;

        try {
          if (await window.electron.ipcRenderer.invoke('fs:exists', packageJsonPath)) {
            const content = await window.electron.ipcRenderer.invoke('fs:readFile', packageJsonPath);
            const packageJson = JSON.parse(content);

            newContributions.set(entry.name, {
              id: entry.name,
              extensionPath: extPath,
              manifest: packageJson,
              viewsContainers: packageJson.contributes?.viewsContainers,
              views: packageJson.contributes?.views,
              commands: packageJson.contributes?.commands,
            });
          }
        } catch (e) {
          console.warn('Failed to parse extension manifest', entry.name, e);
        }
      }

      this.contributions = newContributions;
      this.notifyListeners();

    } catch (e) {
      console.error('Error loading extensions in service:', e);
    }
  }

  public getAllContributions(): ExtensionContribution[] {
    return Array.from(this.contributions.values());
  }

  /**
   * Resolves the icon path for a given extension sidebar item.
   * If the icon is a relative path, it tries to read it as base64.
   */
  public async resolveIcon(extensionId: string, relativePath: string): Promise<string | undefined> {
    const contrib = this.contributions.get(extensionId);
    if (!contrib || !relativePath) return undefined;

    const fullPath = `${contrib.extensionPath}\\${relativePath}`; // Simple windows join
    // Check cache
    if (this.iconCache.has(fullPath)) {
      return this.iconCache.get(fullPath);
    }

    try {
      if (!window.electron) return undefined;
      // Use the new base64 reader
      const b64 = await window.electron.ipcRenderer.invoke('fs:readFileBase64', fullPath);
      if (b64) {
        // Determine mime type roughly
        const ext = relativePath.split('.').pop()?.toLowerCase();
        let mime = 'image/png';
        if (ext === 'svg') mime = 'image/svg+xml';
        if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';

        const dataUrl = `data:${mime};base64,${b64}`;
        this.iconCache.set(fullPath, dataUrl);
        return dataUrl;
      }
    } catch (e) {
      console.error('Failed to resolve icon', fullPath, e);
    }
    return undefined;
  }

  public getSidebarItems(): { id: string, title: string, icon?: string, extensionId: string }[] {
    const items: { id: string, title: string, icon?: string, extensionId: string }[] = [];
    this.contributions.forEach(contrib => {
      if (contrib.viewsContainers?.activitybar) {
        contrib.viewsContainers.activitybar.forEach((container: any) => {
          items.push({
            id: container.id,
            title: container.title,
            icon: container.icon,
            extensionId: contrib.id
          });
        });
      }
    });
    return items;
  }

  public getViewsForContainer(containerId: string): { id: string, name: string }[] {
    const views: { id: string, name: string }[] = [];
    this.contributions.forEach(contrib => {
      if (contrib.views && contrib.views[containerId]) {
        contrib.views[containerId].forEach((view: any) => {
          views.push({
            id: view.id,
            name: view.name
          });
        });
      }
    });
    return views;
  }

  public subscribe(listener: (contributions: ExtensionContribution[]) => void) {
    this.listeners.push(listener);
    listener(this.getAllContributions());
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach(l => l(this.getAllContributions()));
  }
}