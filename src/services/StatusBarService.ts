import { EventEmitter } from 'events';

export interface StatusBarItem {
  id: string;
  text: string;
  tooltip?: string;
  alignment: 'left' | 'right';
  priority?: number;
  command?: string;
  icon?: string;
}

export class StatusBarService extends EventEmitter {
  private items: Map<string, StatusBarItem> = new Map();

  constructor() {
    super();
  }

  public updateStatusBarItem(item: StatusBarItem): void {
    this.items.set(item.id, item);
    this.emit('statusBarItemUpdated', item);
  }

  public removeStatusBarItem(id: string): void {
    if (this.items.has(id)) {
      this.items.delete(id);
      this.emit('statusBarItemRemoved', id);
    }
  }

  public getStatusBarItem(id: string): StatusBarItem | undefined {
    return this.items.get(id);
  }

  public getAllStatusBarItems(): StatusBarItem[] {
    return Array.from(this.items.values()).sort((a, b) => {
      if (a.alignment !== b.alignment) {
        return a.alignment === 'left' ? -1 : 1;
      }
      return (a.priority || 0) - (b.priority || 0);
    });
  }

  public clear(): void {
    this.items.clear();
    this.emit('statusBarCleared');
  }

  public dispose(): void {
    this.clear();
    this.removeAllListeners();
  }
} 