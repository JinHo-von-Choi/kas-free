/**
 * Memory Manager 단위 테스트
 * @author 최진호
 * @date 2026-02-26
 */

import { MemoryManager, CachePriority } from '../../src/sw/memoryManager.js';

describe('MemoryManager', () => {
    let manager;
    let mockCache;
    let mockCaches;

    beforeEach(() => {
        jest.useFakeTimers();

        // Cache API Mock
        mockCache = {
            match: jest.fn(),
            put: jest.fn(),
            delete: jest.fn(),
            keys: jest.fn().mockResolvedValue([])
        };

        mockCaches = {
            open: jest.fn().mockResolvedValue(mockCache),
            keys: jest.fn().mockResolvedValue(['kas-cache', 'kas-metadata'])
        };

        global.caches = mockCaches;

        // Performance Memory Mock
        Object.defineProperty(global.performance, 'memory', {
            writable: true,
            value: {
                usedJSHeapSize: 50 * 1024 * 1024,   // 50MB
                jsHeapSizeLimit: 100 * 1024 * 1024  // 100MB
            }
        });

        manager = new MemoryManager({
            maxCacheSize: 100 * 1024 * 1024,  // 100MB
            cacheExpiry: 7 * 24 * 60 * 60 * 1000,  // 7일
            cleanupInterval: 10 * 60 * 1000  // 10분
        });
    });

    afterEach(() => {
        if (manager) {
            manager.destroy();
        }
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    describe('초기화', () => {
        test('MemoryManager 인스턴스 생성', () => {
            expect(manager.maxCacheSize).toBe(100 * 1024 * 1024);
            expect(manager.cacheExpiry).toBe(7 * 24 * 60 * 60 * 1000);
            expect(manager.cleanupInterval).toBe(10 * 60 * 1000);
            expect(manager.cachePriorities).toBeInstanceOf(Map);
            expect(manager.cacheAccessTimes).toBeInstanceOf(Map);
        });

        test('통계 초기화', () => {
            expect(manager.stats).toEqual({
                totalCleanups: 0,
                itemsDeleted: 0,
                bytesFreed: 0,
                lastCleanupTime: null
            });
        });

        test('init: 메타데이터 복원 및 자동 정리 시작', async () => {
            mockCache.match.mockResolvedValue(
                new Response(JSON.stringify({
                    priorities: { 'url1': CachePriority.HIGH },
                    accessTimes: { 'url1': 1234567890 }
                }), {
                    headers: { 'Content-Type': 'application/json' }
                })
            );

            await manager.init();

            expect(manager.cachePriorities.size).toBe(1);
            expect(manager.cacheAccessTimes.size).toBe(1);
            expect(manager.intervalId).not.toBeNull();
        });
    });

    describe('registerCache', () => {
        test('캐시 등록 (우선순위 설정)', () => {
            const url = 'https://example.com/image.jpg';
            const priority = CachePriority.MEDIUM;

            manager.registerCache(url, priority);

            expect(manager.cachePriorities.get(url)).toBe(priority);
            expect(manager.cacheAccessTimes.has(url)).toBe(true);
        });

        test('여러 캐시 등록', () => {
            manager.registerCache('url1', CachePriority.HIGH);
            manager.registerCache('url2', CachePriority.MEDIUM);
            manager.registerCache('url3', CachePriority.LOW);

            expect(manager.cachePriorities.size).toBe(3);
            expect(manager.cacheAccessTimes.size).toBe(3);
        });
    });

    describe('recordCacheAccess', () => {
        test('캐시 접근 시간 업데이트', () => {
            const url = 'https://example.com/image.jpg';
            manager.registerCache(url, CachePriority.HIGH);

            const oldTime = manager.cacheAccessTimes.get(url);

            jest.advanceTimersByTime(1000);
            manager.recordCacheAccess(url);

            const newTime = manager.cacheAccessTimes.get(url);
            expect(newTime).toBeGreaterThan(oldTime);
        });
    });

    describe('getMemoryUsage', () => {
        test('메모리 사용률 계산', () => {
            const usage = manager.getMemoryUsage();

            expect(usage).toBe(0.5);  // 50MB / 100MB
        });

        test('performance.memory 미지원 시 0 반환', () => {
            delete performance.memory;

            const usage = manager.getMemoryUsage();

            expect(usage).toBe(0);
        });
    });

    describe('getTotalCacheSize', () => {
        test('캐시 총 크기 계산', async () => {
            const mockRequests = [
                new Request('url1'),
                new Request('url2')
            ];

            mockCache.keys.mockResolvedValue(mockRequests);

            mockCache.match
                .mockResolvedValueOnce(
                    new Response(new Blob(['a'.repeat(1024)]))  // 1KB
                )
                .mockResolvedValueOnce(
                    new Response(new Blob(['b'.repeat(2048)]))  // 2KB
                );

            const totalSize = await manager.getTotalCacheSize();

            expect(totalSize).toBe(1024 + 2048);
        });

        test('빈 캐시', async () => {
            mockCache.keys.mockResolvedValue([]);

            const totalSize = await manager.getTotalCacheSize();

            expect(totalSize).toBe(0);
        });
    });

    describe('deleteExpiredCaches', () => {
        test('만료된 캐시 삭제', async () => {
            const now = Date.now();
            const expiredTime = now - (8 * 24 * 60 * 60 * 1000);  // 8일 전

            manager.cacheAccessTimes.set('expired-url', expiredTime);
            manager.cacheAccessTimes.set('valid-url', now);

            mockCache.match.mockResolvedValueOnce(
                new Response(new Blob(['data']))
            );

            const result = await manager.deleteExpiredCaches();

            expect(result.count).toBe(1);
            expect(result.bytes).toBeGreaterThan(0);
            expect(manager.cacheAccessTimes.has('expired-url')).toBe(false);
            expect(manager.cacheAccessTimes.has('valid-url')).toBe(true);
        });

        test('만료된 캐시 없음', async () => {
            const now = Date.now();
            manager.cacheAccessTimes.set('valid-url', now);

            const result = await manager.deleteExpiredCaches();

            expect(result.count).toBe(0);
            expect(result.bytes).toBe(0);
        });
    });

    describe('deleteCachesByPriority', () => {
        test('LOW 우선순위 캐시 삭제', async () => {
            manager.cachePriorities.set('low1', CachePriority.LOW);
            manager.cachePriorities.set('low2', CachePriority.LOW);
            manager.cachePriorities.set('high1', CachePriority.HIGH);

            mockCache.match
                .mockResolvedValueOnce(new Response(new Blob(['data1'])))
                .mockResolvedValueOnce(new Response(new Blob(['data2'])));

            const result = await manager.deleteCachesByPriority(CachePriority.LOW);

            expect(result.count).toBe(2);
            expect(manager.cachePriorities.has('low1')).toBe(false);
            expect(manager.cachePriorities.has('low2')).toBe(false);
            expect(manager.cachePriorities.has('high1')).toBe(true);
        });

        test('MEDIUM 우선순위 캐시 삭제', async () => {
            manager.cachePriorities.set('med1', CachePriority.MEDIUM);
            manager.cachePriorities.set('low1', CachePriority.LOW);

            mockCache.match.mockResolvedValueOnce(
                new Response(new Blob(['data']))
            );

            const result = await manager.deleteCachesByPriority(CachePriority.MEDIUM);

            expect(result.count).toBe(1);
            expect(manager.cachePriorities.has('med1')).toBe(false);
            expect(manager.cachePriorities.has('low1')).toBe(true);
        });

        test('해당 우선순위 캐시 없음', async () => {
            manager.cachePriorities.set('high1', CachePriority.HIGH);

            const result = await manager.deleteCachesByPriority(CachePriority.LOW);

            expect(result.count).toBe(0);
        });
    });

    describe('deleteLRUCaches', () => {
        test('LRU 기반 캐시 삭제', async () => {
            const now = Date.now();

            // 오래된 것부터
            manager.cacheAccessTimes.set('old1', now - 3000);
            manager.cachePriorities.set('old1', CachePriority.MEDIUM);

            manager.cacheAccessTimes.set('old2', now - 2000);
            manager.cachePriorities.set('old2', CachePriority.LOW);

            manager.cacheAccessTimes.set('new1', now - 1000);
            manager.cachePriorities.set('new1', CachePriority.LOW);

            const targetBytes = 2048;

            mockCache.match
                .mockResolvedValueOnce(new Response(new Blob(['a'.repeat(1024)])))  // 1KB
                .mockResolvedValueOnce(new Response(new Blob(['b'.repeat(1024)])));  // 1KB

            const result = await manager.deleteLRUCaches(targetBytes);

            expect(result.count).toBe(2);
            expect(result.bytes).toBeGreaterThanOrEqual(targetBytes);
            expect(manager.cacheAccessTimes.has('old1')).toBe(false);
            expect(manager.cacheAccessTimes.has('old2')).toBe(false);
        });

        test('HIGH 우선순위는 건너뛰기', async () => {
            const now = Date.now();

            manager.cacheAccessTimes.set('old-high', now - 3000);
            manager.cachePriorities.set('old-high', CachePriority.HIGH);

            manager.cacheAccessTimes.set('old-low', now - 2000);
            manager.cachePriorities.set('old-low', CachePriority.LOW);

            const targetBytes = 1024;

            mockCache.match.mockResolvedValueOnce(
                new Response(new Blob(['data']))
            );

            const result = await manager.deleteLRUCaches(targetBytes);

            expect(manager.cachePriorities.has('old-high')).toBe(true);
            expect(manager.cachePriorities.has('old-low')).toBe(false);
        });
    });

    describe('performCleanup', () => {
        test('정리 수행: 만료된 캐시 삭제', async () => {
            const now = Date.now();
            const expiredTime = now - (8 * 24 * 60 * 60 * 1000);

            manager.cacheAccessTimes.set('expired', expiredTime);
            manager.cachePriorities.set('expired', CachePriority.LOW);

            mockCache.match.mockResolvedValue(
                new Response(new Blob(['data']))
            );

            await manager.performCleanup();

            expect(manager.stats.totalCleanups).toBe(1);
            expect(manager.stats.itemsDeleted).toBeGreaterThan(0);
            expect(manager.cacheAccessTimes.has('expired')).toBe(false);
        });

        test('메모리 압박 시 LOW 우선순위 정리', async () => {
            // 메모리 사용률 85% (threshold.low 이상)
            performance.memory.usedJSHeapSize = 85 * 1024 * 1024;

            manager.cachePriorities.set('low1', CachePriority.LOW);
            manager.cacheAccessTimes.set('low1', Date.now());

            mockCache.match.mockResolvedValue(
                new Response(new Blob(['data']))
            );

            await manager.performCleanup();

            expect(manager.cachePriorities.has('low1')).toBe(false);
        });

        test('메모리 압박 심각 시 MEDIUM 우선순위 정리', async () => {
            // 메모리 사용률 95% (threshold.medium 이상)
            performance.memory.usedJSHeapSize = 95 * 1024 * 1024;

            manager.cachePriorities.set('med1', CachePriority.MEDIUM);
            manager.cacheAccessTimes.set('med1', Date.now());

            mockCache.match.mockResolvedValue(
                new Response(new Blob(['data']))
            );

            await manager.performCleanup();

            expect(manager.cachePriorities.has('med1')).toBe(false);
        });
    });

    describe('자동 정리', () => {
        test('startAutoCleanup: 인터벌 시작', () => {
            manager.startAutoCleanup();

            expect(manager.intervalId).not.toBeNull();
        });

        test('stopAutoCleanup: 인터벌 중지', () => {
            manager.startAutoCleanup();
            const intervalId = manager.intervalId;

            manager.stopAutoCleanup();

            expect(manager.intervalId).toBeNull();
        });

        test('자동 정리 실행', async () => {
            jest.spyOn(manager, 'performCleanup').mockResolvedValue();

            manager.startAutoCleanup();

            jest.advanceTimersByTime(10 * 60 * 1000);  // 10분

            expect(manager.performCleanup).toHaveBeenCalledTimes(1);

            jest.advanceTimersByTime(10 * 60 * 1000);  // 10분 더

            expect(manager.performCleanup).toHaveBeenCalledTimes(2);
        });
    });

    describe('메타데이터 저장/복원', () => {
        test('saveMetadata: 메타데이터 저장', async () => {
            manager.cachePriorities.set('url1', CachePriority.HIGH);
            manager.cacheAccessTimes.set('url1', 1234567890);

            await manager.saveMetadata();

            expect(mockCache.put).toHaveBeenCalledWith(
                'cache-metadata',
                expect.any(Response)
            );

            const putCall = mockCache.put.mock.calls[0];
            const response = putCall[1];
            const data = await response.json();

            expect(data.priorities).toEqual({ url1: CachePriority.HIGH });
            expect(data.accessTimes).toEqual({ url1: 1234567890 });
        });

        test('restoreMetadata: 메타데이터 복원', async () => {
            mockCache.match.mockResolvedValue(
                new Response(JSON.stringify({
                    priorities: { 'url1': CachePriority.HIGH, 'url2': CachePriority.LOW },
                    accessTimes: { 'url1': 1000, 'url2': 2000 }
                }), {
                    headers: { 'Content-Type': 'application/json' }
                })
            );

            await manager.restoreMetadata();

            expect(manager.cachePriorities.size).toBe(2);
            expect(manager.cacheAccessTimes.size).toBe(2);
            expect(manager.cachePriorities.get('url1')).toBe(CachePriority.HIGH);
            expect(manager.cacheAccessTimes.get('url2')).toBe(2000);
        });

        test('restoreMetadata: 메타데이터 없음', async () => {
            mockCache.match.mockResolvedValue(null);

            await manager.restoreMetadata();

            expect(manager.cachePriorities.size).toBe(0);
            expect(manager.cacheAccessTimes.size).toBe(0);
        });
    });

    describe('통계', () => {
        test('getStats: 통계 조회', async () => {
            manager.stats = {
                totalCleanups: 5,
                itemsDeleted: 50,
                bytesFreed: 10 * 1024 * 1024,
                lastCleanupTime: Date.now()
            };

            manager.cachePriorities.set('url1', CachePriority.HIGH);
            manager.cachePriorities.set('url2', CachePriority.MEDIUM);
            manager.cachePriorities.set('url3', CachePriority.LOW);

            mockCache.keys.mockResolvedValue([]);

            const stats = await manager.getStats();

            expect(stats.totalCleanups).toBe(5);
            expect(stats.itemsDeleted).toBe(50);
            expect(stats.registeredCaches).toBe(3);
            expect(stats.highPriorityCaches).toBe(1);
            expect(stats.mediumPriorityCaches).toBe(1);
            expect(stats.lowPriorityCaches).toBe(1);
        });

        test('resetStats: 통계 초기화', () => {
            manager.stats = {
                totalCleanups: 5,
                itemsDeleted: 50,
                bytesFreed: 1000,
                lastCleanupTime: Date.now()
            };

            manager.resetStats();

            expect(manager.stats).toEqual({
                totalCleanups: 0,
                itemsDeleted: 0,
                bytesFreed: 0,
                lastCleanupTime: null
            });
        });
    });

    describe('destroy', () => {
        test('리소스 정리', () => {
            manager.startAutoCleanup();
            manager.cachePriorities.set('url1', CachePriority.HIGH);
            manager.cacheAccessTimes.set('url1', Date.now());
            manager.stats.totalCleanups = 5;

            manager.destroy();

            expect(manager.intervalId).toBeNull();
            expect(manager.cachePriorities.size).toBe(0);
            expect(manager.cacheAccessTimes.size).toBe(0);
            expect(manager.stats.totalCleanups).toBe(0);
        });
    });

    describe('실제 시나리오', () => {
        test('캐시 크기 초과 시나리오', async () => {
            // 캐시 크기 120MB (maxCacheSize 100MB 초과)
            manager.maxCacheSize = 100 * 1024 * 1024;

            const mockRequests = [
                new Request('url1'),
                new Request('url2')
            ];

            mockCache.keys.mockResolvedValue(mockRequests);

            // 각 캐시 60MB (총 120MB)
            mockCache.match
                .mockResolvedValue(
                    new Response(new Blob(['x'.repeat(60 * 1024 * 1024)]))
                );

            manager.cacheAccessTimes.set('url1', Date.now() - 2000);
            manager.cacheAccessTimes.set('url2', Date.now() - 1000);
            manager.cachePriorities.set('url1', CachePriority.LOW);
            manager.cachePriorities.set('url2', CachePriority.LOW);

            await manager.performCleanup();

            // LRU 기반 삭제 확인
            expect(manager.stats.itemsDeleted).toBeGreaterThan(0);
        });

        test('메모리 압박 + 만료 캐시 혼합 시나리오', async () => {
            // 메모리 압박
            performance.memory.usedJSHeapSize = 85 * 1024 * 1024;

            const now = Date.now();
            const expiredTime = now - (8 * 24 * 60 * 60 * 1000);

            // 만료된 LOW 우선순위 캐시
            manager.cacheAccessTimes.set('expired-low', expiredTime);
            manager.cachePriorities.set('expired-low', CachePriority.LOW);

            // 유효한 LOW 우선순위 캐시
            manager.cacheAccessTimes.set('valid-low', now);
            manager.cachePriorities.set('valid-low', CachePriority.LOW);

            // HIGH 우선순위 캐시
            manager.cacheAccessTimes.set('high1', now);
            manager.cachePriorities.set('high1', CachePriority.HIGH);

            mockCache.match.mockResolvedValue(
                new Response(new Blob(['data']))
            );

            await manager.performCleanup();

            // 만료된 것과 LOW 우선순위는 삭제, HIGH는 유지
            expect(manager.cachePriorities.has('expired-low')).toBe(false);
            expect(manager.cachePriorities.has('valid-low')).toBe(false);
            expect(manager.cachePriorities.has('high1')).toBe(true);
        });
    });
});
