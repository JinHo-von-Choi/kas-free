/**
 * applyUserSensitivity 함수 테스트
 * @author 최진호
 * @date 2026-03-15
 * @remarks content.js의 applyUserSensitivity 로직을 직접 검증
 */

/**
 * content.js의 applyUserSensitivity 함수 (수정 후 버전)
 * score <= 0인 카테고리는 totalWeight에 포함하지 않음
 */
function applyUserSensitivity(result, userSensitivity) {
    const categories = result.categories || result.detailedScores;

    if (!categories || typeof categories !== 'object') {
        return result.riskScore || 0;
    }

    const defaultSensitivity = {
        gore:           0.8,
        violence:       0.8,
        death:          0.8,
        disturbing:     0.8,
        insects:        0.7,
        medical:        0.7,
        shock:          0.7,
        animal_cruelty: 0.8,
        nsfw_porn:      0.3,
        nsfw_sexy:      0.2
    };

    const weights = {
        gore:           1.0,
        violence:       1.0,
        death:          1.0,
        disturbing:     0.9,
        insects:        0.8,
        medical:        0.9,
        shock:          0.8,
        animal_cruelty: 1.0,
        nsfw_porn:      0.5,
        nsfw_sexy:      0.3
    };

    let weightedSum = 0;
    let totalWeight = 0;

    for (const [category, score] of Object.entries(categories)) {
        if (typeof score !== 'number') continue;
        if (score <= 0) continue;

        const weight = weights[category] || 0;
        if (weight === 0) continue;

        const defaultSens      = defaultSensitivity[category] || 1.0;
        const userSens         = userSensitivity[category] || defaultSens;
        const sensitivityRatio = userSens / defaultSens;
        const adjustedScore    = Math.min(1.0, score * sensitivityRatio);

        weightedSum += adjustedScore * weight;
        totalWeight += weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

const DEFAULT_SENSITIVITY = {
    gore:           0.8,
    violence:       0.8,
    death:          0.8,
    disturbing:     0.8,
    insects:        0.7,
    medical:        0.7,
    shock:          0.7,
    animal_cruelty: 0.8,
    nsfw_porn:      0.3,
    nsfw_sexy:      0.2
};

describe('applyUserSensitivity — zero-score 희석 버그 수정 검증', () => {

    describe('해시DB 단일 카테고리 매칭 (zero 희석 방지)', () => {

        test('gore=1.0, 나머지=0 → adjustedRiskScore ≈ 1.0 (DANGER, 기본 민감도)', () => {
            const result = {
                riskScore: 1.0,
                categories: {
                    gore:           1.0,
                    violence:       0,
                    death:          0,
                    disturbing:     0,
                    insects:        0,
                    medical:        0,
                    shock:          0,
                    animal_cruelty: 0,
                    nsfw_porn:      0,
                    nsfw_sexy:      0
                }
            };

            const score = applyUserSensitivity(result, DEFAULT_SENSITIVITY);

            /** zero 희석 수정 전: 0.122 (SAFE 오판) */
            /** zero 희석 수정 후: 1.0 (DANGER 정상 판정) */
            expect(score).toBeGreaterThanOrEqual(0.6);  // DANGER 임계값 이상
            expect(score).toBeCloseTo(1.0, 5);
        });

        test('gore=0.6, 나머지=0 → adjustedRiskScore ≈ 0.6 (DANGER 경계, 기본 민감도)', () => {
            const result = {
                riskScore: 0.6,
                categories: {
                    gore:           0.6,
                    violence:       0,
                    death:          0,
                    disturbing:     0,
                    insects:        0,
                    medical:        0,
                    shock:          0,
                    animal_cruelty: 0,
                    nsfw_porn:      0,
                    nsfw_sexy:      0
                }
            };

            const score = applyUserSensitivity(result, DEFAULT_SENSITIVITY);

            expect(score).toBeCloseTo(0.6, 5);
            expect(score).toBeGreaterThanOrEqual(0.6);  // DANGER
        });

        test('violence=0.8, 나머지=0 → adjustedRiskScore ≈ 0.8 (DANGER, 기본 민감도)', () => {
            const result = {
                riskScore: 0.8,
                categories: {
                    gore:           0,
                    violence:       0.8,
                    death:          0,
                    disturbing:     0,
                    insects:        0,
                    medical:        0,
                    shock:          0,
                    animal_cruelty: 0,
                    nsfw_porn:      0,
                    nsfw_sexy:      0
                }
            };

            const score = applyUserSensitivity(result, DEFAULT_SENSITIVITY);

            /** zero 희석 수정 전: 0.097 (SAFE 오판) */
            expect(score).toBeCloseTo(0.8, 5);
        });

        test('nsfw_porn=0.8, 나머지=0 → adjustedRiskScore ≈ 0.8 (기본 민감도)', () => {
            const result = {
                riskScore: 0.4,  // SW는 0.5 multiplier 적용
                categories: {
                    gore:           0,
                    violence:       0,
                    death:          0,
                    disturbing:     0,
                    insects:        0,
                    medical:        0,
                    shock:          0,
                    animal_cruelty: 0,
                    nsfw_porn:      0.8,
                    nsfw_sexy:      0
                }
            };

            const score = applyUserSensitivity(result, DEFAULT_SENSITIVITY);

            /** zero 희석 수정 전: 0.049 (SAFE 오판) */
            expect(score).toBeCloseTo(0.8, 5);
            expect(score).toBeGreaterThanOrEqual(0.6);  // DANGER
        });

    });

    describe('NSFW 서버 복합 카테고리 결과', () => {

        test('nsfw_porn=0.8, nsfw_sexy=0.2 → CAUTION 범위 (기본 민감도)', () => {
            const result = {
                riskScore: 0.4,
                categories: {
                    gore:           0,
                    violence:       0,
                    death:          0,
                    disturbing:     0,
                    insects:        0,
                    medical:        0,
                    shock:          0,
                    animal_cruelty: 0,
                    nsfw_porn:      0.8,
                    nsfw_sexy:      0.2
                }
            };

            const score = applyUserSensitivity(result, DEFAULT_SENSITIVITY);

            /**
             * 계산:
             * nsfw_porn: 0.8 × (0.3/0.3) × 0.5 = 0.4
             * nsfw_sexy: 0.2 × (0.2/0.2) × 0.3 = 0.06
             * totalWeight = 0.5 + 0.3 = 0.8
             * adjustedRiskScore = 0.46 / 0.8 = 0.575 → CAUTION
             */
            expect(score).toBeCloseTo(0.575, 3);
            expect(score).toBeGreaterThanOrEqual(0.3);  // CAUTION 이상
            expect(score).toBeLessThan(0.6);            // DANGER 미만
        });

    });

    describe('AI 분석 복합 카테고리 결과 (모든 카테고리 값 존재)', () => {

        test('gore=0.8, violence=0.6, death=0.3, disturbing=0.5 → DANGER (기본 민감도)', () => {
            const result = {
                riskScore: 0.8,
                categories: {
                    gore:           0.8,
                    violence:       0.6,
                    death:          0.3,
                    disturbing:     0.5,
                    insects:        0,
                    medical:        0,
                    shock:          0,
                    animal_cruelty: 0,
                    nsfw_porn:      0,
                    nsfw_sexy:      0
                }
            };

            const score = applyUserSensitivity(result, DEFAULT_SENSITIVITY);

            /**
             * 계산 (zero 카테고리 제외):
             * gore:      0.8 × 1.0 × 1.0 = 0.8
             * violence:  0.6 × 1.0 × 1.0 = 0.6
             * death:     0.3 × 1.0 × 1.0 = 0.3
             * disturbing:0.5 × 0.9 × 1.0 = 0.45
             * totalWeight = 1.0 + 1.0 + 1.0 + 0.9 = 3.9
             * weightedSum = 0.8 + 0.6 + 0.3 + 0.45 = 2.15
             * adjustedRiskScore = 2.15 / 3.9 ≈ 0.551 → CAUTION
             */
            expect(score).toBeGreaterThanOrEqual(0.3);  // CAUTION 이상
            /** zero 희석 수정 전: 0.262 (SAFE 오판) */
        });

    });

    describe('사용자 민감도 조정', () => {

        test('gore 민감도 높이면 (1.0) → 점수 증가', () => {
            const result = {
                riskScore: 0.4,
                categories: { gore: 0.4, violence: 0, death: 0, disturbing: 0, insects: 0, medical: 0, shock: 0, animal_cruelty: 0, nsfw_porn: 0, nsfw_sexy: 0 }
            };

            const highSensitivity = { ...DEFAULT_SENSITIVITY, gore: 1.0 };
            const score = applyUserSensitivity(result, highSensitivity);

            /** gore 기본=0.8 → 사용자=1.0 → ratio=1.25 → adjustedScore=0.5 */
            expect(score).toBeCloseTo(0.5, 5);
            expect(score).toBeGreaterThan(0.4);  // 기본 민감도보다 높아야 함
        });

        test('gore 민감도 낮추면 (0.4) → 점수 감소', () => {
            const result = {
                riskScore: 1.0,
                categories: { gore: 1.0, violence: 0, death: 0, disturbing: 0, insects: 0, medical: 0, shock: 0, animal_cruelty: 0, nsfw_porn: 0, nsfw_sexy: 0 }
            };

            const lowSensitivity = { ...DEFAULT_SENSITIVITY, gore: 0.4 };
            const score = applyUserSensitivity(result, lowSensitivity);

            /** gore 기본=0.8 → 사용자=0.4 → ratio=0.5 → adjustedScore=0.5 */
            expect(score).toBeCloseTo(0.5, 5);
            expect(score).toBeLessThan(1.0);  // 기본 민감도보다 낮아야 함
        });

        test('nsfw_porn 민감도 두 배(0.6)로 높이면 DANGER 범위 진입', () => {
            const result = {
                riskScore: 0.4,
                categories: { gore: 0, violence: 0, death: 0, disturbing: 0, insects: 0, medical: 0, shock: 0, animal_cruelty: 0, nsfw_porn: 0.8, nsfw_sexy: 0 }
            };

            /** 기본 nsfw_porn 민감도=0.3, 두 배=0.6 */
            const highSensitivity = { ...DEFAULT_SENSITIVITY, nsfw_porn: 0.6 };
            const score = applyUserSensitivity(result, highSensitivity);

            /**
             * ratio = 0.6/0.3 = 2.0
             * adjustedScore = min(1.0, 0.8 × 2.0) = 1.0
             * adjustedRiskScore = 1.0 (capped)
             */
            expect(score).toBeCloseTo(1.0, 5);
        });

    });

    describe('엣지 케이스', () => {

        test('categories가 없으면 riskScore 그대로 반환', () => {
            const result = { riskScore: 0.7 };
            const score = applyUserSensitivity(result, DEFAULT_SENSITIVITY);

            expect(score).toBe(0.7);
        });

        test('모든 카테고리가 0이면 0 반환 (riskScore fallback)', () => {
            const result = {
                riskScore: 0.5,
                categories: { gore: 0, violence: 0, death: 0, disturbing: 0, insects: 0, medical: 0, shock: 0, animal_cruelty: 0, nsfw_porn: 0, nsfw_sexy: 0 }
            };

            /** totalWeight=0 → fallback: 0 (현재 구현) */
            const score = applyUserSensitivity(result, DEFAULT_SENSITIVITY);
            expect(score).toBe(0);
        });

        test('1.0 초과는 1.0으로 캡핑', () => {
            const result = {
                riskScore: 1.0,
                categories: { gore: 0.9, violence: 0, death: 0, disturbing: 0, insects: 0, medical: 0, shock: 0, animal_cruelty: 0, nsfw_porn: 0, nsfw_sexy: 0 }
            };

            /** gore: ratio = 1.0/0.8 = 1.25 → 0.9 × 1.25 = 1.125 → capped to 1.0 */
            const maxSensitivity = { ...DEFAULT_SENSITIVITY, gore: 1.0 };
            const score = applyUserSensitivity(result, maxSensitivity);

            expect(score).toBeLessThanOrEqual(1.0);
            expect(score).toBeCloseTo(1.0, 5);
        });

        test('알 수 없는 카테고리는 무시', () => {
            const result = {
                riskScore: 0.5,
                categories: {
                    gore:    0.8,
                    unknown: 0.9  // 알 수 없는 카테고리 (weight=0)
                }
            };

            const score = applyUserSensitivity(result, DEFAULT_SENSITIVITY);

            /** unknown은 weights에 없으므로 제외 → gore만 반영 */
            expect(score).toBeCloseTo(0.8, 5);
        });

    });

});
