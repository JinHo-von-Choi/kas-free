/**
 * ========================================
 * API 클라이언트
 * ========================================
 *
 * 이 파일의 역할:
 * - 외부 AI API 호출 (OpenAI, Anthropic, Google)
 * - 적응형 타임아웃 (통계 기반으로 타임아웃 자동 조정)
 * - 자동 재시도 (에러 발생 시 최대 3회 재시도)
 * - Exponential Backoff (재시도 간격 점진적 증가)
 *
 * 왜 이렇게 복잡하게 만들었나요?
 * - AI API는 불안정함 (가끔 느려지거나 에러 발생)
 * - 고정 타임아웃(30초)은 비효율적
 *   → 빠를 때는 5초면 충분한데 30초를 기다림
 * - 자동 재시도로 일시적 에러 해결
 *
 * @author 최진호
 * @date 2026-02-14
 * @version 1.2.0
 * @remarks AI API 호출 with 적응형 타임아웃 및 재시도 로직
 */

import { AI_ANALYSIS_PROMPT } from '../utils/constants.js';
import { AdaptiveTimeoutManager } from './AdaptiveTimeoutManager.js';

/**
 * ========================================
 * API 에러 클래스
 * ========================================
 *
 * 일반 Error 클래스를 확장하여 추가 정보 포함
 *
 * 왜 커스텀 에러 클래스를 만드나요?
 * - statusCode로 HTTP 상태 코드 저장 (400, 500 등)
 * - retryable로 재시도 가능 여부 표시
 * - 예: 500 에러는 재시도 가능, 400 에러는 재시도 불가
 */
export class ApiError extends Error {
    /**
     * @param {string} message - 에러 메시지 (예: "OpenAI API 오류: ...")
     * @param {number} statusCode - HTTP 상태 코드 (예: 408, 500)
     * @param {boolean} retryable - 재시도 가능 여부 (true: 재시도, false: 즉시 실패)
     */
    constructor(message, statusCode, retryable = false) {
        super(message);  // 부모 클래스(Error)의 constructor 호출

        this.name = 'ApiError';       // 에러 이름
        this.statusCode = statusCode; // HTTP 상태 코드
        this.retryable = retryable;   // 재시도 가능 여부
    }
}

/**
 * ========================================
 * API 클라이언트 클래스
 * ========================================
 *
 * 외부 AI API를 호출하는 클래스
 * - GPT-4o-mini (OpenAI)
 * - Claude Haiku (Anthropic)
 * - Gemini Flash (Google)
 */
export class ApiClient {
    /**
     * ========================================
     * 생성자 (Constructor)
     * ========================================
     *
     * new ApiClient()로 객체를 만들 때 실행되는 함수
     *
     * @param {object} options - 설정 옵션 (생략 가능, 기본값 사용)
     * @param {number} options.timeout - 기본 타임아웃 (ms) - 폴백용
     * @param {number} options.maxRetries - 최대 재시도 횟수
     * @param {number} options.baseDelay - 재시도 초기 지연 시간 (ms)
     * @param {boolean} options.enableAdaptiveTimeout - 적응형 타임아웃 사용 여부
     */
    constructor(options = {}) {
        // ========================================
        // 기본 설정 저장
        // ========================================
        // || 연산자: options.timeout이 undefined면 30000 사용

        /**
         * 기본 타임아웃 (30초)
         * 적응형 타임아웃이 비활성화되었을 때 사용
         */
        this.timeout = options.timeout || 30000;

        /**
         * 최대 재시도 횟수 (3회)
         * API 에러 발생 시 최대 3번까지 재시도
         * 예: 1차 시도 실패 → 2차 시도 실패 → 3차 시도 실패 → 최종 실패
         */
        this.maxRetries = options.maxRetries || 3;

        /**
         * 재시도 초기 지연 시간 (1초)
         * Exponential Backoff의 기본값
         * - 1차 재시도: 1초 대기
         * - 2차 재시도: 2초 대기
         * - 3차 재시도: 4초 대기
         */
        this.baseDelay = options.baseDelay || 1000;

        // ========================================
        // 적응형 타임아웃 관리자 초기화
        // ========================================
        // 왜 기본 활성화?
        // - 대부분의 경우 적응형 타임아웃이 더 효율적
        // - 비활성화하려면 enableAdaptiveTimeout: false 명시

        /**
         * 적응형 타임아웃 활성화 여부
         * !== false: false가 아니면 모두 true (undefined도 true)
         */
        this.enableAdaptiveTimeout = options.enableAdaptiveTimeout !== false;

        /**
         * 적응형 타임아웃 관리자
         * - 엔드포인트별 응답 시간 학습
         * - 통계 기반 타임아웃 계산 (평균 + 2σ)
         * - 비활성화 시 null
         */
        this.timeoutManager = this.enableAdaptiveTimeout
            ? new AdaptiveTimeoutManager({
                minTimeout: 3000,      // 최소 타임아웃 (3초) - 너무 짧으면 안 됨
                maxTimeout: 30000,     // 최대 타임아웃 (30초) - 너무 길면 안 됨
                defaultTimeout: 15000  // 학습 전 기본 타임아웃 (15초)
              })
            : null;

        // ========================================
        // 저장된 히스토리 로드 (비동기)
        // ========================================
        // 왜 로드하나요?
        // - 이전에 학습한 응답 시간 데이터를 불러옴
        // - 프로그램 재시작해도 학습 데이터 유지
        //
        // 왜 .catch()를 쓰나요?
        // - 로드 실패해도 프로그램은 계속 진행
        // - 최악의 경우 defaultTimeout 사용
        if (this.timeoutManager) {
            this.timeoutManager.loadHistory().catch(err => {
                console.warn('[ApiClient] 타임아웃 히스토리 로드 실패:', err);
            });
        }
    }

