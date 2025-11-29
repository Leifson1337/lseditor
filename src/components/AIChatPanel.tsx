import React, { useEffect, useMemo, useState, useCallback } from 'react';
import path from 'path';
import { FiRefreshCw, FiSend, FiPlus } from 'react-icons/fi';
import { diffLines } from 'diff';
import { LuLoader2 } from 'react-icons/lu';
import './AIChatPanel.css';
import { useAI } from '../contexts/AIContext';
import { FileNode } from '../types/FileNode';
import { marked } from 'marked';

marked.setOptions({ breaks: true });
interface AIChatPanelProps {
  fileStructure: FileNode[];
  projectPath?: string;
  activeFilePath?: string;
  openFiles: string[];
}

const AUTO_CONTEXT_KEY = 'lseditor.ai.autoContext';
const MAX_CONTEXT_FILES = 5;
const MAX_FILE_LIST_ENTRIES = 400;
const MAX_FILE_LIST_CHAR_LENGTH = 4000;
const MAX_SNIPPET_LENGTH = 2000;
const MAX_TOTAL_SNIPPET_LENGTH = 8000;

type FileEditAction = 'create' | 'update' | 'delete';

interface ParsedFileEdit {
  path: string;
  action: FileEditAction;
  content?: string;
  reason?: string;
}

interface PendingFileEdit extends ParsedFileEdit {
  id: string;
  absolutePath: string;
  displayPath: string;
  originalContent: string;
  newContent: string;
}

const createLocalId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const normalizeRelativePath = (filePath?: string, projectPath?: string) => {
  if (!filePath) return '';
  if (projectPath) {
    const relative = path.relative(projectPath, filePath);
    if (relative && relative !== filePath) {
      return relative.replace(/\\/g, '/');
    }
  }
  return filePath.replace(/\\/g, '/');
};

const flattenFiles = (nodes: FileNode[], projectPath?: string) => {
  const result: Array<{ relative: string; absolute: string; type: FileNode['type'] }> = [];

  const visit = (node: FileNode) => {
    const absolute = node.path || node.name;
    const relative = normalizeRelativePath(absolute, projectPath) || node.name;
    result.push({ relative, absolute, type: node.type });
    if (node.children) {
      node.children.forEach(visit);
    }
  };

  nodes.forEach(visit);
  return result;
};

