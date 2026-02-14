/**
 * 캐시 관리자
 * @author 최진호
 * @date 2026-02-12
 * @version 1.1.0
 * @remarks 분석 결과 및 해시 캐싱 관리
 */

import {
    getCachedResult,
    setCachedResult,
    getHashCache,
    setHashCache,
    clearExpiredHashCache
} from '../utils/storage.js';
import { getPerformanceMonitor } from '../utils/PerformanceMonitor.js';

/**
 * 캐시 관리자 클래스
 */
export class CacheManager {
    /**
     * @param {object} settings - 설정 객체
     */
    constructor(settings) {
        this.settings          = settings;
        this.performanceMonitor = getPerformanceMonitor();
    }

    /**
     * 설정 업데이트
     * @param {object} settings - 새 설정
     */
    updateSettings(settings) {
        this.settings = settings;
    }

    /**
     * 분석 결과 캐시 조회
     * @param {string} postUrl - 게시글 URL
     * @returns {Promise<object|null>}
     */
    async getAnalysisResult(postUrl) {
        if (!this.settings.cacheEnabled) {
            await this.performanceMonitor.recordCacheMiss();
            return null;
        }

        try {
            const cached = await getCachedResult(postUrl, this.settings.cacheDuration);
            if (cached) {
                console.log('[CacheManager] 캐시 히트:', postUrl);
                await this.performanceMonitor.recordCacheHit();
                return cached;
            } else {
                await this.performanceMonitor.recordCacheMiss();
            }
        } catch (error) {
            console.error('[CacheManager] 캐시 조회 실패:', error);
            await this.performanceMonitor.recordCacheMiss();
        }

        return null;
    }

    /**
     * 분석 결과 캐시 저장
     * @param {string} postUrl - 게시글 URL
     * @param {object} result - 분석 결과
     * @returns {Promise<void>}
     */
    async setAnalysisResult(postUrl, result) {
        if (!this.settings.cacheEnabled) {
            return;
        }

        try {
            await setCachedResult(postUrl, result);
            console.log('[CacheManager] 캐시 저장:', postUrl);
        } catch (error) {
            console.error('[CacheManager] 캐시 저장 실패:', error);
        }
    }

    /**
     * 해시 캐시 조회
     * @param {string} imageUrl - 이미지 URL
     * @returns {Promise<object|null>}
     */
    async getHashResult(imageUrl) {
        try {
            const cached = await getHashCache(imageUrl);
            if (cached) {
                console.log('[CacheManager] 해시 캐시 히트:', imageUrl);
                await this.performanceMonitor.recordCacheHit();
                return cached.result;
            } else {
                await this.performanceMonitor.recordCacheMiss();
            }
        } catch (error) {
            console.error('[CacheManager] 해시 캐시 조회 실패:', error);
            await this.performanceMonitor.recordCacheMiss();
        }

        return null;
    }

    /**
     * 해시 캐시 저장
     * @param {string} imageUrl - 이미지 URL
     * @param {object} hashes - 해시 객체
     * @param {object} result - 분석 결과
     * @returns {Promise<void>}
     */
    async setHashResult(imageUrl, hashes, result) {
        try {
            await setHashCache(imageUrl, hashes, result);
            console.log('[CacheManager] 해시 캐시 저장:', imageUrl);
        } catch (error) {
            console.error('[CacheManager] 해시 캐시 저장 실패:', error);
        }
    }

    /**
     * 만료된 캐시 정리
     * @returns {Promise<number>} 정리된 항목 수
     */
    async clearExpired() {
        try {
            const count = await clearExpiredHashCache();
            if (count > 0) {
                console.log(`[CacheManager] 만료된 캐시 ${count}개 정리 완료`);
            }
            return count;
        } catch (error) {
            console.error('[CacheManager] 캐시 정리 실패:', error);
            return 0;
        }
    }

    /**
     * 모든 캐시 초기화
     * @returns {Promise<void>}
     */
    async clearAll() {
        try {
            await chrome.storage.local.clear();
            console.log('[CacheManager] 모든 캐시 초기화 완료');
        } catch (error) {
            console.error('[CacheManager] 캐시 초기화 실패:', error);
        }
    }
}
