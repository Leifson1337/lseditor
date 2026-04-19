// store.ts
// Zustand store for managing global application state and ElectronStore for persisting data.

// import ElectronStore from 'electron-store';
// ElectronStore darf NICHT im Renderer (React) verwendet werden!
// For persistent data in the renderer, use localStorage or IPC to main.ts instead.

// Dummy export so the import does not crash
export default {};

import { ProjectService } from '../services/ProjectService';
import { UIService } from '../services/UIService';
import { AIService } from '../services/AIService';
import { AIConfig } from '../types/AITypes';

/**
 * StoreSchema defines the shape of the persisted data managed by ElectronStore.
 */
export interface StoreSchema {
  lastProjectPath?: string; // Path to the last opened project
  theme: string; // Current theme (e.g., 'dark' or 'light')
  fontSize: number; // Font size for the application
  fontFamily: string; // Font family for the application
  terminal: {
    fontSize: number; // Font size for the terminal
    fontFamily: string; // Font family for the terminal
    port: number; // Port number for the terminal
    defaultProfile: string; // Default profile for the terminal
  };
  editor: {
    fontSize: number; // Font size for the editor
    fontFamily: string; // Font family for the editor
    wordWrap: boolean; // Whether word wrap is enabled for the editor
    minimap: boolean; // Whether the minimap is enabled for the editor
    lineNumbers: boolean; // Whether line numbers are enabled for the editor
    content?: string; // Content of the editor
  };
}

/**
 * AppServices defines the shape of the application services.
 */
export interface AppServices {
  projectService: ProjectService; // Service for managing projects
  uiService: UIService; // Service for managing UI-related tasks
  aiService: AIService; // Service for managing AI-related tasks
}

/**
 * AppStore is a class that manages the application state and services.
 */
class AppStore implements AppServices {
  private storageKey = 'lseditor.store';
  projectService: ProjectService; // Project service instance
  uiService: UIService; // UI service instance
  aiService: AIService; // AI service instance

  /**
   * Constructor for AppStore.
   */
  constructor() {
    // Initialize services with default workspace path
    const defaultWorkspacePath = this.readPersistedState().lastProjectPath || process.cwd();
    this.projectService = new ProjectService(defaultWorkspacePath);
    this.uiService = new UIService();
    
    // Initialize AIService with default config
    const defaultAIConfig: AIConfig = {
      useLocalModel: false,
      openAIConfig: {
        apiKey: process.env.OPENAI_API_KEY || '',
        model: 'gpt-3.5-turbo',
        temperature: 0.7,
        maxTokens: 1000
      },
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 1000,
      contextWindow: 2048,
      stopSequences: [],
      topP: 1
    };
    this.aiService = AIService.getInstance(defaultAIConfig);
  }

  /**
   * Get a value from the persisted data.
   * @param key Key of the value to retrieve.
   * @returns The retrieved value.
   */
  get<T extends keyof StoreSchema>(key: T): StoreSchema[T] {
    const state = this.readPersistedState();
    return state[key] as StoreSchema[T];
  }

  /**
   * Set a value in the persisted data.
   * @param key Key of the value to set.
   * @param value Value to set.
   */
  set<T extends keyof StoreSchema>(key: T, value: StoreSchema[T]): void {
    const state = this.readPersistedState();
    state[key] = value;
    this.writePersistedState(state);
  }

  /**
   * Delete a value from the persisted data.
   * @param key Key of the value to delete.
   */
  delete<T extends keyof StoreSchema>(key: T): void {
    const state = this.readPersistedState();
    delete state[key];
    this.writePersistedState(state);
  }

  /**
   * Clear all persisted data.
   */
  clear(): void {
    this.writePersistedState({});
  }

  private readPersistedState(): Partial<StoreSchema> {
    if (typeof window === 'undefined' || !window.localStorage) {
      return {};
    }

    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) {
        return {};
      }

      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch (error) {
      console.warn('Failed to read persisted app state:', error);
      return {};
    }
  }

  private writePersistedState(state: Partial<StoreSchema>): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(state));
    } catch (error) {
      console.warn('Failed to persist app state:', error);
    }
  }
}

/**
 * Create an instance of AppStore.
 */
export const store = new AppStore(); 
