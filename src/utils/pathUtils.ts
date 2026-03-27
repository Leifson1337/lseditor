import path from 'path';

const RELATIVE_DRIVE_PREFIX = /^([.\\/]+)(?=[A-Za-z]:)/;
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;

export function normalizeProjectRoot(projectPath?: string): string {
  if (!projectPath) return '';
  return path.normalize(projectPath).replace(/[\\/]+$/, '');
}

export function stripFileProtocol(raw: string): string {
  return raw.replace(/^file:\/+/i, '');
}

export function stripRelativeDrivePrefix(raw: string): string {
  return raw.replace(RELATIVE_DRIVE_PREFIX, '');
}

export function isAbsoluteFilePath(raw?: string): boolean {
  if (!raw) return false;
  const sanitized = stripRelativeDrivePrefix(stripFileProtocol(String(raw).trim()));
  return WINDOWS_ABSOLUTE_PATH.test(sanitized) || path.isAbsolute(sanitized);
}

export function joinPathPreserveAbsolute(basePath: string, targetPath: string): string {
  const sanitized = stripRelativeDrivePrefix(stripFileProtocol(String(targetPath || '').trim()));
  if (!sanitized) {
    return path.normalize(basePath || '');
  }
  if (!basePath || isAbsoluteFilePath(sanitized)) {
    return path.normalize(sanitized);
  }
  return path.normalize(path.join(basePath, sanitized));
}

export function collapseDuplicateProjectRoot(value: string, projectRoot: string): string {
  if (!projectRoot) return value;
  const normalizedRoot = path.normalize(projectRoot).replace(/[\\/]+$/, '');
  const duplicateMarker = `${normalizedRoot}${path.sep}${normalizedRoot}`;
  let current = value;
  while (current.includes(duplicateMarker)) {
    current = current.replace(duplicateMarker, normalizedRoot);
  }
  return current;
}