    /**
     * ========================================
     * 타임아웃이 적용된 fetch (적응형)
     * ========================================
     *
     * 일반 fetch()의 문제점:
     * - 타임아웃 없음 (무한 대기 가능)
     * - 느린 API는 사용자를 계속 기다리게 함
     *
     * 해결책:
     * - AbortController로 타임아웃 구현
     * - 적응형 타임아웃으로 엔드포인트별 최적화
     *
     * 예시:
     * - api.openai.com: 평균 3초 → 타임아웃 5초
     * - api.anthropic.com: 평균 8초 → 타임아웃 12초
     *
     * @param {string} url - API URL (예: https://api.openai.com/v1/chat/completions)
     * @param {object} options - fetch 옵션 (method, headers, body 등)
     * @returns {Promise<Response>} HTTP 응답 객체
     */
    async fetchWithTimeout(url, options = {}) {
        // ========================================
        // AbortController 생성
        // ========================================
        // AbortController란?
        // - fetch()를 중간에 취소할 수 있게 해주는 객체
        // - controller.abort() 호출하면 fetch가 즉시 중단됨
        const controller = new AbortController();

        // ========================================
        // 엔드포인트별 동적 타임아웃 계산
        // ========================================
        // 왜 엔드포인트별로?
        // - OpenAI는 빠름 (평균 3초)
        // - Anthropic은 보통 (평균 8초)
        // - Gemini는 느림 (평균 12초)
        // → 각각 다른 타임아웃 적용

        // URL에서 도메인 추출 (예: api.openai.com)
        const endpoint = this.timeoutManager
            ? AdaptiveTimeoutManager.extractEndpoint(url)
            : 'default';

        // 학습된 통계로 타임아웃 계산 (평균 + 2σ)
        const dynamicTimeout = this.timeoutManager
            ? this.timeoutManager.getTimeout(endpoint)  // 엔드포인트별 최적 타임아웃
            : this.timeout;                              // 폴백: 고정 30초

        // ========================================
        // 타임아웃 타이머 설정
        // ========================================
        // dynamicTimeout 시간 후 자동으로 controller.abort() 실행
        const timeoutId = setTimeout(() => controller.abort(), dynamicTimeout);

        // 시작 시간 기록 (성능 측정용)
        const startTime = performance.now();

        try {
            // ========================================
            // fetch 실행
            // ========================================
            // ...options: 기존 옵션 복사
            // signal: controller.signal: abort 시그널 연결
            const response = await fetch(url, {
                ...options,
                signal: controller.signal  // 타임아웃 시 자동 중단
            });

            // ========================================
            // 성공: 타이머 해제
            // ========================================
            clearTimeout(timeoutId);  // 이미 완료되었으므로 타이머 제거

            // 응답 시간 계산 (밀리초)
            const responseTime = performance.now() - startTime;

            // ========================================
            // 성공한 요청만 응답 시간 기록
            // ========================================
            // 왜 성공한 것만?
            // - 실패(에러)한 요청은 통계에 포함하면 안 됨
            // - 평균을 왜곡시킴
            if (response.ok && this.timeoutManager) {
                this.timeoutManager.recordResponseTime(endpoint, responseTime);

                // ========================================
                // 주기적으로 히스토리 저장 (10% 확률)
                // ========================================
                // 왜 매번 저장 안 하나요?
                // - chrome.storage.local 쓰기는 느림
                // - 매번 저장하면 성능 저하
                // - 10%만 저장해도 충분히 보존됨
                if (Math.random() < 0.1) {  // 10% 확률
                    this.timeoutManager.saveHistory().catch(err => {
                        console.warn('[ApiClient] 히스토리 저장 실패:', err);
                    });
                }
            }

            return response;
        } catch (error) {
            // ========================================
            // 에러 처리
            // ========================================
            clearTimeout(timeoutId);  // 타이머 정리

            // AbortError: 타임아웃으로 중단됨
            if (error.name === 'AbortError') {
                const elapsed = performance.now() - startTime;
                throw new ApiError(
                    `요청 시간이 초과되었습니다 (${Math.round(dynamicTimeout)}ms). 잠시 후 다시 시도해주세요.`,
                    408,      // HTTP 408 Timeout
                    true      // 재시도 가능
                );
            }

            // 다른 에러 (네트워크 에러 등)
            throw error;
        }
    }

