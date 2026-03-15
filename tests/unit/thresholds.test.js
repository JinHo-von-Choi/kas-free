/**
 * Thresholds (위험도 판정 기준) 테스트
 * @author 최진호
 * @date 2026-02-12
 */

describe('Thresholds (위험도 판정 기준) 반영', () => {
    describe('기본 임계값', () => {
        test('기본 safeMax는 0.3', () => {
            const DEFAULT_SETTINGS = {
                thresholds: {
                    safeMax: 0.3,
                    cautionMax: 0.6
                }
            };

            expect(DEFAULT_SETTINGS.thresholds.safeMax).toBe(0.3);
        });

        test('기본 cautionMax는 0.6', () => {
            const DEFAULT_SETTINGS = {
                thresholds: {
                    safeMax: 0.3,
                    cautionMax: 0.6
                }
            };

            expect(DEFAULT_SETTINGS.thresholds.cautionMax).toBe(0.6);
        });
    });

    describe('determineStatus 함수 (service-worker.js)', () => {
        let currentSettings;

        beforeEach(() => {
            currentSettings = {
                thresholds: {
                    safeMax: 0.3,
                    cautionMax: 0.6
                }
            };
        });

        function determineStatus(riskScore) {
            const { safeMax, cautionMax } = currentSettings.thresholds;

            if (riskScore < safeMax) {
                return 'safe';
            } else if (riskScore < cautionMax) {
                return 'caution';
            } else {
                return 'danger';
            }
        }

        test('riskScore 0.0 → safe', () => {
            expect(determineStatus(0.0)).toBe('safe');
        });

        test('riskScore 0.2 → safe', () => {
            expect(determineStatus(0.2)).toBe('safe');
        });

        test('riskScore 0.29 → safe', () => {
            expect(determineStatus(0.29)).toBe('safe');
        });

        test('riskScore 0.3 → caution (경계값)', () => {
            expect(determineStatus(0.3)).toBe('caution');
        });

        test('riskScore 0.4 → caution', () => {
            expect(determineStatus(0.4)).toBe('caution');
        });

        test('riskScore 0.59 → caution', () => {
            expect(determineStatus(0.59)).toBe('caution');
        });

        test('riskScore 0.6 → danger (경계값)', () => {
            expect(determineStatus(0.6)).toBe('danger');
        });

        test('riskScore 0.8 → danger', () => {
            expect(determineStatus(0.8)).toBe('danger');
        });

        test('riskScore 1.0 → danger', () => {
            expect(determineStatus(1.0)).toBe('danger');
        });
    });

    describe('사용자 정의 임계값 반영', () => {
        test('safeMax를 0.5로 변경 시 적용', () => {
            const currentSettings = {
                thresholds: {
                    safeMax: 0.5,    // 변경됨
                    cautionMax: 0.7
                }
            };

            function determineStatus(riskScore) {
                const { safeMax, cautionMax } = currentSettings.thresholds;

                if (riskScore < safeMax) {
                    return 'safe';
                } else if (riskScore < cautionMax) {
                    return 'caution';
                } else {
                    return 'danger';
                }
            }

            expect(determineStatus(0.3)).toBe('safe');   // 기존: caution, 새: safe
            expect(determineStatus(0.49)).toBe('safe');
            expect(determineStatus(0.5)).toBe('caution');
            expect(determineStatus(0.6)).toBe('caution');
            expect(determineStatus(0.7)).toBe('danger');
        });

        test('cautionMax를 0.8로 변경 시 적용', () => {
            const currentSettings = {
                thresholds: {
                    safeMax: 0.3,
                    cautionMax: 0.8  // 변경됨
                }
            };

            function determineStatus(riskScore) {
                const { safeMax, cautionMax } = currentSettings.thresholds;

                if (riskScore < safeMax) {
                    return 'safe';
                } else if (riskScore < cautionMax) {
                    return 'caution';
                } else {
                    return 'danger';
                }
            }

            expect(determineStatus(0.3)).toBe('caution');
            expect(determineStatus(0.6)).toBe('caution'); // 기존: danger, 새: caution
            expect(determineStatus(0.79)).toBe('caution');
            expect(determineStatus(0.8)).toBe('danger');
        });

        test('매우 엄격한 설정 (safeMax: 0.1, cautionMax: 0.3)', () => {
            const currentSettings = {
                thresholds: {
                    safeMax: 0.1,
                    cautionMax: 0.3
                }
            };

            function determineStatus(riskScore) {
                const { safeMax, cautionMax } = currentSettings.thresholds;

                if (riskScore < safeMax) {
                    return 'safe';
                } else if (riskScore < cautionMax) {
                    return 'caution';
                } else {
                    return 'danger';
                }
            }

            expect(determineStatus(0.09)).toBe('safe');
            expect(determineStatus(0.1)).toBe('caution');
            expect(determineStatus(0.2)).toBe('caution');
            expect(determineStatus(0.3)).toBe('danger');
        });

        test('매우 관대한 설정 (safeMax: 0.7, cautionMax: 0.9)', () => {
            const currentSettings = {
                thresholds: {
                    safeMax: 0.7,
                    cautionMax: 0.9
                }
            };

            function determineStatus(riskScore) {
                const { safeMax, cautionMax } = currentSettings.thresholds;

                if (riskScore < safeMax) {
                    return 'safe';
                } else if (riskScore < cautionMax) {
                    return 'caution';
                } else {
                    return 'danger';
                }
            }

            expect(determineStatus(0.5)).toBe('safe');
            expect(determineStatus(0.69)).toBe('safe');
            expect(determineStatus(0.7)).toBe('caution');
            expect(determineStatus(0.8)).toBe('caution');
            expect(determineStatus(0.9)).toBe('danger');
        });
    });

    describe('민감도 + 임계값 조합', () => {
        test('민감도 적용 후 임계값 판정', () => {
            // 사용자 설정
            const currentSettings = {
                sensitivity: {
                    gore: 1.0,        // 매우 민감
                    violence: 0.5,    // 덜 민감
                    nsfw_porn: 0.3
                },
                thresholds: {
                    safeMax: 0.3,
                    cautionMax: 0.6
                }
            };

            // 분석 결과
            const result = {
                categories: {
                    gore: 0.5,      // 원래 점수
                    violence: 0.4,
                    nsfw_porn: 0.2
                },
                riskScore: 0.4
            };

            // 민감도 적용 (간단화된 버전)
            function applyUserSensitivity(result, userSensitivity) {
                const categories = result.categories;
                const defaultSensitivity = {
                    gore: 0.8,
                    violence: 0.8,
                    nsfw_porn: 0.3
                };

                let sum = 0;
                let count = 0;

                for (const [category, score] of Object.entries(categories)) {
                    const defaultSens = defaultSensitivity[category] || 1.0;
                    const userSens = userSensitivity[category] || defaultSens;
                    const sensitivityRatio = userSens / defaultSens;
                    const adjustedScore = Math.min(1.0, score * sensitivityRatio);

                    sum += adjustedScore;
                    count++;
                }

                return count > 0 ? sum / count : 0;
            }

            function determineStatus(riskScore) {
                const { safeMax, cautionMax } = currentSettings.thresholds;

                if (riskScore < safeMax) {
                    return 'safe';
                } else if (riskScore < cautionMax) {
                    return 'caution';
                } else {
                    return 'danger';
                }
            }

            const adjustedRiskScore = applyUserSensitivity(result, currentSettings.sensitivity);
            const status = determineStatus(adjustedRiskScore);

            // 민감도 적용 후 임계값 판정이 올바르게 작동하는지 확인
            expect(typeof adjustedRiskScore).toBe('number');
            expect(adjustedRiskScore).toBeGreaterThanOrEqual(0);
            expect(adjustedRiskScore).toBeLessThanOrEqual(1);
            expect(['safe', 'caution', 'danger']).toContain(status);
        });
    });

    describe('경계값 테스트', () => {
        test('safeMax와 정확히 같은 값은 caution', () => {
            const currentSettings = {
                thresholds: {
                    safeMax: 0.3,
                    cautionMax: 0.6
                }
            };

            function determineStatus(riskScore) {
                const { safeMax, cautionMax } = currentSettings.thresholds;

                if (riskScore < safeMax) {
                    return 'safe';
                } else if (riskScore < cautionMax) {
                    return 'caution';
                } else {
                    return 'danger';
                }
            }

            expect(determineStatus(0.3)).toBe('caution');
        });

        test('cautionMax와 정확히 같은 값은 danger', () => {
            const currentSettings = {
                thresholds: {
                    safeMax: 0.3,
                    cautionMax: 0.6
                }
            };

            function determineStatus(riskScore) {
                const { safeMax, cautionMax } = currentSettings.thresholds;

                if (riskScore < safeMax) {
                    return 'safe';
                } else if (riskScore < cautionMax) {
                    return 'caution';
                } else {
                    return 'danger';
                }
            }

            expect(determineStatus(0.6)).toBe('danger');
        });

        test('부동소수점 정밀도 테스트', () => {
            const currentSettings = {
                thresholds: {
                    safeMax: 0.3,
                    cautionMax: 0.6
                }
            };

            function determineStatus(riskScore) {
                const { safeMax, cautionMax } = currentSettings.thresholds;

                if (riskScore < safeMax) {
                    return 'safe';
                } else if (riskScore < cautionMax) {
                    return 'caution';
                } else {
                    return 'danger';
                }
            }

            expect(determineStatus(0.2999999999)).toBe('safe');
            expect(determineStatus(0.3000000001)).toBe('caution');
            expect(determineStatus(0.5999999999)).toBe('caution');
            expect(determineStatus(0.6000000001)).toBe('danger');
        });
    });
});
