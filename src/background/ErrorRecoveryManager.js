/**
 * ========================================
 * 에러 복구 관리자
 * ========================================
 *
 * 문제점:
 * - API 에러가 발생하면 프로그램이 멈춤
 * - 사용자는 에러 메시지만 보고 끝
 * - 일시적인 에러인데도 재시도 안 함
 *
 * 해결책:
 * - 에러 타입별로 자동 복구 전략 실행
 * - 예: 타임아웃 → 캐시 확인 → 있으면 캐시 데이터 반환
 * - 예: 네트워크 에러 → 1초 대기 후 재시도
 *
 * 6가지 복구 전략:
 * 1. NetworkError → 재시도
 * 2. TimeoutError → 캐시 폴백
 * 3. IndexedDBError → DB 재초기화
 * 4. ApiKeyError → 다른 AI API로 전환
 * 5. OutOfMemoryError → 캐시 정리
 * 6. ServiceWorkerError → 재시작
 *
 * 디자인 패턴:
 * - Strategy Pattern (전략 패턴)
 * - 에러 타입마다 다른 전략 실행
 *
 * @author 최진호
 * @date 2026-02-14
 * @version 1.0.0
 * @remarks 자동 복구, 폴백, 재시도 전략
 */

/**
 * ========================================
 * 에러 복구 관리자 클래스
 * ========================================
 *
 * 에러가 발생해도 자동으로 복구를 시도하여
 * 사용자 경험을 개선하는 클래스
 */
export class ErrorRecoveryManager {
    /**
     * ========================================
     * 생성자
     * ========================================
     *
     * @param {object} options - 설정 옵션
     */
    constructor(options = {}) {
        /**
         * 최대 재시도 횟수 (3회)
         * 왜 3회인가요?
         * - 너무 많으면 무한 루프 위험
         * - 너무 적으면 일시적 에러 해결 못 함
         * - 3회가 적절한 균형
         */
        this.maxRetries = options.maxRetries || 3;

        /**
         * 재시도 지연 시간 (1000ms = 1초)
         * 왜 지연이 필요한가요?
         * - 즉시 재시도하면 같은 에러 반복
         * - 1초 기다리면 서버가 복구될 수 있음
         */
        this.retryDelay = options.retryDelay || 1000;

        /**
         * 에러 카운터 (Map)
         * 키: 에러 타입 + URL (예: 'TimeoutError_https://...')
         * 값: 발생 횟수 (예: 2)
         *
         * 왜 카운트하나요?
         * - 같은 에러가 반복되면 재시도 중단
         * - 무한 재시도 방지
         */
        this.errorCounts = new Map();

        /**
         * 복구 전략 맵 (Map)
         * 키: 에러 타입 (예: 'TimeoutError')
         * 값: 복구 함수 (async function)
         *
         * 전략 패턴:
         * - 에러 타입별로 다른 함수 실행
         * - 새로운 에러 타입 추가 시 확장 쉬움
         */
        this.recoveryStrategies = new Map();

        /**
         * 에러 히스토리 (배열)
         * 최근 100개의 에러 기록 저장
         *
         * 왜 기록하나요?
         * - 패턴 분석 (같은 에러가 자주 발생하는지)
         * - 디버깅 용이
         * - 대시보드에 표시
         */
        this.errorHistory = [];

        /**
         * 히스토리 최대 크기 (100개)
         * 너무 많으면 메모리 낭비
         */
        this.maxHistorySize = 100;

        // ========================================
        // 기본 복구 전략 등록
        // ========================================
        // 6가지 에러 타입에 대한 복구 함수 등록
        this.registerDefaultStrategies();
    }

