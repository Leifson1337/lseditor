import { EventEmitter } from 'events';

export interface Notification {
  type: 'info' | 'warning' | 'error' | 'success';
  message: string;
  duration?: number;
  action?: {
    label: string;
    callback: () => void;
  };
}

export class NotificationService extends EventEmitter {
  private notifications: Notification[] = [];

  constructor() {
    super();
  }

  public show(notification: Notification): void {
    this.notifications.push(notification);
    this.emit('notificationAdded', notification);

    if (notification.duration) {
      setTimeout(() => {
        this.dismiss(notification);
      }, notification.duration);
    }
  }

  public dismiss(notification: Notification): void {
    const index = this.notifications.indexOf(notification);
    if (index !== -1) {
      this.notifications.splice(index, 1);
      this.emit('notificationDismissed', notification);
    }
  }

  public getNotifications(): Notification[] {
    return [...this.notifications];
  }

  public clear(): void {
    this.notifications = [];
    this.emit('notificationsCleared');
  }

  public dispose(): void {
    this.clear();
    this.removeAllListeners();
  }
} 