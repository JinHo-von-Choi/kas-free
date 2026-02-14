/**
 * IndexedDB 래퍼 클래스
 * @author 최진호
 * @date 2026-02-05
 * @version 1.0.0
 */

const DB_NAME    = 'KasFreeDB';
const DB_VERSION = 1;

/** 스토어 이름 */
const STORES = {
    ANALYSIS_RESULTS: 'analysisResults',
    POST_CONTENTS:    'postContents'
};

/**
 * IndexedDB 관리 클래스
 */
class KasFreeDB {
    constructor() {
        this.db = null;
    }

    /**
     * DB 초기화
     * @returns {Promise<IDBDatabase>}
     */
    async init() {
        if (this.db) {
            return this.db;
        }

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                console.error('[KasFreeDB] 데이터베이스 열기 실패:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('[KasFreeDB] 데이터베이스 초기화 완료');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                /** analysisResults 스토어 생성 */
                if (!db.objectStoreNames.contains(STORES.ANALYSIS_RESULTS)) {
                    const analysisStore = db.createObjectStore(STORES.ANALYSIS_RESULTS, {
                        keyPath: 'postNo'
                    });

                    /** 인덱스 생성 */
                    analysisStore.createIndex('imageHash', 'imageHash', { unique: false });
                    analysisStore.createIndex('analyzedAt', 'analyzedAt', { unique: false });
                    analysisStore.createIndex('status', 'status', { unique: false });

                    console.log('[KasFreeDB] analysisResults 스토어 생성');
                }

                /** postContents 스토어 생성 */
                if (!db.objectStoreNames.contains(STORES.POST_CONTENTS)) {
                    const contentsStore = db.createObjectStore(STORES.POST_CONTENTS, {
                        keyPath: 'postNo'
                    });

                    /** 인덱스 생성 */
                    contentsStore.createIndex('fetchedAt', 'fetchedAt', { unique: false });

                    console.log('[KasFreeDB] postContents 스토어 생성');
                }
            };
        });
    }

    /**
     * 분석 결과를 가져온다
     * @param {string} postNo - 게시글 번호
     * @returns {Promise<object|null>}
     */
    async getAnalysisResult(postNo) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORES.ANALYSIS_RESULTS], 'readonly');
            const store       = transaction.objectStore(STORES.ANALYSIS_RESULTS);
            const request     = store.get(postNo);

            request.onsuccess = () => {
                resolve(request.result || null);
            };

            request.onerror = () => {
                console.error('[KasFreeDB] 분석 결과 조회 실패:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 분석 결과를 저장한다
     * @param {string} postNo - 게시글 번호
     * @param {object} data - 분석 결과 데이터
     * @returns {Promise<void>}
     */
    async setAnalysisResult(postNo, data) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORES.ANALYSIS_RESULTS], 'readwrite');
            const store       = transaction.objectStore(STORES.ANALYSIS_RESULTS);

            /** 타임스탬프 추가 */
            const record = {
                ...data,
                postNo,
                analyzedAt: Date.now()
            };

            const request = store.put(record);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                console.error('[KasFreeDB] 분석 결과 저장 실패:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 게시글 본문을 가져온다
     * @param {string} postNo - 게시글 번호
     * @returns {Promise<object|null>}
     */
    async getPostContent(postNo) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORES.POST_CONTENTS], 'readonly');
            const store       = transaction.objectStore(STORES.POST_CONTENTS);
            const request     = store.get(postNo);

            request.onsuccess = () => {
                resolve(request.result || null);
            };

            request.onerror = () => {
                console.error('[KasFreeDB] 게시글 본문 조회 실패:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 게시글 본문을 저장한다
     * @param {string} postNo - 게시글 번호
     * @param {object} data - 본문 데이터 (text, imageCount, dcconCount)
     * @returns {Promise<void>}
     */
    async setPostContent(postNo, data) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORES.POST_CONTENTS], 'readwrite');
            const store       = transaction.objectStore(STORES.POST_CONTENTS);

            /** 타임스탬프 추가 */
            const record = {
                ...data,
                postNo,
                fetchedAt: Date.now()
            };

            const request = store.put(record);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                console.error('[KasFreeDB] 게시글 본문 저장 실패:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 오래된 레코드를 삭제한다 (TTL)
     * @param {number} days - 보관 일수 (기본: 30일)
     * @returns {Promise<number>} 삭제된 레코드 수
     */
    async deleteOldRecords(days = 30) {
        await this.init();

        const cutoffTime   = Date.now() - (days * 24 * 60 * 60 * 1000);
        let deletedCount   = 0;

        /** analysisResults 정리 */
        deletedCount += await this._deleteOldFromStore(
            STORES.ANALYSIS_RESULTS,
            'analyzedAt',
            cutoffTime
        );

        /** postContents 정리 */
        deletedCount += await this._deleteOldFromStore(
            STORES.POST_CONTENTS,
            'fetchedAt',
            cutoffTime
        );

        console.log(`[KasFreeDB] ${days}일 이상 오래된 레코드 ${deletedCount}개 삭제`);
        return deletedCount;
    }

    /**
     * 스토어에서 오래된 레코드를 삭제한다 (내부 메서드)
     * @param {string} storeName - 스토어 이름
     * @param {string} timeIndexName - 시간 인덱스 이름
     * @param {number} cutoffTime - 기준 시간
     * @returns {Promise<number>}
     */
    async _deleteOldFromStore(storeName, timeIndexName, cutoffTime) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store       = transaction.objectStore(storeName);
            const index       = store.index(timeIndexName);
            const range       = IDBKeyRange.upperBound(cutoffTime);
            const request     = index.openCursor(range);
            let count         = 0;

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    count++;
                    cursor.continue();
                } else {
                    resolve(count);
                }
            };

            request.onerror = () => {
                console.error('[KasFreeDB] 오래된 레코드 삭제 실패:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 레코드 수를 제한한다 (LRU - 오래된 것부터 삭제)
     * @param {number} limit - 최대 레코드 수 (기본: 5000)
     * @returns {Promise<number>} 삭제된 레코드 수
     */
    async trimToLimit(limit = 5000) {
        await this.init();

        let deletedCount = 0;

        /** analysisResults 정리 */
        deletedCount += await this._trimStoreToLimit(
            STORES.ANALYSIS_RESULTS,
            'analyzedAt',
            limit
        );

        /** postContents 정리 */
        deletedCount += await this._trimStoreToLimit(
            STORES.POST_CONTENTS,
            'fetchedAt',
            limit
        );

        if (deletedCount > 0) {
            console.log(`[KasFreeDB] 용량 제한으로 ${deletedCount}개 레코드 삭제`);
        }

        return deletedCount;
    }

    /**
     * 스토어의 레코드 수를 제한한다 (내부 메서드)
     * @param {string} storeName - 스토어 이름
     * @param {string} timeIndexName - 시간 인덱스 이름
     * @param {number} limit - 최대 레코드 수
     * @returns {Promise<number>}
     */
    async _trimStoreToLimit(storeName, timeIndexName, limit) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store       = transaction.objectStore(storeName);
            const countReq    = store.count();

            countReq.onsuccess = () => {
                const total = countReq.result;

                if (total <= limit) {
                    resolve(0);
                    return;
                }

                /** 삭제할 개수 */
                const deleteCount = total - limit;

                /** 오래된 순으로 정렬하여 삭제 */
                const index   = store.index(timeIndexName);
                const request = index.openCursor();
                let count     = 0;

                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor && count < deleteCount) {
                        cursor.delete();
                        count++;
                        cursor.continue();
                    } else {
                        resolve(count);
                    }
                };

                request.onerror = () => {
                    console.error('[KasFreeDB] 레코드 제한 실패:', request.error);
                    reject(request.error);
                };
            };

            countReq.onerror = () => {
                reject(countReq.error);
            };
        });
    }

    /**
     * 특정 스토어의 모든 레코드를 삭제한다
     * @param {string} storeName - 스토어 이름
     * @returns {Promise<void>}
     */
    async clearStore(storeName) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store       = transaction.objectStore(storeName);
            const request     = store.clear();

            request.onsuccess = () => {
                console.log(`[KasFreeDB] ${storeName} 스토어 초기화 완료`);
                resolve();
            };

            request.onerror = () => {
                console.error('[KasFreeDB] 스토어 초기화 실패:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 모든 데이터를 삭제한다
     * @returns {Promise<void>}
     */
    async clearAll() {
        await this.init();

        await this.clearStore(STORES.ANALYSIS_RESULTS);
        await this.clearStore(STORES.POST_CONTENTS);

        console.log('[KasFreeDB] 모든 데이터 초기화 완료');
    }

    /**
     * DB 통계를 가져온다
     * @returns {Promise<object>}
     */
    async getStats() {
        await this.init();

        const analysisCount = await this._getStoreCount(STORES.ANALYSIS_RESULTS);
        const contentCount  = await this._getStoreCount(STORES.POST_CONTENTS);

        return {
            analysisResults: analysisCount,
            postContents:    contentCount,
            total:           analysisCount + contentCount
        };
    }

    /**
     * 스토어의 레코드 수를 가져온다 (내부 메서드)
     * @param {string} storeName - 스토어 이름
     * @returns {Promise<number>}
     */
    async _getStoreCount(storeName) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store       = transaction.objectStore(storeName);
            const request     = store.count();

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }
}

/** 전역 인스턴스 */
const kasFreeDB = new KasFreeDB();

console.log('[KasFreeDB] 모듈 로드 완료');

/** Chrome Extension 환경에서 전역 접근 가능하도록 */
if (typeof window !== 'undefined') {
    window.kasFreeDB = kasFreeDB;
    window.KasFreeDB = KasFreeDB;
    window.STORES = STORES;
    console.log('[KasFreeDB] window.kasFreeDB 설정 완료');
}

/** Service Worker 환경에서 전역 접근 가능하도록 */
if (typeof self !== 'undefined' && typeof WorkerGlobalScope !== 'undefined') {
    self.kasFreeDB = kasFreeDB;
    self.KasFreeDB = KasFreeDB;
    self.STORES = STORES;
}

/** ES Module Export (Service Worker용) - 조건부 */
try {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { KasFreeDB, kasFreeDB, STORES };
    }
} catch (e) {
    // module is not defined in content script
}