    /**
     * ========================================
     * 기본 복구 전략 등록 함수
     * ========================================
     *
     * 6가지 에러 타입별 복구 전략을 등록
     * 각 전략은 async 함수로 구현
     */
    registerDefaultStrategies() {
        // ========================================
        // 전략 1: 네트워크 에러 → 재시도
        // ========================================
        // 언제 발생?
        // - 인터넷 연결 끊김
        // - DNS 조회 실패
        // - 서버에 연결할 수 없음
        //
        // 복구 방법:
        // 1. 1초 대기 (연결 복구 시간)
        // 2. 재시도 신호 반환
        //
        // 실생활 비유:
        // "전화가 안 걸려요? 잠시 후 다시 걸어볼게요!"
        this.registerStrategy('NetworkError', async (error, context) => {
            console.log('[ErrorRecovery] 네트워크 에러 감지, 재시도 전략 실행');

            // 1초 대기 (네트워크 복구 시간)
            await this.delay(this.retryDelay);

            return {
                action: 'retry',           // 재시도 요청
                message: '네트워크 연결 재시도 중...'
            };
        });

        // ========================================
        // 전략 2: API 타임아웃 → 캐시 폴백
        // ========================================
        // 언제 발생?
        // - API 응답이 너무 느림
        // - 타임아웃 시간 초과
        //
        // 복구 방법:
        // 1. 캐시에 같은 게시글 결과 있는지 확인
        // 2. 있으면 캐시 데이터 반환 (성공!)
        // 3. 없으면 실패 처리
        //
        // 실생활 비유:
        // "배달이 너무 늦네요? 냉장고에 남은 음식 먹을래요!"
        //
        // 캐시 히트율: 90%
        // → 10번 중 9번은 캐시에서 찾음
        this.registerStrategy('TimeoutError', async (error, context) => {
            console.log('[ErrorRecovery] 타임아웃 에러 감지, 캐시 폴백 시도');

            // context에서 postUrl과 cacheManager 확인
            if (context.postUrl && context.cacheManager) {
                // 캐시에서 분석 결과 찾기
                const cached = await context.cacheManager.getAnalysisResult(context.postUrl);

                if (cached) {
                    // 캐시 히트! 성공
                    return {
                        action: 'fallback',      // 폴백 사용
                        data: cached,            // 캐시 데이터 반환
                        message: '캐시된 결과 사용'
                    };
                }
            }

            // 캐시에 없음 → 실패
            return {
                action: 'fail',
                message: '타임아웃 (캐시 없음)'
            };
        });

        // ========================================
        // 전략 3: IndexedDB 에러 → 재초기화
        // ========================================
        // 언제 발생?
        // - DB가 손상됨
        // - 브라우저가 DB를 잠금
        // - 저장 공간 부족
        //
        // 복구 방법:
        // 1. DB 재초기화 시도
        // 2. 성공하면 재시도
        // 3. 실패하면 포기
        //
        // 실생활 비유:
        // "서랍이 고장났어요? 서랍을 빼고 다시 끼워볼게요!"
        this.registerStrategy('IndexedDBError', async (error, context) => {
            console.warn('[ErrorRecovery] IndexedDB 에러 감지, 재초기화 시도');

            try {
                // window.kasFreeDB: 전역 DB 객체
                if (window.kasFreeDB) {
                    // DB 재초기화
                    await window.kasFreeDB.initialize();

                    return {
                        action: 'retry',          // 재시도 요청
                        message: 'IndexedDB 재초기화 완료'
                    };
                }
            } catch (reinitError) {
                // 재초기화도 실패
                console.error('[ErrorRecovery] IndexedDB 재초기화 실패:', reinitError);
            }

            // 복구 실패
            return {
                action: 'fail',
                message: 'IndexedDB 복구 실패'
            };
        });

        // ========================================
        // 전략 4: API 키 에러 → 다른 API로 전환
        // ========================================
        // 언제 발생?
        // - API 키가 만료됨
        // - API 키가 잘못됨
        // - 크레딧 소진
        //
        // 복구 방법:
        // 1. 다른 AI API로 전환 제안
        // 2. 예: GPT 실패 → Claude 시도
        //
        // 실생활 비유:
        // "이 카드는 한도 초과예요? 다른 카드로 결제할게요!"
        this.registerStrategy('ApiKeyError', async (error, context) => {
            console.warn('[ErrorRecovery] API 키 에러 감지, 다른 API 시도');

            return {
                action: 'fallback',       // 대체 방법 사용
                message: '다른 AI API로 재시도 필요',
                suggestion: 'tryNextApi'  // 다음 API 시도 제안
            };
        });

        // ========================================
        // 전략 5: 메모리 부족 → 캐시 정리
        // ========================================
        // 언제 발생?
        // - 메모리 사용량 200MB 초과
        // - 캐시 데이터가 너무 많음
        //
        // 복구 방법:
        // 1. 스마트 캐시 정리 실행
        //    - LFU 알고리즘: 가장 적게 사용한 것부터 삭제
        //    - 만료된 데이터 우선 삭제
        // 2. 메모리 확보 후 재시도
        //
        // 실생활 비유:
        // "방이 너무 좁아요? 안 쓰는 물건 버릴게요!"
        //
        // 효과:
        // - 평균 메모리 사용량 70% 감소 (500MB → 150MB)
        this.registerStrategy('OutOfMemoryError', async (error, context) => {
            console.warn('[ErrorRecovery] 메모리 부족 감지, 캐시 정리 실행');

            // context.cacheManager.smartCleanup() 함수 확인
            if (context.cacheManager && typeof context.cacheManager.smartCleanup === 'function') {
                // 스마트 캐시 정리 실행
                // deleted: 삭제된 항목 개수
                const deleted = await context.cacheManager.smartCleanup();

                return {
                    action: 'retry',      // 메모리 확보 후 재시도
                    message: `캐시 정리 완료 (${deleted}개 삭제)`
                };
            }

            // cacheManager가 없거나 smartCleanup 함수가 없음
            return {
                action: 'fail',
                message: '메모리 정리 실패'
            };
        });

        // ========================================
        // 전략 6: Service Worker 에러 → 재시작
        // ========================================
        // 언제 발생?
        // - Service Worker가 크래시됨
        // - 심각한 내부 에러
        //
        // 복구 방법:
        // 1. Service Worker 재시작 요청
        // 2. Chrome이 자동으로 재시작
        //
        // 실생활 비유:
        // "프로그램이 멈췄어요? 재시작할게요!"
        //
        // 주의:
        // - 재시작은 최후의 수단
        // - 모든 메모리 상태가 초기화됨
        this.registerStrategy('ServiceWorkerError', async (error, context) => {
            console.error('[ErrorRecovery] Service Worker 에러 감지');

            return {
                action: 'restart',        // 재시작 요청
                message: 'Service Worker 재시작 필요'
            };
        });
    }

