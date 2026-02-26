/**
 * Service Worker Memory Manager (메모리 관리)
 * @author 최진호
 * @date 2026-02-26
 * @version 1.0.0
 * @remarks Service Worker의 메모리 사용량 모니터링 및 자동 정리
 */

/**
 * ========================================
 * Cache Priority (캐시 우선순위)
 * ========================================
 */
export const CachePriority = {
    HIGH: 1,    // 항상 유지 (이미지 메타데이터, 설정 등)
    MEDIUM: 2,  // 자주 재사용 (분석 결과)
    LOW: 3      // 일회성 (게시글 내용)
};

/**
 * ========================================
 * Memory Manager 클래스
 * ========================================
 *
 * Service Worker의 메모리와 캐시를 관리합니다.
 *
 * 왜 필요한가요?
 * - Service Worker는 브라우저 백그라운드에서 실행
 * - 메모리 누수 발생 시 브라우저 성능 저하
 * - 캐시가 무한정 증가하면 디스크 공간 낭비
 * - 자동 정리로 최적 상태 유지
 *
 * 정리 전략:
 * - 메모리 사용률 80% 이상: LOW 우선순위 캐시 삭제
 * - 메모리 사용률 90% 이상: MEDIUM 우선순위 캐시 삭제
 * - 7일 이상 미사용 캐시: 자동 삭제
 * - 캐시 총 크기 100MB 초과: 오래된 것부터 삭제
 *
 * 실생활 비유:
 * "집 정리:
 *  - 자주 쓰는 물건: 서랍에 보관 (HIGH)
 *  - 가끔 쓰는 물건: 창고에 보관 (MEDIUM)
 *  - 안 쓰는 물건: 버림 (LOW)
 *  - 공간 부족하면 창고부터 정리"
 */
export class MemoryManager {
    /**
     * @param {object} options - 옵션
     */
    constructor(options = {}) {
        /** 최대 캐시 크기 (바이트) */
        this.maxCacheSize = options.maxCacheSize || 100 * 1024 * 1024;  // 100MB

        /** 캐시 만료 시간 (밀리초) */
        this.cacheExpiry = options.cacheExpiry || 7 * 24 * 60 * 60 * 1000;  // 7일

        /** 메모리 압박 임계값 */
        this.memoryThresholds = {
            low: 0.8,     // 80% 이상: LOW 우선순위 정리
            medium: 0.9   // 90% 이상: MEDIUM 우선순위 정리
        };

        /** 캐시 우선순위 맵 (URL → Priority) */
        this.cachePriorities = new Map();

        /** 캐시 사용 시간 맵 (URL → timestamp) */
        this.cacheAccessTimes = new Map();

        /** 통계 */
        this.stats = {
            totalCleanups: 0,
            itemsDeleted: 0,
            bytesFreed: 0,
            lastCleanupTime: null
        };

        /** 자동 정리 인터벌 (밀리초) */
        this.cleanupInterval = options.cleanupInterval || 10 * 60 * 1000;  // 10분

        /** 인터벌 ID */
        this.intervalId = null;
    }

    /**
     * ========================================
     * 초기화
     * ========================================
     */
    async init() {
        // 기존 캐시 메타데이터 복원
        await this.restoreMetadata();

        // 자동 정리 시작
        this.startAutoCleanup();

        console.log('[MemoryManager] 초기화 완료:', {
            maxCacheSize: (this.maxCacheSize / 1024 / 1024).toFixed(2) + 'MB',
            cacheExpiry: (this.cacheExpiry / 1000 / 60 / 60 / 24).toFixed(0) + '일',
            cleanupInterval: (this.cleanupInterval / 1000 / 60).toFixed(0) + '분'
        });
    }

