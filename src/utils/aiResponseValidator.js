/**
 * AI API 응답 검증
 * @author 최진호
 * @date 2026-02-26
 * @version 1.0.0
 * @remarks AI API 응답 스키마 검증 및 데이터 정규화
 */

/**
 * ========================================
 * AI 응답 스키마 정의
 * ========================================
 *
 * 모든 AI API (GPT-4o-mini, Claude Haiku, Gemini Flash)는
 * 동일한 스키마로 응답해야 합니다.
 */

/** 필수 카테고리 목록 */
const REQUIRED_CATEGORIES = [
    'gore',
    'violence',
    'death',
    'disturbing',
    'insects',
    'medical',
    'shock',
    'animal_cruelty',
    'nsfw_porn',
    'nsfw_sexy'
];

/** 허용된 Action 값 */
const VALID_ACTIONS = ['block', 'warn', 'pass'];

/**
 * ========================================
 * 응답 검증 함수
 * ========================================
 *
 * AI API 응답이 올바른 형식인지 검증합니다.
 *
 * 검증 항목:
 * 1. 필수 필드 존재 여부
 * 2. 데이터 타입 확인
 * 3. 범위 검증 (0-1, 1-5 등)
 * 4. Enum 값 검증
 *
 * @param {any} response - AI API 응답
 * @returns {object} { valid: boolean, errors: string[], data: object }
 */
export function validateAIResponse(response) {
    const errors = [];

    // 1. null/undefined 체크
    if (!response || typeof response !== 'object') {
        return {
            valid: false,
            errors: ['AI 응답이 null 또는 객체가 아닙니다.'],
            data: null
        };
    }

    // 2. scores 필드 검증
    if (!response.scores || typeof response.scores !== 'object') {
        errors.push('scores 필드가 없거나 객체가 아닙니다.');
    } else {
        // 2-1. 필수 카테고리 존재 여부
        for (const category of REQUIRED_CATEGORIES) {
            if (!(category in response.scores)) {
                errors.push(`scores.${category} 필드가 누락되었습니다.`);
            } else {
                // 2-2. 점수 범위 검증 (0-1)
                const score = response.scores[category];
                if (typeof score !== 'number' || score < 0 || score > 1) {
                    errors.push(`scores.${category}는 0-1 범위의 숫자여야 합니다. (현재: ${score})`);
                }
            }
        }
    }

    // 3. is_harmful 필드 검증
    if (typeof response.is_harmful !== 'boolean') {
        errors.push(`is_harmful는 boolean이어야 합니다. (현재: ${typeof response.is_harmful})`);
    }

    // 4. suggested_severity 필드 검증 (1-5)
    if (typeof response.suggested_severity !== 'number' ||
        response.suggested_severity < 1 ||
        response.suggested_severity > 5 ||
        !Number.isInteger(response.suggested_severity)) {
        errors.push(
            `suggested_severity는 1-5 범위의 정수여야 합니다. (현재: ${response.suggested_severity})`
        );
    }

    // 5. suggestedAction 필드 검증
    if (!VALID_ACTIONS.includes(response.suggestedAction)) {
        errors.push(
            `suggestedAction은 "block", "warn", "pass" 중 하나여야 합니다. (현재: ${response.suggestedAction})`
        );
    }

    // 6. final_score 필드 검증 (0-1)
    if (typeof response.final_score !== 'number' ||
        response.final_score < 0 ||
        response.final_score > 1) {
        errors.push(
            `final_score는 0-1 범위의 숫자여야 합니다. (현재: ${response.final_score})`
        );
    }

    // 7. description 필드 검증
    if (typeof response.description !== 'string') {
        errors.push(`description은 문자열이어야 합니다. (현재: ${typeof response.description})`);
    }

    // 8. reasoning 필드 검증
    if (typeof response.reasoning !== 'string') {
        errors.push(`reasoning은 문자열이어야 합니다. (현재: ${typeof response.reasoning})`);
    }

    // 검증 결과 반환
    return {
        valid: errors.length === 0,
        errors: errors,
        data: errors.length === 0 ? response : null
    };
}

/**
 * ========================================
 * 응답 정규화 함수
 * ========================================
 *
 * 잘못된 응답을 자동 수정합니다.
 *
 * 수정 규칙:
 * 1. 범위 초과 점수 → 클램핑 (0-1 또는 1-5)
 * 2. 누락된 필수 필드 → 기본값 설정
 * 3. 잘못된 타입 → 타입 변환 시도
 *
 * @param {any} response - AI API 응답
 * @returns {object} 정규화된 응답
 */
