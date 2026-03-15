/**
 * AI Response Validator 단위 테스트
 * @author 최진호
 * @date 2026-02-26
 */

import {
    validateAIResponse,
    normalizeAIResponse,
    validateAndNormalizeAIResponse,
    isPartialResponseValid
} from '../../src/utils/aiResponseValidator.js';

describe('AI Response Validator', () => {
    describe('validateAIResponse', () => {
        test('정상 응답', () => {
            const response = {
                scores: {
                    gore: 0.1,
                    violence: 0.2,
                    death: 0.0,
                    disturbing: 0.3,
                    insects: 0.0,
                    medical: 0.1,
                    shock: 0.2,
                    animal_cruelty: 0.0,
                    nsfw_porn: 0.0,
                    nsfw_sexy: 0.0
                },
                is_harmful: false,
                suggested_severity: 2,
                suggestedAction: 'pass',
                final_score: 0.3,
                description: '일반적인 이미지',
                reasoning: '유해 콘텐츠 없음'
            };

            const result = validateAIResponse(response);

            expect(result.valid).toBe(true);
            expect(result.errors).toEqual([]);
            expect(result.data).toEqual(response);
        });

        test('null 응답', () => {
            const result = validateAIResponse(null);

            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('null');
            expect(result.data).toBeNull();
        });

        test('scores 필드 누락', () => {
            const response = {
                is_harmful: false,
                suggested_severity: 1,
                suggestedAction: 'pass',
                final_score: 0.1,
                description: 'test',
                reasoning: 'test'
            };

            const result = validateAIResponse(response);

            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('scores');
        });

        test('카테고리 일부 누락', () => {
            const response = {
                scores: {
                    gore: 0.1,
                    violence: 0.2
                    // 나머지 카테고리 누락
                },
                is_harmful: false,
                suggested_severity: 1,
                suggestedAction: 'pass',
                final_score: 0.1,
                description: 'test',
                reasoning: 'test'
            };

            const result = validateAIResponse(response);

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors.some(e => e.includes('death'))).toBe(true);
        });

        test('점수 범위 초과 (1.5)', () => {
            const response = {
                scores: {
                    gore: 1.5,  // 범위 초과
                    violence: 0.2,
                    death: 0.0,
                    disturbing: 0.0,
                    insects: 0.0,
                    medical: 0.0,
                    shock: 0.0,
                    animal_cruelty: 0.0,
                    nsfw_porn: 0.0,
                    nsfw_sexy: 0.0
                },
                is_harmful: false,
                suggested_severity: 1,
                suggestedAction: 'pass',
                final_score: 0.1,
                description: 'test',
                reasoning: 'test'
            };

            const result = validateAIResponse(response);

            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('gore') && e.includes('0-1'))).toBe(true);
        });

        test('점수 음수', () => {
            const response = {
                scores: {
                    gore: -0.5,  // 음수
                    violence: 0.2,
                    death: 0.0,
                    disturbing: 0.0,
                    insects: 0.0,
                    medical: 0.0,
                    shock: 0.0,
                    animal_cruelty: 0.0,
                    nsfw_porn: 0.0,
                    nsfw_sexy: 0.0
                },
                is_harmful: false,
                suggested_severity: 1,
                suggestedAction: 'pass',
                final_score: 0.1,
                description: 'test',
                reasoning: 'test'
            };

            const result = validateAIResponse(response);

            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('gore'))).toBe(true);
        });

        test('is_harmful 타입 오류', () => {
            const response = {
                scores: {
                    gore: 0.1,
                    violence: 0.2,
                    death: 0.0,
                    disturbing: 0.0,
                    insects: 0.0,
                    medical: 0.0,
                    shock: 0.0,
                    animal_cruelty: 0.0,
                    nsfw_porn: 0.0,
                    nsfw_sexy: 0.0
                },
                is_harmful: 'yes',  // 문자열 (boolean이 아님)
                suggested_severity: 1,
                suggestedAction: 'pass',
                final_score: 0.1,
                description: 'test',
                reasoning: 'test'
            };

            const result = validateAIResponse(response);

            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('is_harmful') && e.includes('boolean'))).toBe(true);
        });

        test('suggested_severity 범위 초과 (10)', () => {
            const response = {
                scores: {
                    gore: 0.1,
                    violence: 0.2,
                    death: 0.0,
                    disturbing: 0.0,
                    insects: 0.0,
                    medical: 0.0,
                    shock: 0.0,
                    animal_cruelty: 0.0,
                    nsfw_porn: 0.0,
                    nsfw_sexy: 0.0
                },
                is_harmful: false,
                suggested_severity: 10,  // 범위 초과 (1-5)
                suggestedAction: 'pass',
                final_score: 0.1,
                description: 'test',
                reasoning: 'test'
            };

            const result = validateAIResponse(response);

            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('suggested_severity') && e.includes('1-5'))).toBe(true);
        });

        test('suggestedAction 잘못된 값', () => {
            const response = {
                scores: {
                    gore: 0.1,
                    violence: 0.2,
                    death: 0.0,
                    disturbing: 0.0,
                    insects: 0.0,
                    medical: 0.0,
                    shock: 0.0,
                    animal_cruelty: 0.0,
                    nsfw_porn: 0.0,
                    nsfw_sexy: 0.0
                },
                is_harmful: false,
                suggested_severity: 1,
                suggestedAction: 'delete',  // 잘못된 값
                final_score: 0.1,
                description: 'test',
                reasoning: 'test'
            };

            const result = validateAIResponse(response);

            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('suggestedAction'))).toBe(true);
        });

        test('description 타입 오류', () => {
            const response = {
                scores: {
                    gore: 0.1,
                    violence: 0.2,
                    death: 0.0,
                    disturbing: 0.0,
                    insects: 0.0,
                    medical: 0.0,
                    shock: 0.0,
                    animal_cruelty: 0.0,
                    nsfw_porn: 0.0,
                    nsfw_sexy: 0.0
                },
                is_harmful: false,
                suggested_severity: 1,
                suggestedAction: 'pass',
                final_score: 0.1,
                description: 123,  // 숫자 (문자열이 아님)
                reasoning: 'test'
            };

            const result = validateAIResponse(response);

            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('description') && e.includes('문자열'))).toBe(true);
        });
    });

    describe('normalizeAIResponse', () => {
        test('범위 초과 점수 클램핑', () => {
            const response = {
                scores: {
                    gore: 1.5,  // → 1.0
                    violence: -0.5,  // → 0.0
                    death: 0.5,
                    disturbing: 0.0,
                    insects: 0.0,
                    medical: 0.0,
                    shock: 0.0,
                    animal_cruelty: 0.0,
                    nsfw_porn: 0.0,
                    nsfw_sexy: 0.0
                },
                is_harmful: false,
                suggested_severity: 1,
                suggestedAction: 'pass',
                final_score: 0.1,
                description: 'test',
                reasoning: 'test'
            };

            const normalized = normalizeAIResponse(response);

            expect(normalized.scores.gore).toBe(1.0);
            expect(normalized.scores.violence).toBe(0.0);
        });

        test('문자열 점수 변환', () => {
            const response = {
                scores: {
                    gore: '0.8',  // 문자열 → 숫자
                    violence: 0.2,
                    death: 0.0,
                    disturbing: 0.0,
                    insects: 0.0,
                    medical: 0.0,
                    shock: 0.0,
                    animal_cruelty: 0.0,
                    nsfw_porn: 0.0,
                    nsfw_sexy: 0.0
                },
                is_harmful: false,
                suggested_severity: 1,
                suggestedAction: 'pass',
                final_score: 0.1,
                description: 'test',
                reasoning: 'test'
            };

            const normalized = normalizeAIResponse(response);

            expect(normalized.scores.gore).toBe(0.8);
            expect(typeof normalized.scores.gore).toBe('number');
        });

        test('누락된 카테고리 기본값 설정', () => {
            const response = {
                scores: {
                    gore: 0.5
                    // 나머지 누락
                },
                is_harmful: false,
                suggested_severity: 1,
                suggestedAction: 'pass',
                final_score: 0.1,
                description: 'test',
                reasoning: 'test'
            };

            const normalized = normalizeAIResponse(response);

            expect(normalized.scores.gore).toBe(0.5);
            expect(normalized.scores.violence).toBe(0);
            expect(normalized.scores.death).toBe(0);
            expect(normalized.scores.disturbing).toBe(0);
        });

        test('is_harmful 문자열 변환', () => {
            const response1 = {
                scores: {},
                is_harmful: 'true',  // 문자열
                suggested_severity: 1,
                suggestedAction: 'pass',
                final_score: 0.1,
                description: 'test',
                reasoning: 'test'
            };

            const normalized1 = normalizeAIResponse(response1);
            expect(normalized1.is_harmful).toBe(true);

            const response2 = {
                scores: {},
                is_harmful: 'false',  // 문자열
                suggested_severity: 1,
                suggestedAction: 'pass',
                final_score: 0.1,
                description: 'test',
                reasoning: 'test'
            };

            const normalized2 = normalizeAIResponse(response2);
            expect(normalized2.is_harmful).toBe(false);
        });

        test('is_harmful 누락 시 final_score 기반 추정', () => {
            const response1 = {
                scores: {},
                // is_harmful 누락
                suggested_severity: 1,
                suggestedAction: 'pass',
                final_score: 0.8,  // >= 0.7이면 harmful
                description: 'test',
                reasoning: 'test'
            };

            const normalized1 = normalizeAIResponse(response1);
            expect(normalized1.is_harmful).toBe(true);

            const response2 = {
                scores: {},
                suggested_severity: 1,
                suggestedAction: 'pass',
                final_score: 0.3,  // < 0.7이면 not harmful
                description: 'test',
                reasoning: 'test'
            };

            const normalized2 = normalizeAIResponse(response2);
            expect(normalized2.is_harmful).toBe(false);
        });

        test('suggested_severity 반올림 및 클램핑', () => {
            const response = {
                scores: {},
                is_harmful: false,
                suggested_severity: 7.8,  // → 5 (최대값)
                suggestedAction: 'pass',
                final_score: 0.1,
                description: 'test',
                reasoning: 'test'
            };

            const normalized = normalizeAIResponse(response);
            expect(normalized.suggested_severity).toBe(5);
        });

        test('suggestedAction 누락 시 final_score 기반 추정', () => {
            const response1 = {
                scores: {},
                is_harmful: false,
                suggested_severity: 1,
                // suggestedAction 누락
                final_score: 0.8,  // >= 0.7 → block
                description: 'test',
                reasoning: 'test'
            };

            const normalized1 = normalizeAIResponse(response1);
            expect(normalized1.suggestedAction).toBe('block');

            const response2 = {
                scores: {},
                is_harmful: false,
                suggested_severity: 1,
                final_score: 0.5,  // >= 0.4 → warn
                description: 'test',
                reasoning: 'test'
            };

            const normalized2 = normalizeAIResponse(response2);
            expect(normalized2.suggestedAction).toBe('warn');

            const response3 = {
                scores: {},
                is_harmful: false,
                suggested_severity: 1,
                final_score: 0.2,  // < 0.4 → pass
                description: 'test',
                reasoning: 'test'
            };

            const normalized3 = normalizeAIResponse(response3);
            expect(normalized3.suggestedAction).toBe('pass');
        });

        test('null 응답 → 기본값', () => {
            const normalized = normalizeAIResponse(null);

            expect(normalized.scores.gore).toBe(0);
            expect(normalized.is_harmful).toBe(false);
            expect(normalized.suggested_severity).toBe(1);
            expect(normalized.suggestedAction).toBe('pass');
            expect(normalized.final_score).toBe(0);
        });
    });

    describe('validateAndNormalizeAIResponse', () => {
        test('정상 응답 → 검증 통과', () => {
            const response = {
                scores: {
                    gore: 0.1,
                    violence: 0.2,
                    death: 0.0,
                    disturbing: 0.0,
                    insects: 0.0,
                    medical: 0.0,
                    shock: 0.0,
                    animal_cruelty: 0.0,
                    nsfw_porn: 0.0,
                    nsfw_sexy: 0.0
                },
                is_harmful: false,
                suggested_severity: 1,
                suggestedAction: 'pass',
                final_score: 0.1,
                description: 'test',
                reasoning: 'test'
            };

            const result = validateAndNormalizeAIResponse(response);

            expect(result.valid).toBe(true);
            expect(result.normalized).toBe(false);
            expect(result.errors).toEqual([]);
        });

        test('검증 실패 → 정규화 성공', () => {
            const response = {
                scores: {
                    gore: 1.5,  // 범위 초과
                    violence: 0.2,
                    death: 0.0,
                    disturbing: 0.0,
                    insects: 0.0,
                    medical: 0.0,
                    shock: 0.0,
                    animal_cruelty: 0.0,
                    nsfw_porn: 0.0,
                    nsfw_sexy: 0.0
                },
                is_harmful: false,
                suggested_severity: 1,
                suggestedAction: 'pass',
                final_score: 0.1,
                description: 'test',
                reasoning: 'test'
            };

            const result = validateAndNormalizeAIResponse(response);

            expect(result.valid).toBe(true);
            expect(result.normalized).toBe(true);
            expect(result.data.scores.gore).toBe(1.0);  // 클램핑됨
            expect(result.errors.length).toBeGreaterThan(0);  // 원본 에러 기록
        });

        test('검증 실패 + 정규화 실패 → 기본값', () => {
            const response = null;

            const result = validateAndNormalizeAIResponse(response);

            expect(result.valid).toBe(false);
            expect(result.normalized).toBe(true);
            expect(result.data.scores.gore).toBe(0);
            expect(result.data.description).toBe('AI 응답 파싱 실패');
        });
    });

    describe('isPartialResponseValid', () => {
        test('scores만 있음 → 유효', () => {
            const response = {
                scores: {
                    gore: 0.1,
                    violence: 0.2
                }
            };

            expect(isPartialResponseValid(response)).toBe(true);
        });

        test('final_score만 있음 → 유효', () => {
            const response = {
                final_score: 0.5
            };

            expect(isPartialResponseValid(response)).toBe(true);
        });

        test('둘 다 없음 → 무효', () => {
            const response = {
                description: 'test'
            };

            expect(isPartialResponseValid(response)).toBe(false);
        });

        test('null → 무효', () => {
            expect(isPartialResponseValid(null)).toBe(false);
        });
    });

    describe('실제 AI 응답 시나리오', () => {
        test('GPT-4o-mini 응답', () => {
            const response = {
                scores: {
                    gore: 0.0,
                    violence: 0.0,
                    death: 0.0,
                    disturbing: 0.1,
                    insects: 0.0,
                    medical: 0.0,
                    shock: 0.0,
                    animal_cruelty: 0.0,
                    nsfw_porn: 0.0,
                    nsfw_sexy: 0.2
                },
                is_harmful: false,
                suggested_severity: 1,
                suggestedAction: 'pass',
                final_score: 0.15,
                description: '해변에서 수영복을 입은 사람들',
                reasoning: '일반적인 해변 사진으로 유해 콘텐츠 없음'
            };

            const result = validateAndNormalizeAIResponse(response);

            expect(result.valid).toBe(true);
            expect(result.data.is_harmful).toBe(false);
        });

        test('Claude Haiku 응답 (유해 이미지)', () => {
            const response = {
                scores: {
                    gore: 0.9,
                    violence: 0.8,
                    death: 0.7,
                    disturbing: 0.9,
                    insects: 0.0,
                    medical: 0.5,
                    shock: 0.9,
                    animal_cruelty: 0.0,
                    nsfw_porn: 0.0,
                    nsfw_sexy: 0.0
                },
                is_harmful: true,
                suggested_severity: 5,
                suggestedAction: 'block',
                final_score: 0.95,
                description: '심각한 신체 훼손 이미지',
                reasoning: '고어, 폭력, 죽음 카테고리에서 높은 점수'
            };

            const result = validateAndNormalizeAIResponse(response);

            expect(result.valid).toBe(true);
            expect(result.data.is_harmful).toBe(true);
            expect(result.data.suggestedAction).toBe('block');
        });
    });
});