    /**
     * ========================================
     * 재시도 로직이 적용된 fetch
     * ========================================
     *
     * 왜 재시도가 필요한가요?
     * - AI API는 가끔 일시적으로 실패함
     * - 서버 과부하, 네트워크 불안정 등
     * - 한 번 실패해도 다시 시도하면 성공할 가능성 높음
     *
     * 재시도 전략:
     * 1. 최대 3회 재시도
     * 2. Exponential Backoff (점진적 지연 증가)
     *    - 1차 재시도: 1초 대기
     *    - 2차 재시도: 2초 대기
     *    - 3차 재시도: 4초 대기
     * 3. 재시도 불가능한 에러는 즉시 실패 (400 Bad Request 등)
     *
     * @param {string} url - API URL
     * @param {object} options - fetch 옵션
     * @returns {Promise<Response>} HTTP 응답 객체
     */
    async fetchWithRetry(url, options = {}) {
        // 마지막 에러를 저장 (모든 재시도 실패 시 던질 에러)
        let lastError;

        // ========================================
        // for 루프로 재시도 구현
        // ========================================
        // attempt = 0: 첫 시도
        // attempt = 1: 1차 재시도
        // attempt = 2: 2차 재시도
        // attempt = 3: 3차 재시도 (maxRetries = 3인 경우)
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                // ========================================
                // fetch 시도
                // ========================================
                const response = await this.fetchWithTimeout(url, options);

                // ========================================
                // 응답 상태 코드 확인
                // ========================================
                // HTTP 500, 408, 429 등은 재시도 가능
                if (this.isRetryableStatus(response.status)) {
                    if (attempt < this.maxRetries) {
                        console.warn(`[ApiClient] 재시도 가능한 응답 (${response.status}), 재시도 ${attempt + 1}/${this.maxRetries}`);
                        await this.delay(this.calculateDelay(attempt));
                        continue;  // 다음 루프로 (재시도)
                    }
                }

                // 성공 또는 재시도 불가능한 에러 → 반환
                return response;

            } catch (error) {
                lastError = error;

                // ========================================
                // 케이스 1: ApiError (타임아웃 등)
                // ========================================
                // error.retryable이 true인 경우만 재시도
                if (error instanceof ApiError && error.retryable && attempt < this.maxRetries) {
                    console.warn(`[ApiClient] 재시도 가능한 에러, 재시도 ${attempt + 1}/${this.maxRetries}:`, error.message);
                    await this.delay(this.calculateDelay(attempt));
                    continue;  // 재시도
                }

                // ========================================
                // 케이스 2: 네트워크 에러 (TypeError)
                // ========================================
                // fetch()가 네트워크 에러 시 TypeError 던짐
                // 예: 인터넷 끊김, DNS 실패 등
                if (error.name === 'TypeError' && attempt < this.maxRetries) {
                    console.warn(`[ApiClient] 네트워크 에러, 재시도 ${attempt + 1}/${this.maxRetries}:`, error.message);
                    await this.delay(this.calculateDelay(attempt));
                    continue;  // 재시도
                }

                // ========================================
                // 케이스 3: 재시도 불가능한 에러
                // ========================================
                // 예: 400 Bad Request, 401 Unauthorized
                // 재시도해도 성공할 수 없으므로 즉시 실패
                throw error;
            }
        }

        // ========================================
        // 모든 재시도 실패
        // ========================================
        throw lastError || new Error('알 수 없는 오류가 발생했습니다.');
    }

    /**
     * ========================================
     * 재시도 가능한 HTTP 상태 코드 확인
     * ========================================
     *
     * HTTP 상태 코드 분류:
     *
     * 재시도 가능 (일시적 에러):
     * - 5xx: 서버 에러 (서버 과부하, 일시적 장애)
     * - 408: Request Timeout (요청 시간 초과)
     * - 429: Too Many Requests (Rate Limit, 잠시 후 가능)
     *
     * 재시도 불가능 (영구적 에러):
     * - 4xx: 클라이언트 에러 (잘못된 요청, 인증 실패 등)
     * - 예: 400 Bad Request, 401 Unauthorized, 404 Not Found
     *
     * @param {number} status - HTTP 상태 코드 (예: 500, 408)
     * @returns {boolean} 재시도 가능 여부 (true: 재시도, false: 즉시 실패)
     */
    isRetryableStatus(status) {
        // 5xx 서버 에러, 408 타임아웃, 429 Rate Limit
        return status >= 500 || status === 408 || status === 429;
    }

    /**
     * ========================================
     * Exponential Backoff 지연 시간 계산
     * ========================================
     *
     * Exponential Backoff란?
     * - 재시도 간격을 점진적으로 늘리는 알고리즘
     * - 서버 부하를 줄이고 성공 확률 높임
     *
     * 계산 공식:
     * delay = 2^attempt × baseDelay + jitter
     *
     * 예시 (baseDelay = 1000ms):
     * - attempt 0: 2^0 × 1000 + jitter = 1000ms + 랜덤(0~1000ms) = 1000~2000ms
     * - attempt 1: 2^1 × 1000 + jitter = 2000ms + 랜덤(0~1000ms) = 2000~3000ms
     * - attempt 2: 2^2 × 1000 + jitter = 4000ms + 랜덤(0~1000ms) = 4000~5000ms
     * - attempt 3: 2^3 × 1000 + jitter = 8000ms + 랜덤(0~1000ms) = 8000~9000ms (최대 10초 제한)
     *
     * 왜 jitter(랜덤값)를 더하나요?
     * - 여러 클라이언트가 동시에 재시도하면 서버 부하 증가
     * - 랜덤값으로 요청 시간을 분산
     *
     * @param {number} attempt - 시도 횟수 (0부터 시작)
     * @returns {number} 지연 시간 (ms)
     */
    calculateDelay(attempt) {
        // 2^attempt × baseDelay
        // Math.pow(2, attempt): 2의 attempt 제곱
        // 예: attempt = 2 → 2^2 = 4
        const exponentialDelay = Math.pow(2, attempt) * this.baseDelay;

        // 랜덤 jitter (0~1000ms)
        const jitter = Math.random() * 1000;

        // 최종 지연 시간 (최대 10초 제한)
        return Math.min(exponentialDelay + jitter, 10000);
    }

    /**
     * ========================================
     * 지연 함수 (Promise)
     * ========================================
     *
     * setTimeout을 Promise로 감싸서 await 가능하게 만듦
     *
     * 왜 Promise를 쓰나요?
     * - setTimeout은 콜백 방식
     * - async/await와 함께 쓰려면 Promise로 변환 필요
     *
     * 사용 예시:
     * await this.delay(2000);  // 2초 대기
     * console.log('2초 후 실행');
     *
     * @param {number} ms - 지연 시간 (ms)
     * @returns {Promise<void>} ms 후에 resolve되는 Promise
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 타임아웃 통계 조회
     * @returns {object} 전체 통계
     */
    getTimeoutStats() {
        if (!this.timeoutManager) {
            return { enabled: false };
        }

        return {
            enabled: true,
            endpoints: this.timeoutManager.getAllStats()
        };
    }

    /**
     * 특정 엔드포인트 통계 조회
     * @param {string} url - URL
     * @returns {object|null} 엔드포인트 통계
     */
    getEndpointStats(url) {
        if (!this.timeoutManager) {
            return null;
        }

        const endpoint = AdaptiveTimeoutManager.extractEndpoint(url);
        return this.timeoutManager.getStats(endpoint);
    }

    /**
     * GPT-4o-mini API 호출
     * @param {string} apiKey - API 키
     * @param {string} imageData - 이미지 데이터 (URL or Base64)
     * @returns {Promise<object>}
     */
    async callGpt4oMini(apiKey, imageData) {
        const requestBody = {
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: AI_ANALYSIS_PROMPT },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Analyze this image:' },
                        {
                            type: 'image_url',
                            image_url: { url: imageData }
                        }
                    ]
                }
            ],
            max_tokens: 500,
            response_format: { type: 'json_object' }
        };

        const response = await this.fetchWithRetry('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMessage = errorData.error?.message || '알 수 없는 오류';
            throw new ApiError(
                `OpenAI API 오류: ${errorMessage}`,
                response.status,
                this.isRetryableStatus(response.status)
            );
        }

        const result = await response.json();
        return JSON.parse(result.choices[0].message.content);
    }

    /**
     * Claude Haiku API 호출
     * @param {string} apiKey - API 키
     * @param {string} imageData - 이미지 데이터 (URL or Base64)
     * @param {boolean} isDcImage - 디시인사이드 이미지 여부
     * @returns {Promise<object>}
     */
    async callClaudeHaiku(apiKey, imageData, isDcImage) {
        let imageContent;

        if (isDcImage) {
            // Base64 데이터에서 prefix 제거
            const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData;
            imageContent = {
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: base64Data
                }
            };
        } else {
            imageContent = {
                type: 'image',
                source: {
                    type: 'url',
                    url: imageData
                }
            };
        }

        const response = await this.fetchWithRetry('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-5-haiku-20241022',
                max_tokens: 1024,
                messages: [
                    {
                        role: 'user',
                        content: [
                            imageContent,
                            { type: 'text', text: AI_ANALYSIS_PROMPT + '\n\nAnalyze this image:' }
                        ]
                    }
                ]
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new ApiError(
                `Claude API 오류: ${errorData.error?.message || '알 수 없는 오류'}`,
                response.status,
                this.isRetryableStatus(response.status)
            );
        }

        const result = await response.json();
        return JSON.parse(result.content[0].text);
    }

    /**
     * Gemini Flash API 호출
     * @param {string} apiKey - API 키
     * @param {string} imageData - 이미지 데이터 (URL or Base64)
     * @param {boolean} isDcImage - 디시인사이드 이미지 여부
     * @returns {Promise<object>}
     */
    async callGeminiFlash(apiKey, imageData, isDcImage) {
        let imagePart;

        if (isDcImage) {
            // Base64 데이터에서 prefix 제거
            const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData;
            imagePart = {
                inline_data: {
                    mime_type: 'image/jpeg',
                    data: base64Data
                }
            };
        } else {
            imagePart = {
                fileData: {
                    mimeType: 'image/jpeg',
                    fileUri: imageData
                }
            };
        }

        const response = await this.fetchWithRetry(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [
                                { text: AI_ANALYSIS_PROMPT + '\n\nAnalyze this image:' },
                                imagePart
                            ]
                        }
                    ],
                    generationConfig: {
                        responseMimeType: 'application/json'
                    }
                })
            }
        );

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new ApiError(
                `Gemini API 오류: ${errorData.error?.message || '알 수 없는 오류'}`,
                response.status,
                this.isRetryableStatus(response.status)
            );
        }

        const result = await response.json();
        return JSON.parse(result.candidates[0].content.parts[0].text);
    }
}
