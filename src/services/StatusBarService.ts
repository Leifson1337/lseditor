import { EventEmitter } from 'events';

// StatusBarItem represents an item displayed in the status bar
export interface StatusBarItem {
  id: string;                // Unique ID for the status bar item
  text: string;              // Text to display
  tooltip?: string;          // Optional tooltip text
  alignment: 'left' | 'right'; // Alignment in the status bar
  priority?: number;         // Priority for sorting
  command?: string;          // Optional command to execute on click
  icon?: string;             // Optional icon name or path
}

// StatusBarService manages status bar items and updates
export class StatusBarService extends EventEmitter {
  // All status bar items
  private items: Map<string, StatusBarItem> = new Map();

  /**
   * Constructor for StatusBarService
   */
  constructor() {
    super();
  }

  /**
   * Update a status bar item.
   * @param item StatusBarItem to update
   */
  public updateStatusBarItem(item: StatusBarItem): void {
    this.items.set(item.id, item);
    this.emit('statusBarItemUpdated', item);
  }

  /**
   * Remove a status bar item by ID.
   * @param id ID of the item to remove
   */
  public removeStatusBarItem(id: string): void {
    if (this.items.has(id)) {
      this.items.delete(id);
      this.emit('statusBarItemRemoved', id);
    }
  }

  /**
   * Get a status bar item by ID.
   * @param id ID of the item to retrieve
   * @returns StatusBarItem or undefined if not found
   */
  public getStatusBarItem(id: string): StatusBarItem | undefined {
    return this.items.get(id);
  }

  /**
   * Get all status bar items, sorted by alignment and priority.
   * @returns Array of StatusBarItem
   */
  public getAllStatusBarItems(): StatusBarItem[] {
    return Array.from(this.items.values()).sort((a, b) => {
      if (a.alignment !== b.alignment) {
        return a.alignment === 'left' ? -1 : 1;
      }
      return (a.priority || 0) - (b.priority || 0);
    });
  }

  /**
   * Clear all status bar items.
   */
  public clear(): void {
    this.items.clear();
    this.emit('statusBarCleared');
  }

  /**
   * Dispose of the StatusBarService, clearing all items and removing listeners.
   */
  public dispose(): void {
    this.clear();
    this.removeAllListeners();
  }
}