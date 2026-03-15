/**
 * API Request Manager 단위 테스트
 * @author 최진호
 * @date 2026-02-26
 */

import {
    ApiRequestManager,
    getApiRequestManager,
    resetApiRequestManager
} from '../../src/utils/apiRequestManager.js';

describe('ApiRequestManager', () => {
    let manager;

    beforeEach(() => {
        jest.useFakeTimers();
        manager = new ApiRequestManager();
    });

    afterEach(() => {
        manager.destroy();
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    describe('requestImageAnalysis', () => {
        test('정상 요청', async () => {
            const requestFn = jest.fn().mockResolvedValue({ status: 'safe' });

            const promise = manager.requestImageAnalysis('123', requestFn, 100);

            // Debounce 대기
            jest.advanceTimersByTime(100);

            const result = await promise;

            expect(result).toEqual({ status: 'safe' });
            expect(requestFn).toHaveBeenCalledTimes(1);
            expect(manager.stats.total).toBe(1);
            expect(manager.stats.deduplicated).toBe(0);
        });

        test('중복 요청 차단 (진행 중)', async () => {
            const requestFn = jest.fn().mockImplementation(() => {
                return new Promise(resolve => {
                    setTimeout(() => resolve({ status: 'safe' }), 500);
                });
            });

            // 첫 번째 요청
            const promise1 = manager.requestImageAnalysis('123', requestFn, 100);

            // Debounce 대기 (100ms 타이머 발화, executeRequest 마이크로태스크 큐에 적재)
            jest.advanceTimersByTime(100);

            // 두 번째 요청 (진행 중) - pendingRequests에 있으므로 deduplicated
            const promise2 = manager.requestImageAnalysis('123', requestFn, 100);

            // 같은 Promise여야 함
            expect(promise1).toBe(promise2);
            expect(manager.stats.deduplicated).toBe(1);

            // runAllTimersAsync: 마이크로태스크와 타이머를 교차 처리
            // (executeRequest 재개 → requestFn 500ms 타이머 생성 → 발화 순서 보장)
            await jest.runAllTimersAsync();
            const result = await promise1;

            expect(result).toEqual({ status: 'safe' });
            expect(requestFn).toHaveBeenCalledTimes(1);
        });

        test('Debounce: 짧은 시간 내 중복 요청 무시', async () => {
            const requestFn = jest.fn().mockResolvedValue({ status: 'safe' });

            // 첫 번째 요청
            manager.requestImageAnalysis('123', requestFn, 300);

            // 100ms 후 두 번째 요청 (pendingRequests에 이미 있으므로 deduplicated로 처리됨)
            jest.advanceTimersByTime(100);
            const promise = manager.requestImageAnalysis('123', requestFn, 300);

            expect(manager.stats.deduplicated).toBe(1);

            // 300ms 후 실행 (마지막 요청 기준)
            jest.advanceTimersByTime(300);

            await promise;

            // requestFn은 한 번만 호출 (Debounce로 합쳐짐)
            expect(requestFn).toHaveBeenCalledTimes(1);
        });

        test('다른 postNo는 별도 처리', async () => {
            const requestFn1 = jest.fn().mockResolvedValue({ status: 'safe' });
            const requestFn2 = jest.fn().mockResolvedValue({ status: 'danger' });

            const promise1 = manager.requestImageAnalysis('123', requestFn1, 100);
            const promise2 = manager.requestImageAnalysis('456', requestFn2, 100);

            jest.advanceTimersByTime(100);

            const [result1, result2] = await Promise.all([promise1, promise2]);

            expect(result1).toEqual({ status: 'safe' });
            expect(result2).toEqual({ status: 'danger' });
            expect(requestFn1).toHaveBeenCalledTimes(1);
            expect(requestFn2).toHaveBeenCalledTimes(1);
        });

        test('요청 실패 처리', async () => {
            const requestFn = jest.fn().mockRejectedValue(new Error('Network error'));

            const promise = manager.requestImageAnalysis('123', requestFn, 100);

            jest.advanceTimersByTime(100);

            await expect(promise).rejects.toThrow('Network error');

            // 실패 후 pendingRequests에서 제거되어야 함
            expect(manager.pendingRequests.has('123')).toBe(false);
        });

        test('요청 완료 후 pendingRequests에서 제거', async () => {
            const requestFn = jest.fn().mockResolvedValue({ status: 'safe' });

            const promise = manager.requestImageAnalysis('123', requestFn, 100);

            // 진행 중
            expect(manager.pendingRequests.has('123')).toBe(true);

            jest.advanceTimersByTime(100);
            await promise;

            // 완료 후 제거
            expect(manager.pendingRequests.has('123')).toBe(false);
        });
    });

    describe('requestAIVerification', () => {
        test('기본 Debounce 500ms', async () => {
            const requestFn = jest.fn().mockResolvedValue({ status: 'danger' });

            const promise = manager.requestAIVerification('123', requestFn);

            // 500ms 대기
            jest.advanceTimersByTime(500);

            await promise;

            expect(requestFn).toHaveBeenCalledTimes(1);
        });

        test('중복 요청 차단', async () => {
            const requestFn = jest.fn().mockResolvedValue({ status: 'danger' });

            const promise1 = manager.requestAIVerification('123', requestFn);
            jest.advanceTimersByTime(100);

            const promise2 = manager.requestAIVerification('123', requestFn);

            // pendingRequests에 이미 있으므로 deduplicated로 처리됨
            expect(manager.stats.deduplicated).toBe(1);

            jest.advanceTimersByTime(500);
            await Promise.all([promise1, promise2]);

            expect(requestFn).toHaveBeenCalledTimes(1);
        });
    });

    describe('cancel', () => {
        test('진행 중인 요청 취소', () => {
            const requestFn = jest.fn().mockResolvedValue({ status: 'safe' });

            manager.requestImageAnalysis('123', requestFn, 100);

            expect(manager.pendingRequests.has('123')).toBe(true);

            const canceled = manager.cancel('123');

            expect(canceled).toBe(true);
            expect(manager.pendingRequests.has('123')).toBe(false);
        });

        test('Debounce 타이머 취소', () => {
            const requestFn = jest.fn().mockResolvedValue({ status: 'safe' });

            manager.requestImageAnalysis('123', requestFn, 300);

            expect(manager.debounceTimers.has('123')).toBe(true);

            const canceled = manager.cancel('123');

            expect(canceled).toBe(true);
            expect(manager.debounceTimers.has('123')).toBe(false);
        });

        test('존재하지 않는 요청 취소', () => {
            const canceled = manager.cancel('999');
            expect(canceled).toBe(false);
        });
    });

    describe('cancelAll', () => {
        test('모든 요청 취소', () => {
            const requestFn = jest.fn().mockResolvedValue({ status: 'safe' });

            manager.requestImageAnalysis('123', requestFn, 100);
            manager.requestImageAnalysis('456', requestFn, 100);
            manager.requestImageAnalysis('789', requestFn, 100);

            expect(manager.pendingRequests.size + manager.debounceTimers.size).toBeGreaterThan(0);

            manager.cancelAll();

            expect(manager.pendingRequests.size).toBe(0);
            expect(manager.debounceTimers.size).toBe(0);
        });
    });

    describe('isPending', () => {
        test('진행 중인 요청 확인', () => {
            const requestFn = jest.fn().mockResolvedValue({ status: 'safe' });

            manager.requestImageAnalysis('123', requestFn, 100);

            expect(manager.isPending('123')).toBe(true);
            expect(manager.isPending('456')).toBe(false);
        });

        test('완료 후 isPending false', async () => {
            const requestFn = jest.fn().mockResolvedValue({ status: 'safe' });

            const promise = manager.requestImageAnalysis('123', requestFn, 100);

            expect(manager.isPending('123')).toBe(true);

            jest.advanceTimersByTime(100);
            await promise;

            expect(manager.isPending('123')).toBe(false);
        });
    });

    describe('getStats', () => {
        test('통계 조회', async () => {
            const requestFn = jest.fn().mockResolvedValue({ status: 'safe' });

            // 5개 요청 (2개는 중복)
            manager.requestImageAnalysis('123', requestFn, 100);
            jest.advanceTimersByTime(50);

            manager.requestImageAnalysis('123', requestFn, 100);  // Debounce
            manager.requestImageAnalysis('456', requestFn, 100);
            jest.advanceTimersByTime(100);

            manager.requestImageAnalysis('123', requestFn, 100);  // 진행 중 중복
            manager.requestImageAnalysis('789', requestFn, 100);

            jest.advanceTimersByTime(100);

            const stats = manager.getStats();

            expect(stats.total).toBe(5);
            expect(stats.deduplicated + stats.debounced).toBeGreaterThan(0);
            expect(stats.deduplicationRate).toMatch(/%$/);
        });

        test('중복 제거율 계산', () => {
            const requestFn = jest.fn().mockResolvedValue({ status: 'safe' });

            // 10개 요청
            for (let i = 0; i < 10; i++) {
                manager.requestImageAnalysis('123', requestFn, 100);
                jest.advanceTimersByTime(10);
            }

            const stats = manager.getStats();

            // 10개 중 9개 중복 제거 → 90%
            expect(stats.total).toBe(10);
            expect(stats.deduplicated + stats.debounced).toBe(9);
            expect(stats.deduplicationRate).toBe('90.00%');
        });
    });

    describe('resetStats', () => {
        test('통계 초기화', () => {
            const requestFn = jest.fn().mockResolvedValue({ status: 'safe' });

            manager.requestImageAnalysis('123', requestFn, 100);
            manager.requestImageAnalysis('123', requestFn, 100);

            expect(manager.stats.total).toBeGreaterThan(0);

            manager.resetStats();

            expect(manager.stats.total).toBe(0);
            expect(manager.stats.deduplicated).toBe(0);
            expect(manager.stats.debounced).toBe(0);
        });
    });

    describe('destroy', () => {
        test('리소스 정리', () => {
            const requestFn = jest.fn().mockResolvedValue({ status: 'safe' });

            manager.requestImageAnalysis('123', requestFn, 100);
            manager.requestImageAnalysis('456', requestFn, 100);

            manager.destroy();

            expect(manager.pendingRequests.size).toBe(0);
            expect(manager.debounceTimers.size).toBe(0);
            expect(manager.stats.total).toBe(0);
        });
    });

    describe('싱글톤', () => {
        test('getApiRequestManager: 같은 인스턴스 반환', () => {
            const instance1 = getApiRequestManager();
            const instance2 = getApiRequestManager();

            expect(instance1).toBe(instance2);
        });

        test('resetApiRequestManager: 인스턴스 초기화', () => {
            const instance1 = getApiRequestManager();

            resetApiRequestManager();

            const instance2 = getApiRequestManager();

            expect(instance1).not.toBe(instance2);
        });
    });

    describe('실제 시나리오', () => {
        test('빠른 스크롤 시나리오', async () => {
            const requestFn = jest.fn().mockResolvedValue({ status: 'safe' });
            const promises = [];

            // 사용자가 빠르게 스크롤 (100개 게시글)
            for (let i = 1; i <= 100; i++) {
                promises.push(manager.requestImageAnalysis(String(i), requestFn, 100));
                jest.advanceTimersByTime(10);  // 10ms마다 요청
            }

            // 100ms 대기 (Debounce)
            jest.advanceTimersByTime(100);

            // 마이크로태스크 flush (async executeRequest의 requestFn 호출 대기)
            await Promise.all(promises);

            // 각 게시글당 한 번만 호출되어야 함
            expect(requestFn).toHaveBeenCalledTimes(100);

            const stats = manager.getStats();
            expect(stats.total).toBe(100);
        });

        test('중복 클릭 시나리오', async () => {
            const requestFn = jest.fn().mockResolvedValue({ status: 'safe' });
            const promises = [];

            // 사용자가 신호등을 5번 연타
            for (let i = 0; i < 5; i++) {
                promises.push(manager.requestImageAnalysis('123', requestFn, 300));
                jest.advanceTimersByTime(50);
            }

            // 300ms 대기
            jest.advanceTimersByTime(300);

            // 마이크로태스크 flush
            await Promise.all(promises);

            // 한 번만 호출되어야 함
            expect(requestFn).toHaveBeenCalledTimes(1);

            const stats = manager.getStats();
            expect(stats.total).toBe(5);
            expect(stats.deduplicated + stats.debounced).toBe(4);
            expect(stats.deduplicationRate).toBe('80.00%');
        });

        test('네트워크 불안정 시나리오', async () => {
            let attempt = 0;
            const requestFn = jest.fn().mockImplementation(() => {
                attempt++;
                if (attempt < 3) {
                    return Promise.reject(new Error('Network error'));
                }
                return Promise.resolve({ status: 'safe' });
            });

            // 첫 번째 시도 (실패)
            const promise1 = manager.requestImageAnalysis('123', requestFn, 100);
            jest.advanceTimersByTime(100);

            await expect(promise1).rejects.toThrow('Network error');

            // 두 번째 시도 (실패)
            const promise2 = manager.requestImageAnalysis('123', requestFn, 100);
            jest.advanceTimersByTime(100);

            await expect(promise2).rejects.toThrow('Network error');

            // 세 번째 시도 (성공)
            const promise3 = manager.requestImageAnalysis('123', requestFn, 100);
            jest.advanceTimersByTime(100);

            const result = await promise3;

            expect(result).toEqual({ status: 'safe' });
            expect(requestFn).toHaveBeenCalledTimes(3);
        });
    });
});
