import { getDcRequestBroker, validateDcUrl } from './DcRequestBroker.js';
import { validateMessage, contentSettings } from './messageSecurity.js';
import { DecisionRevisionClient } from './DecisionRevisionClient.js';
import { extractPostImages, extractPostManifest, aggregatePostResults } from './postManifest.js';
/**
 * ========================================
 * 카-스 프리 Service Worker (백그라운드)
 * ========================================
 *
 * Service Worker란?
 * - Chrome Extension의 "백그라운드 프로세스" (브라우저가 켜져있는 동안 계속 실행됨)
 * - 웹페이지(content script)와 분리되어 독립적으로 동작
 * - 메시지를 받아서 처리하고 응답을 돌려주는 "서버" 역할
 *
 * 이 파일의 역할:
 * 1. 웹페이지에서 "이미지 분석해줘" 요청을 받음
 * 2. 이미지를 분석해서 안전한지 위험한지 판단
 * 3. 결과를 웹페이지로 돌려보냄
 *
 * 왜 Service Worker를 쓰나요?
 * - 무거운 작업(이미지 분석, API 호출)을 백그라운드에서 처리
 * - 웹페이지가 느려지지 않도록 분리
 * - 여러 탭에서 동시에 요청해도 하나의 Worker가 처리
 *
 * @author 최진호
 * @date 2026-02-12
 * @version 1.1.0
 * @remarks 이미지 분석 요청 처리 및 상태 관리 (리팩토링됨)
 */

// ========================================
// 외부 모듈 가져오기 (Import)
// ========================================
//
// 왜 import를 쓰나요?
// - 코드를 기능별로 파일을 나눠서 관리하기 위해
// - 다른 파일에 있는 함수나 클래스를 가져와서 사용
// - 예: 수학 계산 파일, 그림 그리기 파일 따로 만들고 필요할 때 import

import { HashChecker } from '../analyzers/hashChecker.js';        // 이미지 해시로 DB 검사
import { NsfwjsServerAnalyzer } from '../analyzers/nsfwjsServer.js'; // NSFW 이미지 분석 API
import {
    getSettings,      // 설정 불러오기
    saveSettings,     // 설정 저장하기
    updateSettings,   // 설정 일부만 수정하기
    getStats,         // 통계 불러오기
    updateStats       // 통계 업데이트
} from '../utils/storage.js';
import { MESSAGE_TYPES, DEFAULT_SETTINGS } from '../utils/constants.js'; // 상수 정의
import { imageUrlToBase64 } from '../utils/imageEncoder.js';      // 이미지 URL → Base64 변환
import { logError } from '../utils/errorHandler.js';              // 에러 로깅
import { generateAllHashesFromBlob } from '../utils/imageHash.js'; // 이미지 해시 생성

// 최적화 모듈 (성능 향상용)
import { AdvancedCacheManager } from './AdvancedCacheManager.js';   // LFU 캐싱 (자주 쓰는 데이터 빠르게 가져옴)
import { AIVerificationHandler } from './AIVerificationHandler.js'; // AI 검증 처리
import { ImageReportHandler } from './ImageReportHandler.js';       // 이미지 신고 처리
import { ErrorRecoveryManager } from './ErrorRecoveryManager.js';   // 에러 자동 복구
import { getPerformanceMonitor } from '../utils/PerformanceMonitor.js'; // 성능 측정
import { getResourceManager } from '../utils/ResourceManager.js';       // 메모리 관리
import { MemoryManager, CachePriority } from '../sw/memoryManager.js';   // Cache Storage 메모리 관리

// ========================================
// 전역 변수 (Global Variables)
// ========================================
//
// 왜 전역 변수를 쓰나요?
// - 이 파일 전체에서 공유해야 하는 데이터
// - 한 번 생성하면 계속 재사용 (매번 새로 만들 필요 없음)
//
// 왜 null로 초기화하나요?
// - 아직 만들지 않았다는 의미
// - initialize() 함수에서 나중에 실제 객체를 만들어서 할당

/**
 * 현재 설정
 * - 사용자가 설정한 민감도, 활성화 여부 등 저장
 * - 예: { enabled: true, thresholds: { safeMax: 30, cautionMax: 50 } }
 */
let currentSettings = null;

/**
 * 해시 기반 검사기
 * - 이미지의 "지문"(해시)을 만들어서 DB와 비교
 * - 빠른 1차 검증용 (이미지 전송 없이 해시만 전송)
 */
let hashChecker = null;

/**
 * NSFW 서버 API
 * - 위험한 이미지를 판별하는 AI 서버와 통신
 * - NSFW = Not Safe For Work (직장에서 보면 안 되는 내용)
 */
let nsfwServer = null;

/**
 * 캐시 관리자 (LFU 알고리즘)
 * - 한 번 분석한 이미지는 결과를 저장해둠
 * - 같은 이미지 다시 보면 분석 안 하고 저장된 결과 사용
 * - LFU = Least Frequently Used (가장 적게 쓴 것부터 삭제)
 */
let cacheManager = null;

/**
 * AI 검증 핸들러
 * - 외부 AI API (GPT-4o-mini, Claude, Gemini) 사용 처리
 * - 사용자가 "재검증" 버튼 누르면 동작
 */
let aiVerificationHandler = null;

