/**
 * Lazy Image Analyzer (Intersection Observer 기반) - Global Script Version
 * @author 최진호
 * @date 2026-02-26
 * @version 1.0.0
 * @remarks Content Script용 전역 스크립트 버전
 */

(function(window) {
    'use strict';

    /**
     * ========================================
     * Lazy Image Analyzer 클래스
     * ========================================
     */
    class LazyImageAnalyzer {
        constructor(options = {}) {
            this.onVisible = options.onVisible || (() => {});
            this.onHidden = options.onHidden || (() => {});
            this.rootMargin = options.rootMargin || 200;
            this.threshold = options.threshold || 0.1;

            this.observedElements = new Map();
            this.analysisQueue = [];
            this.activeAnalysis = 0;
            this.maxConcurrent = 5;
            this.observer = null;

            this.init();
        }

        init() {
            if (!('IntersectionObserver' in window)) {
                console.warn('[LazyImageAnalyzer] IntersectionObserver 미지원');
                return;
            }

            this.observer = new IntersectionObserver(
                (entries) => this.handleIntersection(entries),
                {
                    root: null,
                    rootMargin: `${this.rootMargin}px`,
                    threshold: this.threshold
                }
            );

            console.log('[LazyImageAnalyzer] 초기화 완료');
        }

        handleIntersection(entries) {
            for (const entry of entries) {
                const element = entry.target;
                const postNo = element.dataset.kasPostNo;

                if (!postNo) continue;

                const elementData = this.observedElements.get(element);
                if (!elementData) continue;

                if (entry.isIntersecting) {
                    // 화면 진입
                    console.log(`[LazyImageAnalyzer] 화면 진입: ${postNo}`);

                    elementData.visible = true;
                    elementData.priority = 1;

                    this.onVisible(element, elementData.postInfo);
                    this.enqueueAnalysis(element, elementData.postInfo, 1);
                } else {
                    // 화면 이탈
                    console.log(`[LazyImageAnalyzer] 화면 이탈: ${postNo}`);

                    elementData.visible = false;
                    elementData.priority = 2;

                    this.onHidden(element, elementData.postInfo);
                }
            }

            this.processQueue();
        }

        observe(element, postInfo) {
            if (!this.observer) {
                this.onVisible(element, postInfo);
                return;
            }

            if (this.observedElements.has(element)) {
                return;
            }

            element.dataset.kasPostNo = postInfo.postNo;

            this.observedElements.set(element, {
                postInfo: postInfo,
                visible: false,
                priority: 3,
                analyzed: false
            });

            this.observer.observe(element);
        }

        unobserve(element) {
            if (!this.observer) return;

            this.observer.unobserve(element);
            this.observedElements.delete(element);

            this.analysisQueue = this.analysisQueue.filter(item => item.element !== element);
        }

        enqueueAnalysis(element, postInfo, priority) {
            const elementData = this.observedElements.get(element);

            if (!elementData) return;
            if (elementData.analyzed) return;

            const existing = this.analysisQueue.find(item => item.element === element);

            if (existing) {
                existing.priority = Math.min(existing.priority, priority);
                return;
            }

            this.analysisQueue.push({
                element: element,
                postInfo: postInfo,
                priority: priority,
                timestamp: Date.now()
            });

            this.analysisQueue.sort((a, b) => {
                if (a.priority !== b.priority) {
                    return a.priority - b.priority;
                }
                return a.timestamp - b.timestamp;
            });
        }

        async processQueue() {
            while (this.activeAnalysis < this.maxConcurrent && this.analysisQueue.length > 0) {
                const item = this.analysisQueue.shift();

                if (!item) break;

                const elementData = this.observedElements.get(item.element);

                if (!elementData || elementData.analyzed) {
                    continue;
                }

                this.activeAnalysis++;
                elementData.analyzed = true;

                this.performAnalysis(item.element, item.postInfo)
                    .finally(() => {
                        this.activeAnalysis--;
                        this.processQueue();
                    });
            }
        }

        async performAnalysis(element, postInfo) {
            console.log(`[LazyImageAnalyzer] 분석 시작: ${postInfo.postNo}`);
        }

        prefetch(count = 10) {
            const visibleElements = [];

            for (const [element, data] of this.observedElements.entries()) {
                if (data.visible) {
                    visibleElements.push(element);
                }
            }

            if (visibleElements.length === 0) return;

            const lastVisible = visibleElements[visibleElements.length - 1];
            let nextElement = lastVisible.nextElementSibling;
            let prefetched = 0;

            while (nextElement && prefetched < count) {
                const elementData = this.observedElements.get(nextElement);

                if (elementData && !elementData.analyzed) {
                    this.enqueueAnalysis(nextElement, elementData.postInfo, 2);
                    prefetched++;
                }

                nextElement = nextElement.nextElementSibling;
            }

            console.log(`[LazyImageAnalyzer] Prefetch: ${prefetched}개`);
            this.processQueue();
        }

        destroy() {
            if (this.observer) {
                this.observer.disconnect();
                this.observer = null;
            }

            this.observedElements.clear();
            this.analysisQueue = [];
            this.activeAnalysis = 0;

            console.log('[LazyImageAnalyzer] 정리 완료');
        }

        getStats() {
            const totalObserved = this.observedElements.size;
            let visibleCount = 0;
            let analyzedCount = 0;

            for (const data of this.observedElements.values()) {
                if (data.visible) visibleCount++;
                if (data.analyzed) analyzedCount++;
            }

            return {
                totalObserved: totalObserved,
                visibleCount: visibleCount,
                analyzedCount: analyzedCount,
                queueLength: this.analysisQueue.length,
                activeAnalysis: this.activeAnalysis
            };
        }
    }

    // 전역 노출
    window.LazyImageAnalyzer = LazyImageAnalyzer;

})(window);
