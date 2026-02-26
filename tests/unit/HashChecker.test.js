/**
 * HashChecker 단위 테스트
 * @author 최진호
 * @date 2026-02-12
 */

import { HashChecker } from '../../src/analyzers/hashChecker.js';

describe('HashChecker', () => {
    let hashChecker;
    const mockServerUrl = 'https://test.nsfw.nerdvana.kr';

    beforeEach(() => {
        jest.clearAllMocks();
        hashChecker = new HashChecker(mockServerUrl);
    });

    describe('check', () => {
        const mockHashes = {
            phash: 'abc123',
            dhash: 'def456',
            ahash: 'ghi789'
        };
        const mockReporterId = 'test-reporter-id';

        test('매칭되지 않은 이미지 검사', async () => {
            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: {
                        matched:       false,
                        bloomFiltered: false
                    }
                })
            });

            const result = await hashChecker.check(mockHashes, 10, mockReporterId);

            expect(result.matched).toBe(false);
            expect(result.riskScore).toBe(0);
            expect(result.source).toBe('hash-db');
            expect(fetch).toHaveBeenCalledWith(
                `${mockServerUrl}/api/check/hash`,
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                })
            );
        });

        test('매칭된 이미지 검사', async () => {
            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: {
                        matched:   true,
                        matchType: 'phash',
                        distance:  3,
                        image: {
                            id:       123,
                            category: 1,
                            severity: 5
                        }
                    }
                })
            });

            const result = await hashChecker.check(mockHashes, 10, mockReporterId);

            expect(result.matched).toBe(true);
            expect(result.riskScore).toBe(1.0);
            expect(result.matchType).toBe('phash');
            expect(result.distance).toBe(3);
            expect(result.imageId).toBe(123);
            expect(result.severity).toBe(5);
        });

        test('reporterId 없이 호출 시 에러', async () => {
            await expect(
                hashChecker.check(mockHashes, 10, null)
            ).rejects.toThrow('reporterId는 필수 파라미터입니다');
        });

        test('서버 응답 실패 시 에러', async () => {
            global.fetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                json: async () => ({ error: 'Server error' })
            });

            await expect(
                hashChecker.check(mockHashes, 10, mockReporterId)
            ).rejects.toThrow();
        });

        test('네트워크 에러 시 예외 발생', async () => {
            global.fetch.mockRejectedValueOnce(new Error('Network error'));

            await expect(
                hashChecker.check(mockHashes, 10, mockReporterId)
            ).rejects.toThrow('Network error');
        });
    });

    describe('transformResult', () => {
        test('매칭되지 않은 결과 변환', () => {
            const data = {
                matched:       false,
                bloomFiltered: false
            };

            const result = hashChecker.transformResult(data);

            expect(result.riskScore).toBe(0);
            expect(result.matched).toBe(false);
            expect(result.source).toBe('hash-db');
            expect(result.categories.gore).toBe(0);
        });

        test('매칭된 결과 변환 (고어 카테고리)', () => {
            const data = {
                matched:   true,
                matchType: 'phash',
                distance:  5,
                image: {
                    id:       123,
                    category: 1,
                    severity: 4
                }
            };

            const result = hashChecker.transformResult(data);

            expect(result.matched).toBe(true);
            expect(result.riskScore).toBe(0.8);
            expect(result.categories.gore).toBe(0.8);
            expect(result.imageId).toBe(123);
        });
    });

    describe('mapCategoryToScores', () => {
        test('카테고리 1 (고어) 매핑', () => {
            const scores = hashChecker.mapCategoryToScores(1, 5);

            expect(scores.gore).toBe(1.0);
            expect(scores.violence).toBe(0);
        });

        test('카테고리 9 (음란물) 매핑', () => {
            const scores = hashChecker.mapCategoryToScores(9, 3);

            expect(scores.nsfw_porn).toBe(0.6);
            expect(scores.gore).toBe(0);
        });

        test('알 수 없는 카테고리는 disturbing으로 매핑', () => {
            const scores = hashChecker.mapCategoryToScores(999, 5);

            expect(scores.disturbing).toBe(1.0);
        });
    });

    describe('testConnection', () => {
        test('서버 연결 성공', async () => {
            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    status:      'ok',
                    dbConnected: true
                })
            });

            const result = await hashChecker.testConnection();

            expect(result).toBe(true);
            expect(fetch).toHaveBeenCalledWith(
                `${mockServerUrl}/health`,
                expect.objectContaining({ method: 'GET' })
            );
        });

        test('서버 연결 실패', async () => {
            global.fetch.mockResolvedValueOnce({
                ok: false,
                status: 503
            });

            const result = await hashChecker.testConnection();

            expect(result).toBe(false);
        });

        test('타임아웃 시 false 반환', async () => {
            global.fetch.mockRejectedValueOnce(new Error('Timeout'));

            const result = await hashChecker.testConnection();

            expect(result).toBe(false);
        });
    });
});
