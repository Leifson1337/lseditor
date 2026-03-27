import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import path from 'path';
import { FiRefreshCw, FiSend, FiPlus, FiSettings, FiCopy, FiCheck, FiAlertTriangle, FiInfo, FiX, FiMessageSquare, FiCode, FiFileText, FiTerminal } from 'react-icons/fi';
import { LuLoader2 } from 'react-icons/lu';
import { diffLines } from 'diff';
import '../styles/AIChatPanel.css';
import { useAI } from '../contexts/AIContext';
import { FileNode } from '../types/FileNode';
import { marked } from 'marked';
import {
  collapseDuplicateProjectRoot,
  normalizeProjectRoot,
  stripFileProtocol,
  stripRelativeDrivePrefix
} from '../utils/pathUtils';

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
const EXCLUDED_CONTEXT_SEGMENTS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  'extensions'
];
const ALLOWED_CONTEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.jsonc', '.md', '.mdx', '.txt',
  '.py', '.rb', '.php', '.java', '.kt', '.go', '.rs', '.cs',
  '.cpp', '.c', '.h', '.hpp',
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.yml', '.yaml', '.xml', '.toml', '.ini', '.env',
  '.sh', '.bash', '.ps1', '.sql'
]);

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

interface PlanItem {
  text: string;
  done: boolean;
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

const isInsideProject = (filePath: string, projectPath?: string) => {
  if (!filePath) return false;
  if (!projectPath) return true;
  const absoluteProjectPath = path.resolve(projectPath).replace(/\\/g, '/').toLowerCase();
  const absoluteFilePath = path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
  return absoluteFilePath === absoluteProjectPath || absoluteFilePath.startsWith(`${absoluteProjectPath}/`);
};

const isUsefulContextFile = (relativePath: string, absolutePath: string, projectPath?: string) => {
  if (!relativePath || !absolutePath) return false;
  if (!isInsideProject(absolutePath, projectPath)) return false;

  const normalizedRelative = relativePath.replace(/\\/g, '/').replace(/^\.\/+/, '').toLowerCase();
  if (
    normalizedRelative.startsWith('../') ||
    normalizedRelative.includes(':/') ||
    EXCLUDED_CONTEXT_SEGMENTS.some(segment => normalizedRelative.split('/').includes(segment))
  ) {
    return false;
  }

  const extension = path.extname(normalizedRelative);
  if (!extension) return true;
  return ALLOWED_CONTEXT_EXTENSIONS.has(extension);
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
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const formatSnippet = (content: string) => {
  const lines = content.replace(/\r/g, '').split('\n');
  const formatted: string[] = [];
  let total = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = `${String(index + 1).padStart(4, ' ')}| ${lines[index]}`;
    const nextTotal = total + line.length + 1;
    if (nextTotal > MAX_SNIPPET_LENGTH) {
      formatted.push('... (truncated)');
      break;
    }
    formatted.push(line);
    total = nextTotal;
  }
  return formatted.join('\n');
};

const tokenizeQuestion = (question: string) => {
  return question
    .toLowerCase()
    .split(/[^a-z0-9_\-./]+/g)
    .map(token => token.trim())
    .filter(token => token.length >= 3);
};

const scoreFilePath = (filePath: string, tokens: string[]) => {
  const lower = filePath.toLowerCase();
  let score = 0;
  tokens.forEach(token => {
    if (lower.includes(token)) {
      score += token.length >= 6 ? 2 : 1;
    }
  });
  return score;
};

const pickHeuristicFiles = (question: string, files: string[], limit: number) => {
  const tokens = tokenizeQuestion(question);
  if (!tokens.length) return [];
  return files
    .map(file => ({ file, score: scoreFilePath(file, tokens) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(entry => entry.file);
};

interface PatchBlock {
  path: string;
  oldContent: string;
  newContent: string;
}

const extractPatchBlocks = (content?: string): PatchBlock[] => {
  if (!content || !content.includes('***PATCH')) return [];
  const normalizedContent = content.replace(/\r\n/g, '\n');
  const regex =
    /\*\*\*PATCH[^\S\n]*([^\n]+)\n\*\*\*\s*OLD:\n([\s\S]*?)\n\*\*\*\s*NEW:\n([\s\S]*?)(?=(?:\n\*\*\*PATCH|\s*$))/g;
  const blocks: PatchBlock[] = [];
  let result: RegExpExecArray | null;
  while ((result = regex.exec(normalizedContent)) !== null) {
    const rawPath = result[1]?.trim();
    if (!rawPath || rawPath.toUpperCase() === 'NONE') continue;
    blocks.push({
      path: rawPath,
      oldContent: result[2]?.replace(/\r/g, '') ?? '',
      newContent: result[3]?.replace(/\r/g, '') ?? ''
    });
  }
  return blocks;
};

// ─── Code block copy button injection ───

const wrapCodeBlocksWithCopy = (html: string): string => {
  return html.replace(
    /<pre><code(.*?)>([\s\S]*?)<\/code><\/pre>/g,
    (_match, attrs, code) => {
      const id = `cb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      return `<div class="ai-code-block-wrapper"><button class="ai-code-copy-btn" data-copy-id="${id}">Copy</button><pre><code${attrs} data-block-id="${id}">${code}</code></pre></div>`;
    }
  );
};

const escapeHtmlForMarkdown = (content: string) =>
  content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// ─── Component ───

const AIChatPanel: React.FC<AIChatPanelProps> = ({ fileStructure, projectPath, activeFilePath, openFiles }) => {
  const {
    conversations,
    activeConversationId,
    setActiveConversation,
    startNewConversation,
    removeConversation,
    sendMessage,
    requestCompletion,
    cancelRequest,
    isThinking,
    isCancelling,
    settings,
    updateSettings,
    models,
    refreshModels,
    isFetchingModels,
    lastError,
    connectionStatus,
    toolStatus,
    toolCallSupported,
    checkToolCallSupport,
    pendingToolApprovals,
    approvePendingToolApproval,
    rejectPendingToolApproval
  } = useAI();

  const activeConversation = useMemo(
    () => conversations.find(conv => conv.id === activeConversationId),
    [conversations, activeConversationId]
  );
  const messages = activeConversation?.messages ?? [];
  const activeApprovals = pendingToolApprovals.filter(item => item.conversationId === activeConversationId);
  const activeApproval = activeApprovals[0] ?? null;

  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [autoContextEnabled, setAutoContextEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(AUTO_CONTEXT_KEY) === 'true';
  });
  const [autoContextStatus, setAutoContextStatus] = useState('');
  const [isAutoContextBusy, setIsAutoContextBusy] = useState(false);
  const [autoContextFiles, setAutoContextFiles] = useState<string[]>([]);
  const [autoContextActivity, setAutoContextActivity] = useState<string[]>([]);
  const autoContextAbortRef = useRef<AbortController | null>(null);
  const [pendingEdits, setPendingEdits] = useState<PendingFileEdit[]>([]);
  const [selectedEditId, setSelectedEditId] = useState<string | null>(null);
  const [lastParsedMessageId, setLastParsedMessageId] = useState<string | null>(null);
  const [dismissedBanners, setDismissedBanners] = useState<Set<string>>(new Set());
  const [expandedToolCalls, setExpandedToolCalls] = useState<Set<string>>(new Set());
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const ensureAbsolutePath = useMemo(() => {
    const resolveBaseDirectory = () => {
      if (projectPath) {
        if (path.isAbsolute(projectPath)) return projectPath;
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
    const normalizedRoot = normalizeProjectRoot(projectPath || baseDirectory);
    return (targetPath: string) => {
      const trimmed = targetPath.replace(/\\/g, '/').trim();
      if (!trimmed) return baseDirectory;
      const sanitized = stripRelativeDrivePrefix(stripFileProtocol(trimmed));
      let normalized = path.normalize(sanitized);
      normalized = collapseDuplicateProjectRoot(normalized, normalizedRoot);
      if (path.isAbsolute(normalized)) return path.normalize(normalized);
      if (!baseDirectory) return path.normalize(normalized);
      const joined = path.normalize(path.join(baseDirectory, normalized));
      return collapseDuplicateProjectRoot(joined, normalizedRoot);
    };
  }, [projectPath]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(AUTO_CONTEXT_KEY, String(autoContextEnabled));
    }
  }, [autoContextEnabled]);

  const flattenedFiles = useMemo(() => flattenFiles(fileStructure, projectPath), [fileStructure, projectPath]);
  const availableFiles = useMemo(() => {
    const files = flattenedFiles
      .filter(entry => entry.type === 'file')
      .filter(entry => isUsefulContextFile(entry.relative, entry.absolute, projectPath))
      .map(entry => entry.relative);
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
    flattenedFiles.forEach(entry => map.set(entry.relative, entry.absolute));
    return map;
  }, [flattenedFiles]);

  const activeRelativePath = useMemo(
    () => normalizeRelativePath(activeFilePath, projectPath),
    [activeFilePath, projectPath]
  );

  const openRelativeFiles = useMemo(() => {
    const list = openFiles.map(file => normalizeRelativePath(file, projectPath)).filter(Boolean);
    return Array.from(new Set(list));
  }, [openFiles, projectPath]);

  // ─── Parse patch blocks from AI messages ───

  const parseFileEditsFromMessage = useCallback(
    async (messageContent?: string) => {
      const patchBlocks = extractPatchBlocks(messageContent);
      if (!patchBlocks.length) return;
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
        if (!hasOldContent && hasNewContent) action = 'create';
        else if (hasOldContent && !hasNewContent) action = 'delete';
        let originalContent = rawOld;
        if (action !== 'create') {
          try {
            const diskContent = (await window.electron?.ipcRenderer?.invoke('fs:readFile', absolutePath)) ?? '';
            if (typeof diskContent === 'string') originalContent = diskContent;
          } catch { /* keep provided OLD content */ }
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
      if (prepared.length) setPendingEdits(prev => [...prev, ...prepared]);
    },
    [ensureAbsolutePath, projectPath]
  );

  const connectionLabel = useMemo(() => {
    switch (connectionStatus) {
      case 'ready': return 'Connected';
      case 'connecting': return 'Connecting...';
      case 'error': return 'Not connected';
      default: return 'Ready';
    }
  }, [connectionStatus]);

  const selectedEdit = useMemo(
    () => pendingEdits.find(edit => edit.id === selectedEditId) ?? null,
    [pendingEdits, selectedEditId]
  );

  const currentPlan = useMemo(() => {
    const latestAiMessage = [...messages].reverse().find(message => message.sender === 'ai');
    if (!latestAiMessage?.content) return [] as PlanItem[];
    return latestAiMessage.content
      .split('\n')
      .map(line => line.trim())
      .filter(line => /^[-*]\s+\[( |x|X)\]\s+/.test(line))
      .map(line => ({
        done: /^[-*]\s+\[(x|X)\]\s+/.test(line),
        text: line.replace(/^[-*]\s+\[( |x|X)\]\s+/, '').trim()
      }));
  }, [messages]);

  // ─── Effects ───

  useEffect(() => {
    const latest = [...messages]
      .reverse()
      .find(message => message.sender === 'ai' && message.content?.includes('***PATCH'));
    if (!latest || latest.id === lastParsedMessageId) return;
    setLastParsedMessageId(latest.id);
    parseFileEditsFromMessage(latest.content);
  }, [messages, lastParsedMessageId, parseFileEditsFromMessage]);

  useEffect(() => {
    if (!pendingEdits.length) {
      if (selectedEditId !== null) setSelectedEditId(null);
      return;
    }
    if (!selectedEditId || !pendingEdits.some(edit => edit.id === selectedEditId)) {
      setSelectedEditId(pendingEdits[0].id);
    }
  }, [pendingEdits, selectedEditId]);

  useEffect(() => {
    if (!messagesContainerRef.current) return;
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isThinking, isAutoContextBusy]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  // Check tool call support when model changes
  useEffect(() => {
    if (settings.model && connectionStatus === 'ready') {
      checkToolCallSupport();
    }
  }, [settings.model, connectionStatus, checkToolCallSupport]);

  // Handle click on code copy buttons
  useEffect(() => {
    const handleCopyClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains('ai-code-copy-btn')) return;
      const copyId = target.getAttribute('data-copy-id');
      if (!copyId) return;
      const codeEl = document.querySelector(`code[data-block-id="${copyId}"]`);
      if (!codeEl) return;
      const text = codeEl.textContent || '';
      navigator.clipboard.writeText(text).then(() => {
        target.textContent = 'Copied!';
        target.classList.add('copied');
        setTimeout(() => {
          target.textContent = 'Copy';
          target.classList.remove('copied');
        }, 1500);
      });
    };
    document.addEventListener('click', handleCopyClick);
    return () => document.removeEventListener('click', handleCopyClick);
  }, []);

  // ─── Auto context ───

  const requestAutoContextFiles = useCallback(
    async (question: string) => {
      if (!availableFiles.length) return [];
      const preferredFiles = Array.from(
        new Set([activeRelativePath, ...openRelativeFiles].filter(Boolean))
      ).filter(file => availableFiles.includes(file));
      const heuristicFiles = pickHeuristicFiles(question, availableFiles, MAX_CONTEXT_FILES);
      const fallbackSelection = Array.from(new Set([...preferredFiles, ...heuristicFiles])).slice(0, MAX_CONTEXT_FILES);
      const fileListSection = availableFiles.map(file => `- ${file}`).join('\n');
      const selectionPrompt = [
        'You are an AI code assistant.',
        'I am giving you a list of all project files.',
        'Reply ONLY with a JSON array (e.g. ["src/main.ts"]) with at most 5 paths that you need to answer the question.',
        'If you do not need any files, reply with [].',
        preferredFiles.length ? `Active/recently opened files: ${preferredFiles.join(', ')}` : '',
        `Project files:\n${fileListSection}`,
        `Question: ${question}`
      ].filter(Boolean).join('\n\n');
      const controller = new AbortController();
      autoContextAbortRef.current = controller;
      try {
        const selectionResponse = await requestCompletion(
          [{ role: 'user', content: selectionPrompt }],
          { signal: controller.signal, includeBasePrompt: false }
        );
        if (!selectionResponse) return fallbackSelection;
        const parsedJson = tryParseJsonArray(selectionResponse);
        const candidates = parsedJson ?? selectionResponse.split(/[\r\n,]+/);
        const normalized = candidates
          .map(item => (typeof item === 'string' ? item : ''))
          .map(item => item.replace(/["'`]/g, '').trim())
          .filter(Boolean)
          .map(item => item.replace(/^\.\/+/, ''))
          .map(item => item.replace(/\\/g, '/'));
        const set = new Set<string>();
        normalized.forEach(item => { if (availableFiles.includes(item)) set.add(item); });
        preferredFiles.forEach(item => set.add(item));
        heuristicFiles.forEach(item => { if (set.size < MAX_CONTEXT_FILES) set.add(item); });
        return Array.from(set).slice(0, MAX_CONTEXT_FILES);
      } catch (error) {
        console.warn('Auto context selection failed:', error);
        return fallbackSelection;
      } finally {
        autoContextAbortRef.current = null;
      }
    },
    [activeRelativePath, availableFiles, openRelativeFiles, requestCompletion]
  );

