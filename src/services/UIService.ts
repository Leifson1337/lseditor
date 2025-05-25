// UIService.ts
// Service for managing UI state, dialogs, notifications, and user interactions

import { EventEmitter } from '../utils/EventEmitter';
import { StatusBarItem } from './StatusBarService';

/**
 * Interface for a UI theme.
 */
export interface UITheme {
  /**
   * Name of the theme.
   */
  name: string;
  /**
   * Type of the theme (light, dark, high-contrast).
   */
  type: 'light' | 'dark' | 'high-contrast';
  /**
   * Color palette for the theme.
   */
  colors: {
    /**
     * Background color.
     */
    background: string;
    /**
     * Foreground color.
     */
    foreground: string;
    /**
     * Accent color.
     */
    accent: string;
    /**
     * Additional colors.
     */
    [key: string]: string;
  };
}

/**
 * Interface for a UI shortcut.
 */
export interface UIShortcut {
  /**
   * Unique ID for the shortcut.
   */
  id: string;
  /**
   * Key combination for the shortcut.
   */
  key: string;
  /**
   * Command to execute when the shortcut is triggered.
   */
  command: string;
  /**
   * Optional condition for when the shortcut is enabled.
   */
  when?: string;
}

/**
 * Interface for the UI configuration.
 */
export interface UIConfig {
  /**
   * Optional theme to use.
   */
  theme?: string;
  /**
   * Optional shortcuts to register.
   */
  shortcuts?: UIShortcut[];
  /**
   * Optional status bar configuration.
   */
  statusBar?: {
    /**
     * Whether the status bar is visible.
     */
    visible: boolean;
    /**
     * Position of the status bar (top or bottom).
     */
    position: 'top' | 'bottom';
  };
}

// Re-exporting StatusBarItem or defining it here if it's simple enough
// For now, assuming StatusBarItem is imported from './StatusBarService'
// If StatusBarService.ts is deleted, this definition needs to be moved or redefined.
// For consolidation, let's define it here.
export interface StatusBarItem {
  id: string;                // Unique ID for the status bar item
  text: string;              // Text to display
  tooltip?: string;          // Optional tooltip text
  alignment: 'left' | 'right'; // Alignment in the status bar
  priority?: number;         // Priority for sorting
  command?: string;          // Optional command to execute on click
  icon?: string;             // Optional icon name or path
}


/**
 * Interface for a notification (using the more detailed one already in UIService).
 */
export interface Notification {
  /**
   * Unique ID for the notification.
   */
  id: string;
  /**
   * Type of notification (info, warning, error, success).
   */
  type: 'info' | 'warning' | 'error' | 'success';
  /**
   * Message to display in the notification.
   */
  message: string;
  /**
   * Optional detailed message.
   */
  detail?: string;
  /**
   * Optional actions for the notification.
   */
  actions?: Array<{
    /**
     * Label for the action.
     */
    label: string;
    /**
     * Callback function for the action.
     */
    callback: () => void;
  }>;
  /**
   * Optional timeout for the notification (in milliseconds).
   */
  timeout?: number;
}

/**
 * Interface for a context menu item.
 */
export interface ContextMenuItem {
  /**
   * Unique ID for the menu item.
   */
  id: string;
  /**
   * Label for the menu item.
   */
  label: string;
  /**
   * Optional icon for the menu item.
   */
  icon?: string;
  /**
   * Optional command to execute when the menu item is clicked.
   */
  command?: string;
  /**
   * Optional arguments for the command.
   */
  args?: any;
  /**
   * Optional condition for when the menu item is enabled.
   */
  when?: string;
  /**
   * Optional submenu items.
   */
  submenu?: ContextMenuItem[];
}

/**
 * Interface for tooltip options.
 */
