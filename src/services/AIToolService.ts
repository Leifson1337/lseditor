/**
 * AIToolService - Provides tool execution capabilities for the AI chat.
 * Tools allow the AI to read/write files, run commands, search, etc.
 */

const ipc = () => (window as any).electron?.ipcRenderer;

const AI_TOOL_IGNORES = ['node_modules', '.git', 'dist', 'build', 'out', 'coverage'];
const DEFAULT_READFILE_CHUNK_LINES = 120;

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

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
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
      description: 'Read the contents of a file. For large files, use startLine/endLine to read specific sections and avoid token waste. Lines are 1-indexed. If omitted, reads the entire file.',
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
          maxResults: { type: 'number', description: 'Maximum number of matches to return. Defaults to 50 and is capped at 200.' }
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

function splitLinesPreserveNewlines(content: string): string[] {
  return String(content || '').match(/[^\n]*\n|[^\n]+$/g) || [];
}

function getLeadingWhitespace(value: string): string {
  const match = String(value || '').match(/^\s*/);
  return match?.[0] || '';
}

function replaceSingleLineByTrimmedMatch(content: string, search: string, replace: string) {
  const normalizedSearch = search.replace(/\r/g, '').trim();
  if (!normalizedSearch || normalizedSearch.includes('\n')) {
    return null;
  }

  const lines = splitLinesPreserveNewlines(content);
  const matches = lines
    .map((line, index) => ({
      index,
      line,
      trimmed: line.replace(/\r?\n$/, '').trim()
    }))
    .filter(entry => entry.trimmed === normalizedSearch);

  if (matches.length !== 1) {
    return null;
  }

  const match = matches[0];
  const originalLine = match.line;
  const lineEndingMatch = originalLine.match(/\r?\n$/);
  const lineEnding = lineEndingMatch?.[0] || '';
  const replaceWithoutEnding = replace.replace(/\r?\n$/, '');
  const replacementLine = `${getLeadingWhitespace(originalLine)}${replaceWithoutEnding.trimStart()}${lineEnding}`;

  if (replacementLine === originalLine) {
    return {
      updatedContent: content,
      replacements: 0,
      mode: 'line-trimmed' as const
    };
  }

  const updatedLines = [...lines];
  updatedLines[match.index] = replacementLine;
  return {
    updatedContent: updatedLines.join(''),
    replacements: 1,
    mode: 'line-trimmed' as const
  };
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
            results.push(`${relative}:${index + 1}: ${line.trim().slice(0, 240)}`);
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
          content: `Error: Malformed JSON in ${toolCall.function.name} arguments. The arguments must be valid JSON. Received: ${raw.slice(0, 200)}${raw.length > 200 ? '...' : ''}. Fix the JSON and retry the tool call.`
        };
      }
    }
    if (typeof args !== 'object' || args === null) {
      args = {};
    }
    let result: string;

    switch (toolCall.function.name) {
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
        const content = await renderer.invoke('fs:readFile', resolvedPath);
        if (typeof content !== 'string') {
          result = `Error: File not found: ${resolvedPath}`;
          break;
        }

        const search = String(args.search ?? '');
        const replace = String(args.replace ?? '');
        if (!search) {
          result = 'Error: replaceInFile requires a non-empty search string';
          break;
        }
        if (search === replace) {
          result = `Error: search and replace text are identical - no change would occur. You must provide different text for the replacement. Read the file again to find the correct text to change.`;
          break;
        }

        const replaceAll = Boolean(args.allOccurrences);
        let updatedContent = content;
        let replacements = 0;
        let replacementMode: 'exact' | 'line-trimmed' = 'exact';

        if (content.includes(search)) {
          if (replaceAll) {
            updatedContent = content.split(search).join(replace);
            replacements = content.split(search).length - 1;
          } else {
            updatedContent = content.replace(search, () => {
              replacements += 1;
              return replace;
            });
          }
        } else {
          const fallback = !replaceAll
            ? replaceSingleLineByTrimmedMatch(content, search, replace)
            : null;
          if (!fallback) {
            // Give the AI helpful context about why the search failed
            const totalLines = content.split('\n').length;
            const searchPreview = search.length > 80 ? search.slice(0, 80) + '...' : search;
            const searchLines = search.split('\n').length;
            result = `Error: Search text not found in ${resolvedPath} (file has ${totalLines} lines). Your search string (${searchLines} line(s)): "${searchPreview}" does not match any part of the file. The file content may have changed. Re-read the file with readFile to see the current content, then retry with the correct search text.`;
            break;
          }
          updatedContent = fallback.updatedContent;
          replacements = fallback.replacements;
          replacementMode = fallback.mode;
        }

        if (updatedContent === content) {
          result = `Error: No changes applied in ${resolvedPath}: the replacement produced identical content. The search text was found but replacing it resulted in the same file. Make sure your replace text is actually different from the search text. Read the file again to verify the current content.`;
          break;
        }

        const writeSucceeded = await renderer.invoke('fs:writeFile', resolvedPath, updatedContent);
        if (!writeSucceeded) {
          result = `Error: Failed to write updated content to ${resolvedPath}`;
          break;
        }
        const verifiedContent = await renderer.invoke('fs:readFile', resolvedPath);
        if (typeof verifiedContent !== 'string' || verifiedContent !== updatedContent) {
          result = `Error: Post-replace verification failed for ${resolvedPath}`;
          break;
        }
        notifyFileChanged(resolvedPath);
        const prefix = guessed ? `[Resolved from ${args.path} to ${resolvedPath}] ` : '';
        const modeSuffix = replacementMode === 'line-trimmed' ? ', trimmed line match' : '';
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
          const parts: string[] = [];
          parts.push(`[command] ${normalizedCommand}`);
          if (execResult.stdout) parts.push(execResult.stdout);
          if (execResult.stderr) parts.push(`[stderr] ${execResult.stderr}`);
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
