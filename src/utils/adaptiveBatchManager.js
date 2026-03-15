/**
 * Adaptive Batch Manager (동적 배치 크기 조절)
 * @author 최진호
 * @date 2026-02-26
 * @version 1.0.0
 * @remarks 네트워크 상태와 시스템 부하에 따라 배치 크기 자동 조절
 */

/**
 * ========================================
 * Adaptive Batch Manager 클래스
 * ========================================
 *
 * 네트워크 상태와 시스템 부하를 모니터링하여 최적의 배치 크기를 결정합니다.
 *
 * 왜 필요한가요?
 * - 네트워크가 빠를 때: 큰 배치로 효율 극대화
 * - 네트워크가 느릴 때: 작은 배치로 타임아웃 방지
 * - 메모리 부족: 배치 크기 줄여서 메모리 절약
 * - 동적 조정: 성공/실패 피드백으로 실시간 최적화
 *
 * 배치 크기 전략:
 * - 4G + 고속 네트워크: 50개
 * - 3G 또는 중속 네트워크: 30개
 * - 2G 또는 저속 네트워크: 10개
 * - 데이터 절약 모드: 5개
 * - 연속 성공: 점진적 증가 (최대 100개)
 * - 연속 실패: 급격한 감소 (최소 5개)
 *
 * 실생활 비유:
 * "고속도로 운전:
 *  - 도로 상태 좋음 → 속도 올림 (큰 배치)
 *  - 도로 상태 나쁨 → 속도 낮춤 (작은 배치)
 *  - 사고 발생 → 즉시 감속 (배치 크기 감소)"
 */
export class AdaptiveBatchManager {
    /**
     * @param {object} options - 옵션
     */
    constructor(options = {}) {
        /** 최소 배치 크기 */
        this.minBatchSize = options.minBatchSize || 5;

        /** 최대 배치 크기 */
        this.maxBatchSize = options.maxBatchSize || 100;

        /** 기본 배치 크기 */
        this.defaultBatchSize = options.defaultBatchSize || 30;

        /** 현재 배치 크기 */
        this.currentBatchSize = this.defaultBatchSize;

        /** 네트워크 상태 */
        this.networkInfo = null;

        /** 성능 통계 */
        this.stats = {
            totalBatches: 0,
            successfulBatches: 0,
            failedBatches: 0,
            consecutiveSuccesses: 0,
            consecutiveFailures: 0,
            adjustmentCount: 0,
            totalItemsProcessed: 0
        };

        /** 메모리 압박 감지 */
        this.isMemoryPressure = false;

        this.init();
    }

    /**
     * ========================================
     * 초기화
     * ========================================
     */
    init() {
        // Network Information API 지원 확인
        if ('connection' in navigator || 'mozConnection' in navigator || 'webkitConnection' in navigator) {
            this.connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

            // 네트워크 상태 변경 리스너
            this.connection.addEventListener('change', () => {
                this.updateNetworkInfo();
                this.adjustBatchSize();
            });

            this.updateNetworkInfo();
        } else {
            console.warn('[AdaptiveBatchManager] Network Information API 미지원');
        }

        // 메모리 압박 감지 (Memory Pressure API)
        if ('memory' in performance) {
            // Chrome 89+에서 지원 (실험적 기능)
            setInterval(() => {
                this.checkMemoryPressure();
            }, 5000);  // 5초마다 체크
        }

        console.log('[AdaptiveBatchManager] 초기화 완료:', {
            defaultBatchSize: this.defaultBatchSize,
            range: `${this.minBatchSize}-${this.maxBatchSize}`
        });
    }

    /**
     * ========================================
     * 네트워크 상태 업데이트
     * ========================================
     */
    updateNetworkInfo() {
        if (!this.connection) return;

        this.networkInfo = {
            effectiveType: this.connection.effectiveType,  // '4g', '3g', '2g', 'slow-2g'
            downlink: this.connection.downlink,            // Mbps
            rtt: this.connection.rtt,                      // ms (Round Trip Time)
            saveData: this.connection.saveData             // 데이터 절약 모드
        };

        console.log('[AdaptiveBatchManager] 네트워크 상태:', this.networkInfo);
    }

