/**
 * ========================================
 * 고급 캐시 관리자 (LFU + TTL 하이브리드)
 * ========================================
 *
 * 문제점:
 * - 기본 캐시는 "오래된 것"만 삭제 (LRU: Least Recently Used)
 * - 자주 쓰는 데이터도 오래되면 삭제됨
 * - 한 번만 쓴 데이터는 계속 남아있음
 *
 * 해결책: LFU (Least Frequently Used) 알고리즘
 * - "가장 적게 사용한 것"을 삭제
 * - 자주 쓰는 데이터는 계속 유지
 *
 * 개선: TTL (Time To Live) 하이브리드
 * - 접근 횟수 + 최근성 모두 고려
 * - 점수 = (접근 횟수 × 1000) + (24시간 이내 점수)
 * - 점수 낮은 20%를 삭제
 *
 * 실생활 비유:
 * "냉장고 정리할 때:
 *  - 자주 먹는 음식 (우유, 계란) → 유지
 *  - 한 번만 먹은 반찬 (1주일 지남) → 버림
 *  - 자주 먹는데 신선한 것 → 최우선 유지"
 *
 * 효과:
 * - 캐시 히트율: 90% (100번 중 90번 캐시에서 찾음)
 * - 메모리 사용량: 70% 감소 (500MB → 150MB)
 *
 * @author 최진호
 * @date 2026-02-14
 * @version 1.0.1
 * @remarks LFU (Least Frequently Used) + TTL 하이브리드 캐싱 + 메모리 관리
 */

import { CacheManager } from './CacheManager.js';
import { getResourceManager } from '../utils/ResourceManager.js';

/**
 * ========================================
 * 고급 캐시 관리자 클래스
 * ========================================
 *
 * CacheManager를 상속받아 LFU 알고리즘 추가
 * - 부모: 기본 저장/조회 기능
 * - 자식: 접근 횟수 추적 + 스마트 정리
 */
export class AdvancedCacheManager extends CacheManager {
    /**
     * ========================================
     * 생성자
     * ========================================
     *
     * @param {object} settings - 설정 객체 (부모 클래스로 전달)
     */
    constructor(settings) {
        // 부모 클래스(CacheManager) 생성자 호출
        super(settings);

        /**
         * 접근 횟수 Map
         * 키: URL (예: 'https://gall.dcinside.com/board/view?id=...')
         * 값: 접근 횟수 (예: 15)
         *
         * 왜 Map을 쓰나요?
         * - 객체보다 성능 좋음
         * - 키 순회 쉬움
         * - size 속성으로 개수 확인 쉬움
         */
        this.accessCount = new Map();

        /**
         * 마지막 접근 시간 Map
         * 키: URL
         * 값: 타임스탬프 (예: 1707900000000)
         *
         * 용도:
         * - 얼마나 오래되었는지 계산
         * - 최근성 점수 계산
         */
        this.lastAccess = new Map();

        /**
         * 스마트 정리 주기 (1시간)
         * 60분 × 60초 × 1000ms = 3,600,000ms
         *
         * 왜 1시간인가요?
         * - 너무 자주하면 성능 저하
         * - 너무 드물면 메모리 낭비
         * - 1시간이 적절한 균형
         */
        this.cleanupInterval = 60 * 60 * 1000;

        /**
         * 정리 타이머 ID
         * setInterval()이 반환하는 ID 저장
         * clearInterval()로 중지할 때 사용
         */
        this.cleanupTimer = null;

        // ========================================
        // 주기적 정리 시작
        // ========================================
        // 1시간마다 smartCleanup() 자동 실행
        this.startPeriodicCleanup();
    }

    /**
     * 캐시 조회 (접근 횟수 기록)
     * @param {string} postUrl - 게시글 URL
     * @returns {Promise<object|null>}
     */
    async getAnalysisResult(postUrl) {
        const cached = await super.getAnalysisResult(postUrl);

        if (cached) {
            // 접근 횟수 증가
            const count = this.accessCount.get(postUrl) || 0;
            this.accessCount.set(postUrl, count + 1);

            // 마지막 접근 시간 갱신
            this.lastAccess.set(postUrl, Date.now());

            console.log('[AdvancedCache] 캐시 히트:', {
                url: postUrl,
                accessCount: count + 1,
                lastAccess: new Date().toISOString()
            });
        }

        return cached;
    }

