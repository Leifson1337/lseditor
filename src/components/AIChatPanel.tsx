import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import path from 'path';
import { FiRefreshCw, FiSend, FiPlus, FiSettings, FiCopy, FiCheck, FiAlertTriangle, FiX, FiMessageSquare, FiCode, FiFileText, FiTerminal, FiPaperclip, FiZap, FiShield } from 'react-icons/fi';
import { LuLoader2 } from 'react-icons/lu';
import { diffLines } from 'diff';
import '../styles/AIChatPanel.css';
import { useAI } from '../contexts/AIContext';
import { FileNode } from '../types/FileNode';
import { marked } from 'marked';
import {
  collapseDuplicateProjectRoot,
  isAbsoluteFilePath,
  joinPathPreserveAbsolute,
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

interface MessageStopState {
  body: string;
  stopReason?: string;
}

const createLocalId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const createFileList = (files: File[]): FileList => {
  const dt = new DataTransfer();
  files.forEach(f => dt.items.add(f));
  return dt.files;
};

const normalizeRelativePath = (filePath?: string, projectPath?: string) => {
  if (!filePath) return '';
  if (projectPath && isAbsoluteFilePath(filePath)) {
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

const extractChecklistItems = (content?: string): PlanItem[] => {
  if (!content) return [];
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^[-*]\s+\[( |x|X)\]\s+/.test(line))
    .map(line => ({
      done: /^[-*]\s+\[(x|X)\]\s+/.test(line),
      text: line.replace(/^[-*]\s+\[( |x|X)\]\s+/, '').trim()
    }));
};

const splitStopReason = (content?: string): MessageStopState => {
  const raw = content || '';
  const match = raw.match(/\n\n---\n\*(.+?)\*\s*$/s);
  if (!match) {
    return { body: raw };
  }

  return {
    body: raw.slice(0, match.index).trim(),
    stopReason: match[1]?.trim()
  };
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
    visionSupported,
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
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [settingsMenuTab, setSettingsMenuTab] = useState<'general' | 'model' | 'advanced'>('general');
  const [attachedFiles, setAttachedFiles] = useState<Array<{ name: string; type: string; dataUrl?: string; content?: string }>>([]);
  const [showYoloConfirm, setShowYoloConfirm] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
  const [expandedReasoning, setExpandedReasoning] = useState<Set<string>>(new Set());
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
      if (isAbsoluteFilePath(normalized)) return path.normalize(normalized);
      if (!baseDirectory) return path.normalize(normalized);
      const joined = joinPathPreserveAbsolute(baseDirectory, normalized);
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
    const latestChecklistMessage = [...messages]
      .reverse()
      .find(
        message =>
          (message.sender === 'ai' || message.sender === 'tool') &&
          extractChecklistItems(message.content).length > 0
      );
    return extractChecklistItems(latestChecklistMessage?.content);
  }, [messages]);

  const planStats = useMemo(() => {
    const total = currentPlan.length;
    const completed = currentPlan.filter(item => item.done).length;
    return {
      total,
      completed,
      finished: total > 0 && completed === total
    };
  }, [currentPlan]);

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

  const sendWithAutoContext = async (
    question: string,
    images?: Array<{ dataUrl: string; name: string; mimeType: string }>,
    displayContent?: string
  ) => {
    const msgOptions: Parameters<typeof sendMessage>[1] = { images, displayContent };
    if (!autoContextEnabled || !availableFiles.length) {
      await sendMessage(question, msgOptions);
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
        await sendMessage(question, msgOptions);
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
        await sendMessage(question, msgOptions);
        return;
      }
      const attachmentsSection = accessibleFileNotes.length
        ? `The following files are available in the workspace:\n${accessibleFileNotes.join('\n')}`
        : '';
      const inlineSection = ['If you cannot access the files directly, use the following content:', sections.join('\n\n')].join('\n\n');
      const contextPrompt = [attachmentsSection, inlineSection, 'Use line numbers in the snippets for precise references.', `Answer the question: ${question}`].filter(Boolean).join('\n\n');
      await sendMessage(question, { ...msgOptions, injectSystemPrompt: contextPrompt });
    } finally {
      setAutoContextStatus('');
      setAutoContextActivity([]);
      setIsAutoContextBusy(false);
    }
  };

  // ─── Handlers ───

  const handleFileAttach = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      if (file.type.startsWith('image/')) {
        if (!visionSupported) return; // silently skip images if model doesn't support vision
        reader.onload = () => {
          setAttachedFiles(prev => [...prev, { name: file.name, type: file.type, dataUrl: reader.result as string }]);
        };
        reader.readAsDataURL(file);
      } else {
        reader.onload = () => {
          setAttachedFiles(prev => [...prev, { name: file.name, type: file.type, content: reader.result as string }]);
        };
        reader.readAsText(file);
      }
    });
  };

  const handlePaste = (event: React.ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        if (!visionSupported) return; // don't accept pasted images for non-vision models
        event.preventDefault();
        const file = item.getAsFile();
        if (file) handleFileAttach(createFileList([file]));
      }
    }
  };

  const removeAttachment = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if (!input.trim() && !attachedFiles.length) return;
    if (isThinking || isAutoContextBusy) return;
    const question = input.trim();

    // Separate images from text files
    const imageAttachments = attachedFiles.filter(f => f.dataUrl && f.type.startsWith('image/'));
    const textAttachments = attachedFiles.filter(f => f.content && !f.type.startsWith('image/'));

    // Build the text message (include text file contents inline, but NOT image base64)
    let fullMessage = question;
    if (textAttachments.length) {
      const fileSections = textAttachments.map(f =>
        `[File: ${f.name}]\n\`\`\`\n${(f.content || '').slice(0, MAX_SNIPPET_LENGTH)}\n\`\`\``
      );
      fullMessage = [...fileSections, question].filter(Boolean).join('\n\n');
    }

    // Build display text (what the user sees in the chat)
    const displayParts: string[] = [];
    if (imageAttachments.length) {
      displayParts.push(imageAttachments.map(f => `📷 ${f.name}`).join(', '));
    }
    if (textAttachments.length) {
      displayParts.push(textAttachments.map(f => `📄 ${f.name}`).join(', '));
    }
    if (question) displayParts.push(question);
    const displayContent = displayParts.join('\n');

    // Prepare image attachments for the API (multimodal content parts)
    const images = imageAttachments.length > 0
      ? imageAttachments.map(f => ({ dataUrl: f.dataUrl!, name: f.name, mimeType: f.type }))
      : undefined;

    setInput('');
    setAttachedFiles([]);

    if (!fullMessage && !images?.length) return;

    // Send with proper multimodal support
    if (autoContextEnabled && availableFiles.length) {
      // For auto context, we need to inject context and pass images separately
      await sendWithAutoContext(fullMessage || '', images, displayContent);
    } else {
      await sendMessage(fullMessage || (images ? '' : ''), {
        displayContent,
        images
      });
    }
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

  // Close settings menu when clicking outside
  useEffect(() => {
    if (!showSettingsMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target as Node)) {
        setShowSettingsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSettingsMenu]);

  const toggleToolCallExpanded = (key: string) => {
    setExpandedToolCalls(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleReasoningExpanded = (key: string) => {
    setExpandedReasoning(prev => {
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

  const renderReasoning = (message: typeof messages[number]) => {
    if (!message.reasoning?.trim()) return null;
    const reasoningKey = `reasoning-${message.id}`;
    const isExpanded = expandedReasoning.has(reasoningKey);
    const preview = message.reasoning
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' ');

    return (
      <div className={`ai-chat-reasoning ${isExpanded ? 'expanded' : ''}`}>
        <button
          type="button"
          className="ai-chat-reasoning-toggle"
          onClick={() => toggleReasoningExpanded(reasoningKey)}
        >
          <span className="ai-chat-reasoning-label">Reasoning</span>
          <span className="ai-chat-reasoning-preview">{preview || 'Open internal work trace'}</span>
        </button>
        {isExpanded && <div className="ai-chat-reasoning-body">{renderMessageContent(message.reasoning)}</div>}
      </div>
    );
  };

  const renderSummaryCard = (message: typeof messages[number]) => {
    const { body, stopReason } = splitStopReason(message.content);
    return (
      <div className="ai-chat-summary-card">
        <div className="ai-chat-summary-header">
          <div>
            <div className="ai-chat-summary-eyebrow">Execution Summary</div>
            <strong>Task finished</strong>
          </div>
          {stopReason && <span className="ai-chat-summary-stop">{stopReason}</span>}
        </div>
        <div className="ai-chat-summary-body">
          {renderMessageContent(body || '(No summary provided)')}
        </div>
      </div>
    );
  };


  return (
    <div className="ai-chat-panel">
      {/* ─── Minimal Header ─── */}
      <div className="ai-chat-header">
        <div className="ai-chat-header-top">
          <div className="ai-chat-header-left">
            <select
              className="ai-chat-conversation-select-compact"
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
          <div className="ai-chat-header-right">
            <span className={`ai-chat-status-dot ai-chat-status-dot-${connectionStatus}`} title={connectionLabel} />
            {settings.yoloMode && <span className="ai-chat-yolo-badge" title="YOLO Mode active">YOLO</span>}
            {conversations.length > 1 && (
              <button
                type="button"
                className="ai-chat-header-btn"
                onClick={() => removeConversation(activeConversationId)}
                title="Delete current chat"
              >
                <FiX size={14} />
              </button>
            )}
            <button
              type="button"
              className="ai-chat-header-btn"
              onClick={() => { setInput(''); setAutoContextStatus(''); setAutoContextFiles([]); startNewConversation(); }}
              title="New Chat"
            >
              <FiPlus size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ─── Messages ─── */}
      <div className="ai-chat-messages" ref={messagesContainerRef}>
        {currentPlan.length > 0 && (
          <div className={`ai-chat-plan-card ${planStats.finished ? 'finished' : ''}`}>
            <div className="ai-chat-plan-header">
              <div className="ai-chat-plan-title">Working plan</div>
              <div className="ai-chat-plan-progress">
                <span>{planStats.completed}/{planStats.total}</span>
                {planStats.finished && <span className="ai-chat-plan-badge">Done</span>}
              </div>
            </div>
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
          messages.map((message, index) => {
            const { body, stopReason } = splitStopReason(message.content);
            const isSummaryMessage =
              message.sender === 'ai' &&
              Boolean(stopReason) &&
              index === messages.length - 1;

            return (
            <div key={message.id} className={`ai-chat-message ${message.sender}`}>
              <div className="ai-chat-message-meta">
                <span>
                  {message.sender === 'user' ? 'You' : message.sender === 'ai' ? 'Assistant' : message.sender === 'tool' ? 'Tool' : 'System'}
                </span>
                <span>{message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              {isSummaryMessage ? renderSummaryCard(message) : <div className="ai-chat-message-bubble">
                {message.toolCalls && message.toolCalls.length > 0 ? (
                  <div className="ai-chat-tool-calls">
                    {renderReasoning(message)}
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
                    {body && renderMessageContent(body)}
                  </div>
                ) : (
                  <>
                    {renderReasoning(message)}
                    {renderMessageContent(body || '')}
                  </>
                )}
              </div>}
            </div>
          )})
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

      {/* ─── Input area ─── */}
      <div className="ai-chat-input">
        {isCancelling && (
          <div className="ai-chat-input-status">Cancelling...</div>
        )}

        {/* Attached files preview */}
        {attachedFiles.length > 0 && (
          <div className="ai-chat-attachments">
            {attachedFiles.map((file, i) => (
              <div key={i} className="ai-chat-attachment-chip">
                {file.dataUrl ? (
                  <img src={file.dataUrl} alt={file.name} className="ai-chat-attachment-thumb" />
                ) : (
                  <FiFileText size={12} />
                )}
                <span className="ai-chat-attachment-name">{file.name}</span>
                <button type="button" className="ai-chat-attachment-remove" onClick={() => removeAttachment(i)}>
                  <FiX size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="ai-chat-input-row">
          <textarea
            ref={textareaRef}
            placeholder={inputDisabled ? 'Select a model to start...' : 'Type a message...'}
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
            onPaste={handlePaste}
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
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="ai-chat-send-btn"
              onClick={handleSend}
              disabled={inputDisabled || (!input.trim() && !attachedFiles.length)}
              title="Send"
            >
              <FiSend />
            </button>
          )}
        </div>

        {/* Bottom action bar */}
        <div className="ai-chat-input-bar">
          <div className="ai-chat-input-bar-left">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={visionSupported ? '*/*' : '.ts,.tsx,.js,.jsx,.json,.css,.html,.py,.md,.txt,.yml,.yaml,.xml,.sh,.rs,.go,.java,.c,.cpp,.h'}
              style={{ display: 'none' }}
              onChange={e => { handleFileAttach(e.target.files); e.target.value = ''; }}
            />
            <button
              type="button"
              className="ai-chat-input-icon-btn"
              onClick={() => fileInputRef.current?.click()}
              title={visionSupported ? 'Attach files or images' : 'Attach code files (vision not supported by this model)'}
            >
              <FiPaperclip size={15} />
            </button>
            <button
              type="button"
              className={`ai-chat-input-icon-btn ${showSettingsMenu ? 'active' : ''}`}
              onClick={() => setShowSettingsMenu(v => !v)}
              title="Settings"
            >
              <FiSettings size={15} />
            </button>
            {autoContextEnabled && (
              <span className="ai-chat-context-indicator" title="Smart Context active">
                <FiZap size={12} /> Context
              </span>
            )}
          </div>
          <div className="ai-chat-input-bar-right">
            <span className="ai-chat-input-hint">
              {settings.model ? settings.model.split('/').pop() : 'No model'}
            </span>
            {messages.length > 0 && (
              <span className="ai-chat-token-count">
                {messages.length} msg{messages.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* ─── Settings popup menu ─── */}
        {showSettingsMenu && (
          <div className="ai-chat-settings-popup" ref={settingsMenuRef}>
            <div className="ai-settings-popup-tabs">
              <button
                type="button"
                className={`ai-settings-popup-tab ${settingsMenuTab === 'general' ? 'active' : ''}`}
                onClick={() => setSettingsMenuTab('general')}
              >
                General
              </button>
              <button
                type="button"
                className={`ai-settings-popup-tab ${settingsMenuTab === 'model' ? 'active' : ''}`}
                onClick={() => setSettingsMenuTab('model')}
              >
                Model
              </button>
              <button
                type="button"
                className={`ai-settings-popup-tab ${settingsMenuTab === 'advanced' ? 'active' : ''}`}
                onClick={() => setSettingsMenuTab('advanced')}
              >
                Advanced
              </button>
            </div>

            <div className="ai-settings-popup-body">
              {/* ── General tab ── */}
              {settingsMenuTab === 'general' && (
                <>
                  <div className="ai-settings-popup-section">
                    <div className="ai-settings-popup-label">Mode</div>
                    <div className="ai-chat-mode-switch" role="tablist">
                      {(['qa', 'coder', 'autonomous'] as const).map(mode => (
                        <button
                          key={mode}
                          type="button"
                          className={`ai-chat-mode-button ${settings.mode === mode ? 'active' : ''}`}
                          onClick={() => updateSettings({ mode })}
                        >
                          {mode === 'qa' ? 'QA' : mode === 'coder' ? 'Coder' : 'Auto'}
                        </button>
                      ))}
                    </div>
                    <span className="ai-settings-popup-hint">
                      {settings.mode === 'qa' ? 'Read-only Q&A'
                        : settings.mode === 'coder' ? 'Can edit files and run commands'
                        : 'Plans, codes and validates autonomously'}
                    </span>
                  </div>

                  <div className="ai-settings-popup-section">
                    <div className="ai-settings-popup-label">Context</div>
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
                    >
                      <FiZap size={12} /> Smart Context
                    </button>
                    {autoContextEnabled && autoContextFiles.length > 0 && (
                      <div className="ai-chat-context-files-mini">
                        {autoContextFiles.map(file => (
                          <span key={file} className="ai-chat-context-chip" title={file}>{file}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="ai-settings-popup-section">
                    <div className="ai-settings-popup-label">
                      <FiShield size={12} /> Execution
                    </div>
                    <div className="ai-settings-popup-row">
                      <button
                        type="button"
                        className={`ai-chat-toggle ${!settings.yoloMode ? 'active' : ''}`}
                        onClick={() => { updateSettings({ yoloMode: false }); setShowYoloConfirm(false); }}
                      >
                        Safe
                      </button>
                      <button
                        type="button"
                        className={`ai-chat-toggle danger ${settings.yoloMode ? 'active' : ''}`}
                        onClick={() => {
                          if (settings.yoloMode) {
                            updateSettings({ yoloMode: false });
                            return;
                          }
                          setShowYoloConfirm(true);
                        }}
                      >
                        <FiZap size={11} /> YOLO
                      </button>
                    </div>
                    {showYoloConfirm && !settings.yoloMode && (
                      <div className="ai-yolo-confirm">
                        <div className="ai-yolo-confirm-icon"><FiAlertTriangle size={16} /></div>
                        <div className="ai-yolo-confirm-text">
                          <strong>Enable YOLO Mode?</strong>
                          <p>All file changes, deletions, and commands will execute immediately without any confirmation. This is fully unrestricted.</p>
                        </div>
                        <div className="ai-yolo-confirm-actions">
                          <button
                            type="button"
                            className="ai-yolo-confirm-btn cancel"
                            onClick={() => setShowYoloConfirm(false)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="ai-yolo-confirm-btn confirm"
                            onClick={() => {
                              updateSettings({ yoloMode: true });
                              setShowYoloConfirm(false);
                            }}
                          >
                            Enable YOLO
                          </button>
                        </div>
                      </div>
                    )}
                    {settings.yoloMode && (
                      <span className="ai-settings-popup-hint warning">
                        All actions execute without confirmation. Fully unrestricted.
                      </span>
                    )}
                  </div>
                </>
              )}

              {/* ── Model tab ── */}
              {settingsMenuTab === 'model' && (
                <>
                  <div className="ai-settings-popup-section">
                    <div className="ai-settings-popup-label">Model</div>
                    <div className="ai-settings-popup-row">
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
                      <button
                        className="ai-chat-icon-button"
                        type="button"
                        onClick={refreshModels}
                        title="Refresh Models"
                        disabled={isFetchingModels}
                      >
                        {isFetchingModels ? <LuLoader2 className="ai-chat-spinner" /> : <FiRefreshCw size={13} />}
                      </button>
                    </div>
                    <div className="ai-settings-popup-row">
                      <span className="ai-settings-popup-hint">
                        Tool Support: {' '}
                        <span style={{ color: toolCallSupported === true ? '#34d399' : toolCallSupported === false ? '#f87171' : '#6b7280' }}>
                          {toolCallSupported === true ? 'Supported' : toolCallSupported === false ? 'Not Supported' : 'Unknown'}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="ai-settings-popup-section">
                    <div className="ai-settings-popup-label">Endpoint</div>
                    <input
                      type="text"
                      className="ai-settings-popup-input"
                      value={settings.baseUrl}
                      onChange={e => updateSettings({ baseUrl: e.target.value })}
                      placeholder="http://localhost:1234"
                    />
                  </div>

                  <div className="ai-settings-popup-section">
                    <div className="ai-settings-popup-label">API Key</div>
                    <input
                      type="password"
                      className="ai-settings-popup-input"
                      value={settings.apiKey || ''}
                      onChange={e => updateSettings({ apiKey: e.target.value || undefined })}
                      placeholder="sk-..."
                    />
                  </div>
                </>
              )}

              {/* ── Advanced tab ── */}
              {settingsMenuTab === 'advanced' && (
                <>
                  <div className="ai-settings-popup-section">
                    <div className="ai-settings-popup-label">Temperature</div>
                    <input
                      type="range"
                      className="ai-settings-popup-range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={settings.temperature}
                      onChange={e => updateSettings({ temperature: parseFloat(e.target.value) || 0.7 })}
                    />
                    <span className="ai-settings-popup-range-value">{settings.temperature}</span>
                  </div>

                  <div className="ai-settings-popup-section">
                    <div className="ai-settings-popup-label">Max Tokens</div>
                    <input
                      type="number"
                      className="ai-settings-popup-input"
                      min="256"
                      max="128000"
                      step="256"
                      value={settings.maxTokens}
                      onChange={e => updateSettings({ maxTokens: parseInt(e.target.value) || 4096 })}
                    />
                  </div>

                  <div className="ai-settings-popup-section">
                    <div className="ai-settings-popup-label">Top P</div>
                    <input
                      type="range"
                      className="ai-settings-popup-range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={settings.topP}
                      onChange={e => updateSettings({ topP: parseFloat(e.target.value) || 1 })}
                    />
                    <span className="ai-settings-popup-range-value">{settings.topP}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
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
