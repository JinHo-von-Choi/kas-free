/**
 * 이미지 분석기 통합 매니저
 * @author 최진호
 * @date 2026-01-31
 * @version 1.0.0
 * @remarks 1차 검증(NSFW.js) + 2차 검증(API) 폴백 로직 관리
 */

import { NsfwjsAnalyzer } from './nsfwjs.js';
import { GeminiFlashAnalyzer } from './geminiFlash.js';
import { ClaudeHaikuAnalyzer } from './claudeHaiku.js';
import { Gpt4oMiniAnalyzer } from './gpt4oMini.js';
import { imageUrlToBase64 } from '../utils/imageEncoder.js';
import { logError } from '../utils/errorHandler.js';

/**
 * 분석기 매니저 클래스
 */
export class AnalyzerManager {
    /**
     * @param {object} settings - 설정 객체
     */
    constructor(settings) {
        this.settings       = settings;
        this.nsfwjs         = new NsfwjsAnalyzer();
        this.apiAnalyzers   = [];
        this.debugMode      = settings.debugMode || false;

        this.initializeApiAnalyzers();
    }

    /**
     * API 분석기들을 초기화한다
     */
    initializeApiAnalyzers() {
        const { apis } = this.settings;
        const analyzers = [];

        if (apis.geminiFlash?.enabled && apis.geminiFlash?.apiKey) {
            analyzers.push({
                priority: apis.geminiFlash.priority,
                analyzer: new GeminiFlashAnalyzer(apis.geminiFlash.apiKey)
            });
        }

        if (apis.claudeHaiku?.enabled && apis.claudeHaiku?.apiKey) {
            analyzers.push({
                priority: apis.claudeHaiku.priority,
                analyzer: new ClaudeHaikuAnalyzer(apis.claudeHaiku.apiKey)
            });
        }

        if (apis.gpt4oMini?.enabled && apis.gpt4oMini?.apiKey) {
            analyzers.push({
                priority: apis.gpt4oMini.priority,
                analyzer: new Gpt4oMiniAnalyzer(apis.gpt4oMini.apiKey)
            });
        }

        /** 우선순위 순으로 정렬 */
        this.apiAnalyzers = analyzers.sort((a, b) => a.priority - b.priority);
    }

    /**
     * 설정을 업데이트한다
     * @param {object} settings - 새 설정
     */
    updateSettings(settings) {
        this.settings  = settings;
        this.debugMode = settings.debugMode || false;
        this.initializeApiAnalyzers();
    }

    /**
     * NSFW.js 모델을 로드한다
     * @returns {Promise<boolean>}
     */
    async loadModel() {
        return this.nsfwjs.loadModel();
    }

    /**
     * 이미지를 분석한다 (1차 + 2차 검증)
     * @param {string} imageUrl - 이미지 URL
     * @returns {Promise<object>}
     */
    async analyze(imageUrl) {
        this.log('분석 시작:', imageUrl);

        let primaryResult = null;
        let secondaryResult = null;

        /** 1차 검증: NSFW.js */
        try {
            primaryResult = await this.nsfwjs.analyze(imageUrl);
            this.log('1차 검증 결과:', primaryResult);
        } catch (error) {
            logError('NSFW.js 분석', error, this.debugMode);
            /** 1차 검증 실패 시 2차 검증으로 진행 */
        }

        /** 1차 검증 결과 판정 */
        if (primaryResult) {
            const status = this.determineStatus(primaryResult.riskScore);

            /** 명확하게 안전하거나 위험한 경우 */
            if (status === 'safe' || status === 'danger') {
                return this.buildFinalResult(primaryResult, null, status);
            }

            /** 애매한 경우 2차 검증 진행 */
            if (!this.nsfwjs.isAmbiguous(primaryResult, this.settings.thresholds)) {
                return this.buildFinalResult(primaryResult, null, status);
            }
        }

        /** 2차 검증: API (활성화된 경우에만) */
        if (this.apiAnalyzers.length > 0) {
            try {
                const imageBase64 = await imageUrlToBase64(imageUrl);
                secondaryResult   = await this.runSecondaryAnalysis(imageBase64);
                this.log('2차 검증 결과:', secondaryResult);
            } catch (error) {
                logError('2차 검증', error, this.debugMode);
            }
        }

        /** 최종 결과 결정 */
        if (secondaryResult) {
            const status = this.determineStatus(secondaryResult.riskScore);
            return this.buildFinalResult(primaryResult, secondaryResult, status);
        }

        /** 1차 결과만으로 판정 (2차 검증 실패 또는 미설정) */
        if (primaryResult) {
            const status = this.determineStatus(primaryResult.riskScore);
            return this.buildFinalResult(primaryResult, null, status);
        }

        /** 모두 실패 */
        return {
            status:       'error',
            riskScore:    0,
            categories:   {},
            primary:      null,
            secondary:    null,
            error:        '이미지 분석에 실패했습니다.',
            timestamp:    Date.now()
        };
    }

