import { EventEmitter } from '../utils/EventEmitter';
import { PluginService } from './PluginService'; // Assuming PluginService is in the same directory

export interface RegisteredProvider<T = any> { // Generic type T for the provider instance
  id: string; // e.g., "pluginId.providerId"
  pluginId: string;
  providerId: string; // Original providerId from plugin
  instance: T; // The actual provider instance
  type?: string; // Optional type for categorization
}

export class ProviderService extends EventEmitter {
  private providers: Map<string, RegisteredProvider> = new Map();
  private pluginService: PluginService;

  constructor(pluginService: PluginService) {
    super();
    this.pluginService = pluginService;

    // Subscribe to pluginService events for provider registration
    this.pluginService.on('providerRegistered', this.handleProviderRegistered);
    // Consider handling plugin unload to unregister providers if plugins can be dynamically unloaded
    // this.pluginService.on('pluginUnloaded', this.handlePluginUnloaded);
  }

  private handleProviderRegistered = ({ pluginId, providerId, instance, type }: { 
    pluginId: string, 
    providerId: string, 
    instance: any,
    type?: string 
  }) => {
    this.registerProvider(pluginId, providerId, instance, type);
  };

  // private handlePluginUnloaded = (pluginId: string) => {
  //   const providersToRemove = Array.from(this.providers.values()).filter(p => p.pluginId === pluginId);
  //   providersToRemove.forEach(p => {
  //     this.providers.delete(p.id);
  //     this.emit('providerRemoved', p.id);
  //   });
  //   console.log(`Providers for plugin ${pluginId} unloaded.`);
  // };

  public registerProvider<T = any>(
    pluginId: string,
    providerId: string,
    instance: T,
    type?: string
  ): void {
    const id = `${pluginId}.${providerId}`;
    if (this.providers.has(id)) {
      console.warn(`Provider with id ${id} already registered. Overwriting.`);
      // Optionally, decide if overwriting is allowed or should throw an error
    }

    const registeredProvider: RegisteredProvider<T> = {
      id,
      pluginId,
      providerId,
      instance,
      type,
    };

    this.providers.set(id, registeredProvider);
    this.emit('providerAdded', registeredProvider);
    console.log(`Provider registered: ${id} (Type: ${type || 'N/A'})`);
  }

  public getProvider<T = any>(id: string): RegisteredProvider<T> | undefined {
    return this.providers.get(id) as RegisteredProvider<T> | undefined;
  }

  public getAllProviders(): RegisteredProvider[] {
    return Array.from(this.providers.values());
  }

  public getProvidersByType<T = any>(type: string): RegisteredProvider<T>[] {
    return Array.from(this.providers.values()).filter(p => p.type === type) as RegisteredProvider<T>[];
  }

  public dispose(): void {
    this.pluginService.off('providerRegistered', this.handleProviderRegistered);
    // this.pluginService.off('pluginUnloaded', this.handlePluginUnloaded);
    this.providers.clear();
    this.removeAllListeners();
    console.log("ProviderService disposed.");
  }
}
