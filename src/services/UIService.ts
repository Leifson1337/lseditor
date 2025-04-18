import { EventEmitter } from '../utils/EventEmitter';
import { StatusBarItem } from './StatusBarService';

export interface UITheme {
  name: string;
  type: 'light' | 'dark' | 'high-contrast';
  colors: {
    background: string;
    foreground: string;
    accent: string;
    [key: string]: string;
  };
}

export interface UIShortcut {
  id: string;
  key: string;
  command: string;
  when?: string;
}

export interface UIConfig {
  theme?: string;
  shortcuts?: UIShortcut[];
  statusBar?: {
    visible: boolean;
    position: 'top' | 'bottom';
  };
}

export interface Notification {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  message: string;
  detail?: string;
  actions?: Array<{
    label: string;
    callback: () => void;
  }>;
  timeout?: number;
}

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  command?: string;
  args?: any;
  when?: string;
  submenu?: ContextMenuItem[];
}

interface TooltipOptions {
  content: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  maxWidth?: number;
  interactive?: boolean;
}

export class UIService extends EventEmitter {
  private themes: Map<string, UITheme> = new Map();
  private shortcuts: Map<string, UIShortcut> = new Map();
  private config: UIConfig;
  private notifications: Notification[] = [];
  private statusBarItems: Map<string, StatusBarItem> = new Map();
  private contextMenus: Map<string, ContextMenuItem[]> = new Map();
  private tooltips: Map<string, TooltipOptions> = new Map();
  private dragEnabled: boolean = true;
  private activeTheme: string = 'vs-dark';

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

  public addTheme(theme: UITheme): void {
    this.themes.set(theme.name, theme);
    this.emit('themeAdded', theme);
  }

  public getTheme(name: string): UITheme | undefined {
    return this.themes.get(name);
  }

  public addShortcut(shortcut: UIShortcut): void {
    this.shortcuts.set(shortcut.id, shortcut);
    this.emit('shortcutAdded', shortcut);
  }

  public getShortcut(id: string): UIShortcut | undefined {
    return this.shortcuts.get(id);
  }

  public updateStatusBarItem(item: StatusBarItem): void {
    this.emit('statusBarItemUpdated', item);
  }

  public dispose(): void {
    this.themes.clear();
    this.shortcuts.clear();
    this.notifications = [];
    this.statusBarItems.clear();
    this.contextMenus.clear();
    this.tooltips.clear();
    this.removeAllListeners();
  }

  public showNotification(message: string, type: 'info' | 'warning' | 'error' = 'info'): string {
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

  // Notification Management
  public getNotifications(): Notification[] {
    return [...this.notifications];
  }

  // Status Bar Management
  public addStatusBarItem(item: StatusBarItem): void {
    this.statusBarItems.set(item.id, item);
    this.emit('statusBarItemAdded', item);
  }

  public removeStatusBarItem(id: string): void {
    this.statusBarItems.delete(id);
    this.emit('statusBarItemRemoved', id);
  }

  // Context Menu Management
  public setContextMenu(location: string, items: ContextMenuItem[]): void {
    this.contextMenus.set(location, items);
    this.emit('contextMenuUpdated', { location, items });
  }

  public getContextMenu(location: string): ContextMenuItem[] | undefined {
    return this.contextMenus.get(location);
  }

  // Drag & Drop Management
  public enableDragAndDrop(): void {
    this.dragEnabled = true;
    this.emit('dragAndDropStateChanged', true);
  }

  public disableDragAndDrop(): void {
    this.dragEnabled = false;
    this.emit('dragAndDropStateChanged', false);
  }

  public isDragAndDropEnabled(): boolean {
    return this.dragEnabled;
  }

  // Tooltip Management
  public setTooltip(elementId: string, options: TooltipOptions): void {
    this.tooltips.set(elementId, options);
    this.emit('tooltipSet', { elementId, options });
  }

  public removeTooltip(elementId: string): void {
    this.tooltips.delete(elementId);
    this.emit('tooltipRemoved', elementId);
  }

  public getTooltip(elementId: string): TooltipOptions | undefined {
    return this.tooltips.get(elementId);
  }

  public setActiveTheme(themeName: string): void {
    this.activeTheme = themeName;
    this.emit('themeChanged', themeName);
  }

  public getActiveTheme(): string {
    return this.activeTheme;
  }
} 