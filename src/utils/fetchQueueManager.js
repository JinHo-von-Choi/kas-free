/**
 * Fetch Queue Manager (요청 속도 제한)
 * @author 최진호
 * @date 2026-02-27
 * @version 1.0.0
 * @remarks 디시인사이드 차단 방지를 위한 Fetch 요청 Queue
 */

/**
 * ========================================
 * Fetch Queue Manager 클래스
 * ========================================
 *
 * 왜 필요한가?
 * - 디시인사이드는 짧은 시간 내 너무 많은 요청 시 차단
 * - 동시에 10~50개 fetch 요청 → 차단
 * - 순차 처리 + 딜레이로 차단 방지
 *
 * 전략:
 * - 초당 3개 제한 (333ms 간격)
 * - Queue 구조로 순차 처리
 * - 캐시 히트는 영향 없음 (fetch 안 함)
 *
 * 실생활 비유:
 * "은행 창구:
 *  - 모든 사람이 동시에 가면 혼잡 (차단)
 *  - 번호표 받아서 순서대로 처리 (Queue)"
 */
export class FetchQueueManager {
    /**
     * @param {object} options - 옵션
     * @param {number} options.requestsPerSecond - 초당 요청 수 (기본: 3)
     * @param {number} options.maxQueueSize - 최대 Queue 크기 (기본: 100)
     */
    constructor(options = {}) {
        this.requestsPerSecond = options.requestsPerSecond || 3;
        this.maxQueueSize = options.maxQueueSize || 100;

        // 요청 간 딜레이 계산 (ms)
        this.delayMs = Math.floor(1000 / this.requestsPerSecond);

        // Queue 구조
        this.queue = [];
        this.processing = false;

        // 통계
        this.stats = {
            totalRequests:    0,
            completedRequests: 0,
            failedRequests:   0,
            currentQueueSize: 0,
            avgWaitTime:      0,
            totalWaitTime:    0
        };

        /** backoff 상태 */
        this.paused             = false;
        this.pauseUntil         = 0;
        this.consecutiveFails   = 0;
        this.consecutiveSuccess = 0;
        this.baseDelayMs        = this.delayMs;
        this.baseRPS            = this.requestsPerSecond;

        console.log(`[FetchQueueManager] 초기화: 초당 ${this.requestsPerSecond}개 (${this.delayMs}ms 간격)`);
    }

    /**
     * ========================================
     * Fetch 요청을 Queue에 추가
     * ========================================
     *
     * @param {Function} fetchFn - Fetch 함수 (Promise 반환)
     * @param {object} metadata - 메타데이터 (디버깅용)
     * @returns {Promise<any>} Fetch 결과
     */
    async enqueue(fetchFn, metadata = {}) {
        // Queue 크기 제한 확인
        if (this.queue.length >= this.maxQueueSize) {
            throw new Error(`Queue 크기 초과 (${this.maxQueueSize})`);
        }

        this.stats.totalRequests++;
        this.stats.currentQueueSize = this.queue.length + 1;

        const enqueuedAt = Date.now();

        return new Promise((resolve, reject) => {
            this.queue.push({
                fetchFn,
                metadata,
                enqueuedAt,
                resolve,
                reject
            });

            // 처리 시작 (이미 처리 중이면 무시)
            this.processQueue();
        });
    }

