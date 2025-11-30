import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

/**
 * Represents a user-installed plugin.
 */
interface Plugin {
  /**
   * Unique plugin ID.
   */
  id: string;
  /**
   * Plugin name.
   */
  name: string;
  /**
   * Plugin version.
   */
  version: string;
  /**
   * Plugin description.
   */
  description: string;
  /**
   * Plugin author.
   */
  author: string;
  /**
   * Plugin repository URL (optional).
   */
  repository?: string;
  /**
   * Plugin dependencies (optional).
   */
  dependencies?: Record<string, string>;
  /**
   * Main entry point of the plugin.
   */
  main: string;
  /**
   * Whether the plugin is enabled.
   */
  enabled: boolean;
  /**
   * Plugin settings (optional).
   */
  settings?: Record<string, any>;
}

/**
 * Represents a plugin manifest.
 */
interface PluginManifest {
  /**
   * Plugin name.
   */
  name: string;
  /**
   * Plugin version.
   */
  version: string;
  /**
   * Plugin description.
   */
  description: string;
  /**
   * Plugin author.
   */
  author: string;
  /**
   * Plugin repository URL (optional).
   */
  repository?: string;
  /**
   * Plugin dependencies (optional).
   */
  dependencies?: Record<string, string>;
  /**
   * Main entry point of the plugin.
   */
  main: string;
}

/**
 * Represents the API available to plugins.
 */
interface PluginAPI {
  /**
   * Registers a command.
   * @param command Command name
   * @param callback Command callback function
   */
  registerCommand: (command: string, callback: (...args: any[]) => void) => void;
  /**
   * Registers a view.
   * @param viewId View ID
   * @param component View component
   */
  registerView: (viewId: string, component: React.ComponentType) => void;
  /**
   * Registers a provider.
   * @param providerId Provider ID
   * @param provider Provider instance
   */
  registerProvider: (providerId: string, provider: any) => void;
  /**
   * Shows a notification.
   * @param message Notification message
   * @param type Notification type (optional)
   */
  showNotification: (message: string, type?: 'info' | 'warning' | 'error') => void;
  /**
   * Gets plugin settings.
   * @returns Plugin settings
   */
  getSettings: () => Record<string, any>;
  /**
   * Updates plugin settings.
   * @param settings New plugin settings
   */
  updateSettings: (settings: Record<string, any>) => void;
}

/**
 * Manages loading, enabling, disabling, and removing plugins.
 */
export class PluginService extends EventEmitter {
  /**
   * All loaded plugins.
   */
  private plugins: Map<string, Plugin> = new Map();
  /**
   * Plugin APIs.
   */
  private pluginAPIs: Map<string, PluginAPI> = new Map();
  /**
   * Plugin directory.
   */
  private pluginDirectory: string;
  /**
   * Marketplace URL.
   */
  private marketplaceUrl: string;

  /**
   * Initializes the plugin service.
   * @param pluginDirectory Plugin directory
   * @param marketplaceUrl Marketplace URL
   */
  constructor(pluginDirectory: string, marketplaceUrl: string) {
    super();
    this.pluginDirectory = pluginDirectory;
    this.marketplaceUrl = marketplaceUrl;
    this.initializePluginDirectory();
  }

  /**
   * Initializes the plugin directory.
   */
  private initializePluginDirectory(): void {
    if (!fs.existsSync(this.pluginDirectory)) {
      fs.mkdirSync(this.pluginDirectory, { recursive: true });
    }
  }

  /**
   * Loads all plugins from the plugin directory.
   */
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

  /**
   * Initializes a plugin.
   * @param plugin Plugin to initialize
   */
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

  /**
   * Installs a plugin from the marketplace.
   * @param pluginId Plugin ID
   */
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

  /**
   * Uninstalls a plugin.
   * @param pluginId Plugin ID
   */
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

  /**
   * Updates a plugin.
   * @param pluginId Plugin ID
   */
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

  /**
   * Updates all plugins.
   */
  public async updateAllPlugins(): Promise<void> {
    const plugins = Array.from(this.plugins.values());
    for (const plugin of plugins) {
      await this.updatePlugin(plugin.id);
    }
  }

  /**
   * Enables a plugin.
   * @param pluginId Plugin ID
   */
  public async enablePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    plugin.enabled = true;
    await this.initializePlugin(plugin);
    this.emit('pluginEnabled', pluginId);
  }

  /**
   * Disables a plugin.
   * @param pluginId Plugin ID
   */
  public async disablePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    plugin.enabled = false;
    await this.deactivatePlugin(pluginId);
    this.emit('pluginDisabled', pluginId);
  }

  /**
   * Deactivates a plugin.
   * @param pluginId Plugin ID
   */
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

  /**
   * Fetches a plugin from the marketplace.
   * @param pluginId Plugin ID
   * @returns Plugin manifest
   */
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

  /**
   * Registers a command.
   * @param pluginId Plugin ID
   * @param command Command name
   * @param callback Command callback function
   */
  private registerCommand(pluginId: string, command: string, callback: (...args: any[]) => void): void {
    this.emit('commandRegistered', { pluginId, command, callback });
  }

  /**
   * Registers a view.
   * @param pluginId Plugin ID
   * @param viewId View ID
   * @param component View component
   */
  private registerView(pluginId: string, viewId: string, component: React.ComponentType): void {
    this.emit('viewRegistered', { pluginId, viewId, component });
  }

  /**
   * Registers a provider.
   * @param pluginId Plugin ID
   * @param providerId Provider ID
   * @param provider Provider instance
   */
  private registerProvider(pluginId: string, providerId: string, provider: any): void {
    this.emit('providerRegistered', { pluginId, providerId, provider });
  }

  /**
   * Shows a notification.
   * @param message Notification message
   * @param type Notification type (optional)
   */
  private showNotification(message: string, type?: 'info' | 'warning' | 'error'): void {
    this.emit('notification', { message, type });
  }

  /**
   * Gets plugin settings.
   * @param pluginId Plugin ID
   * @returns Plugin settings
   */
  private getPluginSettings(pluginId: string): Record<string, any> {
    return this.plugins.get(pluginId)?.settings || {};
  }

  /**
   * Updates plugin settings.
   * @param pluginId Plugin ID
   * @param settings New plugin settings
   */
  private updatePluginSettings(pluginId: string, settings: Record<string, any>): void {
    const plugin = this.plugins.get(pluginId);
    if (plugin) {
      plugin.settings = { ...plugin.settings, ...settings };
      this.emit('settingsUpdated', { pluginId, settings });
    }
  }

  /**
   * Gets all loaded plugins.
   * @returns Array of plugins
   */
  public getPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Gets a plugin by its ID.
   * @param pluginId Plugin ID
   * @returns Plugin instance
   */
  public getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Disposes of the plugin service.
   */
  public dispose(): void {
    this.plugins.forEach((plugin) => {
      this.deactivatePlugin(plugin.id);
    });
    this.plugins.clear();
    this.pluginAPIs.clear();
    this.removeAllListeners();
  }
}