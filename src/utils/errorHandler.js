/**
 * 에러 핸들러
 * @author 최진호
 * @date 2026-01-31
 * @version 1.0.0
 * @modified 2026-02-26 (민감정보 보호 추가)
 */

import { ERROR_CODES } from './constants.js';

/**
 * 프로덕션 환경 여부
 */
const IS_PRODUCTION = !chrome.runtime.getManifest().update_url?.includes('localhost');

/**
 * API 에러 클래스
 */
export class ApiError extends Error {
    /**
     * @param {string} message - 에러 메시지
     * @param {string|number} code - 에러 코드
     * @param {string} apiName - API 이름
     */
    constructor(message, code, apiName) {
        super(message);
        this.name    = 'ApiError';
        this.code    = code;
        this.apiName = apiName;
    }

    /**
     * 재시도 가능한 에러인지 확인
     * @returns {boolean}
     */
    isRetryable() {
        return this.code === ERROR_CODES.RATE_LIMIT ||
               this.code === ERROR_CODES.TIMEOUT ||
               this.code === ERROR_CODES.NETWORK_ERROR;
    }

    /**
     * 폴백이 필요한 에러인지 확인
     * @returns {boolean}
     */
    needsFallback() {
        return this.code === ERROR_CODES.RATE_LIMIT ||
               this.code === ERROR_CODES.INSUFFICIENT_FUNDS ||
               this.code === ERROR_CODES.UNAUTHORIZED ||
               this.code === ERROR_CODES.TIMEOUT ||
               this.code === ERROR_CODES.NETWORK_ERROR;
    }
}

/**
 * 분석 에러 클래스
 */
export class AnalysisError extends Error {
    /**
     * @param {string} message - 에러 메시지
     * @param {string} code - 에러 코드
     */
    constructor(message, code) {
        super(message);
        this.name = 'AnalysisError';
        this.code = code;
    }
}

/**
 * 에러 로거 (민감정보 보호)
 * @param {string} context - 에러 발생 컨텍스트
 * @param {Error} error - 에러 객체
 * @param {boolean} debugMode - 디버그 모드 여부
 */
export function logError(context, error, debugMode = false) {
    const timestamp = new Date().toISOString();

    // 프로덕션 환경에서는 민감정보 제거
    const sanitizedMessage = IS_PRODUCTION
        ? sanitizeErrorMessage(error.message)
        : error.message;

    const errorInfo = {
        timestamp,
        context,
        name:    error.name,
        message: sanitizedMessage,
        code:    error.code || 'UNKNOWN'
    };

    // 디버그 모드이고 개발 환경인 경우에만 상세 로그
    if (debugMode && !IS_PRODUCTION) {
        console.error('[Kas-Free Error]', errorInfo);
        console.error('[Stack Trace]', error.stack);

        // 추가 정보가 있으면 출력
        if (error.details) {
            console.error('[Details]', error.details);
        }
    } else {
        // 프로덕션 또는 일반 모드: 간단한 메시지만
        console.error(`[Kas-Free] ${context}: ${sanitizedMessage}`);
    }

    return errorInfo;
}

/**
 * HTTP 응답 에러를 처리한다
 * @param {Response} response - fetch 응답 객체
 * @param {string} apiName - API 이름
 * @throws {ApiError}
 */
export async function handleHttpError(response, apiName) {
    const status = response.status;
    let message  = '';

    switch (status) {
        case 400:
            message = '잘못된 요청입니다.';
            break;
        case 401:
            message = 'API 키를 확인해주세요.';
            break;
        case 402:
            message = 'API 잔액이 부족합니다.';
            break;
        case 403:
            message = '접근이 거부되었습니다.';
            break;
        case 404:
            message = '요청한 리소스를 찾을 수 없습니다.';
            break;
        case 429:
            message = '요청 한도를 초과했습니다.';
            break;
        case 500:
        case 502:
        case 503:
            message = 'API 서버 오류가 발생했습니다.';
            break;
        default:
            message = `HTTP 오류: ${status}`;
    }

    throw new ApiError(message, status, apiName);
}

/**
 * 타임아웃이 있는 fetch를 수행한다
 * @param {string} url - 요청 URL
 * @param {object} options - fetch 옵션
 * @param {number} timeout - 타임아웃 (ms)
 * @param {string} apiName - API 이름
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(url, options, timeout, apiName) {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
            throw new ApiError('요청 시간이 초과되었습니다.', ERROR_CODES.TIMEOUT, apiName);
        }

        throw new ApiError(
            '네트워크 오류가 발생했습니다.',
            ERROR_CODES.NETWORK_ERROR,
            apiName
        );
    }
}

/**
 * 에러 메시지를 사용자 친화적으로 변환한다
 * @param {Error} error - 에러 객체
 * @returns {string}
 */
export function getErrorMessage(error) {
    if (error instanceof ApiError) {
        return `[${error.apiName}] ${error.message}`;
    }

    if (error instanceof AnalysisError) {
        return error.message;
    }

    return error.message || '알 수 없는 오류가 발생했습니다.';
}

/**
 * ========================================
 * 민감정보 보호 함수들
 * ========================================
 */

