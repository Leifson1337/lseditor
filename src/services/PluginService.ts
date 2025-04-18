import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  repository?: string;
  dependencies?: Record<string, string>;
  main: string;
  enabled: boolean;
  settings?: Record<string, any>;
}

interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  repository?: string;
  dependencies?: Record<string, string>;
  main: string;
}

interface PluginAPI {
  registerCommand: (command: string, callback: (...args: any[]) => void) => void;
  registerView: (viewId: string, component: React.ComponentType) => void;
  registerProvider: (providerId: string, provider: any) => void;
  showNotification: (message: string, type?: 'info' | 'warning' | 'error') => void;
  getSettings: () => Record<string, any>;
  updateSettings: (settings: Record<string, any>) => void;
}

export class PluginService extends EventEmitter {
  private plugins: Map<string, Plugin> = new Map();
  private pluginAPIs: Map<string, PluginAPI> = new Map();
  private pluginDirectory: string;
  private marketplaceUrl: string;

  constructor(pluginDirectory: string, marketplaceUrl: string) {
    super();
    this.pluginDirectory = pluginDirectory;
    this.marketplaceUrl = marketplaceUrl;
    this.initializePluginDirectory();
  }

  private initializePluginDirectory(): void {
    if (!fs.existsSync(this.pluginDirectory)) {
      fs.mkdirSync(this.pluginDirectory, { recursive: true });
    }
  }

  public async loadPlugins(): Promise<void> {
    const pluginDirs = fs.readdirSync(this.pluginDirectory);
    
    for (const dir of pluginDirs) {
      const pluginPath = path.join(this.pluginDirectory, dir);
      const manifestPath = path.join(pluginPath, 'package.json');
      
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest: PluginManifest = JSON.parse(
            fs.readFileSync(manifestPath, 'utf-8')
          );
          
          const plugin: Plugin = {
            id: dir,
            ...manifest,
            enabled: true,
            settings: {}
          };
          
          this.plugins.set(plugin.id, plugin);
          await this.initializePlugin(plugin);
        } catch (error) {
          console.error(`Failed to load plugin ${dir}:`, error);
        }
      }
    }
    
    this.emit('pluginsLoaded', Array.from(this.plugins.values()));
  }

  private async initializePlugin(plugin: Plugin): Promise<void> {
    try {
      const pluginModule = require(path.join(this.pluginDirectory, plugin.id, plugin.main));
      const api: PluginAPI = {
        registerCommand: (command, callback) => this.registerCommand(plugin.id, command, callback),
        registerView: (viewId, component) => this.registerView(plugin.id, viewId, component),
        registerProvider: (providerId, provider) => this.registerProvider(plugin.id, providerId, provider),
        showNotification: (message, type) => this.showNotification(message, type),
        getSettings: () => this.getPluginSettings(plugin.id),
        updateSettings: (settings) => this.updatePluginSettings(plugin.id, settings)
      };
      
      this.pluginAPIs.set(plugin.id, api);
      await pluginModule.activate(api);
      this.emit('pluginActivated', plugin.id);
    } catch (error) {
      console.error(`Failed to initialize plugin ${plugin.id}:`, error);
    }
  }

  public async installPlugin(pluginId: string): Promise<void> {
    try {
      const response = await this.fetchPlugin(pluginId);
      const pluginPath = path.join(this.pluginDirectory, pluginId);
      
      if (!fs.existsSync(pluginPath)) {
        fs.mkdirSync(pluginPath, { recursive: true });
      }
      
      fs.writeFileSync(
        path.join(pluginPath, 'package.json'),
        JSON.stringify(response.manifest, null, 2)
      );
      
      const plugin: Plugin = {
        id: pluginId,
        ...response.manifest,
        enabled: true,
        settings: {}
      };
      
      this.plugins.set(pluginId, plugin);
      await this.initializePlugin(plugin);
      this.emit('pluginInstalled', pluginId);
    } catch (error) {
      console.error(`Failed to install plugin ${pluginId}:`, error);
      throw error;
    }
  }

  public async uninstallPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    try {
      const pluginPath = path.join(this.pluginDirectory, pluginId);
      await this.deactivatePlugin(pluginId);
      fs.rmSync(pluginPath, { recursive: true, force: true });
      this.plugins.delete(pluginId);
      this.pluginAPIs.delete(pluginId);
      this.emit('pluginUninstalled', pluginId);
    } catch (error) {
      console.error(`Failed to uninstall plugin ${pluginId}:`, error);
      throw error;
    }
  }

  public async updatePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    try {
      const response = await this.fetchPlugin(pluginId);
      if (response.manifest.version === plugin.version) {
        return;
      }

      await this.uninstallPlugin(pluginId);
      await this.installPlugin(pluginId);
      this.emit('pluginUpdated', pluginId);
    } catch (error) {
      console.error(`Failed to update plugin ${pluginId}:`, error);
      throw error;
    }
  }

  public async updateAllPlugins(): Promise<void> {
    const plugins = Array.from(this.plugins.values());
    for (const plugin of plugins) {
      await this.updatePlugin(plugin.id);
    }
  }

  public async enablePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    plugin.enabled = true;
    await this.initializePlugin(plugin);
    this.emit('pluginEnabled', pluginId);
  }

  public async disablePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    plugin.enabled = false;
    await this.deactivatePlugin(pluginId);
    this.emit('pluginDisabled', pluginId);
  }

  private async deactivatePlugin(pluginId: string): Promise<void> {
    try {
      const pluginModule = require(path.join(this.pluginDirectory, pluginId, this.plugins.get(pluginId)!.main));
      if (typeof pluginModule.deactivate === 'function') {
        await pluginModule.deactivate();
      }
    } catch (error) {
      console.error(`Failed to deactivate plugin ${pluginId}:`, error);
    }
  }

  private async fetchPlugin(pluginId: string): Promise<{ manifest: PluginManifest }> {
    return new Promise((resolve, reject) => {
      https.get(`${this.marketplaceUrl}/plugins/${pluginId}`, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      }).on('error', reject);
    });
  }

  private registerCommand(pluginId: string, command: string, callback: (...args: any[]) => void): void {
    this.emit('commandRegistered', { pluginId, command, callback });
  }

  private registerView(pluginId: string, viewId: string, component: React.ComponentType): void {
    this.emit('viewRegistered', { pluginId, viewId, component });
  }

  private registerProvider(pluginId: string, providerId: string, provider: any): void {
    this.emit('providerRegistered', { pluginId, providerId, provider });
  }

  private showNotification(message: string, type?: 'info' | 'warning' | 'error'): void {
    this.emit('notification', { message, type });
  }

  private getPluginSettings(pluginId: string): Record<string, any> {
    return this.plugins.get(pluginId)?.settings || {};
  }

  private updatePluginSettings(pluginId: string, settings: Record<string, any>): void {
    const plugin = this.plugins.get(pluginId);
    if (plugin) {
      plugin.settings = { ...plugin.settings, ...settings };
      this.emit('settingsUpdated', { pluginId, settings });
    }
  }

  public getPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  public getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId);
  }

  public dispose(): void {
    this.plugins.forEach((plugin) => {
      this.deactivatePlugin(plugin.id);
    });
    this.plugins.clear();
    this.pluginAPIs.clear();
    this.removeAllListeners();
  }
} 