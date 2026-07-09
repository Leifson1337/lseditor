/**
 * AIToolService - Provides tool execution capabilities for the AI chat.
 * Tools allow the AI to read/write files, run commands, search, etc.
 */

import { robustReplace } from './editReplace';
import { rankFiles, findSymbolReferences, IndexedFile } from './codebaseIndex';

const ipc = () => (window as any).electron?.ipcRenderer;

const AI_TOOL_IGNORES = ['node_modules', '.git', 'dist', 'build', 'out', 'coverage'];
const DEFAULT_READFILE_CHUNK_LINES = 800;

export interface EditorDiagnostic {
  file: string;
  severity: string;
  message: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  code?: string;
}

// Global diagnostics store - updated by editor marker change events
let _currentDiagnostics: EditorDiagnostic[] = [];

export function setCurrentDiagnostics(diagnostics: EditorDiagnostic[]): void {
  _currentDiagnostics = diagnostics;
}

export function getCurrentDiagnostics(): EditorDiagnostic[] {
  return _currentDiagnostics;
}

export function getErrorDiagnostics(): EditorDiagnostic[] {
  return _currentDiagnostics.filter(d => d.severity === 'error');
}

// Live todo/progress list maintained by the model via the updateTodoList tool.
// The chat UI registers a listener so updates render immediately.
export interface TodoItem {
  text: string;
  status: 'pending' | 'in_progress' | 'done';
}

let _todoUpdateListener: ((items: TodoItem[]) => void) | null = null;

export function setTodoUpdateListener(listener: ((items: TodoItem[]) => void) | null): void {
  _todoUpdateListener = listener;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string; enum?: string[]; items?: any }>;
      required: string[];
    };
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  tool_call_id: string;
  role: 'tool';
  content: string;
}

interface ToolExecutionOptions {
  signal?: AbortSignal;
  requestId?: string;
}

interface SearchWorkspaceArgs {
  path: string;
  query: string;
  searchMode?: 'filename' | 'content' | 'both';
  filePattern?: string;
  caseSensitive?: boolean;
  maxResults?: number;
  contextLines?: number;
}

export const AI_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'findFile',
      description: 'Find files by name or partial path inside the workspace. Use this first when the user mentions a file like test.py but the exact folder is unknown.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory to search in. Prefer the project root if unsure.' },
          query: { type: 'string', description: 'Filename or partial path to find, for example test.py or src/test.py' }
        },
        required: ['path', 'query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'readFile',
      description: 'Read the contents of a file. Reads up to 800 lines at once by default — read a generous window, do NOT make many tiny 20-30 line reads. For very large files use startLine/endLine to page through in big chunks. Lines are 1-indexed. Call readFile in parallel when you need several files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative file path to read' },
          startLine: { type: 'number', description: 'First line to read (1-indexed, inclusive). Omit to start from beginning.' },
          endLine: { type: 'number', description: 'Last line to read (1-indexed, inclusive). Omit to read until end.' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'writeFile',
      description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative file path to write' },
          content: { type: 'string', description: 'The content to write to the file' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'appendToFile',
      description: 'Append content to the end of a file. Use this to build larger files in small chunks after creating a small scaffold with writeFile.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative file path to append to' },
          content: { type: 'string', description: 'The content chunk to append to the file' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'replaceInFile',
      description: 'Apply a targeted replacement inside an existing file. Prefer this over writeFile for small or medium edits so you only send the changed snippet, not the whole file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative file path to edit' },
          search: { type: 'string', description: 'Exact existing text to find in the file' },
          replace: { type: 'string', description: 'Replacement text' },
          allOccurrences: { type: 'boolean', description: 'Replace all matches instead of only the first match' }
        },
        required: ['path', 'search', 'replace']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listFiles',
      description: 'List files and directories in the given directory path. If you are unsure, use the project root path. Do not pass a file path unless you want its parent directory to be used.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to list' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'searchFiles',
      description: 'Search for files by filename or by text content within a directory. If the pattern looks like a filename such as test.py, this tool should find matching file paths. Prefer the project root when you do not know the exact folder.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory to search in' },
          pattern: { type: 'string', description: 'Text or regex pattern to search for' },
          filePattern: { type: 'string', description: 'Optional glob pattern to filter files (e.g. "*.ts", "*.js")' }
        },
        required: ['path', 'pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'searchWorkspace',
      description: 'Search the workspace by filename, file content, or both. Supports case sensitivity, file globs, and capped result counts. Prefer this when the user asks for files with a certain name or content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory to search in. Prefer the project root if unsure.' },
          query: { type: 'string', description: 'Filename fragment, plain text, or regex-like query to search for.' },
          searchMode: {
            type: 'string',
            description: 'Whether to search file names, file content, or both.',
            enum: ['filename', 'content', 'both']
          },
          filePattern: { type: 'string', description: 'Optional glob-style file filter such as "*.ts" or "*.md".' },
          caseSensitive: { type: 'boolean', description: 'Whether matching should be case-sensitive. Defaults to false.' },
          maxResults: { type: 'number', description: 'Maximum number of matches to return. Defaults to 50 and is capped at 200.' },
          contextLines: { type: 'number', description: 'Lines of surrounding source to include around each content match (0-5, default 0). Use 2-3 to see matches in context and avoid a follow-up readFile.' }
        },
        required: ['path', 'query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'runCommand',
      description: 'Execute a shell command and return its output. Use for building, testing, git operations, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute' },
          cwd: { type: 'string', description: 'Working directory for the command (optional)' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'createDirectory',
      description: 'Create a new directory at the given path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to create' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'deleteFile',
      description: 'Delete a file or empty directory at the given path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file or directory to delete' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'renameFile',
      description: 'Rename or move a file from one path to another.',
      parameters: {
        type: 'object',
        properties: {
          oldPath: { type: 'string', description: 'Current file path' },
          newPath: { type: 'string', description: 'New file path' }
        },
        required: ['oldPath', 'newPath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getDiagnostics',
      description: 'Get current editor diagnostics (errors and warnings) for all open files or a specific file. Use this after making changes to verify correctness.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Optional file path to filter diagnostics for. If omitted, returns diagnostics for all open files.' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'applyPatch',
      description: 'Apply several edits across one or more files in a single atomic call. Each edit is a { path, search, replace } like replaceInFile. Either all edits apply or none do (on any failure nothing is written). Prefer this over many separate replaceInFile calls for a multi-file change.',
      parameters: {
        type: 'object',
        properties: {
          edits: {
            type: 'array',
            description: 'List of edits to apply atomically.',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path to edit.' },
                search: { type: 'string', description: 'Exact existing text to find (whitespace-tolerant matching is applied).' },
                replace: { type: 'string', description: 'Replacement text.' },
                allOccurrences: { type: 'boolean', description: 'Replace all matches in that file instead of the first.' }
              },
              required: ['path', 'search', 'replace']
            }
          }
        },
        required: ['edits']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'searchCodebase',
      description: 'Semantically-ranked search over the whole project. Give a natural-language description or symbol and get the most RELEVANT files with snippets, ranked by relevance (BM25 + filename boost). Use this FIRST to locate where a feature/bug lives when you do not know the file — better than plain text search.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What you are looking for — a description, feature name, or symbol.' },
          path: { type: 'string', description: 'Directory to search under. Defaults to the project root.' },
          maxResults: { type: 'number', description: 'How many ranked files to return (default 8, max 20).' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'findReferences',
      description: 'Find every whole-word reference to a symbol (function, variable, class, type) across the project, with surrounding context. Use to see where something is defined and used before changing it.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Exact symbol name to find, e.g. "getUserName".' },
          path: { type: 'string', description: 'Directory to search under. Defaults to the project root.' },
          maxResults: { type: 'number', description: 'Maximum references to return (default 60, max 200).' }
        },
        required: ['symbol']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'webFetch',
      description: 'Fetch a web page or API URL and return its readable text content (HTML is stripped to text). Use this to read up-to-date library docs, API references, or a URL the user provided. Only use http(s) URLs.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Absolute http(s) URL to fetch.' },
          maxChars: { type: 'number', description: 'Maximum characters of text to return (default 20000, max 60000).' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'updateTodoList',
      description: 'Maintain a visible todo/progress list for multi-step tasks. Send the FULL updated list every time something changes: when you plan the steps, when you start a step (in_progress), and when you finish one (done). Keep exactly one item in_progress at a time. Skip this tool for trivial single-step requests.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'The complete, updated todo list (full replacement, not a diff).',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'Short description of the step' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'done'], description: 'Current status of the step' }
              },
              required: ['text', 'status']
            }
          }
        },
        required: ['items']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'spawnSubAgent',
      description: 'Spawn an isolated sub-agent to work on a specific sub-task in parallel. The sub-agent runs with its own context and returns its result. Use this when you want to delegate a focused task to another agent while you continue with other work.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'The specific task for the sub-agent to complete' },
          systemPrompt: { type: 'string', description: 'Custom instructions / persona for this sub-agent. Be specific about what files it should touch and what it must avoid.' }
        },
        required: ['task', 'systemPrompt']
      }
    }
  }
];

