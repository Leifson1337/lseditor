import { EventEmitter } from '../utils/EventEmitter';
import { PluginService } from './PluginService'; // Assuming PluginService is in the same directory

export interface RegisteredCommand {
  id: string; // e.g., "pluginId.commandName"
  pluginId: string;
  command: string; // Original command name from plugin
  label?: string; // Optional user-facing label
  icon?: string; // Optional icon
  callback: (...args: any[]) => void;
}

export class CommandService extends EventEmitter {
  private commands: Map<string, RegisteredCommand> = new Map();
  private pluginService: PluginService;

  constructor(pluginService: PluginService) {
    super();
    this.pluginService = pluginService;

    // Subscribe to pluginService events for command registration
    this.pluginService.on('commandRegistered', this.handleCommandRegistered);
    // It's good practice to also handle plugin unregistration if that can happen
    // this.pluginService.on('pluginUnloaded', this.handlePluginUnloaded); 
  }

  private handleCommandRegistered = ({ pluginId, command, callback, label, icon }: { pluginId: string, command: string, callback: (...args: any[]) => void, label?: string, icon?: string }) => {
    this.registerCommand(pluginId, command, callback, label, icon);
  };

  // private handlePluginUnloaded = (pluginId: string) => {
  //   // Unregister all commands associated with this plugin
  //   const commandsToRemove = Array.from(this.commands.values()).filter(cmd => cmd.pluginId === pluginId);
  //   commandsToRemove.forEach(cmd => {
  //     this.commands.delete(cmd.id);
  //     this.emit('commandRemoved', cmd.id); 
  //   });
  //   console.log(`Commands for plugin ${pluginId} unloaded.`);
  // };

  public registerCommand(
    pluginId: string,
    commandName: string,
    callback: (...args: any[]) => void,
    label?: string,
    icon?: string
  ): void {
    const id = `${pluginId}.${commandName}`;
    if (this.commands.has(id)) {
      console.warn(`Command with id ${id} already registered. Overwriting.`);
      // Optionally, decide if overwriting is allowed or should throw an error
    }

    const registeredCommand: RegisteredCommand = {
      id,
      pluginId,
      command: commandName,
      label: label || commandName, // Default label to commandName if not provided
      icon,
      callback,
    };

    this.commands.set(id, registeredCommand);
    this.emit('commandAdded', registeredCommand);
    console.log(`Command registered: ${id}`);
  }

  public executeCommand(id: string, ...args: any[]): void {
    const command = this.commands.get(id);
    if (command) {
      try {
        command.callback(...args);
        this.emit('commandExecuted', { id, args });
      } catch (error) {
        console.error(`Error executing command ${id}:`, error);
        this.emit('commandExecutionError', { id, error });
        // Optionally re-throw or handle more gracefully
      }
    } else {
      console.warn(`Command ${id} not found.`);
      this.emit('commandNotFound', id);
      // Optionally throw an error
    }
  }

  public getCommand(id: string): RegisteredCommand | undefined {
    return this.commands.get(id);
  }

  public getAllCommands(): RegisteredCommand[] {
    return Array.from(this.commands.values());
  }

  public dispose(): void {
    this.pluginService.off('commandRegistered', this.handleCommandRegistered);
    // this.pluginService.off('pluginUnloaded', this.handlePluginUnloaded);
    this.commands.clear();
    this.removeAllListeners();
    console.log("CommandService disposed.");
  }
}
