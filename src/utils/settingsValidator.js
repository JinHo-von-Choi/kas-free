/**
 * ========================================
 * 설정값 범위 검증 모듈
 * ========================================
 *
 * 역할:
 * - 사용자 입력 설정값을 안전한 범위로 제한
 * - 잘못된 값으로 인한 크래시 방지
 * - 타입 검증 및 범위 검증
 *
 * 왜 필요한가요?
 * - 사용자가 임계값에 음수를 입력하면 모든 이미지가 차단됨
 * - 민감도를 100으로 설정하면 메모리 오버플로우 가능
 * - API 우선순위가 음수면 예측 불가능한 동작
 *
 * 실생활 비유:
 * "온도 조절기:
 *  - 사용자가 온도를 1000도로 설정하려 하면
 *  - 최대값인 30도로 자동 제한
 *  - 안전 범위 내에서만 작동"
 *
 * @author 최진호
 * @date 2026-02-26
 * @version 1.0.0
 */

import { DEFAULT_SETTINGS } from './constants.js';

/**
 * ========================================
 * 설정값 검증 (메인 함수)
 * ========================================
 *
 * @param {object} settings - 검증할 설정
 * @returns {object} 검증된 설정
 */
export function validateSettings(settings) {
    // null/undefined 입력 방어
    if (!settings || typeof settings !== 'object') {
        return { ...DEFAULT_SETTINGS };
    }

    // 기본값과 병합 (누락된 필드 보완)
    const validated = { ...DEFAULT_SETTINGS };

    // 1. Boolean 값 검증
    validated.enabled             = validateBoolean(settings.enabled, true);
    validated.autoScan            = validateBoolean(settings.autoScan, true);
    validated.onlyWithThumbnail   = validateBoolean(settings.onlyWithThumbnail, true);
    validated.autoHideDanger      = validateBoolean(settings.autoHideDanger, false);
    validated.cacheEnabled        = validateBoolean(settings.cacheEnabled, true);
    validated.debugMode           = validateBoolean(settings.debugMode, false);

    // 2. 숫자 값 검증
    validated.cacheDuration       = validatePositiveNumber(settings.cacheDuration, 24 * 60 * 60 * 1000);

    // 3. 임계값 검증 (0-1 범위)
    validated.thresholds          = validateThresholds(settings.thresholds);

    // 4. 민감도 검증 (0-1 범위)
    validated.sensitivity         = validateSensitivity(settings.sensitivity);

    // 5. API 설정 검증
    validated.apis                = validateApis(settings.apis);

    return validated;
}

/**
 * ========================================
 * Boolean 값 검증
 * ========================================
 */
function validateBoolean(value, defaultValue) {
    if (typeof value === 'boolean') {
        return value;
    }
    return defaultValue;
}

/**
 * ========================================
 * 양수 검증
 * ========================================
 */
function validatePositiveNumber(value, defaultValue) {
    const num = Number(value);
    if (isNaN(num) || num <= 0) {
        return defaultValue;
    }
    return num;
}

/**
 * ========================================
 * 임계값 검증
 * ========================================
 *
 * 규칙:
 * 1. 0-1 범위로 제한
 * 2. safeMax < cautionMax 보장
 *
 * @param {object} thresholds - 임계값
 * @returns {object} 검증된 임계값
 */
function validateThresholds(thresholds) {
    if (!thresholds || typeof thresholds !== 'object') {
        return DEFAULT_SETTINGS.thresholds;
    }

    // 범위 검증 (0-1)
    let safeMax = clamp01(thresholds.safeMax ?? 0.3);
    let cautionMax = clamp01(thresholds.cautionMax ?? 0.6);

    // safeMax < cautionMax 보장
    if (safeMax >= cautionMax) {
        // safeMax가 너무 크면 cautionMax를 증가
        if (safeMax < 0.9) {
            cautionMax = Math.min(safeMax + 0.1, 1.0);
        } else {
            // safeMax가 0.9 이상이면 safeMax를 감소
            safeMax = Math.max(cautionMax - 0.1, 0);
        }
    }

    return {
        safeMax,
        cautionMax
    };
}

