/**
 * NSFW.js 서버 분석기
 * @author 최진호
 * @date 2026-01-31
 * @remarks https://nsfw.nerdvana.kr API 사용
 */

export class NsfwjsServerAnalyzer {
    constructor(serverUrl = 'https://nsfw.nerdvana.kr') {
        this.name = 'NSFW.js Server';
        this.serverUrl = serverUrl;
    }

    /**
     * 이미지를 분석한다
     * @param {string} base64Image - Base64 인코딩된 이미지
     * @param {string} reporterId - 신고자 ID (필수)
     * @returns {Promise<object>}
     */
    async analyze(base64Image, reporterId) {
        try {
            if (!reporterId) {
                throw new Error('reporterId는 필수 파라미터입니다');
            }

            // "data:image/jpeg;base64," 제거
            const imageData = base64Image.includes(',')
                ? base64Image.split(',')[1]
                : base64Image;

            const requestBody = {
                image:      imageData,
                reporterId: reporterId
            };

            const response = await fetch(`${this.serverUrl}/api/analyze`, {
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

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            return this.transformResult(data.predictions);
        } catch (error) {
            console.error('[Kas-Free] NSFW.js 서버 분석 실패:', error);
            throw error;
        }
    }

    /**
     * 이미지가 혐오 이미지 DB에 등록되어 있는지 확인한다
     * 서버에서 해시를 생성하여 DB 조회
     * @param {string} base64Image - Base64 인코딩된 이미지
     * @param {string} reporterId - 신고자 ID (필수)
     * @returns {Promise<object>}
     */
    async check(base64Image, reporterId) {
        try {
            if (!reporterId) {
                throw new Error('reporterId는 필수 파라미터입니다');
            }

            const imageData = base64Image.includes(',')
                ? base64Image.split(',')[1]
                : base64Image;

            const requestBody = {
                image:      imageData,
                reporterId: reporterId
            };

            const response = await fetch(`${this.serverUrl}/api/check`, {
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

            return this.transformCheckResult(result.data);
        } catch (error) {
            console.error('[Kas-Free] 이미지 검사 실패:', error);
            throw error;
        }
    }

    /**
     * 검사 결과를 표준 형식으로 변환
     * @param {object} data - API 응답 데이터
     * @returns {object}
     */
    transformCheckResult(data) {
        const { matched, matchType, distance, image, hashes } = data;

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
            return {
                riskScore:      0,
                detailedScores: baseCategories,
                categories:     baseCategories,
                source:         'nsfw-server-check',
                matched:        false,
                hashes:         hashes
            };
        }

        const severity   = image?.severity || 5;
        const riskScore  = severity / 5;
        const categoryId = image?.category || 1;
        const categories = this.mapCategoryToScores(categoryId, severity);

        return {
            riskScore:      riskScore,
            detailedScores: categories,
            categories:     categories,
            source:         'nsfw-server-check',
            matched:        true,
            matchType:      matchType,
            distance:       distance,
            imageId:        image?.id,
            severity:       severity,
            hashes:         hashes
        };
    }

    /**
     * 카테고리 ID를 점수로 매핑
     * @param {number} categoryId - 카테고리 ID
     * @param {number} severity - 심각도 (1-5)
     * @returns {object}
     */
    mapCategoryToScores(categoryId, severity) {
        const score = severity / 5;

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
     * 사용 가능한 신고 카테고리 목록을 조회한다
     * @returns {Promise<Array>}
     */
    async getCategories() {
        try {
            const response = await fetch(`${this.serverUrl}/api/categories`, {
                method: 'GET'
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `서버 응답 오류: ${response.status}`);
            }

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || '카테고리 조회 실패');
            }

            return result.data;
        } catch (error) {
            console.error('[Kas-Free] 카테고리 조회 실패:', error);
            throw error;
        }
    }

    /**
     * 클라이언트 AI 분석 결과를 기반으로 이미지를 신고한다 (v2)
     * 서버는 해시 생성 + 임베딩만 담당, AI 검증 비용은 클라이언트 부담
     *
     * @param {object} params - 신고 파라미터
     * @param {string} params.imageUrl - 이미지 URL (필수)
     * @param {object} params.analysis - 클라이언트 AI 분석 결과 (필수)
     * @param {object} params.analysis.scores - 카테고리별 점수 (필수)
     * @param {string} params.analysis.suggestedAction - 권장 조치 (선택)
     * @param {boolean} params.analysis.is_harmful - 유해 여부 (선택)
     * @param {number} params.analysis.suggested_severity - 권장 심각도 1-5 (선택)
     * @param {number} params.analysis.final_score - 최종 점수 (선택)
     * @param {string} params.analysis.description - 이미지 설명 (선택)
     * @param {string} params.analysis.reasoning - 판단 근거 (선택)
     * @param {string} params.category - 카테고리 코드 (필수)
     * @param {string} params.reporterId - 신고자 ID (nerd 시그니처 필수)
     * @param {string} params.pageUrl - 페이지 URL (선택)
     * @param {string} params.reason - 신고 사유 (선택)
     * @param {object} params.provider - AI 제공자 정보 (선택)
     * @returns {Promise<object>}
     */
    async reportV2(params) {
        try {
            const {
                imageUrl,
                analysis,
                category,
                reporterId,
                pageUrl,
                reason,
                provider
            } = params;

            // 필수 필드 검증
            if (!imageUrl) {
                throw new Error('imageUrl은 필수 파라미터입니다');
            }
            if (!analysis || !analysis.scores) {
                throw new Error('analysis.scores는 필수 파라미터입니다');
            }
            if (!category) {
                throw new Error('category는 필수 파라미터입니다');
            }
            if (!reporterId) {
                throw new Error('reporterId는 필수 파라미터입니다');
            }

            const requestBody = {
                imageUrl:   imageUrl,
                analysis:   analysis,
                category:   category,
                reporterId: reporterId
            };

            // 선택 필드 추가
            if (pageUrl) {
                requestBody.pageUrl = pageUrl;
            }
            if (reason) {
                requestBody.reason = reason;
            }
            if (provider) {
                requestBody.provider = provider;
            }

            console.log('[Kas-Free] /api/report/v2 요청 body:', {
                imageUrl: requestBody.imageUrl,
                category: requestBody.category,
                reporterId: requestBody.reporterId,
                pageUrl: requestBody.pageUrl,
                reason: requestBody.reason,
                analysis: requestBody.analysis,
                provider: requestBody.provider
            });

            const response = await fetch(`${this.serverUrl}/api/report/v2`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));

                console.error('[Kas-Free] /api/report/v2 오류 상세:', {
                    status: response.status,
                    errorData: errorData,
                    requestBody: requestBody
                });

                // 403 차단 응답 처리
                if (response.status === 403) {
                    throw new Error(
                        `신고 차단: ${errorData.message || '허위 신고로 인한 제재 중'}\n` +
                        `타입: ${errorData.banType || 'unknown'}\n` +
                        `만료: ${errorData.expiresAt || '영구'}`
                    );
                }

                throw new Error(errorData.error || errorData.message || `서버 응답 오류: ${response.status}`);
            }

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || '신고 실패');
            }

