/**
 * Lazy Image Analyzer (Intersection Observer 기반)
 * @author 최진호
 * @date 2026-02-26
 * @version 1.0.0
 * @remarks 화면에 보이는 게시글만 이미지 분석 요청
 */

/**
 * ========================================
 * Lazy Image Analyzer 클래스
 * ========================================
 *
 * Intersection Observer를 사용하여 화면에 보이는 게시글만 분석합니다.
 *
 * 왜 필요한가요?
 * - 100개 게시글을 한 번에 분석하면 네트워크/CPU 부하
 * - 화면 밖 게시글은 사용자가 볼 가능성 낮음
 * - Lazy Loading으로 초기 로딩 성능 개선
 *
 * 동작 방식:
 * 1. 게시글 Row를 Observer에 등록
 * 2. 화면에 진입하면 분석 시작
 * 3. 화면을 벗어나면 우선순위 낮춤
 * 4. Prefetch로 화면 근처 게시글 미리 분석
 *
 * 실생활 비유:
 * "레스토랑 주문:
 *  - 손님이 앉은 테이블만 주문 받기 (Lazy Loading)
 *  - 빈 테이블은 나중에 (Prefetch)
 *  - 주방 과부하 방지 (성능 향상)"
 */
export class LazyImageAnalyzer {
    /**
     * @param {object} options - 옵션
     * @param {Function} options.onVisible - 화면 진입 시 콜백
     * @param {Function} options.onHidden - 화면 이탈 시 콜백
     * @param {number} options.rootMargin - 화면 여유 공간 (픽셀)
     * @param {number} options.threshold - 노출 비율 (0-1)
     */
    constructor(options = {}) {
        this.onVisible = options.onVisible || (() => {});
        this.onHidden = options.onHidden || (() => {});
        this.rootMargin = options.rootMargin || 200;  // 화면 200px 여유
        this.threshold = options.threshold || 0.1;    // 10% 이상 노출 시

        /** 관찰 중인 요소 목록 */
        this.observedElements = new Map();

        /** 분석 대기 Queue (우선순위 큐) */
        this.analysisQueue = [];

        /** 현재 분석 중인 요소 수 */
        this.activeAnalysis = 0;

        /** 최대 동시 분석 수 */
        this.maxConcurrent = 5;

        /** Intersection Observer 인스턴스 */
        this.observer = null;

        this.init();
    }

    /**
     * ========================================
     * 초기화
     * ========================================
     */
    init() {
        if (!('IntersectionObserver' in window)) {
            console.warn('[LazyImageAnalyzer] IntersectionObserver 미지원');
            return;
        }

        this.observer = new IntersectionObserver(
            (entries) => this.handleIntersection(entries),
            {
                root: null,  // viewport 기준
                rootMargin: `${this.rootMargin}px`,
                threshold: this.threshold
            }
        );

        console.log('[LazyImageAnalyzer] 초기화 완료');
    }

    /**
     * ========================================
     * Intersection 이벤트 핸들러
     * ========================================
     *
     * 화면 진입/이탈 시 호출됩니다.
     *
     * @param {IntersectionObserverEntry[]} entries - 변경 사항 목록
     */
    handleIntersection(entries) {
        for (const entry of entries) {
            const element = entry.target;
            const postNo = element.dataset.kasPostNo;

            if (!postNo) continue;

            const elementData = this.observedElements.get(element);

            if (!elementData) continue;

            if (entry.isIntersecting) {
                // ========================================
                // 화면 진입
                // ========================================
                console.log(`[LazyImageAnalyzer] 화면 진입: ${postNo}`);

                elementData.visible = true;
                elementData.priority = 1;  // 최고 우선순위

                // 콜백 호출
                this.onVisible(element, elementData.postInfo);

                // 분석 Queue에 추가
                this.enqueueAnalysis(element, elementData.postInfo, 1);
            } else {
                // ========================================
                // 화면 이탈
                // ========================================
                console.log(`[LazyImageAnalyzer] 화면 이탈: ${postNo}`);

                elementData.visible = false;
                elementData.priority = 2;  // 낮은 우선순위

                // 콜백 호출
                this.onHidden(element, elementData.postInfo);
            }
        }

        // Queue 처리
        this.processQueue();
    }

    /**
     * ========================================
     * 요소 관찰 시작
     * ========================================
     *
     * @param {HTMLElement} element - 게시글 Row 엘리먼트
     * @param {object} postInfo - 게시글 정보 { postNo, postUrl }
     */
    observe(element, postInfo) {
        if (!this.observer) {
            // IntersectionObserver 미지원 → 즉시 분석
            this.onVisible(element, postInfo);
            return;
        }

        if (this.observedElements.has(element)) {
            // 이미 관찰 중
            return;
        }

        // dataset에 postNo 저장 (식별용)
        element.dataset.kasPostNo = postInfo.postNo;

        // 요소 데이터 저장
        this.observedElements.set(element, {
            postInfo: postInfo,
            visible: false,
            priority: 3,  // 기본 우선순위 (낮음)
            analyzed: false
        });

        // 관찰 시작
        this.observer.observe(element);
    }

