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
  private extensionRoots: string[] = [];
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
      if (this.userDataPath) {
        this.syncExtensionRoots([this.userDataPath + '/extensions']);
      }
    }
  }

  private normalizeRoot(root: string): string {
    const normalized = root.replace(/\\/g, '/').replace(/\/+$/, '');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }

  /**
   * Register an additional directory to scan for extensions (e.g. project-local extensions).
   * Triggers a reload if the root hasn't been added before.
   */
  public addExtensionRoot(dir: string): void {
    if (!dir || this.extensionRoots.includes(dir)) return;
    this.extensionRoots.push(dir);
    this.loadExtensions();
  }

  public syncExtensionRoots(dirs: string[]): void {
    const uniqueDirs: string[] = [];
    const seen = new Set<string>();

    for (const dir of dirs) {
      if (!dir) continue;
      const key = this.normalizeRoot(dir);
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueDirs.push(dir);
    }

    const currentKeys = this.extensionRoots.map(root => this.normalizeRoot(root));
    const nextKeys = uniqueDirs.map(root => this.normalizeRoot(root));
    const changed =
      currentKeys.length !== nextKeys.length ||
      currentKeys.some((key, index) => key !== nextKeys[index]);

    if (!changed) {
      return;
    }

    this.extensionRoots = uniqueDirs;
    this.loadExtensions();
  }

  public async loadExtensions() {
    if (!window.electron) return;

    const newContributions = new Map<string, ExtensionContribution>();

    for (const rootDir of this.extensionRoots) {
      try {
        const exists = await window.electron.ipcRenderer.invoke('fs:checkPathExistsAndIsDirectory', rootDir);
        if (!exists) continue;

        const entries = await window.electron.ipcRenderer.invoke('fs:readDir', rootDir);
        if (!Array.isArray(entries)) continue;

        for (const entry of entries) {
          if (!entry.isDirectory) continue;
          const extPath = rootDir + '/' + entry.name;
          const packageJsonPath = extPath + '/package.json';

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
      } catch (e) {
        console.error('Error loading extensions from root', rootDir, e);
      }
    }

    this.contributions = newContributions;
    this.notifyListeners();
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

    const fullPath = contrib.extensionPath + '/' + relativePath.replace(/^\//, '');
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

  public getSidebarItems(): { id: string, title: string, icon?: string, extensionId: string, location: string }[] {
    const items: { id: string, title: string, icon?: string, extensionId: string, location: string }[] = [];
    this.contributions.forEach(contrib => {
      for (const location of ['activitybar', 'panel'] as const) {
        const containers = contrib.viewsContainers?.[location];
        if (Array.isArray(containers)) {
          containers.forEach((container: any) => {
            items.push({
              id: container.id,
              title: container.title,
              icon: container.icon,
              extensionId: contrib.id,
              location
            });
          });
        }
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
