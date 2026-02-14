/**
 * ========================================
 * 카-스 프리 Content Script
 * ========================================
 *
 * 역할:
 * - 디시인사이드 웹 페이지에 직접 삽입되는 스크립트
 * - DOM을 조작하여 신호등을 표시하고 사용자 인터랙션 처리
 * - Service Worker(백그라운드)와 메시지 통신으로 이미지 분석 요청
 *
 * Content Script란?
 * - Chrome Extension의 3대 컴포넌트 중 하나:
 *   1. Service Worker (백그라운드, 백엔드)
 *   2. Content Script (웹 페이지에 삽입, 프론트엔드)
 *   3. Options Page (설정 페이지)
 *
 * - 웹 페이지의 DOM에 직접 접근 가능 (JavaScript로 페이지 조작)
 * - 웹 페이지와 같은 컨텍스트에서 실행 (페이지 요소 읽기/수정 가능)
 * - Service Worker와 chrome.runtime.sendMessage()로 통신
 *
 * 실생활 비유:
 * "웹 페이지를 '책'이라고 하면:
 *  - Content Script = 책에 포스트잇과 형광펜으로 메모를 추가하는 작업
 *  - Service Worker = 뒤에서 계산을 대신 해주는 조수
 *  - 둘이 메시지로 소통 (포스트잇: '이 이미지 분석해줘' → 조수: '위험해!)"
 *
 * @author 최진호
 * @date 2026-01-31
 * @version 1.0.0
 * @remarks 디시인사이드 DOM에 신호등을 삽입하고 이미지 분석을 요청
 */

/**
 * ========================================
 * IIFE (즉시 실행 함수 표현식)
 * ========================================
 *
 * IIFE란?
 * - Immediately Invoked Function Expression
 * - 정의와 동시에 즉시 실행되는 함수
 * - 형식: (function() { ... })();
 *
 * 왜 IIFE를 쓰나요?
 * - 전역 스코프 오염 방지 (변수가 전역 변수로 노출 안 됨)
 * - 코드 격리 (다른 스크립트와 변수 충돌 방지)
 * - 네임스페이스 역할 (모든 변수가 함수 내부에만 존재)
 *
 * 실생활 비유:
 * "회사 기밀 회의를 할 때:
 *  - 회의실(IIFE) 안에서만 대화 (밖에서 안 들림)
 *  - 회의 끝나면 자동으로 정리됨 (메모리 누수 방지)
 *  - 다른 팀 회의와 섞이지 않음 (변수 충돌 방지)"
 *
 * 예시:
 * // 일반 함수 (전역 변수 오염)
 * var myVar = 123;  // window.myVar로 전역 노출됨
 *
 * // IIFE (격리된 스코프)
 * (function() {
 *     var myVar = 123;  // 함수 내부에만 존재, 밖에서 접근 불가
 * })();
 */