    /**
     * ========================================
     * 요소 관찰 중지
     * ========================================
     *
     * @param {HTMLElement} element - 게시글 Row 엘리먼트
     */
    unobserve(element) {
        if (!this.observer) return;

        this.observer.unobserve(element);
        this.observedElements.delete(element);

        // Queue에서 제거
        this.analysisQueue = this.analysisQueue.filter(item => item.element !== element);
    }

    /**
     * ========================================
     * 분석 Queue에 추가
     * ========================================
     *
     * @param {HTMLElement} element - 게시글 Row 엘리먼트
     * @param {object} postInfo - 게시글 정보
     * @param {number} priority - 우선순위 (1=최고, 3=낮음)
     */
    enqueueAnalysis(element, postInfo, priority) {
        const elementData = this.observedElements.get(element);

        if (!elementData) return;

        if (elementData.analyzed) {
            // 이미 분석 완료
            return;
        }

        // 이미 Queue에 있는지 확인
        const existing = this.analysisQueue.find(item => item.element === element);

        if (existing) {
            // 우선순위 업데이트
            existing.priority = Math.min(existing.priority, priority);
            return;
        }

        // Queue에 추가
        this.analysisQueue.push({
            element: element,
            postInfo: postInfo,
            priority: priority,
            timestamp: Date.now()
        });

        // 우선순위 정렬 (1=최고 우선순위)
        this.analysisQueue.sort((a, b) => {
            if (a.priority !== b.priority) {
                return a.priority - b.priority;  // 낮은 숫자가 먼저
            }
            return a.timestamp - b.timestamp;  // 같은 우선순위면 먼저 추가된 것
        });
    }

    /**
     * ========================================
     * Queue 처리
     * ========================================
     *
     * 우선순위 높은 것부터 분석 시작합니다.
     */
    async processQueue() {
        // 동시 분석 수 제한
        while (this.activeAnalysis < this.maxConcurrent && this.analysisQueue.length > 0) {
            const item = this.analysisQueue.shift();

            if (!item) break;

            const elementData = this.observedElements.get(item.element);

            if (!elementData || elementData.analyzed) {
                // 이미 분석 완료 또는 제거됨
                continue;
            }

            // 분석 시작
            this.activeAnalysis++;
            elementData.analyzed = true;

            // 비동기 분석 (await 없이)
            this.performAnalysis(item.element, item.postInfo)
                .finally(() => {
                    this.activeAnalysis--;
                    this.processQueue();  // 다음 Queue 처리
                });
        }
    }

    /**
     * ========================================
     * 실제 분석 수행 (외부 구현 필요)
     * ========================================
     *
     * 이 메서드는 LazyImageAnalyzer를 사용하는 측에서
     * 오버라이드하거나 콜백으로 제공해야 합니다.
     *
     * @param {HTMLElement} element - 게시글 Row 엘리먼트
     * @param {object} postInfo - 게시글 정보
     * @returns {Promise<void>}
     */
    async performAnalysis(element, postInfo) {
        console.log(`[LazyImageAnalyzer] 분석 시작: ${postInfo.postNo}`);
        // 실제 분석 로직은 외부에서 주입
    }

    /**
     * ========================================
     * Prefetch (화면 근처 미리 로딩)
     * ========================================
     *
     * 화면에 보이는 요소 주변을 미리 분석합니다.
     *
     * @param {number} count - 미리 로딩할 개수
     */
    prefetch(count = 10) {
        const visibleElements = [];

        // 화면에 보이는 요소 찾기
        for (const [element, data] of this.observedElements.entries()) {
            if (data.visible) {
                visibleElements.push(element);
            }
        }

        if (visibleElements.length === 0) return;

        // 마지막 보이는 요소 다음부터 Prefetch
        const lastVisible = visibleElements[visibleElements.length - 1];
        let nextElement = lastVisible.nextElementSibling;
        let prefetched = 0;

        while (nextElement && prefetched < count) {
            const elementData = this.observedElements.get(nextElement);

            if (elementData && !elementData.analyzed) {
                this.enqueueAnalysis(nextElement, elementData.postInfo, 2);  // 중간 우선순위
                prefetched++;
            }

            nextElement = nextElement.nextElementSibling;
        }

        console.log(`[LazyImageAnalyzer] Prefetch: ${prefetched}개`);
        this.processQueue();
    }

    /**
     * ========================================
     * 정리 (메모리 누수 방지)
     * ========================================
     */
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

    /**
     * ========================================
     * 통계 조회
     * ========================================
     *
     * @returns {object} 통계 정보
     */
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