function resolvePath(filePath: string, projectPath?: string): string {
  if (!filePath) return '';
  // If it's already absolute, use as-is
  if (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('/')) {
    return filePath;
  }
  // Relative path - join with project path
  if (projectPath) {
    return `${projectPath.replace(/[\\/]$/, '')}/${filePath.replace(/^\.[\\/]/, '')}`;
  }
  return filePath;
}

function normalizePath(value: string): string {
  return String(value || '').replace(/\\/g, '/');
}

function isInsideProjectPath(targetPath: string, projectPath?: string): boolean {
  if (!projectPath) return true;
  const normalizedProject = normalizePath(projectPath).replace(/\/+$/, '').toLowerCase();
  const normalizedTarget = normalizePath(targetPath).toLowerCase();
  return (
    normalizedTarget === normalizedProject ||
    normalizedTarget.startsWith(`${normalizedProject}/`)
  );
}

function ensureToolPathWithinProject(targetPath: string, projectPath?: string): string | null {
  if (!targetPath) return 'Error: Missing path.';
  if (!projectPath) return null;
  return isInsideProjectPath(targetPath, projectPath)
    ? null
    : `Error: Path is outside the current workspace: ${targetPath}`;
}

function notifyFileChanged(filePath: string) {
  window.dispatchEvent(new CustomEvent('editor:fileChanged', { detail: filePath }));
  window.dispatchEvent(new CustomEvent('editor:openFile', { detail: filePath }));
  window.dispatchEvent(new Event('explorer:refresh'));
}

