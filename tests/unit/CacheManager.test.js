/**
 * CacheManager 단위 테스트
 * @author 최진호
 * @date 2026-02-12
 */

import { CacheManager } from '../../src/background/CacheManager.js';
import {
    getCachedResult,
    setCachedResult,
    getHashCache,
    setHashCache,
    clearExpiredHashCache
} from '../../src/utils/storage.js';

// Mock storage functions
jest.mock('../../src/utils/storage.js', () => ({
    getCachedResult: jest.fn(),
    setCachedResult: jest.fn(),
    getHashCache: jest.fn(),
    setHashCache: jest.fn(),
    clearExpiredHashCache: jest.fn()
}));

// Mock PerformanceMonitor
jest.mock('../../src/utils/PerformanceMonitor.js', () => ({
    getPerformanceMonitor: jest.fn(() => ({
        recordCacheHit: jest.fn(),
        recordCacheMiss: jest.fn()
    }))
}));

describe('CacheManager', () => {
    let cacheManager;
    const mockSettings = {
        cacheEnabled: true,
        cacheDuration: 3600000
    };

    beforeEach(() => {
        jest.clearAllMocks();
        cacheManager = new CacheManager(mockSettings);
    });

    describe('getAnalysisResult', () => {
        const testUrl = 'https://test.example.com/post/123';

        test('캐시 비활성화 시 null 반환', async () => {
            const disabledCache = new CacheManager({ ...mockSettings, cacheEnabled: false });
            const result = await disabledCache.getAnalysisResult(testUrl);

            expect(result).toBeNull();
            expect(getCachedResult).not.toHaveBeenCalled();
        });

        test('캐시 히트 시 저장된 결과 반환', async () => {
            const mockResult = {
                status: 'safe',
                riskScore: 0.1,
                categories: {}
            };

            getCachedResult.mockResolvedValue(mockResult);

            const result = await cacheManager.getAnalysisResult(testUrl);

            expect(result).toEqual(mockResult);
            expect(getCachedResult).toHaveBeenCalledWith(testUrl, mockSettings.cacheDuration);
        });

        test('캐시 미스 시 null 반환', async () => {
            getCachedResult.mockResolvedValue(null);

            const result = await cacheManager.getAnalysisResult(testUrl);

            expect(result).toBeNull();
        });

        test('캐시 조회 실패 시 null 반환', async () => {
            getCachedResult.mockRejectedValue(new Error('Storage error'));

            const result = await cacheManager.getAnalysisResult(testUrl);

            expect(result).toBeNull();
        });
    });

    describe('setAnalysisResult', () => {
        test('캐시 비활성화 시 저장하지 않음', async () => {
            const disabledCache = new CacheManager({ ...mockSettings, cacheEnabled: false });
            await disabledCache.setAnalysisResult('test-url', {});

            expect(setCachedResult).not.toHaveBeenCalled();
        });

        test('분석 결과 캐시 저장', async () => {
            const testUrl = 'https://test.example.com/post/123';
            const mockResult = { status: 'safe', riskScore: 0.1 };

            setCachedResult.mockResolvedValue(true);

            await cacheManager.setAnalysisResult(testUrl, mockResult);

            expect(setCachedResult).toHaveBeenCalledWith(testUrl, mockResult);
        });

        test('저장 실패 시 에러 발생하지 않음', async () => {
            setCachedResult.mockRejectedValue(new Error('Storage error'));

            await expect(
                cacheManager.setAnalysisResult('test-url', {})
            ).resolves.not.toThrow();
        });
    });

    describe('getHashResult', () => {
        const testImageUrl = 'https://test.example.com/image.jpg';

        test('해시 캐시 히트 시 결과 반환', async () => {
            const mockCached = {
                hashes: { phash: 'abc', dhash: 'def', ahash: 'ghi' },
                result: { riskScore: 0.2, matched: false },
                timestamp: Date.now()
            };

            getHashCache.mockResolvedValue(mockCached);

            const result = await cacheManager.getHashResult(testImageUrl);

            expect(result).toEqual(mockCached.result);
        });

        test('해시 캐시 미스 시 null 반환', async () => {
            getHashCache.mockResolvedValue(null);

            const result = await cacheManager.getHashResult(testImageUrl);

            expect(result).toBeNull();
        });

        test('해시 캐시 조회 실패 시 null 반환', async () => {
            getHashCache.mockRejectedValue(new Error('Storage error'));

            const result = await cacheManager.getHashResult(testImageUrl);

            expect(result).toBeNull();
        });
    });

    describe('setHashResult', () => {
        test('해시 캐시 저장', async () => {
            const testImageUrl = 'https://test.example.com/image.jpg';
            const mockHashes   = { phash: 'abc', dhash: 'def', ahash: 'ghi' };
            const mockResult   = { riskScore: 0.2, matched: false };

            setHashCache.mockResolvedValue(true);

            await cacheManager.setHashResult(testImageUrl, mockHashes, mockResult);

            expect(setHashCache).toHaveBeenCalledWith(testImageUrl, mockHashes, mockResult);
        });

        test('저장 실패 시 에러 발생하지 않음', async () => {
            setHashCache.mockRejectedValue(new Error('Storage error'));

            await expect(
                cacheManager.setHashResult('test-url', {}, {})
            ).resolves.not.toThrow();
        });
    });

    describe('clearExpired', () => {
        test('만료된 캐시 정리 후 개수 반환', async () => {
            clearExpiredHashCache.mockResolvedValue(10);

            const count = await cacheManager.clearExpired();

            expect(count).toBe(10);
            expect(clearExpiredHashCache).toHaveBeenCalled();
        });

        test('정리 실패 시 0 반환', async () => {
            clearExpiredHashCache.mockRejectedValue(new Error('Clear error'));

            const count = await cacheManager.clearExpired();

            expect(count).toBe(0);
        });
    });

    describe('clearAll', () => {
        test('모든 캐시 초기화', async () => {
            await cacheManager.clearAll();

            expect(chrome.storage.local.clear).toHaveBeenCalled();
        });

        test('초기화 실패 시 에러 발생하지 않음', async () => {
            chrome.storage.local.clear.mockRejectedValue(new Error('Clear error'));

            await expect(
                cacheManager.clearAll()
            ).resolves.not.toThrow();
        });
    });

    describe('updateSettings', () => {
        test('설정 업데이트', () => {
            const newSettings = { ...mockSettings, cacheDuration: 7200000 };

            cacheManager.updateSettings(newSettings);

            expect(cacheManager.settings).toEqual(newSettings);
        });
    });
});
