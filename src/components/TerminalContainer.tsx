import React, { useEffect, useState } from 'react';
import { Terminal } from './Terminal';
import StatusBar from './StatusBar';
import { TerminalManager } from '../services/TerminalManager';
import { TerminalService } from '../services/TerminalService';
import { AIService } from '../services/AIService';
import { ProjectService } from '../services/ProjectService';
import { UIService } from '../services/UIService';
import { store } from '../store/store';
import { TerminalServer } from '../server/terminalServer';
import '../styles/Terminal.css';
import { AIConfig } from '../types/AITypes';

interface TerminalContainerProps {
  activeFile?: string;
  port: number;
}

export const TerminalContainer: React.FC<TerminalContainerProps> = ({ activeFile, port }) => {
  console.log('TerminalContainer rendering with initial port:', port);
  const [isConnected, setIsConnected] = useState(false);
  const [currentPort, setCurrentPort] = useState(port);
  const [terminalServer] = useState(() => {
    console.log('Creating TerminalServer instance');
    return new TerminalServer(port);
  });
  const [uiService] = useState(() => new UIService());
  const [projectService] = useState(() => new ProjectService(process.cwd()));
  const [aiService] = useState(() => AIService.getInstance({
    useLocalModel: false,
    model: 'gpt-3.5-turbo',
    temperature: 0.7,
    maxTokens: 2048,
    contextWindow: 4096,
    stopSequences: ['\n\n', '```'],
    topP: 1,
    openAIConfig: {
      apiKey: process.env.OPENAI_API_KEY || '',
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 2048
    }
  }));
  const [terminalService] = useState(() => new TerminalService(
    null,
    aiService,
    projectService,
    uiService,
    terminalServer,
    store
  ));
  const [terminalManager] = useState(() => new TerminalManager(
    port,
    terminalService,
    aiService,
    projectService,
    uiService
  ));

  useEffect(() => {
    console.log('TerminalContainer mounted');
    setCurrentPort(terminalManager.getPort());
    
    terminalManager.on('connected', () => {
      console.log('Terminal connected');
      setIsConnected(true);
    });
    
    terminalManager.on('disconnected', () => {
      console.log('Terminal disconnected');
      setIsConnected(false);
    });
    
    terminalManager.connect();

    return () => {
      console.log('TerminalContainer unmounting');
      terminalManager.disconnect();
    };
  }, [terminalManager]);

  const handleTerminalData = (data: string) => {
    console.log('Sending terminal data:', data);
    terminalManager.send(data);
  };

  const handleTerminalResize = (cols: number, rows: number) => {
    console.log('Terminal resized:', { cols, rows });
  };

  return (
    <div className="terminal-wrapper">
      <Terminal onData={handleTerminalData} onResize={handleTerminalResize} />
      <StatusBar
        activeFile={activeFile}
        terminalPort={currentPort}
        isTerminalConnected={isConnected}
      />
    </div>
  );
}; 