/**
 * 이미지 신고 핸들러
 * - 사용자가 이미지 우클릭 → "신고하기" 선택 시 처리
 * - 신고 내용을 서버로 전송
 */
let imageReportHandler = null;

/**
 * 에러 복구 관리자
 * - API 에러, 타임아웃 등 발생 시 자동으로 복구 시도
 * - 예: 타임아웃 발생 → 캐시 확인 → 있으면 캐시 데이터 반환
 */
let errorRecoveryManager = null;

/**
 * 리소스 관리자
 * - 메모리 누수 방지 (사용 안 하는 데이터 자동 삭제)
 * - 타이머, 이벤트 리스너 등 자동 정리
 */
let resourceManager = null;

/**
 * 성능 모니터
 * - 각 작업의 소요 시간 측정
 * - 예: 이미지 분석 100ms, 해시 생성 50ms
 */
let performanceMonitor = null;

/**
 * Memory Manager (Cache Storage 메모리 관리)
 * - 브라우저 Cache Storage API 기반 캐시 관리
 * - LRU 기반 자동 정리 (Least Recently Used)
 * - 우선순위 기반 정리 (HIGH, MEDIUM, LOW)
 * - 메모리 압박 시 자동 정리
 * - 7일 자동 만료, 100MB 용량 제한
 */
let memoryManager = null;

/**
 * Fetch Queue Manager (디시인사이드 차단 방지)
 * - 초당 3개 (333ms 간격)로 fetch 요청 제한
 * - Queue 구조로 순차 처리
 * - 캐시 히트는 영향 없음 (fetch 안 함)
 */

/** 통계 업데이트 직렬화 큐 — 경쟁 조건 방지 */
let statsUpdateQueue = Promise.resolve();

/**
 * ========================================
 * 초기화 함수
 * ========================================
 *
 * 프로그램 시작 시 딱 한 번 실행되는 함수
 * 모든 모듈을 준비하고 설정을 불러옴
 *
 * 왜 async를 쓰나요?
 * - await로 비동기 작업을 기다려야 하기 때문
 * - 예: 설정 불러오기, 캐시 정리 등은 시간이 걸림
 *
 * 초기화 순서가 왜 중요한가요?
 * 1. 먼저 만든 것을 다음 것이 사용하기 때문
 * 2. 예: currentSettings를 먼저 불러와야 cacheManager가 사용 가능
 */
let initialization;
const storageAccessReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
function initialize() {
    if (!initialization) initialization = initializeModules().catch(error => { initialization = null; throw error; });
    return initialization;
}

