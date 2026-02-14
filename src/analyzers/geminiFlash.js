/**
 * Gemini Flash 분석기
 * @author 최진호
 * @date 2026-02-01
 * @remarks Google Gemini 1.5 Flash API 사용
 */

/**
 * AI 분석 프롬프트 (API 문서 기준)
 */
const ANALYSIS_PROMPT = `You are an image content safety analyzer. Analyze the provided image and return a JSON response following the exact schema below.

**CRITICAL REQUIREMENT: You MUST write "description" and "reasoning" fields in KOREAN language (한국어). Do NOT use English for these fields.**

## Analysis Categories

Score each category from 0.0 to 1.0:
- gore: Body mutilation, blood, exposed organs, graphic injuries
- violence: Physical assault, fighting, torture, war scenes
- death: Corpses, suicide, execution scenes
- disturbing: Feces, bodily fluids, decay, general disturbing content
- insects: Insect swarms, parasites, creepy creatures
- medical: Surgery, skin diseases, deformities, body horror
- shock: Jump scares, uncanny valley, horror memes
- animal_cruelty: Animal abuse, carcasses, slaughter
- nsfw_porn: Explicit sexual content
- nsfw_sexy: Suggestive but not explicit content

## Severity Levels

1: Mild - slightly uncomfortable
2: Low - noticeable but tolerable
3: Medium - clearly disturbing
4: High - very disturbing
5: Extreme - traumatic/illegal content

## Suggested Actions

- block: Immediately block, do not display
- warn: Show warning before display
- blur: Display blurred with option to reveal
- pass: Safe to display

## Response Schema (STRICT JSON)

Return ONLY valid JSON matching this exact schema:

{
  "scores": {
    "gore": 0.0,
    "violence": 0.0,
    "death": 0.0,
    "disturbing": 0.0,
    "insects": 0.0,
    "medical": 0.0,
    "shock": 0.0,
    "animal_cruelty": 0.0,
    "nsfw_porn": 0.0,
    "nsfw_sexy": 0.0
  },
  "detected_categories": [],
  "description": "",
  "reasoning": "",
  "suggested_severity": 1,
  "suggested_action": "pass",
  "final_score": 0.0,
  "is_harmful": false
}

Rules:
- Return ONLY valid JSON, no markdown or explanation
- final_score = weighted average emphasizing highest risk category
- is_harmful = true if any score >= 0.7 or severity >= 4
- detected_categories can be empty array if image is safe
- Be conservative: when uncertain, score higher rather than lower`;

export class GeminiFlashAnalyzer {
    constructor(apiKey) {
        this.name = 'Gemini Flash';
        this.apiKey = apiKey;
        this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
        this.model = 'gemini-1.5-flash';
    }

    /**
     * 이미지를 분석한다
     * @param {string} base64Image - Base64 인코딩된 이미지
     * @param {string} reporterId - 신고자 ID (선택)
     * @returns {Promise<object>}
     */
    async analyze(base64Image, reporterId = null) {
        try {
            // "data:image/jpeg;base64," 제거
            const imageData = base64Image.includes(',')
                ? base64Image.split(',')[1]
                : base64Image;

            const response = await fetch(
                `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        systemInstruction: {
                            parts: [{
                                text: 'You MUST respond in Korean language (한국어) for all description and reasoning fields. English responses are NOT acceptable.'
                            }]
                        },
                        contents: [{
                            parts: [
                                { text: ANALYSIS_PROMPT },
                                {
                                    inline_data: {
                                        mime_type: 'image/jpeg',
                                        data: imageData
                                    }
                                }
                            ]
                        }],
                        generationConfig: {
                            temperature: 0.4,
                            topK: 32,
                            topP: 1,
                            maxOutputTokens: 1024,
                            responseMimeType: 'application/json'
                        }
                    })
                }
            );

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error?.message || `HTTP ${response.status}`);
            }

            const data = await response.json();

            // Gemini 응답 구조: { candidates: [{ content: { parts: [{ text: "..." }] } }] }
            const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!textResponse) {
                throw new Error('Invalid Gemini response structure');
            }

            // JSON 파싱
            const analysis = JSON.parse(textResponse);

            return this.transformResult(analysis);
        } catch (error) {
            console.error('[Kas-Free] Gemini Flash 분석 실패:', error);
            throw error;
        }
    }

    /**
     * Gemini 결과를 표준 형식으로 변환
     * @param {object} analysis - Gemini 분석 결과
     * @returns {object}
     */
    transformResult(analysis) {
        const { scores, final_score, detected_categories } = analysis;

        return {
            riskScore:          final_score || 0,
            detailedScores:     scores,
            categories:         scores,
            source:             'gemini-flash',
            detectedCategories: detected_categories || [],
            description:        analysis.description,
            reasoning:          analysis.reasoning,
            suggestedSeverity:  analysis.suggested_severity,
            suggestedAction:    analysis.suggested_action,
            isHarmful:          analysis.is_harmful
        };
    }

    /**
     * API 연결을 테스트한다
     * @returns {Promise<boolean>}
     */
    async testConnection() {
        try {
            const response = await fetch(
                `${this.baseUrl}/models/${this.model}?key=${this.apiKey}`,
                {
                    method: 'GET',
                    signal: AbortSignal.timeout(5000)
                }
            );

            return response.ok;
        } catch (error) {
            console.error('[Kas-Free] Gemini Flash 연결 테스트 실패:', error);
            return false;
        }
    }

    /**
     * 에러가 폴백 가능한지 확인
     * @returns {boolean}
     */
    needsFallback() {
        // 429 (Rate Limit), 500+ (Server Error) 등은 폴백
        return true;
    }
}