    /**
     * ========================================
     * 배치 크기 계산
     * ========================================
     *
     * 네트워크 상태와 시스템 부하를 고려하여 최적의 배치 크기를 계산합니다.
     *
     * @returns {number} 배치 크기
     */
    calculateBatchSize() {
        let batchSize = this.defaultBatchSize;

        // ========================================
        // 1. 네트워크 상태 기반 배치 크기
        // ========================================
        if (this.networkInfo) {
            const { effectiveType, downlink, saveData } = this.networkInfo;

            // 데이터 절약 모드: 최소 배치
            if (saveData) {
                batchSize = this.minBatchSize;
            }
            // 4G + 고속 네트워크
            else if (effectiveType === '4g' && downlink >= 5) {
                batchSize = 50;
            }
            // 3G 또는 중속 네트워크
            else if (effectiveType === '3g' || (downlink >= 2 && downlink < 5)) {
                batchSize = 30;
            }
            // 2G 또는 저속 네트워크
            else if (effectiveType === '2g' || effectiveType === 'slow-2g' || downlink < 2) {
                batchSize = 10;
            }
        }

        // ========================================
        // 2. 메모리 압박 감지 시 배치 크기 감소
        // ========================================
        if (this.isMemoryPressure) {
            batchSize = Math.max(this.minBatchSize, Math.floor(batchSize * 0.5));
            console.warn('[AdaptiveBatchManager] 메모리 압박 감지: 배치 크기 50% 감소');
        }

        // ========================================
        // 3. 범위 제한
        // ========================================
        batchSize = Math.max(this.minBatchSize, Math.min(this.maxBatchSize, batchSize));

        return batchSize;
    }

    /**
     * ========================================
     * 배치 크기 조절
     * ========================================
     *
     * 네트워크 상태 변경 또는 성능 피드백에 따라 배치 크기를 조절합니다.
     */
    adjustBatchSize() {
        const oldBatchSize = this.currentBatchSize;
        this.currentBatchSize = this.calculateBatchSize();

        if (oldBatchSize !== this.currentBatchSize) {
            this.stats.adjustmentCount++;
            console.log(
                `[AdaptiveBatchManager] 배치 크기 조절: ${oldBatchSize} → ${this.currentBatchSize}`
            );
        }
    }

    /**
     * ========================================
     * 배치 크기 가져오기
     * ========================================
     *
     * @returns {number} 현재 배치 크기
     */
    getBatchSize() {
        return this.currentBatchSize;
    }

    /**
     * ========================================
     * 배치 처리 성공 피드백
     * ========================================
     *
     * 배치 처리가 성공했을 때 호출하여 배치 크기를 동적으로 증가시킵니다.
     *
     * @param {number} itemCount - 처리된 항목 수
     */
    recordSuccess(itemCount) {
        this.stats.totalBatches++;
        this.stats.successfulBatches++;
        this.stats.consecutiveSuccesses++;
        this.stats.consecutiveFailures = 0;  // 실패 카운터 리셋
        this.stats.totalItemsProcessed += itemCount;

        // ========================================
        // 연속 성공 시 배치 크기 점진적 증가
        // ========================================
        if (this.stats.consecutiveSuccesses >= 3 && this.currentBatchSize < this.maxBatchSize) {
            const newBatchSize = Math.min(
                this.maxBatchSize,
                Math.floor(this.currentBatchSize * 1.1)  // 10% 증가
            );

            if (newBatchSize !== this.currentBatchSize) {
                console.log(
                    `[AdaptiveBatchManager] 연속 성공 (${this.stats.consecutiveSuccesses}회): ` +
                    `배치 크기 증가 ${this.currentBatchSize} → ${newBatchSize}`
                );
                this.currentBatchSize = newBatchSize;
                this.stats.adjustmentCount++;
                this.stats.consecutiveSuccesses = 0;  // 카운터 리셋
            }
        }
    }

    /**
     * ========================================
     * 배치 처리 실패 피드백
     * ========================================
     *
     * 배치 처리가 실패했을 때 호출하여 배치 크기를 급격히 감소시킵니다.
     *
     * @param {Error} error - 에러 객체
     */
    recordFailure(error) {
        this.stats.totalBatches++;
        this.stats.failedBatches++;
        this.stats.consecutiveFailures++;
        this.stats.consecutiveSuccesses = 0;  // 성공 카운터 리셋

        console.warn('[AdaptiveBatchManager] 배치 처리 실패:', error);

        // ========================================
        // 연속 실패 시 배치 크기 급격히 감소
        // ========================================
        if (this.stats.consecutiveFailures >= 2 && this.currentBatchSize > this.minBatchSize) {
            const newBatchSize = Math.max(
                this.minBatchSize,
                Math.floor(this.currentBatchSize * 0.5)  // 50% 감소
            );

            console.warn(
                `[AdaptiveBatchManager] 연속 실패 (${this.stats.consecutiveFailures}회): ` +
                `배치 크기 감소 ${this.currentBatchSize} → ${newBatchSize}`
            );
            this.currentBatchSize = newBatchSize;
            this.stats.adjustmentCount++;
            this.stats.consecutiveFailures = 0;  // 카운터 리셋
        }
    }

