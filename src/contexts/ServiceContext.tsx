import React, { createContext, useContext, ReactNode } from 'react';
import { AIService } from '../services/AIService';
import { ProjectService } from '../services/ProjectService';
import { TerminalManager } from '../services/TerminalManager';
import { TerminalService } from '../services/TerminalService';
import { UIService } from '../services/UIService';
import { Store } from '../store/store'; // Assuming this is the correct path to your Store type/class

export interface ServiceContextType {
  aiService: AIService | null;
  projectService: ProjectService | null;
  terminalManager: TerminalManager | null;
  terminalService: TerminalService | null;
  uiService: UIService | null;
  store: Store | null; // Or typeof store if it's an instance with a specific type
  pluginService?: PluginService | null; 
  commandService?: CommandService | null; 
  viewService?: ViewService | null; 
  providerService?: ProviderService | null; // Added ProviderService
}

export const ServiceContext = createContext<ServiceContextType | undefined>(undefined);

export const useServices = (): ServiceContextType => {
  const context = useContext(ServiceContext);
  if (!context) {
    throw new Error('useServices must be used within a ServiceProvider');
  }
  return context;
};

interface ServiceProviderProps {
  children: ReactNode;
  value: ServiceContextType;
}

export const ServiceProvider: React.FC<ServiceProviderProps> = ({ children, value }) => {
  return <ServiceContext.Provider value={value}>{children}</ServiceContext.Provider>;
};
