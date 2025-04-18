// import ElectronStore from 'electron-store';
// ElectronStore darf NICHT im Renderer (React) verwendet werden!
// Wenn du persistente Daten im Renderer brauchst, nutze stattdessen localStorage oder IPC zu main.ts.

// Dummy-Export, damit der Import nicht mehr crasht
export default {};

import { ProjectService } from '../services/ProjectService';
import { UIService } from '../services/UIService';
import { AIService } from '../services/AIService';
import { AIConfig } from '../types/AITypes';

export interface StoreSchema {
  lastProjectPath?: string;
  theme: string;
  fontSize: number;
  fontFamily: string;
  terminal: {
    fontSize: number;
    fontFamily: string;
    port: number;
    defaultProfile: string;
  };
  editor: {
    fontSize: number;
    fontFamily: string;
    wordWrap: boolean;
    minimap: boolean;
    lineNumbers: boolean;
    content?: string;
  };
}

export interface AppServices {
  projectService: ProjectService;
  uiService: UIService;
  aiService: AIService;
}

class AppStore implements AppServices {
  private electronStore: any;
  projectService: ProjectService;
  uiService: UIService;
  aiService: AIService;

  constructor() {
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

  get<T extends keyof StoreSchema>(key: T): StoreSchema[T] {
    // return this.electronStore.get(key);
    return undefined as any;
  }

  set<T extends keyof StoreSchema>(key: T, value: StoreSchema[T]): void {
    // this.electronStore.set(key, value);
    return;
  }

  delete<T extends keyof StoreSchema>(key: T): void {
    // this.electronStore.delete(key);
    return;
  }

  clear(): void {
    // this.electronStore.clear();
    return;
  }
}

export const store = new AppStore(); 