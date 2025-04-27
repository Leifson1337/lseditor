// Browser-kompatible EventEmitter-Implementierung
// Lightweight event emitter utility for managing custom events in the application

/**
 * EventEmitter provides basic publish/subscribe functionality for custom events.
 * Listeners can be registered for named events, triggered, and removed.
 */
export class EventEmitter {
  // Map of event names to arrays of listener functions
  private events: Record<string, Function[]> = {};

  /**
   * Register a listener for a specific event.
   * @param event Name of the event
   * @param listener Callback function to invoke when the event is emitted
   */
  on(event: string, listener: Function): this {
    // Initialize event array if it doesn't exist
    if (!this.events[event]) {
      this.events[event] = [];
    }
    // Add listener to event array
    this.events[event].push(listener);
    return this;
  }

  /**
   * Emit an event, calling all registered listeners for that event.
   * @param event Name of the event
   * @param args Arguments to pass to listeners
   */
  emit(event: string, ...args: any[]): boolean {
    // Check if event has listeners
    if (!this.events[event]) {
      return false;
    }
    // Call each listener with provided arguments
    this.events[event].forEach(listener => listener(...args));
    return true;
  }

  /**
   * Remove a listener for a specific event.
   * @param event Name of the event
   * @param listener Callback function to remove
   */
  removeListener(event: string, listener: Function): this {
    // Check if event exists
    if (!this.events[event]) {
      return this;
    }
    // Filter out listener from event array
    this.events[event] = this.events[event].filter(l => l !== listener);
    return this;
  }

  /**
   * Remove all listeners for a specific event or all events.
   * @param event Optional event name to remove listeners for
   */
  removeAllListeners(event?: string): this {
    // Remove all listeners for a specific event
    if (event) {
      delete this.events[event];
    } else {
      // Remove all listeners for all events
      this.events = {};
    }
    return this;
  }

  /**
   * Register a listener for a specific event, which will be automatically removed after the first invocation.
   * @param event Name of the event
   * @param listener Callback function to invoke when the event is emitted
   */
  once(event: string, listener: Function): this {
    // Create a wrapper function to handle listener removal
    const onceWrapper = (...args: any[]) => {
      listener(...args);
      this.removeListener(event, onceWrapper);
    };
    // Register wrapper function as listener
    return this.on(event, onceWrapper);
  }

  /**
   * Get the number of listeners for a specific event.
   * @param event Name of the event
   */
  listenerCount(event: string): number {
    // Return length of event array or 0 if event doesn't exist
    return this.events[event]?.length || 0;
  }
}