(function() {
    'use strict';  // 엄격 모드 (실수 방지: 선언 없는 변수 사용 금지, this 안전성 등)

    /**
     * ========================================
     * 신호등 상태 상수 (Enum 패턴)
     * ========================================
     *
     * 왜 객체로 정의하나요?
     * - 오타 방지: SIGNAL_STATUS.SAFE (자동완성 지원)
     * - 유지보수 용이: 상태명을 한 곳에서만 변경
     * - 가독성: 'safe'보다 SIGNAL_STATUS.SAFE가 의미 명확
     *
     * 실생활 비유:
     * "신호등의 6가지 상태:
     *  - 안전 (초록불)
     *  - 주의 (노란불)
     *  - 위험 (빨간불)
     *  - 미검사 (회색불, 아직 검사 안 함)
     *  - 검사 중 (깜빡임)
     *  - 검사 실패 (고장)"
     */
    const SIGNAL_STATUS = {
        SAFE:      'safe',        // 안전 (riskScore < 0.3)
        CAUTION:   'caution',     // 주의 (0.3 ≤ riskScore < 0.6)
        DANGER:    'danger',      // 위험 (riskScore ≥ 0.6)
        UNCHECKED: 'unchecked',   // 미검사 (이미지 없음 or 자동검사 꺼짐)
        LOADING:   'loading',     // 검사 중 (API 요청 중)
        ERROR:     'error'        // 검사 실패 (API 에러, 타임아웃 등)
    };

    /**
     * ========================================
     * 신호등 라벨 (사용자에게 보여줄 한글 텍스트)
     * ========================================
     *
     * Computed Property Names 문법:
     * - [SIGNAL_STATUS.SAFE]: '안전'
     * - 대괄호로 객체 키를 동적으로 생성
     * - 예: { ['hello']: 'world' } → { hello: 'world' }
     *
     * 왜 이렇게 하나요?
     * - 신호등 툴팁에 표시할 한글 라벨
     * - status 값으로 빠르게 한글 변환 가능
     *   예: SIGNAL_LABELS[status] → '안전'
     */
    const SIGNAL_LABELS = {
        [SIGNAL_STATUS.SAFE]:      '안전',
        [SIGNAL_STATUS.CAUTION]:   '주의',
        [SIGNAL_STATUS.DANGER]:    '위험',
        [SIGNAL_STATUS.UNCHECKED]: '미검사',
        [SIGNAL_STATUS.LOADING]:   '검사 중...',
        [SIGNAL_STATUS.ERROR]:     '검사 실패'
    };

    /**
     * ========================================
     * 전역 변수 (함수 간 공유 데이터)
     * ========================================
     *
     * 왜 전역 변수를 쓰나요?
     * - IIFE 내부에서는 '전역'이지만 실제로는 함수 스코프에 격리됨
     * - 다른 함수에서 접근 가능 (공유 상태 관리)
     * - 페이지 언로드 시 자동으로 메모리 해제됨
     *
     * null vs Map vs Set:
     * - null: 단일 객체 저장 (설정, 툴팁)
     * - Map: 키-값 쌍 (게시글 번호 → 분석 결과)
     * - Set: 중복 없는 목록 (실패한 게시글 번호)
     */

    /**
     * 현재 설정
     * @type {object|null}
     *
     * 구조:
     * {
     *   enabled: true,           // 확장 활성화 여부
     *   autoScan: true,          // 자동 검사
     *   cacheEnabled: true,      // 캐시 사용
     *   sensitivity: {...},      // 민감도 설정
     *   thresholds: {...}        // 신호등 임계값
     * }
     *
     * 초기값이 null인 이유:
     * - 아직 chrome.storage에서 로드하지 않음
     * - loadSettings() 호출 후 객체로 채워짐
     */
    let currentSettings = null;

    /**
     * 툴팁 엘리먼트 (신호등 마우스 오버 시 표시)
     * @type {HTMLElement|null}
     *
     * 왜 전역 변수인가요?
     * - 페이지당 하나의 툴팁만 존재 (재사용)
     * - 신호등마다 툴팁을 만들면 메모리 낭비
     * - 마우스 오버 시 내용만 교체하여 표시
     */
    let tooltipElement = null;

    /**
     * 프리뷰 툴팁 엘리먼트 (게시글 Row 마우스 오버 시 본문 미리보기)
     * @type {HTMLElement|null}
     *
     * 기능:
     * - 게시글 목록에서 마우스 올리면 본문 내용 표시
     * - AI 분석 결과도 함께 표시 (위험도, 설명)
     */
    let previewTooltipElement = null;

    /**
     * 프리뷰 타이머 (debounce용)
     * @type {number|null}
     *
     * Debounce란?
     * - 연속된 이벤트를 하나로 묶어 마지막 것만 실행
     * - 예: 마우스 빠르게 여러 게시글 위로 지나가면 마지막 것만 프리뷰 표시
     *
     * 실생활 비유:
     * "엘리베이터 문 닫기 버튼:
     *  - 버튼을 연타해도 마지막 누른 것만 유효
     *  - 300ms 대기 후 문이 닫힘
     *  - 중간에 또 누르면 타이머 리셋"
     *
     * 구현:
     * clearTimeout(previewTimer);  // 이전 타이머 취소
     * previewTimer = setTimeout(() => {
     *     showPostPreview();       // 300ms 후 실행
     * }, 300);
     */
    let previewTimer = null;

    /**
     * DOM 변경 감지 debounce 타이머
     * @type {number|null}
     *
     * 왜 필요한가요?
     * - MutationObserver가 빠르게 여러 번 트리거될 수 있음
     * - 예: 무한 스크롤로 10개 게시글이 한 번에 추가됨
     * - 각각 processPostList() 호출하면 중복 작업 발생
     * - 300ms 대기 후 한 번만 실행
     */
    let domChangeTimer = null;

    /**
     * 프리뷰 실패한 게시글 목록 (재시도 방지)
     * @type {Set<string>}
     *
     * Set 자료구조:
     * - 중복 없는 값 목록 저장
     * - .add(postNo), .has(postNo), .delete(postNo)
     * - 배열보다 빠름 (O(1) vs O(n))
     *
     * 왜 필요한가요?
     * - 본문 fetch 실패한 게시글은 재시도하지 않음
     * - 404 에러나 권한 없는 게시글은 계속 시도해도 실패
     * - 불필요한 네트워크 요청 방지
     */
    const failedPreviews = new Set();

    /**
     * 초기화 완료 여부
     * @type {boolean}
     *
     * 왜 필요한가요?
     * - initialize() 함수가 중복 실행되지 않도록 보호
     * - Content Script는 여러 번 로드될 수 있음 (DCRefresher, 페이지 새로고침 등)
     * - 중복 초기화 시 이벤트 리스너 중복 등록, 메모리 누수
     */
    let isInitialized = false;

    /**
     * ========================================
     * 하이브리드 캐시 (메모리 + IndexedDB)
     * ========================================
     *
     * 왜 하이브리드 캐시인가요?
     * - 메모리 (Map): 빠름 (O(1)), 페이지 새로고침 시 사라짐
     * - IndexedDB: 느림 (비동기), 영구 저장 (브라우저 닫아도 유지)
     * - 2단계 전략: 메모리 우선 → 없으면 IndexedDB → 없으면 분석 요청
     *
     * 실생활 비유:
     * "책상(메모리) + 서랍(IndexedDB):
     *  - 자주 쓰는 것은 책상에 (빠른 접근)
     *  - 가끔 쓰는 것은 서랍에 (용량 크지만 꺼내기 느림)
     *  - 책상에 없으면 서랍 확인 → 서랍에도 없으면 새로 구매"
     *
     * 효과:
     * - 캐시 히트율 90% (100번 중 90번은 메모리에서 즉시 반환)
     * - IndexedDB 접근 횟수 10% (새로운 게시글만)
     */

    /**
     * 분석 완료된 게시글 캐시 (postNo → result)
     * @type {Map<string, object>}
     *
     * Map 자료구조:
     * - 키-값 쌍 저장 (딕셔너리, HashMap)
     * - 객체보다 빠르고 안전
     * - 키 순회 쉬움: for (const [key, value] of map)
     *
     * 구조:
     * Map {
     *   '12345678' => { status: 'danger', riskScore: 0.85, ... },
     *   '12345679' => { status: 'safe', riskScore: 0.12, ... }
     * }
     */
    const analyzedPosts = new Map();

    /**
     * 게시글 본문 캐시 (postNo → content)
     * @type {Map<string, object>}
     *
     * 구조:
     * Map {
     *   '12345678' => {
     *     text: '게시글 본문 내용...',
     *     imageCount: 3,
     *     dcconCount: 1
     *   }
     * }
     *
     * 용도:
     * - 게시글 프리뷰 표시 (마우스 오버 시)
     * - 본문 fetch 횟수 줄임 (네트워크 절약)
     */
    const postContentCache = new Map();

    /**
     * ========================================
     * 디버그 로그 출력 함수
     * ========================================
     *
     * 왜 debugLog() 함수를 만드나요?
     * - console.log()를 직접 쓰면 프로덕션에서도 로그가 출력됨
     * - debugMode 설정으로 개발/프로덕션 로그 제어
     * - 로그 접두어 [Kas-Free] 자동 추가 (다른 로그와 구분)
     *
     * ...args (Rest Parameters):
     * - 가변 인자 (인자 개수 제한 없음)
     * - 배열로 받음: args = ['a', 'b', 'c']
     * - 예: debugLog('test', 123, { x: 1 })
     *   → console.log('[Kas-Free]', 'test', 123, { x: 1 })
     *
     * @param {...any} args - 로그 인자 (제한 없음)
     */
    function debugLog(...args) {
        // debugMode가 true일 때만 로그 출력
        if (currentSettings && currentSettings.debugMode) {
            console.log('[Kas-Free]', ...args);  // ...args: 배열을 다시 펼침 (Spread)
        }
        // debugMode가 false면 아무것도 출력하지 않음 (프로덕션 최적화)
    }

    /**
     * ========================================
     * 하이브리드 캐시: 분석 결과 가져오기
     * ========================================
     *
     * 2단계 캐시 전략 (메모리 → IndexedDB):
     * 1. 메모리 캐시 확인 (Map, O(1), 즉시 반환)
     * 2. 메모리에 없으면 IndexedDB 확인 (비동기, ~10ms)
     * 3. IndexedDB에도 없으면 null 반환
     *
     * 왜 2단계인가요?
     * - 메모리: 빠르지만 휘발성 (페이지 새로고침 시 사라짐)
     * - IndexedDB: 느리지만 영구 저장 (브라우저 닫아도 유지)
     * - 자주 쓰는 데이터는 메모리에 캐싱 (Cache Warming)
     *
     * 실생활 비유:
     * "자주 읽는 책 찾기:
     *  1. 책상 위 확인 (메모리) → 바로 읽기 시작
     *  2. 없으면 책꽂이 확인 (IndexedDB) → 꺼내서 책상에 올림
     *  3. 책꽂이에도 없으면 도서관 가야 함 (API 요청)"
     *
     * 성능 예시:
     * - 메모리 히트: 0.1ms (즉시)
     * - IndexedDB 히트: 10ms (비동기 I/O)
     * - API 요청: 500~3000ms (네트워크)
     *
     * @param {string} postNo - 게시글 번호 (예: '12345678')
     * @returns {Promise<object|null>} 분석 결과 또는 null
     */
    async function getAnalysisFromCache(postNo) {
        // ========================================
        // 1단계: 메모리 캐시 확인 (최우선)
        // ========================================
        // Map.has(): O(1) 시간 복잡도 (해시맵)
        if (analyzedPosts.has(postNo)) {
            // 즉시 반환 (0.1ms 미만)
            return analyzedPosts.get(postNo);
        }

        // ========================================
        // 2단계: cacheEnabled 확인
        // ========================================
        // 사용자가 캐시를 껐으면 IndexedDB 사용 안 함
        if (!currentSettings || !currentSettings.cacheEnabled) {
            return null;  // 캐시 없음, 새로 분석 필요
        }

        // ========================================
        // 3단계: IndexedDB 확인
        // ========================================
        // window.kasFreeDB: db.js에서 전역으로 등록한 IndexedDB 인스턴스
        if (!window.kasFreeDB) {
            console.warn('[Kas-Free] IndexedDB가 아직 초기화되지 않음');
            return null;
        }

        try {
            // ========================================
            // IndexedDB에서 분석 결과 조회 (비동기)
            // ========================================
            // getAnalysisResult(): db.js의 메서드
            // 약 10ms 소요 (비동기 I/O)
            const result = await window.kasFreeDB.getAnalysisResult(postNo);

            if (result) {
                // ========================================
                // Cache Warming (메모리 캐시에 저장)
                // ========================================
                // IndexedDB에서 읽은 데이터를 메모리에도 저장
                // 다음에 같은 게시글 접근 시 메모리에서 즉시 반환 (0.1ms)
                analyzedPosts.set(postNo, result);

                return result;  // IndexedDB 히트 성공
            }
        } catch (error) {
            // ========================================
            // IndexedDB 읽기 실패 (에러 처리)
            // ========================================
            // 가능한 에러:
            // - QuotaExceededError: 용량 초과
            // - InvalidStateError: DB가 닫힘
            // - UnknownError: 알 수 없는 에러
            console.error('[Kas-Free] IndexedDB 읽기 실패:', error);
        }

        // ========================================
        // 캐시 미스 (메모리, IndexedDB 모두 없음)
        // ========================================
        return null;  // 새로 분석 요청 필요
    }

    /**
     * ========================================
     * 하이브리드 캐시: 분석 결과 저장
     * ========================================
     *
     * 2단계 저장 전략 (메모리 + IndexedDB):
     * 1. 메모리 캐시에 저장 (즉시, 항상 성공)
     * 2. IndexedDB에 저장 (비동기, 실패해도 무시)
     *
     * 왜 이렇게 하나요?
     * - 메모리 저장은 즉시 반영 (사용자 경험 우선)
     * - IndexedDB 실패해도 메모리 캐시는 유지됨 (신호등 표시됨)
     * - 다음 페이지 로드 시에는 캐시 없을 수 있음 (재분석)
     *
     * 실생활 비유:
     * "메모를 두 곳에 저장:
     *  1. 포스트잇에 적기 (메모리) → 즉시 사용 가능
     *  2. 노트에 옮겨 적기 (IndexedDB) → 나중에도 보관
     *  - 노트 쓰기 실패해도 포스트잇에는 있음 (일단 동작함)"
     *
     * 에러 시나리오:
     * - QuotaExceededError: 브라우저 용량 초과 (5~50MB 제한)
     *   → 메모리 캐시는 동작, 페이지 새로고침 시 재분석
     * - InvalidStateError: DB가 닫힘
     *   → 메모리 캐시는 동작, 다음 로드 시 재분석
     *
     * @param {string} postNo - 게시글 번호 (예: '12345678')
     * @param {object} data - 분석 결과
     * @returns {Promise<void>}
     */
    async function setAnalysisToCache(postNo, data) {
        // ========================================
        // 1단계: 메모리 캐시 저장 (최우선, 항상 실행)
        // ========================================
        // Map.set(): O(1) 시간 복잡도
        // 즉시 저장되어 다음 getAnalysisFromCache() 호출 시 0.1ms만에 반환
        analyzedPosts.set(postNo, data);

        // ========================================
        // 2단계: cacheEnabled 확인
        // ========================================
        // 사용자가 캐시를 껐으면 IndexedDB 저장 안 함
        // 메모리 캐시는 이미 저장되었으므로 현재 페이지에서는 동작함
        if (!currentSettings || !currentSettings.cacheEnabled) {
            return;  // 메모리 캐시만 사용, IndexedDB는 스킵
        }

        // ========================================
        // 3단계: IndexedDB 저장 (비동기, 실패해도 무시)
        // ========================================
        if (!window.kasFreeDB) {
            console.warn('[Kas-Free] IndexedDB가 아직 초기화되지 않음');
            return;  // IndexedDB 없어도 메모리 캐시는 동작
        }

        try {
            // ========================================
            // IndexedDB에 비동기 저장 (약 10ms)
            // ========================================
            // setAnalysisResult(): db.js의 메서드
            // 성공 시: 다음 페이지 로드에서도 캐시 사용 가능
            // 실패 시: 메모리 캐시만 사용, 페이지 새로고침 시 재분석
            await window.kasFreeDB.setAnalysisResult(postNo, data);
        } catch (error) {
            // ========================================
            // IndexedDB 쓰기 실패 (에러 무시)
            // ========================================
            // 가능한 에러:
            // - QuotaExceededError: 용량 초과 (가장 흔함)
            //   → 오래된 캐시 삭제 필요 (trimToLimit(), deleteOldRecords())
            // - InvalidStateError: DB가 닫힘
            // - UnknownError: 알 수 없는 에러
            //
            // 메모리 캐시는 이미 저장되었으므로 현재 페이지에서는 정상 동작
            console.error('[Kas-Free] IndexedDB 쓰기 실패:', error);
        }
        // 에러가 발생해도 함수는 정상 종료 (메모리 캐시는 유지)
    }

    /**
     * ========================================
     * 하이브리드 캐시: 게시글 본문 가져오기
     * ========================================
     *
     * 분석 결과 캐시(analyzedPosts)와 동일한 2단계 전략:
     * 1. 메모리 캐시 확인 (postContentCache Map)
     * 2. IndexedDB 확인 (kasFreeDB.getPostContent)
     *
     * 용도:
     * - 게시글 프리뷰 표시 (마우스 오버 시)
     * - 본문 내용: 텍스트, 이미지 개수, 디시콘 개수
     *
     * 왜 별도 캐시인가요?
     * - 분석 결과는 항상 필요 (신호등 표시)
     * - 본문 내용은 선택적 (프리뷰 기능 사용 시에만)
     * - 분리하여 메모리 효율 향상
     *
     * 데이터 구조:
     * {
     *   text: '게시글 본문 내용...',  // 첫 150자만 저장 (프리뷰용)
     *   imageCount: 3,                // 일반 이미지 개수
     *   dcconCount: 1                 // 디시콘 개수
     * }
     *
     * @param {string} postNo - 게시글 번호
     * @returns {Promise<object|null>} 본문 데이터 또는 null
     */
    async function getContentFromCache(postNo) {
        // 1순위: 메모리 캐시 (즉시 반환)
        if (postContentCache.has(postNo)) {
            return postContentCache.get(postNo);
        }

        // cacheEnabled가 false면 IndexedDB 사용 안 함
        if (!currentSettings || !currentSettings.cacheEnabled) {
            return null;
        }

        // 2순위: IndexedDB (비동기 조회)
        if (!window.kasFreeDB) {
            return null;
        }

        try {
            const result = await window.kasFreeDB.getPostContent(postNo);
            if (result) {
                // Cache Warming: 메모리 캐시에도 저장 (다음 접근 시 빠름)
                postContentCache.set(postNo, result);
                return result;
            }
        } catch (error) {
            console.error('[Kas-Free] IndexedDB 읽기 실패:', error);
        }

        return null;  // 캐시 미스, fetch 필요
    }

    /**
     * ========================================
     * 하이브리드 캐시: 게시글 본문 저장
     * ========================================
     *
     * 분석 결과 저장(setAnalysisToCache)과 동일한 2단계 전략:
     * 1. 메모리 캐시 저장 (즉시)
     * 2. IndexedDB 저장 (비동기, 실패해도 무시)
     *
     * 호출 시점:
     * - showPostPreview()에서 게시글 본문 fetch 후
     * - 다음 프리뷰 표시 시 fetch 없이 캐시에서 즉시 표시
     *
     * @param {string} postNo - 게시글 번호
     * @param {object} data - 본문 데이터 { text, imageCount, dcconCount }
     * @returns {Promise<void>}
     */
    async function setContentToCache(postNo, data) {
        // 메모리 캐시 저장 (즉시)
        postContentCache.set(postNo, data);

        // cacheEnabled가 false면 IndexedDB 저장 안 함
        if (!currentSettings || !currentSettings.cacheEnabled) {
            return;
        }

        // IndexedDB 저장 (실패해도 메모리 캐시는 유지)
        if (!window.kasFreeDB) {
            return;
        }

        try {
            await window.kasFreeDB.setPostContent(postNo, data);
        } catch (error) {
            console.error('[Kas-Free] IndexedDB 쓰기 실패:', error);
        }
    }

    /**
     * ========================================
     * IndexedDB 초기화 및 정리
     * ========================================
     *
     * IndexedDB란?
     * - 브라우저 내장 로컬 데이터베이스 (NoSQL)
     * - 키-값 저장소 (객체 저장 가능)
     * - 비동기 API (Promise 기반)
     * - 용량 제한: 브라우저마다 다름 (보통 50MB~수 GB)
     *
     * 왜 IndexedDB를 쓰나요?
     * - 캐시 영구 저장 (페이지 새로고침, 브라우저 재시작 후에도 유지)
     * - 대용량 저장 가능 (LocalStorage는 5~10MB 제한)
     * - 트랜잭션 지원 (데이터 무결성 보장)
     *
     * 이 함수가 하는 일:
     * 1. DB 초기화 (테이블 생성)
     * 2. 오래된 캐시 삭제 (30일 TTL)
     * 3. 용량 초과 캐시 삭제 (5000개 제한)
     * 4. 주기적 정리 설정 (1시간마다)
     * 5. 페이지 언로드 시 정리 (메모리 누수 방지)
     *
     * 실생활 비유:
     * "창고 관리:
     *  1. 창고 문 열기 (DB 초기화)
     *  2. 오래된 재고 버리기 (30일 지난 것)
     *  3. 창고 꽉 차면 오래된 것부터 버림 (5000개 제한)
     *  4. 1시간마다 자동 정리
     *  5. 퇴근 시 정리 (메모리 누수 방지)"
     */
    async function initializeDatabase() {
        // ========================================
        // 1단계: kasFreeDB 로드 확인
        // ========================================
        // window.kasFreeDB: db.js에서 전역으로 등록한 DB 인스턴스
        // manifest.json의 content_scripts 순서:
        //   1. db.js (먼저 로드)
        //   2. dcParser.js
        //   3. content.js (마지막)
        if (!window.kasFreeDB) {
            console.error('[Kas-Free] kasFreeDB가 로드되지 않음. db.js 파일을 확인하세요.');
            return;  // DB 없이는 진행 불가 (하지만 메모리 캐시는 동작)
        }

        try {
            // ========================================
            // 2단계: DB 초기화
            // ========================================
            // init(): IndexedDB 연결 및 테이블 생성
            // - 테이블명: analysisResults, postContents
            // - 인덱스: postNo (PK), timestamp (정렬용)
            await window.kasFreeDB.init();

            // ========================================
            // 3단계: 오래된 데이터 삭제 (30일 TTL)
            // ========================================
            // TTL (Time To Live):
            // - 캐시 만료 시간 (30일)
            // - 30일 이상 된 데이터는 자동 삭제
            //
            // 왜 30일인가요?
            // - 너무 짧으면 캐시 히트율 낮아짐 (재분석 증가)
            // - 너무 길면 용량 낭비
            // - 디시인사이드는 게시글 삭제가 잦음 (30일 후엔 대부분 삭제됨)
            const deletedOld = await window.kasFreeDB.deleteOldRecords(30);
            if (deletedOld > 0) {
                console.log(`[Kas-Free] ${deletedOld}개의 오래된 캐시 삭제 (30일 초과)`);
            }

            // ========================================
            // 4단계: 용량 제한 (5000개)
            // ========================================
            // trimToLimit(5000):
            // - 캐시 개수가 5000개를 초과하면 오래된 것부터 삭제
            // - LRU (Least Recently Used) 전략: 오래된 것부터 삭제
            //
            // 왜 5000개인가요?
            // - 5000개 × 평균 10KB = 50MB
            // - 브라우저 용량 제한 (보통 50MB~100MB)
            // - 너무 많으면 IndexedDB 느려짐 (쿼리 속도 저하)
            const deletedOverLimit = await window.kasFreeDB.trimToLimit(5000);
            if (deletedOverLimit > 0) {
                console.log(`[Kas-Free] 용량 초과로 ${deletedOverLimit}개 캐시 삭제 (5000개 초과)`);
            }

            // ========================================
            // 5단계: DB 통계 조회 (디버깅용)
            // ========================================
            // getStats(): 현재 DB 상태 정보
            // - totalCount: 전체 캐시 개수
            // - analysisCount: 분석 결과 개수
            // - contentCount: 게시글 본문 개수
            const stats = await window.kasFreeDB.getStats();
            console.log('[Kas-Free] IndexedDB 통계:', stats);

            // ========================================
            // 6단계: 주기적 정리 설정 (1시간마다)
            // ========================================
            // setInterval():
            // - 주기적으로 함수 실행 (1시간 = 3,600,000ms)
            // - 백그라운드에서 자동 정리
            // - 사용자는 정리 작업을 모름 (성능 저하 없음)
            //
            // 왜 1시간인가요?
            // - 너무 자주하면 성능 저하 (IndexedDB I/O 부담)
            // - 너무 드물면 용량 초과 가능성
            // - 1시간이 적절한 균형
            const cleanupIntervalId = setInterval(async () => {
                try {
                    // 30일 지난 캐시 삭제
                    await window.kasFreeDB.deleteOldRecords(30);
                    // 5000개 초과 캐시 삭제
                    await window.kasFreeDB.trimToLimit(5000);
                } catch (error) {
                    console.error('[Kas-Free] 주기적 정리 실패:', error);
                }
            }, 60 * 60 * 1000);  // 1시간 = 60분 × 60초 × 1000ms = 3,600,000ms

            // ========================================
            // 7단계: 메모리 누수 방지 (페이지 언로드 시 정리)
            // ========================================
            // beforeunload 이벤트:
            // - 페이지 닫기, 새로고침, 다른 페이지 이동 시 발생
            // - 마지막 정리 작업 수행
            //
            // 정리 대상:
            // 1. 툴팁 엘리먼트 제거 (DOM 정리)
            // 2. setInterval 정리 (타이머 중지)
            //
            // 왜 정리가 필요한가요?
            // - setInterval은 페이지가 닫혀도 계속 실행됨 (메모리 누수)
            // - DOM 엘리먼트는 자동 제거되지만 이벤트 리스너는 남음
            window.addEventListener('beforeunload', () => {
                // ========================================
                // 툴팁 제거 (DOM 정리)
                // ========================================
                hideTooltip();        // 신호등 툴팁 숨김
                hidePostPreview();    // 게시글 프리뷰 툴팁 숨김

                // ========================================
                // 인터벌 정리 (타이머 중지)
                // ========================================
                // clearInterval(): setInterval로 등록한 타이머 중지
                // 중지하지 않으면 메모리 누수 발생
                if (cleanupIntervalId) {
                    clearInterval(cleanupIntervalId);  // 주기적 DB 정리 중지
                }
                if (window.periodicCheckIntervalId) {
                    clearInterval(window.periodicCheckIntervalId);  // 주기적 신호등 체크 중지
                }
                // 이제 타이머가 완전히 중지됨 (메모리 해제)
            });

        } catch (error) {
            // ========================================
            // IndexedDB 초기화 실패 (에러 처리)
            // ========================================
            // 가능한 에러:
            // - InvalidStateError: DB가 이미 열려있음
            // - UnknownError: 브라우저가 IndexedDB 지원 안 함
            // - QuotaExceededError: 용량 초과
            //
            // 초기화 실패해도:
            // - 메모리 캐시(Map)는 동작함
            // - 페이지 새로고침 시 캐시 사라짐 (재분석 필요)
            console.error('[Kas-Free] IndexedDB 초기화 실패:', error);
        }
    }

    /**
     * ========================================
     * 메인 초기화 함수
     * ========================================
     *
     * Content Script의 진입점:
     * 1. 중복 실행 방지
     * 2. IndexedDB 초기화
     * 3. 설정 로드
     * 4. 메시지 리스너 등록
     * 5. 페이지 타입 감지 (목록 vs 상세)
     * 6. 신호등 삽입 또는 이미지 대체
     *
     * 호출 시점:
     * - DOMContentLoaded 이벤트 (페이지 DOM 로드 완료)
     * - 또는 document.readyState가 이미 완료된 경우 즉시 실행
     *
     * 실생활 비유:
     * "회사 출근 후 업무 시작:
     *  1. 중복 로그인 방지 (이미 로그인했는지 확인)
     *  2. 시스템 부팅 (DB 연결)
     *  3. 설정 불러오기 (개인 환경설정)
     *  4. 메시지 수신 대기 (메신저 켜기)
     *  5. 오늘 업무 확인 (목록 페이지 vs 상세 페이지)
     *  6. 업무 시작 (신호등 삽입)"
     */
    async function initialize() {
        // ========================================
        // 1단계: 중복 실행 방지
        // ========================================
        // Content Script는 여러 번 로드될 수 있음:
        // - DCRefresher가 페이지를 재렌더링할 때
        // - 사용자가 확장 프로그램 새로고침할 때
        // - 브라우저 확장 개발 모드에서 수정 시
        //
        // 중복 실행하면:
        // - 이벤트 리스너 중복 등록 (메모리 누수)
        // - IndexedDB 중복 연결 (리소스 낭비)
        // - 신호등 중복 삽입 (UI 버그)
        if (isInitialized) {
            debugLog('이미 초기화됨 (중복 실행 방지)');
            return;  // 즉시 종료
        }

        debugLog('Content script 초기화 시작');

        // ========================================
        // 2단계: IndexedDB 초기화 및 정리 (타임아웃 5초)
        // ========================================
        // initializeDatabase():
        // - DB 연결
        // - 오래된 캐시 삭제 (30일 TTL)
        // - 용량 초과 캐시 삭제 (5000개 제한)
        // - 주기적 정리 설정 (1시간마다)
        //
        // 타임아웃 추가 이유:
        // - DB 초기화가 무한 대기하면 페이지 로딩 차단
        // - 5초 안에 초기화 못 하면 기본 설정으로 진행
        try {
            await Promise.race([
                initializeDatabase(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('DB 초기화 타임아웃')), 5000))
            ]);
        } catch (error) {
            console.warn('[KAS-FREE] DB 초기화 실패, 캐시 없이 진행:', error.message);
        }

        // ========================================
        // 3단계: 설정 로드 (타임아웃 3초)
        // ========================================
        // loadSettings():
        // - Service Worker에 설정 요청 (chrome.runtime.sendMessage)
        // - Service Worker는 chrome.storage.local에서 설정 로드 후 반환
        // - 실패 시 기본 설정값 사용 (getDefaultSettings)
        //
        // 타임아웃 추가 이유:
        // - Service Worker가 응답하지 않으면 페이지 로딩 차단
        // - 3초 안에 응답 없으면 기본 설정 사용
        try {
            currentSettings = await Promise.race([
                loadSettings(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('설정 로드 타임아웃')), 3000))
            ]);
        } catch (error) {
            console.warn('[KAS-FREE] 설정 로드 실패, 기본 설정 사용:', error.message);
            currentSettings = getDefaultSettings();
        }

        // ========================================
        // 4단계: 메시지 리스너 등록
        // ========================================
        // handleMessage():
        // - Service Worker와 통신 (메시지 수신)
        // - 메시지 타입:
        //   * TOGGLE_EXTENSION: 확장 켜기/끄기
        //   * SETTINGS_UPDATED: 설정 변경
        //   * PROCESS_IMAGE: 이미지 신고 (컨텍스트 메뉴)
        //   * GET_REPORT_REASON: 신고 사유 입력
        //
        // 왜 항상 등록하나요?
        // - 컨텍스트 메뉴 (우클릭 메뉴) 동작을 위해
        // - 확장이 꺼져있어도 우클릭 메뉴는 동작해야 함
        chrome.runtime.onMessage.addListener(handleMessage);

        // ========================================
        // 5단계: 확장 활성화 확인
        // ========================================
        // currentSettings.enabled가 false면 신호등 삽입 안 함
        // 하지만 메시지 리스너는 등록된 상태 (설정 변경 대기)
        if (!currentSettings.enabled) {
            debugLog('확장 프로그램 비활성화 상태 (신호등 삽입 안 함)');
            return;
        }

        // ========================================
        // 6단계: 페이지 타입 감지
        // ========================================
        // window.dcParser:
        // - dcParser.js에서 전역으로 등록한 파서 인스턴스
        // - 디시인사이드 DOM 구조 분석
        //
        // 페이지 타입:
        // - 목록 페이지: /board/lists?id=...
        //   → 신호등 삽입, DOM 감지, 주기적 체크
        // - 상세 페이지: /board/view?id=...&no=...
        //   → 본문 이미지 대체 (위험한 이미지를 너굴맨으로)
        const isListPage = window.dcParser && window.dcParser.isGalleryListPage();
        const isViewPage = window.dcParser && window.dcParser.isGalleryViewPage();

        debugLog('페이지 타입 감지:', {
            isListPage,    // true: 목록 페이지
            isViewPage,    // true: 상세 페이지
            url: window.location.href
        });

        // 갤러리 페이지가 아니면 아무것도 안 함
        if (!isListPage && !isViewPage) {
            debugLog('갤러리 페이지가 아님 (메인, 마이너 갤 등)');
            return;
        }

        // ========================================
        // 7단계: 툴팁 엘리먼트 생성
        // ========================================
        // createTooltipElement():
        // - 신호등 마우스 오버 시 표시할 툴팁 생성
        // - 페이지당 하나만 생성 (재사용)
        // - DOM에 미리 추가 (display: none)
        createTooltipElement();

        // ========================================
        // 8단계: 페이지별 처리
        // ========================================

        if (isViewPage) {
            // ========================================
            // 게시글 상세 페이지 처리
            // ========================================
            // processViewPageImages():
            // - 분석 결과 확인 (캐시 우선)
            // - caution/danger인 경우 본문 이미지를 너굴맨으로 대체
            // - 사용자 민감도 설정 적용
            debugLog('게시글 상세 페이지 처리 시작');
            await processViewPageImages();
        }

        if (isListPage) {
            // ========================================
            // 게시글 목록 페이지 처리
            // ========================================
            // processPostList():
            // - 모든 게시글 Row에 신호등 삽입
            // - 캐시된 결과 즉시 복원
            // - 캐시 없으면 분석 요청
            debugLog('게시글 목록 페이지 처리 시작');
            await processPostList();

            // ========================================
            // DOM 변경 감지 (MutationObserver)
            // ========================================
            // observeDomChanges():
            // - 무한 스크롤: 새 게시글 추가 감지
            // - DCRefresher: 테이블 재렌더링 감지
            // - 감지 시 신호등 재삽입
            observeDomChanges();

            // ========================================
            // 주기적 신호등 체크 (백업용)
            // ========================================
            // startPeriodicCheck():
            // - 0.1초마다 첫 번째 게시글 신호등 확인
            // - 신호등 없으면 전체 재처리
            // - MutationObserver 미감지 시 백업
            startPeriodicCheck();
        }

        // ========================================
        // 9단계: 초기화 완료
        // ========================================
        isInitialized = true;  // 중복 실행 방지 플래그 설정
        debugLog('Content script 초기화 완료');

        // ========================================
        // 10단계: 성능 모니터링 (디버그 모드)
        // ========================================
        // 5분마다 성능 통계 출력 (개발 중 성능 확인용)
        // 프로덕션에서는 제거 가능
        if (currentSettings.debugMode) {
            setInterval(async () => {
                try {
                    const metrics = await chrome.runtime.sendMessage({ type: 'GET_PERFORMANCE_METRICS' });
                    if (metrics) {
                        console.log('📊 [성능 통계] 5분 주기', {
                            '총 분석 횟수': metrics.analysis.total,
                            '평균 분석 시간': metrics.analysis.avgTime + 'ms',
                            '캐시 히트율': metrics.cache.hitRate,
                            'API 호출 횟수': metrics.api.total,
                            'API 평균 시간': metrics.api.avgTime + 'ms',
                            'API 에러율': metrics.api.errorRate
                        });
                    }
                } catch (error) {
                    // Service Worker 응답 없으면 무시 (정상)
                }
            }, 5 * 60 * 1000);  // 5분마다
        }
    }

    /**
     * ========================================
     * 설정을 Service Worker로부터 로드
     * ========================================
     *
     * 동작 흐름:
     * 1. Content Script → Service Worker: 'GET_SETTINGS' 메시지 전송
     * 2. Service Worker: chrome.storage.local에서 설정 읽기
     * 3. Service Worker → Content Script: 설정 객체 반환
     * 4. Content Script: 설정 저장 (currentSettings 변수)
     *
     * Promise 패턴:
     * - new Promise((resolve, reject)): Promise 객체 생성
     * - chrome.runtime.sendMessage(): 콜백 기반 API
     * - 콜백 안에서 resolve() 호출 → Promise 완료
     *
     * 왜 Promise로 감싸나요?
     * - chrome.runtime.sendMessage()는 콜백 기반 (async/await 불가)
     * - Promise로 감싸면 async/await 사용 가능
     *   예: const settings = await loadSettings();
     *
     * 실생활 비유:
     * "서버에 설정 파일 요청:
     *  1. 요청 보내기 (메시지 전송)
     *  2. 서버 처리 대기 (비동기)
     *  3. 응답 받기 (콜백)
     *  4. 설정 적용 (resolve)"
     *
     * 에러 처리:
     * - chrome.runtime.lastError: 메시지 전송 실패
     *   → 기본 설정값으로 폴백 (getDefaultSettings)
     * - response가 null/undefined: Service Worker 미응답
     *   → 기본 설정값으로 폴백
     *
     * @returns {Promise<object>} 설정 객체
     */
    async function loadSettings() {
        return new Promise((resolve) => {
            // ========================================
            // Service Worker에 설정 요청
            // ========================================
            chrome.runtime.sendMessage(
                { type: 'GET_SETTINGS' },  // 메시지 타입
                (response) => {
                    // ========================================
                    // 에러 확인 (메시지 전송 실패)
                    // ========================================
                    // chrome.runtime.lastError:
                    // - Extension context invalidated: 확장 프로그램 재로드됨
                    // - Could not establish connection: Service Worker 죽음
                    if (chrome.runtime.lastError) {
                        console.error('[Kas-Free] Settings load error:', chrome.runtime.lastError);
                        resolve(getDefaultSettings());  // 기본 설정값 사용
                        return;
                    }

                    // ========================================
                    // 설정 반환 (또는 기본값)
                    // ========================================
                    // response가 null/undefined면 기본 설정값 사용
                    resolve(response || getDefaultSettings());
                }
            );
        });
    }

    /**
     * ========================================
     * 기본 설정값 반환
     * ========================================
     *
     * 언제 사용되나요?
     * - loadSettings() 실패 시 폴백
     * - 첫 설치 시 초기 설정값
     * - 설정 초기화 시
     *
     * 설정값 설명은 constants.js의 DEFAULT_SETTINGS 주석 참고
     *
     * 핵심 설정:
     * - enabled: 확장 활성화 여부 (true: 신호등 표시)
     * - autoScan: 자동 검사 (true: 페이지 로드 시 자동 분석)
     * - onlyWithThumbnail: 썸네일 있는 게시글만 검사
     * - cacheEnabled: 캐시 사용 (true: IndexedDB 저장)
     * - sensitivity: 카테고리별 민감도 (0.0 ~ 1.0)
     * - thresholds: 신호등 임계값 (safe/caution/danger)
     *
     * @returns {object} 기본 설정 객체
     */
    function getDefaultSettings() {
        return {
            enabled:           true,   // 확장 활성화
            autoScan:          true,   // 자동 검사
            onlyWithThumbnail: true,   // 썸네일 있는 게시글만
            autoHideDanger:    false,  // 위험 게시글 자동 숨김 (기본 꺼짐)
            cacheEnabled:      true,   // 캐시 사용
            cacheDuration:     24 * 60 * 60 * 1000,  // 24시간
            debugMode:         false,  // 디버그 모드
            replaceAllImages:  false,  // 모든 이미지 대체 (디버그용)
            sensitivity: {
                // 폭력/죽음/혐오: 높은 민감도 (0.8)
                gore:           0.8,
                violence:       0.8,
                death:          0.8,
                disturbing:     0.8,
                // 벌레/의료/충격: 중간 민감도 (0.7)
                insects:        0.7,
                medical:        0.7,
                shock:          0.7,
                // 동물학대: 높은 민감도 (0.8)
                animal_cruelty: 0.8,
                // 성인물: 낮은 민감도 (0.3)
                nsfw_porn:      0.3,
                // 선정성: 매우 낮은 민감도 (0.2)
                nsfw_sexy:      0.2
            },
            thresholds: {
                safeMax:    0.3,  // 0.0 ~ 0.3: 안전 (초록)
                cautionMax: 0.6   // 0.3 ~ 0.6: 주의 (노랑), 0.6 ~: 위험 (빨강)
            }
        };
    }

    /**
     * ========================================
     * 게시글 목록 처리 (신호등 삽입)
     * ========================================
     *
     * 2가지 모드:
     * 1. cacheOnly = true: 캐시된 결과만 즉시 복원 (동기, ~10ms)
     * 2. cacheOnly = false: 전체 처리 (분석 포함, 비동기, ~1000ms)
     *
     * cacheOnly 모드가 필요한 이유:
     * - DCRefresher가 테이블을 재렌더링할 때 신호등이 사라짐
     * - 즉시 복원하지 않으면 깜빡임 현상 (UX 저하)
     * - 캐시된 결과만 동기로 즉시 복원 → 부드러운 UX
     * - 미분석 게시글은 나중에 비동기로 분석
     *
     * 병렬 처리:
     * - await를 제거하여 각 게시글이 독립적으로 비동기 처리됨
     * - 100개 게시글을 순차 처리하면 100초 → 병렬 처리하면 1~2초
     * - 브라우저가 자동으로 병렬 실행 (Promise 병렬 처리)
     *
     * 실생활 비유:
     * "100명의 학생 시험 채점:
     *  - 순차 처리: 한 명씩 채점 (100분)
     *  - 병렬 처리: 100명이 동시에 자기 시험지 채점 (1분)"
     *
     * @param {boolean} cacheOnly - true: 캐시만, false: 전체 처리
     */
    async function processPostList(cacheOnly = false) {
        // ========================================
        // 게시글 Row 목록 가져오기
        // ========================================
        // onlyWithThumbnail 설정:
        // - true: 썸네일 있는 게시글만 (이미지 게시글만 검사)
        // - false: 모든 게시글 (텍스트 게시글도 검사)
        //
        // querySelectorAll()은 NodeList를 반환하므로 배열로 변환 필요
        // NodeList는 .length는 있지만 .slice() 메서드가 없음
        // Array.from()으로 진짜 배열로 변환
        const rowNodeList = currentSettings.onlyWithThumbnail
            ? window.dcParser.getPostRowsWithImage()   // 썸네일 있는 게시글만
            : window.dcParser.getAllPostRows();         // 모든 게시글

        const rows = Array.from(rowNodeList);  // NodeList → 배열 변환

        debugLog('processPostList 실행:', {
            cacheOnly,                                  // 캐시 전용 모드 여부
            rowCount: rows.length,                      // 게시글 개수 (보통 50~100개)
            onlyWithThumbnail: currentSettings.onlyWithThumbnail
        });

        // ========================================
        // 모드별 처리
        // ========================================

        if (cacheOnly) {
            // ========================================
            // 캐시 전용 모드 (동기, 즉시 복원)
            // ========================================
            // processPostRowSync(): 동기 함수
            // - 캐시된 결과만 확인 (analyzedPosts Map)
            // - 캐시 있으면 즉시 신호등 표시
            // - 캐시 없으면 UNCHECKED 상태로 유지
            // - 비동기 작업 없음 (빠름, ~10ms)
            for (const row of rows) {
                processPostRowSync(row);  // 동기 실행 (await 없음)
            }
            // 모든 게시글 즉시 복원 완료 (깜빡임 없음)

        } else {
            // ========================================
            // 전체 처리 모드 (비동기, 분석 포함, 동시 실행 제한)
            // ========================================
            // processPostRow(): 비동기 함수
            // - 캐시 확인 → 없으면 분석 요청
            // - Service Worker에 메시지 전송 (chrome.runtime.sendMessage)
            // - 분석 완료 후 신호등 업데이트
            //
            // 동시 실행 제한 이유:
            // - 100개 게시글을 동시에 처리하면 Service Worker 과부하
            // - 페이지 멈춤, 응답 없음 현상 발생
            // - 5개씩 배치로 나눠서 처리 (안정성 향상)

            // ========================================
            // 성능 측정 시작
            // ========================================
            const perfStart = performance.now();

            const BATCH_SIZE = 5;  // 한 번에 5개씩 처리
            for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                const batch = rows.slice(i, i + BATCH_SIZE);  // 5개 추출
                await Promise.all(batch.map(row => processPostRow(row)));  // 5개 병렬 처리
                // 다음 배치로 이동 (5개 완료 후 다음 5개 시작)
            }

            // ========================================
            // 성능 측정 종료
            // ========================================
            const perfEnd = performance.now();
            const duration = perfEnd - perfStart;
            const avgPerPost = duration / rows.length;

            // 모든 게시글 배치 처리 완료 (5개씩 순차적으로 병렬 처리)
            debugLog('processPostList 완료:', {
                rowCount: rows.length,
                totalTime: `${duration.toFixed(2)}ms`,
                avgPerPost: `${avgPerPost.toFixed(2)}ms`,
                batchSize: BATCH_SIZE
            });
        }
    }

    /**
     * 게시글 상세 페이지의 본문 이미지를 처리한다
     * caution/danger인 경우 너굴맨 이미지로 대체
     */
    async function processViewPageImages() {
        const postUrl = window.location.href;
        const postNo  = getPostNoFromUrl(postUrl);

        if (!postNo) {
            debugLog('게시글 번호를 찾을 수 없음');
            return;
        }

        /** 디버그 모드: 모든 이미지 무조건 대체 */
        if (currentSettings.replaceAllImages) {
            replaceViewPageImages(SIGNAL_STATUS.DANGER);
            debugLog('(디버그) 모든 이미지 대체 완료');
            return;
        }

        /** 분석 결과 가져오기 (캐시 우선) */
        let result = await getAnalysisFromCache(postNo);

        if (!result && currentSettings.autoScan) {
            /** 캐시에 없으면 새로 분석 요청 */
            try {
                result = await requestImageAnalysis({ postNo, postUrl });

                if (result) {
                    await setAnalysisToCache(postNo, result);
                }
            } catch (error) {
                console.error('[Kas-Free] 게시글 이미지 분석 실패:', error);
                return;
            }
        }

        /** 결과가 없거나 안전한 경우 대체하지 않음 */
        if (!result || result.status === SIGNAL_STATUS.SAFE) {
            debugLog('이미지 대체 불필요:', result?.status || '결과 없음');
            return;
        }

        /** 사용자 민감도 적용 */
        const adjustedRiskScore = applyUserSensitivity(result, currentSettings.sensitivity);
        const status = determineSignalStatus(adjustedRiskScore);

        /** caution 또는 danger인 경우에만 이미지 대체 */
        if (status === SIGNAL_STATUS.CAUTION || status === SIGNAL_STATUS.DANGER) {
            replaceViewPageImages(status);
            debugLog('이미지 대체 완료:', status);
        }
    }

    /**
     * 게시글 본문의 이미지를 너굴맨으로 대체한다
     * @param {string} status - 신호등 상태 (caution 또는 danger)
     */
    function replaceViewPageImages(status) {
        /** DC 이미지 선택자 (dcParser와 동일) */
        let images = document.querySelectorAll('.writing_view_box img[data-fileno]');

        /** 폴백: data-fileno가 없는 경우 */
        if (images.length === 0) {
            images = document.querySelectorAll('.writing_view_box img[src*="viewimage.php"]');
        }

        if (images.length === 0) {
            debugLog('대체할 이미지를 찾을 수 없음');
            return;
        }

        const placeholderUrl = chrome.runtime.getURL('placeholder.jpg');

        images.forEach(img => {
            /** 디시콘 제외 */
            if (img.classList.contains('written_dccon')) {
                return;
            }

            /** 광고 영역 제외 */
            if (img.closest('#zzbang_div')) {
                return;
            }

            /** 이미 대체된 이미지는 스킵 */
            if (img.dataset.kasReplaced === 'true') {
                return;
            }

            /** 원본 URL 및 상태 저장 */
            img.dataset.kasOriginalSrc = img.src;
            img.dataset.kasReplaced    = 'true';
            img.dataset.kasStatus      = status;

            /** 너굴맨으로 대체 */
            img.src = placeholderUrl;
            img.classList.add('kas-replaced-image');

            debugLog('이미지 대체:', img.dataset.kasOriginalSrc, '→', placeholderUrl);
        });
    }

    /**
     * URL에서 게시글 번호를 추출한다
     * @param {string} url - 게시글 URL
     * @returns {string|null}
     */
    function getPostNoFromUrl(url) {
        try {
            const params = new URLSearchParams(new URL(url).search);
            return params.get('no');
        } catch (error) {
            console.error('[Kas-Free] URL 파싱 실패:', error);
            return null;
        }
    }

    /**
     * 캐시된 결과만 즉시 복원 (동기 처리)
     * @param {Element} row - 게시글 Row 엘리먼트
     */
    function processPostRowSync(row) {
        /** 이미 신호등이 있으면 스킵 */
        if (window.dcParser.hasSignal(row)) {
            return;
        }

        const postInfo = window.dcParser.parsePostRow(row);
        if (!postInfo) {
            return;
        }

        /** 신호등 컨테이너 삽입 */
        const container = createSignalElement(postInfo.postNo);
        insertSignal(postInfo, container);

        const signal = container.querySelector('.kas-signal');

        /** 게시글 프리뷰 이벤트 추가 (중복 방지) */
        if (!row.dataset.kasPreviewEnabled) {
            row.addEventListener('mouseenter', () => {
                // Debounce: 300ms 대기 후 프리뷰 표시 (과도한 요청 방지)
                clearTimeout(previewTimer);
                previewTimer = setTimeout(() => {
                    showPostPreview(row, postInfo);
                }, 300);
            });
            row.addEventListener('mouseleave', () => {
                clearTimeout(previewTimer);
                hidePostPreview();
            });
            row.dataset.kasPreviewEnabled = 'true';
        }

        /** 캐시된 결과만 확인 */
        const cachedResult = analyzedPosts.get(postInfo.postNo);
        if (cachedResult) {
            handleAnalysisResult(signal, row, cachedResult, postInfo);
        }
        // 캐시가 없으면 UNCHECKED 상태로 유지 (나중에 분석)
    }

    /**
     * 개별 게시글 Row를 처리한다
     * @param {Element} row - 게시글 Row 엘리먼트
     */
    async function processPostRow(row) {
        const postInfo = window.dcParser.parsePostRow(row);
        if (!postInfo) {
            return;
        }

        /** 신호등 컨테이너 확인/생성 */
        let container = row.querySelector('.kas-signal-container');
        let signal;

        if (container) {
            signal = container.querySelector('.kas-signal');
            const status = signal.dataset.status;

            /** 이미 분석 완료된 경우 스킵 (unchecked는 분석 필요) */
            if (status && status !== SIGNAL_STATUS.UNCHECKED && status !== SIGNAL_STATUS.LOADING) {
                return;
            }
        } else {
            /** 신호등 컨테이너 삽입 */
            container = createSignalElement(postInfo.postNo);
            insertSignal(postInfo, container);
            signal = container.querySelector('.kas-signal');
        }

        /** 게시글 프리뷰 이벤트 추가 (중복 방지) */
        if (!row.dataset.kasPreviewEnabled) {
            row.addEventListener('mouseenter', () => {
                // Debounce: 300ms 대기 후 프리뷰 표시 (과도한 요청 방지)
                clearTimeout(previewTimer);
                previewTimer = setTimeout(() => {
                    showPostPreview(row, postInfo);
                }, 300);
            });
            row.addEventListener('mouseleave', () => {
                clearTimeout(previewTimer);
                hidePostPreview();
            });
            row.dataset.kasPreviewEnabled = 'true';
        }

        /** 캐시된 결과 확인 (DOM 재렌더링 복원용) */
        const cachedResult = await getAnalysisFromCache(postInfo.postNo);
        if (cachedResult) {
            handleAnalysisResult(signal, row, cachedResult, postInfo);
            return;
        }

        /** 이미지가 없으면 미검사 상태 유지 */
        if (!postInfo.hasImage) {
            return;
        }

        /** 자동 검사가 꺼져있으면 미검사 상태 유지 */
        if (!currentSettings.autoScan) {
            return;
        }

        /** 이미지 분석 요청 */
        updateSignalStatus(signal, SIGNAL_STATUS.LOADING);

        try {
            const result = await requestImageAnalysis(postInfo);

            /** 결과 캐시에 저장 (하이브리드: 메모리 + IndexedDB) */
            await setAnalysisToCache(postInfo.postNo, result);

            handleAnalysisResult(signal, row, result, postInfo);
        } catch (error) {
            console.error('[Kas-Free] Analysis error:', error);
            updateSignalStatus(signal, SIGNAL_STATUS.ERROR, { error: error.message });
        }
    }

    /**
     * 신호등 엘리먼트를 생성한다
     * @param {string} postNo - 게시글 번호
     * @returns {HTMLElement}
     */
    function createSignalElement(postNo) {
        const container     = document.createElement('span');
        container.className = 'kas-signal-container';
        container.dataset.postNo = postNo;

        /** 신호등 */
        const signal        = document.createElement('span');
        signal.className    = 'kas-signal kas-signal--unchecked';
        signal.dataset.postNo = postNo;
        signal.title        = SIGNAL_LABELS[SIGNAL_STATUS.UNCHECKED];

        /** 툴팁 이벤트 */
        signal.addEventListener('mouseenter', showTooltip);
        signal.addEventListener('mouseleave', hideTooltip);

        /** AI 체크 버튼 */
        const aiButton = document.createElement('button');
        aiButton.className = 'kas-ai-check-btn';
        aiButton.dataset.postNo = postNo;
        aiButton.title = 'AI로 재검사';
        aiButton.textContent = '🤖';
        // AI API가 활성화되어 있으면 즉시 표시
        aiButton.style.display = checkAIApiEnabled() ? 'inline-block' : 'none';

        /** AI 체크 버튼 클릭 이벤트 */
        aiButton.addEventListener('click', (e) => {
            e.preventDefault();      // 기본 동작 차단
            e.stopPropagation();     // 이벤트 전파 차단
            e.stopImmediatePropagation(); // 같은 엘리먼트의 다른 리스너도 차단
            handleAICheckRequest(postNo, signal, aiButton);
        }, true); // 캡처 단계에서 이벤트 처리

        /** AI 버튼에 마우스 오버 시 신호등 툴팁 숨김 (툴팁 멈춤 방지) */
        aiButton.addEventListener('mouseenter', () => {
            hideTooltip();  // 신호등 툴팁 숨김
            hidePostPreview();  // 게시글 미리보기도 숨김
        });

        aiButton.addEventListener('mouseleave', () => {
            // 툴팁은 signal의 이벤트가 자연스럽게 처리
        });

        container.appendChild(signal);
        container.appendChild(aiButton);

        return container;
    }

    /**
     * 신호등을 DOM에 삽입한다
     * @param {object} postInfo - 게시글 정보
     * @param {HTMLElement} container - 신호등 컨테이너 엘리먼트
     */
    function insertSignal(postInfo, container) {
        const insertPosition = window.dcParser.getSignalInsertPosition(postInfo.titleCell);
        if (insertPosition) {
            insertPosition.parentNode.insertBefore(container, insertPosition);
        }
    }

    /**
     * 신호등 상태를 업데이트한다
     * @param {HTMLElement} signal - 신호등 엘리먼트
     * @param {string} status - 상태
     * @param {object} data - 추가 데이터
     */
    function updateSignalStatus(signal, status, data = {}) {
        /** 기존 상태 클래스 제거 */
        signal.className = 'kas-signal';

        /** 새 상태 클래스 추가 */
        signal.classList.add(`kas-signal--${status}`);

        /** 제목 및 데이터 업데이트 */
        signal.title             = SIGNAL_LABELS[status] || status;
        signal.dataset.status    = status;
        signal.dataset.result    = JSON.stringify(data);

        /** AI 체크 버튼 표시 여부 결정 */
        const container = signal.parentElement;
        if (container && container.classList.contains('kas-signal-container')) {
            const aiButton = container.querySelector('.kas-ai-check-btn');

            if (aiButton) {
                // AI API가 설정되어 있으면 항상 버튼 표시
                if (checkAIApiEnabled()) {
                    aiButton.style.display = 'inline-block';
                } else {
                    aiButton.style.display = 'none';
                }
            }
        }
    }

    /**
     * 이미지 분석을 요청한다
     * @param {object} postInfo - 게시글 정보
     * @returns {Promise<object>}
     */
    function requestImageAnalysis(postInfo) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                {
                    type:    'ANALYZE_IMAGE',
                    postNo:  postInfo.postNo,
                    postUrl: postInfo.postUrl
                },
                (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }

                    // status가 있으면 정상 응답으로 처리 (error가 있어도)
                    // 예: status='unchecked', error='이미지를 찾을 수 없습니다'
                    if (response && response.status) {
                        resolve(response);
                        return;
                    }

                    // status도 없고 error만 있으면 실제 에러
                    if (response && response.error) {
                        reject(new Error(response.error));
                        return;
                    }

                    resolve(response);
                }
            );
        });
    }

    /**
     * AI 검증을 요청한다
     * @param {object} postInfo - 게시글 정보
     * @param {string} imageUrl - 이미지 URL (1차 검사에서 추출한 URL)
     * @returns {Promise<object>}
     */
    function requestAIVerification(postInfo, imageUrl) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                {
                    type:     'VERIFY_WITH_AI',
                    postNo:   postInfo.postNo,
                    postUrl:  postInfo.postUrl,
                    imageUrl: imageUrl  // 이미지 URL 직접 전달
                },
                (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }

                    if (response && response.error) {
                        reject(new Error(response.error));
                        return;
                    }

                    resolve(response);
                }
            );
        });
    }

    /**
     * AI API가 설정되어 있는지 확인한다
     * @returns {boolean}
     */
    function checkAIApiEnabled() {
        const { apis } = currentSettings;

        return (
            (apis.gpt4oMini?.enabled && apis.gpt4oMini?.apiKey) ||
            (apis.claudeHaiku?.enabled && apis.claudeHaiku?.apiKey) ||
            (apis.geminiFlash?.enabled && apis.geminiFlash?.apiKey)
        );
    }

    /**
     * 분석 결과를 처리한다
     * @param {HTMLElement} signal - 신호등 엘리먼트
     * @param {Element} row - 게시글 Row 엘리먼트
     * @param {object} result - 분석 결과
     * @param {object} postInfo - 게시글 정보
     */
    async function handleAnalysisResult(signal, row, result, postInfo) {
        if (!result) {
            updateSignalStatus(signal, SIGNAL_STATUS.UNCHECKED);
            return;
        }

        /** status가 unchecked인 경우 (이미지 없음 등) */
        if (result.status === SIGNAL_STATUS.UNCHECKED || result.status === 'unchecked') {
            updateSignalStatus(signal, SIGNAL_STATUS.UNCHECKED, result);
            return;
        }

        /** 사용자 민감도 적용 */
        const adjustedRiskScore = applyUserSensitivity(result, currentSettings.sensitivity);

        /** 조정된 점수로 신호등 판정 (AI 검증 결과도 민감도 적용) */
        const status = determineSignalStatus(adjustedRiskScore);

        /** 조정된 점수를 result에 반영 */
        result.adjustedRiskScore = adjustedRiskScore;
        result.originalRiskScore = result.riskScore;
        result.status = status;  // 민감도가 적용된 status로 갱신

        updateSignalStatus(signal, status, result);

        /** 위험 게시글 자동 숨김 */
        if (status === SIGNAL_STATUS.DANGER && currentSettings.autoHideDanger) {
            row.classList.add('kas-hidden');
        }

        /** 통계 업데이트 (확장 프로그램 재로드 시 에러 무시) */
        try {
            chrome.runtime.sendMessage({
                type:       'UPDATE_STATS',
                signalType: status
            });
        } catch (error) {
            // Extension context invalidated - 확장 프로그램이 재로드됨
            console.log('[Kas-Free] 통계 업데이트 실패 (확장 프로그램 재로드됨)');
        }
    }

    /**
     * AI 체크 버튼 클릭을 처리한다
     * @param {string} postNo - 게시글 번호
     * @param {HTMLElement} signal - 신호등 엘리먼트
     * @param {HTMLElement} aiButton - AI 체크 버튼
     */
    async function handleAICheckRequest(postNo, signal, aiButton) {
        debugLog('AI 체크 요청:', postNo);

        // AI API 설정 확인
        if (!checkAIApiEnabled()) {
            alert('AI API가 설정되지 않았습니다.\n설정 페이지에서 API 키를 입력해주세요.');
            return;
        }

        // 버튼 비활성화
        aiButton.disabled = true;
        aiButton.textContent = '⏳';

        // AI 검증 중 표시
        const originalTitle = signal.title;
        signal.title = '🤖 AI 검증 중...';

        try {
            // 게시글 정보 가져오기
            const container = signal.parentElement;
            const row = container.closest('tr.ub-content.us-post');
            const postInfo = window.dcParser.parsePostRow(row);

            if (!postInfo) {
                throw new Error('게시글 정보를 가져올 수 없습니다');
            }

            // 이미지 URL 가져오기 (캐시된 결과에서)
            const cachedResult = await getAnalysisFromCache(postNo);
            const imageUrl = cachedResult?.imageUrl;

            debugLog('AI 검증용 이미지 URL:', imageUrl);

            // AI 검증 요청
            const aiResult = await requestAIVerification(postInfo, imageUrl);

            debugLog('AI 검증 결과:', aiResult);

            // AI 검증 결과 캐시에 병합
            const mergedResult = {
                ...cachedResult,  // 기존 캐시 (imageUrl 등 포함)
                ...aiResult,      // AI 검증 결과로 덮어쓰기
                imageUrl: cachedResult?.imageUrl || aiResult.imageUrl  // imageUrl 보존
            };

            // 민감도를 적용하여 신호등 업데이트
            await handleAnalysisResult(signal, row, mergedResult, postInfo);

            // 업데이트된 결과를 캐시에 저장 (민감도가 적용된 status 포함)
            await setAnalysisToCache(postNo, mergedResult);

            // 위험 게시글 처리 (민감도가 적용된 status 사용)
            if (mergedResult.status === SIGNAL_STATUS.DANGER) {
                // 자동 숨김
                if (currentSettings.autoHideDanger) {
                    row.classList.add('kas-hidden');
                }

                // 유해 이미지 신고 결과 표시
                if (aiResult.reported === true) {
                    debugLog('✅ 유해 이미지 서버에 자동 신고 완료');
                    signal.title = `${signal.title} (🚨 신고 완료)`;
                } else if (aiResult.reportError) {
                    console.warn('[Kas-Free Content] ⚠️ 서버 신고 실패:', aiResult.reportError);
                    signal.title = `${signal.title} (⚠️ 신고 실패: ${aiResult.reportError})`;
                }
            } else if (mergedResult.status === SIGNAL_STATUS.SAFE) {
                debugLog('✅ AI 검증 결과: 안전');
            }

            // 통계 업데이트 (확장 프로그램 재로드 시 에러 무시)
            try {
                chrome.runtime.sendMessage({
                    type:       'UPDATE_STATS',
                    signalType: mergedResult.status
                });
            } catch (error) {
                console.log('[Kas-Free] 통계 업데이트 실패 (확장 프로그램 재로드됨)');
            }

            // 버튼 복구 (재검증 가능하도록)
            aiButton.disabled = false;
            aiButton.textContent = '🤖';
            signal.title = signal.title.replace(' (서버 신고 완료)', ''); // 원래 타이틀로 복구

        } catch (error) {
            console.error('[Kas-Free Content] AI 검증 실패:', error);
            alert(`AI 검증 실패: ${error.message}`);
            signal.title = originalTitle;

            // 버튼 복구
            aiButton.disabled = false;
            aiButton.textContent = '🤖';
        }
    }

    /**
     * ========================================
     * 사용자 민감도를 적용하여 위험 점수 재계산
     * ========================================
     *
     * 왜 민감도 조정이 필요한가요?
     * - 같은 이미지라도 사람마다 느끼는 정도가 다름
     * - 예: 고어를 못 보는 사람 vs 괜찮은 사람
     * - 사용자 설정에 따라 신호등 판정 기준을 조정
     *
     * 동작 원리:
     * 1. AI가 분석한 카테고리별 점수 가져오기
     *    예: { gore: 0.5, violence: 0.3, ... }
     * 2. 사용자 민감도 적용
     *    예: 고어 민감도 1.0 (높음) → 점수 증가
     *        고어 민감도 0.5 (낮음) → 점수 감소
     * 3. 가중치 적용 (중요한 카테고리에 높은 가중치)
     * 4. 최종 점수 계산 (가중 평균)
     *
     * 실생활 비유:
     * "매운 음식 먹을 때:
     *  - 같은 떡볶이라도
     *    * 맵기에 민감한 사람: '너무 매워요' (점수 증가)
     *    * 맵기에 둔감한 사람: '적당해요' (점수 감소)
     *  - 사용자 민감도 = 개인의 맵기 내성"
     *
     * 수식:
     * adjustedScore = originalScore × (userSensitivity / defaultSensitivity)
     *
     * 예시:
     * - originalScore = 0.5 (AI가 분석한 고어 점수)
     * - defaultSensitivity = 0.8 (기본 민감도)
     * - userSensitivity = 1.0 (사용자가 고어에 민감함)
     * - sensitivityRatio = 1.0 / 0.8 = 1.25
     * - adjustedScore = 0.5 × 1.25 = 0.625 (점수 증가)
     *   → 더 위험하게 판정됨 (초록 → 노랑)
     *
     * @param {object} result - AI 분석 결과
     * @param {object} userSensitivity - 사용자 민감도 설정 (0.0 ~ 1.0)
     * @returns {number} 조정된 위험 점수 (0.0 ~ 1.0)
     */
    function applyUserSensitivity(result, userSensitivity) {
        // ========================================
        // 1단계: 카테고리별 점수 가져오기
        // ========================================
        // categories 또는 detailedScores (AI 응답 형식 차이)
        const categories = result.categories || result.detailedScores;

        // 카테고리 데이터가 없으면 원본 점수 반환
        if (!categories || typeof categories !== 'object') {
            return result.riskScore || 0;
        }

        // ========================================
        // 2단계: 기본 민감도 정의
        // ========================================
        // constants.js의 DEFAULT_SETTINGS와 동일
        // 각 카테고리의 기준 민감도 (중간 값)
        const defaultSensitivity = {
            gore:           0.8,  // 고어: 높은 기본 민감도
            violence:       0.8,  // 폭력: 높은 기본 민감도
            death:          0.8,  // 죽음: 높은 기본 민감도
            disturbing:     0.8,  // 혐오: 높은 기본 민감도
            insects:        0.7,  // 벌레: 중간 기본 민감도
            medical:        0.7,  // 의료: 중간 기본 민감도
            shock:          0.7,  // 충격: 중간 기본 민감도
            animal_cruelty: 0.8,  // 동물학대: 높은 기본 민감도
            nsfw_porn:      0.3,  // 성인물: 낮은 기본 민감도
            nsfw_sexy:      0.2   // 선정성: 매우 낮은 기본 민감도
        };

        // ========================================
        // 3단계: 카테고리별 가중치 정의
        // ========================================
        // 위험도 판정에서 각 카테고리의 중요도
        // 높을수록 최종 점수에 큰 영향
        const weights = {
            gore:           1.0,  // 고어: 최고 중요도
            violence:       1.0,  // 폭력: 최고 중요도
            death:          1.0,  // 죽음: 최고 중요도
            disturbing:     0.9,  // 혐오: 높은 중요도
            insects:        0.8,  // 벌레: 중간 중요도
            medical:        0.9,  // 의료: 높은 중요도
            shock:          0.8,  // 충격: 중간 중요도
            animal_cruelty: 1.0,  // 동물학대: 최고 중요도
            nsfw_porn:      0.5,  // 성인물: 낮은 중요도
            nsfw_sexy:      0.3   // 선정성: 매우 낮은 중요도
        };

        // ========================================
        // 4단계: 가중 평균 계산 (Weighted Average)
        // ========================================
        // 각 카테고리의 조정된 점수 × 가중치를 모두 더함
        let weightedSum = 0;   // 가중치 적용 점수 합계
        let totalWeight = 0;   // 전체 가중치 합계

        // ========================================
        // 5단계: 카테고리 순회 및 점수 조정
        // ========================================
        // Object.entries(): 객체를 [키, 값] 배열로 변환
        // 예: { gore: 0.5, violence: 0.3 }
        //  → [['gore', 0.5], ['violence', 0.3]]
        for (const [category, score] of Object.entries(categories)) {
            // 점수가 숫자가 아니면 스킵 (잘못된 데이터)
            if (typeof score !== 'number') continue;

            // ========================================
            // 각 카테고리별 계산
            // ========================================
            const weight      = weights[category] || 0;                    // 가중치
            const defaultSens = defaultSensitivity[category] || 1.0;       // 기본 민감도
            const userSens    = userSensitivity[category] || defaultSens;  // 사용자 민감도

            // ========================================
            // 민감도 비율 계산
            // ========================================
            // sensitivityRatio = userSens / defaultSens
            //
            // 예시 1: 사용자가 고어에 더 민감함
            // - userSens = 1.0, defaultSens = 0.8
            // - ratio = 1.0 / 0.8 = 1.25
            // - 점수 25% 증가
            //
            // 예시 2: 사용자가 고어에 덜 민감함
            // - userSens = 0.5, defaultSens = 0.8
            // - ratio = 0.5 / 0.8 = 0.625
            // - 점수 37.5% 감소
            const sensitivityRatio = userSens / defaultSens;

            // ========================================
            // 조정된 점수 계산
            // ========================================
            // adjustedScore = score × sensitivityRatio
            // Math.min(1.0, ...): 최대 1.0으로 제한 (100% 초과 방지)
            const adjustedScore = Math.min(1.0, score * sensitivityRatio);

            // ========================================
            // 가중치 적용 및 합산
            // ========================================
            // weightedSum += adjustedScore × weight
            // 예: gore (0.625 × 1.0) + violence (0.2 × 1.0) + ...
            weightedSum += adjustedScore * weight;
            totalWeight += weight;
        }

        // ========================================
        // 6단계: 최종 점수 반환 (가중 평균)
        // ========================================
        // 가중 평균 = weightedSum / totalWeight
        //
        // 예시:
        // - weightedSum = 0.625 + 0.2 + 0.1 = 0.925
        // - totalWeight = 1.0 + 1.0 + 0.9 = 2.9
        // - 최종 점수 = 0.925 / 2.9 = 0.319 (약 32%)
        //   → safe (< 0.3) 경계선 (사용자 민감도에 따라 caution이 될 수도)
        return totalWeight > 0 ? weightedSum / totalWeight : 0;
    }

    /**
     * ========================================
     * 위험 점수에 따라 신호등 상태 결정
     * ========================================
     *
     * 3단계 신호등 시스템:
     * - 안전 (초록): riskScore < safeMax (기본 0.3)
     * - 주의 (노랑): safeMax ≤ riskScore < cautionMax (기본 0.3 ~ 0.6)
     * - 위험 (빨강): riskScore ≥ cautionMax (기본 0.6 이상)
     *
     * 임계값 설정:
     * - safeMax: 0.3 (30%)
     *   → 30% 미만이면 안전 (대부분 일상적인 이미지)
     * - cautionMax: 0.6 (60%)
     *   → 60% 미만이면 주의 (약간 불쾌할 수 있음)
     *   → 60% 이상이면 위험 (혐오/폭력 이미지)
     *
     * 실생활 비유:
     * "시험 점수로 등급 판정:
     *  - 0~30점: 안전 (일반 이미지)
     *  - 30~60점: 주의 (약간 불쾌)
     *  - 60~100점: 위험 (혐오/폭력)"
     *
     * 예시:
     * - riskScore = 0.15 (15%) → SAFE (초록불)
     * - riskScore = 0.45 (45%) → CAUTION (노란불)
     * - riskScore = 0.85 (85%) → DANGER (빨간불)
     *
     * 임계값 조정 가능:
     * - 민감한 사용자: safeMax = 0.2, cautionMax = 0.4
     *   → 더 엄격한 판정 (더 많은 이미지가 주의/위험으로)
     * - 둔감한 사용자: safeMax = 0.4, cautionMax = 0.7
     *   → 더 관대한 판정 (더 많은 이미지가 안전으로)
     *
     * @param {number} riskScore - 위험 점수 (0.0 ~ 1.0)
     * @returns {string} 신호등 상태 ('safe', 'caution', 'danger')
     */
    function determineSignalStatus(riskScore) {
        // ========================================
        // 임계값 가져오기 (설정에서)
        // ========================================
        const { safeMax, cautionMax } = currentSettings.thresholds;

        // ========================================
        // 3단계 if-else 판정
        // ========================================

        if (riskScore < safeMax) {
            // ========================================
            // 안전 (초록불)
            // ========================================
            // 예: riskScore = 0.15, safeMax = 0.3
            // → 0.15 < 0.3 → SAFE
            return SIGNAL_STATUS.SAFE;

        } else if (riskScore < cautionMax) {
            // ========================================
            // 주의 (노란불)
            // ========================================
            // 예: riskScore = 0.45, safeMax = 0.3, cautionMax = 0.6
            // → 0.45 >= 0.3 (첫 번째 if 통과 안 됨)
            // → 0.45 < 0.6 → CAUTION
            return SIGNAL_STATUS.CAUTION;

        } else {
            // ========================================
            // 위험 (빨간불)
            // ========================================
            // 예: riskScore = 0.85, cautionMax = 0.6
            // → 0.85 >= 0.6 (두 번째 if 통과 안 됨)
            // → DANGER
            return SIGNAL_STATUS.DANGER;
        }
    }

    /**
     * 툴팁 엘리먼트를 생성한다
     */
    function createTooltipElement() {
        tooltipElement           = document.createElement('div');
        tooltipElement.className = 'kas-tooltip';
        document.body.appendChild(tooltipElement);

        // 페이지 숨김 시 툴팁 제거
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                hideTooltip();
                hidePostPreview();
            }
        });

        // 스크롤 시 툴팁 제거 (빠른 스크롤에서 툴팁이 따라다니지 않도록)
        let scrollTimeout;
        window.addEventListener('scroll', () => {
            hideTooltip();
            hidePostPreview();
        }, { passive: true });

        // 윈도우 리사이즈 시 툴팁 제거
        window.addEventListener('resize', () => {
            hideTooltip();
            hidePostPreview();
        });
    }

    /**
     * 툴팁을 표시한다
     * @param {Event} event - 마우스 이벤트
     */
    function showTooltip(event) {
        const signal = event.target;
        const status = signal.dataset.status;
        const result = JSON.parse(signal.dataset.result || '{}');

        /** 조정된 위험도 표시 */
        const riskScore = result.adjustedRiskScore !== undefined ? result.adjustedRiskScore : result.riskScore;
        const riskPercent = Math.round((riskScore || 0) * 100);

        let content = `<div class="kas-tooltip__title">${SIGNAL_LABELS[status] || '알 수 없음'} (위험도: ${riskPercent}%)</div>`;

        /** detailedScores가 있으면 10개 카테고리 표시 */
        if (result.detailedScores) {
            content += '<div class="kas-tooltip__detail">';
            const sortedScores = Object.entries(result.detailedScores)
                .filter(([_, score]) => score > 0)
                .sort((a, b) => b[1] - a[1]);

            for (const [category, score] of sortedScores) {
                const percent    = Math.round(score * 100);
                const valueClass = percent >= 60 ? 'high' : (percent >= 30 ? 'medium' : 'low');
                const label      = getCategoryLabel(category);
                content += `
                    <div class="kas-tooltip__item">
                        <span class="kas-tooltip__label">${label}:</span>
                        <span class="kas-tooltip__value kas-tooltip__value--${valueClass}">${percent}%</span>
                    </div>
                `;
            }
            content += '</div>';
        } else if (result.categories) {
            /** 기본 5개 카테고리 표시 */
            content += '<div class="kas-tooltip__detail">';
            for (const [category, score] of Object.entries(result.categories)) {
                const percent    = Math.round(score * 100);
                const valueClass = percent >= 60 ? 'high' : (percent >= 30 ? 'medium' : 'low');
                const label      = getCategoryLabel(category);
                content += `
                    <div class="kas-tooltip__item">
                        <span class="kas-tooltip__label">${label}:</span>
                        <span class="kas-tooltip__value kas-tooltip__value--${valueClass}">${percent}%</span>
                    </div>
                `;
            }
            content += '</div>';
        }

        tooltipElement.innerHTML = content;

        /** AI 분석 결과 (이미지 설명) 추가 */
        if (result.aiAnalysis) {
            const ai = result.aiAnalysis;
            const reason = ai.description || ai.reasoning || ai.reason || '설명 없음';
            const scorePercent = Math.round((ai.final_score || 0) * 100);

            const aiDiv = document.createElement('div');
            aiDiv.style.marginTop = '8px';
            aiDiv.style.paddingTop = '8px';
            aiDiv.style.borderTop = '1px solid #374151';
            aiDiv.style.fontSize = '12px';
            aiDiv.style.color = '#d1d5db';
            aiDiv.style.lineHeight = '1.5';
            aiDiv.textContent = `🤖 AI 분석 (${scorePercent}%): ${reason}`;
            tooltipElement.appendChild(aiDiv);
        }

        /** 에러 메시지는 XSS 방지를 위해 textContent로 추가 */
        if (result.error) {
            const errorDiv = document.createElement('div');
            errorDiv.style.color = '#f97316';
            errorDiv.style.marginTop = '4px';
            errorDiv.textContent = result.error;  // XSS 방지
            tooltipElement.appendChild(errorDiv);
        }

        /** 위치 계산 */
        const rect = signal.getBoundingClientRect();
        const tooltipRect = tooltipElement.getBoundingClientRect();

        let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
        let top  = rect.top - tooltipRect.height - 10;

        /** 화면 밖으로 나가지 않도록 조정 */
        if (left < 0) left = 0;
        if (top < 0) top = rect.bottom + 10;

        tooltipElement.style.left = `${left + window.scrollX}px`;
        tooltipElement.style.top  = `${top + window.scrollY}px`;

        tooltipElement.classList.add('kas-tooltip--visible');
    }

    /**
     * 툴팁을 숨긴다
     */
    function hideTooltip() {
        if (tooltipElement) {
            tooltipElement.classList.remove('kas-tooltip--visible');
        }
    }

    /**
     * 카테고리 라벨을 반환한다
     * @param {string} category - 카테고리 키
     * @returns {string}
     */
    function getCategoryLabel(category) {
        const labels = {
            goreViolence:   '혐오/폭력',
            disturbing:     '불쾌',
            porn:           '음란',
            hentai:         '성인 애니',
            sexy:           '선정적',
            gore:           '고어',
            violence:       '폭력',
            death:          '죽음',
            insects:        '벌레/생물',
            medical:        '의료공포',
            shock:          '충격',
            animal_cruelty: '동물학대',
            nsfw_porn:      '음란물',
            nsfw_sexy:      '선정성',
            Porn:           '음란',
            Hentai:         '성인 애니',
            Sexy:           '선정적',
            Drawing:        '그림',
            Neutral:        '일반'
        };
        return labels[category] || category;
    }

    /**
     * ========================================
     * DOM 변경 감지 (MutationObserver)
     * ========================================
     *
     * MutationObserver란?
     * - DOM 변경을 감지하는 Web API
     * - 노드 추가, 삭제, 속성 변경 등을 실시간 감지
     * - 이벤트보다 효율적 (브라우저 내장)
     *
     * 왜 필요한가요?
     * - 무한 스크롤: 새 게시글 추가 감지
     * - DCRefresher: 테이블 재렌더링 감지 (신호등이 사라짐)
     * - 동적 페이지 대응 (AJAX, SPA)
     *
     * DCRefresher란?
     * - 디시인사이드 편의 기능 확장 프로그램
     * - 페이지를 주기적으로 새로고침 (AJAX)
     * - DOM을 통째로 교체 (tbody.replaceWith)
     * - 우리 신호등도 함께 사라짐 (재삽입 필요)
     *
     * 대응 전략:
     * 1. tbody 교체 감지: 즉시 캐시 복원 (동기, 깜빡임 없음)
     * 2. 새 게시글 추가 감지: 신호등 삽입 (비동기)
     * 3. 테이블 재렌더링 감지: 전체 재처리
     *
     * 실생활 비유:
     * "주차장 CCTV:
     *  - 차가 들어오면 감지 (새 게시글)
     *  - 주차 구역이 다시 그려지면 감지 (DCRefresher)
     *  - 즉시 번호판 스캔 (신호등 재삽입)"
     */
    function observeDomChanges() {
        // ========================================
        // 1단계: 감시 대상 노드 선택
        // ========================================
        // table.gall_list: 디시인사이드 게시글 목록 테이블
        const targetNode = document.querySelector('table.gall_list');
        if (!targetNode) {
            return;  // 테이블 없으면 감시 안 함 (갤러리 페이지가 아님)
        }

        // ========================================
        // 2단계: DCRefresher 설치 여부 확인
        // ========================================
        // DCRefresher는 body에 특수 클래스를 추가함
        // - refresherChangeDCFont: 폰트 변경 기능
        // - refresherFont: 폰트 설정
        // - class에 'refresher' 포함: 다른 기능들
        const hasDCRefresher = document.body.classList.contains('refresherChangeDCFont') ||
                               document.body.classList.contains('refresherFont') ||
                               document.querySelector('[class*="refresher"]') !== null;

        if (hasDCRefresher) {
            debugLog('DCRefresher 감지 - 빠른 복원 모드 활성화');
        }

        // ========================================
        // 3단계: MutationObserver 생성
        // ========================================
        // mutations: 변경 사항 배열
        // 예: [{ type: 'childList', addedNodes: [...], removedNodes: [...] }]
        const observer = new MutationObserver((mutations) => {
            // ========================================
            // DOM 변경 시 툴팁 제거 (UX 개선)
            // ========================================
            // 툴팁이 열려있는 상태에서 DOM이 변경되면
            // 툴팁이 잘못된 위치에 표시될 수 있음
            hideTooltip();
            hidePostPreview();

            // ========================================
            // 플래그 초기화
            // ========================================
            let shouldRestore = false;   // 전체 재처리 필요 여부
            let tbodyReplaced = false;   // tbody 교체 여부
            let hasNewPosts = false;     // 새 게시글 추가 여부

            // ========================================
            // 4단계: 변경 사항 분석
            // ========================================
            for (const mutation of mutations) {
                // childList: 자식 노드 추가/삭제
                if (mutation.type === 'childList') {

                    // ========================================
                    // 케이스 1: tbody 통째로 교체 (DCRefresher)
                    // ========================================
                    // DCRefresher는 tbody를 replaceWith()로 교체
                    // → mutation.target = TABLE
                    // → removedNodes = [<tbody>]
                    // → addedNodes = [<tbody>] (새 tbody)
                    if (mutation.target.tagName === 'TABLE' &&
                        mutation.removedNodes.length > 0 &&
                        mutation.addedNodes.length > 0) {

                        // removedNodes 중 TBODY가 있는지 확인
                        for (const removed of mutation.removedNodes) {
                            if (removed.tagName === 'TBODY') {
                                shouldRestore = true;
                                tbodyReplaced = true;

                                // ========================================
                                // 즉시 캐시 복원 (동기, 깜빡임 없음)
                                // ========================================
                                // processPostList(true): 캐시만 즉시 복원
                                // DCRefresher가 DOM을 교체해도
                                // 신호등이 즉시 다시 나타남 (UX 향상)
                                processPostList(true);

                                // ========================================
                                // 미분석 게시글은 나중에 (비동기)
                                // ========================================
                                // 100ms 후 전체 분석 시작
                                // 사용자는 이미 캐시된 신호등을 보고 있음
                                setTimeout(() => {
                                    processPostList(false);
                                }, 100);

                                break;
                            }
                        }
                    }

                    // ========================================
                    // 케이스 2: 많은 노드 제거 (테이블 재렌더링)
                    // ========================================
                    // removedNodes가 3개 이상이면 재렌더링으로 간주
                    if (!shouldRestore && mutation.removedNodes.length > 3) {
                        shouldRestore = true;
                    }

                    // ========================================
                    // 케이스 3: 새 게시글 추가 (무한 스크롤)
                    // ========================================
                    // addedNodes 중 게시글 Row가 있는지 확인
                    if (!shouldRestore) {
                        mutation.addedNodes.forEach((node) => {
                            // node.matches(): CSS 선택자로 확인
                            // tr.ub-content.us-post: 디시 게시글 Row 클래스
                            if (node.nodeType === Node.ELEMENT_NODE &&
                                node.matches && node.matches('tr.ub-content.us-post')) {
                                hasNewPosts = true;
                                // 새 게시글에 즉시 신호등 삽입
                                processPostRow(node);
                            }
                        });
                    }
                }
            }

            // ========================================
            // 5단계: 전체 재처리 (tbody 교체가 아닌 경우)
            // ========================================
            // shouldRestore = true이지만 tbodyReplaced = false
            // → 대량 노드 제거 등 다른 원인
            //
            // Debounce 적용 이유:
            // - MutationObserver가 빠르게 여러 번 트리거될 수 있음
            // - 예: 무한 스크롤로 10개 게시글이 0.1초 안에 추가됨
            // - 각각 processPostList() 호출하면 10번 중복 작업
            // - 300ms 대기 후 한 번만 실행
            if (shouldRestore && !tbodyReplaced) {
                debugLog('테이블 재렌더링 감지, 300ms 후 재처리 예약');
                clearTimeout(domChangeTimer);  // 이전 타이머 취소
                domChangeTimer = setTimeout(() => {
                    debugLog('게시글 재처리 실행');
                    processPostList();  // 전체 재처리 (캐시 + 분석)
                }, 300);  // 300ms 대기
            }
        });

        // ========================================
        // 6단계: 감시 시작
        // ========================================
        observer.observe(targetNode, {
            childList: true,  // 자식 노드 추가/삭제 감시
            subtree:   true   // 하위 모든 노드 감시 (tbody, tr 등)
        });
        // 이제 table.gall_list의 모든 변경 사항이 감지됨
    }


    /**
     * ========================================
     * 주기적 신호등 체크 (백업 감지 시스템)
     * ========================================
     *
     * 왜 필요한가요?
     * - MutationObserver가 모든 DOM 변경을 감지하지 못할 수 있음
     * - DCRefresher가 복잡한 방식으로 DOM을 변경할 수 있음
     * - iframe, Shadow DOM 등은 감지 안 됨
     *
     * 동작 방식:
     * - 0.1초마다 첫 번째 게시글의 신호등 확인
     * - 신호등이 없으면 DOM이 교체된 것으로 판단
     * - 즉시 전체 재처리 (캐시 + 분석)
     *
     * 최적화 (O(n) → O(1)):
     * - 모든 게시글 체크하면 느림 (100개 × 0.1초 = 10초)
     * - 첫 번째 게시글만 체크 (샘플링)
     * - DCRefresher는 전체 테이블을 교체하므로
     *   첫 번째가 없으면 전부 없는 것
     *
     * 실생활 비유:
     * "초인종 백업 시스템:
     *  - 주 시스템: MutationObserver (실시간 감지)
     *  - 백업 시스템: 주기적 체크 (0.1초마다 확인)
     *  - 주 시스템 고장나도 백업으로 감지 가능"
     *
     * 성능 영향:
     * - 0.1초마다 실행되지만 O(1) 작업만 수행
     * - 첫 번째 게시글만 확인 (빠름)
     * - CPU 사용량: 거의 없음 (< 0.1%)
     */
    function startPeriodicCheck() {
        // ========================================
        // setInterval 등록 (0.1초마다 실행)
        // ========================================
        // window.periodicCheckIntervalId:
        // - 타이머 ID를 전역 변수에 저장
        // - 페이지 언로드 시 clearInterval() 호출
        window.periodicCheckIntervalId = setInterval(() => {
            // ========================================
            // 확장 비활성화 확인
            // ========================================
            if (!currentSettings.enabled) {
                return;  // 확장 꺼져있으면 체크 안 함
            }

            // ========================================
            // 게시글 목록 가져오기
            // ========================================
            // onlyWithThumbnail 설정에 따라 필터링
            const rows = currentSettings.onlyWithThumbnail
                ? window.dcParser.getPostRowsWithImage()   // 썸네일 있는 게시글만
                : window.dcParser.getAllPostRows();         // 모든 게시글

            // ========================================
            // 최적화: 첫 번째 게시글만 샘플링
            // ========================================
            // DCRefresher가 DOM을 교체하면 모든 신호등이 사라지므로
            // 하나만 체크해도 전체 상태를 알 수 있음
            //
            // 예시:
            // - 100개 게시글 중 첫 번째만 체크
            // - 시간 복잡도: O(100) → O(1)
            // - 0.1초마다 실행되어도 CPU 부담 거의 없음
            for (const row of rows) {
                // ========================================
                // 게시글 정보 파싱
                // ========================================
                const postInfo = window.dcParser.parsePostRow(row);
                if (!postInfo.hasImage) {
                    continue;  // 이미지 없으면 스킵 (다음 게시글 확인)
                }

                // ========================================
                // 신호등 존재 여부 확인
                // ========================================
                // hasSignal(): 신호등이 있는지 확인
                // 없으면 DOM이 교체된 것 (DCRefresher 또는 다른 원인)
                if (!window.dcParser.hasSignal(row)) {
                    debugLog('신호등 사라짐 감지, 전체 재처리 시작');

                    // ========================================
                    // 즉시 캐시 복원 (동기, 깜빡임 없음)
                    // ========================================
                    // processPostList(true): 캐시만 즉시 복원
                    // 사용자는 즉시 신호등을 볼 수 있음
                    processPostList(true);

                    // ========================================
                    // 미분석 게시글은 나중에 (비동기)
                    // ========================================
                    // 100ms 후 전체 분석 시작
                    setTimeout(() => {
                        processPostList(false);
                    }, 100);
                }

                // ========================================
                // 첫 번째 게시글만 체크하고 즉시 종료
                // ========================================
                // break: for 루프 탈출
                // 시간 복잡도: O(n) → O(1)
                // 100개 게시글 중 1개만 체크하므로 100배 빠름
                break;
            }
        }, 100);  // 0.1초 = 100ms
    }

    /**
     * 메시지를 처리한다
     * @param {object} message - 메시지
     * @param {object} sender - 발신자
     * @param {function} sendResponse - 응답 함수
     */
    function handleMessage(message, sender, sendResponse) {
        if (message.type === 'TOGGLE_EXTENSION') {
            currentSettings.enabled = message.enabled;

            if (message.enabled) {
                processPostList();
            }

            sendResponse({ success: true });
        }

        if (message.type === 'SETTINGS_UPDATED') {
            currentSettings = message.settings;
            sendResponse({ success: true });
        }

        // 이미지 처리 요청 (신고 기능용)
        if (message.type === 'PROCESS_IMAGE') {
            processImageForReport(message.imageUrl)
                .then(result => sendResponse(result))
                .catch(error => sendResponse({ error: error.message }));
            return true;  // 비동기 응답
        }

        // 신고 사유 입력 요청
        if (message.type === 'GET_REPORT_REASON') {
            const categoryLabels = {
                gore: '고어',
                violence: '폭력',
                death: '죽음',
                disturbing: '혐오',
                insects: '벌레/생물',
                medical: '의료공포',
                shock: '충격',
                animal_cruelty: '동물학대',
                nsfw_porn: '음란물',
                nsfw_sexy: '선정성'
            };

            const categoryLabel = categoryLabels[message.category] || message.category;
            const reason = prompt(
                `[${categoryLabel}] 신고 사유를 입력하세요:\n\n예시:\n- 신체 훼손 이미지\n- 유혈이 낭자한 장면\n- 충격적인 사고 현장\n\n(취소하려면 빈 칸으로 두거나 취소 버튼)`,
                ''
            );

            if (reason === null || reason.trim() === '') {
                // 사용자가 취소하거나 빈 칸
                sendResponse({ cancelled: true });
            } else {
                sendResponse({ reason: reason.trim() });
            }

            return true;
        }

        // 원본 이미지 복원 요청
        if (message.type === 'RESTORE_ORIGINAL_IMAGE') {
            const restored = restoreOriginalImage(message.imageUrl);
            sendResponse({ success: restored });
            return true;
        }

        // 화이트리스트 등록 사유 입력 요청
        if (message.type === 'GET_WHITELIST_REASON') {
            let imageUrl = message.imageUrl;
            console.log('[Kas-Free Content] 화이트리스트 요청 받음, imageUrl:', imageUrl);

            // placeholder 이미지인 경우 원본 URL 찾기
            if (imageUrl && imageUrl.includes('placeholder.jpg')) {
                console.log('[Kas-Free Content] placeholder 이미지 감지, 원본 URL 찾기 시작');
                const replacedImages = document.querySelectorAll('.kas-replaced-image[data-kas-replaced="true"]');
                console.log('[Kas-Free Content] 대체된 이미지 개수:', replacedImages.length);

                for (const img of replacedImages) {
                    console.log('[Kas-Free Content] 이미지 체크:', {
                        src: img.src,
                        original: img.dataset.kasOriginalSrc
                    });

                    if (img.src === imageUrl && img.dataset.kasOriginalSrc) {
                        imageUrl = img.dataset.kasOriginalSrc;
                        console.log('[Kas-Free Content] 원본 URL 찾음:', imageUrl);
                        break;
                    }
                }
            }

            let reason = null;
            let attempts = 0;
            const maxAttempts = 3;

            while (attempts < maxAttempts) {
                reason = prompt(
                    '🔓 화이트리스트 등록 요청\n\n' +
                    '이 이미지가 잘못 차단되었다고 생각되는 이유를 입력하세요.\n' +
                    '⚠️ 최소 10자 이상 입력해야 합니다.\n\n' +
                    '예시:\n' +
                    '• 일반적인 풍경 사진인데 차단됨\n' +
                    '• 뉴스 기사 이미지인데 위험으로 표시됨\n' +
                    '• 정상적인 제품 사진입니다',
                    ''
                );

                console.log('[Kas-Free Content] 사용자 입력:', {
                    reason: reason,
                    length: reason ? reason.trim().length : 0,
                    imageUrl: imageUrl,
                    attempt: attempts + 1
                });

                // 취소 버튼 클릭
                if (reason === null) {
                    console.log('[Kas-Free Content] 사용자가 취소');
                    sendResponse({ cancelled: true });
                    return true;
                }

                // 10자 이상이면 성공
                if (reason.trim().length >= 10) {
                    console.log('[Kas-Free Content] 정상 응답 반환');
                    sendResponse({
                        reason: reason.trim(),
                        imageUrl: imageUrl
                    });
                    return true;
                }

                // 10자 미만이면 다시 입력
                attempts++;
                if (attempts < maxAttempts) {
                    alert(`❌ 입력한 내용이 너무 짧습니다.\n현재: ${reason.trim().length}자 / 최소: 10자\n\n다시 입력해주세요. (${attempts}/${maxAttempts})`);
                }
            }

            // 3번 시도 후에도 10자 미만이면 취소
            console.log('[Kas-Free Content] 최대 시도 횟수 초과');
            alert('❌ 요청이 취소되었습니다.\n최소 10자 이상 입력해야 합니다.');
            sendResponse({ cancelled: true });

            return true;
        }

        return true;
    }

    /**
     * 대체된 이미지를 원본으로 복원한다
     * @param {string} placeholderUrl - 너굴맨 이미지 URL
     * @returns {boolean} 복원 성공 여부
     */
    function restoreOriginalImage(placeholderUrl) {
        /** 너굴맨으로 대체된 모든 이미지 찾기 */
        const replacedImages = document.querySelectorAll('.kas-replaced-image[data-kas-replaced="true"]');

        if (replacedImages.length === 0) {
            console.log('[Kas-Free] 복원할 이미지가 없음');
            return false;
        }

        let restored = false;

        replacedImages.forEach(img => {
            /** 원본 URL 복원 */
            const originalSrc = img.dataset.kasOriginalSrc;

            if (originalSrc) {
                img.src = originalSrc;
                img.classList.remove('kas-replaced-image');
                delete img.dataset.kasReplaced;
                delete img.dataset.kasOriginalSrc;
                delete img.dataset.kasStatus;

                console.log('[Kas-Free] 이미지 복원:', placeholderUrl, '→', originalSrc);
                restored = true;
            }
        });

        return restored;
    }

    /**
     * 이미지를 처리한다 (신고용)
     * @param {string} imageUrl - 이미지 URL
     * @returns {Promise<object>} { type, imageUrl, extraction?, mimeType }
     */
    async function processImageForReport(imageUrl) {
        console.log('[Kas-Free] 이미지 처리 시작 (Content Script):', imageUrl);

        /**
         * GIF 여부 확인
         * - GIF: 첫 프레임 추출 필요 (Canvas)
         * - 일반 이미지(JPEG, PNG): URL만 전송 (서버가 다운로드)
         */
        const isGif = imageUrl.toLowerCase().includes('.gif') ||
                      imageUrl.toLowerCase().includes('image/gif');

        if (isGif) {
            // GIF → Canvas로 첫 프레임 추출 시도
            try {
                const extractedBase64 = await extractImageToBase64(imageUrl);

                return {
                    type: 'extraction',
                    imageUrl: imageUrl,
                    extraction: extractedBase64.includes(',')
                        ? extractedBase64.split(',')[1]
                        : extractedBase64,
                    mimeType: 'image/jpeg'
                };
            } catch (error) {
                console.warn('[Kas-Free] GIF 프레임 추출 실패, Service Worker로 폴백:', error.message);

                // GIF 추출 실패 → Service Worker에서 재시도
                return {
                    type: 'url',
                    imageUrl: imageUrl,
                    mimeType: 'image/gif'
                };
            }
        } else {
            // 일반 이미지 → URL만 전송 (서버가 다운로드)
            console.log('[Kas-Free] 일반 이미지, URL만 전송');

            return {
                type: 'url',
                imageUrl: imageUrl,
                mimeType: 'image/jpeg'  // 추정값
            };
        }
    }

    /**
     * 프리뷰 툴팁 엘리먼트를 생성한다
     * @returns {HTMLElement}
     */
    function createPreviewTooltip() {
        if (previewTooltipElement) {
            return previewTooltipElement;
        }

        const tooltip     = document.createElement('div');
        tooltip.className = 'kas-preview-tooltip';
        document.body.appendChild(tooltip);

        previewTooltipElement = tooltip;
        return tooltip;
    }

    /**
     * 게시글 프리뷰를 표시한다
     * @param {Element} row - 게시글 Row 엘리먼트
     * @param {object} postInfo - 게시글 정보
     */
    async function showPostPreview(row, postInfo) {
        /** AI 검증이 완료되지 않은 게시글은 프리뷰 표시 안함 */
        const cachedResult = await getAnalysisFromCache(postInfo.postNo);
        if (!cachedResult) {
            return;
        }

        /** 이전에 프리뷰 실패한 게시글은 재시도하지 않음 */
        if (failedPreviews.has(postInfo.postNo)) {
            return;
        }

        /** 캐시된 본문 내용 확인 */
        let content = await getContentFromCache(postInfo.postNo);
        if (!content) {
            /** 본문 내용 fetch (에러 무시) */
            try {
                content = await window.dcParser.fetchPostContent(postInfo.postUrl);
                if (!content) {
                    failedPreviews.add(postInfo.postNo);
                    return;
                }
                await setContentToCache(postInfo.postNo, content);
            } catch (error) {
                // Fetch 실패 시 프리뷰 표시 안함, 재시도 방지
                failedPreviews.add(postInfo.postNo);
                return;
            }
        }

        /** 툴팁 생성 */
        const tooltip = createPreviewTooltip();

        /** 툴팁 내용 구성 */
        const textSummary = content.text.length > 150
            ? content.text.substring(0, 150) + '...'
            : content.text;

        const imageInfo = [];
        if (content.imageCount > 0) {
            imageInfo.push(`이미지 ${content.imageCount}개`);
        }
        if (content.dcconCount > 0) {
            imageInfo.push(`디시콘 ${content.dcconCount}개`);
        }

        /** 툴팁 내용을 DOM API로 안전하게 구성 (XSS 방지) */
        tooltip.innerHTML = '';

        /** 제목 */
        const titleDiv = document.createElement('div');
        titleDiv.className = 'kas-preview-tooltip__title';
        titleDiv.textContent = '게시글 미리보기';
        tooltip.appendChild(titleDiv);

        /** 내용 컨테이너 */
        const contentDiv = document.createElement('div');
        contentDiv.className = 'kas-preview-tooltip__content';

        /** 본문 텍스트 */
        const textDiv = document.createElement('div');
        textDiv.className = 'kas-preview-tooltip__text';
        textDiv.textContent = textSummary || '(내용 없음)';  // XSS 방지
        contentDiv.appendChild(textDiv);

        /** 이미지 정보 */
        if (imageInfo.length > 0) {
            const imagesDiv = document.createElement('div');
            imagesDiv.className = 'kas-preview-tooltip__images';
            imagesDiv.textContent = imageInfo.join(', ');
            contentDiv.appendChild(imagesDiv);
        }

        /** AI 검증 결과 추가 */
        if (cachedResult.aiAnalysis) {
            const ai = cachedResult.aiAnalysis;
            const statusText = cachedResult.status === 'danger' ? '⚠️ 위험' :
                              cachedResult.status === 'caution' ? '⚡ 주의' :
                              '✅ 안전';

            /** 조정된 위험도 사용 */
            const riskScore = cachedResult.adjustedRiskScore !== undefined ? cachedResult.adjustedRiskScore : (ai.final_score || cachedResult.riskScore || 0);
            const scorePercent = Math.round(riskScore * 100);
            const reason = ai.description || ai.reasoning || ai.reason || '설명 없음';

            const aiDiv = document.createElement('div');
            aiDiv.className = 'kas-preview-tooltip__ai';

            const aiTitle = document.createElement('div');
            aiTitle.className = 'kas-preview-tooltip__ai-title';
            aiTitle.textContent = '🤖 AI 이미지 분석';
            aiDiv.appendChild(aiTitle);

            const aiStatus = document.createElement('div');
            aiStatus.className = 'kas-preview-tooltip__ai-status';
            aiStatus.textContent = `${statusText} (${scorePercent}%)`;
            aiDiv.appendChild(aiStatus);

            const aiReason = document.createElement('div');
            aiReason.className = 'kas-preview-tooltip__ai-reason';
            aiReason.textContent = reason;  // XSS 방지
            aiDiv.appendChild(aiReason);

            contentDiv.appendChild(aiDiv);
        }

        tooltip.appendChild(contentDiv);

        /** 툴팁 위치 계산 */
        const rect = row.getBoundingClientRect();
        tooltip.style.left = `${rect.left + window.scrollX}px`;
        tooltip.style.top  = `${rect.bottom + window.scrollY + 8}px`;

        /** 툴팁 표시 */
        tooltip.classList.add('kas-preview-tooltip--visible');
    }

    /**
     * 게시글 프리뷰를 숨긴다
     */
    function hidePostPreview() {
        if (previewTooltipElement) {
            previewTooltipElement.classList.remove('kas-preview-tooltip--visible');
        }
    }

    /**
     * 이미지 URL을 Base64로 변환한다 (Content Script용 - DOM API 사용 가능)
     * @param {string} imageUrl - 이미지 URL
     * @returns {Promise<string>} Base64 Data URL
     */
    async function extractImageToBase64(imageUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();

            /**
             * DC 이미지 서버 CORS 우회 전략:
             * 1. crossOrigin 설정을 제거하여 Same-Origin으로 처리
             * 2. DC는 Referer 체크를 하므로 현재 페이지에서 로드하면 통과 가능
             * 3. Canvas taint 발생 시 URL로 폴백
             */
            // crossOrigin 설정 제거 (DC 서버는 CORS를 엄격하게 차단)

            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth || img.width;
                    canvas.height = img.naturalHeight || img.height;

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);

                    /**
                     * toDataURL 호출 시 Canvas가 tainted 상태면 SecurityError 발생
                     * 이 경우 catch 블록으로 이동하여 폴백 처리
                     */
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

                    console.log('[Kas-Free] 이미지 추출 완료 (Content Script):', {
                        width: canvas.width,
                        height: canvas.height,
                        size: Math.round(dataUrl.length / 1024) + 'KB'
                    });

                    resolve(dataUrl);
                } catch (error) {
                    /**
                     * Canvas tainted 에러 발생 시 URL만 반환
                     * Service Worker에서 fetch로 재시도하거나 서버에서 처리
                     */
                    console.warn('[Kas-Free] Canvas 추출 실패 (tainted), URL로 폴백:', error.message);
                    reject(new Error('CANVAS_TAINTED'));
                }
            };

            img.onerror = (error) => {
                console.error('[Kas-Free] 이미지 로드 실패:', imageUrl);
                reject(new Error('IMAGE_LOAD_FAILED'));
            };

            img.src = imageUrl;
        });
    }

    /**
     * 보이는 게시글을 선행 분석한다 (Prefetch)
     * @remarks 백그라운드에서 낮은 우선순위로 실행
     */
    async function prefetchVisiblePosts() {
        if (!currentSettings || !currentSettings.enabled || !currentSettings.autoScan) {
            return;
        }

        try {
            const rows = currentSettings.onlyWithThumbnail
                ? window.dcParser.getPostRowsWithImage()
                : window.dcParser.getAllPostRows();

            // 뷰포트 내부 + 하단 500px 영역의 게시글만 선택
            const visibleRows = Array.from(rows).filter(row => {
                const rect = row.getBoundingClientRect();
                return rect.top >= -100 && rect.top <= window.innerHeight + 500;
            });

            if (visibleRows.length === 0) {
                return;
            }

            debugLog('[Prefetch] 선행 분석 시작:', visibleRows.length, '개');

            // 순차적 지연 (서버 부하 방지)
            for (let i = 0; i < visibleRows.length; i++) {
                const row = visibleRows[i];

                // 200ms 간격으로 순차 처리
                await delay(i * 200);

                const postInfo = window.dcParser.parsePostRow(row);
                if (!postInfo || !postInfo.hasImage) {
                    continue;
                }

                // 이미 캐시에 있으면 스킵
                const cached = await getAnalysisFromCache(postInfo.postNo);
                if (cached) {
                    continue;
                }

                // 백그라운드 분석 요청 (await 없이 비동기 실행)
                requestImageAnalysis(postInfo)
                    .then(result => {
                        if (result) {
                            setAnalysisToCache(postInfo.postNo, result);
                            debugLog('[Prefetch] 선행 분석 완료:', postInfo.postNo);
                        }
                    })
                    .catch(error => {
                        debugLog('[Prefetch] 선행 분석 실패:', postInfo.postNo, error);
                    });
            }
        } catch (error) {
            console.error('[Prefetch] 선행 분석 에러:', error);
        }
    }

    /**
     * 지연 (Promise)
     * @param {number} ms - 지연 시간 (ms)
     * @returns {Promise<void>}
     */
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /** Prefetch 타이머 (debounce용) */
    let prefetchTimer = null;

    /**
     * 스크롤 이벤트 핸들러 (Prefetch 트리거)
     */
    function handleScrollForPrefetch() {
        clearTimeout(prefetchTimer);
        prefetchTimer = setTimeout(() => {
            prefetchVisiblePosts();
        }, 500);  // 500ms debounce
    }

    /**
     * Prefetch 이벤트 리스너 등록
     */
    function setupPrefetch() {
        // 스크롤 이벤트 리스너
        window.addEventListener('scroll', handleScrollForPrefetch, { passive: true });

        // 초기 Prefetch (페이지 로드 후 2초 대기)
        setTimeout(() => {
            prefetchVisiblePosts();
        }, 2000);

        debugLog('[Prefetch] 이벤트 리스너 등록 완료');
    }

    /** 초기화 실행 */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initialize();
            // 목록 페이지에서만 Prefetch 활성화
            if (window.dcParser && window.dcParser.isGalleryListPage()) {
                setupPrefetch();
            }
        });
    } else {
        initialize();
        // 목록 페이지에서만 Prefetch 활성화
        if (window.dcParser && window.dcParser.isGalleryListPage()) {
            setupPrefetch();
        }
    }
})();
