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

interface TerminalContainerProps {
  activeFile?: string;
  port: number;
}

export const TerminalContainer: React.FC<TerminalContainerProps> = ({ activeFile, port }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [terminalServer] = useState(() => new TerminalServer(port));
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
    terminalManager.on('connected', () => setIsConnected(true));
    terminalManager.on('disconnected', () => setIsConnected(false));
    terminalManager.connect();

    return () => {
      terminalManager.disconnect();
    };
  }, [terminalManager]);

  const handleTerminalData = (data: string) => {
    terminalManager.send(data);
  };

  const handleTerminalResize = (cols: number, rows: number) => {
    // TODO: Implement terminal resize handling
    console.log('Terminal resized:', { cols, rows });
  };

  return (
    <div className="terminal-wrapper">
      <Terminal onData={handleTerminalData} onResize={handleTerminalResize} />
      <StatusBar
        activeFile={activeFile}
        terminalPort={port}
        isTerminalConnected={isConnected}
      />
    </div>
  );
}; 