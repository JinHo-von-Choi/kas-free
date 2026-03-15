/**
 * IndexedDB 최적화 유틸리티
 * @author 최진호
 * @date 2026-02-26
 * @version 1.0.0
 * @remarks Batch 읽기/쓰기, 최적화된 삭제, 복합 쿼리
 */

/**
 * ========================================
 * DB Batch Optimizer
 * ========================================
 *
 * IndexedDB의 성능을 최적화합니다.
 *
 * 왜 필요한가요?
 * - 개별 get/put은 느림 (매번 트랜잭션 생성)
 * - 100개 게시글을 하나씩 조회하면 100번 트랜잭션
 * - Batch로 묶으면 1번 트랜잭션 (100배 빠름)
 *
 * 최적화 전략:
 * 1. Batch 읽기/쓰기 (여러 작업을 하나의 트랜잭션으로)
 * 2. 오래된 레코드 삭제 최적화 (커서 대신 getAllKeys)
 * 3. 복합 쿼리 지원 (여러 조건 동시 필터링)
 *
 * 실생활 비유:
 * "택배 배송:
 *  - 개별 배송: 집마다 한 번씩 방문 (느림)
 *  - Batch 배송: 한 번에 여러 집 방문 (빠름)
 *  - 트랜잭션 = 배송 차량"
 */
export class DBBatchOptimizer {
    /**
     * @param {IDBDatabase} db - IndexedDB 인스턴스
     */
    constructor(db) {
        this.db = db;

        /** Batch 작업 통계 */
        this.stats = {
            batchReads: 0,
            batchWrites: 0,
            batchDeletes: 0,
            totalTime: 0
        };
    }

