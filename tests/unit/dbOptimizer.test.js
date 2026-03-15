/**
 * DB Batch Optimizer 단위 테스트
 * @author 최진호
 * @date 2026-02-26
 */

import {
    DBBatchOptimizer,
    chunkArray,
    chunkMap
} from '../../src/utils/dbOptimizer.js';

describe('DBBatchOptimizer', () => {
    let optimizer;
    let mockDb;
    let mockTransaction;
    let mockStore;
    let mockIndex;

    beforeEach(() => {
        // IndexedDB Mock 설정
        mockIndex = {
            getAllKeys: jest.fn(),
            openCursor: jest.fn()
        };

        mockStore = {
            get: jest.fn(),
            put: jest.fn(),
            delete: jest.fn(),
            count: jest.fn(),
            index: jest.fn(() => mockIndex),
            openCursor: jest.fn()
        };

        mockTransaction = {
            objectStore: jest.fn(() => mockStore)
        };

        mockDb = {
            transaction: jest.fn(() => mockTransaction)
        };

        optimizer = new DBBatchOptimizer(mockDb);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('초기화', () => {
        test('DBBatchOptimizer 인스턴스 생성', () => {
            expect(optimizer.db).toBe(mockDb);
            expect(optimizer.stats).toEqual({
                batchReads: 0,
                batchWrites: 0,
                batchDeletes: 0,
                totalTime: 0
            });
        });
    });

    describe('batchGet', () => {
        test('여러 레코드를 한 번에 조회', async () => {
            const keys = ['key1', 'key2', 'key3'];
            const records = {
                key1: { id: 'key1', data: 'data1' },
                key2: { id: 'key2', data: 'data2' },
                key3: { id: 'key3', data: 'data3' }
            };

            let requestIndex = 0;
            mockStore.get.mockImplementation(() => {
                const key = keys[requestIndex++];
                return {
                    result: records[key],
                    onsuccess: null,
                    onerror: null
                };
            });

            const promise = optimizer.batchGet('analysisResults', keys);

            // 모든 get 요청에 대해 onsuccess 트리거
            for (let i = 0; i < keys.length; i++) {
                const request = mockStore.get.mock.results[i].value;
                setTimeout(() => request.onsuccess(), 0);
            }

            const result = await promise;

            expect(result.size).toBe(3);
            expect(result.get('key1')).toEqual(records.key1);
            expect(result.get('key2')).toEqual(records.key2);
            expect(result.get('key3')).toEqual(records.key3);
            expect(optimizer.stats.batchReads).toBe(1);
        });

        test('빈 배열 조회', async () => {
            const result = await optimizer.batchGet('analysisResults', []);

            expect(result.size).toBe(0);
            expect(mockDb.transaction).not.toHaveBeenCalled();
        });

        test('존재하지 않는 키는 결과에서 제외', async () => {
            const keys = ['exist', 'notExist'];

            let requestIndex = 0;
            mockStore.get.mockImplementation(() => {
                const key = keys[requestIndex++];
                return {
                    result: key === 'exist' ? { id: 'exist', data: 'data' } : null,
                    onsuccess: null,
                    onerror: null
                };
            });

            const promise = optimizer.batchGet('analysisResults', keys);

            for (let i = 0; i < keys.length; i++) {
                const request = mockStore.get.mock.results[i].value;
                setTimeout(() => request.onsuccess(), 0);
            }

            const result = await promise;

            expect(result.size).toBe(1);
            expect(result.has('exist')).toBe(true);
            expect(result.has('notExist')).toBe(false);
        });

        test('에러 처리', async () => {
            const keys = ['key1'];

            mockStore.get.mockReturnValue({
                result: null,
                error: new Error('DB Error'),
                onsuccess: null,
                onerror: null
            });

            const promise = optimizer.batchGet('analysisResults', keys);

            const request = mockStore.get.mock.results[0].value;
            setTimeout(() => request.onerror(), 0);

            await expect(promise).rejects.toThrow('DB Error');
        });
    });

    describe('batchPut', () => {
        test('여러 레코드를 한 번에 저장', async () => {
            const records = new Map([
                ['key1', { id: 'key1', data: 'data1' }],
                ['key2', { id: 'key2', data: 'data2' }],
                ['key3', { id: 'key3', data: 'data3' }]
            ]);

            mockStore.put.mockReturnValue({
                onsuccess: null,
                onerror: null
            });

            const promise = optimizer.batchPut('analysisResults', records);

            // 모든 put 요청에 대해 onsuccess 트리거
            for (let i = 0; i < records.size; i++) {
                const request = mockStore.put.mock.results[i].value;
                setTimeout(() => request.onsuccess(), 0);
            }

            const result = await promise;

            expect(result).toBe(3);
            expect(mockStore.put).toHaveBeenCalledTimes(3);
            expect(optimizer.stats.batchWrites).toBe(1);
        });

        test('빈 Map 저장', async () => {
            const result = await optimizer.batchPut('analysisResults', new Map());

            expect(result).toBe(0);
            expect(mockDb.transaction).not.toHaveBeenCalled();
        });

        test('일부 실패 시에도 성공한 개수 반환', async () => {
            const records = new Map([
                ['key1', { id: 'key1', data: 'data1' }],
                ['key2', { id: 'key2', data: 'data2' }]
            ]);

            let callCount = 0;
            mockStore.put.mockImplementation(() => {
                const isSuccess = callCount++ === 0;  // 첫 번째만 성공
                return {
                    onsuccess: isSuccess ? null : undefined,
                    onerror: isSuccess ? undefined : null
                };
            });

            const promise = optimizer.batchPut('analysisResults', records);

            // 첫 번째 성공, 두 번째 실패
            setTimeout(() => mockStore.put.mock.results[0].value.onsuccess(), 0);
            setTimeout(() => mockStore.put.mock.results[1].value.onerror(), 0);

            const result = await promise;

            expect(result).toBe(1);  // 1개만 성공
        });
    });

    describe('batchDelete', () => {
        test('여러 레코드를 한 번에 삭제', async () => {
            const keys = ['key1', 'key2', 'key3'];

            mockStore.delete.mockReturnValue({
                onsuccess: null,
                onerror: null
            });

            const promise = optimizer.batchDelete('analysisResults', keys);

            for (let i = 0; i < keys.length; i++) {
                const request = mockStore.delete.mock.results[i].value;
                setTimeout(() => request.onsuccess(), 0);
            }

            const result = await promise;

            expect(result).toBe(3);
            expect(mockStore.delete).toHaveBeenCalledTimes(3);
            expect(optimizer.stats.batchDeletes).toBe(1);
        });

        test('빈 배열 삭제', async () => {
            const result = await optimizer.batchDelete('analysisResults', []);

            expect(result).toBe(0);
            expect(mockDb.transaction).not.toHaveBeenCalled();
        });

        test('일부 실패 시에도 성공한 개수 반환', async () => {
            const keys = ['key1', 'key2'];

            let callCount = 0;
            mockStore.delete.mockImplementation(() => {
                const isSuccess = callCount++ === 0;
                return {
                    onsuccess: isSuccess ? null : undefined,
                    onerror: isSuccess ? undefined : null
                };
            });

            const promise = optimizer.batchDelete('analysisResults', keys);

            setTimeout(() => mockStore.delete.mock.results[0].value.onsuccess(), 0);
            setTimeout(() => mockStore.delete.mock.results[1].value.onerror(), 0);

            const result = await promise;

            expect(result).toBe(1);
        });
    });

    describe('deleteOldRecords', () => {
        test('오래된 레코드 삭제 (최적화된 버전)', async () => {
            const cutoffTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
            const keysToDelete = ['old1', 'old2', 'old3'];

            mockIndex.getAllKeys.mockReturnValue({
                result: keysToDelete,
                onsuccess: null,
                onerror: null
            });

            mockStore.delete.mockReturnValue({
                onsuccess: null,
                onerror: null
            });

            const promise = optimizer.deleteOldRecords('analysisResults', 'analyzedAt', cutoffTime);

            // getAllKeys onsuccess 트리거
            const getAllKeysRequest = mockIndex.getAllKeys.mock.results[0].value;
            setTimeout(() => getAllKeysRequest.onsuccess(), 0);

            // batchDelete 대기
            await new Promise(resolve => setTimeout(resolve, 10));

            // delete 요청들 onsuccess 트리거
            for (let i = 0; i < keysToDelete.length; i++) {
                const request = mockStore.delete.mock.results[i].value;
                setTimeout(() => request.onsuccess(), 0);
            }

            const result = await promise;

            expect(result).toBe(3);
            expect(mockIndex.getAllKeys).toHaveBeenCalledWith(expect.any(Object));
            expect(mockStore.delete).toHaveBeenCalledTimes(3);
        });

        test('삭제할 레코드가 없는 경우', async () => {
            const cutoffTime = Date.now() - 7 * 24 * 60 * 60 * 1000;

            mockIndex.getAllKeys.mockReturnValue({
                result: [],
                onsuccess: null,
                onerror: null
            });

            const promise = optimizer.deleteOldRecords('analysisResults', 'analyzedAt', cutoffTime);

            const getAllKeysRequest = mockIndex.getAllKeys.mock.results[0].value;
            setTimeout(() => getAllKeysRequest.onsuccess(), 0);

            const result = await promise;

            expect(result).toBe(0);
            expect(mockStore.delete).not.toHaveBeenCalled();
        });
    });

    describe('trimToMaxCount', () => {
        test('레코드 수 제한 (오래된 것부터 삭제)', async () => {
            const maxCount = 5;
            const totalCount = 10;
            const allKeys = Array.from({ length: totalCount }, (_, i) => `key${i}`);

            mockStore.count.mockReturnValue({
                result: totalCount,
                onsuccess: null,
                onerror: null
            });

            mockIndex.getAllKeys.mockReturnValue({
                result: allKeys,
                onsuccess: null,
                onerror: null
            });

            mockStore.delete.mockReturnValue({
                onsuccess: null,
                onerror: null
            });

            const promise = optimizer.trimToMaxCount('analysisResults', 'analyzedAt', maxCount);

            // count onsuccess
            const countRequest = mockStore.count.mock.results[0].value;
            setTimeout(() => countRequest.onsuccess(), 0);

            await new Promise(resolve => setTimeout(resolve, 10));

            // getAllKeys onsuccess
            const getAllKeysRequest = mockIndex.getAllKeys.mock.results[0].value;
            setTimeout(() => getAllKeysRequest.onsuccess(), 0);

            await new Promise(resolve => setTimeout(resolve, 10));

            // delete 요청들 onsuccess (5개 삭제되어야 함)
            const deleteCount = totalCount - maxCount;
            for (let i = 0; i < deleteCount; i++) {
                const request = mockStore.delete.mock.results[i].value;
                setTimeout(() => request.onsuccess(), 0);
            }

            const result = await promise;

            expect(result).toBe(5);
            expect(mockStore.delete).toHaveBeenCalledTimes(5);
        });

        test('제한 내에 있으면 삭제하지 않음', async () => {
            const maxCount = 10;
            const totalCount = 5;

            mockStore.count.mockReturnValue({
                result: totalCount,
                onsuccess: null,
                onerror: null
            });

            const promise = optimizer.trimToMaxCount('analysisResults', 'analyzedAt', maxCount);

            const countRequest = mockStore.count.mock.results[0].value;
            setTimeout(() => countRequest.onsuccess(), 0);

            const result = await promise;

            expect(result).toBe(0);
            expect(mockIndex.getAllKeys).not.toHaveBeenCalled();
            expect(mockStore.delete).not.toHaveBeenCalled();
        });
    });

    describe('queryWithFilters', () => {
        test('복합 조건으로 필터링', async () => {
            const filters = { status: 'safe', analyzed: true };
            const records = [
                { postNo: 1, status: 'safe', analyzed: true },
                { postNo: 2, status: 'danger', analyzed: true },
                { postNo: 3, status: 'safe', analyzed: false },
                { postNo: 4, status: 'safe', analyzed: true }
            ];

            let cursorIndex = 0;
            mockStore.openCursor.mockReturnValue({
                onsuccess: null,
                onerror: null
            });

            const promise = optimizer.queryWithFilters('analysisResults', filters, 100);

            const cursorRequest = mockStore.openCursor.mock.results[0].value;

            // 커서 순회 시뮬레이션
            const triggerCursor = () => {
                if (cursorIndex < records.length) {
                    const record = records[cursorIndex++];
                    cursorRequest.onsuccess({
                        target: {
                            result: {
                                value: record,
                                continue: triggerCursor
                            }
                        }
                    });
                } else {
                    cursorRequest.onsuccess({
                        target: { result: null }
                    });
                }
            };

            setTimeout(triggerCursor, 0);

            const result = await promise;

            // status: 'safe', analyzed: true인 레코드 2개
            expect(result.length).toBe(2);
            expect(result[0].postNo).toBe(1);
            expect(result[1].postNo).toBe(4);
        });

        test('limit 적용', async () => {
            const filters = { status: 'safe' };
            const records = Array.from({ length: 10 }, (_, i) => ({
                postNo: i,
                status: 'safe'
            }));

            let cursorIndex = 0;
            mockStore.openCursor.mockReturnValue({
                onsuccess: null,
                onerror: null
            });

            const promise = optimizer.queryWithFilters('analysisResults', filters, 3);

            const cursorRequest = mockStore.openCursor.mock.results[0].value;

            const triggerCursor = () => {
                if (cursorIndex < records.length) {
                    const record = records[cursorIndex++];
                    cursorRequest.onsuccess({
                        target: {
                            result: {
                                value: record,
                                continue: triggerCursor
                            }
                        }
                    });
                } else {
                    cursorRequest.onsuccess({
                        target: { result: null }
                    });
                }
            };

            setTimeout(triggerCursor, 0);

            const result = await promise;

            // limit 3으로 제한
            expect(result.length).toBe(3);
        });
    });

    describe('통계', () => {
        test('getStats: 통계 조회', () => {
            optimizer.stats = {
                batchReads: 5,
                batchWrites: 3,
                batchDeletes: 2,
                totalTime: 1000
            };

            const stats = optimizer.getStats();

            expect(stats.batchReads).toBe(5);
            expect(stats.batchWrites).toBe(3);
            expect(stats.batchDeletes).toBe(2);
            expect(stats.totalTime).toBe(1000);
            expect(stats.avgTime).toBe('100.00ms');  // 1000 / (5 + 3 + 2)
        });

        test('getStats: 작업이 없으면 avgTime 0ms', () => {
            const stats = optimizer.getStats();

            expect(stats.avgTime).toBe('0ms');
        });

        test('resetStats: 통계 초기화', () => {
            optimizer.stats = {
                batchReads: 5,
                batchWrites: 3,
                batchDeletes: 2,
                totalTime: 1000
            };

            optimizer.resetStats();

            expect(optimizer.stats).toEqual({
                batchReads: 0,
                batchWrites: 0,
                batchDeletes: 0,
                totalTime: 0
            });
        });
    });

    describe('유틸리티 함수', () => {
        describe('chunkArray', () => {
            test('배열을 청크로 나누기', () => {
                const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
                const chunks = chunkArray(array, 3);

                expect(chunks.length).toBe(4);
                expect(chunks[0]).toEqual([1, 2, 3]);
                expect(chunks[1]).toEqual([4, 5, 6]);
                expect(chunks[2]).toEqual([7, 8, 9]);
                expect(chunks[3]).toEqual([10]);
            });

            test('빈 배열', () => {
                const chunks = chunkArray([], 3);

                expect(chunks.length).toBe(0);
            });

            test('청크 크기가 배열보다 큰 경우', () => {
                const array = [1, 2, 3];
                const chunks = chunkArray(array, 10);

                expect(chunks.length).toBe(1);
                expect(chunks[0]).toEqual([1, 2, 3]);
            });
        });

        describe('chunkMap', () => {
            test('Map을 청크로 나누기', () => {
                const map = new Map([
                    ['key1', 'value1'],
                    ['key2', 'value2'],
                    ['key3', 'value3'],
                    ['key4', 'value4'],
                    ['key5', 'value5']
                ]);

                const chunks = chunkMap(map, 2);

                expect(chunks.length).toBe(3);
                expect(chunks[0].size).toBe(2);
                expect(chunks[1].size).toBe(2);
                expect(chunks[2].size).toBe(1);
                expect(chunks[0].get('key1')).toBe('value1');
                expect(chunks[2].get('key5')).toBe('value5');
            });

            test('빈 Map', () => {
                const chunks = chunkMap(new Map(), 3);

                expect(chunks.length).toBe(0);
            });
        });
    });

    describe('실제 시나리오', () => {
        test('대량 조회 및 삭제 시나리오', async () => {
            // 100개 레코드 조회
            const keys = Array.from({ length: 100 }, (_, i) => `key${i}`);

            mockStore.get.mockImplementation((key) => ({
                result: { id: key, data: `data${key}` },
                onsuccess: null,
                onerror: null
            }));

            const readPromise = optimizer.batchGet('analysisResults', keys);

            for (let i = 0; i < keys.length; i++) {
                const request = mockStore.get.mock.results[i].value;
                setTimeout(() => request.onsuccess(), 0);
            }

            const readResult = await readPromise;

            expect(readResult.size).toBe(100);
            expect(optimizer.stats.batchReads).toBe(1);

            // 50개 레코드 삭제
            const keysToDelete = keys.slice(0, 50);

            mockStore.delete.mockReturnValue({
                onsuccess: null,
                onerror: null
            });

            const deletePromise = optimizer.batchDelete('analysisResults', keysToDelete);

            for (let i = 0; i < keysToDelete.length; i++) {
                const request = mockStore.delete.mock.results[i].value;
                setTimeout(() => request.onsuccess(), 0);
            }

            const deleteResult = await deletePromise;

            expect(deleteResult).toBe(50);
            expect(optimizer.stats.batchDeletes).toBe(1);

            const stats = optimizer.getStats();
            expect(stats.batchReads).toBe(1);
            expect(stats.batchDeletes).toBe(1);
        });

        test('청크 분할 처리 시나리오', () => {
            // 1000개 키를 100개씩 청크로 나누기
            const keys = Array.from({ length: 1000 }, (_, i) => `key${i}`);
            const chunks = chunkArray(keys, 100);

            expect(chunks.length).toBe(10);
            expect(chunks[0].length).toBe(100);
            expect(chunks[9].length).toBe(100);

            // 실제로는 각 청크를 batchGet으로 처리
            // for (const chunk of chunks) {
            //     await optimizer.batchGet('analysisResults', chunk);
            // }
        });
    });
});