    /**
     * ========================================
     * 메타데이터 복원
     * ========================================
     *
     * 이전에 저장한 캐시 메타데이터를 IndexedDB에서 복원합니다.
     */
    async restoreMetadata() {
        try {
            const cache = await caches.open('kas-metadata');
            const metadataResponse = await cache.match('cache-metadata');

            if (metadataResponse) {
                const metadata = await metadataResponse.json();

                // 우선순위 복원
                if (metadata.priorities) {
                    this.cachePriorities = new Map(Object.entries(metadata.priorities));
                }

                // 접근 시간 복원
                if (metadata.accessTimes) {
                    this.cacheAccessTimes = new Map(Object.entries(metadata.accessTimes));
                }

                console.log('[MemoryManager] 메타데이터 복원:', {
                    priorities: this.cachePriorities.size,
                    accessTimes: this.cacheAccessTimes.size
                });
            }
        } catch (error) {
            console.warn('[MemoryManager] 메타데이터 복원 실패:', error);
        }
    }

    /**
     * ========================================
     * 메타데이터 저장
     * ========================================
     */
    async saveMetadata() {
        try {
            const metadata = {
                priorities: Object.fromEntries(this.cachePriorities),
                accessTimes: Object.fromEntries(this.cacheAccessTimes)
            };

            const cache = await caches.open('kas-metadata');
            await cache.put(
                'cache-metadata',
                new Response(JSON.stringify(metadata), {
                    headers: { 'Content-Type': 'application/json' }
                })
            );
        } catch (error) {
            console.error('[MemoryManager] 메타데이터 저장 실패:', error);
        }
    }

    /**
     * ========================================
     * 캐시 등록 (우선순위 설정)
     * ========================================
     *
     * @param {string} url - 캐시 URL
     * @param {number} priority - 우선순위 (CachePriority)
     */
    registerCache(url, priority) {
        this.cachePriorities.set(url, priority);
        this.cacheAccessTimes.set(url, Date.now());
    }

    /**
     * ========================================
     * 캐시 접근 기록
     * ========================================
     *
     * 캐시를 사용할 때마다 호출하여 LRU 정보를 업데이트합니다.
     *
     * @param {string} url - 캐시 URL
     */
    recordCacheAccess(url) {
        this.cacheAccessTimes.set(url, Date.now());
    }