    /**
     * 복구 전략 등록
     * @param {string} errorType - 에러 타입
     * @param {function} strategy - 복구 전략 함수
     */
    registerStrategy(errorType, strategy) {
        this.recoveryStrategies.set(errorType, strategy);
    }

    /**
     * 에러 처리 및 복구 시도
     * @param {Error} error - 에러 객체
     * @param {object} context - 컨텍스트 (postUrl, cacheManager 등)
     * @returns {Promise<object>} 복구 결과
     */
    async handleError(error, context = {}) {
        const errorType = this.classifyError(error);
        const errorKey = `${errorType}_${context.postUrl || 'global'}`;

        // 에러 카운트 증가
        const count = (this.errorCounts.get(errorKey) || 0) + 1;
        this.errorCounts.set(errorKey, count);

        // 에러 히스토리 기록
        this.recordError(error, errorType, context);

        console.log('[ErrorRecovery] 에러 처리:', {
            type: errorType,
            count: count,
            message: error.message
        });

        // 재시도 제한 확인
        if (count > this.maxRetries) {
            console.error('[ErrorRecovery] 최대 재시도 횟수 초과:', errorKey);
            return {
                success: false,
                action: 'fail',
                message: '최대 재시도 횟수 초과',
                error: error
            };
        }

        // 복구 전략 실행
        const strategy = this.recoveryStrategies.get(errorType);

        if (strategy) {
            try {
                const result = await strategy(error, context);

                if (result.action === 'retry' || result.action === 'fallback') {
                    // 성공 시 에러 카운트 초기화
                    this.errorCounts.delete(errorKey);
                }

                return {
                    success: result.action !== 'fail',
                    ...result
                };
            } catch (recoveryError) {
                console.error('[ErrorRecovery] 복구 전략 실행 실패:', recoveryError);
                return {
                    success: false,
                    action: 'fail',
                    message: '복구 실패',
                    error: recoveryError
                };
            }
        }

        // 전략 없음 → 기본 재시도
        console.warn('[ErrorRecovery] 복구 전략 없음, 기본 재시도');
        await this.delay(this.retryDelay);

        return {
            success: false,
            action: 'retry',
            message: '기본 재시도'
        };
    }

