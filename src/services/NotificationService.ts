import { EventEmitter } from 'events';

// Notification represents a single notification message
export interface Notification {
  // Unique notification ID (not used in this implementation)
  // id: string;
  type: 'info' | 'warning' | 'error' | 'success'; // Notification type
  message: string;         // Notification message content
  duration?: number;       // Optional duration (ms) to show notification
  // timestamp: Date;         // Time when the notification was created (not used in this implementation)
  action?: {
    label: string;
    callback: () => void;
  };
}

// NotificationService manages notifications for the application
export class NotificationService extends EventEmitter {
  // List of active notifications
  private notifications: Notification[] = [];

  /**
   * Constructor for the NotificationService.
   * Initializes the event emitter.
   */
  constructor() {
    super();
  }

  /**
   * Show a new notification to the user.
   * Adds the notification to the list and emits an event.
   * If a duration is specified, the notification will be dismissed after that time.
   * @param notification Notification to show
   */
  public show(notification: Notification): void {
    this.notifications.push(notification);
    this.emit('notificationAdded', notification);

    if (notification.duration) {
      setTimeout(() => {
        this.dismiss(notification);
      }, notification.duration);
    }
  }

  /**
   * Dismiss a notification by removing it from the list and emitting an event.
   * @param notification Notification to dismiss
   */
  public dismiss(notification: Notification): void {
    const index = this.notifications.indexOf(notification);
    if (index !== -1) {
      this.notifications.splice(index, 1);
      this.emit('notificationDismissed', notification);
    }
  }

  /**
   * Get all active notifications.
   * Returns a copy of the notifications array.
   * @returns Array of notifications
   */
  public getNotifications(): Notification[] {
    return [...this.notifications];
  }

  /**
   * Clear all notifications by removing them from the list and emitting an event.
   */
  public clear(): void {
    this.notifications = [];
    this.emit('notificationsCleared');
  }

  /**
   * Dispose of the NotificationService by clearing all notifications and removing all event listeners.
   */
  public dispose(): void {
    this.clear();
    this.removeAllListeners();
  }
}