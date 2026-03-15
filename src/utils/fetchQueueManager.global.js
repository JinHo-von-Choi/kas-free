/**
 * Fetch Queue Manager (요청 속도 제한) - Global Script Version
 * @author 최진호
 * @date 2026-03-16
 * @version 1.0.0
 * @remarks Content Script용 전역 스크립트 버전 (dcParser.js 등 Plain Script 환경)
 */

(function(window) {
    'use strict';

    /**
     * Fetch 요청을 초당 제한 개수만큼만 순차 처리하는 Queue
     *
     * 왜 필요한가?
     * - 디시인사이드는 짧은 시간 내 너무 많은 요청 시 차단
     * - 동시에 10~50개 fetch 요청 → 차단
     * - 순차 처리 + 딜레이로 차단 방지
     */
    class FetchQueueManager {
        /**
         * @param {object} options - 옵션
         * @param {number} options.requestsPerSecond - 초당 요청 수 (기본: 3)
         * @param {number} options.maxQueueSize - 최대 Queue 크기 (기본: 100)
         */
        constructor(options = {}) {
            this.requestsPerSecond = options.requestsPerSecond || 3;
            this.maxQueueSize      = options.maxQueueSize      || 100;
            this.delayMs           = Math.floor(1000 / this.requestsPerSecond);

            this.queue      = [];
            this.processing = false;

            this.stats = {
                totalRequests:     0,
                completedRequests: 0,
                failedRequests:    0,
                currentQueueSize:  0,
                avgWaitTime:       0,
                totalWaitTime:     0
            };

            this.paused             = false;
            this.pauseUntil         = 0;
            this.consecutiveFails   = 0;
            this.consecutiveSuccess = 0;
            this.baseDelayMs        = this.delayMs;
            this.baseRPS            = this.requestsPerSecond;

            console.log(`[FetchQueueManager] 초기화: 초당 ${this.requestsPerSecond}개 (${this.delayMs}ms 간격)`);
        }

        /**
         * Fetch 요청을 Queue에 추가한다
         * @param {Function} fetchFn - Fetch 함수 (Promise 반환)
         * @param {object} metadata - 메타데이터 (디버깅용)
         * @returns {Promise<any>} Fetch 결과
         */
        async enqueue(fetchFn, metadata = {}) {
            if (this.queue.length >= this.maxQueueSize) {
                throw new Error(`Queue 크기 초과 (${this.maxQueueSize})`);
            }

            this.stats.totalRequests++;
            this.stats.currentQueueSize = this.queue.length + 1;

            const enqueuedAt = Date.now();

            return new Promise((resolve, reject) => {
                this.queue.push({ fetchFn, metadata, enqueuedAt, resolve, reject });
                this._processQueue();
            });
        }

        /** Queue를 순차 처리한다 */
        async _processQueue() {
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
                const waitTime  = startTime - item.enqueuedAt;

                this.stats.totalWaitTime += waitTime;
                this.stats.avgWaitTime    = Math.floor(
                    this.stats.totalWaitTime / this.stats.totalRequests
                );

                try {
                    const result = await item.fetchFn();

                    this.consecutiveSuccess++;
                    this.consecutiveFails = 0;

                    if (this.consecutiveSuccess >= 10 && this.delayMs > this.baseDelayMs) {
                        this._restoreSpeed();
                    }

                    this.stats.completedRequests++;
                    item.resolve(result);

                } catch (error) {
                    this.consecutiveFails++;
                    this.consecutiveSuccess = 0;

                    if (this.consecutiveFails >= 3) {
                        this._halveSpeed();
                        this.consecutiveFails = 0;
                    }

                    this.stats.failedRequests++;
                    item.reject(error);
                }

                if (this.queue.length > 0) {
                    await new Promise(r => setTimeout(r, this.delayMs));
                }
            }

            this.processing = false;
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

        /** 속도를 절반으로 줄인다 (최소 2000ms = 0.5/s) */
        _halveSpeed() {
            const newDelay         = Math.min(this.delayMs * 2, 2000);
            this.delayMs           = newDelay;
            this.requestsPerSecond = Math.max(1000 / newDelay, 0.5);
        }

        /** 원래 속도로 복구한다 */
        _restoreSpeed() {
            this.delayMs            = this.baseDelayMs;
            this.requestsPerSecond  = this.baseRPS;
            this.consecutiveSuccess = 0;
        }

        /** 통계를 반환한다 */
        getStats() {
            return {
                ...this.stats,
                requestsPerSecond: this.requestsPerSecond,
                delayMs:           this.delayMs,
                paused:            this.paused
            };
        }

        /** Queue를 초기화한다 */
        clear() {
            while (this.queue.length > 0) {
                const item = this.queue.shift();
                item.reject(new Error('Queue가 초기화되었습니다.'));
            }
            this.stats.currentQueueSize = 0;
        }
    }

    /** 싱글톤 인스턴스 */
    let instance = null;

    function getFetchQueueManager(options) {
        if (!instance) {
            instance = new FetchQueueManager(options);
        }
        return instance;
    }

    function resetFetchQueueManager() {
        if (instance) {
            instance.clear();
        }
        instance = null;
    }

    /** 전역 노출 */
    window.FetchQueueManager    = FetchQueueManager;
    window.getFetchQueueManager = getFetchQueueManager;
    window.resetFetchQueueManager = resetFetchQueueManager;

    /** 기본 싱글톤 자동 생성 */
    window.fetchQueueManager = getFetchQueueManager();

})(window);
