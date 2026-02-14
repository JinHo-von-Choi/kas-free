/**
 * 해시 기반 이미지 검사기
 * @author 최진호
 * @date 2026-01-31
 * @remarks https://nsfw.nerdvana.kr/api/check/hash 사용
 */

export class HashChecker {
    constructor(serverUrl = 'https://nsfw.nerdvana.kr') {
        this.name = 'Hash Checker';
        this.serverUrl = serverUrl;
    }

    /**
     * 해시로 이미지를 검사한다
     * @param {object} hashes - { phash, dhash, ahash }
     * @param {number} threshold - 유사도 임계값 (기본: 10)
     * @param {string} reporterId - 신고자 ID (필수)
     * @returns {Promise<object>}
     */
    async check(hashes, threshold = 10, reporterId) {
        try {
            if (!reporterId) {
                throw new Error('reporterId는 필수 파라미터입니다');
            }

            const requestBody = {
                phash:      hashes.phash,
                dhash:      hashes.dhash,
                ahash:      hashes.ahash,
                threshold:  threshold,
                reporterId: reporterId
            };

            const response = await fetch(`${this.serverUrl}/api/check/hash`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `서버 응답 오류: ${response.status}`);
            }

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || '검사 실패');
            }

            return this.transformResult(result.data);
        } catch (error) {
            console.error('[Kas-Free] 해시 검사 실패:', error);
            throw error;
        }
    }

    /**
     * 검사 결과를 표준 형식으로 변환
     * @param {object} data - API 응답 데이터
     * @returns {object}
     */
    transformResult(data) {
        const { matched, matchType, distance, image } = data;

        const baseCategories = {
            gore:           0,
            violence:       0,
            death:          0,
            disturbing:     0,
            insects:        0,
            medical:        0,
            shock:          0,
            animal_cruelty: 0,
            nsfw_porn:      0,
            nsfw_sexy:      0
        };

        if (!matched) {
            // 매칭되지 않음 = 안전
            return {
                riskScore:      0,
                detailedScores: baseCategories,
                categories:     baseCategories,
                source:         'hash-db',
                matched:        false,
                bloomFiltered:  data.bloomFiltered || false
            };
        }

        // 매칭됨 = 위험
        // severity를 riskScore로 변환 (1-5 → 0.0-1.0)
        const severity   = image?.severity || 5;
        const riskScore  = severity / 5;
        const categoryId = image?.category || 1;
        const categories = this.mapCategoryToScores(categoryId, severity);

        return {
            riskScore:      riskScore,
            detailedScores: categories,
            categories:     categories,
            source:         'hash-db',
            matched:        true,
            matchType:      matchType,
            distance:       distance,
            imageId:        image?.id,
            severity:       severity
        };
    }

    /**
     * 카테고리 ID를 점수로 매핑
     * @param {number} categoryId - 카테고리 ID
     * @param {number} severity - 심각도 (1-5)
     * @returns {object}
     */
    mapCategoryToScores(categoryId, severity) {
        const score = severity / 5; // 0.0 - 1.0

        const baseCategories = {
            gore:           0,
            violence:       0,
            death:          0,
            disturbing:     0,
            insects:        0,
            medical:        0,
            shock:          0,
            animal_cruelty: 0,
            nsfw_porn:      0,
            nsfw_sexy:      0
        };

        // API 문서의 카테고리 매핑
        const categoryMap = {
            1:  { gore: score },
            2:  { violence: score },
            3:  { death: score },
            4:  { disturbing: score },
            5:  { insects: score },
            6:  { medical: score },
            7:  { shock: score },
            8:  { animal_cruelty: score },
            9:  { nsfw_porn: score },
            10: { nsfw_sexy: score }
        };

        const mapped = categoryMap[categoryId] || { disturbing: score };

        return { ...baseCategories, ...mapped };
    }

    /**
     * 서버 연결을 테스트한다
     * @returns {Promise<boolean>}
     */
    async testConnection() {
        try {
            const response = await fetch(`${this.serverUrl}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
            });

            if (!response.ok) {
                return false;
            }

            const data = await response.json();
            return data.status === 'ok' && data.dbConnected === true;
        } catch (error) {
            console.error('[Kas-Free] Hash Checker 연결 테스트 실패:', error);
            return false;
        }
    }
}