function quoteWindowsCommandPath(command: string): string {
  const trimmed = String(command || '').trim();
  const match = trimmed.match(/^(python(?:\d+(?:\.\d+)?)?|py(?:\s+-\d+(?:\.\d+)?)?|node)\s+([A-Za-z]:\\[^"\r\n]+?\.[A-Za-z0-9]+)(.*)$/i);
  if (!match) return trimmed;

  const [, executable, scriptPath, rest] = match;
  if (scriptPath.includes(' ') && !scriptPath.startsWith('"')) {
    return `${executable} "${scriptPath}"${rest || ''}`;
  }

  return trimmed;
}

function normalizeForMatch(target: string): string {
  return String(target || '')
    .replace(/\\/g, '/')
    .replace(/^[a-zA-Z]:/, '')
    .replace(/\/+/g, '/')
    .toLowerCase()
    .trim();
}

function basenameOf(target: string): string {
  const normalized = String(target || '').replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function dirnameOf(target: string): string {
  const normalized = String(target || '').replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  if (index <= 0) {
    return normalized;
  }
  return normalized.slice(0, index);
}

function looksLikeFilenameQuery(target: string): boolean {
  const normalized = String(target || '').trim();
  if (!normalized) return false;
  if (/[\\/]/.test(normalized)) return true;
  if (/\.[a-z0-9]{1,8}$/i.test(normalized)) return true;
  if (!/[.*+?^${}()|[\]\\]/.test(normalized) && !/\s{2,}/.test(normalized)) return true;
  return false;
}

function matchesFileGlob(filePath: string, fileGlob?: string): boolean {
  if (!fileGlob) return true;
  const trimmedGlob = String(fileGlob).trim();
  if (!trimmedGlob) return true;
  if (trimmedGlob === '*') return true;

  const normalizedPath = normalizePath(filePath).toLowerCase();
  const escaped = trimmedGlob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const matcher = new RegExp(`^${escaped}$`, 'i');
  return matcher.test(normalizedPath) || matcher.test(basenameOf(normalizedPath));
}

function scorePathCandidate(requested: string, candidate: string): number {
  const requestedParts = normalizeForMatch(requested).split('/').filter(Boolean);
  const candidateParts = normalizeForMatch(candidate).split('/').filter(Boolean);

  let suffixMatches = 0;
  while (
    suffixMatches < requestedParts.length &&
    suffixMatches < candidateParts.length &&
    requestedParts[requestedParts.length - 1 - suffixMatches] ===
      candidateParts[candidateParts.length - 1 - suffixMatches]
  ) {
    suffixMatches += 1;
  }

  const sameBasename = basenameOf(requested).toLowerCase() === basenameOf(candidate).toLowerCase() ? 10 : 0;
  const exactSuffix = normalizeForMatch(candidate).endsWith(normalizeForMatch(requested)) ? 25 : 0;

  return suffixMatches * 5 + sameBasename + exactSuffix;
}

async function resolveExistingPath(
  renderer: { invoke: (channel: string, ...args: any[]) => Promise<any> },
  filePath: string,
  projectPath?: string
): Promise<{ resolvedPath: string; guessed: boolean }> {
  const resolvedPath = resolvePath(filePath, projectPath);
  const exists = await renderer.invoke('fs:exists', resolvedPath);
  if (exists) {
    return { resolvedPath, guessed: false };
  }

  if (!projectPath) {
    return { resolvedPath, guessed: false };
  }

  const files = await renderer.invoke('fs:listFilesRecursive', projectPath, { ignore: AI_TOOL_IGNORES });
  if (!Array.isArray(files) || files.length === 0) {
    return { resolvedPath, guessed: false };
  }

  const requestedNormalized = normalizeForMatch(filePath);
  const requestedBase = basenameOf(filePath).toLowerCase();

  const candidates = files
    .filter((candidate: string) => {
      const normalizedCandidate = normalizeForMatch(candidate);
      return (
        normalizedCandidate.endsWith(requestedNormalized) ||
        basenameOf(candidate).toLowerCase() === requestedBase
      );
    })
    .map((candidate: string) => ({
      candidate,
      score: scorePathCandidate(filePath, candidate)
    }))
    .sort((a, b) => b.score - a.score || a.candidate.length - b.candidate.length);

  if (candidates.length === 0 || candidates[0].score <= 0) {
    return { resolvedPath, guessed: false };
  }

  return { resolvedPath: candidates[0].candidate, guessed: true };
}

function buildWorkspaceSearchRegex(query: string, caseSensitive: boolean): RegExp {
  const flags = caseSensitive ? 'g' : 'gi';
  try {
    return new RegExp(query, flags);
  } catch {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped, flags);
  }
}

async function executeWorkspaceSearch(
  renderer: { invoke: (channel: string, ...args: any[]) => Promise<any> },
  args: SearchWorkspaceArgs,
  projectPath?: string
): Promise<string> {
  const {
    path: inputPath,
    query,
    searchMode = 'both',
    filePattern,
    caseSensitive = false
  } = args;
  const maxResults = Math.max(1, Math.min(200, Math.floor(Number(args.maxResults) || 50)));
  const contextLines = Math.max(0, Math.min(5, Math.floor(Number(args.contextLines) ?? 0)));
  const { directoryPath, adjustedFrom } = await resolveDirectoryPath(renderer, inputPath, projectPath);
  const workspaceError = ensureToolPathWithinProject(directoryPath, projectPath);
  if (workspaceError) {
    return workspaceError;
  }

  const files = await renderer.invoke('fs:listFilesRecursive', directoryPath, { ignore: AI_TOOL_IGNORES });
  if (!Array.isArray(files) || files.length === 0) {
    return 'No files found';
  }

  const regex = buildWorkspaceSearchRegex(String(query ?? ''), caseSensitive);
  const normalizedQuery = caseSensitive
    ? String(query ?? '').trim()
    : String(query ?? '').trim().toLowerCase();
  const results: string[] = [];

  for (const file of files) {
    if (results.length >= maxResults) break;
    if (!matchesFileGlob(file, filePattern)) continue;

    const relative = normalizePath(file.replace(directoryPath, '').replace(/^[\\/]/, ''));
    const comparableRelative = caseSensitive ? relative : relative.toLowerCase();

    if (searchMode === 'filename' || searchMode === 'both') {
      regex.lastIndex = 0;
      if (
        (normalizedQuery && comparableRelative.includes(normalizedQuery)) ||
        regex.test(relative)
      ) {
        results.push(`${relative}: filename match`);
        if (searchMode === 'filename') continue;
      }
    }

    if (searchMode === 'content' || searchMode === 'both') {
      try {
        const content = await renderer.invoke('fs:readFile', file);
        if (typeof content !== 'string') continue;
        const lines = content.split('\n');
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          regex.lastIndex = 0;
          if (regex.test(line)) {
            if (contextLines > 0) {
              // Emit the hit with ±contextLines of surrounding source so the
              // model can act without a follow-up readFile round-trip.
              const from = Math.max(0, index - contextLines);
              const to = Math.min(lines.length - 1, index + contextLines);
              const block: string[] = [`${relative}:${index + 1}:`];
              for (let ci = from; ci <= to; ci += 1) {
                const marker = ci === index ? '>' : ' ';
                block.push(`${marker} ${String(ci + 1).padStart(5, ' ')}| ${lines[ci].slice(0, 240)}`);
              }
              results.push(block.join('\n'));
            } else {
              results.push(`${relative}:${index + 1}: ${line.trim().slice(0, 240)}`);
            }
            if (results.length >= maxResults) break;
          }
        }
      } catch {
        // Ignore unreadable files and continue.
      }
    }
  }

  const prefix = adjustedFrom ? `[Adjusted search path from ${adjustedFrom} to ${directoryPath}]\n` : '';
  return `${prefix}${results.length ? results.join('\n') : 'No matches found'}`;
}

// Source extensions worth indexing for codebase search / references. Keeps the
// index focused on code and avoids reading giant binary/asset files.
const INDEXABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cc',
  '.cs', '.php', '.swift', '.scala', '.sh', '.bash', '.ps1',
  '.json', '.yaml', '.yml', '.toml', '.md', '.txt', '.css', '.scss', '.less',
  '.html', '.vue', '.svelte', '.sql', '.graphql', '.proto'
]);