    /**
     * ========================================
     * Batch 읽기 (여러 레코드를 한 번에 조회)
     * ========================================
     *
     * @param {string} storeName - 스토어 이름
     * @param {string[]} keys - 조회할 키 목록
     * @returns {Promise<Map<string, object>>} key → 레코드 Map
     */
    async batchGet(storeName, keys) {
        if (keys.length === 0) {
            return new Map();
        }

        const startTime = performance.now();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const results = new Map();
            let completed = 0;

            // 모든 키에 대해 get 요청
            for (const key of keys) {
                const request = store.get(key);

                request.onsuccess = () => {
                    if (request.result) {
                        results.set(key, request.result);
                    }

                    completed++;

                    // 모든 요청 완료
                    if (completed === keys.length) {
                        const elapsed = performance.now() - startTime;
                        this.stats.batchReads++;
                        this.stats.totalTime += elapsed;

                        console.log(
                            `[DBBatchOptimizer] Batch 읽기: ${keys.length}개, ` +
                            `${elapsed.toFixed(2)}ms (${(elapsed / keys.length).toFixed(2)}ms/개)`
                        );

                        resolve(results);
                    }
                };

                request.onerror = () => {
                    console.error('[DBBatchOptimizer] Batch 읽기 실패:', request.error);
                    reject(request.error);
                };
            }

            // 빈 배열이면 즉시 완료
            if (keys.length === 0) {
                resolve(results);
            }
        });
    }

    /**
     * ========================================
     * Batch 쓰기 (여러 레코드를 한 번에 저장)
     * ========================================
     *
     * @param {string} storeName - 스토어 이름
     * @param {Map<string, object>} records - key → 레코드 Map
     * @returns {Promise<number>} 저장된 레코드 수
     */
    async batchPut(storeName, records) {
        if (records.size === 0) {
            return 0;
        }

        const startTime = performance.now();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            let completed = 0;
            let successCount = 0;

            // 모든 레코드에 대해 put 요청
            for (const [key, record] of records.entries()) {
                const request = store.put(record);

                request.onsuccess = () => {
                    successCount++;
                    completed++;

                    // 모든 요청 완료
                    if (completed === records.size) {
                        const elapsed = performance.now() - startTime;
                        this.stats.batchWrites++;
                        this.stats.totalTime += elapsed;

                        console.log(
                            `[DBBatchOptimizer] Batch 쓰기: ${successCount}개, ` +
                            `${elapsed.toFixed(2)}ms (${(elapsed / records.size).toFixed(2)}ms/개)`
                        );

                        resolve(successCount);
                    }
                };

                request.onerror = () => {
                    console.error('[DBBatchOptimizer] Batch 쓰기 실패:', key, request.error);
                    completed++;

                    if (completed === records.size) {
                        resolve(successCount);
                    }
                };
            }
        });
    }

    /**
     * ========================================
     * Batch 삭제 (여러 레코드를 한 번에 삭제)
     * ========================================
     *
     * @param {string} storeName - 스토어 이름
     * @param {string[]} keys - 삭제할 키 목록
     * @returns {Promise<number>} 삭제된 레코드 수
     */
    async batchDelete(storeName, keys) {
        if (keys.length === 0) {
            return 0;
        }

        const startTime = performance.now();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            let completed = 0;
            let successCount = 0;

            // 모든 키에 대해 delete 요청
            for (const key of keys) {
                const request = store.delete(key);

                request.onsuccess = () => {
                    successCount++;
                    completed++;

                    // 모든 요청 완료
                    if (completed === keys.length) {
                        const elapsed = performance.now() - startTime;
                        this.stats.batchDeletes++;
                        this.stats.totalTime += elapsed;

                        console.log(
                            `[DBBatchOptimizer] Batch 삭제: ${successCount}개, ` +
                            `${elapsed.toFixed(2)}ms`
                        );

                        resolve(successCount);
                    }
                };

                request.onerror = () => {
                    console.error('[DBBatchOptimizer] Batch 삭제 실패:', key, request.error);
                    completed++;

                    if (completed === keys.length) {
                        resolve(successCount);
                    }
                };
            }
        });
    }

    /**
     * ========================================
     * 오래된 레코드 삭제 (최적화된 버전)
     * ========================================
     *
     * 기존 방식: 커서로 하나씩 순회하며 삭제 (느림)
     * 최적화: getAllKeys() → Batch 삭제 (빠름)
     *
     * @param {string} storeName - 스토어 이름
     * @param {string} timeIndexName - 시간 인덱스 이름
     * @param {number} cutoffTime - 기준 시간 (이전 것들 삭제)
     * @returns {Promise<number>} 삭제된 레코드 수
     */
    async deleteOldRecords(storeName, timeIndexName, cutoffTime) {
        const startTime = performance.now();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const index = store.index(timeIndexName);
            const range = IDBKeyRange.upperBound(cutoffTime);

            // 1단계: 삭제할 키 목록 가져오기
            const getAllKeysRequest = index.getAllKeys(range);

            getAllKeysRequest.onsuccess = async () => {
                const keysToDelete = getAllKeysRequest.result;

                if (keysToDelete.length === 0) {
                    console.log(`[DBBatchOptimizer] ${storeName}: 삭제할 레코드 없음`);
                    resolve(0);
                    return;
                }

                // 2단계: Batch 삭제
                try {
                    const deletedCount = await this.batchDelete(storeName, keysToDelete);

                    const elapsed = performance.now() - startTime;
                    console.log(
                        `[DBBatchOptimizer] ${storeName}: ${deletedCount}개 삭제, ` +
                        `${elapsed.toFixed(2)}ms`
                    );

                    resolve(deletedCount);
                } catch (error) {
                    reject(error);
                }
            };

            getAllKeysRequest.onerror = () => {
                console.error('[DBBatchOptimizer] getAllKeys 실패:', getAllKeysRequest.error);
                reject(getAllKeysRequest.error);
            };
        });
    }

    /**
     * ========================================
     * 용량 초과 시 오래된 레코드 삭제
     * ========================================
     *
     * 레코드 수가 maxCount를 초과하면 오래된 것부터 삭제합니다.
     *
     * @param {string} storeName - 스토어 이름
     * @param {string} timeIndexName - 시간 인덱스 이름
     * @param {number} maxCount - 최대 레코드 수
     * @returns {Promise<number>} 삭제된 레코드 수
     */
    async trimToMaxCount(storeName, timeIndexName, maxCount) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const index = store.index(timeIndexName);

            // 1단계: 총 레코드 수 확인
            const countRequest = store.count();

            countRequest.onsuccess = async () => {
                const totalCount = countRequest.result;

                if (totalCount <= maxCount) {
                    console.log(`[DBBatchOptimizer] ${storeName}: ${totalCount}개 (제한 내)`);
                    resolve(0);
                    return;
                }

                // 2단계: 오래된 것부터 정렬된 키 가져오기
                const getAllKeysRequest = index.getAllKeys();

                getAllKeysRequest.onsuccess = async () => {
                    const allKeys = getAllKeysRequest.result;
                    const deleteCount = totalCount - maxCount;
                    const keysToDelete = allKeys.slice(0, deleteCount);  // 오래된 것부터

                    console.log(
                        `[DBBatchOptimizer] ${storeName}: ${totalCount}개 → ${maxCount}개 ` +
                        `(${deleteCount}개 삭제)`
                    );

                    try {
                        const deleted = await this.batchDelete(storeName, keysToDelete);
                        resolve(deleted);
                    } catch (error) {
                        reject(error);
                    }
                };

                getAllKeysRequest.onerror = () => {
                    reject(getAllKeysRequest.error);
                };
            };

            countRequest.onerror = () => {
                reject(countRequest.error);
            };
        });
    }

    /**
     * ========================================
     * 복합 쿼리 (여러 조건으로 필터링)
     * ========================================
     *
     * @param {string} storeName - 스토어 이름
     * @param {object} filters - 필터 조건
     * @param {number} limit - 최대 결과 수
     * @returns {Promise<object[]>} 필터링된 레코드 목록
     */
    async queryWithFilters(storeName, filters = {}, limit = 100) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const results = [];

            // 커서로 전체 순회하며 필터링
            const request = store.openCursor();

            request.onsuccess = (event) => {
                const cursor = event.target.result;

                if (cursor && results.length < limit) {
                    const record = cursor.value;
                    let match = true;

                    // 필터 조건 확인
                    for (const [key, value] of Object.entries(filters)) {
                        if (record[key] !== value) {
                            match = false;
                            break;
                        }
                    }

                    if (match) {
                        results.push(record);
                    }

                    cursor.continue();
                } else {
                    resolve(results);
                }
            };

            request.onerror = () => {
                console.error('[DBBatchOptimizer] 복합 쿼리 실패:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * ========================================
     * 통계 조회
     * ========================================
     *
     * @returns {object} 통계 정보
     */
    getStats() {
        return {
            ...this.stats,
            avgTime: this.stats.batchReads + this.stats.batchWrites + this.stats.batchDeletes > 0
                ? (this.stats.totalTime / (this.stats.batchReads + this.stats.batchWrites + this.stats.batchDeletes)).toFixed(2) + 'ms'
                : '0ms'
        };
    }

    /**
     * ========================================
     * 통계 초기화
     * ========================================
     */
    resetStats() {
        this.stats = {
            batchReads: 0,
            batchWrites: 0,
            batchDeletes: 0,
            totalTime: 0
        };
    }
}

/**
 * ========================================
 * 유틸리티 함수
 * ========================================
 */

/**
 * 배열을 청크로 나누기
 * @param {Array} array - 원본 배열
 * @param {number} size - 청크 크기
 * @returns {Array[]} 청크 배열
 */
export function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

/**
 * Map을 청크로 나누기
 * @param {Map} map - 원본 Map
 * @param {number} size - 청크 크기
 * @returns {Map[]} 청크 Map 배열
 */
export function chunkMap(map, size) {
    const chunks = [];
    const entries = Array.from(map.entries());

    for (let i = 0; i < entries.length; i += size) {
        const chunk = new Map(entries.slice(i, i + size));
        chunks.push(chunk);
    }

    return chunks;
}