async function initializeModules() {
    await storageAccessReady;
    console.log('[Kas-Free] Service Worker 초기화 (v1.1.0)');

    // ========================================
    // 1단계: 성능 모니터 초기화
    // ========================================
    // 왜 제일 먼저?
    // - 다른 작업들의 성능을 측정하려면 먼저 준비되어야 함
    performanceMonitor = getPerformanceMonitor();  // 싱글톤 패턴으로 가져옴
    await performanceMonitor.initialize();         // 저장된 데이터 로드
    console.log('[Kas-Free] Performance Monitor 초기화 완료');

    // ========================================
    // 2단계: 사용자 설정 불러오기
    // ========================================
    // chrome.storage.local에서 저장된 설정을 가져옴
    // 예: { enabled: true, thresholds: { safeMax: 30 } }
    currentSettings = await getSettings();

    // ========================================
    // 3단계: 해시 기반 검사기 초기화
    // ========================================
    // 이미지의 "지문"을 만들어서 DB에 있는지 확인
    // 실제로 이미지를 전송하지 않아도 되므로 빠름 (1차 검증)
    const nsfwApiKey = currentSettings.nsfwApiKey || '';
    hashChecker = new HashChecker('https://nsfw.nerdvana.kr', nsfwApiKey);
    console.log('[Kas-Free] Hash Checker 초기화 완료');

    // ========================================
    // 4단계: NSFW 서버 API 초기화
    // ========================================
    // 위험한 이미지를 판별하는 AI 서버와 통신하는 객체
    // baseUrl 등 설정을 포함
    nsfwServer = new NsfwjsServerAnalyzer('https://nsfw.nerdvana.kr', nsfwApiKey);
    console.log('[Kas-Free] NSFW Server API 초기화 완료');

    // ========================================
    // 5단계: 고급 캐시 관리자 초기화 (LFU + TTL)
    // ========================================
    // LFU = Least Frequently Used (가장 적게 사용한 것부터 삭제)
    // TTL = Time To Live (일정 시간 지나면 자동 삭제)
    //
    // 왜 캐시를 쓰나요?
    // - 같은 이미지를 여러 번 분석하면 시간 낭비
    // - 한 번 분석한 결과를 저장해뒀다가 재사용 (90% 히트율)
    //
    // 예시:
    // 1. 이미지 A 분석 → 결과 캐시에 저장
    // 2. 다시 이미지 A 만남 → 캐시에서 꺼내서 바로 반환 (분석 안 함)
    cacheManager = new AdvancedCacheManager(currentSettings);
    console.log('[Kas-Free] Advanced Cache Manager 초기화 완료 (LFU + TTL)');

    // ========================================
    // 6단계: AI 검증 핸들러 초기화
    // ========================================
    // 사용자가 "재검증" 버튼 누르면 외부 AI API 호출
    // - GPT-4o-mini (OpenAI)
    // - Claude Haiku (Anthropic)
    // - Gemini Flash (Google)
    aiVerificationHandler = new AIVerificationHandler(currentSettings, nsfwServer);
    console.log('[Kas-Free] AI Verification Handler 초기화 완료');

    // ========================================
    // 7단계: 에러 복구 관리자 초기화
    // ========================================
    // API 에러가 발생해도 자동으로 복구 시도
    //
    // 복구 전략 예시:
    // - TimeoutError → 캐시에 있으면 캐시 데이터 반환
    // - NetworkError → 3번까지 재시도
    // - OutOfMemoryError → 캐시 정리 후 재시도
    errorRecoveryManager = new ErrorRecoveryManager({
        maxRetries: 3,      // 최대 재시도 횟수
        retryDelay: 1000    // 재시도 간격 (1초)
    });
    console.log('[Kas-Free] Error Recovery Manager 초기화 완료');

    // ========================================
    // 8단계: 리소스 관리자 초기화
    // ========================================
    // 메모리 누수 방지
    // - 타이머 자동 정리 (setTimeout, setInterval)
    // - 이벤트 리스너 자동 정리
    // - 메모리 사용량 모니터링 (200MB 초과 시 정리)
    resourceManager = getResourceManager();
    console.log('[Kas-Free] Resource Manager 초기화 완료');

    // ========================================
    // 9단계: 이미지 신고 핸들러 초기화
    // ========================================
    // 사용자가 우클릭 → "신고하기" 선택 시 처리
    imageReportHandler = new ImageReportHandler(nsfwServer);
    console.log('[Kas-Free] Image Report Handler 초기화 완료');

    // ========================================
    // 10단계: Memory Manager 초기화 (Cache Storage)
    // ========================================
    // Cache Storage API 기반 캐시 자동 정리
    // - 100MB 용량 제한
    // - 7일 자동 만료
    // - LRU 기반 정리 (오래 사용 안 한 것부터 삭제)
    // - 우선순위: HIGH (항상 유지) > MEDIUM (자주 사용) > LOW (일회성)
    memoryManager = new MemoryManager({
        maxCacheSize: 100 * 1024 * 1024,        // 100MB
        cacheExpiry: 7 * 24 * 60 * 60 * 1000,   // 7일
        cleanupInterval: 10 * 60 * 1000         // 10분마다 정리
    });
    await memoryManager.init();
    console.log('[Kas-Free] Memory Manager 초기화 완료 (Cache Storage)');

    // ========================================
    // 12단계: 만료된 캐시 정리
    // ========================================
    // TTL(Time To Live) 시간이 지난 캐시 데이터 삭제
    // - 예: 24시간 지난 이미지 분석 결과는 삭제
    // - Promise이므로 .then()으로 비동기 처리
    cacheManager.clearExpired().then(count => {
        if (count > 0) {
            console.log(`[Kas-Free] 만료된 해시 캐시 ${count}개 정리 완료`);
        }
    });

    await getDcRequestBroker().ready;
    console.log('[Kas-Free] Service Worker 초기화 완료');
}

/**
 * ========================================
 * 메시지 리스너 등록
 * ========================================
 *
 * Chrome Extension의 메시지 시스템:
 * - Content Script (웹페이지) → Service Worker (백그라운드) 통신 방법
 * - 마치 "우체국" 같은 역할
 *
 * 작동 방식:
 * 1. Content Script: chrome.runtime.sendMessage({ type: 'ANALYZE_IMAGE', ... })
 * 2. Service Worker: 이 리스너가 메시지를 받아서 처리
 * 3. Service Worker: sendResponse()로 결과 전송
 * 4. Content Script: 결과를 받아서 화면에 표시
 *
 * return true의 의미:
 * - "비동기 응답을 보낼 거예요"라는 신호
 * - 안 쓰면 sendResponse가 작동하지 않음 (중요!)
 */
const activeRequests = new Map();
const decisionRevisionClient = new DecisionRevisionClient();
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    let privileged;
    try { privileged = validateMessage(message, sender, chrome.runtime.id); }
    catch (error) { sendResponse({ error: error.message, code: 'INVALID_MESSAGE', status: 'error' }); return false; }
    const controller = new AbortController();
    const requestId = `${sender.tab?.id ?? 'extension'}:${message.requestId || crypto.randomUUID()}`;
    if (activeRequests.has(requestId)) {
        sendResponse({ error: '이미 처리 중인 요청 ID입니다.', status: 'error' }); return false;
    }
    const timeoutMs = message.type === 'VERIFY_WITH_AI' ? 60000 : message.type === 'ANALYZE_IMAGES' ? 90000 : 30000;
    const context = { signal: controller.signal, deadline: Date.now() + timeoutMs,
        tabId: sender.tab?.id ?? null, priority: message.userInitiated === true || message.type === 'FETCH_DC_POST' || message.type === 'VERIFY_WITH_AI' ? 1 : 0 };
    activeRequests.set(requestId, { controller, tabId: context.tabId });
    let responded = false;
    const timeout = setTimeout(() => {
        controller.abort();
        if (!responded) { responded = true; sendResponse({ status: 'deferred', code: 'DEADLINE_EXCEEDED', error: '조회 시간을 초과했습니다. 잠시 후 직접 다시 시도하세요.' }); }
    }, timeoutMs);
    handleMessage({ ...message, context, privileged }, sender, response => {
        if (!responded) { responded = true; sendResponse(response); }
    }).finally(() => { clearTimeout(timeout); activeRequests.delete(requestId); });
    return true;
});

