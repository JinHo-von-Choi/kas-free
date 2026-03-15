/**
 * Chrome Storage API 래퍼
 * @author 최진호
 * @date 2026-01-31
 * @version 1.0.0
 * @modified 2026-02-26 (설정값 검증 추가)
 */

import { STORAGE_KEYS, DEFAULT_SETTINGS, DEFAULT_STATS } from './constants.js';
import { validateSettings, ensureSettingsIntegrity } from './settingsValidator.js';

/**
 * 스토리지에서 값을 가져온다
 * @param {string} key - 스토리지 키
 * @param {any} defaultValue - 기본값
 * @returns {Promise<any>}
 */
export async function getStorage(key, defaultValue = null) {
    try {
        const result = await chrome.storage.local.get(key);
        return result[key] !== undefined ? result[key] : defaultValue;
    } catch (error) {
        console.error('[Kas-Free] Storage get error:', error);
        return defaultValue;
    }
}

/**
 * 스토리지에 값을 저장한다
 * @param {string} key - 스토리지 키
 * @param {any} value - 저장할 값
 * @returns {Promise<boolean>}
 */
export async function setStorage(key, value) {
    try {
        await chrome.storage.local.set({ [key]: value });
        return true;
    } catch (error) {
        console.error('[Kas-Free] Storage set error:', error);
        return false;
    }
}

/**
 * 스토리지에서 값을 삭제한다
 * @param {string} key - 스토리지 키
 * @returns {Promise<boolean>}
 */
export async function removeStorage(key) {
    try {
        await chrome.storage.local.remove(key);
        return true;
    } catch (error) {
        console.error('[Kas-Free] Storage remove error:', error);
        return false;
    }
}

/**
 * 설정을 가져온다
 * @returns {Promise<object>}
 */