interface TooltipOptions {
  /**
   * Content to display in the tooltip.
   */
  content: string;
  /**
   * Optional position for the tooltip (top, bottom, left, right).
   */
  position?: 'top' | 'bottom' | 'left' | 'right';
  /**
   * Optional delay before showing the tooltip.
   */
  delay?: number;
  /**
   * Optional maximum width for the tooltip.
   */
  maxWidth?: number;
  /**
   * Optional flag for whether the tooltip is interactive.
   */
  interactive?: boolean;
}

/**
 * UIService provides methods for managing UI state, dialogs, notifications,
 * and user interactions.
 */
export class UIService extends EventEmitter {
  /**
   * Map of registered themes.
   */
  private themes: Map<string, UITheme> = new Map();
  /**
   * Map of registered shortcuts.
   */
  private shortcuts: Map<string, UIShortcut> = new Map();
  /**
   * Current UI configuration.
   */
  private config: UIConfig;
  /**
   * List of notifications.
   */
  private notifications: Notification[] = [];
  /**
   * Map of status bar items.
   */
  private statusBarItems: Map<string, StatusBarItem> = new Map();
  /**
   * Map of context menus.
   */
  private contextMenus: Map<string, ContextMenuItem[]> = new Map();
  /**
   * Map of tooltips.
   */
  private tooltips: Map<string, TooltipOptions> = new Map();
  /**
   * Flag for whether drag and drop is enabled.
   */
  private dragEnabled: boolean = true;
  /**
   * Currently active theme.
   */
  private activeTheme: string = 'vs-dark';

  /**
   * Constructor for the UIService.
   * @param config Optional UI configuration.
   */
  constructor(config: Partial<UIConfig> = {}) {
    super();
    this.config = {
      theme: 'dark',
      statusBar: {
        visible: true,
        position: 'bottom'
      },
      ...config
    };
    this.initializeDefaultThemes();
    this.initializeDefaultShortcuts();
    this.initializeDefaultContextMenus();
  }

  /**
   * Initialize default themes.
   */
  public initializeDefaultThemes(): void {
    this.addTheme({
      name: 'dark',
      type: 'dark',
      colors: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        accent: '#007acc'
      }
    });