/**
 * ========================================
 * 메시지 처리 함수
 * ========================================
 *
 * 받은 메시지의 type을 보고 적절한 함수 호출
 * 마치 "전화 교환원"이 전화를 적절한 부서로 연결하는 것과 같음
 *
 * @param {object} message - 메시지 객체 (예: { type: 'ANALYZE_IMAGE', postNo: 123 })
 * @param {object} sender - 발신자 정보 (어느 탭에서 보냈는지)
 * @param {function} sendResponse - 응답 함수 (결과를 돌려보낼 때 사용)
 *
 * 왜 async를 쓰나요?
 * - 대부분의 작업이 시간이 걸림 (API 호출, DB 조회 등)
 * - await로 결과를 기다린 후 sendResponse() 호출
 *
 * try-catch의 역할:
 * - 에러가 발생해도 프로그램이 멈추지 않도록
 * - 사용자에게 친화적인 에러 메시지 표시
 */
async function handleMessage(message, sender, sendResponse) {
    // message에서 type 필드만 추출
    // 예: { type: 'ANALYZE_IMAGE', postNo: 123 } → type = 'ANALYZE_IMAGE'
    const { type } = message;

    try {
        await initialize();
        // ========================================
        // switch-case: type 값에 따라 분기
        // ========================================
        // if-else 여러 개 쓰는 것보다 깔끔함
        switch (type) {
            case 'FETCH_DC_POST':
                sendResponse({ html: await getDcRequestBroker().request(message.postUrl, { ...message.context, kind: 'html' }) });
                break;
            case 'GET_PROTECTION_SETTINGS':
                sendResponse({ enabled: currentSettings.enabled, protectPending: currentSettings.protectPending });
                break;
            case 'GET_DC_REQUEST_STATUS':
                sendResponse(getDcRequestBroker().getStatus());
                break;
            case 'GET_DECISION_REVISION':
                sendResponse({ decisionRevision: await decisionRevisionClient.getRevision() });
                break;
            case 'RESUME_DC_REQUESTS':
                await getDcRequestBroker().resume();
                sendResponse({ success: true });
                break;
            case 'CANCEL_DC_REQUESTS':
                for (const item of activeRequests.values()) if (item.tabId === sender.tab?.id) item.controller.abort();
                sendResponse({ success: true });
                break;
            case 'ANALYZE_IMAGES': {
                const results = [];
                for (const imageUrl of [...new Set(message.imageUrls)]) {
                    if (message.context.signal.aborted) break;
                    results.push({ imageUrl, ...await handleAnalyzeImage({ ...message, imageUrl }) });
                }
                sendResponse({ results, complete: results.length === new Set(message.imageUrls).size });
                break;
            }
            // 이미지 분석 요청
            case MESSAGE_TYPES.ANALYZE_IMAGE:
                const result = await handleAnalyzeImage(message);
                sendResponse(result);
                break;

            // AI 재검증 요청 (사용자가 재검증 버튼 클릭)
            case 'VERIFY_WITH_AI':
                const aiResult = await aiVerificationHandler.handleVerification(
                    message,
                    fetchPostImage,          // 게시글에서 이미지 추출 함수
                    getOrCreateReporterId,   // 신고자 ID 생성 함수
                    message.context
                );
                sendResponse(aiResult);
                break;

            // 설정 조회 요청
            case MESSAGE_TYPES.GET_SETTINGS:
                const settings = await getSettings();
                sendResponse(message.privileged ? settings : contentSettings(settings));
                break;

            // 설정 업데이트 요청
            case MESSAGE_TYPES.UPDATE_SETTINGS:
                await handleUpdateSettings(message.settings);
                sendResponse({ success: true });
                break;

            // 통계 조회 요청
            case MESSAGE_TYPES.GET_STATS:
                const stats = await getStats();
                sendResponse(stats);
                break;

            // 성능 메트릭 조회 (대시보드용)
            case 'GET_PERFORMANCE_METRICS':
                const metrics = await performanceMonitor.getSummary();
                sendResponse(metrics);
                break;

            // 타임아웃 통계 조회
            // ?. 연산자: 객체가 null이면 에러 대신 undefined 반환
            case 'GET_TIMEOUT_STATS':
                const timeoutStats = aiVerificationHandler?.apiClient?.getTimeoutStats() || { enabled: false };
                sendResponse(timeoutStats);
                break;

            // 에러 복구 상태 조회
            case 'GET_HEALTH_STATUS':
                const health = errorRecoveryManager?.getHealthStatus() || { status: 'unknown' };
                sendResponse(health);
                break;

            // 에러 통계 조회
            case 'GET_ERROR_STATS':
                const errorStats = errorRecoveryManager?.getErrorStats() || { totalErrors: 0 };
                sendResponse(errorStats);
                break;

            // 리소스 사용량 조회
            case 'GET_RESOURCE_STATS':
                const resourceStats = resourceManager?.getResourceStats() || {};
                sendResponse(resourceStats);
                break;

            // 메모리 통계 조회
            case 'GET_MEMORY_STATS':
                await resourceManager?.recordMemoryUsage();  // 먼저 현재 메모리 기록
                const memoryStats = resourceManager?.getMemoryStats() || null;
                sendResponse(memoryStats);
                break;

            // 통계 업데이트
            case MESSAGE_TYPES.UPDATE_STATS:
                statsUpdateQueue = statsUpdateQueue
                    .then(() => updateStats(message.signalType))
                    .catch((err) => console.error('[Kas-Free] 통계 업데이트 실패:', err));
                await statsUpdateQueue;
                sendResponse({ success: true });
                break;

            // 확장 프로그램 활성화/비활성화
            case MESSAGE_TYPES.TOGGLE_EXTENSION:
                await handleToggleExtension(message.enabled);
                sendResponse({ success: true });
                break;

            // API 연결 상태 확인
            case 'CHECK_API_STATUS':
                const status = await handleCheckApiStatus();
                sendResponse(status);
                break;

            // 알 수 없는 메시지 타입
            default:
                sendResponse({ error: '알 수 없는 메시지 타입' });
        }
    } catch (error) {
        // ========================================
        // 에러 처리
        // ========================================
        console.error('[Kas-Free] Message handler error:', error);

        // 사용자 친화적 에러 메시지
        // error.userFriendly가 true면 에러 메시지 그대로 사용
        // 아니면 일반적인 메시지 사용
        const userMessage = error.userFriendly || error.name === 'DcRequestError'
            ? error.message
            : '알 수 없는 오류가 발생했습니다.';

        sendResponse({
            error: userMessage,
            status: error.code === 'DC_DEFERRED' ? 'deferred' : error.code === 'CANCELLED' ? 'cancelled' : 'error',
            code: error.code || 'PROCESSING_FAILED',
            retryAt: error.retryAt || null,
            userFriendly: true
        });
    }
}

