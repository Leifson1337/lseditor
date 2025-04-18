import ElectronStore from 'electron-store';

export interface StoreSchema {
  theme: string;
  fontSize: number;
  fontFamily: string;
  terminal: {
    port: number;
    defaultProfile: string;
  };
  editor: {
    wordWrap: boolean;
    minimap: boolean;
    lineNumbers: boolean;
    content?: string;
  };
  lastProjectPath?: string;
}

class AppStore {
  private store: ElectronStore<StoreSchema>;

  constructor() {
    this.store = new ElectronStore<StoreSchema>({
      schema: {
        theme: {
          type: 'string',
          default: 'dark'
        },
        fontSize: {
          type: 'number',
          default: 14
        },
        fontFamily: {
          type: 'string',
          default: 'Consolas, monospace'
        },
        terminal: {
          type: 'object',
          properties: {
            port: {
              type: 'number',
              default: 3001
            },
            defaultProfile: {
              type: 'string',
              default: 'default'
            }
          }
        },
        editor: {
          type: 'object',
          properties: {
            wordWrap: {
              type: 'boolean',
              default: true
            },
            minimap: {
              type: 'boolean',
              default: true
            },
            lineNumbers: {
              type: 'boolean',
              default: true
            },
            content: {
              type: 'string',
              default: ''
            }
          }
        },
        lastProjectPath: {
          type: 'string',
          default: ''
        }
      }
    });
  }

  get<T extends keyof StoreSchema>(key: T): StoreSchema[T] {
    return this.store.get(key);
  }

  set<T extends keyof StoreSchema>(key: T, value: StoreSchema[T]): void {
    this.store.set(key, value);
  }

  delete<T extends keyof StoreSchema>(key: T): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

// Create a singleton instance
const store = new AppStore();

// Export both the class and the singleton instance
export { AppStore, store }; 