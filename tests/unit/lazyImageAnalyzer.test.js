/**
 * Lazy Image Analyzer 단위 테스트
 * @author 최진호
 * @date 2026-02-26
 */

import { LazyImageAnalyzer } from '../../src/utils/lazyImageAnalyzer.js';

describe('LazyImageAnalyzer', () => {
    let analyzer;
    let mockOnVisible;
    let mockOnHidden;
    let mockElement;

    beforeEach(() => {
        // IntersectionObserver Mock
        global.IntersectionObserver = class {
            constructor(callback, options) {
                this.callback = callback;
                this.options = options;
                this.elements = new Set();
            }

            observe(element) {
                this.elements.add(element);
            }

            unobserve(element) {
                this.elements.delete(element);
            }

            disconnect() {
                this.elements.clear();
            }

            // 테스트용: Intersection 이벤트 시뮬레이션
            trigger(entries) {
                this.callback(entries);
            }
        };

        mockOnVisible = jest.fn();
        mockOnHidden = jest.fn();

        analyzer = new LazyImageAnalyzer({
            onVisible: mockOnVisible,
            onHidden: mockOnHidden,
            rootMargin: 100,
            threshold: 0.1
        });

        // Mock DOM 요소
        mockElement = {
            dataset: {},
            nextElementSibling: null
        };
    });

    afterEach(() => {
        if (analyzer) {
            analyzer.destroy();
        }
        jest.clearAllMocks();
    });

    describe('초기화', () => {
        test('IntersectionObserver 생성', () => {
            expect(analyzer.observer).toBeDefined();
            expect(analyzer.observedElements).toBeInstanceOf(Map);
            expect(analyzer.analysisQueue).toEqual([]);
        });

        test('옵션 설정', () => {
            expect(analyzer.rootMargin).toBe(100);
            expect(analyzer.threshold).toBe(0.1);
            expect(analyzer.maxConcurrent).toBe(5);
        });
    });

    describe('observe', () => {
        test('요소 관찰 시작', () => {
            const postInfo = { postNo: 123, postUrl: 'https://test.com/123' };

            analyzer.observe(mockElement, postInfo);

            expect(mockElement.dataset.kasPostNo).toBe(123);
            expect(analyzer.observedElements.has(mockElement)).toBe(true);

            const elementData = analyzer.observedElements.get(mockElement);
            expect(elementData.postInfo).toEqual(postInfo);
            expect(elementData.visible).toBe(false);
            expect(elementData.analyzed).toBe(false);
        });

        test('중복 관찰 방지', () => {
            const postInfo = { postNo: 123, postUrl: 'https://test.com/123' };

            analyzer.observe(mockElement, postInfo);
            analyzer.observe(mockElement, postInfo);  // 중복

            expect(analyzer.observedElements.size).toBe(1);
        });
    });

    describe('unobserve', () => {
        test('요소 관찰 중지', () => {
            const postInfo = { postNo: 123, postUrl: 'https://test.com/123' };

            analyzer.observe(mockElement, postInfo);
            expect(analyzer.observedElements.has(mockElement)).toBe(true);

            analyzer.unobserve(mockElement);
            expect(analyzer.observedElements.has(mockElement)).toBe(false);
        });
    });

    describe('handleIntersection', () => {
        test('화면 진입 시 콜백 호출', () => {
            const postInfo = { postNo: 123, postUrl: 'https://test.com/123' };
            analyzer.observe(mockElement, postInfo);

            // Intersection 이벤트 시뮬레이션 (진입)
            const entries = [{
                target: mockElement,
                isIntersecting: true
            }];

            analyzer.handleIntersection(entries);

            expect(mockOnVisible).toHaveBeenCalledWith(mockElement, postInfo);

            const elementData = analyzer.observedElements.get(mockElement);
            expect(elementData.visible).toBe(true);
            expect(elementData.priority).toBe(1);
        });

        test('화면 이탈 시 콜백 호출', () => {
            const postInfo = { postNo: 123, postUrl: 'https://test.com/123' };
            analyzer.observe(mockElement, postInfo);

            // 진입
            analyzer.handleIntersection([{
                target: mockElement,
                isIntersecting: true
            }]);

            // 이탈
            analyzer.handleIntersection([{
                target: mockElement,
                isIntersecting: false
            }]);

            expect(mockOnHidden).toHaveBeenCalledWith(mockElement, postInfo);

            const elementData = analyzer.observedElements.get(mockElement);
            expect(elementData.visible).toBe(false);
            expect(elementData.priority).toBe(2);
        });
    });

    describe('enqueueAnalysis', () => {
        test('Queue에 추가', () => {
            const postInfo = { postNo: 123, postUrl: 'https://test.com/123' };
            analyzer.observe(mockElement, postInfo);

            analyzer.enqueueAnalysis(mockElement, postInfo, 1);

            expect(analyzer.analysisQueue.length).toBe(1);
            expect(analyzer.analysisQueue[0].postInfo).toEqual(postInfo);
            expect(analyzer.analysisQueue[0].priority).toBe(1);
        });

        test('우선순위 정렬 (낮은 숫자가 먼저)', () => {
            const postInfo1 = { postNo: 1, postUrl: 'https://test.com/1' };
            const postInfo2 = { postNo: 2, postUrl: 'https://test.com/2' };
            const postInfo3 = { postNo: 3, postUrl: 'https://test.com/3' };

            const element1 = { ...mockElement, dataset: {} };
            const element2 = { ...mockElement, dataset: {} };
            const element3 = { ...mockElement, dataset: {} };

            analyzer.observe(element1, postInfo1);
            analyzer.observe(element2, postInfo2);
            analyzer.observe(element3, postInfo3);

            // 낮은 우선순위부터 추가
            analyzer.enqueueAnalysis(element1, postInfo1, 3);
            analyzer.enqueueAnalysis(element2, postInfo2, 1);
            analyzer.enqueueAnalysis(element3, postInfo3, 2);

            // 우선순위 순서: 2 (1) → 3 (2) → 1 (3)
            expect(analyzer.analysisQueue[0].postInfo.postNo).toBe(2);
            expect(analyzer.analysisQueue[1].postInfo.postNo).toBe(3);
            expect(analyzer.analysisQueue[2].postInfo.postNo).toBe(1);
        });

        test('이미 분석 완료된 요소는 Queue에 추가 안 함', () => {
            const postInfo = { postNo: 123, postUrl: 'https://test.com/123' };
            analyzer.observe(mockElement, postInfo);

            const elementData = analyzer.observedElements.get(mockElement);
            elementData.analyzed = true;

            analyzer.enqueueAnalysis(mockElement, postInfo, 1);

            expect(analyzer.analysisQueue.length).toBe(0);
        });

        test('중복 추가 시 우선순위 업데이트', () => {
            const postInfo = { postNo: 123, postUrl: 'https://test.com/123' };
            analyzer.observe(mockElement, postInfo);

            analyzer.enqueueAnalysis(mockElement, postInfo, 3);
            expect(analyzer.analysisQueue[0].priority).toBe(3);

            analyzer.enqueueAnalysis(mockElement, postInfo, 1);  // 더 높은 우선순위
            expect(analyzer.analysisQueue[0].priority).toBe(1);  // 업데이트됨
            expect(analyzer.analysisQueue.length).toBe(1);  // 중복 추가 안 됨
        });
    });

    describe('processQueue', () => {
        test('Queue 처리 시작', async () => {
            jest.spyOn(analyzer, 'performAnalysis').mockResolvedValue();

            const postInfo = { postNo: 123, postUrl: 'https://test.com/123' };
            analyzer.observe(mockElement, postInfo);

            analyzer.enqueueAnalysis(mockElement, postInfo, 1);

            await analyzer.processQueue();

            // performAnalysis가 호출되어야 함
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(analyzer.performAnalysis).toHaveBeenCalledWith(mockElement, postInfo);
        });

        test('동시 분석 수 제한 (maxConcurrent)', async () => {
            analyzer.maxConcurrent = 2;

            jest.spyOn(analyzer, 'performAnalysis').mockImplementation(() => {
                return new Promise(resolve => setTimeout(resolve, 100));
            });

            // 5개 추가
            for (let i = 1; i <= 5; i++) {
                const element = { ...mockElement, dataset: {} };
                const postInfo = { postNo: i, postUrl: `https://test.com/${i}` };
                analyzer.observe(element, postInfo);
                analyzer.enqueueAnalysis(element, postInfo, 1);
            }

            analyzer.processQueue();

            await new Promise(resolve => setTimeout(resolve, 10));

            // 최대 2개만 동시 실행
            expect(analyzer.activeAnalysis).toBeLessThanOrEqual(2);
        });
    });

    describe('prefetch', () => {
        test('화면 밖 요소 미리 로딩', () => {
            // 3개 요소 생성 (체인)
            const element1 = { dataset: {}, nextElementSibling: null };
            const element2 = { dataset: {}, nextElementSibling: null };
            const element3 = { dataset: {}, nextElementSibling: null };

            element1.nextElementSibling = element2;
            element2.nextElementSibling = element3;

            const postInfo1 = { postNo: 1, postUrl: 'https://test.com/1' };
            const postInfo2 = { postNo: 2, postUrl: 'https://test.com/2' };
            const postInfo3 = { postNo: 3, postUrl: 'https://test.com/3' };

            analyzer.observe(element1, postInfo1);
            analyzer.observe(element2, postInfo2);
            analyzer.observe(element3, postInfo3);

            // element1만 화면에 보임
            const elementData1 = analyzer.observedElements.get(element1);
            elementData1.visible = true;

            // Prefetch 실행
            analyzer.prefetch(2);

            // element2, element3가 Queue에 추가되어야 함
            expect(analyzer.analysisQueue.length).toBeGreaterThan(0);
        });
    });

    describe('destroy', () => {
        test('리소스 정리', () => {
            const postInfo = { postNo: 123, postUrl: 'https://test.com/123' };
            analyzer.observe(mockElement, postInfo);
            analyzer.enqueueAnalysis(mockElement, postInfo, 1);

            analyzer.destroy();

            expect(analyzer.observer).toBeNull();
            expect(analyzer.observedElements.size).toBe(0);
            expect(analyzer.analysisQueue.length).toBe(0);
        });
    });

    describe('getStats', () => {
        test('통계 조회', () => {
            const postInfo1 = { postNo: 1, postUrl: 'https://test.com/1' };
            const postInfo2 = { postNo: 2, postUrl: 'https://test.com/2' };

            const element1 = { ...mockElement, dataset: {} };
            const element2 = { ...mockElement, dataset: {} };

            analyzer.observe(element1, postInfo1);
            analyzer.observe(element2, postInfo2);

            // element1만 화면에 보임
            const elementData1 = analyzer.observedElements.get(element1);
            elementData1.visible = true;
            elementData1.analyzed = true;

            const stats = analyzer.getStats();

            expect(stats.totalObserved).toBe(2);
            expect(stats.visibleCount).toBe(1);
            expect(stats.analyzedCount).toBe(1);
            expect(stats.queueLength).toBe(0);
            expect(stats.activeAnalysis).toBe(0);
        });
    });

    describe('실제 시나리오', () => {
        test('스크롤 시나리오', async () => {
            jest.spyOn(analyzer, 'performAnalysis').mockResolvedValue();

            // 10개 게시글 생성
            const elements = [];
            for (let i = 1; i <= 10; i++) {
                const element = { dataset: {}, nextElementSibling: null };
                const postInfo = { postNo: i, postUrl: `https://test.com/${i}` };
                elements.push({ element, postInfo });
                analyzer.observe(element, postInfo);

                if (i < 10) {
                    element.nextElementSibling = elements[i] ? elements[i].element : null;
                }
            }

            // 1-3번 게시글이 화면에 보임
            for (let i = 0; i < 3; i++) {
                analyzer.handleIntersection([{
                    target: elements[i].element,
                    isIntersecting: true
                }]);
            }

            expect(mockOnVisible).toHaveBeenCalledTimes(3);
            expect(analyzer.analysisQueue.length).toBeGreaterThan(0);

            // 스크롤 다운: 1번 이탈, 4번 진입
            analyzer.handleIntersection([{
                target: elements[0].element,
                isIntersecting: false
            }]);

            analyzer.handleIntersection([{
                target: elements[3].element,
                isIntersecting: true
            }]);

            expect(mockOnHidden).toHaveBeenCalledTimes(1);
            expect(mockOnVisible).toHaveBeenCalledTimes(4);
        });
    });
});