/**
 * ========================================
 * 이미지 분석 요청 처리 함수
 * ========================================
 *
 * 전체 흐름:
 * 1. 캐시 확인 → 있으면 바로 반환 (90% 케이스)
 * 2. 캐시 없으면 → 게시글에서 이미지 URL 추출
 * 3. 이미지 분석 (1차: 해시 검사, 2차: 이미지 전송)
 * 4. 결과를 캐시에 저장
 * 5. 결과 반환
 *
 * 에러 발생 시:
 * - ErrorRecoveryManager가 자동으로 복구 시도
 * - 예: 타임아웃 → 캐시 확인 → 있으면 캐시 반환
 *
 * @param {object} message - 메시지 객체 { postNo, postUrl }
 * @returns {Promise<object>} 분석 결과 { status, riskScore, categories }
 */
async function handleAnalyzeImage(message) {
    if (!currentSettings.enabled) return { status: 'unchecked', error: '확장 프로그램이 비활성화되어 있습니다.' };
    const context = message.context || {};
    const timer = performanceMonitor.startTimer('analysis');
    try {
        const manifest = message.imageUrl ? { imageUrls: [message.imageUrl], unavailableCount: 0 } : extractPostManifest(
            await getDcRequestBroker().request(message.postUrl, { ...context, kind: 'html' }), message.postUrl);
        const imageUrls = manifest.imageUrls;
        if (!imageUrls.length) return { status: 'unchecked', globalVerdict: 'unknown', riskScore: null, categories: {}, error: '검사할 이미지를 찾을 수 없습니다.' };
        const revisionBefore = await decisionRevisionClient.getRevision();
        const results = [];
        for (const imageUrl of imageUrls.slice(0, 100)) {
            if (context.signal?.aborted) break;
            try { results.push({ ...await analyzeImage(imageUrl, message.postUrl, context), imageUrl }); }
            catch (error) {
                results.push({ imageUrl, status: error.code === 'DC_DEFERRED' ? 'deferred' : error.code === 'CANCELLED' ? 'cancelled' : 'error',
                    globalVerdict: 'unknown', riskScore: null, categories: {}, code: error.code || 'ANALYSIS_FAILED', error: error.message, retryAt: error.retryAt });
                break;
            }
        }
        const revisionAfter = await decisionRevisionClient.getRevision();
        return { ...aggregatePostResults(results, imageUrls.length + manifest.unavailableCount), decisionVersion: 2, timestamp: Date.now(),
            decisionRevision: revisionBefore && revisionBefore === revisionAfter ? revisionAfter : null };
    } catch (error) {
        return { status: error.code === 'DC_DEFERRED' ? 'deferred' : error.code === 'CANCELLED' ? 'cancelled' : 'error',
            globalVerdict: 'unknown', riskScore: null, categories: {}, code: error.code || 'ANALYSIS_FAILED',
            error: error.message || '검사를 완료할 수 없습니다.', retryAt: error.retryAt || null };
    } finally {
        await performanceMonitor.recordAnalysisTime(performanceMonitor.endTimer(timer));
    }
}