  const sendWithAutoContext = async (question: string) => {
    if (!autoContextEnabled || !availableFiles.length) {
      await sendMessage(question);
      return;
    }
    setIsAutoContextBusy(true);
    setAutoContextStatus('Analyzing request...');
    setAutoContextFiles([]);
    setAutoContextActivity(['Selecting relevant files']);
    try {
      const requestedFiles = await requestAutoContextFiles(question);
      if (!requestedFiles.length) {
        setAutoContextStatus('');
        setAutoContextActivity([]);
        await sendMessage(question);
        return;
      }
      setAutoContextFiles(requestedFiles);
      setAutoContextStatus(`Loading ${requestedFiles.length} file(s)...`);
      setAutoContextActivity(prev => [...prev, ...requestedFiles.map(file => `Queued ${file}`)]);
      const sections: string[] = [];
      const accessibleFileNotes: string[] = [];
      let accumulated = 0;
      for (const relativePath of requestedFiles) {
        const absolutePath = fileMap.get(relativePath) ?? relativePath;
        try {
          setAutoContextStatus(`Reading ${relativePath}`);
          setAutoContextActivity(prev => {
            const next = prev.filter(item => item !== `Queued ${relativePath}`);
            next.push(`Read ${relativePath}`);
            return next.slice(-6);
          });
          const content = await window.electron?.ipcRenderer?.invoke('fs:readFile', absolutePath);
          if (typeof content === 'string') {
            accessibleFileNotes.push(`- ${relativePath} (${absolutePath})`);
            const snippet = content.length > 0 ? formatSnippet(content) : '(empty)';
            const section = `### ${relativePath}\n\`\`\`\n${snippet}\n\`\`\``;
            if (accumulated + section.length > MAX_TOTAL_SNIPPET_LENGTH) break;
            sections.push(section);
            accumulated += section.length;
          }
        } catch (error) {
          console.warn('Failed to read file for auto-context:', relativePath, error);
        }
      }
      if (!sections.length) {
        setAutoContextActivity([]);
        await sendMessage(question);
        return;
      }
      const attachmentsSection = accessibleFileNotes.length
        ? `The following files are available in the workspace:\n${accessibleFileNotes.join('\n')}`
        : '';
      const inlineSection = ['If you cannot access the files directly, use the following content:', sections.join('\n\n')].join('\n\n');
      const contextPrompt = [attachmentsSection, inlineSection, 'Use line numbers in the snippets for precise references.', `Answer the question: ${question}`].filter(Boolean).join('\n\n');
      await sendMessage(question, { injectSystemPrompt: contextPrompt });
    } finally {
      setAutoContextStatus('');
      setAutoContextActivity([]);
      setIsAutoContextBusy(false);
    }
  };

