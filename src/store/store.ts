// store.ts
// Zustand store for managing global application state and ElectronStore for persisting data.

// import ElectronStore from 'electron-store';
// ElectronStore darf NICHT im Renderer (React) verwendet werden!
// Wenn du persistente Daten im Renderer brauchst, nutze stattdessen localStorage oder IPC zu main.ts.

// Dummy-Export, damit der Import nicht mehr crasht
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
  ai: {
    model: string; // Selected AI model (e.g., 'gpt-4', 'gpt-3.5-turbo')
    temperature: number; // Temperature setting for AI responses
    maxTokens: number; // Maximum tokens for AI responses
  };
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
  private electronStore: any; // ElectronStore instance for persisting data
  projectService: ProjectService; // Project service instance
  uiService: UIService; // UI service instance
  aiService: AIService; // AI service instance

  /**
   * Constructor for AppStore.
   */
  constructor() {
    // Initialize ElectronStore with the schema
    // this.electronStore = new ElectronStore<StoreSchema>({
    //   schema: {
    //     lastProjectPath: {
    //       type: 'string',
    //       default: ''
    //     },
    //     theme: {
    //       type: 'string',
    //       default: 'dark'
    //     },
    //     fontSize: {
    //       type: 'number',
    //       default: 14
    //     },
    //     fontFamily: {
    //       type: 'string',
    //       default: 'monospace'
    //     },
    //     ai: {
    //       type: 'object',
    //       properties: {
    //         model: {
    //           type: 'string',
    //           default: 'gpt-4'
    //         },
    //         temperature: {
    //           type: 'number',
    //           default: 0.7,
    //           minimum: 0,
    //           maximum: 2
    //         },
    //         maxTokens: {
    //           type: 'number',
    //           default: 2048,
    //           minimum: 1,
    //           maximum: 4096
    //         }
    //       },
    //       default: {
    //         model: 'gpt-4',
    //         temperature: 0.7,
    //         maxTokens: 2048
    //       }
    //     },
    //     terminal: {
    //       type: 'object',
    //       properties: {
    //         fontSize: {
    //           type: 'number',
    //           default: 14
    //         },
    //         fontFamily: {
    //           type: 'string',
    //           default: 'monospace'
    //         },
    //         port: {
    //           type: 'number',
    //           default: 8080
    //         },
    //         defaultProfile: {
    //           type: 'string',
    //           default: 'default'
    //         }
    //       }
    //     },
    //     editor: {
    //       type: 'object',
    //       properties: {
    //         fontSize: {
    //           type: 'number',
    //           default: 14
    //         },
    //         fontFamily: {
    //           type: 'string',
    //           default: 'monospace'
    //         },
    //         wordWrap: {
    //           type: 'boolean',
    //           default: false
    //         },
    //         minimap: {
    //           type: 'boolean',
    //           default: true
    //         },
    //         lineNumbers: {
    //           type: 'boolean',
    //           default: true
    //         },
    //         content: {
    //           type: 'string',
    //           default: ''
    //         }
    //       }
    //     }
    //   }
    // });

    // Initialize services with default workspace path
    const defaultWorkspacePath = process.cwd();
    this.projectService = new ProjectService(defaultWorkspacePath);
    this.uiService = new UIService();
    
    // Initialize AIService with default config or stored config
    const storedAISettings = this.get('ai') as { model: string; temperature: number; maxTokens: number } | undefined;
    const defaultAIConfig: AIConfig = {
      useLocalModel: false,
      openAIConfig: {
        apiKey: process.env.OPENAI_API_KEY || '',
        model: storedAISettings?.model || 'gpt-4',
        temperature: storedAISettings?.temperature ?? 0.7,
        maxTokens: storedAISettings?.maxTokens ?? 2048
      },
      model: storedAISettings?.model || 'gpt-4',
      temperature: storedAISettings?.temperature ?? 0.7,
      maxTokens: storedAISettings?.maxTokens ?? 2048,
      contextWindow: 4096,
      stopSequences: ['\n\n', '```'],
      topP: 1,
      systemPrompt: 'You are an AI coding assistant. When providing code changes, you can specify line numbers using the z//<line-number> syntax at the start of a code block. For example:\n\n```\nz//10\nconst example = "This will replace line 10";\n```\n\nYou can also specify line ranges with z//<start-line>-<end-line> to replace multiple lines. If no line number is specified, the code will be appended to the end of the file.'
    };
    
    // If no AI settings exist in store, save the defaults
    if (!storedAISettings) {
      this.set('ai', {
        model: defaultAIConfig.model,
        temperature: defaultAIConfig.temperature,
        maxTokens: defaultAIConfig.maxTokens
      });
    }
    
    this.aiService = AIService.getInstance(defaultAIConfig);
  }

  /**
   * Get a value from the persisted data.
   * @param key Key of the value to retrieve.
   * @returns The retrieved value.
   */
  get<T extends keyof StoreSchema>(key: T): StoreSchema[T] {
    // return this.electronStore.get(key);
    return undefined as any;
  }

  /**
   * Set a value in the persisted data.
   * @param key Key of the value to set.
   * @param value Value to set.
   */
  set<T extends keyof StoreSchema>(key: T, value: StoreSchema[T]): void {
    // this.electronStore.set(key, value);
    return;
  }

  /**
   * Delete a value from the persisted data.
   * @param key Key of the value to delete.
   */
  delete<T extends keyof StoreSchema>(key: T): void {
    // this.electronStore.delete(key);
    return;
  }

  /**
   * Clear all persisted data.
   */
  clear(): void {
    // this.electronStore.clear();
    return;
  }
}

/**
 * Create an instance of AppStore.
 */
export const store = new AppStore(); 