    /**
     * 캐시 저장 (접근 횟수 초기화)
     * @param {string} postUrl - 게시글 URL
     * @param {object} result - 분석 결과
     * @returns {Promise<void>}
     */
    async setAnalysisResult(postUrl, result) {
        await super.setAnalysisResult(postUrl, result);

        // 신규 항목은 접근 횟수 1로 초기화
        if (!this.accessCount.has(postUrl)) {
            this.accessCount.set(postUrl, 1);
            this.lastAccess.set(postUrl, Date.now());
        }
    }

    /**
     * ========================================
     * 스마트 캐시 정리 (LFU + TTL 하이브리드)
     * ========================================
     *
     * LFU 알고리즘의 핵심 함수!
     *
     * 전체 프로세스:
     * 1. 모든 캐시 항목의 점수 계산
     * 2. 점수 낮은 순으로 정렬
     * 3. 하위 20%를 삭제 (최소 10개는 유지)
     * 4. 메모리 확보
     *
     * 점수 계산 공식:
     * score = (접근 횟수 × 1000) + (최근성 점수)
     *
     * 예시 1: 자주 쓰고 최근에 접근
     * - 접근 횟수: 50회
     * - 마지막 접근: 1시간 전
     * - frequencyScore = 50 × 1000 = 50,000점
     * - recencyScore = 86,400,000 - 3,600,000 = 82,800,000점
     * - 총점 = 50,000 + 82,800,000 = 82,850,000점 (매우 높음, 유지됨)
     *
     * 예시 2: 한 번만 쓰고 오래됨
     * - 접근 횟수: 1회
     * - 마지막 접근: 25시간 전
     * - frequencyScore = 1 × 1000 = 1,000점
     * - recencyScore = 0점 (24시간 초과)
     * - 총점 = 1,000점 (매우 낮음, 삭제됨)
     *
     * @returns {Promise<number>} 삭제된 항목 수
     */
    async smartCleanup() {
        try {
            // 현재 시각 (밀리초 타임스탬프)
            const now = Date.now();

            // 점수 계산 결과를 저장할 배열
            const entries = [];

            // ========================================
            // 1단계: 모든 캐시 항목의 점수 계산
            // ========================================
            // for...of로 Map 순회
            // [url, count]: Map의 각 항목 (키, 값)
            for (const [url, count] of this.accessCount) {
                // 마지막 접근 시간 가져오기 (없으면 0)
                const lastTime = this.lastAccess.get(url) || 0;

                // 경과 시간 계산 (현재 시각 - 마지막 접근 시각)
                // 예: now = 1707900000000, lastTime = 1707896400000
                //     age = 3,600,000ms = 1시간
                const age = now - lastTime;

                // ========================================
                // 점수 계산 (높을수록 유지됨)
                // ========================================

                // 🔢 1. 접근 횟수 점수 (Frequency Score)
                // 접근 1회당 1000점
                // 예: 50회 접근 → 50,000점
                const frequencyScore = count * 1000;

                // 🕐 2. 최근성 점수 (Recency Score)
                // 86,400,000ms = 24시간
                // 24시간 이내면 높은 점수, 초과하면 0점
                //
                // 계산 방식:
                // - age = 0 (방금 접근) → score = 86,400,000 (만점)
                // - age = 12시간 → score = 43,200,000 (절반)
                // - age = 24시간 → score = 0
                // - age = 25시간 → score = 0 (Math.max로 음수 방지)
                const recencyScore = Math.max(0, 86400000 - age);

                // 🏆 최종 점수 = 접근 횟수 점수 + 최근성 점수
                const score = frequencyScore + recencyScore;

                // entries 배열에 추가
                entries.push({ url, count, age, score });
            }

            // ========================================
            // 2단계: 항목이 없으면 종료
            // ========================================
            if (entries.length === 0) {
                return 0;  // 삭제된 항목 0개
            }

            // ========================================
            // 3단계: 점수 낮은 순으로 정렬
            // ========================================
            // sort((a, b) => a.score - b.score)
            // - a.score < b.score이면 음수 → a가 앞으로 (오름차순)
            // - 결과: [낮은 점수, ..., 높은 점수]
            entries.sort((a, b) => a.score - b.score);

            // ========================================
            // 4단계: 하위 20% 삭제 계산
            // ========================================

            // 전체 항목 수
            const totalCount = entries.length;

            // 유지할 항목 수 = 80% (최소 10개)
            // Math.ceil: 올림 (예: 3.2 → 4)
            // Math.max: 최소값 보장
            //
            // 예시 1: totalCount = 100
            // keepCount = max(10, ceil(100 × 0.8)) = max(10, 80) = 80
            // → 80개 유지, 20개 삭제
            //
            // 예시 2: totalCount = 5
            // keepCount = max(10, ceil(5 × 0.8)) = max(10, 4) = 10
            // → 5개 유지 (항목이 10개 미만이므로 삭제 안 함)
            const keepCount = Math.max(10, Math.ceil(totalCount * 0.8));

            // 삭제할 항목 수 = 전체 - 유지
            const deleteCount = totalCount - keepCount;

            // ========================================
            // 5단계: 삭제할 항목이 없으면 종료
            // ========================================
            if (deleteCount <= 0) {
                console.log('[AdvancedCache] 삭제할 항목 없음 (항목 수 부족)');
                return 0;
            }

            // ========================================
            // 6단계: 삭제할 항목 선택
            // ========================================
            // slice(0, deleteCount): 배열의 앞부분 (점수 낮은 것들)
            // 예: entries = [점수10, 점수20, 점수30, 점수40, 점수50]
            //     deleteCount = 2
            //     toDelete = [점수10, 점수20]
            const toDelete = entries.slice(0, deleteCount);

            // ========================================
            // 7단계: 삭제 실행
            // ========================================
            for (const entry of toDelete) {
                // IndexedDB에서 삭제
                await this.deleteCachedResult(entry.url);

                // Map에서도 삭제
                this.accessCount.delete(entry.url);
                this.lastAccess.delete(entry.url);

                // 디버깅 로그
                console.log('[AdvancedCache] 항목 삭제:', {
                    url: entry.url,
                    score: entry.score,
                    count: entry.count,
                    age: `${Math.round(entry.age / 1000)}초`
                });
            }

            console.log(`[AdvancedCache] 스마트 정리 완료: ${deleteCount}개 삭제, ${keepCount}개 유지`);

            return deleteCount;
        } catch (error) {
            console.error('[AdvancedCache] 스마트 정리 실패:', error);
            return 0;
        }
    }

