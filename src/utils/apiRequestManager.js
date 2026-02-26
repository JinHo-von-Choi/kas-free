/**
 * API Request Manager (중복 요청 방지)
 * @author 최진호
 * @date 2026-02-26
 * @version 1.0.0
 * @remarks Debounce + Promise 공유로 중복 API 요청 방지
 */

/**
 * ========================================
 * API Request Manager 클래스
 * ========================================
 *
 * 중복 API 요청을 방지합니다.
 *
 * 왜 필요한가요?
 * - MutationObserver가 빠르게 여러 번 트리거될 수 있음
 * - 동일한 게시글에 대해 여러 번 분석 요청 발생
 * - 네트워크 낭비, Service Worker 과부하
 *
 * 해결 방법:
 * 1. 진행 중인 요청 추적 (Map)
 * 2. 동일한 요청이 있으면 같은 Promise 반환 (공유)
 * 3. Debounce로 짧은 시간 내 중복 요청 무시
 *
 * 실생활 비유:
 * "커피숍 주문:
 *  - 같은 메뉴를 연달아 주문하면 → 하나만 만들어서 나눠줌 (Promise 공유)
 *  - 1초 내 같은 주문 → 무시 (Debounce)
 *  - 주문 완료 후 다시 주문 가능"
 */
export class ApiRequestManager {
    constructor() {
        /** 진행 중인 요청 Map (key: postNo, value: Promise) */
        this.pendingRequests = new Map();

        /** Debounce 타이머 Map (key: postNo, value: timerId) */
        this.debounceTimers = new Map();

        /** 요청 통계 */
        this.stats = {
            total: 0,           // 총 요청 수
            deduplicated: 0,    // 중복 제거된 요청 수
            debounced: 0        // Debounce로 무시된 요청 수
        };
    }

    /**
     * ========================================
     * 이미지 분석 요청 (중복 제거)
     * ========================================
     *
     * @param {string} postNo - 게시글 번호
     * @param {Function} requestFn - 실제 요청 함수
     * @param {number} debounceMs - Debounce 시간 (ms), 기본 300ms
     * @returns {Promise<object>}
     */
    async requestImageAnalysis(postNo, requestFn, debounceMs = 300) {
        this.stats.total++;

        // ========================================
        // 1. 진행 중인 요청이 있는지 확인
        // ========================================
        if (this.pendingRequests.has(postNo)) {
            this.stats.deduplicated++;
            console.log(`[ApiRequestManager] 중복 요청 차단 (진행 중): ${postNo}`);

            // 같은 Promise 반환 (공유)
            return this.pendingRequests.get(postNo);
        }

        // ========================================
        // 2. Debounce: 짧은 시간 내 중복 요청 무시
        // ========================================
        if (this.debounceTimers.has(postNo)) {
            this.stats.debounced++;
            console.log(`[ApiRequestManager] Debounce: ${postNo} (${debounceMs}ms 내 재요청)`);

            // Debounce 타이머 리셋
            clearTimeout(this.debounceTimers.get(postNo));
        }

        // ========================================
        // 3. 새 요청 시작
        // ========================================
        const promise = this.executeRequest(postNo, requestFn, debounceMs);

        // 진행 중인 요청 목록에 추가
        this.pendingRequests.set(postNo, promise);

        return promise;
    }

    /**
     * ========================================
     * 실제 요청 실행
     * ========================================
     *
     * @param {string} postNo - 게시글 번호
     * @param {Function} requestFn - 실제 요청 함수
     * @param {number} debounceMs - Debounce 시간 (ms)
     * @returns {Promise<object>}
     */
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

    /**
     * ========================================
     * AI 검증 요청 (중복 제거)
     * ========================================
     *
     * @param {string} postNo - 게시글 번호
     * @param {Function} requestFn - 실제 요청 함수
     * @param {number} debounceMs - Debounce 시간 (ms), 기본 500ms
     * @returns {Promise<object>}
     */
    async requestAIVerification(postNo, requestFn, debounceMs = 500) {
        // AI 검증은 더 긴 Debounce (사용자가 버튼을 여러 번 클릭할 수 있음)
        return this.requestImageAnalysis(postNo, requestFn, debounceMs);
    }

    /**
     * ========================================
     * 요청 취소
     * ========================================
     *
     * 진행 중인 요청을 취소합니다.
     * (실제 네트워크 요청은 취소 불가, Promise만 거부)
     *
     * @param {string} postNo - 게시글 번호
     * @returns {boolean} 취소 성공 여부
     */
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

    /**
     * ========================================
     * 모든 요청 취소
     * ========================================
     */
    cancelAll() {
        const count = this.pendingRequests.size + this.debounceTimers.size;

        this.pendingRequests.clear();

        for (const timerId of this.debounceTimers.values()) {
            clearTimeout(timerId);
        }
        this.debounceTimers.clear();

        console.log(`[ApiRequestManager] 모든 요청 취소: ${count}개`);
    }

    /**
     * ========================================
     * 진행 중인 요청 확인
     * ========================================
     *
     * @param {string} postNo - 게시글 번호
     * @returns {boolean} 진행 중인지 여부
     */
    isPending(postNo) {
        return this.pendingRequests.has(postNo) || this.debounceTimers.has(postNo);
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
            pendingCount: this.pendingRequests.size,
            debounceCount: this.debounceTimers.size,
            deduplicationRate: this.stats.total > 0
                ? ((this.stats.deduplicated + this.stats.debounced) / this.stats.total * 100).toFixed(2) + '%'
                : '0%'
        };
    }

    /**
     * ========================================
     * 통계 초기화
     * ========================================
     */
    resetStats() {
        this.stats = {
            total: 0,
            deduplicated: 0,
            debounced: 0
        };
    }

    /**
     * ========================================
     * 정리 (메모리 누수 방지)
     * ========================================
     */
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
 *
 * 전역에서 하나의 인스턴스만 사용합니다.
 */
let instance = null;

/**
 * 싱글톤 인스턴스 가져오기
 * @returns {ApiRequestManager}
 */
export function getApiRequestManager() {
    if (!instance) {
        instance = new ApiRequestManager();
    }
    return instance;
}

/**
 * 싱글톤 인스턴스 초기화
 */
export function resetApiRequestManager() {
    if (instance) {
        instance.destroy();
    }
    instance = null;
}