const MAX_INDEX_FILES = 1500;
const MAX_INDEX_FILE_BYTES = 200000;

// Read a bounded set of source files under a directory for in-memory indexing.
async function collectWorkspaceFiles(
  renderer: { invoke: (channel: string, ...args: any[]) => Promise<any> },
  directoryPath: string
): Promise<IndexedFile[]> {
  const files = await renderer.invoke('fs:listFilesRecursive', directoryPath, { ignore: AI_TOOL_IGNORES });
  if (!Array.isArray(files) || files.length === 0) return [];
  const candidates = files
    .filter((f: string) => INDEXABLE_EXTENSIONS.has((f.match(/\.[^.\\/:]+$/) || [''])[0].toLowerCase()))
    .slice(0, MAX_INDEX_FILES);

  const indexed: IndexedFile[] = [];
  // Read in modest batches to avoid flooding IPC.
  const BATCH = 40;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const contents = await Promise.all(
      batch.map(async (file: string) => {
        try {
          const content = await renderer.invoke('fs:readFile', file);
          if (typeof content !== 'string' || content.length > MAX_INDEX_FILE_BYTES) return null;
          return { file, content };
        } catch {
          return null;
        }
      })
    );
    for (const c of contents) {
      if (!c) continue;
      const relative = normalizePath(c.file.replace(directoryPath, '').replace(/^[\\/]/, ''));
      indexed.push({ path: relative || c.file, content: c.content });
    }
  }
  return indexed;
}

async function resolveDirectoryPath(
  renderer: { invoke: (channel: string, ...args: any[]) => Promise<any> },
  inputPath: string,
  projectPath?: string
): Promise<{ directoryPath: string; adjustedFrom?: string }> {
  const resolved = resolvePath(inputPath, projectPath);
  const stat = await renderer.invoke('fs:stat', resolved);

  if (stat?.type === 'directory') {
    return { directoryPath: resolved };
  }

  if (stat?.type === 'file') {
    return { directoryPath: dirnameOf(resolved), adjustedFrom: resolved };
  }

  if (projectPath) {
    return { directoryPath: projectPath, adjustedFrom: resolved };
  }

  return { directoryPath: resolved };
}

async function findMatchingFiles(
  renderer: { invoke: (channel: string, ...args: any[]) => Promise<any> },
  inputPath: string,
  query: string,
  projectPath?: string
): Promise<{ matches: string[]; adjustedFrom?: string; directoryPath: string }> {
  const { directoryPath, adjustedFrom } = await resolveDirectoryPath(renderer, inputPath, projectPath);
  const files = await renderer.invoke('fs:listFilesRecursive', directoryPath, { ignore: AI_TOOL_IGNORES });
  if (!Array.isArray(files) || files.length === 0) {
    return { matches: [], adjustedFrom, directoryPath };
  }

  const normalizedQuery = normalizeForMatch(query);
  const queryBase = basenameOf(query).toLowerCase();

  const matches = files
    .map((candidate: string) => ({
      candidate,
      normalized: normalizeForMatch(candidate),
      basename: basenameOf(candidate).toLowerCase(),
      score: scorePathCandidate(query, candidate)
    }))
    .filter(candidate =>
      candidate.normalized.includes(normalizedQuery) || candidate.basename === queryBase
    )
    .sort((a, b) => b.score - a.score || a.candidate.length - b.candidate.length)
    .slice(0, 20)
    .map(candidate => candidate.candidate);

  return { matches, adjustedFrom, directoryPath };
}

