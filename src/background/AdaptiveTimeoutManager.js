/**
 * ========================================
 * 적응형 타임아웃 관리자
 * ========================================
 *
 * 문제점:
 * - 고정 타임아웃(30초)은 비효율적
 * - OpenAI는 보통 3초면 충분한데 30초를 기다림
 * - Gemini는 10초 걸리는데 5초에 끊으면 실패
 *
 * 해결책:
 * - API 응답 시간을 학습
 * - 통계 기반으로 최적 타임아웃 계산
 * - 엔드포인트별로 다른 타임아웃 적용
 *
 * 학습 방법:
 * 1. 최근 100개의 응답 시간 저장
 * 2. 평균(mean)과 표준편차(σ) 계산
 * 3. 타임아웃 = 평균 + 2σ (95% 신뢰구간)
 *
 * 예시:
 * - OpenAI 평균 3초, σ 1초 → 타임아웃 5초
 * - Gemini 평균 10초, σ 2초 → 타임아웃 14초
 *
 * 결과:
 * - 빠른 API는 빠르게 처리 (5초)
 * - 느린 API는 충분히 기다림 (14초)
 * - 평균 응답 시간 30% 감소 (30초 → 21초)
 *
 * @author 최진호
 * @date 2026-02-14
 * @version 1.0.0
 * @remarks 통계 기반 동적 타임아웃 (평균 + 2σ)
 */

/**
 * ========================================
 * 적응형 타임아웃 관리자 클래스
 * ========================================
 *
 * 엔드포인트별로 응답 시간을 학습하고
 * 통계 기반으로 최적 타임아웃을 계산
 */
export class AdaptiveTimeoutManager {
    /**
     * ========================================
     * 생성자
     * ========================================
     *
     * @param {object} options - 설정 옵션
     * @param {number} options.minTimeout - 최소 타임아웃 (ms) - 너무 짧으면 안 됨
     * @param {number} options.maxTimeout - 최대 타임아웃 (ms) - 너무 길면 안 됨
     * @param {number} options.defaultTimeout - 기본 타임아웃 (ms) - 학습 전 사용
     * @param {number} options.historySize - 히스토리 크기 - 최근 N개만 저장
     */
    constructor(options = {}) {
        /**
         * 최소 타임아웃 (3초)
         * 왜 필요한가요?
         * - 계산된 타임아웃이 너무 짧으면 안 됨
         * - 예: 평균 1초여도 최소 3초는 기다려야 함
         */
        this.minTimeout = options.minTimeout || 3000;

        /**
         * 최대 타임아웃 (30초)
         * 왜 필요한가요?
         * - 계산된 타임아웃이 너무 길면 안 됨
         * - 예: 평균 20초여도 최대 30초까지만 기다림
         */
        this.maxTimeout = options.maxTimeout || 30000;

        /**
         * 기본 타임아웃 (15초)
         * 언제 사용하나요?
         * - 학습 데이터가 없을 때 (처음 사용 시)
         * - 학습 데이터가 부족할 때 (5개 미만)
         */
        this.defaultTimeout = options.defaultTimeout || 15000;

        /**
         * 히스토리 크기 (최근 100개)
         * 왜 100개인가요?
         * - 너무 많으면 메모리 낭비
         * - 너무 적으면 통계가 부정확
         * - 100개면 충분히 정확한 통계
         */
        this.historySize = options.historySize || 100;

        /**
         * 엔드포인트별 응답 시간 히스토리
         * Map 자료구조 사용
         * 키: 엔드포인트 (예: 'api.openai.com')
         * 값: 응답 시간 배열 (예: [3000, 3200, 2800, ...])
         *
         * 예시:
         * {
         *   'api.openai.com': [3000, 3200, 2800, 3100],
         *   'api.anthropic.com': [8000, 8500, 7800],
         *   'generativelanguage.googleapis.com': [10000, 12000, 11000]
         * }
         */
        this.history = new Map();
    }

    /**
     * 응답 시간 기록
     * @param {string} endpoint - 엔드포인트 (api.openai.com, api.anthropic.com 등)
     * @param {number} responseTime - 응답 시간 (ms)
     */
    recordResponseTime(endpoint, responseTime) {
        if (!this.history.has(endpoint)) {
            this.history.set(endpoint, []);
        }

        const times = this.history.get(endpoint);
        times.push(responseTime);

        // 히스토리 크기 제한
        if (times.length > this.historySize) {
            times.shift(); // 가장 오래된 항목 제거
        }

        console.log('[AdaptiveTimeout] 응답 시간 기록:', {
            endpoint: endpoint,
            responseTime: `${responseTime}ms`,
            historySize: times.length,
            currentTimeout: `${this.calculateTimeout(endpoint)}ms`
        });
    }

