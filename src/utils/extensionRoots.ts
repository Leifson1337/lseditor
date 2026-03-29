import path from 'path';

export type ExtensionRootSource = 'user' | 'project' | 'bundled';

export interface ExtensionRoot {
  path: string;
  source: ExtensionRootSource;
}

const EXTENSIONS_DIR_NAME = 'extensions';

const normalizeRootKey = (rootPath: string): string => {
  const normalized = path.normalize(rootPath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

export const getExtensionRoots = ({
  userDataPath,
  projectPath,
  appRoot
}: {
  userDataPath?: string | null;
  projectPath?: string | null;
  appRoot?: string | null;
}): ExtensionRoot[] => {
  const roots: ExtensionRoot[] = [];
  const seen = new Set<string>();

  const addRoot = (rootPath: string | null | undefined, source: ExtensionRootSource) => {
    if (!rootPath) {
      return;
    }

    const normalizedPath = path.normalize(rootPath);
    const key = normalizeRootKey(normalizedPath);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    roots.push({ path: normalizedPath, source });
  };

  addRoot(userDataPath ? path.join(userDataPath, EXTENSIONS_DIR_NAME) : null, 'user');
  addRoot(projectPath ? path.join(projectPath, EXTENSIONS_DIR_NAME) : null, 'project');
  addRoot(appRoot ? path.join(appRoot, 'vscode-main', EXTENSIONS_DIR_NAME) : null, 'bundled');

  return roots;
};