    /**
     * ========================================
     * Queue 처리 (순차 실행)
     * ========================================
     */
    async processQueue() {
        // 이미 처리 중이거나 Queue가 비었으면 무시
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;

        while (this.queue.length > 0) {
            const item = this.queue.shift();

            /** 일시 정지 상태 대기 (429 수신 시) */
            if (this.paused && Date.now() < this.pauseUntil) {
                await new Promise(r => setTimeout(r, this.pauseUntil - Date.now()));
                this.paused = false;
            }

            this.stats.currentQueueSize = this.queue.length;

            const startTime = Date.now();
            const waitTime = startTime - item.enqueuedAt;

            this.stats.totalWaitTime += waitTime;
            this.stats.avgWaitTime = Math.floor(
                this.stats.totalWaitTime / this.stats.totalRequests
            );

            try {
                console.log(
                    `[FetchQueueManager] 처리 시작: ${item.metadata.postNo || 'unknown'} ` +
                    `(대기: ${waitTime}ms, Queue: ${this.queue.length})`
                );

                // 실제 Fetch 실행
                const result = await item.fetchFn();

                const elapsed = Date.now() - startTime;
                console.log(
                    `[FetchQueueManager] 완료: ${item.metadata.postNo || 'unknown'} ` +
                    `(소요: ${elapsed}ms)`
                );

                this.consecutiveSuccess++;
                this.consecutiveFails   = 0;

                /** 10회 연속 성공 시 원래 속도 복구 */
                if (this.consecutiveSuccess >= 10 && this.delayMs > this.baseDelayMs) {
                    this._restoreSpeed();
                }

                this.stats.completedRequests++;
                item.resolve(result);

            } catch (error) {
                console.error(
                    `[FetchQueueManager] 실패: ${item.metadata.postNo || 'unknown'}`,
                    error.message
                );

                this.consecutiveFails++;
                this.consecutiveSuccess = 0;

                /** 3회 연속 실패 시 속도 절반으로 */
                if (this.consecutiveFails >= 3) {
                    this._halveSpeed();
                    this.consecutiveFails = 0;
                }

                this.stats.failedRequests++;
                item.reject(error);
            }

            // 다음 요청 전 딜레이 (큐 체증에 따라 동적 조정)
            if (this.queue.length > 0) {
                await new Promise(resolve => setTimeout(resolve, this._computeEffectiveDelay()));
            }
        }

        this.processing = false;
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
            requestsPerSecond: this.requestsPerSecond,
            delayMs:           this.delayMs,
            effectiveDelayMs:  this._computeEffectiveDelay(),
            paused:            this.paused,
            pauseUntil:        this.pauseUntil,
            consecutiveFails:  this.consecutiveFails,
            successRate: this.stats.totalRequests > 0
                ? ((this.stats.completedRequests / this.stats.totalRequests) * 100).toFixed(2) + '%'
                : '0%'
        };
    }

    /**
     * 외부에서 큐를 일시 정지한다 (429 수신 시 호출)
     * @param {number} waitMs - 정지 시간 (ms)
     */
    triggerPause(waitMs) {
        this.paused     = true;
        this.pauseUntil = Date.now() + waitMs;
        console.warn(`[FetchQueueManager] 일시 정지: ${waitMs}ms`);
    }

    /**
     * 속도를 절반으로 줄인다 (최소 2000ms = 0.5/s)
     */
    _halveSpeed() {
        const newDelay         = Math.min(this.delayMs * 2, 2000);
        console.warn(`[FetchQueueManager] 속도 절감: ${this.delayMs}ms → ${newDelay}ms`);
        this.delayMs           = newDelay;
        this.requestsPerSecond = Math.max(1000 / newDelay, 0.5);
    }

    /**
     * 원래 속도로 복구한다
     */
    _restoreSpeed() {
        console.log(`[FetchQueueManager] 속도 복구: ${this.delayMs}ms → ${this.baseDelayMs}ms`);
        this.delayMs            = this.baseDelayMs;
        this.requestsPerSecond  = this.baseRPS;
        this.consecutiveSuccess = 0;
    }

    /**
     * 요청 간 딜레이를 반환한다
     *
     * 왜 큐 크기 기반 증가를 제거했는가?
     * - 큐가 클수록 딜레이를 늘리면 대기 총시간이 기하급수적으로 증가
     * - 30개 큐 × 1000ms = 30s → 모든 요청 타임아웃
     * - 디시인사이드 차단 방지는 초당 3개(333ms) 유지로 충분
     * @returns {number}
     */
    _computeEffectiveDelay() {
        return this.delayMs;
    }

    /**
     * ========================================
     * Queue 초기화
     * ========================================
     */
    clear() {
        // 대기 중인 요청들을 모두 reject
        while (this.queue.length > 0) {
            const item = this.queue.shift();
            item.reject(new Error('Queue가 초기화되었습니다.'));
        }

        this.stats.currentQueueSize = 0;
        console.log('[FetchQueueManager] Queue 초기화 완료');
    }

    /**
     * ========================================
     * 통계 초기화
     * ========================================
     */
    resetStats() {
        this.stats = {
            totalRequests: 0,
            completedRequests: 0,
            failedRequests: 0,
            currentQueueSize: this.queue.length,
            avgWaitTime: 0,
            totalWaitTime: 0
        };

        console.log('[FetchQueueManager] 통계 초기화 완료');
    }
}

/**
 * ========================================
 * 싱글톤 인스턴스
 * ========================================
 */
let instance = null;

export function getFetchQueueManager(options) {
    if (!instance) {
        instance = new FetchQueueManager(options);
    }
    return instance;
}

export function resetFetchQueueManager() {
    if (instance) {
        instance.clear();
    }
    instance = null;
    console.log('[FetchQueueManager] 인스턴스 리셋');
}
