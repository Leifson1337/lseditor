import path from 'path';

const RELATIVE_DRIVE_PREFIX = /^([.\\/]+)(?=[A-Za-z]:)/;

/**
 * Normalizes a configured project path and strips any trailing slashes.
 */
export function normalizeProjectRoot(projectPath?: string): string {
  if (!projectPath) {
    return '';
  }
  return path.normalize(projectPath).replace(/[\\/]+$/, '');
}

/**
 * Removes common file URI schemes so the remainder can be treated as a native path.
 */
export function stripFileProtocol(input: string): string {
  return input.replace(/^file:\/+/i, '');
}

/**
 * Removes leading relative markers such as "./" or "../" when a drive letter follows.
 */
export function stripRelativeDrivePrefix(input: string): string {
  return input.replace(RELATIVE_DRIVE_PREFIX, '');
}

/**
 * Collapses repeated occurrences of the normalized project root that may have been
 * prepended to a path by mistake (e.g. "root\root\path").
 */
export function collapseDuplicateProjectRoot(value: string, projectRoot: string): string {
  if (!projectRoot) {
    return value;
  }
  const normalizedRoot = path.normalize(projectRoot).replace(/[\\/]+$/, '');
  const duplicateMarker = `${normalizedRoot}${path.sep}${normalizedRoot}`;
  let current = value;
  while (current.includes(duplicateMarker)) {
    current = current.replace(duplicateMarker, normalizedRoot);
  }
  return current;
}
