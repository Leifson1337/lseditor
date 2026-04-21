jest.mock('electron', () => ({ shell: { openExternal: jest.fn() } }));

import axios from 'axios';
import { probeOllamaPort, probeLmStudioModelsEndpoint } from './backendDetector';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('probeOllamaPort', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when /api/tags returns 200', async () => {
    mockedAxios.get.mockResolvedValueOnce({ status: 200 });
    await expect(probeOllamaPort(11434)).resolves.toBe(true);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/tags',
      expect.objectContaining({ timeout: 2500 })
    );
  });

  it('returns false on network error', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(probeOllamaPort(11434)).resolves.toBe(false);
  });
});

describe('probeLmStudioModelsEndpoint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when /v1/models returns 200', async () => {
    mockedAxios.get.mockResolvedValueOnce({ status: 200 });
    await expect(probeLmStudioModelsEndpoint(1234, { scheme: 'http', timeoutMs: 1000 })).resolves.toBe(true);
  });
});