    /**
     * 2차 검증을 실행한다 (폴백 로직)
     * @param {string} imageBase64 - Base64 인코딩된 이미지
     * @returns {Promise<object|null>}
     */
    async runSecondaryAnalysis(imageBase64) {
        for (const { analyzer } of this.apiAnalyzers) {
            try {
                this.log(`2차 검증 시도: ${analyzer.name}`);
                const result = await analyzer.analyze(imageBase64);
                return result;
            } catch (error) {
                logError(`${analyzer.name} API`, error, this.debugMode);

                /** 다음 API로 폴백 */
                if (error.needsFallback && error.needsFallback()) {
                    this.log(`${analyzer.name} 실패, 다음 API로 폴백`);
                    continue;
                }

                /** 폴백 불가능한 에러 */
                throw error;
            }
        }

        return null;
    }

    /**
     * 위험 점수로 상태를 결정한다
     * @param {number} riskScore - 위험 점수
     * @returns {string}
     */
    determineStatus(riskScore) {
        const { safeMax, cautionMax } = this.settings.thresholds;

        if (riskScore < safeMax) {
            return 'safe';
        } else if (riskScore < cautionMax) {
            return 'caution';
        } else {
            return 'danger';
        }
    }

    /**
     * 최종 결과를 생성한다
     * @param {object|null} primary - 1차 검증 결과
     * @param {object|null} secondary - 2차 검증 결과
     * @param {string} status - 상태
     * @returns {object}
     */
    buildFinalResult(primary, secondary, status) {
        /** 2차 검증 결과가 있으면 우선 사용 */
        const mainResult = secondary || primary;

        return {
            status,
            riskScore:    mainResult?.riskScore || 0,
            categories:   mainResult?.categories || {},
            primary:      primary,
            secondary:    secondary,
            source:       mainResult?.source || 'unknown',
            timestamp:    Date.now()
        };
    }

    /**
     * API 연결 상태를 확인한다
     * @returns {Promise<object>}
     */
    async checkApiStatus() {
        const status = {
            nsfwjs:      false,
            geminiFlash: false,
            claudeHaiku: false,
            gpt4oMini:   false
        };

        /** NSFW.js 상태 */
        try {
            status.nsfwjs = this.nsfwjs.isLoaded || await this.nsfwjs.loadModel();
        } catch {
            status.nsfwjs = false;
        }

        /** API 상태 (병렬 체크) */
        const apiChecks = this.apiAnalyzers.map(async ({ analyzer }) => {
            const isConnected = await analyzer.testConnection();
            const key = analyzer.name.toLowerCase().replace(/[^a-z0-9]/g, '');

            if (key.includes('gemini')) {
                status.geminiFlash = isConnected;
            } else if (key.includes('claude')) {
                status.claudeHaiku = isConnected;
            } else if (key.includes('gpt')) {
                status.gpt4oMini = isConnected;
            }
        });

        await Promise.allSettled(apiChecks);

        return status;
    }

    /**
     * 디버그 로그를 출력한다
     * @param  {...any} args - 로그 인자
     */
    log(...args) {
        if (this.debugMode) {
            console.log('[Kas-Free]', ...args);
        }
    }

    /**
     * 리소스를 정리한다
     */
    dispose() {
        this.nsfwjs.dispose();
    }
}