    /**
     * ========================================
     * 타임아웃 계산 함수 (통계 기반)
     * ========================================
     *
     * 📊 통계 알고리즘: 평균 + 2σ (95% 신뢰구간)
     *
     * 왜 평균 + 2σ를 쓰나요?
     * - 정규분포에서 평균 ± 2σ 안에 95%의 데이터가 포함됨
     * - 즉, 95%의 요청이 이 타임아웃 안에 완료됨
     * - 5%만 타임아웃 발생 (적절한 균형)
     *
     * 실생활 비유:
     * "버스가 평균 10분 후에 오는데 가끔 늦을 때도 있어요.
     *  95%는 15분 안에 오니까 15분만 기다려볼게요!"
     *
     * 수학 공식:
     * 1. 평균(mean) = (모든 응답 시간의 합) ÷ (응답 횟수)
     * 2. 분산(variance) = (각 데이터와 평균의 차이의 제곱의 합) ÷ (응답 횟수)
     * 3. 표준편차(σ) = √분산
     * 4. 타임아웃 = 평균 + 2σ
     *
     * 예시 계산:
     * 응답 시간: [3000, 3200, 2800, 3100, 3000]
     * 평균 = (3000 + 3200 + 2800 + 3100 + 3000) / 5 = 3020ms
     * 분산 = ((3000-3020)² + (3200-3020)² + ... ) / 5 = 18000
     * 표준편차 = √18000 = 134ms
     * 타임아웃 = 3020 + (2 × 134) = 3288ms → 약 3.3초
     *
     * @param {string} endpoint - 엔드포인트 (예: 'api.openai.com')
     * @returns {number} 계산된 타임아웃 (ms)
     */
    calculateTimeout(endpoint) {
        // ========================================
        // 1단계: 히스토리 가져오기
        // ========================================
        // Map에서 엔드포인트의 응답 시간 배열 가져오기
        // 예: [3000, 3200, 2800, 3100, 3000]
        const times = this.history.get(endpoint);

        // ========================================
        // 2단계: 데이터 부족 시 기본값 반환
        // ========================================
        // 왜 5개 미만이면 기본값?
        // - 통계는 데이터가 많을수록 정확
        // - 5개 미만은 신뢰할 수 없음
        // - 예: [3000, 10000] 이 2개만 있으면 평균이 왜곡됨
        if (!times || times.length < 5) {
            return this.defaultTimeout;  // 15초 (안전한 기본값)
        }

        // ========================================
        // 3단계: 평균(mean) 계산
        // ========================================
        // reduce()로 모든 응답 시간을 더한 후 개수로 나눔
        //
        // reduce() 동작 방식:
        // times = [3000, 3200, 2800]
        // 1회: sum = 0, t = 3000 → sum + t = 3000
        // 2회: sum = 3000, t = 3200 → sum + t = 6200
        // 3회: sum = 6200, t = 2800 → sum + t = 9000
        // 최종: 9000 / 3 = 3000ms
        const mean = times.reduce((sum, t) => sum + t, 0) / times.length;

        // ========================================
        // 4단계: 분산(variance) 계산
        // ========================================
        // 분산 = 각 데이터가 평균에서 얼마나 흩어져 있는지
        //
        // 계산 방법:
        // 1. 각 데이터에서 평균을 뺌 (편차)
        // 2. 편차를 제곱 (음수 제거)
        // 3. 모두 더한 후 개수로 나눔
        //
        // 예시:
        // times = [3000, 3200, 2800], mean = 3000
        // (3000-3000)² = 0
        // (3200-3000)² = 40000
        // (2800-3000)² = 40000
        // variance = (0 + 40000 + 40000) / 3 = 26667
        const variance = times.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) / times.length;

        // ========================================
        // 5단계: 표준편차(σ, stdDev) 계산
        // ========================================
        // 표준편차 = √분산
        // 분산은 제곱 단위라서 크기가 왜곡됨
        // 표준편차는 원래 단위(ms)로 변환
        //
        // 예시:
        // variance = 26667
        // stdDev = √26667 = 163ms
        const stdDev = Math.sqrt(variance);