export function normalizeAIResponse(response) {
    if (!response || typeof response !== 'object') {
        return getDefaultResponse();
    }

    const normalized = {};

    // 1. scores 정규화
    normalized.scores = {};
    for (const category of REQUIRED_CATEGORIES) {
        const score = response.scores?.[category];

        if (typeof score === 'number') {
            // 범위 클램핑 (0-1)
            normalized.scores[category] = Math.max(0, Math.min(1, score));
        } else if (typeof score === 'string') {
            // 문자열 → 숫자 변환 시도
            const parsed = parseFloat(score);
            normalized.scores[category] = isNaN(parsed) ? 0 : Math.max(0, Math.min(1, parsed));
        } else {
            // 기본값
            normalized.scores[category] = 0;
        }
    }

    // 2. is_harmful 정규화
    if (typeof response.is_harmful === 'boolean') {
        normalized.is_harmful = response.is_harmful;
    } else if (typeof response.is_harmful === 'string') {
        normalized.is_harmful = response.is_harmful === 'true';
    } else {
        // final_score 기반 추정
        normalized.is_harmful = (response.final_score || 0) >= 0.7;
    }

    // 3. suggested_severity 정규화 (1-5)
    if (typeof response.suggested_severity === 'number') {
        normalized.suggested_severity = Math.max(1, Math.min(5, Math.round(response.suggested_severity)));
    } else if (typeof response.suggested_severity === 'string') {
        const parsed = parseInt(response.suggested_severity, 10);
        normalized.suggested_severity = isNaN(parsed) ? 3 : Math.max(1, Math.min(5, parsed));
    } else {
        // final_score 기반 추정 (0-1 → 1-5)
        const finalScore = response.final_score || 0;
        normalized.suggested_severity = Math.max(1, Math.min(5, Math.ceil(finalScore * 5)));
    }

    // 4. suggestedAction 정규화
    if (VALID_ACTIONS.includes(response.suggestedAction)) {
        normalized.suggestedAction = response.suggestedAction;
    } else {
        // final_score 기반 추정
        const finalScore = response.final_score || 0;
        if (finalScore >= 0.7) {
            normalized.suggestedAction = 'block';
        } else if (finalScore >= 0.4) {
            normalized.suggestedAction = 'warn';
        } else {
            normalized.suggestedAction = 'pass';
        }
    }

    // 5. final_score 정규화 (0-1)
    if (typeof response.final_score === 'number') {
        normalized.final_score = Math.max(0, Math.min(1, response.final_score));
    } else if (typeof response.final_score === 'string') {
        const parsed = parseFloat(response.final_score);
        normalized.final_score = isNaN(parsed) ? 0 : Math.max(0, Math.min(1, parsed));
    } else {
        // scores의 최대값으로 추정
        const maxScore = Math.max(...Object.values(normalized.scores));
        normalized.final_score = maxScore;
    }

    // 6. description 정규화
    if (typeof response.description === 'string') {
        normalized.description = response.description.trim();
    } else {
        normalized.description = '설명 없음';
    }

    // 7. reasoning 정규화
    if (typeof response.reasoning === 'string') {
        normalized.reasoning = response.reasoning.trim();
    } else {
        normalized.reasoning = '판단 근거 없음';
    }

    return normalized;
}

/**
 * ========================================
 * 검증 및 정규화 (통합 함수)
 * ========================================
 *
 * 응답을 검증하고, 실패 시 정규화를 시도합니다.
 *
 * 사용 예:
 * ```javascript
 * const result = validateAndNormalizeAIResponse(apiResponse);
 * if (!result.valid) {
 *     console.warn('AI 응답 검증 실패:', result.errors);
 *     console.log('정규화된 응답 사용:', result.data);
 * }
 * ```
 *
 * @param {any} response - AI API 응답
 * @returns {object} { valid: boolean, errors: string[], data: object, normalized: boolean }
 */
export function validateAndNormalizeAIResponse(response) {
    // 1. 검증
    const validation = validateAIResponse(response);

    if (validation.valid) {
        return {
            valid: true,
            errors: [],
            data: validation.data,
            normalized: false
        };
    }

    // 2. 검증 실패 → 정규화 시도
    console.warn('[AI Response Validator] 응답 검증 실패, 정규화 시도:', validation.errors);

    const normalized = normalizeAIResponse(response);

    // 3. 정규화된 응답 재검증
    const revalidation = validateAIResponse(normalized);

    if (revalidation.valid) {
        console.log('[AI Response Validator] 정규화 성공');
        return {
            valid: true,
            errors: validation.errors,  // 원본 에러 기록
            data: normalized,
            normalized: true
        };
    } else {
        // 정규화 실패 → 기본 응답 반환
        console.error('[AI Response Validator] 정규화 실패, 기본 응답 사용:', revalidation.errors);
        return {
            valid: false,
            errors: [...validation.errors, ...revalidation.errors],
            data: getDefaultResponse(),
            normalized: true
        };
    }
}

/**
 * ========================================
 * 기본 응답 생성
 * ========================================
 *
 * 모든 검증이 실패했을 때 사용할 기본 응답을 생성합니다.
 *
 * @returns {object} 기본 AI 응답
 */
function getDefaultResponse() {
    const scores = {};
    for (const category of REQUIRED_CATEGORIES) {
        scores[category] = 0;
    }

    return {
        scores: scores,
        is_harmful: false,
        suggested_severity: 1,
        suggestedAction: 'pass',
        final_score: 0,
        description: 'AI 응답 파싱 실패',
        reasoning: 'AI API 응답이 올바른 형식이 아닙니다.'
    };
}

/**
 * ========================================
 * 부분 응답 검증 (선택적 필드 허용)
 * ========================================
 *
 * 일부 필드만 있어도 허용하는 느슨한 검증입니다.
 * AI가 불완전한 응답을 보낼 때 사용합니다.
 *
 * @param {any} response - AI API 응답
 * @returns {boolean} 부분 응답이 유효한지 여부
 */
export function isPartialResponseValid(response) {
    if (!response || typeof response !== 'object') {
        return false;
    }

    // scores 또는 final_score 중 하나만 있어도 OK
    const hasScores = response.scores && typeof response.scores === 'object';
    const hasFinalScore = typeof response.final_score === 'number' &&
                          response.final_score >= 0 &&
                          response.final_score <= 1;

    return hasScores || hasFinalScore;
}
