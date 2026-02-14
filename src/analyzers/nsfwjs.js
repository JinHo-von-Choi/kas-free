/**
 * NSFW.js 분석기 래퍼
 * @author 최진호
 * @date 2026-01-31
 * @version 1.0.0
 * @remarks TensorFlow.js 기반 로컬 이미지 분석
 */

/**
 * NSFW.js 분석기 클래스
 */
export class NsfwjsAnalyzer {
    constructor() {
        this.model     = null;
        this.isLoading = false;
        this.isLoaded  = false;
    }

    /**
     * 모델을 로드한다
     * @returns {Promise<boolean>}
     */
    async loadModel() {
        if (this.isLoaded) {
            return true;
        }

        if (this.isLoading) {
            /** 로딩 중이면 완료까지 대기 */
            return new Promise((resolve) => {
                const checkInterval = setInterval(() => {
                    if (this.isLoaded) {
                        clearInterval(checkInterval);
                        resolve(true);
                    }
                }, 100);
            });
        }

        this.isLoading = true;

        try {
            console.log('[Kas-Free] NSFW.js 모델 로딩 시작...');

            /** TensorFlow.js 및 NSFW.js 로드 확인 */
            if (typeof nsfwjs === 'undefined') {
                throw new Error('NSFW.js 라이브러리가 로드되지 않았습니다.');
            }

            /** 모델 로드 (번들링된 모델 사용) */
            const modelUrl = chrome.runtime.getURL('models/nsfwjs/model.json');
            this.model     = await nsfwjs.load(modelUrl);

            this.isLoaded  = true;
            this.isLoading = false;

            console.log('[Kas-Free] NSFW.js 모델 로딩 완료');
            return true;
        } catch (error) {
            this.isLoading = false;
            console.error('[Kas-Free] NSFW.js 모델 로딩 실패:', error);
            throw error;
        }
    }

    /**
     * 이미지를 분석한다
     * @param {HTMLImageElement|string} image - 이미지 엘리먼트 또는 URL
     * @returns {Promise<object>}
     */
    async analyze(image) {
        if (!this.isLoaded) {
            await this.loadModel();
        }

        try {
            let imgElement = image;

            /** URL인 경우 이미지 로드 */
            if (typeof image === 'string') {
                imgElement = await this.loadImage(image);
            }

            /** NSFW.js 분석 */
            const predictions = await this.model.classify(imgElement);

            /** 결과 변환 */
            return this.transformResult(predictions);
        } catch (error) {
            console.error('[Kas-Free] NSFW.js 분석 실패:', error);
            throw error;
        }
    }

    /**
     * 이미지를 로드한다
     * @param {string} url - 이미지 URL
     * @returns {Promise<HTMLImageElement>}
     */
    loadImage(url) {
        return new Promise((resolve, reject) => {
            const img         = new Image();
            img.crossOrigin   = 'anonymous';

            img.onload = () => {
                resolve(img);
            };

            img.onerror = () => {
                reject(new Error('이미지 로드 실패'));
            };

            img.src = url;
        });
    }

    /**
     * NSFW.js 결과를 변환한다
     * @param {Array} predictions - NSFW.js 예측 결과
     * @returns {object}
     */
    transformResult(predictions) {
        const categories = {};
        let maxScore     = 0;
        let maxCategory  = 'Neutral';

        for (const prediction of predictions) {
            const { className, probability } = prediction;
            categories[className] = probability;

            if (probability > maxScore) {
                maxScore    = probability;
                maxCategory = className;
            }
        }

        /** 위험 점수 계산 */
        const riskScore = this.calculateRiskScore(categories);

        return {
            source:      'nsfwjs',
            categories,
            maxCategory,
            maxScore,
            riskScore,
            timestamp:   Date.now()
        };
    }

    /**
     * 위험 점수를 계산한다
     * @param {object} categories - 카테고리별 점수
     * @returns {number} 0.0 ~ 1.0
     */
    calculateRiskScore(categories) {
        /** 기본 가중치 */
        const weights = {
            Drawing: 0.0,
            Hentai:  0.5,
            Neutral: 0.0,
            Porn:    0.5,
            Sexy:    0.3
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
     * 결과가 애매한지 확인한다 (2차 검증 필요 여부)
     * @param {object} result - 분석 결과
     * @param {object} thresholds - 임계값
     * @returns {boolean}
     */
    isAmbiguous(result, thresholds = { safeMax: 0.3, cautionMax: 0.6 }) {
        const { riskScore } = result;

        /** 안전 범위도 위험 범위도 아닌 중간 구간 */
        return riskScore >= thresholds.safeMax && riskScore < thresholds.cautionMax;
    }

    /**
     * 모델을 언로드한다 (메모리 해제)
     */
    dispose() {
        if (this.model) {
            /** TensorFlow.js 텐서 메모리 해제 */
            if (typeof tf !== 'undefined') {
                tf.dispose(this.model);
            }
            this.model    = null;
            this.isLoaded = false;
        }
    }
}
