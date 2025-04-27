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

/**
 * Interface for a notification.
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
   * Optional timeout for the notification.
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
    this.emit('statusBarItemUpdated', item);
  }

  /**
   * Dispose of the UIService.
   */
  public dispose(): void {
    this.themes.clear();
    this.shortcuts.clear();
    this.notifications = [];
    this.statusBarItems.clear();
    this.contextMenus.clear();
    this.tooltips.clear();
    this.removeAllListeners();
  }

  /**
   * Show a notification message.
   * @param message Message to display.
   * @param type Type of notification (info, warning, error, success).
   * @returns ID of the notification.
   */
  public showNotification(message: string, type: 'info' | 'warning' | 'error' | 'success'): string {
    const id = Math.random().toString(36).substring(2);
    const notification: Notification = {
      id,
      type,
      message,
      timeout: 5000
    };
    this.notifications.push(notification);
    this.emit('notification', notification);
    return id;
  }

  /**
   * Get the list of notifications.
   * @returns List of notifications.
   */
  public getNotifications(): Notification[] {
    return [...this.notifications];
  }

  /**
   * Add a status bar item.
   * @param item Status bar item to add.
   */
  public addStatusBarItem(item: StatusBarItem): void {
    this.statusBarItems.set(item.id, item);
    this.emit('statusBarItemAdded', item);
  }

  /**
   * Remove a status bar item.
   * @param id ID of the status bar item to remove.
   */
  public removeStatusBarItem(id: string): void {
    this.statusBarItems.delete(id);
    this.emit('statusBarItemRemoved', id);
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