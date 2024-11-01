import { SingleBar, Presets } from 'cli-progress';
import { fetchWithProxy } from '../src/fetch';
import { cloudConfig } from '../src/globalConfig/cloud';
import type Eval from '../src/models/eval';
import { stripAuthFromUrl, createShareableUrl } from '../src/share';

jest.mock('../src/logger');
jest.mock('../src/globalConfig/cloud');
jest.mock('../src/fetch', () => ({
  fetchWithProxy: jest.fn().mockResolvedValue({
    ok: true,
    json: jest.fn().mockResolvedValue({ id: 'mock-eval-id' }),
  }),
}));

jest.mock('cli-progress', () => ({
  SingleBar: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    update: jest.fn(),
    stop: jest.fn(),
    getTotal: jest.fn().mockReturnValue(100),
  })),
  Presets: {
    shades_classic: {},
  },
}));

describe('stripAuthFromUrl', () => {
  it('removes username and password from URL', () => {
    const input = 'https://user:pass@example.com/path?query=value#hash';
    const expected = 'https://example.com/path?query=value#hash';
    expect(stripAuthFromUrl(input)).toBe(expected);
  });

  it('handles URLs without auth info', () => {
    const input = 'https://example.com/path?query=value#hash';
    expect(stripAuthFromUrl(input)).toBe(input);
  });

  it('handles URLs with only username', () => {
    const input = 'https://user@example.com/path';
    const expected = 'https://example.com/path';
    expect(stripAuthFromUrl(input)).toBe(expected);
  });

  it('handles URLs with special characters in auth', () => {
    const input = 'https://user%40:p@ss@example.com/path';
    const expected = 'https://example.com/path';
    expect(stripAuthFromUrl(input)).toBe(expected);
  });

  it('returns original string for invalid URLs', () => {
    const input = 'not a valid url';
    expect(stripAuthFromUrl(input)).toBe(input);
  });

  it('handles URLs with IP addresses', () => {
    const input = 'http://user:pass@192.168.1.1:8080/path';
    const expected = 'http://192.168.1.1:8080/path';
    expect(stripAuthFromUrl(input)).toBe(expected);
  });
});

describe('createShareableUrl', () => {
  const mockEvalSmall: Partial<Eval> = {
    config: {},
    results: new Array(10).fill({}),
    useOldResults: jest.fn().mockReturnValue(false),
    loadResults: jest.fn().mockResolvedValue(undefined),
    createdAt: '2024-01-01',
  };

  const mockEvalLarge: Partial<Eval> = {
    config: {},
    results: new Array(6000).fill({}),
    useOldResults: jest.fn().mockReturnValue(false),
    loadResults: jest.fn().mockResolvedValue(undefined),
    createdAt: '2024-01-01',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(fetchWithProxy).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'mock-eval-id' }),
    });
  });

  it('creates correct URL for cloud config with small payload', async () => {
    jest.mocked(cloudConfig.isEnabled).mockReturnValue(true);
    jest.mocked(cloudConfig.getAppUrl).mockReturnValue('https://app.example.com');
    jest.mocked(cloudConfig.getApiHost).mockReturnValue('https://api.example.com');
    jest.mocked(cloudConfig.getApiKey).mockReturnValue('mock-api-key');

    const result = await createShareableUrl(mockEvalSmall as Eval);
    expect(result).toBe('https://app.example.com/eval/mock-eval-id');
  });

  it('uses streaming upload for large payloads', async () => {
    jest.mocked(cloudConfig.isEnabled).mockReturnValue(true);
    jest.mocked(cloudConfig.getAppUrl).mockReturnValue('https://app.example.com');
    jest.mocked(cloudConfig.getApiHost).mockReturnValue('https://api.example.com');
    jest.mocked(cloudConfig.getApiKey).mockReturnValue('mock-api-key');

    const result = await createShareableUrl(mockEvalLarge as Eval);

    const fetchCalls = jest.mocked(fetchWithProxy).mock.calls;
    expect(fetchCalls).toHaveLength(1);
    const [url, options] = fetchCalls[0];
    expect(url).toBe('https://api.example.com/results');
    expect(options.headers).toEqual(
      expect.objectContaining({
        'X-Upload-Mode': 'streaming',
        'Transfer-Encoding': 'chunked',
      }),
    );
    expect(options.method).toBe('POST');
    expect(options.duplex).toBe('half');

    expect(result).toBe('https://app.example.com/eval/mock-eval-id');
  });

  it('handles streaming upload errors gracefully', async () => {
    jest.mocked(cloudConfig.isEnabled).mockReturnValue(true);
    jest.mocked(cloudConfig.getAppUrl).mockReturnValue('https://app.example.com');
    jest.mocked(cloudConfig.getApiHost).mockReturnValue('https://api.example.com');

    jest.mocked(fetchWithProxy).mockRejectedValueOnce(new Error('Network error'));

    const result = await createShareableUrl(mockEvalLarge as Eval);
    expect(result).toBeNull();
  });

  it('falls back to non-streaming for small payloads', async () => {
    jest.mocked(cloudConfig.isEnabled).mockReturnValue(true);

    await createShareableUrl(mockEvalSmall as Eval);

    expect(jest.mocked(fetchWithProxy)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.not.objectContaining({
          'X-Upload-Mode': 'streaming',
        }),
      }),
    );
  });

  it('respects useOldResults flag', async () => {
    jest.mocked(cloudConfig.isEnabled).mockReturnValue(true);
    const mockEvalWithOldResults: Partial<Eval> = {
      ...mockEvalLarge,
      useOldResults: jest.fn().mockReturnValue(true),
      toEvaluateSummary: jest.fn().mockResolvedValue({}),
      getTable: jest.fn().mockResolvedValue([]),
    };

    await createShareableUrl(mockEvalWithOldResults as Eval);

    expect(mockEvalWithOldResults.toEvaluateSummary).toHaveBeenCalledWith();
    expect(mockEvalWithOldResults.getTable).toHaveBeenCalledWith();
  });

  it('handles progress bar in streaming mode', async () => {
    jest.mocked(cloudConfig.isEnabled).mockReturnValue(true);
    await createShareableUrl(mockEvalLarge as Eval);

    const mockSingleBar = jest.mocked(SingleBar);
    expect(mockSingleBar).toHaveBeenCalledWith(
      {
        format: 'Uploading results {bar} {percentage}% | ETA: {eta}s | {value}/{total} batches',
        hideCursor: true,
      },
      Presets.shades_classic,
    );

    const mockProgressBar = mockSingleBar.mock.results[0].value;
    const expectedBatches = Math.ceil(mockEvalLarge.results!.length / 50);
    expect(mockProgressBar.start).toHaveBeenCalledWith(expectedBatches, 0);
    expect(mockProgressBar.stop).toHaveBeenCalledWith();
  });
});