/**
 * ========================================
 * 민감도 검증
 * ========================================
 *
 * 규칙:
 * - 각 카테고리별 0-1 범위로 제한
 *
 * @param {object} sensitivity - 민감도
 * @returns {object} 검증된 민감도
 */
function validateSensitivity(sensitivity) {
    const defaultSensitivity = DEFAULT_SETTINGS.sensitivity;

    if (!sensitivity || typeof sensitivity !== 'object') {
        return defaultSensitivity;
    }

    const validated = {};

    for (const [category, defaultValue] of Object.entries(defaultSensitivity)) {
        const value = sensitivity[category];
        validated[category] = clamp01(value ?? defaultValue);
    }

    return validated;
}

/**
 * ========================================
 * API 설정 검증
 * ========================================
 *
 * 규칙:
 * 1. enabled는 Boolean
 * 2. apiKey는 문자열
 * 3. priority는 0-100 범위
 *
 * @param {object} apis - API 설정
 * @returns {object} 검증된 API 설정
 */
function validateApis(apis) {
    const defaultApis = DEFAULT_SETTINGS.apis;

    if (!apis || typeof apis !== 'object') {
        return defaultApis;
    }

    const validated = {};

    for (const [apiName, defaultConfig] of Object.entries(defaultApis)) {
        const config = apis[apiName];

        if (!config || typeof config !== 'object') {
            validated[apiName] = defaultConfig;
            continue;
        }

        validated[apiName] = {
            enabled: validateBoolean(config.enabled, false),
            apiKey: String(config.apiKey || ''),
            priority: clamp(config.priority ?? defaultConfig.priority, 0, 100)
        };
    }

    return validated;
}

/**
 * ========================================
 * 값을 0-1 범위로 제한
 * ========================================
 */
function clamp01(value) {
    return clamp(value, 0, 1);
}

/**
 * ========================================
 * 값을 min-max 범위로 제한
 * ========================================
 *
 * @param {number} value - 제한할 값
 * @param {number} min - 최소값
 * @param {number} max - 최대값
 * @returns {number} 제한된 값
 */
function clamp(value, min, max) {
    const num = Number(value);

    // NaN이거나 숫자가 아니면 중간값 반환
    if (isNaN(num)) {
        return (min + max) / 2;
    }

    return Math.max(min, Math.min(max, num));
}

/**
 * ========================================
 * 설정값 무결성 검사
 * ========================================
 *
 * 검증 후에도 논리적 모순이 있는지 최종 확인
 *
 * @param {object} settings - 검증된 설정
 * @returns {object} 최종 검증된 설정
 */
export function ensureSettingsIntegrity(settings) {
    const validated = { ...settings };

    // 1. 임계값 논리 검증
    if (validated.thresholds.safeMax >= validated.thresholds.cautionMax) {
        console.warn('[Kas-Free] 임계값 모순 감지. 자동 수정 중...');
        validated.thresholds = validateThresholds(validated.thresholds);
    }

    // 2. 캐시 비활성화 시 cacheDuration 무효화
    if (!validated.cacheEnabled) {
        validated.cacheDuration = 0;
    }

    // 3. 디버그 모드 프로덕션 제한
    const IS_PRODUCTION = !chrome.runtime.getManifest().update_url?.includes('localhost');
    if (IS_PRODUCTION && validated.debugMode) {
        console.warn('[Kas-Free] 프로덕션 환경에서는 디버그 모드를 비활성화합니다.');
        validated.debugMode = false;
    }

    return validated;
}

/**
 * ========================================
 * 설정값 타입 검증 (TypeScript 대용)
 * ========================================
 *
 * @param {any} value - 검증할 값
 * @param {string} expectedType - 예상 타입
 * @param {string} fieldName - 필드 이름 (에러 메시지용)
 * @returns {boolean} 타입 일치 여부
 */
export function validateType(value, expectedType, fieldName) {
    const actualType = typeof value;

    if (actualType !== expectedType) {
        console.warn(
            `[Kas-Free] 타입 불일치: ${fieldName}은(는) ${expectedType}이어야 하지만 ${actualType}입니다.`
        );
        return false;
    }

    return true;
}
