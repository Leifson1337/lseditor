import { EventEmitter } from 'events';

// CacheEntry represents a single entry in the cache
interface CacheEntry<T> {
  data: T; // Cached data
  timestamp: number; // Timestamp when the entry was created
  ttl: number; // Time to live for the entry
}

// BackgroundTask represents a background task being tracked
interface BackgroundTask {
  id: string; // Unique ID for the task
  name: string; // Name of the task
  status: 'pending' | 'running' | 'completed' | 'failed'; // Current status of the task
  progress: number; // Progress of the task (0-100)
  startTime: number; // Timestamp when the task started
  endTime?: number; // Timestamp when the task ended (optional)
  error?: string; // Error message if the task failed (optional)
}

// ResourceUsage represents the current resource usage of the application
interface ResourceUsage {
  cpu: number; // CPU usage percentage
  memory: {
    heapUsed: number; // Heap memory used in bytes
    heapTotal: number; // Total heap memory in bytes
    external: number; // External memory used in bytes
  };
  loadAverage: number[]; // Load average for the past 1, 5, and 15 minutes
}

/**
 * PerformanceService monitors and tracks application performance, including cache management, background tasks, and resource usage.
 */
export class PerformanceService extends EventEmitter {
  // Cache for storing data
  private cache: Map<string, CacheEntry<any>> = new Map();

  // Map of background tasks being tracked
  private backgroundTasks: Map<string, BackgroundTask> = new Map();

  // Current resource usage
  private resourceUsage: ResourceUsage | null = null;

  // Interval for updating resource usage
  private updateInterval: NodeJS.Timeout | null = null;

  // Maximum size of the cache
  private maxCacheSize: number = 100;

  // Maximum age of cache entries
  private maxCacheAge: number = 1000 * 60 * 60; // 1 hour

  /**
   * Constructor for the PerformanceService class.
   */
  constructor() {
    super();
    this.startResourceMonitoring();
  }

  // Cache Management

  /**
   * Set a value in the cache.
   * @param key Key for the cache entry
   * @param value Value to store in the cache
   * @param ttl Time to live for the cache entry (optional)
   */
  public set<T>(key: string, value: T, ttl: number = this.maxCacheAge): void {
    if (this.cache.size >= this.maxCacheSize) {
      this.cleanupCache();
    }

    this.cache.set(key, {
      data: value,
      timestamp: Date.now(),
      ttl
    });

    this.emit('cacheUpdated', { key, size: this.cache.size });
  }

  /**
   * Get a value from the cache.
   * @param key Key for the cache entry
   * @returns Cached value or null if not found
   */
  public get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Delete a value from the cache.
   * @param key Key for the cache entry
   */
  public delete(key: string): void {
    this.cache.delete(key);
    this.emit('cacheUpdated', { key, size: this.cache.size });
  }

  /**
   * Clear the entire cache.
   */
  public clearCache(): void {
    this.cache.clear();
    this.emit('cacheCleared');
  }

  /**
   * Clean up expired cache entries.
   */
  private cleanupCache(): void {
    const now = Date.now();
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    this.cache.forEach((entry, key) => {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      } else if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    });

    if (oldestKey && this.cache.size >= this.maxCacheSize) {
      this.cache.delete(oldestKey);
    }
  }

  // Background Task Management

  /**
   * Start a background task.
   * @param name Name of the background task
   * @returns Unique ID for the task
   */
  public startBackgroundTask(name: string): string {
    const id = Math.random().toString(36).substring(2);
    const task: BackgroundTask = {
      id,
      name,
      status: 'pending',
      progress: 0,
      startTime: Date.now()
    };

    this.backgroundTasks.set(id, task);
    this.emit('taskStarted', task);
    return id;
  }

  /**
   * Update the progress of a background task.
   * @param id Unique ID for the task
   * @param progress Progress of the task (0-100)
   */
  public updateTaskProgress(id: string, progress: number): void {
    const task = this.backgroundTasks.get(id);
    if (task) {
      task.progress = progress;
      task.status = 'running';
      this.emit('taskProgress', { id, progress });
    }
  }

  /**
   * Complete a background task.
   * @param id Unique ID for the task
   */
  public completeTask(id: string): void {
    const task = this.backgroundTasks.get(id);
    if (task) {
      task.status = 'completed';
      task.progress = 100;
      task.endTime = Date.now();
      this.emit('taskCompleted', task);
    }
  }

  /**
   * Fail a background task.
   * @param id Unique ID for the task
   * @param error Error message
   */
  public failTask(id: string, error: string): void {
    const task = this.backgroundTasks.get(id);
    if (task) {
      task.status = 'failed';
      task.error = error;
      task.endTime = Date.now();
      this.emit('taskFailed', task);
    }
  }

  /**
   * Get a background task by ID.
   * @param id Unique ID for the task
   * @returns Background task or undefined if not found
   */
  public getTask(id: string): BackgroundTask | undefined {
    return this.backgroundTasks.get(id);
  }

  /**
   * Get all background tasks.
   * @returns Array of background tasks
   */
  public getTasks(): BackgroundTask[] {
    return Array.from(this.backgroundTasks.values());
  }

  /**
   * Remove a background task.
   * @param id Unique ID for the task
   */
  public removeTask(id: string): void {
    this.backgroundTasks.delete(id);
    this.emit('taskRemoved', id);
  }

  // Resource Monitoring

  /**
   * Start monitoring resource usage.
   * @param interval Interval for updating resource usage (optional)
   */
  public startResourceMonitoring(interval: number = 5000): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.updateInterval = setInterval(() => {
      this.updateResourceUsage();
    }, interval);

    this.updateResourceUsage();
  }

  /**
   * Update the current resource usage.
   */
  private updateResourceUsage(): void {
    const usage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const loadAvg = require('os').loadavg();

    this.resourceUsage = {
      cpu: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to seconds
      memory: {
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        external: usage.external
      },
      loadAverage: loadAvg
    };

    this.emit('resourceUsageUpdated', this.resourceUsage);
  }

  /**
   * Get the current resource usage.
   * @returns Current resource usage or null if not available
   */
  public getResourceUsage(): ResourceUsage | null {
    return this.resourceUsage;
  }

  // Memory Management

  /**
   * Optimize memory usage by clearing expired cache entries and removing completed tasks.
   */
  public async optimizeMemory(): Promise<void> {
    // Clear expired cache entries
    this.cleanupCache();

    // Remove completed tasks older than 1 hour
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    this.backgroundTasks.forEach((task, id) => {
      if (task.status === 'completed' && task.endTime && task.endTime < oneHourAgo) {
        this.backgroundTasks.delete(id);
      }
    });

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    this.emit('memoryOptimized');
  }

  /**
   * Dispose of the PerformanceService instance.
   */
  public dispose(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    this.clearCache();
    this.backgroundTasks.clear();
    this.resourceUsage = null;
    this.removeAllListeners();
  }
}