/**
 * PerformanceMonitor 단위 테스트
 * @author 최진호
 * @date 2026-02-12
 */

import { PerformanceMonitor, getPerformanceMonitor } from '../../src/utils/PerformanceMonitor.js';
import { getStorage, setStorage } from '../../src/utils/storage.js';

// Mock storage functions
jest.mock('../../src/utils/storage.js', () => ({
    getStorage: jest.fn(),
    setStorage: jest.fn()
}));

describe('PerformanceMonitor', () => {
    let monitor;

    beforeEach(() => {
        jest.clearAllMocks();
        monitor = new PerformanceMonitor();

        // Mock storage
        getStorage.mockResolvedValue({
            analysis: {
                total:     0,
                totalTime: 0,
                avgTime:   0,
                minTime:   Infinity,
                maxTime:   0
            },
            cache: {
                hits:    0,
                misses:  0,
                hitRate: 0
            },
            hash: {
                total:     0,
                totalTime: 0,
                avgTime:   0
            },
            api: {
                total:     0,
                totalTime: 0,
                avgTime:   0,
                errors:    0
            },
            session: {
                startTime: Date.now(),
                lastReset: Date.now()
            }
        });
        setStorage.mockResolvedValue(true);
    });

    describe('initialize', () => {
        test('메트릭 초기화', async () => {
            await monitor.initialize();

            expect(monitor.metrics).not.toBeNull();
            expect(getStorage).toHaveBeenCalledWith('performance_metrics', expect.any(Object));
        });
    });

    describe('타이머', () => {
        test('타이머 시작 및 종료', async () => {
            await monitor.initialize();

            const timerId = monitor.startTimer('test');
            expect(timerId).toContain('test_');

            await new Promise(resolve => setTimeout(resolve, 100));

            const elapsed = monitor.endTimer(timerId);
            expect(elapsed).toBeGreaterThan(0);
        });

        test('존재하지 않는 타이머 종료 시 0 반환', async () => {
            await monitor.initialize();

            const elapsed = monitor.endTimer('invalid-timer-id');
            expect(elapsed).toBe(0);
        });
    });

    describe('분석 시간 기록', () => {
        test('분석 시간 기록 및 통계 업데이트', async () => {
            await monitor.initialize();

            await monitor.recordAnalysisTime(100);
            await monitor.recordAnalysisTime(200);
            await monitor.recordAnalysisTime(150);

            expect(monitor.metrics.analysis.total).toBe(3);
            expect(monitor.metrics.analysis.totalTime).toBe(450);
            expect(monitor.metrics.analysis.avgTime).toBe(150);
            expect(monitor.metrics.analysis.minTime).toBe(100);
            expect(monitor.metrics.analysis.maxTime).toBe(200);
        });
    });

    describe('캐시 히트율', () => {
        test('캐시 히트 기록', async () => {
            await monitor.initialize();

            await monitor.recordCacheHit();
            await monitor.recordCacheHit();
            await monitor.recordCacheMiss();

            expect(monitor.metrics.cache.hits).toBe(2);
            expect(monitor.metrics.cache.misses).toBe(1);
            expect(monitor.metrics.cache.hitRate).toBeCloseTo(66.67, 1);
        });

        test('캐시 미스만 있을 때 히트율 0%', async () => {
            await monitor.initialize();

            await monitor.recordCacheMiss();
            await monitor.recordCacheMiss();

            expect(monitor.metrics.cache.hitRate).toBe(0);
        });

        test('캐시 기록 없을 때 히트율 0%', async () => {
            await monitor.initialize();

            expect(monitor.metrics.cache.hitRate).toBe(0);
        });
    });

    describe('해시 생성 시간 기록', () => {
        test('해시 시간 기록 및 평균 계산', async () => {
            await monitor.initialize();

            await monitor.recordHashTime(50);
            await monitor.recordHashTime(100);
            await monitor.recordHashTime(75);

            expect(monitor.metrics.hash.total).toBe(3);
            expect(monitor.metrics.hash.totalTime).toBe(225);
            expect(monitor.metrics.hash.avgTime).toBe(75);
        });
    });

    describe('API 호출 시간 기록', () => {
        test('API 성공 시 기록', async () => {
            await monitor.initialize();

            await monitor.recordApiTime(100, false);
            await monitor.recordApiTime(200, false);

            expect(monitor.metrics.api.total).toBe(2);
            expect(monitor.metrics.api.totalTime).toBe(300);
            expect(monitor.metrics.api.avgTime).toBe(150);
            expect(monitor.metrics.api.errors).toBe(0);
        });

        test('API 에러 시 기록', async () => {
            await monitor.initialize();

            await monitor.recordApiTime(100, true);
            await monitor.recordApiTime(200, true);
            await monitor.recordApiTime(150, false);

            expect(monitor.metrics.api.total).toBe(3);
            expect(monitor.metrics.api.errors).toBe(2);
        });
    });

    describe('메트릭 조회', () => {
        test('전체 메트릭 조회', async () => {
            await monitor.initialize();
            await monitor.recordAnalysisTime(100);
            await monitor.recordCacheHit();

            const metrics = await monitor.getMetrics();

            expect(metrics.analysis.total).toBe(1);
            expect(metrics.cache.hits).toBe(1);
        });

        test('요약 메트릭 조회', async () => {
            await monitor.initialize();
            await monitor.recordAnalysisTime(100);
            await monitor.recordCacheHit();
            await monitor.recordCacheMiss();
            await monitor.recordHashTime(50);
            await monitor.recordApiTime(200, false);
            await monitor.recordApiTime(150, true);

            const summary = await monitor.getSummary();

            expect(summary.analysis.total).toBe(1);
            expect(summary.cache.hitRate).toContain('%');
            expect(summary.hash.total).toBe(1);
            expect(summary.api.total).toBe(2);
            expect(summary.api.errorRate).toContain('%');
        });
    });

    describe('메트릭 초기화', () => {
        test('메트릭 리셋', async () => {
            await monitor.initialize();
            await monitor.recordAnalysisTime(100);
            await monitor.recordCacheHit();

            await monitor.reset();

            expect(monitor.metrics.analysis.total).toBe(0);
            expect(monitor.metrics.cache.hits).toBe(0);
        });
    });

    describe('싱글톤 패턴', () => {
        test('getPerformanceMonitor는 동일한 인스턴스 반환', () => {
            const instance1 = getPerformanceMonitor();
            const instance2 = getPerformanceMonitor();

            expect(instance1).toBe(instance2);
        });
    });
});
