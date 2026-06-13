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

/**
 * Windows-aware path helpers.
 *
 * In the renderer `path` is aliased to `path-browserify` (POSIX-only), so
 * `path.basename`/`path.dirname`/`path.join` mishandle Windows absolute paths
 * such as `C:\Users\foo\bar.txt` (no `/` separators → basename returns the whole
 * string, join produces mixed `C:\foo/bar` slashes). These helpers operate on
 * both separators and preserve the separator style already present in the path.
 */
export function detectSeparator(p: string): '\\' | '/' {
  return /\\/.test(p) && !/^[a-z]+:\/\//i.test(p) ? '\\' : (/\//.test(p) ? '/' : '\\');
}

export function getBaseName(p?: string): string {
  if (!p) return '';
  const cleaned = String(p).replace(/[\\/]+$/, '');
  const idx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'));
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

export function getDirName(p?: string): string {
  if (!p) return '';
  const cleaned = String(p).replace(/[\\/]+$/, '');
  const idx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'));
  if (idx <= 0) return cleaned;
  return cleaned.slice(0, idx);
}

/**
 * Joins path segments, preserving the separator style of the base path.
 * Unlike POSIX `path.join`, this keeps backslashes on Windows absolute paths.
 */
export function joinPaths(base: string, ...segments: string[]): string {
  const sep = detectSeparator(base);
  let result = String(base || '').replace(/[\\/]+$/, '');
  for (const segment of segments) {
    if (!segment) continue;
    const clean = String(segment).replace(/^[\\/]+/, '').replace(/[\\/]+$/, '');
    if (!clean) continue;
    result = result ? `${result}${sep}${clean}` : clean;
  }
  return result;
}

/** Normalizes all separators in a path to the OS-native style (default Windows backslash). */
export function toNativeSeparators(p?: string, sep: '\\' | '/' = '\\'): string {
  if (!p) return '';
  return sep === '\\' ? String(p).replace(/\//g, '\\') : String(p).replace(/\\/g, '/');
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