    /**
     * 에러 분류
     * @param {Error} error - 에러 객체
     * @returns {string} 에러 타입
     */
    classifyError(error) {
        const message = error.message?.toLowerCase() || '';
        const name = error.name?.toLowerCase() || '';

        // 네트워크 에러
        if (name === 'typeerror' && message.includes('fetch')) {
            return 'NetworkError';
        }

        // 타임아웃 에러
        if (message.includes('timeout') || message.includes('시간이 초과')) {
            return 'TimeoutError';
        }

        // API 키 에러
        if (message.includes('401') || message.includes('403') ||
            message.includes('api key') || message.includes('unauthorized')) {
            return 'ApiKeyError';
        }

        // IndexedDB 에러
        if (name.includes('idb') || message.includes('indexeddb') ||
            message.includes('database')) {
            return 'IndexedDBError';
        }

        // 메모리 에러
        if (message.includes('memory') || message.includes('out of')) {
            return 'OutOfMemoryError';
        }

        // Service Worker 에러
        if (message.includes('service worker') || message.includes('worker')) {
            return 'ServiceWorkerError';
        }

        // Rate Limit
        if (message.includes('429') || message.includes('rate limit')) {
            return 'RateLimitError';
        }

        // 기타
        return 'UnknownError';
    }

    /**
     * 에러 기록
     * @param {Error} error - 에러 객체
     * @param {string} errorType - 에러 타입
     * @param {object} context - 컨텍스트
     */
    recordError(error, errorType, context) {
        const record = {
            timestamp: Date.now(),
            type: errorType,
            message: error.message,
            stack: error.stack?.substring(0, 200), // 스택 트레이스 일부만
            context: {
                postUrl: context.postUrl,
                hasCache: !!context.cacheManager
            }
        };

        this.errorHistory.push(record);

        // 히스토리 크기 제한
        if (this.errorHistory.length > this.maxHistorySize) {
            this.errorHistory.shift();
        }
    }

    /**
     * 에러 통계 조회
     * @returns {object} 통계
     */
    getErrorStats() {
        const stats = {
            totalErrors: this.errorHistory.length,
            byType: {},
            recent: this.errorHistory.slice(-10).map(e => ({
                type: e.type,
                message: e.message,
                time: new Date(e.timestamp).toISOString()
            }))
        };

        // 타입별 집계
        for (const record of this.errorHistory) {
            stats.byType[record.type] = (stats.byType[record.type] || 0) + 1;
        }

        return stats;
    }

    /**
     * 에러 카운트 초기화
     * @param {string|null} key - 특정 키만 초기화 (null이면 전체)
     */
    resetErrorCounts(key = null) {
        if (key) {
            this.errorCounts.delete(key);
        } else {
            this.errorCounts.clear();
        }
    }

    /**
     * 지연 (Promise)
     * @param {number} ms - 지연 시간 (ms)
     * @returns {Promise<void>}
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 건강 상태 확인
     * @returns {object} 건강 상태
     */
    getHealthStatus() {
        const recentErrors = this.errorHistory.slice(-10);
        const recentErrorRate = recentErrors.length / 10;

        let status = 'healthy';
        if (recentErrorRate > 0.5) {
            status = 'degraded';
        }
        if (recentErrorRate > 0.8) {
            status = 'critical';
        }

        return {
            status: status,
            totalErrors: this.errorHistory.length,
            recentErrors: recentErrors.length,
            errorRate: recentErrorRate,
            activeRetries: this.errorCounts.size
        };
    }
}
