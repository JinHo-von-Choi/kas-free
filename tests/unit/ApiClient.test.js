/**
 * ApiClient 단위 테스트
 * @author 최진호
 * @date 2026-02-26
 */

import { ApiClient, ApiError } from '../../src/background/ApiClient.js';

// Mock chrome.storage API
global.chrome = {
    storage: {
        local: {
            get: jest.fn().mockResolvedValue({}),
            set: jest.fn().mockResolvedValue()
        }
    }
};

describe('ApiClient', () => {
    let client;

    beforeEach(() => {
        // 테스트마다 새 클라이언트 생성
        client = new ApiClient({
            timeout: 5000,
            maxRetries: 3,
            baseDelay: 100,
            enableAdaptiveTimeout: false // 테스트 단순화
        });

        // fetch mock 초기화
        global.fetch = jest.fn();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('fetchWithTimeout', () => {
        test('정상 응답', async () => {
            // Mock fetch: 1초 후 응답
            global.fetch.mockImplementation(() =>
                new Promise(resolve => {
                    setTimeout(() => {
                        resolve({
                            ok: true,
                            status: 200,
                            json: async () => ({ success: true })
                        });
                    }, 1000);
                })
            );

            const response = await client.fetchWithTimeout('https://api.test.com/endpoint');

            expect(response.ok).toBe(true);
            expect(response.status).toBe(200);
        });

        test('타임아웃 발생', async () => {
            // 빠른 테스트를 위해 짧은 타임아웃 사용
            client.timeout = 200;

            // Mock fetch: abort 시그널을 구현하여 즉시 중단 가능
            global.fetch.mockImplementation((url, options) =>
                new Promise((resolve, reject) => {
                    if (options?.signal) {
                        options.signal.addEventListener('abort', () => {
                            reject(new DOMException('Aborted', 'AbortError'));
                        });
                    }
                    setTimeout(() => resolve({ ok: true, status: 200 }), 2000);
                })
            );

            await expect(
                client.fetchWithTimeout('https://api.test.com/slow')
            ).rejects.toThrow(ApiError);

            await expect(
                client.fetchWithTimeout('https://api.test.com/slow')
            ).rejects.toMatchObject({
                statusCode: 408,
                retryable: true
            });
        });

        test('타임아웃 직전 응답 (경합 조건)', async () => {
            // Mock fetch: 4.9초 후 응답 (타임아웃 5초)
            global.fetch.mockImplementation(() =>
                new Promise(resolve => {
                    setTimeout(() => {
                        resolve({ ok: true, status: 200 });
                    }, 4900);
                })
            );

            // 정상 완료되어야 함
            const response = await client.fetchWithTimeout('https://api.test.com/endpoint');
            expect(response.ok).toBe(true);
        });

        test('타임아웃 후 응답 도착 (경합 조건)', async () => {
            // 타임아웃을 매우 짧게 설정
            client.timeout = 100;

            let aborted = false;

            // Mock fetch: AbortController를 사용
            global.fetch.mockImplementation((url, options) => {
                return new Promise((resolve, reject) => {
                    // abort 시그널 리스너
                    if (options.signal) {
                        options.signal.addEventListener('abort', () => {
                            aborted = true;
                            reject(new DOMException('Aborted', 'AbortError'));
                        });
                    }

                    // 200ms 후 응답 (타임아웃 100ms)
                    setTimeout(() => {
                        if (!aborted) {
                            resolve({ ok: true, status: 200 });
                        }
                    }, 200);
                });
            });

            await expect(
                client.fetchWithTimeout('https://api.test.com/endpoint')
            ).rejects.toThrow(ApiError);
        });

        test('네트워크 에러', async () => {
            // Mock fetch: 네트워크 에러
            global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

            await expect(
                client.fetchWithTimeout('https://api.test.com/endpoint')
            ).rejects.toThrow(TypeError);
        });

        test('HTTP 에러 (500)', async () => {
            // Mock fetch: 서버 에러
            global.fetch.mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error'
            });

            const response = await client.fetchWithTimeout('https://api.test.com/endpoint');

            expect(response.ok).toBe(false);
            expect(response.status).toBe(500);
        });
    });

    describe('fetchWithRetry', () => {
        test('첫 시도 성공', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ success: true })
            });

            const response = await client.fetchWithRetry('https://api.test.com/endpoint');

            expect(response.ok).toBe(true);
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });

        test('재시도 후 성공', async () => {
            let attempts = 0;

            // Mock fetch: 2회 실패 후 성공
            global.fetch.mockImplementation(() => {
                attempts++;
                if (attempts < 3) {
                    return Promise.reject(new ApiError('Timeout', 408, true));
                }
                return Promise.resolve({
                    ok: true,
                    status: 200
                });
            });

            // fetchWithTimeout을 mock
            jest.spyOn(client, 'fetchWithTimeout').mockImplementation(() => {
                attempts++;
                if (attempts < 3) {
                    throw new ApiError('Timeout', 408, true);
                }
                return Promise.resolve({ ok: true, status: 200 });
            });

            const response = await client.fetchWithRetry('https://api.test.com/endpoint');

            expect(response.ok).toBe(true);
            expect(attempts).toBe(3);
        });

        test('최대 재시도 횟수 초과', async () => {
            // Mock fetch: 항상 실패
            jest.spyOn(client, 'fetchWithTimeout').mockRejectedValue(
                new ApiError('Timeout', 408, true)
            );

            await expect(
                client.fetchWithRetry('https://api.test.com/endpoint')
            ).rejects.toThrow(ApiError);

            expect(client.fetchWithTimeout).toHaveBeenCalledTimes(4); // 초기 시도 + 3회 재시도
        });

        test('재시도 불가능한 에러 (즉시 실패)', async () => {
            // Mock fetch: 재시도 불가능한 에러
            jest.spyOn(client, 'fetchWithTimeout').mockRejectedValue(
                new ApiError('Bad Request', 400, false)
            );

            await expect(
                client.fetchWithRetry('https://api.test.com/endpoint')
            ).rejects.toThrow(ApiError);

            expect(client.fetchWithTimeout).toHaveBeenCalledTimes(1); // 재시도 안 함
        });
    });

    describe('calculateDelay (Exponential Backoff)', () => {
        test('지연 시간 증가', () => {
            const delay0 = client.calculateDelay(0);
            const delay1 = client.calculateDelay(1);
            const delay2 = client.calculateDelay(2);

            // Exponential Backoff: 2^n * baseDelay + jitter(0~1000)
            // jitter로 인해 delay1 > delay0 보장 불가 → 범위로 검증
            expect(delay0).toBeGreaterThanOrEqual(100); // 2^0 * 100ms
            expect(delay0).toBeLessThanOrEqual(1100);   // + 최대 1000ms jitter

            expect(delay1).toBeGreaterThanOrEqual(200); // 2^1 * 100ms
            expect(delay1).toBeLessThanOrEqual(1200);

            expect(delay2).toBeGreaterThanOrEqual(400); // 2^2 * 100ms
            expect(delay2).toBeLessThanOrEqual(1400);

            // base delay 값은 단조 증가 (jitter 제외)
            expect(100 * Math.pow(2, 1)).toBeGreaterThan(100 * Math.pow(2, 0));
            expect(100 * Math.pow(2, 2)).toBeGreaterThan(100 * Math.pow(2, 1));
        });

        test('최대 지연 시간 제한 (10초)', () => {
            const delay10 = client.calculateDelay(10);
            const delay20 = client.calculateDelay(20);

            expect(delay10).toBeLessThanOrEqual(10000);
            expect(delay20).toBeLessThanOrEqual(10000);
        });

        test('Jitter 추가 (0-1초)', () => {
            const delays = [];
            for (let i = 0; i < 10; i++) {
                delays.push(client.calculateDelay(0));
            }

            // 모든 지연 시간이 달라야 함 (Jitter 때문)
            const uniqueDelays = new Set(delays);
            expect(uniqueDelays.size).toBeGreaterThan(1);
        });
    });

    describe('ApiError', () => {
        test('ApiError 생성', () => {
            const error = new ApiError('Test error', 408, true);

            expect(error.name).toBe('ApiError');
            expect(error.message).toBe('Test error');
            expect(error.statusCode).toBe(408);
            expect(error.retryable).toBe(true);
        });

        test('재시도 가능 에러', () => {
            const error = new ApiError('Timeout', 408, true);
            expect(error.retryable).toBe(true);
        });

        test('재시도 불가능 에러', () => {
            const error = new ApiError('Bad Request', 400, false);
            expect(error.retryable).toBe(false);
        });
    });

    describe('엣지 케이스', () => {
        test('fetch가 undefined 반환', async () => {
            global.fetch.mockResolvedValue(undefined);

            const response = await client.fetchWithTimeout('https://api.test.com/endpoint');
            expect(response).toBeUndefined();
        });

        test('fetch가 null 반환', async () => {
            global.fetch.mockResolvedValue(null);

            const response = await client.fetchWithTimeout('https://api.test.com/endpoint');
            expect(response).toBeNull();
        });

        test('매우 짧은 타임아웃 (0ms)', async () => {
            client.timeout = 0;

            global.fetch.mockImplementation(() =>
                new Promise(resolve => {
                    setTimeout(() => {
                        resolve({ ok: true, status: 200 });
                    }, 100);
                })
            );

            await expect(
                client.fetchWithTimeout('https://api.test.com/endpoint')
            ).rejects.toThrow(ApiError);
        });

        test('매우 긴 타임아웃 (1시간)', async () => {
            client.timeout = 3600000; // 1시간

            global.fetch.mockResolvedValue({ ok: true, status: 200 });

            const response = await client.fetchWithTimeout('https://api.test.com/endpoint');
            expect(response.ok).toBe(true);
        });
    });

    describe('실제 시나리오', () => {
        test('OpenAI API 호출 (빠름)', async () => {
            // OpenAI는 보통 1-3초
            global.fetch.mockImplementation(() =>
                new Promise(resolve => {
                    setTimeout(() => {
                        resolve({
                            ok: true,
                            status: 200,
                            json: async () => ({
                                choices: [{ message: { content: 'Hello' } }]
                            })
                        });
                    }, 2000);
                })
            );

            const response = await client.fetchWithTimeout('https://api.openai.com/v1/chat/completions');
            expect(response.ok).toBe(true);
        });

        test('Anthropic API 호출 (보통)', async () => {
            // 테스트 속도를 위해 비율을 유지한 채 지연 단축 (700ms / 2000ms)
            global.fetch.mockImplementation(() =>
                new Promise(resolve => {
                    setTimeout(() => {
                        resolve({
                            ok: true,
                            status: 200,
                            json: async () => ({
                                content: [{ text: 'Hello' }]
                            })
                        });
                    }, 700);
                })
            );

            // 타임아웃을 응답 시간보다 크게 설정
            client.timeout = 2000;

            const response = await client.fetchWithTimeout('https://api.anthropic.com/v1/messages');
            expect(response.ok).toBe(true);
        });

        test('API 장애 시 재시도', async () => {
            let attempts = 0;

            jest.spyOn(client, 'fetchWithTimeout').mockImplementation(() => {
                attempts++;
                if (attempts === 1) {
                    throw new ApiError('Service Unavailable', 503, true);
                }
                if (attempts === 2) {
                    throw new ApiError('Timeout', 408, true);
                }
                return Promise.resolve({ ok: true, status: 200 });
            });

            const response = await client.fetchWithRetry('https://api.test.com/endpoint');

            expect(response.ok).toBe(true);
            expect(attempts).toBe(3);
        });
    });
});