const tryParseJsonArray = (text: string) => {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  try {
    const snippet = text.slice(start, end + 1);
    const parsed = JSON.parse(snippet);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const truncateContent = (content: string) => {
  if (content.length <= MAX_SNIPPET_LENGTH) {
    return content;
  }
  return `${content.slice(0, MAX_SNIPPET_LENGTH)}\n... (gekürzt)`;
};

interface PatchBlock {
  path: string;
  oldContent: string;
  newContent: string;
}

const extractPatchBlocks = (content?: string): PatchBlock[] => {
  if (!content || !content.includes('***PATCH')) {
    return [];
  }

  const normalizedContent = content.replace(/\r\n/g, '\n');
  const regex =
    /\*\*\*PATCH[^\S\n]*([^\n]+)\n\*\*\*\s*OLD:\n([\s\S]*?)\n\*\*\*\s*NEW:\n([\s\S]*?)(?=(?:\n\*\*\*PATCH|\s*$))/g;
  const blocks: PatchBlock[] = [];
  let result: RegExpExecArray | null;

  while ((result = regex.exec(normalizedContent)) !== null) {
    const rawPath = result[1]?.trim();
    if (!rawPath || rawPath.toUpperCase() === 'NONE') {
      continue;
    }

    blocks.push({
      path: rawPath,
      oldContent: result[2]?.replace(/\r/g, '') ?? '',
      newContent: result[3]?.replace(/\r/g, '') ?? ''
    });
  }

  return blocks;
};

const AIChatPanel: React.FC<AIChatPanelProps> = ({ fileStructure, projectPath, activeFilePath, openFiles }) => {
  const {
    conversations,
    activeConversationId,
    setActiveConversation,
    startNewConversation,
    removeConversation,
    sendMessage,
    cancelRequest,
    isThinking,
    isCancelling,
    settings,
    updateSettings,
    models,
    refreshModels,
    isFetchingModels,
    lastError,
    connectionStatus
  } = useAI();

  const activeConversation = useMemo(
    () => conversations.find(conv => conv.id === activeConversationId),
    [conversations, activeConversationId]
  );
  const messages = activeConversation?.messages ?? [];

  const [input, setInput] = useState('');
  const [autoContextEnabled, setAutoContextEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(AUTO_CONTEXT_KEY) === 'true';
  });
  const [autoContextStatus, setAutoContextStatus] = useState('');
  const [isAutoContextBusy, setIsAutoContextBusy] = useState(false);
  const [pendingEdits, setPendingEdits] = useState<PendingFileEdit[]>([]);
  const [selectedEditId, setSelectedEditId] = useState<string | null>(null);
  const [lastParsedMessageId, setLastParsedMessageId] = useState<string | null>(null);

  const ensureAbsolutePath = useMemo(() => {
    const resolveBaseDirectory = () => {
      if (projectPath) {
        if (path.isAbsolute(projectPath)) {
          return projectPath;
        }
        if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
          return path.resolve(process.cwd(), projectPath);
        }
        return path.resolve(projectPath);
      }
      if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
        return process.cwd();
      }
      return '';
    };

    const baseDirectory = resolveBaseDirectory();

    return (targetPath: string) => {
      const normalized = targetPath.replace(/\\/g, '/').trim();
      if (!normalized) {
        return baseDirectory;
      }
      if (path.isAbsolute(normalized)) {
        return path.normalize(normalized);
      }
      if (!baseDirectory) {
        return path.normalize(normalized);
      }
      return path.normalize(path.join(baseDirectory, normalized));
    };
  }, [projectPath]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(AUTO_CONTEXT_KEY, String(autoContextEnabled));
    }
  }, [autoContextEnabled]);

  const flattenedFiles = useMemo(
    () => flattenFiles(fileStructure, projectPath),
    [fileStructure, projectPath]
  );
  const availableFiles = useMemo(() => {
    const files = flattenedFiles.filter(entry => entry.type === 'file').map(entry => entry.relative);
    const trimmed: string[] = [];
    let totalChars = 0;
    for (const relative of files) {
      if (trimmed.length >= MAX_FILE_LIST_ENTRIES) break;
      const newTotal = totalChars + relative.length + 2;
      if (newTotal > MAX_FILE_LIST_CHAR_LENGTH) break;
      trimmed.push(relative);
      totalChars = newTotal;
    }
    return trimmed;
  }, [flattenedFiles]);
  const fileMap = useMemo(() => {
    const map = new Map<string, string>();
    flattenedFiles.forEach(entry => {
      map.set(entry.relative, entry.absolute);
    });
    return map;
  }, [flattenedFiles]);

  const activeRelativePath = useMemo(
    () => normalizeRelativePath(activeFilePath, projectPath),
    [activeFilePath, projectPath]
  );

  const openRelativeFiles = useMemo(() => {
    const list = openFiles
      .map(file => normalizeRelativePath(file, projectPath))
      .filter(Boolean);
    return Array.from(new Set(list));
  }, [openFiles, projectPath]);

  const parseFileEditsFromMessage = useCallback(
    async (messageContent?: string) => {
      const patchBlocks = extractPatchBlocks(messageContent);
      if (!patchBlocks.length) {
        return;
      }

      const prepared: PendingFileEdit[] = [];
      for (const block of patchBlocks) {
        if (!block.path) continue;

        const absolutePath = ensureAbsolutePath(block.path);
        const displayPath = normalizeRelativePath(absolutePath, projectPath);
        const rawOld = block.oldContent ?? '';
        const rawNew = block.newContent ?? '';

        const hasOldContent = rawOld.length > 0;
        const hasNewContent = rawNew.length > 0;

        let action: FileEditAction = 'update';
        if (!hasOldContent && hasNewContent) {
          action = 'create';
        } else if (hasOldContent && !hasNewContent) {
          action = 'delete';
        }

        let originalContent = rawOld;
        if (action !== 'create') {
          try {
            const diskContent =
              (await window.electron?.ipcRenderer?.invoke('fs:readFile', absolutePath)) ?? '';
            if (typeof diskContent === 'string') {
              originalContent = diskContent;
            }
          } catch {
            // Ignore read errors and keep the provided OLD content for context
          }
        }

        prepared.push({
          id: createLocalId(),
          path: block.path,
          action,
          content: rawNew,
          reason: '',
          absolutePath,
          displayPath,
          originalContent,
          newContent: rawNew
        });

        window.dispatchEvent(new CustomEvent('editor:openFile', { detail: absolutePath }));
      }

      if (prepared.length) {
        setPendingEdits(prev => [...prev, ...prepared]);
      }
    },
    [ensureAbsolutePath, projectPath]
  );

  const connectionLabel = useMemo(() => {
    switch (connectionStatus) {
      case 'ready':
        return 'Verbunden';
      case 'connecting':
        return 'Verbindung wird aufgebaut…';
      case 'error':
        return 'Nicht verbunden';
      default:
        return 'Bereit';
    }
  }, [connectionStatus]);

  const selectedEdit = useMemo(
    () => pendingEdits.find(edit => edit.id === selectedEditId) ?? null,
    [pendingEdits, selectedEditId]
  );

  useEffect(() => {
    const latest = [...messages]
      .reverse()
      .find(message => message.sender === 'ai' && message.content?.includes('***PATCH'));
    if (!latest || latest.id === lastParsedMessageId) {
      return;
    }
    setLastParsedMessageId(latest.id);
    parseFileEditsFromMessage(latest.content);
  }, [messages, lastParsedMessageId, parseFileEditsFromMessage]);

  useEffect(() => {
    if (!pendingEdits.length) {
      if (selectedEditId !== null) {
        setSelectedEditId(null);
      }
      return;
    }
    if (!selectedEditId || !pendingEdits.some(edit => edit.id === selectedEditId)) {
      setSelectedEditId(pendingEdits[0].id);
    }
  }, [pendingEdits, selectedEditId]);

  const sendWithAutoContext = async (question: string) => {
    if (!autoContextEnabled || !availableFiles.length) {
      await sendMessage(question);
      return;
    }

    setIsAutoContextBusy(true);
    setAutoContextStatus('Fordere relevante Dateien an…');

    try {
      const preferredFiles = Array.from(new Set([activeRelativePath, ...openRelativeFiles].filter(Boolean)));
      const fileListSection = availableFiles.map(file => `- ${file}`).join('\n');

      const selectionPrompt = [
        'Du bist ein KI-Code-Assistent.',
        'Ich gebe dir eine Liste aller Projektdateien.',
        'Antworte JETZT ausschließlich mit einem JSON-Array (z.B. ["src/main.ts"]) mit maximal 5 Pfaden, die du für die Beantwortung der Frage benötigst.',
        'Wenn du keine Dateien brauchst, antworte mit [].',
        preferredFiles.length ? `Aktive/zuletzt geöffnete Dateien: ${preferredFiles.join(', ')}` : '',
        `Projektdateien:\n${fileListSection}`,
        `Frage: ${question}`
      ]
        .filter(Boolean)
        .join('\n\n');

      const selectionResponse = await sendMessage(question, { actualContent: selectionPrompt });
      if (!selectionResponse) {
        return;
      }

      const requestedFiles = (() => {
        const parsedJson = tryParseJsonArray(selectionResponse);
        const candidates = parsedJson ?? selectionResponse.split(/[\r\n,]+/);
        const normalized = candidates
          .map(item => (typeof item === 'string' ? item : ''))
          .map(item => item.replace(/["'`]/g, '').trim())
          .filter(Boolean)
          .map(item => item.replace(/^\.\/+/, ''))
          .map(item => item.replace(/\\/g, '/'));

        const set = new Set<string>();
        normalized.forEach(item => {
          if (availableFiles.includes(item)) {
            set.add(item);
          }
        });
        preferredFiles.forEach(item => {
          if (item) set.add(item);
        });
        return Array.from(set).slice(0, MAX_CONTEXT_FILES);
      })();

      if (!requestedFiles.length) {
        await sendMessage('Auto Context → keine Dateien angefordert', {
          actualContent: `Es wurden keine Dateien benötigt. Bitte beantworte die Frage: ${question}`,
          displayContent: 'Auto Context → keine Dateien angefordert'
        });
        return;
      }

      setAutoContextStatus(`Übertrage ${requestedFiles.length} Datei(en)…`);

      const sections: string[] = [];
      const accessibleFileNotes: string[] = [];
      let accumulated = 0;
      for (const relativePath of requestedFiles) {
        const absolutePath = fileMap.get(relativePath) ?? relativePath;
        try {
          const content = await window.electron?.ipcRenderer?.invoke('fs:readFile', absolutePath);
          if (typeof content === 'string') {
            accessibleFileNotes.push(`- ${relativePath} (${absolutePath})`);
            const snippet = content.length > 0 ? truncateContent(content) : '(leer)';
            const section = `### ${relativePath}\n\`\`\`\n${snippet}\n\`\`\``;
            if (accumulated + section.length > MAX_TOTAL_SNIPPET_LENGTH) {
              break;
            }
            sections.push(section);
            accumulated += section.length;
          }
        } catch (error) {
          console.warn('Failed to read file for auto-context:', relativePath, error);
        }
      }

      if (!sections.length) {
        await sendMessage('Auto Context → Dateien nicht lesbar', {
          actualContent: `Die angeforderten Dateien konnten nicht gelesen werden. Beantworte bitte trotzdem die Frage: ${question}`,
          displayContent: 'Auto Context → Dateien nicht lesbar'
        });
        return;
      }

      const attachmentsSection = accessibleFileNotes.length
        ? `Die folgenden Dateien stehen im Workspace zur Verfügung:\n${accessibleFileNotes.join('\n')}`
        : '';

      const inlineSection = `Wenn du nicht direkt auf diese Dateien zugreifen kannst, verwende die Inhalte:\n\n${sections.join(
        '\n\n'
      )}`;

      const followUpPrompt = [attachmentsSection, inlineSection, `Nutze diese Informationen, um die ursprüngliche Frage zu beantworten:\n${question}`]
        .filter(Boolean)
        .join('\n\n');

      await sendMessage(`Auto Context → ${requestedFiles.join(', ')}`, {
        actualContent: followUpPrompt
      });
    } finally {
      setAutoContextStatus('');
      setIsAutoContextBusy(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isThinking || isAutoContextBusy) return;
    const question = input.trim();
    setInput('');
    await sendWithAutoContext(question);
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const inputDisabled = !settings.model || isThinking || isAutoContextBusy;
  const rejectEdit = (id: string) => {
    setPendingEdits(prev => prev.filter(edit => edit.id !== id));
  };

  const acceptEdit = async (edit: PendingFileEdit) => {
    try {
      if (edit.action === 'delete') {
        await window.electron?.ipcRenderer?.invoke('fs:deleteFile', edit.absolutePath);
      } else {
        await window.electron?.ipcRenderer?.invoke('fs:writeFile', edit.absolutePath, edit.newContent ?? '');
      }
      window.dispatchEvent(new CustomEvent('editor:openFile', { detail: edit.absolutePath }));
      window.dispatchEvent(new Event('explorer:refresh'));
      setPendingEdits(prev => prev.filter(item => item.id !== edit.id));
    } catch (error) {
      console.error('Failed to apply edit', error);
      alert(`Fehler beim Übernehmen: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const renderDiff = (edit: PendingFileEdit) => {
    const diff = diffLines(edit.originalContent ?? '', edit.newContent ?? '');
    const rows: Array<{ text: string; type: 'added' | 'removed' | 'context' }> = [];

    diff.forEach(part => {
      const type: 'added' | 'removed' | 'context' = part.added ? 'added' : part.removed ? 'removed' : 'context';
      const text = (part.value ?? '').replace(/\r/g, '');
      const segments = text.split('\n');
      segments.forEach((segment, index) => {
        const isLast = index === segments.length - 1;
        if (isLast && segment === '' && !text.endsWith('\n')) {
          rows.push({ text: segment, type });
        } else if (segment !== '' || !isLast) {
          rows.push({ text: segment, type });
        }
      });
      if (text.endsWith('\n')) {
        rows.push({ text: '', type });
      }
    });

    if (!rows.length) {
      rows.push({ text: '(keine Änderungen)', type: 'context' });
    }

    return (
      <pre className="ai-diff">
        {rows.map((row, idx) => (
          <div key={`${edit.id}-diff-${idx}`} className={`ai-diff-line ${row.type}`}>
            <span className="ai-diff-gutter">
              {row.type === 'added' ? '+' : row.type === 'removed' ? '-' : ' '}
            </span>
            <span>{row.text || '\u00A0'}</span>
          </div>
        ))}
      </pre>
    );
  };

  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-header">
        <div className="ai-chat-header-top">
          <div className="ai-chat-header-left">
            <h3>AI Assistant</h3>
            <button
              type="button"
              className={`ai-chat-toggle ${autoContextEnabled ? 'active' : ''}`}
              onClick={() => setAutoContextEnabled(value => !value)}
              title="Auto Context automatisch einschalten"
            >
              Auto Context
            </button>
          </div>
          <div className="ai-chat-header-right">
            <p className={`ai-chat-status ai-chat-status-${connectionStatus}`}>
              {connectionLabel} · {settings.baseUrl}
            </p>
          </div>
        </div>

        <div className="ai-chat-conversation-bar">
          <div className="ai-chat-conversation-list">
            {conversations.map(conversation => (
              <div
                key={conversation.id}
                className={`ai-chat-conversation ${conversation.id === activeConversationId ? 'active' : ''}`}
              >
                <button
                  type="button"
                  className="ai-chat-conversation-button"
                  onClick={() => setActiveConversation(conversation.id)}
                  title={conversation.title}
                >
                  {conversation.title}
                </button>
                {conversations.length > 1 && (
                  <button
                    type="button"
                    className="ai-chat-conversation-delete"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeConversation(conversation.id);
                    }}
                    title="Chat löschen"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="ai-chat-new-chat"
            onClick={() => {
              setInput('');
              setAutoContextStatus('');
              startNewConversation();
            }}
            title="Neuen Chat starten"
          >
            <FiPlus />
          </button>
        </div>

        <div className="ai-chat-controls">
          <div className="ai-chat-model-select-wrapper">
            <select
              className="ai-chat-model-select"
              value={settings.model}
              onChange={event => updateSettings({ model: event.target.value })}
              disabled={!models.length}
            >
              {models.length === 0 && <option value="">Keine Modelle gefunden</option>}
              {models.map(model => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            <div className="ai-chat-max-tokens">
              <label htmlFor="ai-max-tokens">max tokens</label>
              <input
                id="ai-max-tokens"
                type="number"
                min={256}
                max={8192}
                step={128}
                value={settings.maxTokens}
                onChange={event =>
                  updateSettings({ maxTokens: Math.max(256, Number(event.target.value) || 256) })
                }
              />
            </div>
          </div>
          <button
            className="ai-chat-icon-button"
            type="button"
            onClick={refreshModels}
            title="Modelle neu laden"
            disabled={isFetchingModels}
          >
            {isFetchingModels ? <LuLoader2 className="ai-chat-spinner" /> : <FiRefreshCw />}
          </button>
        </div>
      </div>

      <div className="ai-chat-messages">
        {messages.length === 0 ? (
          <div className="ai-chat-empty">
            Starte eine Unterhaltung oder aktiviere Auto Context für automatische Code-Snippets.
          </div>
        ) : (
          messages.map(message => (
            <div key={message.id} className={`ai-chat-message ${message.sender}`}>
              <div className="ai-chat-message-meta">
                <span>{message.sender === 'user' ? 'Du' : message.sender === 'ai' ? 'Assistant' : 'System'}</span>
                <span>{message.timestamp.toLocaleTimeString()}</span>
              </div>
              <div
                className="ai-chat-message-content"
                dangerouslySetInnerHTML={{ __html: marked.parse(message.content || '') }}
              />
            </div>
          ))
        )}
      </div>

      {lastError && <div className="ai-chat-alert">{lastError}</div>}

      <div className="ai-chat-input">
        {(autoContextEnabled && autoContextStatus) || isCancelling ? (
          <div className="ai-chat-input-status">
            {isCancelling ? 'Breche Anfrage ab…' : autoContextStatus}
          </div>
        ) : null}
        <textarea
          placeholder="Nachricht eingeben (Shift+Enter für neue Zeile)…"
          value={input}
          onChange={event => setInput(event.target.value)}
          onKeyDown={handleInputKeyDown}
          rows={3}
          disabled={inputDisabled}
        />
        <div className="ai-chat-input-actions">
          {(isThinking || isAutoContextBusy) && (
            <span className="ai-chat-typing">
              <LuLoader2 className="ai-chat-spinner" />
              Assistent arbeitet…
            </span>
          )}
          <div className="ai-chat-input-buttons">
            {(isThinking || isAutoContextBusy) && (
              <button
                type="button"
                className="ai-chat-cancel-button"
                onClick={() => {
                  cancelRequest();
                  setAutoContextStatus('');
                  setIsAutoContextBusy(false);
                }}
              >
                Abbrechen
              </button>
            )}
            <button type="button" onClick={handleSend} disabled={inputDisabled || !input.trim()}>
              <FiSend />
              Antworten
            </button>
          </div>
        </div>
      </div>

      {pendingEdits.length > 0 && (
        <div className="ai-edit-panel">
          <div className="ai-edit-panel-header">
            <div>
              <h4>Patch-Vorschläge</h4>
              <p>Wähle eine Datei, prüfe das Diff und übernehme oder verwerfe sie.</p>
            </div>
            <span className="ai-edit-count">{pendingEdits.length}</span>
          </div>

          <div className="ai-edit-files">
            {pendingEdits.map(edit => (
              <div key={edit.id} className={`ai-edit-file ${selectedEditId === edit.id ? 'active' : ''}`}>
                <button
                  type="button"
                  className="ai-edit-select"
                  onClick={() => setSelectedEditId(edit.id)}
                >
                  <span>{edit.displayPath}</span>
                  <span className={`tag tag-${edit.action}`}>{edit.action}</span>
                </button>
                <div className="ai-edit-file-actions">
                  <button className="reject" type="button" onClick={() => rejectEdit(edit.id)}>
                    Reject
                  </button>
                  <button className="accept" type="button" onClick={() => acceptEdit(edit)}>
                    Apply
                  </button>
                </div>
              </div>
            ))}
          </div>

          {selectedEdit && (
            <div className="ai-edit-diff">
              <div className="ai-edit-diff-header">
                <strong>{selectedEdit.displayPath}</strong>
                <span className={`tag tag-${selectedEdit.action}`}>{selectedEdit.action}</span>
              </div>
              {renderDiff(selectedEdit)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AIChatPanel;
