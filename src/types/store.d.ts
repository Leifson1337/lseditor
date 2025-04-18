declare module '../store/store' {
  interface StoreSchema {
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
    };
  }

  export class AppStore {
    constructor();
    get<T extends keyof StoreSchema>(key: T): StoreSchema[T];
    set<T extends keyof StoreSchema>(key: T, value: StoreSchema[T]): void;
    delete<T extends keyof StoreSchema>(key: T): void;
    clear(): void;
  }

  export const store: AppStore;
} 