/**
 * 민감정보 마스킹
 * @param {any} data - 마스킹할 데이터
 * @returns {string} 마스킹된 문자열
 */
export function maskSensitiveData(data) {
    if (data === null || data === undefined) {
        return '***';
    }

    const str = String(data);

    // 1. URL 마스킹
    if (str.startsWith('http://') || str.startsWith('https://')) {
        try {
            const url = new URL(str);
            const path = url.pathname;
            const maskedPath = path.length > 8 ? `***${path.slice(-8)}` : path;
            return `${url.origin}${maskedPath}`;
        } catch {
            return '***';
        }
    }

    // 2. API 키 마스킹 (10자 이상)
    if (str.length >= 10) {
        // 특정 패턴 감지 (sk-, AIza, etc.)
        if (str.match(/^(sk-|AIza|gsk_|claude-|xai-)/)) {
            return `${str.slice(0, 6)}***${str.slice(-4)}`;
        }

        // 일반적인 긴 문자열 (API 키일 가능성)
        if (str.length > 20) {
            return `${str.slice(0, 4)}***${str.slice(-4)}`;
        }
    }

    // 3. 이메일 마스킹
    if (str.includes('@') && str.includes('.')) {
        const [local, domain] = str.split('@');
        const maskedLocal = local.length > 2
            ? `${local[0]}***${local.slice(-1)}`
            : '***';
        return `${maskedLocal}@${domain}`;
    }

    // 4. 짧은 문자열은 그대로
    return str;
}

/**
 * 에러 메시지에서 민감정보 제거
 * @param {string} message - 원본 메시지
 * @returns {string} 정제된 메시지
 */
function sanitizeErrorMessage(message) {
    if (!message) return '오류가 발생했습니다.';

    let sanitized = message;

    // 1. URL 제거
    sanitized = sanitized.replace(/https?:\/\/[^\s]+/g, '[URL]');

    // 2. API 키 패턴 제거
    sanitized = sanitized.replace(/sk-[a-zA-Z0-9]+/g, '[API_KEY]');
    sanitized = sanitized.replace(/AIza[a-zA-Z0-9_-]+/g, '[API_KEY]');
    sanitized = sanitized.replace(/gsk_[a-zA-Z0-9]+/g, '[API_KEY]');

    // 3. 이메일 제거
    sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');

    // 4. 파일 경로 제거 (Windows/Unix)
    sanitized = sanitized.replace(/[A-Za-z]:[\\\/][^\s]+/g, '[PATH]');
    sanitized = sanitized.replace(/\/[a-zA-Z0-9_\-\/]+\.[a-zA-Z0-9]+/g, '[PATH]');

    return sanitized;
}

/**
 * 사용자 친화적 에러 메시지 생성
 * @param {Error} error - 에러 객체
 * @returns {string} 사용자 친화적 메시지
 */
export function getUserFriendlyMessage(error) {
    const errorCode = error.code || error.name;

    const messages = {
        // 네트워크 에러
        'NETWORK_ERROR': '네트워크 연결을 확인해주세요.',
        'NetworkError': '네트워크 연결을 확인해주세요.',

        // 타임아웃
        'TIMEOUT': '요청 시간이 초과되었습니다. 다시 시도해주세요.',
        'TimeoutError': '요청 시간이 초과되었습니다. 다시 시도해주세요.',

        // API 에러 (문자열 코드)
        'UNAUTHORIZED': 'API 키를 확인해주세요.',
        'ApiKeyError': 'API 키를 확인해주세요.',
        'INSUFFICIENT_FUNDS': 'API 잔액이 부족합니다.',
        'RATE_LIMIT': '요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.',

        // API 에러 (HTTP 숫자 코드)
        401: 'API 키를 확인해주세요.',
        402: 'API 잔액이 부족합니다.',
        429: '요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.',

        // 데이터베이스 에러
        'IndexedDBError': '로컬 저장소 오류. 캐시를 삭제해보세요.',
        'QuotaExceededError': '저장 공간이 부족합니다. 캐시를 정리해주세요.',

        // 메모리 에러
        'OutOfMemoryError': '메모리 부족. 브라우저를 재시작해주세요.',

        // 검증 에러
        'ValidationError': '입력값을 확인해주세요.',
        'VALIDATION_ERROR': '입력값을 확인해주세요.',

        // Service Worker 에러
        'ServiceWorkerError': '확장 프로그램을 다시 시작해주세요.'
    };

    return messages[errorCode] || '알 수 없는 오류가 발생했습니다.';
}

/**
 * ========================================
 * 추가 에러 클래스들
 * ========================================
 */

/**
 * 검증 에러 클래스
 */
export class ValidationError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'ValidationError';
        this.code = 'VALIDATION_ERROR';
        this.details = details;
    }
}

/**
 * 타임아웃 에러 클래스
 */
export class TimeoutError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'TimeoutError';
        this.code = 'TIMEOUT';
        this.details = details;
    }

    needsFallback() {
        return true;
    }
}

/**
 * 네트워크 에러 클래스
 */
export class NetworkError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NetworkError';
        this.code = 'NETWORK_ERROR';
    }

    needsFallback() {
        return true;
    }
}
