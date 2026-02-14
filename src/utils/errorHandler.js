/**
 * 에러 핸들러
 * @author 최진호
 * @date 2026-01-31
 * @version 1.0.0
 */

import { ERROR_CODES } from './constants.js';

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
 * 에러 로거
 * @param {string} context - 에러 발생 컨텍스트
 * @param {Error} error - 에러 객체
 * @param {boolean} debugMode - 디버그 모드 여부
 */
export function logError(context, error, debugMode = false) {
    const timestamp = new Date().toISOString();
    const errorInfo = {
        timestamp,
        context,
        name:    error.name,
        message: error.message,
        code:    error.code || 'UNKNOWN'
    };

    if (debugMode) {
        console.error('[Kas-Free Error]', errorInfo);
        console.error(error.stack);
    } else {
        console.error(`[Kas-Free] ${context}: ${error.message}`);
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
