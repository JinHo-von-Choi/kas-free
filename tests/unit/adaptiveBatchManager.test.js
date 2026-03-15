/**
 * Adaptive Batch Manager 단위 테스트
 * @author 최진호
 * @date 2026-02-26
 */

import {
    AdaptiveBatchManager,
    getAdaptiveBatchManager,
    resetAdaptiveBatchManager
} from '../../src/utils/adaptiveBatchManager.js';

describe('AdaptiveBatchManager', () => {
    let manager;
    let mockConnection;

    beforeEach(() => {
        // Navigator Connection Mock
        mockConnection = {
            effectiveType: '4g',
            downlink: 10,
            rtt: 50,
            saveData: false,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn()
        };

        // Navigator Mock
        Object.defineProperty(global.navigator, 'connection', {
            writable: true,
            value: mockConnection
        });

        // Performance Memory Mock
        Object.defineProperty(global.performance, 'memory', {
            writable: true,
            value: {
                usedJSHeapSize: 50 * 1024 * 1024,   // 50MB
                jsHeapSizeLimit: 100 * 1024 * 1024  // 100MB
            }
        });

        manager = new AdaptiveBatchManager({
            minBatchSize: 5,
            maxBatchSize: 100,
            defaultBatchSize: 30
        });
    });

    afterEach(() => {
        if (manager) {
            manager.destroy();
        }
        jest.clearAllMocks();
    });

    describe('초기화', () => {
        test('AdaptiveBatchManager 인스턴스 생성', () => {
            expect(manager.minBatchSize).toBe(5);
            expect(manager.maxBatchSize).toBe(100);
            expect(manager.defaultBatchSize).toBe(30);
            expect(manager.currentBatchSize).toBe(30);
            expect(manager.isMemoryPressure).toBe(false);
        });

        test('네트워크 상태 초기화', () => {
            expect(manager.networkInfo).toBeDefined();
            expect(manager.networkInfo.effectiveType).toBe('4g');
            expect(manager.networkInfo.downlink).toBe(10);
            expect(mockConnection.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
        });

        test('통계 초기화', () => {
            expect(manager.stats).toEqual({
                totalBatches: 0,
                successfulBatches: 0,
                failedBatches: 0,
                consecutiveSuccesses: 0,
                consecutiveFailures: 0,
                adjustmentCount: 0,
                totalItemsProcessed: 0
            });
        });
    });

    describe('updateNetworkInfo', () => {
        test('네트워크 상태 업데이트', () => {
            mockConnection.effectiveType = '3g';
            mockConnection.downlink = 3;
            mockConnection.rtt = 100;
            mockConnection.saveData = true;

            manager.updateNetworkInfo();

            expect(manager.networkInfo).toEqual({
                effectiveType: '3g',
                downlink: 3,
                rtt: 100,
                saveData: true
            });
        });
    });

    describe('calculateBatchSize', () => {
        test('4G + 고속 네트워크: 50개', () => {
            manager.networkInfo = {
                effectiveType: '4g',
                downlink: 10,
                saveData: false
            };

            const batchSize = manager.calculateBatchSize();
            expect(batchSize).toBe(50);
        });

        test('3G 또는 중속 네트워크: 30개', () => {
            manager.networkInfo = {
                effectiveType: '3g',
                downlink: 3,
                saveData: false
            };

            const batchSize = manager.calculateBatchSize();
            expect(batchSize).toBe(30);
        });

        test('2G 또는 저속 네트워크: 10개', () => {
            manager.networkInfo = {
                effectiveType: '2g',
                downlink: 1,
                saveData: false
            };

            const batchSize = manager.calculateBatchSize();
            expect(batchSize).toBe(10);
        });

        test('데이터 절약 모드: 최소 배치 (5개)', () => {
            manager.networkInfo = {
                effectiveType: '4g',
                downlink: 10,
                saveData: true
            };

            const batchSize = manager.calculateBatchSize();
            expect(batchSize).toBe(5);
        });

        test('메모리 압박 시 배치 크기 50% 감소', () => {
            manager.networkInfo = {
                effectiveType: '4g',
                downlink: 10,
                saveData: false
            };
            manager.isMemoryPressure = true;

            const batchSize = manager.calculateBatchSize();
            expect(batchSize).toBe(25);  // 50 * 0.5
        });

        test('최소 배치 크기 제한', () => {
            manager.networkInfo = {
                effectiveType: 'slow-2g',
                downlink: 0.5,
                saveData: false
            };
            manager.isMemoryPressure = true;

            const batchSize = manager.calculateBatchSize();
            expect(batchSize).toBeGreaterThanOrEqual(5);
        });

        test('최대 배치 크기 제한', () => {
            manager.defaultBatchSize = 120;  // 최대치 초과
            manager.networkInfo = {
                effectiveType: '4g',
                downlink: 10,
                saveData: false
            };

            const batchSize = manager.calculateBatchSize();
            expect(batchSize).toBeLessThanOrEqual(100);
        });
    });

    describe('adjustBatchSize', () => {
        test('네트워크 변경 시 배치 크기 조절', () => {
            manager.currentBatchSize = 50;
            manager.networkInfo = {
                effectiveType: '2g',
                downlink: 1,
                saveData: false
            };

            manager.adjustBatchSize();

            expect(manager.currentBatchSize).toBe(10);
            expect(manager.stats.adjustmentCount).toBe(1);
        });

        test('배치 크기 변경 없으면 카운트 증가 안 함', () => {
            manager.currentBatchSize = 30;
            manager.networkInfo = {
                effectiveType: '3g',
                downlink: 3,
                saveData: false
            };

            manager.adjustBatchSize();

            expect(manager.currentBatchSize).toBe(30);
            expect(manager.stats.adjustmentCount).toBe(0);
        });
    });

    describe('getBatchSize', () => {
        test('현재 배치 크기 반환', () => {
            manager.currentBatchSize = 42;
            expect(manager.getBatchSize()).toBe(42);
        });
    });

    describe('recordSuccess', () => {
        test('성공 기록 및 통계 업데이트', () => {
            manager.recordSuccess(10);

            expect(manager.stats.totalBatches).toBe(1);
            expect(manager.stats.successfulBatches).toBe(1);
            expect(manager.stats.consecutiveSuccesses).toBe(1);
            expect(manager.stats.consecutiveFailures).toBe(0);
            expect(manager.stats.totalItemsProcessed).toBe(10);
        });

        test('연속 성공 3회 시 배치 크기 10% 증가', () => {
            manager.currentBatchSize = 30;

            manager.recordSuccess(10);
            manager.recordSuccess(10);
            manager.recordSuccess(10);

            expect(manager.currentBatchSize).toBe(33);  // 30 * 1.1
            expect(manager.stats.adjustmentCount).toBe(1);
            expect(manager.stats.consecutiveSuccesses).toBe(0);  // 리셋
        });

        test('최대 배치 크기 제한', () => {
            manager.currentBatchSize = 95;

            manager.recordSuccess(10);
            manager.recordSuccess(10);
            manager.recordSuccess(10);

            expect(manager.currentBatchSize).toBe(100);  // 최대치
        });

        test('실패 카운터 리셋', () => {
            manager.stats.consecutiveFailures = 5;

            manager.recordSuccess(10);

            expect(manager.stats.consecutiveFailures).toBe(0);
        });
    });

    describe('recordFailure', () => {
        test('실패 기록 및 통계 업데이트', () => {
            const error = new Error('Network error');

            manager.recordFailure(error);

            expect(manager.stats.totalBatches).toBe(1);
            expect(manager.stats.failedBatches).toBe(1);
            expect(manager.stats.consecutiveFailures).toBe(1);
            expect(manager.stats.consecutiveSuccesses).toBe(0);
        });

        test('연속 실패 2회 시 배치 크기 50% 감소', () => {
            manager.currentBatchSize = 30;

            manager.recordFailure(new Error('Error 1'));
            manager.recordFailure(new Error('Error 2'));

            expect(manager.currentBatchSize).toBe(15);  // 30 * 0.5
            expect(manager.stats.adjustmentCount).toBe(1);
            expect(manager.stats.consecutiveFailures).toBe(0);  // 리셋
        });

        test('최소 배치 크기 제한', () => {
            manager.currentBatchSize = 8;

            manager.recordFailure(new Error('Error 1'));
            manager.recordFailure(new Error('Error 2'));

            expect(manager.currentBatchSize).toBe(5);  // 최소치
        });

        test('성공 카운터 리셋', () => {
            manager.stats.consecutiveSuccesses = 5;

            manager.recordFailure(new Error('Error'));

            expect(manager.stats.consecutiveSuccesses).toBe(0);
        });
    });

    describe('checkMemoryPressure', () => {
        test('메모리 사용률 90% 이상이면 압박 상태', () => {
            performance.memory.usedJSHeapSize = 95 * 1024 * 1024;   // 95MB
            performance.memory.jsHeapSizeLimit = 100 * 1024 * 1024; // 100MB

            manager.checkMemoryPressure();

            expect(manager.isMemoryPressure).toBe(true);
        });

        test('메모리 사용률 90% 미만이면 정상 상태', () => {
            performance.memory.usedJSHeapSize = 50 * 1024 * 1024;   // 50MB
            performance.memory.jsHeapSizeLimit = 100 * 1024 * 1024; // 100MB

            manager.checkMemoryPressure();

            expect(manager.isMemoryPressure).toBe(false);
        });
    });

    describe('splitIntoBatches', () => {
        test('배열을 배치로 분할', () => {
            manager.currentBatchSize = 10;
            const items = Array.from({ length: 25 }, (_, i) => i);

            const batches = manager.splitIntoBatches(items);

            expect(batches.length).toBe(3);
            expect(batches[0].length).toBe(10);
            expect(batches[1].length).toBe(10);
            expect(batches[2].length).toBe(5);
        });

        test('빈 배열', () => {
            const batches = manager.splitIntoBatches([]);

            expect(batches.length).toBe(0);
        });

        test('배치 크기보다 작은 배열', () => {
            manager.currentBatchSize = 10;
            const items = [1, 2, 3];

            const batches = manager.splitIntoBatches(items);

            expect(batches.length).toBe(1);
            expect(batches[0].length).toBe(3);
        });
    });

    describe('processBatches', () => {
        test('모든 배치 성공', async () => {
            manager.currentBatchSize = 10;
            const items = Array.from({ length: 25 }, (_, i) => i);
            const processFn = jest.fn().mockResolvedValue();

            const results = await manager.processBatches(items, processFn);

            expect(results.successful).toBe(25);
            expect(results.failed).toBe(0);
            expect(results.errors.length).toBe(0);
            expect(processFn).toHaveBeenCalledTimes(3);
            expect(manager.stats.successfulBatches).toBe(3);
        });

        test('일부 배치 실패', async () => {
            manager.currentBatchSize = 10;
            const items = Array.from({ length: 25 }, (_, i) => i);

            let callCount = 0;
            const processFn = jest.fn().mockImplementation(() => {
                if (callCount++ === 1) {
                    return Promise.reject(new Error('Batch 2 failed'));
                }
                return Promise.resolve();
            });

            const results = await manager.processBatches(items, processFn);

            expect(results.successful).toBe(15);  // 배치 1, 3 성공
            expect(results.failed).toBe(10);      // 배치 2 실패
            expect(results.errors.length).toBe(1);
            expect(results.errors[0].batchIndex).toBe(1);
            expect(manager.stats.successfulBatches).toBe(2);
            expect(manager.stats.failedBatches).toBe(1);
        });

        test('모든 배치 실패', async () => {
            manager.currentBatchSize = 10;
            const items = Array.from({ length: 25 }, (_, i) => i);
            const processFn = jest.fn().mockRejectedValue(new Error('All failed'));

            const results = await manager.processBatches(items, processFn);

            expect(results.successful).toBe(0);
            expect(results.failed).toBe(25);
            expect(results.errors.length).toBe(3);
            expect(manager.stats.failedBatches).toBe(3);
        });

        test('빈 배열 처리', async () => {
            const processFn = jest.fn();

            const results = await manager.processBatches([], processFn);

            expect(results.successful).toBe(0);
            expect(results.failed).toBe(0);
            expect(processFn).not.toHaveBeenCalled();
        });
    });

    describe('통계', () => {
        test('getStats: 통계 조회', () => {
            manager.stats = {
                totalBatches: 10,
                successfulBatches: 8,
                failedBatches: 2,
                consecutiveSuccesses: 3,
                consecutiveFailures: 0,
                adjustmentCount: 5,
                totalItemsProcessed: 240
            };
            manager.currentBatchSize = 35;

            const stats = manager.getStats();

            expect(stats.totalBatches).toBe(10);
            expect(stats.successfulBatches).toBe(8);
            expect(stats.failedBatches).toBe(2);
            expect(stats.currentBatchSize).toBe(35);
            expect(stats.successRate).toBe('80.00%');
            expect(stats.avgItemsPerBatch).toBe('30.00');
        });

        test('getStats: 배치가 없으면 successRate 0%', () => {
            const stats = manager.getStats();

            expect(stats.successRate).toBe('0%');
            expect(stats.avgItemsPerBatch).toBe('0');
        });

        test('resetStats: 통계 초기화', () => {
            manager.stats = {
                totalBatches: 10,
                successfulBatches: 8,
                failedBatches: 2,
                consecutiveSuccesses: 3,
                consecutiveFailures: 0,
                adjustmentCount: 5,
                totalItemsProcessed: 240
            };

            manager.resetStats();

            expect(manager.stats).toEqual({
                totalBatches: 0,
                successfulBatches: 0,
                failedBatches: 0,
                consecutiveSuccesses: 0,
                consecutiveFailures: 0,
                adjustmentCount: 0,
                totalItemsProcessed: 0
            });
        });
    });

    describe('destroy', () => {
        test('리소스 정리', () => {
            manager.stats.totalBatches = 10;

            manager.destroy();

            expect(manager.connection).toBeNull();
            expect(manager.stats.totalBatches).toBe(0);
        });
    });

    describe('싱글톤', () => {
        test('getAdaptiveBatchManager: 같은 인스턴스 반환', () => {
            const instance1 = getAdaptiveBatchManager();
            const instance2 = getAdaptiveBatchManager();

            expect(instance1).toBe(instance2);
        });

        test('resetAdaptiveBatchManager: 인스턴스 초기화', () => {
            const instance1 = getAdaptiveBatchManager();

            resetAdaptiveBatchManager();

            const instance2 = getAdaptiveBatchManager();

            expect(instance1).not.toBe(instance2);
        });
    });

    describe('실제 시나리오', () => {
        test('네트워크 변경 시나리오', () => {
            // 초기: 4G (50개)
            manager.networkInfo = {
                effectiveType: '4g',
                downlink: 10,
                saveData: false
            };
            manager.adjustBatchSize();
            expect(manager.currentBatchSize).toBe(50);

            // 3G로 변경 (30개)
            manager.networkInfo = {
                effectiveType: '3g',
                downlink: 3,
                saveData: false
            };
            manager.adjustBatchSize();
            expect(manager.currentBatchSize).toBe(30);

            // 2G로 변경 (10개)
            manager.networkInfo = {
                effectiveType: '2g',
                downlink: 1,
                saveData: false
            };
            manager.adjustBatchSize();
            expect(manager.currentBatchSize).toBe(10);

            expect(manager.stats.adjustmentCount).toBe(3);
        });

        test('연속 실패 후 복구 시나리오', () => {
            manager.currentBatchSize = 50;

            // 연속 2회 실패 → 25개
            manager.recordFailure(new Error('Error 1'));
            manager.recordFailure(new Error('Error 2'));
            expect(manager.currentBatchSize).toBe(25);

            // 연속 2회 실패 → 12개
            manager.recordFailure(new Error('Error 3'));
            manager.recordFailure(new Error('Error 4'));
            expect(manager.currentBatchSize).toBe(12);

            // 연속 3회 성공 → 13개
            manager.recordSuccess(10);
            manager.recordSuccess(10);
            manager.recordSuccess(10);
            expect(manager.currentBatchSize).toBe(13);

            // 연속 3회 성공 → 14개
            manager.recordSuccess(10);
            manager.recordSuccess(10);
            manager.recordSuccess(10);
            expect(manager.currentBatchSize).toBe(14);
        });

        test('메모리 압박 시나리오', () => {
            manager.networkInfo = {
                effectiveType: '4g',
                downlink: 10,
                saveData: false
            };
            manager.adjustBatchSize();
            expect(manager.currentBatchSize).toBe(50);

            // 메모리 압박 발생 → 25개
            manager.isMemoryPressure = true;
            manager.adjustBatchSize();
            expect(manager.currentBatchSize).toBe(25);

            // 메모리 압박 해소 → 50개
            manager.isMemoryPressure = false;
            manager.adjustBatchSize();
            expect(manager.currentBatchSize).toBe(50);
        });

        test('대량 데이터 처리 시나리오', async () => {
            manager.currentBatchSize = 20;
            const items = Array.from({ length: 100 }, (_, i) => i);

            let processedCount = 0;
            const processFn = jest.fn().mockImplementation((batch) => {
                processedCount += batch.length;
                return Promise.resolve();
            });

            const results = await manager.processBatches(items, processFn);

            expect(results.successful).toBe(100);
            expect(processedCount).toBe(100);
            expect(processFn).toHaveBeenCalledTimes(5);  // 100 / 20
            expect(manager.stats.totalItemsProcessed).toBe(100);
        });
    });
});