/**
 * ========================================
 * 이미지 분석 함수 (2단계 검증)
 * ========================================
 *
 * 2단계 검증 전략 (Optimized Path):
 *
 * 1단계: 해시 검사 (빠름, 데이터 소량)
 * ├─ 해시만 서버로 전송 (이미지 전송 X)
 * ├─ DB에 같은 해시가 있는지 확인
 * └─ 결과: { matched: true/false, riskScore: 0~100 }
 *
 * 2단계: 이미지 전송 (느림, 데이터 대량) - 조건부
 * ├─ 1단계에서 CAUTION(주황) 또는 DANGER(빨강) 판정 시에만
 * ├─ 실제 이미지를 Base64로 인코딩하여 서버 전송
 * └─ 정밀 분석: NSFW AI가 직접 이미지 분석
 *
 * 왜 2단계로 나누나요?
 * - 대부분 이미지는 안전함 (80%)
 * - 안전한 이미지는 해시만으로 빠르게 통과 (100ms)
 * - 의심스러운 이미지만 정밀 검사 (1000ms)
 * - 결과: 평균 분석 시간 대폭 감소 (1000ms → 300ms)
 *
 * @param {string} imageUrl - 이미지 URL (예: https://dcimg7.dcinside.com/viewimage.php?...)
 * @param {string} pageUrl - 페이지 URL (선택, 디버깅용)
 * @returns {Promise<object>} 최종 분석 결과 { status, riskScore, categories, primary, secondary }
 */
async function analyzeImage(imageUrl, pageUrl = null, context = {}) {
    validateDcUrl(imageUrl);
    const options = { ...context, profile: currentSettings.profile, pageUrl };
    const broker = getDcRequestBroker();
    const hitsBefore = broker.getStatus().cacheHits;
    const blob = await broker.request(imageUrl, { ...context, kind: 'image' });
    if (broker.getStatus().cacheHits > hitsBefore) await performanceMonitor.recordCacheHit();
    else await performanceMonitor.recordCacheMiss();
    const hashTimer = performanceMonitor.startTimer('hash');
    let hashes;
    try { hashes = await generateAllHashesFromBlob(blob); }
    finally { await performanceMonitor.recordHashTime(performanceMonitor.endTimer(hashTimer)); }
    const reporterId = await getOrCreateReporterId();
    const apiTimer = performanceMonitor.startTimer('api');
    let primary;
    let failed = false;
    try { primary = await hashChecker.check(hashes, 10, reporterId, options); }
    catch (error) { failed = true; throw error; }
    finally { await performanceMonitor.recordApiTime(performanceMonitor.endTimer(apiTimer), failed); }
    if (context.signal?.aborted) throw new Error('검사가 취소됐습니다.');
    if (primary.globalVerdict === 'unknown' && currentSettings.allowServerAnalysis) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const chunks = [];
        for (let offset = 0; offset < bytes.length; offset += 32768) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
        const base64 = btoa(chunks.join(''));
        return nsfwServer.check(base64, reporterId, options);
    }
    return primary;
}

/**
 * 게시글에서 이미지 URL을 추출한다
 * @param {string} postUrl - 게시글 URL
 * @returns {Promise<string|null>}
 */
async function fetchPostImage(postUrl, context = {}) {
    const html = await getDcRequestBroker().request(postUrl, { ...context, kind: 'html' });
    return extractPostImages(html, postUrl)[0] || null;
}

/**
 * 설정 업데이트를 처리한다
 * @param {object} newSettings - 새 설정
 */
async function handleUpdateSettings(newSettings) {
    if (!await saveSettings(newSettings)) throw new Error('설정을 저장하지 못했습니다.');
    newSettings = await getSettings();
    currentSettings = newSettings;

    // 모듈 설정 업데이트
    cacheManager.updateSettings(newSettings);
    aiVerificationHandler.updateSettings(newSettings);

    // NSFW API 키 변경 시 분석기 재초기화
    const updatedApiKey = newSettings.nsfwApiKey || '';
    if (hashChecker.apiKey !== updatedApiKey) {
        hashChecker.apiKey  = updatedApiKey;
        nsfwServer.apiKey   = updatedApiKey;
    }

    // 모든 탭에 설정 변경 알림 (.com + .co.kr 동시 처리)
    const [comTabs, coKrTabs] = await Promise.all([
        chrome.tabs.query({ url: 'https://gall.dcinside.com/*' }),
        chrome.tabs.query({ url: 'https://gall.dcinside.co.kr/*' })
    ]);
    const tabs = [...comTabs, ...coKrTabs];
    for (const tab of tabs) {
        try {
            await chrome.tabs.sendMessage(tab.id, {
                type: 'SETTINGS_UPDATED',
                settings: contentSettings(newSettings)
            });
        } catch {
            // 탭이 응답하지 않을 수 있음
        }
    }
}

/**
 * 확장 프로그램 활성화/비활성화를 처리한다
 * @param {boolean} enabled - 활성화 여부
 */
async function handleToggleExtension(enabled) {
    await updateSettings({ enabled });
    currentSettings.enabled = enabled;

    // 모든 탭에 알림 (.com + .co.kr 동시 처리)
    const [comTabs, coKrTabs] = await Promise.all([
        chrome.tabs.query({ url: 'https://gall.dcinside.com/*' }),
        chrome.tabs.query({ url: 'https://gall.dcinside.co.kr/*' })
    ]);
    const tabs = [...comTabs, ...coKrTabs];
    for (const tab of tabs) {
        try {
            await chrome.tabs.sendMessage(tab.id, {
                type: MESSAGE_TYPES.TOGGLE_EXTENSION,
                enabled: enabled
            });
        } catch {
            // 탭이 응답하지 않을 수 있음
        }
    }
}

