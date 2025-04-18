import { EventEmitter } from 'events';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

interface BackgroundTask {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  startTime: number;
  endTime?: number;
  error?: string;
}

interface ResourceUsage {
  cpu: number;
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  loadAverage: number[];
}

export class PerformanceService extends EventEmitter {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private backgroundTasks: Map<string, BackgroundTask> = new Map();
  private resourceUsage: ResourceUsage | null = null;
  private updateInterval: NodeJS.Timeout | null = null;
  private maxCacheSize: number = 100;
  private maxCacheAge: number = 1000 * 60 * 60; // 1 hour

  constructor() {
    super();
    this.startResourceMonitoring();
  }

  // Cache Management
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

  public get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  public delete(key: string): void {
    this.cache.delete(key);
    this.emit('cacheUpdated', { key, size: this.cache.size });
  }

  public clearCache(): void {
    this.cache.clear();
    this.emit('cacheCleared');
  }

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

  public updateTaskProgress(id: string, progress: number): void {
    const task = this.backgroundTasks.get(id);
    if (task) {
      task.progress = progress;
      task.status = 'running';
      this.emit('taskProgress', { id, progress });
    }
  }

  public completeTask(id: string): void {
    const task = this.backgroundTasks.get(id);
    if (task) {
      task.status = 'completed';
      task.progress = 100;
      task.endTime = Date.now();
      this.emit('taskCompleted', task);
    }
  }

  public failTask(id: string, error: string): void {
    const task = this.backgroundTasks.get(id);
    if (task) {
      task.status = 'failed';
      task.error = error;
      task.endTime = Date.now();
      this.emit('taskFailed', task);
    }
  }

  public getTask(id: string): BackgroundTask | undefined {
    return this.backgroundTasks.get(id);
  }

  public getTasks(): BackgroundTask[] {
    return Array.from(this.backgroundTasks.values());
  }

  public removeTask(id: string): void {
    this.backgroundTasks.delete(id);
    this.emit('taskRemoved', id);
  }

  // Resource Monitoring
  public startResourceMonitoring(interval: number = 5000): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.updateInterval = setInterval(() => {
      this.updateResourceUsage();
    }, interval);

    this.updateResourceUsage();
  }

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

  public getResourceUsage(): ResourceUsage | null {
    return this.resourceUsage;
  }

  // Memory Management
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