            return result.data;
        } catch (error) {
            console.error('[Kas-Free] 이미지 신고 v2 실패:', error);
            throw error;
        }
    }

    /**
     * NSFW.js 결과를 표준 형식으로 변환
     * @param {Array} predictions - NSFW.js 예측 결과
     * @returns {object}
     */
    transformResult(predictions) {
        const nsfwCategories = {};
        predictions.forEach(p => {
            nsfwCategories[p.className.toLowerCase()] = p.probability;
        });

        // 10개 카테고리로 매핑 (NSFW.js는 성인물만 지원)
        const detailedScores = {
            gore:           0,
            violence:       0,
            death:          0,
            disturbing:     0,
            insects:        0,
            medical:        0,
            shock:          0,
            animal_cruelty: 0,
            nsfw_porn:      nsfwCategories.porn || 0,
            nsfw_sexy:      nsfwCategories.sexy || 0
        };

        // 위험 점수 계산
        const riskScore = Math.max(
            detailedScores.nsfw_porn * 0.5,
            detailedScores.nsfw_sexy * 0.3
        );

        return {
            riskScore,
            detailedScores: detailedScores,
            categories:     detailedScores,
            source:         'nsfwjs-server',
            rawPredictions: predictions
        };
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
            return data.status === 'ok' && data.nsfwModel === true;
        } catch (error) {
            console.error('[Kas-Free] NSFW 서버 연결 테스트 실패:', error);
            return false;
        }
    }
}
