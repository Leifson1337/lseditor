import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { FiRotateCw, FiTrash2, FiX, FiFolder } from 'react-icons/fi';
import '@xterm/xterm/css/xterm.css';
import './TerminalPanel.css';

interface TerminalPanelProps {
  onClose: () => void;
  projectPath?: string;
}

interface TerminalCreateResponse {
  sessionId: string;
}

type TerminalStatus = 'idle' | 'connecting' | 'ready' | 'error' | 'closed';
type RendererIpc = {
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  send: (channel: string, ...args: any[]) => void;
  on: (channel: string, listener: (event: any, ...args: any[]) => void) => void;
  removeListener: (channel: string, listener: (...args: any[]) => void) => void;
};

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;

export const TerminalPanel: React.FC<TerminalPanelProps> = ({ onClose, projectPath }) => {
  const initialIpc: RendererIpc | null = window.electron && window.electron.ipcRenderer
    ? (window.electron.ipcRenderer as RendererIpc)
    : null;
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const ipcRef = useRef<RendererIpc | null>(initialIpc);
  const inputBufferRef = useRef('');

  const [status, setStatus] = useState<TerminalStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('Terminal wird gestartet ...');
  const [sessionNonce, setSessionNonce] = useState(0);

  const sanitizedProjectPath = useMemo(() => {
    if (!projectPath) {
      return undefined;
    }
    const trimmed = projectPath.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, [projectPath]);

  const handleClear = useCallback(() => {
    inputBufferRef.current = '';
    xtermRef.current?.clear();
    xtermRef.current?.focus();
  }, []);

  const requestRestart = useCallback(() => {
    setSessionNonce(value => value + 1);
  }, []);

  const displayPath = sanitizedProjectPath ?? 'App-Verzeichnis';
  const canOpenFolder = Boolean(sanitizedProjectPath);

  useEffect(() => {
    const ipc = window.electron?.ipcRenderer ?? null;
    ipcRef.current = ipc;
    if (!ipc) {
      console.error('IPC renderer not available - terminal cannot start');
      setStatus('error');
      setStatusMessage('IPC nicht verfügbar');
      return;
    }

    if (!containerRef.current) {
      console.error('Terminal container not mounted');
      setStatus('error');
      setStatusMessage('Kein Terminal-Container');
      return;
    }

    const xterm = new XTerm({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: 'Consolas, DejaVu Sans Mono, monospace',
      fontSize: 14,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#ffffff'
      }
    });

    const fitAddon = new FitAddon();
    const unicodeAddon = new Unicode11Addon();

    xterm.loadAddon(fitAddon);
    xterm.loadAddon(unicodeAddon);
    xterm.loadAddon(new WebLinksAddon());
    xterm.loadAddon(new SearchAddon());
    unicodeAddon.activate(xterm);

    xterm.open(containerRef.current);
    fitAddon.fit();

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    const handleResize = () => {
      if (!xtermRef.current || !fitAddonRef.current) {
        return;
      }
      fitAddonRef.current.fit();
      if (sessionIdRef.current) {
        ipc.send('terminal:resize', {
          sessionId: sessionIdRef.current,
          cols: xtermRef.current.cols,
          rows: xtermRef.current.rows
        });
      }
    };

    const handleUserInput = (chunk: string) => {
      if (!sessionIdRef.current || !ipc || !xtermRef.current) {
        return;
      }
      const term = xtermRef.current;
      let sendImmediate = '';
      const pendingLines: string[] = [];

      for (const char of chunk) {
        if (char === '\u0003') {
          inputBufferRef.current = '';
          sendImmediate += char;
          term.write('^C\r\n');
          continue;
        }

        if (char === '\u007f') {
          if (inputBufferRef.current.length > 0) {
            inputBufferRef.current = inputBufferRef.current.slice(0, -1);
            term.write('\b \b');
          }
          continue;
        }

        if (char === '\r' || char === '\n') {
          const line = inputBufferRef.current;
          const trimmed = line.trim().toLowerCase();
          if (trimmed === 'cls' || trimmed === 'clear') {
            term.clear();
          }
          inputBufferRef.current = '';
          term.write('\r\n');
          pendingLines.push(line);
          continue;
        }

        if (char === '\t') {
          inputBufferRef.current += '\t';
          term.write('\t');
          continue;
        }

        if (char >= ' ' && char <= '~') {
          inputBufferRef.current += char;
          term.write(char);
          continue;
        }
      }

      if (!sendImmediate && pendingLines.length === 0) {
        return;
      }

      const normalized = `${sendImmediate}${pendingLines.map(line => `${line}\r\n`).join('')}`;
      ipc.send('terminal:write', {
        sessionId: sessionIdRef.current,
        data: normalized
      });
    };

    const dataDisposable = xterm.onData(chunk => {
      if (!chunk) {
        return;
      }
      handleUserInput(chunk);
    });

    const handleTerminalData = (_event: unknown, payload: { sessionId: string; data: string }) => {
      if (payload.sessionId === sessionIdRef.current) {
        xterm.write(payload.data);
      }
    };

    const handleTerminalExit = (_event: unknown, payload: { sessionId: string; exitCode: number }) => {
      if (payload.sessionId === sessionIdRef.current) {
        xterm.writeln('');
        xterm.writeln(`\x1b[31mProzess beendet (Code ${payload.exitCode}).\x1b[0m`);
        setStatus('closed');
        setStatusMessage('Terminalprozess beendet');
        sessionIdRef.current = null;
      }
    };

    const handleTerminalError = (_event: unknown, payload: { sessionId: string | null; message: string }) => {
      if (!payload.sessionId || payload.sessionId === sessionIdRef.current) {
        xterm.writeln('');
        xterm.writeln(`\x1b[31m${payload.message}\x1b[0m`);
        setStatus('error');
        setStatusMessage(payload.message);
      }
    };

    ipc.on('terminal:data', handleTerminalData);
    ipc.on('terminal:exit', handleTerminalExit);
    ipc.on('terminal:error', handleTerminalError);
    window.addEventListener('resize', handleResize);

    const startSession = async () => {
      setStatus('connecting');
      setStatusMessage('Starte Terminal ...');
      try {
        let cwdToUse = sanitizedProjectPath;
        if (cwdToUse) {
          const exists = await ipc.invoke('fs:checkPathExists', cwdToUse);
          if (!exists) {
            xterm.writeln(`\x1b[33mHinweis: ${cwdToUse} nicht gefunden. Verwende Standardpfad.\x1b[0m`);
            cwdToUse = undefined;
          }
        }

        const isWindows = typeof process !== 'undefined' && process.platform === 'win32';
        const preferredShell = isWindows ? 'cmd.exe' : undefined;

        const cols = xterm.cols || DEFAULT_COLS;
        const rows = xterm.rows || DEFAULT_ROWS;

        const response = (await ipc.invoke('terminal:create', {
          cols,
          rows,
          cwd: cwdToUse,
          shell: preferredShell
        })) as TerminalCreateResponse;

        sessionIdRef.current = response.sessionId;
        setStatus('ready');
        setStatusMessage(cwdToUse ? `Verbunden mit ${cwdToUse}` : 'Verbunden');
        xterm.focus();
      } catch (error) {
        console.error('Failed to create terminal session:', error);
        const message = error instanceof Error ? error.message : String(error);
        xterm.writeln(`\x1b[31mFehler beim Starten des Terminals:\x1b[0m ${message}`);
        setStatus('error');
        setStatusMessage('Terminal konnte nicht gestartet werden');
      }
    };

    startSession();

    return () => {
      window.removeEventListener('resize', handleResize);
      dataDisposable.dispose();
      ipc.removeListener('terminal:data', handleTerminalData);
      ipc.removeListener('terminal:exit', handleTerminalExit);
      ipc.removeListener('terminal:error', handleTerminalError);

      if (sessionIdRef.current) {
        ipc
          .invoke('terminal:dispose', { sessionId: sessionIdRef.current })
          .catch(err => console.error('Failed to dispose terminal session:', err));
        sessionIdRef.current = null;
      }

      xterm.dispose();
      fitAddon.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      inputBufferRef.current = '';
      setStatus('idle');
      setStatusMessage('Terminal geschlossen');
    };
  }, [sanitizedProjectPath, sessionNonce]);

  const sendCommandToShell = useCallback((command: string) => {
    const ipc = ipcRef.current;
    if (!ipc || !sessionIdRef.current) {
      return false;
    }
    ipc.send('terminal:write', {
      sessionId: sessionIdRef.current,
      data: `${command}\r`
    });
    return true;
  }, []);

  const buildRunCommand = useCallback((targetPath: string) => {
    if (!targetPath) return '';
    const ext = targetPath.split('.').pop()?.toLowerCase();
    const quoted = `"${targetPath}"`;
    switch (ext) {
      case 'js':
      case 'cjs':
      case 'mjs':
        return `node ${quoted}`;
      case 'ts':
      case 'tsx':
        return `npx ts-node ${quoted}`;
      case 'py':
        return `python ${quoted}`;
      case 'sh':
        return `bash ${quoted}`;
      case 'ps1':
        return `powershell -ExecutionPolicy Bypass -File ${quoted}`;
      default:
        return quoted;
    }
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ type: string; payload?: any }>).detail;
      if (!detail) return;
      switch (detail.type) {
        case 'newTerminal':
          requestRestart();
          break;
        case 'runActiveFile':
          if (detail.payload?.path) {
            const command = buildRunCommand(detail.payload.path);
            if (command && sendCommandToShell(command)) {
              setStatusMessage(`Starte ${detail.payload.path}`);
            } else {
              setStatusMessage('Konnte Befehl nicht ausführen.');
            }
          }
          break;
        case 'showInfo':
          setStatusMessage(detail.payload?.message ?? '');
          break;
        default:
          break;
      }
    };
    window.addEventListener('terminal:action', handler as EventListener);
    return () => window.removeEventListener('terminal:action', handler as EventListener);
  }, [buildRunCommand, requestRestart, sendCommandToShell]);

  const handleOpenFolder = useCallback(async () => {
    if (!sanitizedProjectPath || !ipcRef.current?.invoke) {
      return;
    }
    try {
      await ipcRef.current.invoke('shell:openPath', sanitizedProjectPath);
    } catch (error) {
      console.error('Failed to open folder in explorer:', error);
    }
  }, [sanitizedProjectPath]);

  const handleCloseClick = useCallback(() => {
    onClose();
  }, [onClose]);

  const statusDotClass = `terminal-status-dot terminal-status-${status}`;

  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <div className="terminal-title">
          <span className={statusDotClass} />
          <div className="terminal-title-text">
            <span className="terminal-title-main">Terminal</span>
            <span className="terminal-title-path" title={displayPath}>
              {displayPath}
            </span>
          </div>
        </div>
        <div className="terminal-actions">
          <span className="terminal-status-message">{statusMessage}</span>
          <button
            type="button"
            className="terminal-button subtle"
            onClick={handleOpenFolder}
            disabled={!canOpenFolder}
            title="Ordner im Explorer öffnen"
          >
            <FiFolder />
            Ordner
          </button>
          <button
            type="button"
            className="terminal-button subtle"
            onClick={handleClear}
            title="Terminal-Ausgabe löschen"
          >
            <FiTrash2 />
            Clear
          </button>
          <button
            type="button"
            className="terminal-button subtle"
            onClick={requestRestart}
            title="Terminal neu starten"
          >
            <FiRotateCw />
            Neu
          </button>
          <button
            type="button"
            className="terminal-button danger"
            onClick={handleCloseClick}
            title="Terminal schließen"
          >
            <FiX />
            Schließen
          </button>
        </div>
      </div>
      <div ref={containerRef} className="terminal-container" />
    </div>
  );
};

export default TerminalPanel;