/**
 * API 연결 상태를 확인한다
 * @returns {Promise<object>}
 */
async function handleCheckApiStatus() {
    const status = {
        nsfwjs: false,
        geminiFlash: false,
        claudeHaiku: false,
        gpt4oMini: false
    };

    // Hash Checker 상태
    try {
        if (hashChecker) {
            status.nsfwjs = await hashChecker.testConnection();
        }
    } catch (error) {
        console.error('[Kas-Free] Hash Checker 상태 체크 실패:', error);
        status.nsfwjs = false;
    }

    // AI API는 설정된 경우만 체크
    const enabledApi = aiVerificationHandler.getEnabledAIApi();
    if (enabledApi) {
        if (enabledApi.name === 'geminiFlash') {
            status.geminiFlash = true;
        } else if (enabledApi.name === 'claudeHaiku') {
            status.claudeHaiku = true;
        } else if (enabledApi.name === 'gpt4oMini') {
            status.gpt4oMini = true;
        }
    }

    return status;
}

/**
 * 확장 프로그램 설치/업데이트 이벤트
 */
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('[Kas-Free] 설치/업데이트:', details.reason);

    if (details.reason === 'install') {
        // 최초 설치 시 기본 설정 저장
        await saveSettings(DEFAULT_SETTINGS);
        console.log('[Kas-Free] 기본 설정 저장 완료');
    }

    // 컨텍스트 메뉴 생성
    createContextMenus();

    // 초기화
    await initialize();
});

/**
 * 서비스 워커 활성화 이벤트
 */
self.addEventListener('activate', () => {
    console.log('[Kas-Free] Service Worker 활성화');
    createContextMenus();
    initialize();
});

/** 브라우저 시작 이벤트 */
chrome.runtime.onStartup.addListener(() => {
    console.log('[Kas-Free] 브라우저 시작');
    createContextMenus();
});

/** 즉시 초기화 시도 */
createContextMenus();
initialize().catch(console.error);

/**
 * 컨텍스트 메뉴를 생성한다
 */
function createContextMenus() {
    // 기존 메뉴 제거
    chrome.contextMenus.removeAll(() => {
        // 원본 이미지 보기 (너굴맨 대체 이미지용)
        chrome.contextMenus.create({
            id: 'kas-free-restore',
            title: '🔓 원본 이미지 보기',
            contexts: ['image'],
            documentUrlPatterns: [
                'https://gall.dcinside.com/*',
                'https://gall.dcinside.co.kr/*'
            ]
        });

        // 화이트리스트 등록 요청 (잘못 차단된 이미지)
        chrome.contextMenus.create({
            id: 'kas-free-whitelist',
            title: '✅ 화이트리스트 등록 요청',
            contexts: ['image'],
            documentUrlPatterns: [
                'https://gall.dcinside.com/*',
                'https://gall.dcinside.co.kr/*'
            ]
        });

        // 구분선
        chrome.contextMenus.create({
            id: 'kas-free-separator',
            type: 'separator',
            contexts: ['image'],
            documentUrlPatterns: [
                'https://gall.dcinside.com/*',
                'https://gall.dcinside.co.kr/*'
            ]
        });

        // 부모 메뉴 (모든 사이트에서 표시)
        chrome.contextMenus.create({
            id: 'kas-free-report',
            title: 'Kas-Free 신고하기',
            contexts: ['image']
        });

        // 서브메뉴 - 카테고리별
        const categories = [
            { id: 'gore', title: '🩸 고어' },
            { id: 'violence', title: '👊 폭력' },
            { id: 'death', title: '💀 죽음' },
            { id: 'disturbing', title: '😱 혐오' },
            { id: 'insects', title: '🐛 벌레/생물' },
            { id: 'medical', title: '💉 의료공포' },
            { id: 'shock', title: '⚠️ 충격' },
            { id: 'animal_cruelty', title: '🐾 동물학대' },
            { id: 'nsfw_porn', title: '🔞 음란물' },
            { id: 'nsfw_sexy', title: '💋 선정성' }
        ];

        categories.forEach(category => {
            chrome.contextMenus.create({
                id: `kas-free-report-${category.id}`,
                parentId: 'kas-free-report',
                title: category.title,
                contexts: ['image']
            });
        });

        console.log('[Kas-Free] 컨텍스트 메뉴 생성 완료');
    });
}

/**
 * 컨텍스트 메뉴 클릭 핸들러
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    // 원본 이미지 복원
    if (info.menuItemId === 'kas-free-restore') {
        try {
            const response = await chrome.tabs.sendMessage(tab.id, {
                type: 'RESTORE_ORIGINAL_IMAGE',
                imageUrl: info.srcUrl
            });

            if (response && response.success) {
                console.log('[Kas-Free] 원본 이미지 복원 성공');
            } else {
                console.log('[Kas-Free] 복원할 이미지가 없거나 이미 복원됨');
            }
        } catch (error) {
            console.error('[Kas-Free] 원본 이미지 복원 실패:', error);
        }
        return;
    }

    // 화이트리스트 등록 요청
    if (info.menuItemId === 'kas-free-whitelist') {
        await handleWhitelistRequest(info.srcUrl, info.pageUrl, tab);
        return;
    }

    // 이미지 신고
    if (info.menuItemId.toString().startsWith('kas-free-report-')) {
        const category = info.menuItemId.toString().replace('kas-free-report-', '');
        await imageReportHandler.handleReport(
            info.srcUrl,
            info.pageUrl,
            category,
            tab,
            getOrCreateReporterId
        );
    }
});

/**
 * 신고자 ID를 가져오거나 생성한다
 * @returns {Promise<string>}
 */