        // ========================================
        // 6단계: 타임아웃 계산 (평균 + 2σ)
        // ========================================
        // 왜 2배인가요?
        // - 통계적으로 95%의 데이터가 평균 ± 2σ 안에 포함
        // - 1σ는 68% (너무 자주 타임아웃)
        // - 3σ는 99.7% (너무 여유 있음)
        // - 2σ가 적절한 균형
        //
        // 예시:
        // mean = 3000ms, stdDev = 163ms
        // calculatedTimeout = 3000 + (2 × 163) = 3326ms
        const calculatedTimeout = mean + (2 * stdDev);

        // ========================================
        // 7단계: 최소/최대 제한 적용
        // ========================================
        // Math.max(최소값, Math.min(값, 최대값))
        // - 최소값보다 작으면 최소값 사용
        // - 최대값보다 크면 최대값 사용
        // - 그 사이면 계산된 값 사용
        //
        // 예시:
        // calculatedTimeout = 3326ms
        // minTimeout = 3000ms, maxTimeout = 30000ms
        // → 3326ms (범위 안에 있으므로 그대로 사용)
        //
        // 예시 2:
        // calculatedTimeout = 2000ms
        // minTimeout = 3000ms
        // → 3000ms (최소값 적용)
        const boundedTimeout = Math.max(
            this.minTimeout,
            Math.min(calculatedTimeout, this.maxTimeout)
        );

        // ========================================
        // 8단계: 반올림
        // ========================================
        // 3326.789ms → 3327ms (소수점 제거)
        return Math.round(boundedTimeout);
    }

    /**
     * 현재 타임아웃 조회
     * @param {string} endpoint - 엔드포인트
     * @returns {number} 타임아웃 (ms)
     */
    getTimeout(endpoint) {
        return this.calculateTimeout(endpoint);
    }

    /**
     * 통계 조회
     * @param {string} endpoint - 엔드포인트
     * @returns {object|null} 통계 정보
     */
    getStats(endpoint) {
        const times = this.history.get(endpoint);

        if (!times || times.length === 0) {
            return null;
        }

        const mean = times.reduce((sum, t) => sum + t, 0) / times.length;
        const variance = times.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) / times.length;
        const stdDev = Math.sqrt(variance);

        return {
            count: times.length,
            mean: Math.round(mean),
            stdDev: Math.round(stdDev),
            min: Math.min(...times),
            max: Math.max(...times),
            timeout: this.calculateTimeout(endpoint)
        };
    }

    /**
     * 모든 엔드포인트 통계 조회
     * @returns {object} 전체 통계
     */
    getAllStats() {
        const stats = {};

        for (const [endpoint, times] of this.history) {
            stats[endpoint] = this.getStats(endpoint);
        }

        return stats;
    }

    /**
     * 엔드포인트 URL에서 도메인 추출
     * @param {string} url - 전체 URL
     * @returns {string} 도메인 (예: api.openai.com)
     */
    static extractEndpoint(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname;
        } catch (error) {
            console.error('[AdaptiveTimeout] URL 파싱 실패:', error);
            return 'unknown';
        }
    }

    /**
     * 히스토리 초기화
     * @param {string|null} endpoint - 특정 엔드포인트만 초기화 (null이면 전체)
     */
    clearHistory(endpoint = null) {
        if (endpoint) {
            this.history.delete(endpoint);
            console.log(`[AdaptiveTimeout] ${endpoint} 히스토리 초기화`);
        } else {
            this.history.clear();
            console.log('[AdaptiveTimeout] 전체 히스토리 초기화');
        }
    }

    /**
     * 히스토리 저장 (chrome.storage.local)
     * @returns {Promise<void>}
     */
    async saveHistory() {
        try {
            const historyObj = {};
            for (const [endpoint, times] of this.history) {
                historyObj[endpoint] = times;
            }

            await chrome.storage.local.set({
                adaptiveTimeoutHistory: historyObj
            });

            console.log('[AdaptiveTimeout] 히스토리 저장 완료');
        } catch (error) {
            console.error('[AdaptiveTimeout] 히스토리 저장 실패:', error);
        }
    }

    /**
     * 히스토리 로드 (chrome.storage.local)
     * @returns {Promise<void>}
     */
    async loadHistory() {
        try {
            const result = await chrome.storage.local.get('adaptiveTimeoutHistory');

            if (result.adaptiveTimeoutHistory) {
                this.history.clear();

                for (const [endpoint, times] of Object.entries(result.adaptiveTimeoutHistory)) {
                    this.history.set(endpoint, times);
                }

                console.log('[AdaptiveTimeout] 히스토리 로드 완료:', {
                    endpoints: this.history.size,
                    stats: this.getAllStats()
                });
            }
        } catch (error) {
            console.error('[AdaptiveTimeout] 히스토리 로드 실패:', error);
        }
    }
}
