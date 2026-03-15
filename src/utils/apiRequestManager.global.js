/**
 * API Request Manager (중복 요청 방지) - Global Script Version
 * @author 최진호
 * @date 2026-02-26
 * @version 1.0.0
 * @remarks Content Script용 전역 스크립트 버전
 */

(function(window) {
    'use strict';

    /**
     * ========================================
     * API Request Manager 클래스
     * ========================================
     */
    class ApiRequestManager {
        constructor() {
            this.pendingRequests = new Map();
            this.debounceTimers = new Map();
            this.stats = {
                total: 0,
                deduplicated: 0,
                debounced: 0
            };
        }

        async requestImageAnalysis(postNo, requestFn, debounceMs = 300) {
            this.stats.total++;

            // 진행 중인 요청이 있는지 확인
            if (this.pendingRequests.has(postNo)) {
                this.stats.deduplicated++;
                console.log(`[ApiRequestManager] 중복 요청 차단 (진행 중): ${postNo}`);
                return this.pendingRequests.get(postNo);
            }

            // Debounce: 짧은 시간 내 중복 요청 무시
            if (this.debounceTimers.has(postNo)) {
                this.stats.debounced++;
                console.log(`[ApiRequestManager] Debounce: ${postNo} (${debounceMs}ms 내 재요청)`);
                clearTimeout(this.debounceTimers.get(postNo));
            }

            // 새 요청 시작
            const promise = this.executeRequest(postNo, requestFn, debounceMs);
            this.pendingRequests.set(postNo, promise);
            return promise;
        }

        async executeRequest(postNo, requestFn, debounceMs) {
            try {
                // Debounce 대기
                await new Promise(resolve => {
                    const timerId = setTimeout(resolve, debounceMs);
                    this.debounceTimers.set(postNo, timerId);
                });

                // Debounce 타이머 제거
                this.debounceTimers.delete(postNo);

                // 실제 요청 실행
                console.log(`[ApiRequestManager] 요청 시작: ${postNo}`);
                const result = await requestFn();

                console.log(`[ApiRequestManager] 요청 완료: ${postNo}`);
                return result;
            } catch (error) {
                console.error(`[ApiRequestManager] 요청 실패: ${postNo}`, error);
                throw error;
            } finally {
                // 진행 중인 요청 목록에서 제거
                this.pendingRequests.delete(postNo);
            }
        }

        async requestAIVerification(postNo, requestFn, debounceMs = 500) {
            return this.requestImageAnalysis(postNo, requestFn, debounceMs);
        }

        cancel(postNo) {
            if (this.pendingRequests.has(postNo)) {
                this.pendingRequests.delete(postNo);
                console.log(`[ApiRequestManager] 요청 취소: ${postNo}`);
                return true;
            }

            if (this.debounceTimers.has(postNo)) {
                clearTimeout(this.debounceTimers.get(postNo));
                this.debounceTimers.delete(postNo);
                console.log(`[ApiRequestManager] Debounce 취소: ${postNo}`);
                return true;
            }

            return false;
        }

        cancelAll() {
            const count = this.pendingRequests.size + this.debounceTimers.size;

            this.pendingRequests.clear();

            for (const timerId of this.debounceTimers.values()) {
                clearTimeout(timerId);
            }
            this.debounceTimers.clear();

            console.log(`[ApiRequestManager] 모든 요청 취소: ${count}개`);
        }

        isPending(postNo) {
            return this.pendingRequests.has(postNo) || this.debounceTimers.has(postNo);
        }

        getStats() {
            return {
                ...this.stats,
                pendingCount: this.pendingRequests.size,
                debounceCount: this.debounceTimers.size,
                deduplicationRate: this.stats.total > 0
                    ? ((this.stats.deduplicated + this.stats.debounced) / this.stats.total * 100).toFixed(2) + '%'
                    : '0%'
            };
        }

        resetStats() {
            this.stats = {
                total: 0,
                deduplicated: 0,
                debounced: 0
            };
        }

        destroy() {
            this.cancelAll();
            this.stats = {
                total: 0,
                deduplicated: 0,
                debounced: 0
            };
        }
    }

    /**
     * ========================================
     * 싱글톤 인스턴스
     * ========================================
     */
    let instance = null;

    function getApiRequestManager() {
        if (!instance) {
            instance = new ApiRequestManager();
        }
        return instance;
    }

    function resetApiRequestManager() {
        if (instance) {
            instance.destroy();
        }
        instance = null;
    }

    // 전역 노출
    window.ApiRequestManager = ApiRequestManager;
    window.getApiRequestManager = getApiRequestManager;
    window.resetApiRequestManager = resetApiRequestManager;

})(window);