async function getOrCreateReporterId() {
    const _r = await chrome.storage.local.get('reporterId');
    if (_r.reporterId && _v(_r.reporterId)) return _r.reporterId;
    const _n = _g();
    await chrome.storage.local.set({ reporterId: _n });

    return _n;
}

/**
 * ID가 "nerd" 시그니처를 포함하는지 검증
 * @param {string} id - 검증할 ID
 * @returns {boolean}
 */
function _v(_s) {
    const _c = [110, 101, 114, 100];
    let _p = -1;
    for (let _i = 0; _i < _c.length; _i++) {
        let _f = false;
        for (let _j = _p + 1; _j < _s.length; _j++) {
            if (_s.charCodeAt(_j) === _c[_i]) {
                _p = _j;
                _f = true;
                break;
            }
        }
        if (!_f) return false;
    }
    return (_s.charCodeAt(8) ^ _s.charCodeAt(13)) % 7 === (_s.charCodeAt(23) ^ _s.charCodeAt(18)) % 7;
}

/**
 * "nerd"가 숨겨진 UUID v4 생성
 * @returns {string}
 */
function _g() {
    let _u = crypto.randomUUID();
    const _a = [];
    const _x = [8, 13, 14, 18, 19, 23];
    for (let _i = 0; _i < _u.length; _i++) {
        if (_u[_i] !== '-' && !_x.includes(_i)) _a.push(_i);
    }
    const _s = [];
    const _b = [..._a];
    for (let _i = 0; _i < 4; _i++) {
        const _r = Math.floor(Math.random() * _b.length);
        _s.push(_b[_r]);
        _b.splice(_r, 1);
    }
    _s.sort((a, b) => a - b);
    const _m = [110, 101, 114, 100];
    const _t = _u.split('');
    for (let _i = 0; _i < 4; _i++) _t[_s[_i]] = String.fromCharCode(_m[_i]);
    const _k = Date.now() % 256;
    _t[8] = String.fromCharCode(((_t[8].charCodeAt(0) ^ _k) % 16) + 97);
    _t[13] = String.fromCharCode(((_t[13].charCodeAt(0) ^ _k) % 16) + 97);
    _t[23] = String.fromCharCode(((_t[23].charCodeAt(0) ^ (_k ^ (_t[8].charCodeAt(0) ^ _t[13].charCodeAt(0)))) % 16) + 97);
    _t[18] = String.fromCharCode(((_t[18].charCodeAt(0) ^ (_k ^ (_t[8].charCodeAt(0) ^ _t[13].charCodeAt(0)))) % 16) + 97);
    return _t.join('');
}

/**
 * 화이트리스트 등록 요청을 처리한다
 * @param {string} imageUrl - 이미지 URL
 * @param {string} pageUrl - 페이지 URL
 * @param {object} tab - 탭 정보
 */
async function handleWhitelistRequest(imageUrl, pageUrl, tab) {
    try {

        // 1. content script에 사유 입력 요청
        const response = await chrome.tabs.sendMessage(tab.id, {
            type: 'GET_WHITELIST_REASON',
            imageUrl: imageUrl
        });


        if (!response || response.cancelled) {
            console.log('[Kas-Free] 사용자가 요청 취소 또는 응답 없음');
            return;
        }

        const reason = response.reason;
        // content script에서 원본 URL을 반환한 경우 사용
        const actualImageUrl = response.imageUrl || imageUrl;

        // 2. reporterId 가져오기
        const reporterId = await getOrCreateReporterId();

        // 3. API 호출
        const apiUrl = nsfwServer.serverUrl + '/api/whitelist/request';



        const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                ...nsfwServer._buildHeaders()
            },
            body: JSON.stringify({
                imageUrl: actualImageUrl,
                reporterId: reporterId,
                reason: reason,
                context: `Page: ${pageUrl}`
            })
        });

        const result = await apiResponse.json();

        if (!apiResponse.ok) {
            // API 에러 처리
            let errorMessage = '요청 실패';

            if (apiResponse.status === 400) {
                errorMessage = '입력 정보가 올바르지 않습니다';
            } else if (apiResponse.status === 401) {
                errorMessage = '인증 오류';
            } else if (apiResponse.status === 404) {
                errorMessage = '이미지가 DB에 존재하지 않습니다';
            } else if (apiResponse.status === 409) {
                errorMessage = '이미 대기 중인 요청이 있습니다';
            }

            throw new Error(errorMessage);
        }

        // 4. 성공 알림

        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: '✅ 화이트리스트 등록 요청',
            message: '요청이 성공적으로 등록되었습니다.\n검토 후 처리됩니다.'
        });

    } catch (error) {
        console.error('[Kas-Free] 화이트리스트 요청 실패:', error);

        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: '❌ 화이트리스트 등록 실패',
            message: `요청 실패: ${error.message}`
        });
    }
}
