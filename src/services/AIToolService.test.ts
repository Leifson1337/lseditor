/**
 * @jest-environment node
 */
import {
  resolvePath,
  normalizePath,
  isInsideProjectPath,
  ensureToolPathWithinProject,
  quoteWindowsCommandPath,
  matchesFileGlob,
  scorePathCandidate,
  setCurrentDiagnostics,
  getCurrentDiagnostics,
  getErrorDiagnostics,
  buildCompactFileTreeJson,
  resolveExistingPath
} from './AIToolService';

describe('resolvePath', () => {
  it('joins relative path to project root on POSIX', () => {
    expect(resolvePath('src/a.ts', '/workspace/proj')).toBe('/workspace/proj/src/a.ts');
  });

  it('preserves absolute Windows-style path', () => {
    expect(resolvePath('C:\\dev\\x.ts', '/workspace')).toBe('C:\\dev\\x.ts');
  });
});

describe('normalizePath', () => {
  it('normalizes backslashes to slashes', () => {
    expect(normalizePath('a\\b\\c')).toBe('a/b/c');
  });
});

describe('isInsideProjectPath', () => {
  it('returns true for file under project', () => {
    expect(isInsideProjectPath('/proj/src/x.ts', '/proj')).toBe(true);
  });

  it('returns false for path outside project', () => {
    expect(isInsideProjectPath('/other/x.ts', '/proj')).toBe(false);
  });

  it('returns true when project path is unset', () => {
    expect(isInsideProjectPath('/anywhere/file.ts', undefined)).toBe(true);
  });
});

describe('ensureToolPathWithinProject', () => {
  it('returns null when path is inside workspace (ok)', () => {
    expect(ensureToolPathWithinProject('/proj/foo.ts', '/proj')).toBeNull();
  });

  it('returns error string when outside workspace', () => {
    const err = ensureToolPathWithinProject('/etc/passwd', '/proj');
    expect(err).toContain('outside');
  });

  it('returns error when path missing', () => {
    expect(ensureToolPathWithinProject('', '/proj')).toMatch(/Missing path/);
  });
});

describe('quoteWindowsCommandPath', () => {
  it('wraps spaced script path for python', () => {
    const cmd = 'python C:\\My Projects\\app.py run';
    const q = quoteWindowsCommandPath(cmd);
    expect(q).toContain('"C:\\My Projects\\app.py"');
  });

  it('returns trimmed command when no change needed', () => {
    expect(quoteWindowsCommandPath('  npm test  ')).toBe('npm test');
  });
});

describe('matchesFileGlob', () => {
  it('matches basename with *.ts', () => {
    expect(matchesFileGlob('src/foo.ts', '*.ts')).toBe(true);
    expect(matchesFileGlob('src/foo.js', '*.ts')).toBe(false);
  });

  it('returns true when glob omitted', () => {
    expect(matchesFileGlob('any/path/file.txt', undefined)).toBe(true);
  });
});

describe('scorePathCandidate', () => {
  it('scores higher when suffix matches requested path', () => {
    const a = scorePathCandidate('components/Button.tsx', 'src/components/Button.tsx');
    const b = scorePathCandidate('components/Button.tsx', 'src/other/Thing.tsx');
    expect(a).toBeGreaterThan(b);
  });
});

describe('resolveExistingPath', () => {
  it('returns exists false when path is missing and no fuzzy match', async () => {
    const renderer = {
      invoke: jest.fn(async (channel: string) => {
        if (channel === 'fs:exists') return false;
        if (channel === 'fs:listFilesRecursive') return ['/proj/src/other.ts'];
        return null;
      })
    };
    const out = await resolveExistingPath(renderer as any, 'missing.py', '/proj');
    expect(out.resolvedPath).toContain('missing.py');
    expect(out.guessed).toBe(false);
    expect(out.exists).toBe(false);
  });

  it('returns exists true for fuzzy-matched file', async () => {
    const renderer = {
      invoke: jest.fn(async (channel: string, path: string) => {
        if (channel === 'fs:exists') {
          return path.endsWith('src/wanted.py');
        }
        if (channel === 'fs:listFilesRecursive') {
          return ['/proj/src/wanted.py'];
        }
        return null;
      })
    };
    const out = await resolveExistingPath(renderer as any, 'wanted.py', '/proj');
    expect(out.guessed).toBe(true);
    expect(out.exists).toBe(true);
    expect(out.resolvedPath).toContain('wanted.py');
  });
});

describe('buildCompactFileTreeJson', () => {
  it('builds nested JSON tree from absolute paths', () => {
    const root = '/proj';
    const files = ['/proj/src/a.ts', '/proj/src/b.ts', '/proj/README.md'];
    const out = buildCompactFileTreeJson(files, root, 500, 12);
    expect(out.root).toContain('proj');
    expect(out.tree).toHaveProperty('src');
    const src = out.tree.src as Record<string, unknown>;
    expect(src['a.ts']).toBeNull();
    expect(src['b.ts']).toBeNull();
    expect(out.tree['README.md']).toBeNull();
    expect(out.truncated).toBe(false);
  });

  it('marks truncated when file list exceeds maxFiles', () => {
    const files = ['/p/a', '/p/b', '/p/c'];
    const out = buildCompactFileTreeJson(files, '/p', 2, 12);
    expect(out.truncated).toBe(true);
  });
});

describe('diagnostics store', () => {
  it('filters errors only', () => {
    setCurrentDiagnostics([
      {
        file: '/a.ts',
        severity: 'error',
        message: 'e',
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 2
      },
      {
        file: '/b.ts',
        severity: 'warning',
        message: 'w',
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 2
      }
    ]);
    expect(getErrorDiagnostics()).toHaveLength(1);
    expect(getCurrentDiagnostics()).toHaveLength(2);
    setCurrentDiagnostics([]);
  });
});
