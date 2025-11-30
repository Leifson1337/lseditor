// Extension represents a user-installed extension for the editor
interface Extension {
  id: string;                // Unique extension ID
  name: string;              // Name of the extension
  version: string;           // Extension version
  description: string;       // Description of the extension
  author: string;            // Author of the extension
  enabled: boolean;          // Whether the extension is enabled
  commands: ExtensionCommand[]; // Commands provided by the extension
}

// ExtensionCommand represents a command provided by an extension
interface ExtensionCommand {
  id: string;                // Unique command ID
  name: string;              // Name of the command
  description: string;       // Description of the command
  handler: () => void;       // Handler function for the command
}

// ExtensionService manages loading, enabling, disabling, and unloading extensions
export class ExtensionService {
  private static instance: ExtensionService;           // Singleton instance
  private extensions: Map<string, Extension> = new Map(); // All loaded extensions
  private commands: Map<string, ExtensionCommand> = new Map(); // All registered commands

  private constructor() {}

  /**
   * Get the singleton instance of ExtensionService.
   */
  public static getInstance(): ExtensionService {
    if (!ExtensionService.instance) {
      ExtensionService.instance = new ExtensionService();
    }
    return ExtensionService.instance;
  }

  /**
   * Load an extension from the file system.
   * @param extensionPath Path to the extension
   * @returns True if loaded successfully, false otherwise
   */
  async loadExtension(extensionPath: string): Promise<boolean> {
    try {
      // Here you would load the extension from the file system
      // and register its commands
      return true;
    } catch (error) {
      console.error('Failed to load extension:', error);
      return false;
    }
  }

  /**
   * Unload an extension and remove its commands.
   * @param extensionId ID of the extension to unload
   * @returns True if unloaded successfully, false otherwise
   */
  async unloadExtension(extensionId: string): Promise<boolean> {
    try {
      const extension = this.extensions.get(extensionId);
      if (!extension) return false;
      // Remove all commands associated with this extension
      extension.commands.forEach(cmd => {
        this.commands.delete(cmd.id);
      });
      this.extensions.delete(extensionId);
      return true;
    } catch (error) {
      console.error('Failed to unload extension:', error);
      return false;
    }
  }

  /**
   * Enable an extension.
   * @param extensionId ID of the extension to enable
   * @returns True if enabled successfully, false otherwise
   */
  async enableExtension(extensionId: string): Promise<boolean> {
    try {
      const extension = this.extensions.get(extensionId);
      if (!extension) return false;
      extension.enabled = true;
      this.extensions.set(extensionId, extension);
      return true;
    } catch (error) {
      console.error('Failed to enable extension:', error);
      return false;
    }
  }

  /**
   * Disable an extension.
   * @param extensionId ID of the extension to disable
   * @returns True if disabled successfully, false otherwise
   */
  async disableExtension(extensionId: string): Promise<boolean> {
    try {
      const extension = this.extensions.get(extensionId);
      if (!extension) return false;
      extension.enabled = false;
      this.extensions.set(extensionId, extension);
      return true;
    } catch (error) {
      console.error('Failed to disable extension:', error);
      return false;
    }
  }

  /**
   * Register a command provided by an extension.
   * @param command Extension command to register
   */
  registerCommand(command: ExtensionCommand): void {
    this.commands.set(command.id, command);
  }

  /**
   * Unregister a command by its ID.
   * @param commandId ID of the command to unregister
   */
  unregisterCommand(commandId: string): void {
    this.commands.delete(commandId);
  }

  /**
   * Get all registered commands.
   * @returns Array of registered commands
   */
  getCommands(): ExtensionCommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * Get all loaded extensions.
   * @returns Array of loaded extensions
   */
  getExtensions(): Extension[] {
    return Array.from(this.extensions.values());
  }

  /**
   * Execute a command by its ID.
   * @param commandId ID of the command to execute
   * @returns True if executed successfully, false otherwise
   */
  async executeCommand(commandId: string): Promise<boolean> {
    try {
      const command = this.commands.get(commandId);
      if (!command) return false;
      await command.handler();
      return true;
    } catch (error) {
      console.error('Failed to execute command:', error);
      return false;
    }
  }
}