    /**
     * ========================================
     * 자동 정리 시작
     * ========================================
     */
    startAutoCleanup() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }

        this.intervalId = setInterval(() => {
            this.performCleanup();
        }, this.cleanupInterval);

        console.log('[MemoryManager] 자동 정리 시작');
    }

    /**
     * ========================================
     * 자동 정리 중지
     * ========================================
     */
    stopAutoCleanup() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('[MemoryManager] 자동 정리 중지');
        }
    }

    /**
     * ========================================
     * 메모리 사용률 확인
     * ========================================
     *
     * @returns {number} 메모리 사용률 (0-1)
     */
    getMemoryUsage() {
        if ('memory' in performance) {
            const memory = performance.memory;
            return memory.usedJSHeapSize / memory.jsHeapSizeLimit;
        }
        return 0;  // API 미지원 시
    }

    /**
     * ========================================
     * 캐시 총 크기 계산
     * ========================================
     *
     * @returns {Promise<number>} 총 캐시 크기 (바이트)
     */
    async getTotalCacheSize() {
        let totalSize = 0;

        try {
            const cacheNames = await caches.keys();

            for (const cacheName of cacheNames) {
                const cache = await caches.open(cacheName);
                const keys = await cache.keys();

                for (const request of keys) {
                    const response = await cache.match(request);
                    if (response) {
                        const blob = await response.blob();
                        totalSize += blob.size;
                    }
                }
            }
        } catch (error) {
            console.error('[MemoryManager] 캐시 크기 계산 실패:', error);
        }

        return totalSize;
    }

    /**
     * ========================================
     * 정리 수행
     * ========================================
     *
     * 메모리 사용률과 캐시 크기를 확인하여 필요 시 정리합니다.
     */
    async performCleanup() {
        console.log('[MemoryManager] 정리 시작');

        const memoryUsage = this.getMemoryUsage();
        const totalCacheSize = await this.getTotalCacheSize();

        let deletedCount = 0;
        let freedBytes = 0;

        // ========================================
        // 1. 만료된 캐시 삭제
        // ========================================
        const expiredCount = await this.deleteExpiredCaches();
        deletedCount += expiredCount.count;
        freedBytes += expiredCount.bytes;

        // ========================================
        // 2. 메모리 압박 시 우선순위 기반 정리
        // ========================================
        if (memoryUsage >= this.memoryThresholds.medium) {
            console.warn('[MemoryManager] 메모리 압박 (90% 이상): MEDIUM 우선순위 정리');
            const mediumCount = await this.deleteCachesByPriority(CachePriority.MEDIUM);
            deletedCount += mediumCount.count;
            freedBytes += mediumCount.bytes;
        }

        if (memoryUsage >= this.memoryThresholds.low) {
            console.warn('[MemoryManager] 메모리 압박 (80% 이상): LOW 우선순위 정리');
            const lowCount = await this.deleteCachesByPriority(CachePriority.LOW);
            deletedCount += lowCount.count;
            freedBytes += lowCount.bytes;
        }

        // ========================================
        // 3. 캐시 크기 초과 시 LRU 기반 정리
        // ========================================
        if (totalCacheSize > this.maxCacheSize) {
            console.warn(
                `[MemoryManager] 캐시 크기 초과: ${(totalCacheSize / 1024 / 1024).toFixed(2)}MB ` +
                `/ ${(this.maxCacheSize / 1024 / 1024).toFixed(2)}MB`
            );
            const lruCount = await this.deleteLRUCaches(totalCacheSize - this.maxCacheSize);
            deletedCount += lruCount.count;
            freedBytes += lruCount.bytes;
        }

        // ========================================
        // 4. 통계 업데이트
        // ========================================
        this.stats.totalCleanups++;
        this.stats.itemsDeleted += deletedCount;
        this.stats.bytesFreed += freedBytes;
        this.stats.lastCleanupTime = Date.now();

        console.log('[MemoryManager] 정리 완료:', {
            deletedCount: deletedCount,
            freedBytes: (freedBytes / 1024 / 1024).toFixed(2) + 'MB',
            memoryUsage: (memoryUsage * 100).toFixed(2) + '%',
            totalCacheSize: (totalCacheSize / 1024 / 1024).toFixed(2) + 'MB'
        });

        // 메타데이터 저장
        await this.saveMetadata();
    }

    /**
     * ========================================
     * 만료된 캐시 삭제
     * ========================================
     *
     * @returns {Promise<object>} { count, bytes }
     */
    async deleteExpiredCaches() {
        const now = Date.now();
        let deletedCount = 0;
        let freedBytes = 0;

        const expiredUrls = [];

        // 만료된 URL 찾기
        for (const [url, accessTime] of this.cacheAccessTimes.entries()) {
            if (now - accessTime > this.cacheExpiry) {
                expiredUrls.push(url);
            }
        }

        // 삭제
        const cacheNames = await caches.keys();
        for (const cacheName of cacheNames) {
            const cache = await caches.open(cacheName);

            for (const url of expiredUrls) {
                const response = await cache.match(url);
                if (response) {
                    const blob = await response.blob();
                    freedBytes += blob.size;

                    await cache.delete(url);
                    deletedCount++;

                    // 메타데이터 제거
                    this.cachePriorities.delete(url);
                    this.cacheAccessTimes.delete(url);
                }
            }
        }

        if (deletedCount > 0) {
            console.log(
                `[MemoryManager] 만료된 캐시 삭제: ${deletedCount}개, ` +
                `${(freedBytes / 1024 / 1024).toFixed(2)}MB`
            );
        }

        return { count: deletedCount, bytes: freedBytes };
    }

    /**
     * ========================================
     * 우선순위 기반 캐시 삭제
     * ========================================
     *
     * @param {number} priority - 삭제할 우선순위
     * @returns {Promise<object>} { count, bytes }
     */
    async deleteCachesByPriority(priority) {
        let deletedCount = 0;
        let freedBytes = 0;

        const urlsToDelete = [];

        // 해당 우선순위 URL 찾기
        for (const [url, cachePriority] of this.cachePriorities.entries()) {
            if (cachePriority === priority) {
                urlsToDelete.push(url);
            }
        }

        // 삭제
        const cacheNames = await caches.keys();
        for (const cacheName of cacheNames) {
            const cache = await caches.open(cacheName);

            for (const url of urlsToDelete) {
                const response = await cache.match(url);
                if (response) {
                    const blob = await response.blob();
                    freedBytes += blob.size;

                    await cache.delete(url);
                    deletedCount++;

                    // 메타데이터 제거
                    this.cachePriorities.delete(url);
                    this.cacheAccessTimes.delete(url);
                }
            }
        }

        if (deletedCount > 0) {
            console.log(
                `[MemoryManager] 우선순위 ${priority} 캐시 삭제: ${deletedCount}개, ` +
                `${(freedBytes / 1024 / 1024).toFixed(2)}MB`
            );
        }

        return { count: deletedCount, bytes: freedBytes };
    }

    /**
     * ========================================
     * LRU 기반 캐시 삭제
     * ========================================
     *
     * 오래 사용하지 않은 캐시부터 삭제합니다.
     *
     * @param {number} targetBytes - 삭제 목표 크기 (바이트)
     * @returns {Promise<object>} { count, bytes }
     */
    async deleteLRUCaches(targetBytes) {
        let deletedCount = 0;
        let freedBytes = 0;

        // 접근 시간 기준으로 정렬 (오래된 것부터)
        const sortedUrls = Array.from(this.cacheAccessTimes.entries())
            .sort((a, b) => a[1] - b[1])
            .map(([url]) => url);

        const cacheNames = await caches.keys();

        for (const url of sortedUrls) {
            if (freedBytes >= targetBytes) break;

            // HIGH 우선순위는 건너뛰기
            if (this.cachePriorities.get(url) === CachePriority.HIGH) {
                continue;
            }

            for (const cacheName of cacheNames) {
                const cache = await caches.open(cacheName);
                const response = await cache.match(url);

                if (response) {
                    const blob = await response.blob();
                    freedBytes += blob.size;

                    await cache.delete(url);
                    deletedCount++;

                    // 메타데이터 제거
                    this.cachePriorities.delete(url);
                    this.cacheAccessTimes.delete(url);

                    break;  // 다음 URL로
                }
            }
        }

        if (deletedCount > 0) {
            console.log(
                `[MemoryManager] LRU 캐시 삭제: ${deletedCount}개, ` +
                `${(freedBytes / 1024 / 1024).toFixed(2)}MB`
            );
        }

        return { count: deletedCount, bytes: freedBytes };
    }

    /**
     * ========================================
     * 통계 조회
     * ========================================
     *
     * @returns {Promise<object>} 통계 정보
     */
    async getStats() {
        const totalCacheSize = await this.getTotalCacheSize();
        const memoryUsage = this.getMemoryUsage();

        return {
            ...this.stats,
            totalCacheSize: (totalCacheSize / 1024 / 1024).toFixed(2) + 'MB',
            memoryUsage: (memoryUsage * 100).toFixed(2) + '%',
            registeredCaches: this.cachePriorities.size,
            highPriorityCaches: Array.from(this.cachePriorities.values())
                .filter(p => p === CachePriority.HIGH).length,
            mediumPriorityCaches: Array.from(this.cachePriorities.values())
                .filter(p => p === CachePriority.MEDIUM).length,
            lowPriorityCaches: Array.from(this.cachePriorities.values())
                .filter(p => p === CachePriority.LOW).length
        };
    }

    /**
     * ========================================
     * 통계 초기화
     * ========================================
     */
    resetStats() {
        this.stats = {
            totalCleanups: 0,
            itemsDeleted: 0,
            bytesFreed: 0,
            lastCleanupTime: null
        };
    }

    /**
     * ========================================
     * 정리 (메모리 누수 방지)
     * ========================================
     */
    destroy() {
        this.stopAutoCleanup();
        this.cachePriorities.clear();
        this.cacheAccessTimes.clear();
        this.resetStats();
        console.log('[MemoryManager] 정리 완료');
    }
}
