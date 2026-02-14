/**
 * AI 검증 핸들러
 * @author 최진호
 * @date 2026-02-12
 * @version 1.1.0
 * @remarks AI API를 사용한 이미지 검증 처리
 */

import { ApiClient, ApiError } from './ApiClient.js';
import { imageUrlToBase64 } from '../utils/imageEncoder.js';

/**
 * AI 검증 핸들러 클래스
 */
export class AIVerificationHandler {
    /**
     * @param {object} settings - 설정 객체
     * @param {object} nsfwServer - NSFW 서버 인스턴스
     */
    constructor(settings, nsfwServer) {
        this.settings = settings;
        this.nsfwServer = nsfwServer;
        this.apiClient = new ApiClient({
            timeout: 30000,      // 30초
            maxRetries: 3,       // 최대 3회 재시도
            baseDelay: 1000      // 초기 지연 1초
        });
    }

    /**
     * 설정 업데이트
     * @param {object} settings - 새 설정
     */
    updateSettings(settings) {
        this.settings = settings;
    }

    /**
     * AI 검증 요청 처리
     * @param {object} message - 메시지 객체
     * @param {function} fetchPostImage - 게시글 이미지 추출 함수
     * @param {function} getOrCreateReporterId - reporterId 생성 함수
     * @returns {Promise<object>}
     */
    async handleVerification(message, fetchPostImage, getOrCreateReporterId) {
        const { postUrl, imageUrl: providedImageUrl } = message;

        if (!this.settings.enabled) {
            return {
                error: '확장 프로그램이 비활성화되어 있습니다.',
                userFriendly: true
            };
        }

        try {
            console.log('[AIVerification] AI 검증 요청:', { postUrl, providedImageUrl });

            // 이미지 URL 확인
            let imageUrl = providedImageUrl;

            if (!imageUrl) {
                console.log('[AIVerification] 이미지 URL 누락, 게시글에서 추출 시도');
                imageUrl = await fetchPostImage(postUrl);
            }

            if (!imageUrl) {
                return {
                    status: 'unchecked',
                    riskScore: 0,
                    categories: {},
                    error: '이미지를 찾을 수 없습니다.',
                    userFriendly: true
                };
            }

            // AI API 확인
            const enabledApi = this.getEnabledAIApi();

            if (!enabledApi) {
                return {
                    status: 'error',
                    riskScore: 0,
                    categories: {},
                    error: 'AI API가 설정되지 않았습니다.\n\n설정 페이지에서 API 키를 입력해주세요.',
                    userFriendly: true
                };
            }

            console.log('[AIVerification] AI 검증 시작:', { imageUrl, api: enabledApi.name });

            // AI 분석
            const analysis = await this.analyzeWithAI(imageUrl, enabledApi);

            console.log('[AIVerification] AI 분석 완료:', analysis);

            // 유해 이미지 처리
            if (analysis.is_harmful) {
                return await this.handleHarmfulImage(
                    imageUrl,
                    analysis,
                    postUrl,
                    enabledApi,
                    getOrCreateReporterId
                );
            } else {
                return this.handleSafeImage(analysis);
            }
        } catch (error) {
            console.error('[AIVerification] AI 검증 실패:', error);

            // 사용자 친화적 에러 메시지
            let userMessage = error.message;

            if (error instanceof ApiError) {
                if (error.statusCode === 408) {
                    userMessage = '⏱️ AI 분석 시간이 초과되었습니다.\n\n잠시 후 다시 시도해주세요.';
                } else if (error.statusCode === 429) {
                    userMessage = '⚠️ API 호출 한도를 초과했습니다.\n\n잠시 후 다시 시도하거나 다른 API를 설정해주세요.';
                } else if (error.statusCode === 401 || error.statusCode === 403) {
                    userMessage = '🔑 API 키가 유효하지 않습니다.\n\n설정 페이지에서 API 키를 확인해주세요.';
                } else if (error.statusCode >= 500) {
                    userMessage = '🔧 AI 서버에 일시적인 문제가 발생했습니다.\n\n잠시 후 다시 시도해주세요.';
                }
            } else if (error.name === 'TypeError') {
                userMessage = '🌐 네트워크 연결을 확인해주세요.\n\n인터넷 연결이 불안정하거나 방화벽이 차단하고 있을 수 있습니다.';
            }

            return {
                status: 'error',
                riskScore: 0,
                categories: {},
                error: userMessage,
                userFriendly: true
            };
        }
    }