export async function executeToolCall(
  toolCall: ToolCall,
  projectPath?: string,
  options?: ToolExecutionOptions
): Promise<ToolResult> {
  const renderer = ipc();
  if (!renderer) {
    return {
      tool_call_id: toolCall.id,
      role: 'tool',
      content: 'Error: IPC renderer not available'
    };
  }

  try {
    let args: any;
    try {
      args = JSON.parse(toolCall.function.arguments || '{}');
    } catch (parseError) {
      // Try to salvage common malformed JSON from models
      const raw = (toolCall.function.arguments || '').trim();
      // Fix trailing commas before } or ]
      const sanitized = raw.replace(/,\s*([}\]])/g, '$1');
      try {
        args = JSON.parse(sanitized);
      } catch {
        return {
          tool_call_id: toolCall.id,
          role: 'tool',
          content: `Error: Malformed JSON in ${toolCall.function.name} arguments. The arguments must be valid JSON with LITERAL values — every value must be a real string/number, never a variable, placeholder or expression (e.g. "content": chunk is invalid; write the actual file text as a JSON string: "content": "line1\\nline2"). Do not write code that builds the arguments. Received: ${raw.slice(0, 200)}${raw.length > 200 ? '...' : ''}. Retry the tool call with valid JSON.`
        };
      }
    }
    if (typeof args !== 'object' || args === null) {
      args = {};
    }
    let result: string;

    switch (toolCall.function.name) {
      case 'updateTodoList': {
        const rawItems = Array.isArray(args.items) ? args.items : null;
        if (!rawItems || rawItems.length === 0) {
          result = 'Error: updateTodoList requires a non-empty "items" array with the FULL current list, e.g. {"items": [{"text": "Read config", "status": "done"}, {"text": "Fix bug", "status": "in_progress"}]}.';
          break;
        }
        const items: TodoItem[] = [];
        for (const raw of rawItems.slice(0, 30)) {
          const text =
            typeof raw === 'string'
              ? raw.trim()
              : typeof raw?.text === 'string'
                ? raw.text.trim()
                : '';
          if (!text) continue;
          const status: TodoItem['status'] =
            raw?.status === 'done' || raw?.status === 'in_progress' ? raw.status : 'pending';
          items.push({ text: text.slice(0, 200), status });
        }
        if (items.length === 0) {
          result = 'Error: updateTodoList received no valid items. Each item needs a non-empty "text" and a "status" of pending, in_progress, or done.';
          break;
        }
        _todoUpdateListener?.(items);
        const doneCount = items.filter(item => item.status === 'done').length;
        const active = items.find(item => item.status === 'in_progress');
        result = `Todo list updated: ${doneCount}/${items.length} done${active ? `, in progress: ${active.text}` : ''}.`;
        break;
      }

      case 'findFile': {
        const inputPath = resolvePath(args.path, projectPath);
        const workspaceError = ensureToolPathWithinProject(inputPath, projectPath);
        if (workspaceError) {
          result = workspaceError;
          break;
        }
        const { matches, adjustedFrom, directoryPath } = await findMatchingFiles(
          renderer,
          args.path,
          args.query,
          projectPath
        );
        const prefix = adjustedFrom ? `[Adjusted search path from ${adjustedFrom} to ${directoryPath}]\n` : '';
        result = `${prefix}${matches.length ? matches.join('\n') : `No files found matching: ${args.query}`}`;
        break;
      }

      case 'readFile': {
        const { resolvedPath, guessed } = await resolveExistingPath(renderer, args.path, projectPath);
        const workspaceError = ensureToolPathWithinProject(resolvedPath, projectPath);
        if (workspaceError) {
          result = workspaceError;
          break;
        }
        const content = await renderer.invoke('fs:readFile', resolvedPath);
        if (content === null || content === undefined) {
          result = `Error: File not found: ${resolvedPath}`;
        } else {
          const prefix = guessed ? `[Resolved from ${args.path} to ${resolvedPath}]\n` : '';
          const text = typeof content === 'string' ? content : String(content);
          if (text.length === 0) {
            result = `${prefix}(empty file: ${resolvedPath})`;
          } else {
            const allLines = text.split('\n');
            const totalLines = allLines.length;
            const hasRange = args.startLine != null || args.endLine != null;
            const start = Math.max(1, Math.floor(Number(args.startLine) || 1));
            const defaultEnd = hasRange ? totalLines : Math.min(totalLines, DEFAULT_READFILE_CHUNK_LINES);
            const end = Math.min(totalLines, Math.floor(Number(args.endLine) || defaultEnd));
            const sliced = allLines.slice(start - 1, end);
            const numbered = sliced.map((line: string, i: number) => `${String(start + i).padStart(4, ' ')}| ${line}`).join('\n');

            const remainingLines = totalLines - end;
            if (hasRange) {
              const rangeNote = remainingLines > 0
                ? ` (${remainingLines} lines remaining, next: startLine=${end + 1} endLine=${Math.min(totalLines, end + DEFAULT_READFILE_CHUNK_LINES)})`
                : '';
              result = `${prefix}[Lines ${start}-${end} of ${totalLines}${rangeNote}]\n${numbered}`;
            } else {
              const continuationNote =
                remainingLines > 0
                  ? `\n[Showing ${end} of ${totalLines} lines. ${remainingLines} remaining. Next chunk: readFile with startLine=${end + 1} endLine=${Math.min(totalLines, end + DEFAULT_READFILE_CHUNK_LINES)}]`
                  : '';
              result = `${prefix}[Lines 1-${end} of ${totalLines}]\n${numbered}${continuationNote}`;
            }
          }
        }
        break;
      }

      case 'writeFile': {
        const fullPath = resolvePath(args.path, projectPath);
        const workspaceError = ensureToolPathWithinProject(fullPath, projectPath);
        if (workspaceError) {
          result = workspaceError;
          break;
        }
        const contentToWrite = typeof args.content === 'string' ? args.content : String(args.content ?? '');
        const writeSucceeded = await renderer.invoke('fs:writeFile', fullPath, contentToWrite);
        if (!writeSucceeded) {
          result = `Error: Failed to write file: ${fullPath}`;
          break;
        }
        notifyFileChanged(fullPath);
        const lineCount = contentToWrite.split('\n').length;
        result = `File written successfully: ${fullPath} (${lineCount} lines)`;
        break;
      }

      case 'appendToFile': {
        const fullPath = resolvePath(args.path, projectPath);
        const workspaceError = ensureToolPathWithinProject(fullPath, projectPath);
        if (workspaceError) {
          result = workspaceError;
          break;
        }
        const exists = await renderer.invoke('fs:exists', fullPath);
        if (!exists) {
          result = `Error: File not found: ${fullPath}. Create it first with writeFile.`;
          break;
        }
        const appendContent = typeof args.content === 'string' ? args.content : String(args.content ?? '');
        const appendSucceeded = await renderer.invoke('fs:appendFile', fullPath, appendContent);
        if (!appendSucceeded) {
          result = `Error: Failed to append to file: ${fullPath}`;
          break;
        }
        notifyFileChanged(fullPath);
        const appendedLines = appendContent.split('\n').length;
        result = `Appended ${appendedLines} lines to: ${fullPath}`;
        break;
      }

      case 'replaceInFile': {
        const { resolvedPath, guessed } = await resolveExistingPath(renderer, args.path, projectPath);
        const workspaceError = ensureToolPathWithinProject(resolvedPath, projectPath);
        if (workspaceError) {
          result = workspaceError;
          break;
        }
        const rawContent = await renderer.invoke('fs:readFile', resolvedPath);
        const fileExists = typeof rawContent === 'string';
        const content = fileExists ? rawContent : '';

        const search = String(args.search ?? '');
        const replace = String(args.replace ?? '');

        // Robustness for weaker models: replaceInFile with an empty search is a
        // common way they (mis)use the tool to *create* a file. Treat an empty
        // search against a missing or empty file as a create/write instead of
        // erroring, so the user's intent still succeeds.
        if (!search) {
          if (!fileExists || content.trim() === '') {
            const created = await renderer.invoke('fs:writeFile', resolvedPath, replace);
            if (!created) {
              result = `Error: Failed to create ${resolvedPath}`;
              break;
            }
            notifyFileChanged(resolvedPath);
            window.dispatchEvent(new Event('explorer:refresh'));
            const prefix0 = guessed ? `[Resolved from ${args.path} to ${resolvedPath}] ` : '';
            result = `${prefix0}Created ${resolvedPath} (${replace.split('\n').length} lines)`;
            break;
          }
          result = 'Error: replaceInFile requires a non-empty search string when the file already has content. Use writeFile to overwrite, or provide the exact text to replace.';
          break;
        }

        if (!fileExists) {
          result = `Error: File not found: ${resolvedPath}. Use writeFile to create new files.`;
          break;
        }
        if (search === replace) {
          result = `Error: search and replace text are identical - no change would occur. You must provide different text for the replacement. Read the file again to find the correct text to change.`;
          break;
        }

        const replaceAll = Boolean(args.allOccurrences);

        // Robust cascading match (exact → line-trimmed → block-anchor →
        // whitespace/indentation/escape-normalized → context-aware → …). This
        // rescues the common case where the model's search text is off by
        // whitespace or indentation, instead of failing the edit outright.
        const outcome = robustReplace(content, search, replace, replaceAll);
        if (!outcome.ok || outcome.content === undefined) {
          const totalLines = content.split('\n').length;
          const searchPreview = search.length > 80 ? search.slice(0, 80) + '...' : search;
          const searchLines = search.split('\n').length;
          result = `Error editing ${resolvedPath} (file has ${totalLines} lines). ${outcome.error} Search (${searchLines} line(s)): "${searchPreview}"`;
          break;
        }
        const updatedContent = outcome.content;
        const replacements = outcome.replacements ?? 0;
        const replacementMode = outcome.strategy ?? 'exact';

        if (updatedContent === content) {
          result = `Error: No changes applied in ${resolvedPath}: the replacement produced identical content. Make sure your replace text is actually different from the search text.`;
          break;
        }

        const writeSucceeded = await renderer.invoke('fs:writeFile', resolvedPath, updatedContent);
        if (!writeSucceeded) {
          result = `Error: Failed to write updated content to ${resolvedPath}`;
          break;
        }
        notifyFileChanged(resolvedPath);
        const prefix = guessed ? `[Resolved from ${args.path} to ${resolvedPath}] ` : '';
        const modeSuffix = replacementMode !== 'exact' ? `, matched via ${replacementMode}` : '';
        result = `${prefix}Updated ${resolvedPath} (${replacements} replacement${replacements === 1 ? '' : 's'}${modeSuffix})`;
        break;
      }

      case 'listFiles': {
        const { directoryPath, adjustedFrom } = await resolveDirectoryPath(renderer, args.path, projectPath);
        const workspaceError = ensureToolPathWithinProject(directoryPath, projectPath);
        if (workspaceError) {
          result = workspaceError;
          break;
        }
        const entries = await renderer.invoke('fs:readDir', directoryPath);
        if (!entries || !Array.isArray(entries)) {
          result = `Error: Cannot list directory: ${directoryPath}`;
        } else {
          const formatted = entries.map((e: { name: string; isDirectory: boolean }) =>
            `${e.isDirectory ? '[DIR]' : '[FILE]'} ${e.name}`
          );
          const prefix = adjustedFrom ? `[Adjusted search path from ${adjustedFrom} to ${directoryPath}]\n` : '';
          result = `${prefix}${formatted.join('\n') || '(empty directory)'}`;
        }
        break;
      }

      case 'searchFiles': {
        const rawPattern = String(args.pattern ?? '').trim();
        const filenameMode = looksLikeFilenameQuery(rawPattern);
        result = await executeWorkspaceSearch(
          renderer,
          {
            path: args.path,
            query: rawPattern,
            searchMode: filenameMode ? 'filename' : 'both',
            filePattern: args.filePattern,
            caseSensitive: false,
            maxResults: 50
          },
          projectPath
        );
        break;
      }

      case 'searchWorkspace': {
        result = await executeWorkspaceSearch(renderer, args as SearchWorkspaceArgs, projectPath);
        break;
      }

      case 'runCommand': {
        const normalizedCommand = quoteWindowsCommandPath(String(args.command ?? ''));
        const requestId = options?.requestId || toolCall.id;
        const targetCwd = args.cwd ? resolvePath(args.cwd, projectPath) : projectPath;
        const cwdError = targetCwd ? ensureToolPathWithinProject(targetCwd, projectPath) : null;
        if (cwdError) {
          result = cwdError;
          break;
        }
        const abortHandler = () => {
          renderer.invoke('exec:kill', requestId).catch(() => undefined);
        };
        options?.signal?.addEventListener('abort', abortHandler, { once: true });
        let execResult: any;
        try {
          execResult = await renderer.invoke('exec', normalizedCommand, {
            cwd: targetCwd,
            requestId
          });
        } finally {
          options?.signal?.removeEventListener('abort', abortHandler);
        }
        if (execResult && typeof execResult === 'object') {
          const MAX_CMD_OUTPUT = 8000;
          const truncate = (text: string, limit: number) => {
            if (!text || text.length <= limit) return text;
            const half = Math.floor(limit / 2) - 30;
            const skipped = text.length - limit + 60;
            return `${text.slice(0, half)}\n\n... (${skipped} characters truncated) ...\n\n${text.slice(-half)}`;
          };
          const parts: string[] = [];
          parts.push(`[command] ${normalizedCommand}`);
          if (execResult.stdout) parts.push(truncate(execResult.stdout, MAX_CMD_OUTPUT));
          if (execResult.stderr) parts.push(`[stderr] ${truncate(execResult.stderr, MAX_CMD_OUTPUT / 2)}`);
          if (execResult.error) parts.push(`[error] ${execResult.error}`);
          result = parts.length > 0 ? parts.join('\n') : '(no output)';
          if (execResult.code !== 0 && execResult.code !== undefined) {
            result += `\n[exit code: ${execResult.code}]`;
          }
        } else {
          result = String(execResult || '(no output)');
        }
        break;
      }

      case 'createDirectory': {
        const fullPath = resolvePath(args.path, projectPath);
        const workspaceError = ensureToolPathWithinProject(fullPath, projectPath);
        if (workspaceError) {
          result = workspaceError;
          break;
        }
        await renderer.invoke('fs:createDirectory', fullPath);
        window.dispatchEvent(new Event('explorer:refresh'));
        result = `Directory created: ${fullPath}`;
        break;
      }

      case 'deleteFile': {
        const fullPath = resolvePath(args.path, projectPath);
        const workspaceError = ensureToolPathWithinProject(fullPath, projectPath);
        if (workspaceError) {
          result = workspaceError;
          break;
        }
        const stat = await renderer.invoke('fs:stat', fullPath);
        if (stat?.type === 'directory') {
          await renderer.invoke('fs:deleteDirectory', fullPath, false);
        } else {
          await renderer.invoke('fs:deleteFile', fullPath);
        }
        window.dispatchEvent(new CustomEvent('editor:fileChanged', { detail: fullPath }));
        window.dispatchEvent(new Event('explorer:refresh'));
        result = `Deleted: ${fullPath}`;
        break;
      }

      case 'renameFile': {
        const oldFull = resolvePath(args.oldPath, projectPath);
        const newFull = resolvePath(args.newPath, projectPath);
        const oldError = ensureToolPathWithinProject(oldFull, projectPath);
        if (oldError) {
          result = oldError;
          break;
        }
        const newError = ensureToolPathWithinProject(newFull, projectPath);
        if (newError) {
          result = newError;
          break;
        }
        await renderer.invoke('fs:renameFile', oldFull, newFull);
        window.dispatchEvent(new Event('explorer:refresh'));
        result = `Renamed ${oldFull} -> ${newFull}`;
        break;
      }

      case 'getDiagnostics': {
        const diagnostics = getCurrentDiagnostics();
        const filterPath = args.path ? resolvePath(args.path, projectPath).replace(/\\/g, '/').toLowerCase() : '';
        const filtered = filterPath
          ? diagnostics.filter((d: any) => d.file.toLowerCase().includes(filterPath.split(/[\\/]/).pop() || ''))
          : diagnostics;
        if (!filtered.length) {
          result = 'No diagnostics (errors or warnings) found.';
        } else {
          const lines = filtered.map((d: any) =>
            `[${d.severity.toUpperCase()}] ${d.file}:${d.startLine}:${d.startColumn} - ${d.message}${d.code ? ` (${d.code})` : ''}`
          );
          result = `Found ${filtered.length} diagnostic(s):\n${lines.join('\n')}`;
        }
        break;
      }

      case 'applyPatch': {
        const edits = Array.isArray(args.edits) ? args.edits : null;
        if (!edits || edits.length === 0) {
          result = 'Error: applyPatch requires a non-empty "edits" array of { path, search, replace }.';
          break;
        }
        // Phase 1: resolve + compute every edit WITHOUT writing. Abort on any
        // failure. Multiple edits to the SAME file stack on a shared working
        // copy so an earlier edit is not lost by a later one.
        const working = new Map<string, string>();
        const perFileReplacements = new Map<string, number>();
        const editOrder: string[] = [];
        let patchError = '';
        for (let i = 0; i < edits.length; i += 1) {
          const edit = edits[i] || {};
          const rawPath = String(edit.path || '');
          if (!rawPath) { patchError = `edit #${i + 1} is missing "path".`; break; }
          const { resolvedPath } = await resolveExistingPath(renderer, rawPath, projectPath);
          const workspaceError = ensureToolPathWithinProject(resolvedPath, projectPath);
          if (workspaceError) { patchError = `edit #${i + 1} (${rawPath}): ${workspaceError}`; break; }
          if (!working.has(resolvedPath)) {
            const fileContent = await renderer.invoke('fs:readFile', resolvedPath);
            if (typeof fileContent !== 'string') { patchError = `edit #${i + 1}: file not found: ${resolvedPath}.`; break; }
            working.set(resolvedPath, fileContent);
            perFileReplacements.set(resolvedPath, 0);
            editOrder.push(resolvedPath);
          }
          const search = String(edit.search ?? '');
          const replace = String(edit.replace ?? '');
          const outcome = robustReplace(working.get(resolvedPath)!, search, replace, Boolean(edit.allOccurrences));
          if (!outcome.ok || outcome.content === undefined) {
            patchError = `edit #${i + 1} (${rawPath}): ${outcome.error}`;
            break;
          }
          working.set(resolvedPath, outcome.content);
          perFileReplacements.set(resolvedPath, (perFileReplacements.get(resolvedPath) || 0) + (outcome.replacements ?? 0));
        }
        if (patchError) {
          result = `Error applying patch — nothing was written. ${patchError} Fix that edit and resend the full patch.`;
          break;
        }
        // Phase 2: all edits computed — write each file once.
        const planned = editOrder.map(resolvedPath => ({
          resolvedPath,
          updated: working.get(resolvedPath)!,
          replacements: perFileReplacements.get(resolvedPath) || 0
        }));
        const written: string[] = [];
        let writeError = '';
        for (const p of planned) {
          const ok = await renderer.invoke('fs:writeFile', p.resolvedPath, p.updated);
          if (!ok) {
            writeError = `Error: patch partially failed while writing ${p.resolvedPath}. Files written before this point: ${written.join(', ') || 'none'}. Re-read affected files before retrying.`;
            break;
          }
          notifyFileChanged(p.resolvedPath);
          written.push(p.resolvedPath);
        }
        if (writeError) {
          result = writeError;
        } else {
          window.dispatchEvent(new Event('explorer:refresh'));
          result = `Patch applied: ${written.length} file(s) updated.\n${written.map((w, i) => `- ${w} (${planned[i].replacements} replacement${planned[i].replacements === 1 ? '' : 's'})`).join('\n')}`;
        }
        break;
      }

      case 'searchCodebase': {
        const query = String(args.query || '').trim();
        if (!query) { result = 'Error: searchCodebase requires a "query".'; break; }
        const limit = Math.max(1, Math.min(20, Math.floor(Number(args.maxResults) || 8)));
        const { directoryPath, adjustedFrom } = await resolveDirectoryPath(renderer, args.path, projectPath);
        const wsError = ensureToolPathWithinProject(directoryPath, projectPath);
        if (wsError) { result = wsError; break; }
        const indexed = await collectWorkspaceFiles(renderer, directoryPath);
        if (indexed.length === 0) { result = 'No indexable source files found under the search path.'; break; }
        const ranked = rankFiles(indexed, query, limit);
        if (ranked.length === 0) {
          result = `No relevant files found for: ${query}`;
          break;
        }
        const prefix = adjustedFrom ? `[Adjusted search path from ${adjustedFrom} to ${directoryPath}]\n` : '';
        result = `${prefix}Top ${ranked.length} relevant file(s) for "${query}" (of ${indexed.length} indexed):\n\n` +
          ranked.map(r => `### ${r.path}  (score ${r.score.toFixed(1)})\n${r.snippet}`).join('\n\n');
        break;
      }

      case 'findReferences': {
        const symbol = String(args.symbol || '').trim();
        if (!symbol) { result = 'Error: findReferences requires a "symbol".'; break; }
        const maxHits = Math.max(1, Math.min(200, Math.floor(Number(args.maxResults) || 60)));
        const { directoryPath, adjustedFrom } = await resolveDirectoryPath(renderer, args.path, projectPath);
        const wsError = ensureToolPathWithinProject(directoryPath, projectPath);
        if (wsError) { result = wsError; break; }
        const indexed = await collectWorkspaceFiles(renderer, directoryPath);
        const hits = findSymbolReferences(indexed, symbol, 1, maxHits);
        const prefix = adjustedFrom ? `[Adjusted search path from ${adjustedFrom} to ${directoryPath}]\n` : '';
        result = hits.length
          ? `${prefix}${hits.length} reference(s) to "${symbol}":\n\n${hits.join('\n\n')}`
          : `No references to "${symbol}" found under ${directoryPath}.`;
        break;
      }

      case 'webFetch': {
        const url = String(args.url || '');
        if (!/^https?:\/\//i.test(url.trim())) {
          result = 'Error: webFetch requires an absolute http(s) URL.';
          break;
        }
        const fetchResult = await renderer.invoke('ai:webFetch', url, {
          maxChars: typeof args.maxChars === 'number' ? args.maxChars : undefined
        });
        if (!fetchResult || fetchResult.ok === false) {
          result = `Error fetching ${url}: ${fetchResult?.error || 'unknown error'}${fetchResult?.status ? ` (HTTP ${fetchResult.status})` : ''}`;
          break;
        }
        result = `[Fetched ${url}${fetchResult.status ? ` — HTTP ${fetchResult.status}` : ''}]\n${fetchResult.text || '(empty response)'}`;
        break;
      }

      case 'spawnSubAgent': {
        const task = String(args.task || '');
        const systemPrompt = String(args.systemPrompt || '');
        if (!task) {
          result = 'Error: task is required';
          break;
        }
        const agentId = `subagent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        window.dispatchEvent(new CustomEvent('ai:spawnSubAgent', { detail: { agentId, task, systemPrompt } }));
        result = JSON.stringify({ agentId, task, status: 'spawned', message: 'Sub-agent spawned. The result will be reported back when the agent finishes.' });
        break;
      }

      default:
        result = `Unknown tool: ${toolCall.function.name}`;
    }

    return { tool_call_id: toolCall.id, role: 'tool', content: result };
  } catch (error) {
    return {
      tool_call_id: toolCall.id,
      role: 'tool',
      content: `Error executing ${toolCall.function.name}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