export async function getSettings() {
    const settings = await getStorage(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
    const merged = { ...DEFAULT_SETTINGS, ...settings };

    // 설정값 검증 및 무결성 확인
    const validated = validateSettings(merged);
    const safe = ensureSettingsIntegrity(validated);

    return safe;
}

/**
 * 설정을 저장한다
 * @param {object} settings - 저장할 설정
 * @returns {Promise<boolean>}
 */
export async function saveSettings(settings) {
    // 설정값 검증
    const validated = validateSettings(settings);
    const safe = ensureSettingsIntegrity(validated);

    return setStorage(STORAGE_KEYS.SETTINGS, safe);
}

/**
 * 설정을 부분 업데이트한다
 * @param {object} partialSettings - 업데이트할 설정
 * @returns {Promise<boolean>}
 */
export async function updateSettings(partialSettings) {
    const currentSettings = await getSettings();
    const merged = deepMerge(currentSettings, partialSettings);

    // 병합 후 검증
    const validated = validateSettings(merged);
    const safe = ensureSettingsIntegrity(validated);

    return setStorage(STORAGE_KEYS.SETTINGS, safe);
}

/**
 * 통계를 가져온다
 * @returns {Promise<object>}
 */
export async function getStats() {
    const stats = await getStorage(STORAGE_KEYS.STATS, DEFAULT_STATS);
    const today = getTodayDateString();

    /** 날짜가 바뀌면 오늘 통계 초기화 */
    if (stats.today.date !== today) {
        stats.today = {
            date:     today,
            scanned:  0,
            safe:     0,
            caution:  0,
            danger:   0,
            reported: 0
        };
        await setStorage(STORAGE_KEYS.STATS, stats);
    }

    /** 하위 호환: reported 필드 누락 보정 */
    stats.today.reported = stats.today.reported ?? 0;
    stats.total.reported = stats.total.reported ?? 0;

    return stats;
}

/**
 * 통계를 업데이트한다
 * @param {string|{reported: number}} signalType - 신호등 타입 (safe, caution, danger) 또는 신고 객체
 * @returns {Promise<boolean>}
 */
export async function updateStats(signalType) {
    const stats = await getStats();

    /** 신고 카운트 업데이트 경로 */
    if (typeof signalType === 'object' && signalType !== null) {
        if (signalType.reported) {
            stats.today.reported++;
            stats.total.reported++;
        }
        return setStorage(STORAGE_KEYS.STATS, stats);
    }

    /** 스캔 카운트 업데이트 경로 */
    stats.today.scanned++;
    stats.total.scanned++;

    if (signalType === 'safe') {
        stats.today.safe++;
        stats.total.safe++;
    } else if (signalType === 'caution') {
        stats.today.caution++;
        stats.total.caution++;
    } else if (signalType === 'danger') {
        stats.today.danger++;
        stats.total.danger++;
    }

    return setStorage(STORAGE_KEYS.STATS, stats);
}

/**
 * 캐시를 가져온다
 * @returns {Promise<object>}
 */
export async function getCache() {
    return getStorage(STORAGE_KEYS.CACHE, {});
}

/**
 * 캐시에서 특정 URL의 결과를 가져온다
 * @param {string} imageUrl - 이미지 URL
 * @param {number} cacheDuration - 캐시 유효 시간 (ms)
 * @returns {Promise<object|null>}
 */
export async function getCachedResult(imageUrl, cacheDuration) {
    const cache      = await getCache();
    const cachedData = cache[imageUrl];

    if (!cachedData) {
        return null;
    }

    const now     = Date.now();
    const elapsed = now - cachedData.timestamp;

    if (elapsed > cacheDuration) {
        return null;
    }

    return cachedData.result;
}

/**
 * 캐시에 결과를 저장한다
 * @param {string} imageUrl - 이미지 URL
 * @param {object} result - 분석 결과
 * @returns {Promise<boolean>}
 */
export async function setCachedResult(imageUrl, result) {
    const cache = await getCache();

    cache[imageUrl] = {
        timestamp: Date.now(),
        result:    result
    };

    /** 캐시 크기 제한 (최대 1000개) */
    const keys = Object.keys(cache);
    if (keys.length > 1000) {
        const sortedKeys = keys.sort((a, b) => cache[a].timestamp - cache[b].timestamp);
        const keysToDelete = sortedKeys.slice(0, keys.length - 1000);
        keysToDelete.forEach(key => delete cache[key]);
    }

    return setStorage(STORAGE_KEYS.CACHE, cache);
}

/**
 * 캐시를 초기화한다
 * @returns {Promise<boolean>}
 */
export async function clearCache() {
    return setStorage(STORAGE_KEYS.CACHE, {});
}

/**
 * 오늘 날짜 문자열을 반환한다
 * @returns {string} YYYY-MM-DD 형식
 */
function getTodayDateString() {
    const now   = new Date();
    const year  = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day   = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * 객체를 깊은 병합한다
 * @param {object} target - 대상 객체
 * @param {object} source - 소스 객체
 * @returns {object}
 */
function deepMerge(target, source) {
    const result = { ...target };

    for (const key in source) {
        if (source.hasOwnProperty(key)) {
            if (isObject(source[key]) && isObject(target[key])) {
                result[key] = deepMerge(target[key], source[key]);
            } else {
                result[key] = source[key];
            }
        }
    }

    return result;
}

/**
 * 값이 객체인지 확인한다
 * @param {any} item - 확인할 값
 * @returns {boolean}
 */
function isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
}

/**
 * 해시 캐시를 가져온다
 * @param {string} imageUrl - 이미지 URL
 * @returns {Promise<object|null>} { hashes, result, timestamp } 또는 null
 */
export async function getHashCache(imageUrl) {
    try {
        const cache = await getStorage(STORAGE_KEYS.HASH_CACHE, {});
        const cached = cache[imageUrl];

        if (!cached) {
            return null;
        }

        // TTL 체크 (24시간)
        const now = Date.now();
        const age = now - (cached.timestamp || 0);
        const TTL = 24 * 60 * 60 * 1000; // 24시간

        if (age > TTL) {
            console.log('[Kas-Free] 해시 캐시 만료:', imageUrl);
            return null;
        }

        console.log('[Kas-Free] 해시 캐시 히트:', imageUrl);
        return cached;
    } catch (error) {
        console.error('[Kas-Free] 해시 캐시 읽기 실패:', error);
        return null;
    }
}

/**
 * 해시 캐시를 저장한다
 * @param {string} imageUrl - 이미지 URL
 * @param {object} hashes - { phash, dhash, ahash }
 * @param {object} result - 검사 결과
 * @returns {Promise<boolean>}
 */
export async function setHashCache(imageUrl, hashes, result) {
    try {
        const cache = await getStorage(STORAGE_KEYS.HASH_CACHE, {});

        // 최대 개수 제한 (5000개)
        const keys = Object.keys(cache);
        if (keys.length >= 5000) {
            // 가장 오래된 1000개 삭제
            const sorted = keys
                .map(key => ({ key, timestamp: cache[key].timestamp || 0 }))
                .sort((a, b) => a.timestamp - b.timestamp);

            for (let i = 0; i < 1000; i++) {
                delete cache[sorted[i].key];
            }

            console.log('[Kas-Free] 해시 캐시 정리: 1000개 삭제');
        }

        // 새 캐시 저장
        cache[imageUrl] = {
            hashes,
            result,
            timestamp: Date.now()
        };

        await setStorage(STORAGE_KEYS.HASH_CACHE, cache);
        console.log('[Kas-Free] 해시 캐시 저장:', imageUrl);
        return true;
    } catch (error) {
        console.error('[Kas-Free] 해시 캐시 저장 실패:', error);
        return false;
    }
}

/**
 * 만료된 해시 캐시를 정리한다
 * @returns {Promise<number>} 삭제된 항목 수
 */
export async function clearExpiredHashCache() {
    try {
        const cache = await getStorage(STORAGE_KEYS.HASH_CACHE, {});
        const now = Date.now();
        const TTL = 24 * 60 * 60 * 1000; // 24시간

        let deletedCount = 0;

        for (const [url, data] of Object.entries(cache)) {
            const age = now - (data.timestamp || 0);
            if (age > TTL) {
                delete cache[url];
                deletedCount++;
            }
        }

        if (deletedCount > 0) {
            await setStorage(STORAGE_KEYS.HASH_CACHE, cache);
            console.log(`[Kas-Free] 만료된 해시 캐시 ${deletedCount}개 삭제`);
        }

        return deletedCount;
    } catch (error) {
        console.error('[Kas-Free] 해시 캐시 정리 실패:', error);
        return 0;
    }
}

/**
 * 해시 캐시 통계를 가져온다
 * @returns {Promise<object>}
 */
export async function getHashCacheStats() {
    try {
        const cache = await getStorage(STORAGE_KEYS.HASH_CACHE, {});
        const now = Date.now();
        const TTL = 24 * 60 * 60 * 1000;

        let total = 0;
        let expired = 0;
        let sizeBytes = 0;

        for (const [url, data] of Object.entries(cache)) {
            total++;
            const age = now - (data.timestamp || 0);
            if (age > TTL) {
                expired++;
            }
            sizeBytes += JSON.stringify({ url, data }).length;
        }

        return {
            total,
            expired,
            active: total - expired,
            sizeKB: Math.round(sizeBytes / 1024),
            sizeMB: (sizeBytes / 1024 / 1024).toFixed(2)
        };
    } catch (error) {
        console.error('[Kas-Free] 해시 캐시 통계 실패:', error);
        return { total: 0, expired: 0, active: 0, sizeKB: 0, sizeMB: '0.00' };
    }
}
