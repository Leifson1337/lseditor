import path from 'path';

const RELATIVE_DRIVE_PREFIX = /^([.\\/]+)(?=[A-Za-z]:)/;

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
