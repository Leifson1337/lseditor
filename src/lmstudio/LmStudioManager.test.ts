jest.mock('electron', () => ({ shell: { openExternal: jest.fn() } }));

jest.mock('../utils/backendDetector', () => ({
  findLmStudioListeningPort: jest.fn().mockResolvedValue(null),
  launchLmStudio: jest.fn(),
  waitForLmStudioServer: jest.fn().mockResolvedValue(false),
  LM_STUDIO_DEFAULT_PORT: 1234
}));

jest.mock('os', () => ({
  homedir: jest.fn(() => '/home/tester')
}));

import * as fs from 'fs';
import * as path from 'path';
import { resolveLmsCliPath } from './LmStudioManager';

jest.mock('fs');

describe('resolveLmsCliPath', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when CLI binary is absent', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    expect(resolveLmsCliPath()).toBeNull();
  });

  it('returns the path when ~/.lmstudio/bin/{lms|lms.exe} exists', () => {
    const binName = process.platform === 'win32' ? 'lms.exe' : 'lms';
    const expected = path.join('/home/tester', '.lmstudio', 'bin', binName);
    (fs.existsSync as jest.Mock).mockImplementation((p: fs.PathLike) => String(p) === expected);
    expect(resolveLmsCliPath()).toBe(expected);
  });
});
