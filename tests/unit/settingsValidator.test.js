/**
 * settingsValidator 단위 테스트
 * @author 최진호
 * @date 2026-02-26
 */

import { validateSettings, ensureSettingsIntegrity, validateType } from '../../src/utils/settingsValidator.js';
import { DEFAULT_SETTINGS } from '../../src/utils/constants.js';

describe('settingsValidator', () => {
    describe('validateSettings', () => {
        test('정상 설정값', () => {
            const input = {
                enabled: true,
                debugMode: false,
                thresholds: {
                    safeMax: 0.3,
                    cautionMax: 0.6
                },
                sensitivity: {
                    gore: 0.8,
                    violence: 0.8
                }
            };

            const result = validateSettings(input);

            expect(result.enabled).toBe(true);
            expect(result.debugMode).toBe(false);
            expect(result.thresholds.safeMax).toBe(0.3);
            expect(result.thresholds.cautionMax).toBe(0.6);
        });

        test('음수 임계값 거부 (0으로 클램핑)', () => {
            const input = {
                thresholds: {
                    safeMax: -100,
                    cautionMax: 0.6
                }
            };

            const result = validateSettings(input);

            expect(result.thresholds.safeMax).toBe(0);
            expect(result.thresholds.safeMax).toBeGreaterThanOrEqual(0);
        });

        test('1 초과 임계값 거부 (1로 클램핑)', () => {
            const input = {
                thresholds: {
                    safeMax: 150,
                    cautionMax: 200
                }
            };

            const result = validateSettings(input);

            expect(result.thresholds.safeMax).toBe(1);
            expect(result.thresholds.cautionMax).toBe(1);
        });

        test('safeMax >= cautionMax 자동 조정', () => {
            const input = {
                thresholds: {
                    safeMax: 0.7,
                    cautionMax: 0.6
                }
            };

            const result = validateSettings(input);

            // safeMax가 cautionMax보다 작아지도록 조정
            expect(result.thresholds.safeMax).toBeLessThan(result.thresholds.cautionMax);
        });

        test('safeMax = cautionMax 자동 조정', () => {
            const input = {
                thresholds: {
                    safeMax: 0.5,
                    cautionMax: 0.5
                }
            };

            const result = validateSettings(input);

            expect(result.thresholds.safeMax).toBeLessThan(result.thresholds.cautionMax);
        });

        test('safeMax가 0.9 이상일 때 조정', () => {
            const input = {
                thresholds: {
                    safeMax: 0.95,
                    cautionMax: 0.8
                }
            };

            const result = validateSettings(input);

            // safeMax가 감소되어야 함
            expect(result.thresholds.safeMax).toBeLessThan(0.95);
            expect(result.thresholds.safeMax).toBeLessThan(result.thresholds.cautionMax);
        });

        test('민감도 범위 검증 (0-1)', () => {
            const input = {
                sensitivity: {
                    gore: -0.5,
                    violence: 1.5,
                    death: 0.5
                }
            };

            const result = validateSettings(input);

            expect(result.sensitivity.gore).toBe(0);
            expect(result.sensitivity.violence).toBe(1);
            expect(result.sensitivity.death).toBe(0.5);
        });

        test('API 우선순위 범위 검증 (0-100)', () => {
            const input = {
                apis: {
                    geminiFlash: {
                        enabled: true,
                        apiKey: 'test-key',
                        priority: -10
                    },
                    claudeHaiku: {
                        enabled: true,
                        apiKey: 'test-key',
                        priority: 150
                    }
                }
            };

            const result = validateSettings(input);

            expect(result.apis.geminiFlash.priority).toBe(0);
            expect(result.apis.claudeHaiku.priority).toBe(100);
        });

        test('잘못된 타입 기본값 적용', () => {
            const input = {
                enabled: 'yes',
                debugMode: 1,
                cacheDuration: 'long'
            };

            const result = validateSettings(input);

            expect(typeof result.enabled).toBe('boolean');
            expect(typeof result.debugMode).toBe('boolean');
            expect(typeof result.cacheDuration).toBe('number');
        });

        test('누락된 필드 기본값 채우기', () => {
            const input = {
                enabled: true
            };

            const result = validateSettings(input);

            expect(result).toHaveProperty('autoScan');
            expect(result).toHaveProperty('thresholds');
            expect(result).toHaveProperty('sensitivity');
            expect(result).toHaveProperty('apis');
        });

        test('null 또는 undefined 입력', () => {
            const result1 = validateSettings(null);
            const result2 = validateSettings(undefined);
            const result3 = validateSettings({});

            expect(result1).toMatchObject(DEFAULT_SETTINGS);
            expect(result2).toMatchObject(DEFAULT_SETTINGS);
            expect(result3).toMatchObject(DEFAULT_SETTINGS);
        });

        test('cacheDuration 양수 검증', () => {
            const input1 = { cacheDuration: -1000 };
            const input2 = { cacheDuration: 0 };
            const input3 = { cacheDuration: 'invalid' };

            const result1 = validateSettings(input1);
            const result2 = validateSettings(input2);
            const result3 = validateSettings(input3);

            expect(result1.cacheDuration).toBeGreaterThan(0);
            expect(result2.cacheDuration).toBeGreaterThan(0);
            expect(result3.cacheDuration).toBeGreaterThan(0);
        });
    });

    describe('ensureSettingsIntegrity', () => {
        test('임계값 모순 자동 수정', () => {
            const input = {
                ...DEFAULT_SETTINGS,
                thresholds: {
                    safeMax: 0.8,
                    cautionMax: 0.5
                }
            };

            const result = ensureSettingsIntegrity(input);

            expect(result.thresholds.safeMax).toBeLessThan(result.thresholds.cautionMax);
        });

        test('캐시 비활성화 시 cacheDuration 무효화', () => {
            const input = {
                ...DEFAULT_SETTINGS,
                cacheEnabled: false,
                cacheDuration: 86400000
            };

            const result = ensureSettingsIntegrity(input);

            expect(result.cacheDuration).toBe(0);
        });

        test('캐시 활성화 시 cacheDuration 유지', () => {
            const input = {
                ...DEFAULT_SETTINGS,
                cacheEnabled: true,
                cacheDuration: 86400000
            };

            const result = ensureSettingsIntegrity(input);

            expect(result.cacheDuration).toBe(86400000);
        });
    });

    describe('validateType', () => {
        test('타입 일치', () => {
            expect(validateType('test', 'string', 'testField')).toBe(true);
            expect(validateType(123, 'number', 'testField')).toBe(true);
            expect(validateType(true, 'boolean', 'testField')).toBe(true);
        });

        test('타입 불일치', () => {
            expect(validateType('test', 'number', 'testField')).toBe(false);
            expect(validateType(123, 'string', 'testField')).toBe(false);
            expect(validateType(true, 'number', 'testField')).toBe(false);
        });
    });

    describe('엣지 케이스', () => {
        test('빈 객체 입력', () => {
            const result = validateSettings({});
            expect(result).toMatchObject(DEFAULT_SETTINGS);
        });

        test('부분 설정 입력', () => {
            const input = {
                enabled: false
            };

            const result = validateSettings(input);

            expect(result.enabled).toBe(false);
            expect(result.autoScan).toBe(DEFAULT_SETTINGS.autoScan);
        });

        test('NaN 값 처리', () => {
            const input = {
                thresholds: {
                    safeMax: NaN,
                    cautionMax: NaN
                }
            };

            const result = validateSettings(input);

            expect(Number.isNaN(result.thresholds.safeMax)).toBe(false);
            expect(Number.isNaN(result.thresholds.cautionMax)).toBe(false);
        });

        test('Infinity 값 처리', () => {
            const input = {
                thresholds: {
                    safeMax: Infinity,
                    cautionMax: -Infinity
                }
            };

            const result = validateSettings(input);

            expect(result.thresholds.safeMax).toBeLessThanOrEqual(1);
            expect(result.thresholds.cautionMax).toBeGreaterThanOrEqual(0);
        });

        test('매우 큰 숫자 클램핑', () => {
            const input = {
                thresholds: {
                    safeMax: 999999,
                    cautionMax: 999999
                },
                sensitivity: {
                    gore: 999999
                },
                apis: {
                    geminiFlash: {
                        priority: 999999
                    }
                }
            };

            const result = validateSettings(input);

            expect(result.thresholds.safeMax).toBeLessThanOrEqual(1);
            expect(result.sensitivity.gore).toBeLessThanOrEqual(1);
            expect(result.apis.geminiFlash.priority).toBeLessThanOrEqual(100);
        });

        test('매우 작은 숫자 클램핑', () => {
            const input = {
                thresholds: {
                    safeMax: -999999,
                    cautionMax: -999999
                },
                sensitivity: {
                    gore: -999999
                },
                apis: {
                    geminiFlash: {
                        priority: -999999
                    }
                }
            };

            const result = validateSettings(input);

            expect(result.thresholds.safeMax).toBeGreaterThanOrEqual(0);
            expect(result.sensitivity.gore).toBeGreaterThanOrEqual(0);
            expect(result.apis.geminiFlash.priority).toBeGreaterThanOrEqual(0);
        });
    });

    describe('실제 사용 시나리오', () => {
        test('사용자가 모든 임계값을 0으로 설정 (모두 안전)', () => {
            const input = {
                thresholds: {
                    safeMax: 0,
                    cautionMax: 0
                }
            };

            const result = validateSettings(input);

            // safeMax가 0이면 cautionMax는 최소 0.1이 되어야 함
            expect(result.thresholds.safeMax).toBeLessThan(result.thresholds.cautionMax);
        });

        test('사용자가 모든 임계값을 1로 설정 (모두 위험)', () => {
            const input = {
                thresholds: {
                    safeMax: 1,
                    cautionMax: 1
                }
            };

            const result = validateSettings(input);

            // safeMax < cautionMax 보장
            expect(result.thresholds.safeMax).toBeLessThan(result.thresholds.cautionMax);
        });

        test('API 키만 변경', () => {
            const input = {
                ...DEFAULT_SETTINGS,
                apis: {
                    ...DEFAULT_SETTINGS.apis,
                    geminiFlash: {
                        enabled: true,
                        apiKey: 'new-api-key',
                        priority: 1
                    }
                }
            };

            const result = validateSettings(input);

            expect(result.apis.geminiFlash.apiKey).toBe('new-api-key');
            expect(result.apis.geminiFlash.enabled).toBe(true);
        });

        test('민감도 전체 증가', () => {
            const input = {
                sensitivity: {
                    gore: 0.9,
                    violence: 0.9,
                    death: 0.9,
                    disturbing: 0.9,
                    insects: 0.9,
                    medical: 0.9,
                    shock: 0.9,
                    animal_cruelty: 0.9,
                    nsfw_porn: 0.9,
                    nsfw_sexy: 0.9
                }
            };

            const result = validateSettings(input);

            for (const [key, value] of Object.entries(result.sensitivity)) {
                expect(value).toBe(0.9);
            }
        });
    });
});