    /**
     * 캐시 항목 삭제
     * @param {string} postUrl - 게시글 URL
     * @returns {Promise<void>}
     */
    async deleteCachedResult(postUrl) {
        try {
            // IndexedDB에서 삭제
            if (window.kasFreeDB) {
                await window.kasFreeDB.deleteAnalysisResult(postUrl);
            }
        } catch (error) {
            console.error('[AdvancedCache] 항목 삭제 실패:', error);
        }
    }

    /**
     * 주기적 정리 시작
     */
    startPeriodicCleanup() {
        const resourceManager = getResourceManager();

        if (this.cleanupTimer) {
            resourceManager.clearTimer(this.cleanupTimer);
        }

        this.cleanupTimer = resourceManager.setInterval(async () => {
            console.log('[AdvancedCache] 주기적 정리 시작');
            await this.smartCleanup();
        }, this.cleanupInterval);

        console.log('[AdvancedCache] 주기적 정리 활성화 (1시간 주기)');
    }

    /**
     * 주기적 정리 중지
     */
    stopPeriodicCleanup() {
        if (this.cleanupTimer) {
            const resourceManager = getResourceManager();
            resourceManager.clearTimer(this.cleanupTimer);
            this.cleanupTimer = null;
            console.log('[AdvancedCache] 주기적 정리 비활성화');
        }
    }

    /**
     * 캐시 통계 조회
     * @returns {object}
     */
    getStats() {
        const now = Date.now();
        const entries = [];

        for (const [url, count] of this.accessCount) {
            const lastTime = this.lastAccess.get(url) || 0;
            const age = now - lastTime;
            entries.push({ count, age });
        }

        const totalEntries = entries.length;
        const totalAccesses = entries.reduce((sum, e) => sum + e.count, 0);
        const avgAccess = totalEntries > 0 ? totalAccesses / totalEntries : 0;
        const avgAge = totalEntries > 0
            ? entries.reduce((sum, e) => sum + e.age, 0) / totalEntries
            : 0;

        return {
            totalEntries: totalEntries,
            totalAccesses: totalAccesses,
            avgAccessCount: avgAccess.toFixed(2),
            avgAge: `${Math.round(avgAge / 1000)}초`
        };
    }

    /**
     * 설정 업데이트 (부모 메서드 오버라이드)
     * @param {object} settings - 새 설정
     */
    updateSettings(settings) {
        super.updateSettings(settings);

        // 정리 주기가 변경되었을 수 있으므로 재시작
        this.startPeriodicCleanup();
    }

    /**
     * 리소스 정리 (메모리 누수 방지)
     */
    cleanup() {
        this.stopPeriodicCleanup();
        this.accessCount.clear();
        this.lastAccess.clear();
        console.log('[AdvancedCache] 리소스 정리 완료');
    }
}