    /**
     * ========================================
     * 메모리 압박 감지
     * ========================================
     *
     * 메모리 사용량을 모니터링하여 압박 상태를 감지합니다.
     */
    checkMemoryPressure() {
        if (!('memory' in performance)) return;

        const memory = performance.memory;
        const usageRatio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;

        // 메모리 사용률 90% 이상이면 압박 상태
        const wasMemoryPressure = this.isMemoryPressure;
        this.isMemoryPressure = usageRatio > 0.9;

        if (this.isMemoryPressure && !wasMemoryPressure) {
            console.warn('[AdaptiveBatchManager] 메모리 압박 감지:', {
                usageRatio: (usageRatio * 100).toFixed(2) + '%',
                used: (memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + 'MB',
                limit: (memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2) + 'MB'
            });

            // 배치 크기 즉시 감소
            this.adjustBatchSize();
        } else if (!this.isMemoryPressure && wasMemoryPressure) {
            console.log('[AdaptiveBatchManager] 메모리 압박 해소');
            this.adjustBatchSize();
        }
    }

    /**
     * ========================================
     * 배치 분할 (헬퍼 메서드)
     * ========================================
     *
     * 배열을 현재 배치 크기로 분할합니다.
     *
     * @param {Array} items - 분할할 배열
     * @returns {Array[]} 배치 배열
     */
    splitIntoBatches(items) {
        const batchSize = this.getBatchSize();
        const batches = [];

        for (let i = 0; i < items.length; i += batchSize) {
            batches.push(items.slice(i, i + batchSize));
        }

        console.log(
            `[AdaptiveBatchManager] ${items.length}개 → ${batches.length}개 배치 ` +
            `(배치당 ${batchSize}개)`
        );

        return batches;
    }

    /**
     * ========================================
     * 배치 처리 (통합 메서드)
     * ========================================
     *
     * 배열을 배치로 나누고 각 배치를 순차적으로 처리합니다.
     * 성공/실패 피드백을 자동으로 기록합니다.
     *
     * @param {Array} items - 처리할 항목 배열
     * @param {Function} processFn - 배치 처리 함수 (배치 배열을 받아 Promise 반환)
     * @returns {Promise<object>} 처리 결과 { successful, failed, errors }
     */
    async processBatches(items, processFn) {
        const batches = this.splitIntoBatches(items);
        const results = {
            successful: 0,
            failed: 0,
            errors: []
        };

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            console.log(`[AdaptiveBatchManager] 배치 ${i + 1}/${batches.length} 처리 중...`);

            try {
                await processFn(batch);
                this.recordSuccess(batch.length);
                results.successful += batch.length;
            } catch (error) {
                this.recordFailure(error);
                results.failed += batch.length;
                results.errors.push({
                    batchIndex: i,
                    error: error.message
                });

                console.error(`[AdaptiveBatchManager] 배치 ${i + 1} 실패:`, error);
            }
        }

        console.log('[AdaptiveBatchManager] 배치 처리 완료:', results);
        return results;
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
            currentBatchSize: this.currentBatchSize,
            networkInfo: this.networkInfo,
            isMemoryPressure: this.isMemoryPressure,
            successRate: this.stats.totalBatches > 0
                ? ((this.stats.successfulBatches / this.stats.totalBatches) * 100).toFixed(2) + '%'
                : '0%',
            avgItemsPerBatch: this.stats.successfulBatches > 0
                ? (this.stats.totalItemsProcessed / this.stats.successfulBatches).toFixed(2)
                : '0'
        };
    }

    /**
     * ========================================
     * 통계 초기화
     * ========================================
     */
    resetStats() {
        this.stats = {
            totalBatches: 0,
            successfulBatches: 0,
            failedBatches: 0,
            consecutiveSuccesses: 0,
            consecutiveFailures: 0,
            adjustmentCount: 0,
            totalItemsProcessed: 0
        };
    }

    /**
     * ========================================
     * 정리 (메모리 누수 방지)
     * ========================================
     */
    destroy() {
        if (this.connection) {
            // 이벤트 리스너 제거는 브라우저가 자동으로 처리
            this.connection = null;
        }

        this.resetStats();
        console.log('[AdaptiveBatchManager] 정리 완료');
    }
}

/**
 * ========================================
 * 싱글톤 인스턴스
 * ========================================
 */
let instance = null;

/**
 * 싱글톤 인스턴스 가져오기
 * @returns {AdaptiveBatchManager}
 */
export function getAdaptiveBatchManager() {
    if (!instance) {
        instance = new AdaptiveBatchManager();
    }
    return instance;
}

/**
 * 싱글톤 인스턴스 초기화
 */
export function resetAdaptiveBatchManager() {
    if (instance) {
        instance.destroy();
    }
    instance = null;
}