    /**
     * AI로 이미지 분석
     * @param {string} imageUrl - 이미지 URL
     * @param {object} apiConfig - API 설정
     * @returns {Promise<object>}
     */
    async analyzeWithAI(imageUrl, apiConfig) {
        const isDcImage = imageUrl.includes('dcinside') || imageUrl.includes('dcimg');
        let imageData;

        // 디시인사이드 이미지는 Base64 변환 필요
        if (isDcImage) {
            console.log('[AIVerification] 디시인사이드 이미지 감지, Base64 변환');
            const base64 = await imageUrlToBase64(imageUrl);
            imageData = `data:image/jpeg;base64,${base64}`;
        } else {
            imageData = imageUrl;
        }

        // API 호출
        try {
            if (apiConfig.name === 'gpt4oMini') {
                return await this.apiClient.callGpt4oMini(apiConfig.apiKey, imageData);
            } else if (apiConfig.name === 'claudeHaiku') {
                return await this.apiClient.callClaudeHaiku(apiConfig.apiKey, imageData, isDcImage);
            } else if (apiConfig.name === 'geminiFlash') {
                return await this.apiClient.callGeminiFlash(apiConfig.apiKey, imageData, isDcImage);
            }

            throw new Error(`지원하지 않는 API: ${apiConfig.name}`);
        } catch (error) {
            // ApiError는 그대로 전파
            if (error instanceof ApiError) {
                throw error;
            }

            // 기타 에러는 ApiError로 래핑
            throw new ApiError(error.message, 0, false);
        }
    }

    /**
     * 유해 이미지 처리
     * @param {string} imageUrl - 이미지 URL
     * @param {object} analysis - AI 분석 결과
     * @param {string} postUrl - 게시글 URL
     * @param {object} apiConfig - API 설정
     * @param {function} getOrCreateReporterId - reporterId 생성 함수
     * @returns {Promise<object>}
     */
    async handleHarmfulImage(imageUrl, analysis, postUrl, apiConfig, getOrCreateReporterId) {
        console.log('[AIVerification] ✅ 유해 이미지 감지!');
        console.log('[AIVerification] - 카테고리:', this.getTopCategory(analysis.scores));
        console.log('[AIVerification] - 점수:', analysis.scores);

        let reportSuccess = false;
        let reportError = null;

        // 서버 신고 시도
        try {
            console.log('[AIVerification] 서버 신고 시작...');

            const reporterId = await getOrCreateReporterId();
            const category = this.getTopCategory(analysis.scores);

            const reportResult = await this.nsfwServer.reportV2({
                imageUrl: imageUrl,
                analysis: analysis,
                category: category,
                reporterId: reporterId,
                pageUrl: postUrl,
                reason: '클라이언트 AI 분석 결과 자동 신고',
                provider: {
                    name: apiConfig.providerName,
                    model: apiConfig.model
                }
            });

            reportSuccess = true;
            console.log('[AIVerification] ✅ 서버 신고 완료:', reportResult);
        } catch (error) {
            reportError = error.message;
            console.error('[AIVerification] ❌ 서버 신고 실패 (AI 결과는 반환):', error);
        }

        return {
            status: 'danger',
            riskScore: analysis.final_score || 0.9,
            categories: analysis.scores,
            source: 'client-ai',
            aiAnalysis: analysis,
            reported: reportSuccess,
            reportError: reportError
        };
    }

    /**
     * 안전 이미지 처리
     * @param {object} analysis - AI 분석 결과
     * @returns {object}
     */
    handleSafeImage(analysis) {
        console.log('[AIVerification] ✅ 안전 이미지 판정');

        return {
            status: 'safe',
            riskScore: analysis.final_score || 0.1,
            categories: analysis.scores,
            source: 'client-ai',
            aiAnalysis: analysis
        };
    }

    /**
     * 활성화된 AI API 찾기
     * @returns {object|null}
     */
    getEnabledAIApi() {
        const { apis } = this.settings;

        if (apis.gpt4oMini?.enabled && apis.gpt4oMini?.apiKey) {
            return {
                name: 'gpt4oMini',
                apiKey: apis.gpt4oMini.apiKey,
                providerName: 'openai',
                model: 'gpt-4o-mini'
            };
        }

        if (apis.claudeHaiku?.enabled && apis.claudeHaiku?.apiKey) {
            return {
                name: 'claudeHaiku',
                apiKey: apis.claudeHaiku.apiKey,
                providerName: 'claude',
                model: 'claude-3-5-haiku-20241022'
            };
        }

        if (apis.geminiFlash?.enabled && apis.geminiFlash?.apiKey) {
            return {
                name: 'geminiFlash',
                apiKey: apis.geminiFlash.apiKey,
                providerName: 'google',
                model: 'gemini-1.5-flash'
            };
        }

        return null;
    }

    /**
     * 점수가 가장 높은 카테고리 찾기
     * @param {object} scores - 카테고리별 점수
     * @returns {string}
     */
    getTopCategory(scores) {
        let maxScore = 0;
        let topCategory = 'disturbing';

        for (const [category, score] of Object.entries(scores)) {
            if (score > maxScore) {
                maxScore = score;
                topCategory = category;
            }
        }

        return topCategory;
    }
}
