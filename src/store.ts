export class Store {
  private state: Map<string, any> = new Map();

  constructor() {
    // Initialize with default state
    this.state.set('theme', 'dark');
    this.state.set('fontSize', 14);
    this.state.set('fontFamily', 'Consolas, monospace');
  }

  get<T>(key: string): T | undefined {
    return this.state.get(key);
  }

  set<T>(key: string, value: T): void {
    this.state.set(key, value);
  }

  delete(key: string): void {
    this.state.delete(key);
  }

  clear(): void {
    this.state.clear();
  }

  dispose(): void {
    this.clear();
  }
} 