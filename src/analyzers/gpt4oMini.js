/**
 * GPT-4o-mini API 분석기
 * @author 최진호
 * @date 2026-01-31
 * @version 1.0.0
 * @remarks OpenAI Vision API를 사용한 이미지 분석
 */

import { ApiError, fetchWithTimeout, handleHttpError } from '../utils/errorHandler.js';
import { API_ENDPOINTS, API_TIMEOUT } from '../utils/constants.js';

/**
 * GPT-4o-mini 분석기 클래스
 */
export class Gpt4oMiniAnalyzer {
    /**
     * @param {string} apiKey - OpenAI API 키
     */
    constructor(apiKey) {
        this.apiKey  = apiKey;
        this.name    = 'GPT-4o-mini';
        this.enabled = !!apiKey;
        this.model   = 'gpt-4o-mini';
    }

    /**
     * 이미지를 분석한다
     * @param {string} imageBase64 - Base64 인코딩된 이미지 (data URI 형식)
     * @returns {Promise<object>}
     */
    async analyze(imageBase64) {
        if (!this.enabled) {
            throw new ApiError('API 키가 설정되지 않았습니다.', 401, this.name);
        }

        try {
            const requestBody = this.buildRequestBody(imageBase64);

            const response = await fetchWithTimeout(
                API_ENDPOINTS.OPENAI,
                {
                    method:  'POST',
                    headers: {
                        'Content-Type':  'application/json',
                        'Authorization': `Bearer ${this.apiKey}`
                    },
                    body: JSON.stringify(requestBody)
                },
                API_TIMEOUT,
                this.name
            );

            if (!response.ok) {
                await handleHttpError(response, this.name);
            }

            const data = await response.json();
            return this.transformResult(data);
        } catch (error) {
            if (error instanceof ApiError) {
                throw error;
            }
            throw new ApiError(error.message, 'UNKNOWN', this.name);
        }
    }

    /**
     * API 요청 본문을 생성한다
     * @param {string} imageBase64 - Base64 인코딩된 이미지 (data URI 형식)
     * @returns {object}
     */
    buildRequestBody(imageBase64) {
        return {
            model:      this.model,
            max_tokens: 256,
            messages: [
                {
                    role: 'system',
                    content: 'You MUST respond in Korean language (한국어) for all description fields. English responses are NOT acceptable.'
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: this.getPrompt()
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url:    imageBase64,
                                detail: 'low'
                            }
                        }
                    ]
                }
            ]
        };
    }

    /**
     * 분석 프롬프트를 반환한다
     * @returns {string}
     */
    getPrompt() {
        return `Analyze this image for potentially harmful or disturbing content.
Rate each category from 0.0 (none) to 1.0 (extreme):

1. gore: Body mutilation, blood, exposed organs, graphic injuries
2. violence: Physical assault, fighting, torture, war scenes
3. death: Corpses, suicide, execution scenes
4. disturbing: Feces, bodily fluids, decay, general disturbing content
5. insects: Insect swarms, parasites, creepy creatures
6. medical: Surgery, skin diseases, deformities, body horror
7. shock: Jump scares, uncanny valley, horror memes
8. animal_cruelty: Animal abuse, carcasses, slaughter
9. nsfw_porn: Explicit sexual content
10. nsfw_sexy: Suggestive but not explicit content

**CRITICAL REQUIREMENT: You MUST write the "description" field in KOREAN language (한국어). Do NOT use English.**

Respond ONLY in this exact JSON format:
{"gore":0.0,"violence":0.0,"death":0.0,"disturbing":0.0,"insects":0.0,"medical":0.0,"shock":0.0,"animal_cruelty":0.0,"nsfw_porn":0.0,"nsfw_sexy":0.0,"description":"한글로 이미지 설명"}

Be strict and conservative. When uncertain, score higher rather than lower.`;
    }

    /**
     * API 응답을 변환한다
     * @param {object} data - API 응답 데이터
     * @returns {object}
     */
    transformResult(data) {
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            throw new ApiError('유효하지 않은 응답입니다.', 'INVALID_RESPONSE', this.name);
        }

        const text = data.choices[0].message.content.trim();
        let categories;

        try {
            /** JSON 파싱 시도 */
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                categories = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('JSON 형식이 아닙니다.');
            }
        } catch (parseError) {
            console.error('[Kas-Free] GPT-4o response parse error:', parseError, text);
            throw new ApiError('응답 파싱 실패', 'PARSE_ERROR', this.name);
        }

        /** 값 범위 검증 및 정규화 */
        const normalizedCategories = {};
        for (const [key, value] of Object.entries(categories)) {
            if (key !== 'description') {
                normalizedCategories[key] = Math.max(0, Math.min(1, parseFloat(value) || 0));
            }
        }

        /** 위험 점수 계산 */
        const riskScore = this.calculateRiskScore(normalizedCategories);

        return {
            source:         'gpt4o-mini',
            detailedScores: normalizedCategories,
            categories:     normalizedCategories,
            riskScore,
            description:    categories.description || '',
            raw:            text,
            timestamp:      Date.now()
        };
    }

    /**
     * 위험 점수를 계산한다
     * @param {object} categories - 카테고리별 점수
     * @returns {number} 0.0 ~ 1.0
     */
    calculateRiskScore(categories) {
        /** 카테고리별 가중치 */
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
            const weight = weights[category] || 0;
            weightedSum += score * weight;
            totalWeight += weight;
        }

        return totalWeight > 0 ? weightedSum / totalWeight : 0;
    }

    /**
     * API 연결을 테스트한다
     * @returns {Promise<boolean>}
     */
    async testConnection() {
        try {
            const response = await fetchWithTimeout(
                API_ENDPOINTS.OPENAI,
                {
                    method:  'POST',
                    headers: {
                        'Content-Type':  'application/json',
                        'Authorization': `Bearer ${this.apiKey}`
                    },
                    body: JSON.stringify({
                        model:      this.model,
                        max_tokens: 10,
                        messages: [
                            { role: 'user', content: 'Hi' }
                        ]
                    })
                },
                5000,
                this.name
            );
            return response.ok;
        } catch (error) {
            console.error('[Kas-Free] GPT-4o API test failed:', error);
            return false;
        }
    }
}