  // ─── Handlers ───

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

  const handleQuickPrompt = (prompt: string) => {
    setInput(prompt);
    textareaRef.current?.focus();
  };

  const toggleToolCallExpanded = (key: string) => {
    setExpandedToolCalls(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const inputDisabled = !settings.model || isThinking || isAutoContextBusy;

  const rejectEdit = (id: string) => setPendingEdits(prev => prev.filter(edit => edit.id !== id));

  const acceptEdit = async (edit: PendingFileEdit) => {
    try {
      if (edit.action === 'delete') {
        await window.electron?.ipcRenderer?.invoke('fs:deleteFile', edit.absolutePath);
      } else {
        await window.electron?.ipcRenderer?.invoke('fs:writeFile', edit.absolutePath, edit.newContent ?? '');
      }
      window.dispatchEvent(new CustomEvent('editor:fileChanged', { detail: edit.absolutePath }));
      window.dispatchEvent(new CustomEvent('editor:openFile', { detail: edit.absolutePath }));
      window.dispatchEvent(new Event('explorer:refresh'));
      setPendingEdits(prev => prev.filter(item => item.id !== edit.id));
    } catch (error) {
      console.error('Failed to apply edit', error);
      alert(`Error applying edit: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // ─── Render helpers ───

  const buildDiffRows = (originalContent: string, newContent: string, keyPrefix: string) => {
    const diff = diffLines(originalContent ?? '', newContent ?? '');
    const rows: Array<{
      key: string;
      text: string;
      type: 'added' | 'removed' | 'context';
      oldLineNumber: number | null;
      newLineNumber: number | null;
    }> = [];
    let oldLineNumber = 1;
    let newLineNumber = 1;

    diff.forEach((part, partIndex) => {
      const type: 'added' | 'removed' | 'context' = part.added ? 'added' : part.removed ? 'removed' : 'context';
      const text = (part.value ?? '').replace(/\r/g, '');
      const lines = text.split('\n');
      const lineCount = text.endsWith('\n') ? lines.length - 1 : lines.length;

      for (let index = 0; index < lineCount; index += 1) {
        rows.push({
          key: `${keyPrefix}-${partIndex}-${index}`,
          text: lines[index] ?? '',
          type,
          oldLineNumber: type === 'added' ? null : oldLineNumber++,
          newLineNumber: type === 'removed' ? null : newLineNumber++
        });
      }
    });

    if (!rows.length) {
      rows.push({
        key: `${keyPrefix}-empty`,
        text: '(no changes)',
        type: 'context',
        oldLineNumber: null,
        newLineNumber: null
      });
    }

    return rows;
  };

  const renderDiff = (edit: PendingFileEdit) => {
    const rows = buildDiffRows(edit.originalContent ?? '', edit.newContent ?? '', edit.id);
    return (
      <pre className="ai-diff">
        {rows.map(row => (
          <div key={row.key} className={`ai-diff-line ${row.type}`}>
            <span className="ai-diff-line-number">{row.oldLineNumber ?? ''}</span>
            <span className="ai-diff-line-number">{row.newLineNumber ?? ''}</span>
            <span className="ai-diff-gutter">
              {row.type === 'added' ? '+' : row.type === 'removed' ? '-' : ' '}
            </span>
            <span className="ai-diff-code">{row.text || '\u00A0'}</span>
          </div>
        ))}
      </pre>
    );
  };

  const renderToolPreview = (approvalId: string, index: number, toolCall: any) => {
    if (!toolCall.preview || toolCall.preview.kind !== 'file') return null;
    const preview = toolCall.preview;
    const rows = buildDiffRows(
      preview.originalContent ?? '',
      preview.newContent ?? '',
      `${approvalId}-${index}`
    );
    return (
      <div className="ai-chat-approval-preview">
        <div className="ai-chat-approval-preview-header">
          <strong>{preview.path}</strong>
          <span className={`tag tag-${preview.action}`}>{preview.action}</span>
        </div>
        <pre className="ai-diff compact">
          {rows.map(row => (
            <div key={row.key} className={`ai-diff-line ${row.type}`}>
              <span className="ai-diff-line-number">{row.oldLineNumber ?? ''}</span>
              <span className="ai-diff-line-number">{row.newLineNumber ?? ''}</span>
              <span className="ai-diff-gutter">
                {row.type === 'added' ? '+' : row.type === 'removed' ? '-' : ' '}
              </span>
              <span className="ai-diff-code">{row.text || '\u00A0'}</span>
            </div>
          ))}
        </pre>
      </div>
    );
  };

  const renderApprovalDetails = (toolCall: any) => {
    try {
      const args = JSON.parse(toolCall.arguments || '{}');
      if (toolCall.name === 'runCommand') {
        return (
          <pre className="ai-chat-approval-command">
            <strong>Command</strong>
            {'\n'}
            {String(args.command || '').trim() || '(empty)'}
            {args.cwd ? `\n\nCWD\n${String(args.cwd)}` : ''}
          </pre>
        );
      }
    } catch {
      return null;
    }
    return null;
  };

  const renderMessageContent = (content: string) => {
    const rawHtml = marked.parse(escapeHtmlForMarkdown(content || '')) as string;
    const withCopy = wrapCodeBlocksWithCopy(rawHtml);
    return <div className="ai-chat-message-content" dangerouslySetInnerHTML={{ __html: withCopy }} />;
  };

  const toolCallSupportBannerId = `tool-support-${settings.model}`;
  const showToolWarning = settings.toolsEnabled && toolCallSupported === false && !dismissedBanners.has(toolCallSupportBannerId);
  const showToolInfo = settings.toolsEnabled && toolCallSupported === 'unknown' && !dismissedBanners.has('tool-unknown');

  return (
    <div className="ai-chat-panel">
      {/* ─── Header ─── */}
      <div className="ai-chat-header">
        <div className="ai-chat-header-top">
          <div className="ai-chat-header-left">
            <h3>AI Chat</h3>
          </div>
          <div className="ai-chat-header-right">
            <p className={`ai-chat-status ai-chat-status-${connectionStatus}`}>
              {connectionLabel}
            </p>
          </div>
        </div>

        <div className="ai-chat-toolbar">
          <div className="ai-chat-toolbar-row">
            <div className="ai-chat-mode-switch" role="tablist" aria-label="AI mode">
              {(['qa', 'coder', 'autonomous'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  className={`ai-chat-mode-button ${settings.mode === mode ? 'active' : ''}`}
                  onClick={() => updateSettings({ mode })}
                  title={mode === 'qa' ? 'Read-only question mode' : mode === 'coder' ? 'Can edit files and code' : 'Plans, codes and validates autonomously'}
                >
                  {mode === 'qa' ? 'QA' : mode === 'coder' ? 'Coder' : 'Auto'}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`ai-chat-toggle ${autoContextEnabled ? 'active' : ''}`}
              onClick={() => {
                setAutoContextEnabled(value => {
                  const next = !value;
                  if (!next) {
                    setAutoContextFiles([]);
                    setAutoContextStatus('');
                    setAutoContextActivity([]);
                  }
                  return next;
                });
              }}
              title="Toggle smart file selection"
            >
              Context
            </button>
          </div>
        </div>

        {/* Auto context file chips */}
        {autoContextEnabled && (
          <div className="ai-chat-context-strip">
            <span className="ai-chat-context-label">Context</span>
            <div className="ai-chat-context-content">
              {autoContextFiles.length ? (
                <div className="ai-chat-context-files">
                  {autoContextFiles.map(file => (
                    <span key={file} className="ai-chat-context-chip" title={file}>{file}</span>
                  ))}
                </div>
              ) : (
                <span className="ai-chat-context-empty">Active file and open tabs are used automatically.</span>
              )}
              {autoContextActivity.length > 0 && (
                <div className="ai-chat-context-activity">
                  {autoContextActivity.map(item => (
                    <span key={item} className="ai-chat-context-activity-item">{item}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Conversation switcher */}
        <div className="ai-chat-conversation-bar">
          <div className="ai-chat-conversation-picker">
            <select
              id="ai-chat-conversation-select"
              className="ai-chat-conversation-select"
              value={activeConversationId}
              onChange={event => setActiveConversation(event.target.value)}
            >
              {conversations.map(conversation => (
                <option key={conversation.id} value={conversation.id}>
                  {conversation.title}
                </option>
              ))}
            </select>
          </div>
          <div className="ai-chat-conversation-actions">
            {conversations.length > 1 && (
              <button
                type="button"
                className="ai-chat-conversation-action danger"
                onClick={() => removeConversation(activeConversationId)}
                title="Delete current chat"
              >
                <FiX />
              </button>
            )}
            <button
              type="button"
              className="ai-chat-conversation-action"
              onClick={() => { setInput(''); setAutoContextStatus(''); setAutoContextFiles([]); startNewConversation(); }}
              title="New Chat"
            >
              <FiPlus />
            </button>
          </div>
        </div>

        {/* Model select + settings */}
        <div className="ai-chat-controls">
          <div className="ai-chat-model-row">
            <div className="ai-chat-model-select-wrapper">
              <select
                className="ai-chat-model-select"
                value={settings.model}
                onChange={event => updateSettings({ model: event.target.value })}
                disabled={!models.length}
              >
                {models.length === 0 && <option value="">No models</option>}
                {models.map(model => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            </div>
            <button
              className="ai-chat-icon-button"
              type="button"
              onClick={refreshModels}
              title="Refresh Models"
              disabled={isFetchingModels}
            >
              {isFetchingModels ? <LuLoader2 className="ai-chat-spinner" /> : <FiRefreshCw />}
            </button>
            <button
              className={`ai-settings-toggle ${showSettings ? 'open' : ''}`}
              type="button"
              onClick={() => setShowSettings(v => !v)}
              title="Settings"
            >
              <FiSettings />
            </button>
          </div>
        </div>

        {/* Tool call capability warnings */}
        {showToolWarning && (
          <div className="ai-chat-capability-banner warning">
            <FiAlertTriangle className="banner-icon" />
            <div className="banner-text">
              <strong>Tool Calls Not Supported</strong>
              <span>
                The model "{settings.model}" does not support function/tool calls.
                Tools are enabled but the model will not be able to execute file operations or commands.
                Try a model that supports tool calling (e.g. models with "function calling" support).
              </span>
            </div>
            <button
              className="banner-dismiss"
              onClick={() => setDismissedBanners(prev => new Set(prev).add(toolCallSupportBannerId))}
            >
              <FiX />
            </button>
          </div>
        )}
        {showToolInfo && (
          <div className="ai-chat-capability-banner info">
            <FiInfo className="banner-icon" />
            <div className="banner-text">
              <strong>Tool Call Support Unknown</strong>
              <span>
                Could not verify if "{settings.model}" supports tool calls. Tool calls will be attempted but may not work.
              </span>
            </div>
            <button
              className="banner-dismiss"
              onClick={() => setDismissedBanners(prev => new Set(prev).add('tool-unknown'))}
            >
              <FiX />
            </button>
          </div>
        )}

        {/* Settings drawer */}
        {showSettings && (
          <div className="ai-settings-drawer">
            <div className="ai-settings-row">
              <label>Execution policy</label>
              <div className="ai-settings-toggle-row">
                <button
                  type="button"
                  className={`ai-chat-toggle ${!settings.yoloMode ? 'active' : ''}`}
                  onClick={() => updateSettings({ yoloMode: false })}
                >
                  Confirm writes
                </button>
                <button
                  type="button"
                  className={`ai-chat-toggle danger ${settings.yoloMode ? 'active' : ''}`}
                  onClick={() => {
                    if (settings.yoloMode) {
                      updateSettings({ yoloMode: false });
                      return;
                    }
                    const confirmed = window.confirm(
                      'YOLO mode erlaubt Dateiänderungen und Befehle ohne Bestätigung. Das kann Sicherheitsrisiken verursachen. Wirklich aktivieren?'
                    );
                    if (confirmed) {
                      updateSettings({ yoloMode: true });
                    }
                  }}
                >
                  YOLO
                </button>
              </div>
            </div>
            <div className="ai-settings-row">
              <label>Endpoint URL</label>
              <input
                type="text"
                value={settings.baseUrl}
                onChange={e => updateSettings({ baseUrl: e.target.value })}
                placeholder="http://localhost:1234"
              />
            </div>
            <div className="ai-settings-row">
              <label>API Key (optional)</label>
              <input
                type="password"
                value={settings.apiKey || ''}
                onChange={e => updateSettings({ apiKey: e.target.value || undefined })}
                placeholder="sk-..."
              />
            </div>
            <div className="ai-settings-row-inline">
              <div className="ai-settings-row">
                <label>Temperature</label>
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={settings.temperature}
                  onChange={e => updateSettings({ temperature: parseFloat(e.target.value) || 0.7 })}
                />
              </div>
              <div className="ai-settings-row">
                <label>Max Tokens</label>
                <input
                  type="number"
                  min="256"
                  max="128000"
                  step="256"
                  value={settings.maxTokens}
                  onChange={e => updateSettings({ maxTokens: parseInt(e.target.value) || 4096 })}
                />
              </div>
            </div>
            <div className="ai-settings-row-inline">
              <div className="ai-settings-row">
                <label>Top P</label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.topP}
                  onChange={e => updateSettings({ topP: parseFloat(e.target.value) || 1 })}
                />
              </div>
              <div className="ai-settings-row">
                <label>Tool Support</label>
                <span style={{ fontSize: 11, color: toolCallSupported === true ? '#34d399' : toolCallSupported === false ? '#f87171' : '#6b7280', padding: '5px 0' }}>
                  {toolCallSupported === true ? 'Supported' : toolCallSupported === false ? 'Not Supported' : 'Unknown'}
                </span>
              </div>
            </div>
            <div className="ai-settings-row">
              <label>Mode behavior</label>
              <span className="ai-settings-note">
                {settings.mode === 'qa'
                  ? 'Read-only. The assistant should inspect and answer, but not write or execute.'
                  : settings.mode === 'coder'
                    ? settings.yoloMode
                      ? 'Writes and commands run immediately without confirmation.'
                      : 'Writes and commands require confirmation cards in the chat.'
                    : settings.yoloMode
                      ? 'Autonomous mode with unrestricted execution.'
                      : 'Autonomous mode plans, codes and validates, but dangerous actions still require confirmation.'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ─── Messages ─── */}
      <div className="ai-chat-messages" ref={messagesContainerRef}>
        {settings.mode === 'autonomous' && currentPlan.length > 0 && (
          <div className="ai-chat-plan-card">
            <div className="ai-chat-plan-title">Working plan</div>
            <div className="ai-chat-plan-items">
              {currentPlan.map(item => (
                <div key={`${item.text}-${item.done ? 'done' : 'todo'}`} className={`ai-chat-plan-item ${item.done ? 'done' : ''}`}>
                  <span className="ai-chat-plan-check">{item.done ? '✓' : '○'}</span>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {messages.length === 0 ? (
          <div className="ai-chat-empty">
            <div className="ai-chat-empty-icon">
              <FiMessageSquare />
            </div>
            <div className="ai-chat-empty-title">Start a Conversation</div>
            <div className="ai-chat-empty-desc">
              Ask questions about your code, generate files, run commands, or get help with your project.
            </div>
            <div className="ai-chat-empty-shortcuts">
              <button className="ai-chat-shortcut" onClick={() => handleQuickPrompt('Explain the current file')}>
                <FiFileText className="ai-chat-shortcut-icon" />
                <span className="ai-chat-shortcut-text">Explain current file</span>
              </button>
              <button className="ai-chat-shortcut" onClick={() => handleQuickPrompt('Refactor the selected code')}>
                <FiCode className="ai-chat-shortcut-icon" />
                <span className="ai-chat-shortcut-text">Refactor code</span>
              </button>
              <button className="ai-chat-shortcut" onClick={() => handleQuickPrompt('Run the tests')}>
                <FiTerminal className="ai-chat-shortcut-icon" />
                <span className="ai-chat-shortcut-text">Run tests</span>
              </button>
            </div>
          </div>
        ) : (
          messages.map(message => (
            <div key={message.id} className={`ai-chat-message ${message.sender}`}>
              <div className="ai-chat-message-meta">
                <span>
                  {message.sender === 'user' ? 'You' : message.sender === 'ai' ? 'Assistant' : message.sender === 'tool' ? 'Tool' : 'System'}
                </span>
                <span>{message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div className="ai-chat-message-bubble">
                {message.toolCalls && message.toolCalls.length > 0 ? (
                  <div className="ai-chat-tool-calls">
                    {message.toolCalls.map((tc, idx) => {
                      const tcKey = `${message.id}-tc-${idx}`;
                      const isExpanded = expandedToolCalls.has(tcKey);
                      let parsedArgs = '';
                      try {
                        const args = JSON.parse(tc.arguments);
                        parsedArgs = Object.entries(args)
                          .map(([k, v]) => `${k}: ${typeof v === 'string' && v.length > 40 ? v.slice(0, 40) + '...' : v}`)
                          .join(', ');
                      } catch { parsedArgs = tc.arguments; }

                      return (
                        <div key={idx} className={`ai-chat-tool-call ${tc.status}`}>
                          <div className="ai-chat-tool-call-header" onClick={() => toggleToolCallExpanded(tcKey)}>
                            <span className="ai-chat-tool-call-icon">
                              {tc.status === 'done' ? <FiCheck /> : tc.status === 'error' ? <FiX /> : <LuLoader2 />}
                            </span>
                            <span className="ai-chat-tool-call-name">{tc.name}</span>
                            {parsedArgs && <span className="ai-chat-tool-call-args">({parsedArgs})</span>}
                          </div>
                          {isExpanded && tc.result && (
                            <pre className="ai-chat-tool-call-result">{tc.result}</pre>
                          )}
                        </div>
                      );
                    })}
                    {message.content && renderMessageContent(message.content)}
                  </div>
                ) : (
                  renderMessageContent(message.content || '')
                )}
              </div>
            </div>
          ))
        )}

        {/* Thinking indicator */}
        {(isThinking || isAutoContextBusy) && (
          <div className="ai-chat-thinking">
            <div className="ai-thinking-dots">
              <span /><span /><span />
            </div>
            {toolStatus ? (
              <span className="ai-thinking-tool">{toolStatus}</span>
            ) : (
              <span className="ai-thinking-label">
                {isAutoContextBusy ? autoContextStatus || 'Loading context...' : 'Thinking...'}
              </span>
            )}
          </div>
        )}
        <div ref={messageEndRef} />
      </div>

      {/* Error bar */}
      {lastError && <div className="ai-chat-alert">{lastError}</div>}

      {/* ─── Input ─── */}
      {activeApproval && (
        <div className="ai-chat-approval-overlay">
          <div className="ai-chat-approval-backdrop" />
          <div className="ai-chat-approval-modal">
            <div className="ai-chat-approval-card floating">
              <div className="ai-chat-approval-header">
                <FiAlertTriangle />
                <strong>Approval required</strong>
              </div>
              <p>{activeApproval.summary}</p>
              <div className="ai-chat-approval-list">
                {activeApproval.toolCalls.map((toolCall, index) => (
                  <span key={`${activeApproval.id}-${index}`} className="ai-chat-approval-chip">
                    {toolCall.name}
                  </span>
                ))}
              </div>
              {activeApproval.toolCalls.map((toolCall, index) => (
                <div key={`${activeApproval.id}-preview-${index}`}>
                  {renderApprovalDetails(toolCall)}
                  {renderToolPreview(activeApproval.id, index, toolCall)}
                </div>
              ))}
              {activeApprovals.length > 1 && (
                <p className="ai-chat-approval-count-note">
                  {activeApprovals.length - 1} further approval request{activeApprovals.length - 1 !== 1 ? 's' : ''} queued.
                </p>
              )}
              <div className="ai-chat-approval-actions">
                <button type="button" className="reject" onClick={() => rejectPendingToolApproval(activeApproval.id)}>
                  Reject
                </button>
                <button type="button" className="accept" onClick={() => approvePendingToolApproval(activeApproval.id)}>
                  Approve
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="ai-chat-input">
        {isCancelling && (
          <div className="ai-chat-input-status">Cancelling...</div>
        )}
        <div className="ai-chat-input-row">
          <textarea
            ref={textareaRef}
            placeholder={inputDisabled ? 'Select a model to start...' : 'Type a message... (Shift+Enter for new line)'}
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
            rows={1}
            disabled={inputDisabled}
          />
          {(isThinking || isAutoContextBusy) ? (
            <button
              type="button"
              className="ai-chat-cancel-button"
              onClick={() => {
                cancelRequest();
                autoContextAbortRef.current?.abort();
                autoContextAbortRef.current = null;
                setAutoContextStatus('');
                setIsAutoContextBusy(false);
                setAutoContextFiles([]);
              }}
              style={{ height: 36, borderRadius: 6 }}
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="ai-chat-send-btn"
              onClick={handleSend}
              disabled={inputDisabled || !input.trim()}
              title="Send"
            >
              <FiSend />
            </button>
          )}
        </div>
        <div className="ai-chat-input-actions">
          <span className="ai-chat-input-hint">Shift+Enter for new line</span>
          {messages.length > 0 && (
            <span className="ai-chat-token-count">
              {messages.length} message{messages.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* ─── Patch edit panel ─── */}
      {pendingEdits.length > 0 && (
        <div className="ai-edit-panel">
          <div className="ai-edit-panel-header">
            <div>
              <h4>Patch Suggestions</h4>
              <p>Review changes and apply or reject them.</p>
            </div>
            <span className="ai-edit-count">{pendingEdits.length}</span>
          </div>
          <div className="ai-edit-files">
            {pendingEdits.map(edit => (
              <div key={edit.id} className={`ai-edit-file ${selectedEditId === edit.id ? 'active' : ''}`}>
                <button type="button" className="ai-edit-select" onClick={() => setSelectedEditId(edit.id)}>
                  <span>{edit.displayPath}</span>
                  <span className={`tag tag-${edit.action}`}>{edit.action}</span>
                </button>
                <div className="ai-edit-file-actions">
                  <button className="reject" type="button" onClick={() => rejectEdit(edit.id)}>Reject</button>
                  <button className="accept" type="button" onClick={() => acceptEdit(edit)}>Apply</button>
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
