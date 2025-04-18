interface Extension {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  enabled: boolean;
  commands: ExtensionCommand[];
}

interface ExtensionCommand {
  id: string;
  name: string;
  description: string;
  handler: () => void;
}

export class ExtensionService {
  private static instance: ExtensionService;
  private extensions: Map<string, Extension> = new Map();
  private commands: Map<string, ExtensionCommand> = new Map();

  private constructor() {}

  public static getInstance(): ExtensionService {
    if (!ExtensionService.instance) {
      ExtensionService.instance = new ExtensionService();
    }
    return ExtensionService.instance;
  }

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

  registerCommand(command: ExtensionCommand): void {
    this.commands.set(command.id, command);
  }

  unregisterCommand(commandId: string): void {
    this.commands.delete(commandId);
  }

  getCommands(): ExtensionCommand[] {
    return Array.from(this.commands.values());
  }

  getExtensions(): Extension[] {
    return Array.from(this.extensions.values());
  }

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