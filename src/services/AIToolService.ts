/**
 * AIToolService - Provides tool execution capabilities for the AI chat.
 * Tools allow the AI to read/write files, run commands, search, etc.
 */

const ipc = () => (window as any).electron?.ipcRenderer;

const AI_TOOL_IGNORES = ['node_modules', '.git', 'dist', 'build', 'out', 'coverage'];

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
      description: 'Read the contents of a file at the given path. Returns the file content as text.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative file path to read' }
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
  projectPath?: string
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
    const args = JSON.parse(toolCall.function.arguments);
    let result: string;

    switch (toolCall.function.name) {
      case 'findFile': {
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
        const content = await renderer.invoke('fs:readFile', resolvedPath);
        if (content === null || content === undefined) {
          result = `Error: File not found: ${resolvedPath}`;
        } else {
          const prefix = guessed ? `[Resolved from ${args.path} to ${resolvedPath}]\n` : '';
          const text = typeof content === 'string' ? content : String(content);
          result = text.length > 0 ? `${prefix}${text}` : `${prefix}(empty file: ${resolvedPath})`;
        }
        break;
      }

      case 'writeFile': {
        const fullPath = resolvePath(args.path, projectPath);
        await renderer.invoke('fs:writeFile', fullPath, args.content);
        window.dispatchEvent(new CustomEvent('editor:openFile', { detail: fullPath }));
        window.dispatchEvent(new Event('explorer:refresh'));
        result = `File written successfully: ${fullPath}`;
        break;
      }

      case 'listFiles': {
        const { directoryPath, adjustedFrom } = await resolveDirectoryPath(renderer, args.path, projectPath);
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
        const { directoryPath, adjustedFrom } = await resolveDirectoryPath(renderer, args.path, projectPath);
        try {
          const rawPattern = String(args.pattern ?? '').trim();
          const filenameMode = looksLikeFilenameQuery(rawPattern);
          const files = await renderer.invoke('fs:listFilesRecursive', directoryPath, { ignore: AI_TOOL_IGNORES });
          if (!files || !Array.isArray(files)) {
            result = 'No files found';
            break;
          }

          const pattern = new RegExp(rawPattern, 'gi');
          const filenameQuery = normalizeForMatch(rawPattern);
          const fileGlob = args.filePattern;
          const matches: string[] = [];

          for (const file of files) {
            if (matches.length >= 50) break;
            if (fileGlob) {
              const ext = file.split('.').pop()?.toLowerCase() || '';
              const globExt = fileGlob.replace('*.', '').toLowerCase();
              if (ext !== globExt) continue;
            }

            const relative = file.replace(directoryPath, '').replace(/^[\\/]/, '');
            const normalizedRelative = normalizeForMatch(relative);
            if (filenameQuery && normalizedRelative.includes(filenameQuery)) {
              matches.push(`${relative}: filename match`);
              if (filenameMode) {
                continue;
              }
              continue;
            }

            if (filenameMode) {
              continue;
            }

            try {
              const content = await renderer.invoke('fs:readFile', file);
              if (typeof content !== 'string') continue;
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (pattern.test(lines[i])) {
                  matches.push(`${relative}:${i + 1}: ${lines[i].trim().substring(0, 200)}`);
                  if (matches.length >= 50) break;
                }
                pattern.lastIndex = 0;
              }
            } catch {
              // Skip files that can't be read
            }
          }
          const prefix = adjustedFrom ? `[Adjusted search path from ${adjustedFrom} to ${directoryPath}]\n` : '';
          result = `${prefix}${matches.length > 0 ? matches.join('\n') : 'No matches found'}`;
        } catch (e) {
          result = `Search error: ${e instanceof Error ? e.message : String(e)}`;
        }
        break;
      }

      case 'runCommand': {
        const execResult = await renderer.invoke('exec', args.command, {
          cwd: args.cwd ? resolvePath(args.cwd, projectPath) : projectPath
        });
        if (execResult && typeof execResult === 'object') {
          const parts: string[] = [];
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
        await renderer.invoke('fs:createDirectory', fullPath);
        window.dispatchEvent(new Event('explorer:refresh'));
        result = `Directory created: ${fullPath}`;
        break;
      }

      case 'deleteFile': {
        const fullPath = resolvePath(args.path, projectPath);
        const stat = await renderer.invoke('fs:stat', fullPath);
        if (stat?.type === 'directory') {
          await renderer.invoke('fs:deleteDirectory', fullPath, false);
        } else {
          await renderer.invoke('fs:deleteFile', fullPath);
        }
        window.dispatchEvent(new Event('explorer:refresh'));
        result = `Deleted: ${fullPath}`;
        break;
      }

      case 'renameFile': {
        const oldFull = resolvePath(args.oldPath, projectPath);
        const newFull = resolvePath(args.newPath, projectPath);
        await renderer.invoke('fs:renameFile', oldFull, newFull);
        window.dispatchEvent(new Event('explorer:refresh'));
        result = `Renamed ${oldFull} -> ${newFull}`;
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
