/**
 * @jest-environment node
 */
import axios from 'axios';
import { OllamaManager, parsePortFromOllamaLog } from './OllamaManager';

jest.mock('axios');

jest.mock('electron', () => ({
  app: {
    getAppPath: () => '/tmp/lseditor-test'
  }
}));

jest.mock('fs', () => ({
  ...jest.requireActual<typeof import('fs')>('fs'),
  existsSync: jest.fn(() => false)
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('parsePortFromOllamaLog', () => {
  it('extracts port from "Listening on" line', () => {
    expect(parsePortFromOllamaLog('Listening on http://127.0.0.1:54321')).toBe(54321);
  });

  it('extracts port from localhost URL', () => {
    expect(parsePortFromOllamaLog('foo localhost:11434 bar')).toBe(11434);
  });

  it('returns null when no port pattern matches', () => {
    expect(parsePortFromOllamaLog('no port here')).toBeNull();
  });
});

describe('OllamaManager.listModelNames', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps /api/tags response to model names', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { models: [{ name: 'llama3:latest' }, { name: 'phi3:mini' }] }
    });

    const mgr = new OllamaManager();
    const names = await mgr.listModelNames('http://127.0.0.1:11434');

    expect(names).toEqual(['llama3:latest', 'phi3:mini']);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/tags',
      expect.objectContaining({ timeout: 15000 })
    );
  });

  it('returns empty array when models missing', async () => {
    mockedAxios.get.mockResolvedValue({ data: {} });

    const mgr = new OllamaManager();
    const names = await mgr.listModelNames('http://127.0.0.1:1');

    expect(names).toEqual([]);
  });
});