    this.addTheme({
      name: 'light',
      type: 'light',
      colors: {
        background: '#ffffff',
        foreground: '#000000',
        accent: '#0066b8'
      }
    });
  }

  /**
   * Initialize default shortcuts.
   */
  public initializeDefaultShortcuts(): void {
    this.addShortcut({
      id: 'save',
      key: 'Ctrl+S',
      command: 'workbench.action.files.save'
    });

    this.addShortcut({
      id: 'find',
      key: 'Ctrl+F',
      command: 'actions.find'
    });

    this.addShortcut({
      id: 'showCommands',
      key: 'Ctrl+Shift+P', // Common shortcut for command palette
      command: 'workbench.action.showCommands'
    });
  }

  /**
   * Triggers the execution of a registered command or emits an event for global listeners.
   * This is primarily used by shortcuts or UI elements that want to invoke a command
   * without directly depending on CommandService.
   * @param commandId The ID of the command to trigger.
   * @param args Optional arguments to pass to the command.
   */
  public triggerCommand(commandId: string, ...args: any[]): void {
    // The actual command execution is handled by CommandService.
    // UIService can emit a generic event that App.tsx or other top-level components
    // can listen to, which then calls commandService.executeCommand.
    // Or, if CommandService is available here, it could call it.
    // For opening the command palette, a specific event is more direct.
    if (commandId === 'workbench.action.showCommands') {
      this.emit('toggleCommandPalette');
    } else {
      // For other commands, you might have a more generic mechanism
      // For now, this service focuses on UI aspects, actual execution is elsewhere.
      console.warn(`UIService.triggerCommand used for non-UI command: ${commandId}. This might be better handled by CommandService directly.`);
      // This could emit a generic event like this.emit('executeCommand', { commandId, args });
    }
  }
  
  /**
   * Initialize default context menus.
   */
  private initializeDefaultContextMenus(): void {
    this.setContextMenu('editor', [
      {
        id: 'cut',
        label: 'Cut',
        command: 'editor.action.clipboardCutAction'
      },
      {
        id: 'copy',
        label: 'Copy',
        command: 'editor.action.clipboardCopyAction'
      },
      {
        id: 'paste',
        label: 'Paste',
        command: 'editor.action.clipboardPasteAction'
      }
    ]);

    this.setContextMenu('explorer', [
      {
        id: 'newFile',
        label: 'New File',
        command: 'explorer.newFile'
      },
      {
        id: 'newFolder',
        label: 'New Folder',
        command: 'explorer.newFolder'
      },
      {
        id: 'delete',
        label: 'Delete',
        command: 'explorer.delete'
      }
    ]);
  }

  /**
   * Add a theme to the registry.
   * @param theme Theme to add.
   */
  public addTheme(theme: UITheme): void {
    this.themes.set(theme.name, theme);
    this.emit('themeAdded', theme);
  }

  /**
   * Get a theme by name.
   * @param name Name of the theme.
   * @returns Theme object or undefined if not found.
   */
  public getTheme(name: string): UITheme | undefined {
    return this.themes.get(name);
  }

  /**
   * Add a shortcut to the registry.
   * @param shortcut Shortcut to add.
   */
  public addShortcut(shortcut: UIShortcut): void {
    this.shortcuts.set(shortcut.id, shortcut);
    this.emit('shortcutAdded', shortcut);
  }

  /**
   * Get a shortcut by ID.
   * @param id ID of the shortcut.
   * @returns Shortcut object or undefined if not found.
   */
  public getShortcut(id: string): UIShortcut | undefined {
    return this.shortcuts.get(id);
  }

  /**
   * Update a status bar item.
   * @param item Status bar item to update.
   */
  public updateStatusBarItem(item: StatusBarItem): void {
    this.statusBarItems.set(item.id, item); // Actually update the item
    this.emit('statusBarItemUpdated', item);
  }

  /**
   * Get a status bar item by ID.
   * @param id ID of the item to retrieve
   * @returns StatusBarItem or undefined if not found
   */
  public getStatusBarItem(id: string): StatusBarItem | undefined {
    return this.statusBarItems.get(id);
  }

  /**
   * Get all status bar items, sorted by alignment and priority.
   * @returns Array of StatusBarItem
   */
  public getAllStatusBarItems(): StatusBarItem[] {
    return Array.from(this.statusBarItems.values()).sort((a, b) => {
      if (a.alignment !== b.alignment) {
        return a.alignment === 'left' ? -1 : 1;
      }
      return (a.priority || 0) - (b.priority || 0);
    });
  }
  
  /**
   * Clear all status bar items.
   */
  public clearStatusBarItems(): void {
    this.statusBarItems.clear();
    this.emit('statusBarCleared');
  }

  /**
   * Dispose of the UIService.
   */
  public dispose(): void {
    this.themes.clear();
    this.shortcuts.clear();
    this.clearNotifications(); // Use the new method
    this.clearStatusBarItems(); // Use the new method
    this.contextMenus.clear();
    this.tooltips.clear();
    this.removeAllListeners();
  }

  // --- Enhanced Notification Management ---

  /**
   * Show a new notification.
   * @param notification Partial notification data (message and type are minimum).
   * @returns The full Notification object with an ID.
   */
  public showNotification(notificationData: Omit<Notification, 'id'> & { id?: string }): Notification {
    const id = notificationData.id || Math.random().toString(36).substring(2, 15);
    const fullNotification: Notification = {
      ...notificationData,
      id,
    };
    this.notifications.push(fullNotification);
    this.emit('notificationAdded', fullNotification); // Specific event

    if (fullNotification.timeout) {
      setTimeout(() => {
        this.dismissNotification(fullNotification.id);
      }, fullNotification.timeout);
    }
    return fullNotification;
  }
  
  /**
   * Dismiss a notification by its ID.
   * @param notificationId The ID of the notification to dismiss.
   */
  public dismissNotification(notificationId: string): void {
    const index = this.notifications.findIndex(n => n.id === notificationId);
    if (index !== -1) {
      const dismissedNotification = this.notifications.splice(index, 1)[0];
      this.emit('notificationDismissed', dismissedNotification); // Specific event
    }
  }

  /**
   * Clear all notifications.
   */
  public clearNotifications(): void {
    this.notifications = [];
    this.emit('notificationsCleared'); // Specific event
  }

  /**
   * Get all active notifications.
   * @returns A copy of the array of notifications.
   */
  public getNotifications(): Notification[] {
    return [...this.notifications];
  }

  // --- Enhanced Status Bar Management (already partially done, ensuring consistency) ---

  /**
   * Add a status bar item. If an item with the same ID exists, it will be updated.
   * @param item Status bar item to add or update.
   */
  public addStatusBarItem(item: StatusBarItem): void {
    this.statusBarItems.set(item.id, item);
    this.emit('statusBarItemAdded', item); // Keep specific event, or use a general 'changed'
  }

  /**
   * Remove a status bar item.
   * @param id ID of the status bar item to remove.
   */
  public removeStatusBarItem(id: string): void {
    if (this.statusBarItems.has(id)) {
      const removedItem = this.statusBarItems.get(id);
      this.statusBarItems.delete(id);
      this.emit('statusBarItemRemoved', { id, item: removedItem }); // Emit id or full item
    }
  }

  /**
   * Set a context menu.
   * @param location Location of the context menu.
   * @param items Items to display in the context menu.
   */
  public setContextMenu(location: string, items: ContextMenuItem[]): void {
    this.contextMenus.set(location, items);
    this.emit('contextMenuUpdated', { location, items });
  }

  /**
   * Get a context menu.
   * @param location Location of the context menu.
   * @returns Context menu items or undefined if not found.
   */
  public getContextMenu(location: string): ContextMenuItem[] | undefined {
    return this.contextMenus.get(location);
  }

  /**
   * Enable drag and drop.
   */
  public enableDragAndDrop(): void {
    this.dragEnabled = true;
    this.emit('dragAndDropStateChanged', true);
  }

  /**
   * Disable drag and drop.
   */
  public disableDragAndDrop(): void {
    this.dragEnabled = false;
    this.emit('dragAndDropStateChanged', false);
  }

  /**
   * Check if drag and drop is enabled.
   * @returns Whether drag and drop is enabled.
   */
  public isDragAndDropEnabled(): boolean {
    return this.dragEnabled;
  }

  /**
   * Set a tooltip.
   * @param elementId ID of the element to display the tooltip for.
   * @param options Options for the tooltip.
   */
  public setTooltip(elementId: string, options: TooltipOptions): void {
    this.tooltips.set(elementId, options);
    this.emit('tooltipSet', { elementId, options });
  }

  /**
   * Remove a tooltip.
   * @param elementId ID of the element to remove the tooltip for.
   */
  public removeTooltip(elementId: string): void {
    this.tooltips.delete(elementId);
    this.emit('tooltipRemoved', elementId);
  }

  /**
   * Get a tooltip.
   * @param elementId ID of the element to get the tooltip for.
   * @returns Tooltip options or undefined if not found.
   */
  public getTooltip(elementId: string): TooltipOptions | undefined {
    return this.tooltips.get(elementId);
  }

  /**
   * Set the active theme.
   * @param themeName Name of the theme to set.
   */
  public setActiveTheme(themeName: string): void {
    this.activeTheme = themeName;
    this.emit('themeChanged', themeName);
  }

  /**
   * Get the active theme.
   * @returns Name of the active theme.
   */
  public getActiveTheme(): string {
    return this.activeTheme;
  }
}