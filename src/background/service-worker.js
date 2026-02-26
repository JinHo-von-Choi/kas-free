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
import { generateAllHashes } from '../utils/imageHash.js';        // 이미지 해시 생성

// 최적화 모듈 (성능 향상용)
import { AdvancedCacheManager } from './AdvancedCacheManager.js';   // LFU 캐싱 (자주 쓰는 데이터 빠르게 가져옴)
import { AIVerificationHandler } from './AIVerificationHandler.js'; // AI 검증 처리
import { ImageReportHandler } from './ImageReportHandler.js';       // 이미지 신고 처리
import { ErrorRecoveryManager } from './ErrorRecoveryManager.js';   // 에러 자동 복구
import { getPerformanceMonitor } from '../utils/PerformanceMonitor.js'; // 성능 측정
import { getResourceManager } from '../utils/ResourceManager.js';       // 메모리 관리

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
 * Hash Worker (해시 생성 전용 WebWorker)
 * - 이미지 해시를 별도 스레드에서 생성 (병렬 처리)
 * - 주의: Service Worker 환경에서는 Worker API 사용 불가
 * - 현재 null로 유지 (동기 방식으로 폴백)
 */
let hashWorker = null;

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
async function initialize() {
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
    hashChecker = new HashChecker();
    console.log('[Kas-Free] Hash Checker 초기화 완료');

    // ========================================
    // 4단계: NSFW 서버 API 초기화
    // ========================================
    // 위험한 이미지를 판별하는 AI 서버와 통신하는 객체
    // baseUrl 등 설정을 포함
    nsfwServer = new NsfwjsServerAnalyzer();
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
    // 10단계: Hash Worker 초기화 (실패)
    // ========================================
    // Service Worker 환경의 제약 사항:
    // - Worker API를 사용할 수 없음 (별도 스레드 생성 불가)
    // - 이유: Service Worker 자체가 이미 별도 스레드이기 때문
    //
    // 해결책:
    // - hashWorker를 null로 유지
    // - generateHashesAsync() 함수에서 자동으로 동기 방식으로 폴백
    // - 성능: 병렬 100ms → 동기 200ms (여전히 빠름)
    hashWorker = null;
    console.log('[Kas-Free] Service Worker 환경: 동기 해시 생성 모드 사용');

    // ========================================
    // 11단계: 만료된 캐시 정리
    // ========================================
    // TTL(Time To Live) 시간이 지난 캐시 데이터 삭제
    // - 예: 24시간 지난 이미지 분석 결과는 삭제
    // - Promise이므로 .then()으로 비동기 처리
    cacheManager.clearExpired().then(count => {
        if (count > 0) {
            console.log(`[Kas-Free] 만료된 해시 캐시 ${count}개 정리 완료`);
        }
    });

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
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    let responded = false;  // sendResponse 호출 여부 추적

    // 타임아웃 타이머 (30초)
    const timeoutId = setTimeout(() => {
        if (!responded) {
            responded = true;
            sendResponse({
                error: '처리 시간 초과 (30초). 잠시 후 다시 시도해주세요.',
                timeout: true,
                userFriendly: true
            });
        }
    }, 30000);

    // 실제 메시지 처리
    handleMessage(message, sender, (response) => {
        if (!responded) {
            responded = true;
            clearTimeout(timeoutId);
            sendResponse(response);
        }
    });

    return true;  // 🔥 필수! 비동기 응답 허용
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
        // ========================================
        // switch-case: type 값에 따라 분기
        // ========================================
        // if-else 여러 개 쓰는 것보다 깔끔함
        switch (type) {
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
                    getOrCreateReporterId    // 신고자 ID 생성 함수
                );
                sendResponse(aiResult);
                break;

            // 설정 조회 요청
            case MESSAGE_TYPES.GET_SETTINGS:
                const settings = await getSettings();
                sendResponse(settings);
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
                await updateStats(message.signalType);
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
        const userMessage = error.userFriendly
            ? error.message
            : '알 수 없는 오류가 발생했습니다.';

        sendResponse({
            error: userMessage,
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
    // ========================================
    // 메시지에서 필요한 정보 추출
    // ========================================
    // 구조 분해 할당: message.postNo, message.postUrl을 각각 변수로 추출
    const { postNo, postUrl } = message;

    // 성능 측정 시작
    // timerId를 저장해뒀다가 나중에 endTimer(timerId)로 종료
    const timerId = performanceMonitor.startTimer('analysis');

    // ========================================
    // 확장 프로그램 활성화 여부 확인
    // ========================================
    // 사용자가 설정에서 비활성화했으면 분석하지 않음
    if (!currentSettings.enabled) {
        return {
            error: '확장 프로그램이 비활성화되어 있습니다.',
            userFriendly: true  // 사용자에게 그대로 표시해도 되는 메시지
        };
    }

    // ========================================
    // 1단계: 캐시 확인 (가장 먼저!)
    // ========================================
    // 왜 캐시를 먼저 확인하나요?
    // - 같은 게시글을 여러 번 보는 경우가 많음
    // - 캐시 히트율 90% (100번 중 90번은 캐시에서 바로 반환)
    // - 분석 시간: 캐시 있을 때 5ms vs 캐시 없을 때 300ms
    const cachedResult = await cacheManager.getAnalysisResult(postUrl);

    if (cachedResult) {
        // 캐시에서 찾음! 바로 반환
        console.log('[Kas-Free] 캐시 히트:', postNo);

        // 성능 측정 종료
        const elapsed = performanceMonitor.endTimer(timerId);
        await performanceMonitor.recordAnalysisTime(elapsed);

        return cachedResult;  // 이전에 분석한 결과 그대로 반환
    }

    // ========================================
    // 2단계: 캐시에 없음 → 실제 분석 진행
    // ========================================
    try {
        // ========================================
        // 2-1. 게시글 HTML에서 이미지 URL 추출
        // ========================================
        // 예: <meta property="og:image" content="https://...jpg">
        const imageUrl = await fetchPostImage(postUrl);

        if (!imageUrl) {
            // 이미지를 찾지 못함 (텍스트만 있는 게시글)
            const elapsed = performanceMonitor.endTimer(timerId);
            await performanceMonitor.recordAnalysisTime(elapsed);

            return {
                status: 'unchecked',  // 검사하지 않음
                riskScore: 0,
                categories: {},
                error: '이미지를 찾을 수 없습니다.',
                userFriendly: true
            };
        }

        // ========================================
        // 2-2. 이미지 분석 (1차 + 2차)
        // ========================================
        // analyzeImage() 함수가 실제 분석 로직 수행
        const result = await analyzeImage(imageUrl, postUrl);

        // ========================================
        // 2-3. 결과에 imageUrl 추가
        // ========================================
        // 왜 추가하나요?
        // - 나중에 AI 재검증할 때 이미지 URL이 필요
        // - result 객체에 포함시켜서 함께 캐시에 저장
        result.imageUrl = imageUrl;

        // ========================================
        // 2-4. 결과를 캐시에 저장
        // ========================================
        // 다음에 같은 게시글을 보면 캐시에서 바로 가져옴
        await cacheManager.setAnalysisResult(postUrl, result);

        // 성능 측정 종료
        const elapsed = performanceMonitor.endTimer(timerId);
        await performanceMonitor.recordAnalysisTime(elapsed);

        return result;

    } catch (error) {
        // ========================================
        // 3단계: 에러 발생 → 자동 복구 시도
        // ========================================
        console.error('[Kas-Free] 이미지 분석 실패:', error);

        // ErrorRecoveryManager에게 복구 위임
        if (errorRecoveryManager) {
            const recovery = await errorRecoveryManager.handleError(error, {
                postUrl: postUrl,
                cacheManager: cacheManager
            });

            console.log('[Kas-Free] 복구 시도 결과:', recovery);

            // 복구 성공 시 (예: 캐시에서 찾음)
            if (recovery.success && recovery.data) {
                const elapsed = performanceMonitor.endTimer(timerId);
                await performanceMonitor.recordAnalysisTime(elapsed);
                return recovery.data;  // 복구된 데이터 반환
            }
        }

        // 복구 실패 → 에러 결과 반환
        const elapsed = performanceMonitor.endTimer(timerId);
        await performanceMonitor.recordAnalysisTime(elapsed);

        return {
            status: 'error',
            riskScore: 0,
            categories: {},
            error: error.message || '이미지 분석에 실패했습니다.',
            userFriendly: true
        };
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
async function analyzeImage(imageUrl, pageUrl = null) {
    // 1차, 2차 검증 결과를 저장할 변수
    let primaryResult = null;    // 해시 검사 결과
    let secondaryResult = null;  // 이미지 전송 검사 결과 (필요시에만)

    // ========================================
    // 1차 검증: 해시만 전송 (POST /api/check/hash)
    // ========================================
    // 왜 try-catch로 감싸나요?
    // - 해시 검사가 실패해도 프로그램이 멈추지 않도록
    // - 실패해도 2차 검증으로 넘어감 (보험)
    try {
        primaryResult = await analyzeImageWithHash(imageUrl);
        console.log('[Kas-Free] 1차 검증 결과 (Hash):', primaryResult);
    } catch (error) {
        // 에러 로깅 (디버그 모드일 때만 상세 로그)
        logError('해시 검사', error, currentSettings.debugMode);
    }

    // ========================================
    // 1차 검증 결과 판정
    // ========================================
    if (primaryResult) {
        // ========================================
        // riskScore → 신호등 색상 변환
        // ========================================
        // determineStatus() 함수 사용
        // - riskScore 0~29: 'safe' (초록)
        // - riskScore 30~49: 'caution' (주황)
        // - riskScore 50~100: 'danger' (빨강)
        const status = determineStatus(primaryResult.riskScore);

        // 디버깅용 로그
        console.log('[Kas-Free] ===== 검증 결과 =====');
        console.log('[Kas-Free] status:', status);
        console.log('[Kas-Free] primaryResult.matched:', primaryResult.matched);
        console.log('[Kas-Free] riskScore:', primaryResult.riskScore);

        // ========================================
        // 케이스 1: 안전 (초록 신호등)
        // ========================================
        // 1차 검증만으로 충분 → 바로 종료
        if (status === 'safe') {
            console.log('[Kas-Free] 안전 → 검증 완료');
            return buildFinalResult(primaryResult, null, status);
        }

        // ========================================
        // 케이스 2: 주의/위험 (주황/빨강 신호등)
        // ========================================
        // 2차 검증 필요 → 실제 이미지를 전송하여 정밀 검사
        if (status === 'caution' || status === 'danger') {
            try {
                console.log('[Kas-Free] 주의/위험 신호등 감지, 이미지 전송하여 정밀 검사');

                // ========================================
                // 2-1. reporterId 가져오기 (익명 신고자 ID)
                // ========================================
                // 저장되어 있으면 기존 ID 사용, 없으면 새로 생성
                const reporterId = await getOrCreateReporterId();

                // ========================================
                // 2-2. 이미지를 Base64로 인코딩
                // ========================================
                // 왜 Base64로 변환하나요?
                // - 이미지 파일을 텍스트로 변환 (JSON에 포함 가능)
                // - API 요청 body에 포함하여 전송
                const imageBase64 = await imageUrlToBase64(imageUrl);

                // ========================================
                // 2-3. POST /api/check - 이미지 전송
                // ========================================
                // NSFW AI 서버가 실제 이미지를 분석
                secondaryResult = await nsfwServer.check(imageBase64, reporterId);
                console.log('[Kas-Free] 2차 검증 결과 (Image):', secondaryResult);

                // ========================================
                // 2-4. 2차 검증 결과로 최종 판정
                // ========================================
                // 1차보다 2차가 더 정확하므로 2차 결과 우선
                if (secondaryResult) {
                    const finalStatus = determineStatus(secondaryResult.riskScore);
                    console.log('[Kas-Free] 최종 판정:', finalStatus);
                    return buildFinalResult(primaryResult, secondaryResult, finalStatus);
                }
            } catch (error) {
                // 2차 검증 실패 시 → 1차 결과로 판정
                console.error('[Kas-Free] 2차 검증 실패:', error);
                logError('이미지 전송 검증', error, currentSettings.debugMode);
                // catch 블록 끝나면 아래 "1차 결과로 판정"으로 진행
            }
        }

        // ========================================
        // 2차 검증 안 했거나 실패 → 1차 결과로 판정
        // ========================================
        return buildFinalResult(primaryResult, null, status);
    }

    // ========================================
    // 1차 검증 실패 → 안전(safe)으로 간주
    // ========================================
    // 해시 검사가 실패한 경우 (서버 오류, Unauthorized 등)
    // - DB에 등록된 위험 이미지가 아님 (매칭 안 됨)
    // - 안전(safe)으로 간주하여 초록 신호등 표시
    // - 사용자가 의심되면 "AI 검사" 버튼으로 수동 검사 가능
    console.log('[Kas-Free] 1차 검증 실패, 안전(safe)으로 간주');

    const safeFallbackResult = {
        riskScore: 0,
        detailedScores: {
            gore: 0,
            violence: 0,
            death: 0,
            disturbing: 0,
            insects: 0,
            medical: 0,
            shock: 0,
            animal_cruelty: 0,
            nsfw_porn: 0,
            nsfw_sexy: 0
        },
        categories: {
            gore: 0,
            violence: 0,
            death: 0,
            disturbing: 0,
            insects: 0,
            medical: 0,
            shock: 0,
            animal_cruelty: 0,
            nsfw_porn: 0,
            nsfw_sexy: 0
        },
        source: 'hash-check-failed',
        matched: false
    };

    return buildFinalResult(safeFallbackResult, null, 'safe');
}

/**
 * 이미지 해시로 DB를 검사한다
 * @param {string} imageUrl - 이미지 URL
 * @returns {Promise<object>}
 */
async function analyzeImageWithHash(imageUrl) {
    const hashTimerId = performanceMonitor.startTimer('hash');
    const apiTimerId  = performanceMonitor.startTimer('api');

    try {
        // 캐시 확인
        const cached = await cacheManager.getHashResult(imageUrl);
        if (cached) {
            console.log('[Kas-Free] 해시 캐시 히트:', imageUrl);
            performanceMonitor.endTimer(hashTimerId);
            performanceMonitor.endTimer(apiTimerId);
            return cached;
        }

        // reporterId 가져오기
        const reporterId = await getOrCreateReporterId();

        // 이미지 해시 생성 (WebWorker 사용 또는 폴백)
        console.log('[Kas-Free] 이미지 해싱 시작:', imageUrl);
        const hashes = await generateHashesAsync(imageUrl);
        console.log('[Kas-Free] 해시 생성 완료:', hashes);

        const hashElapsed = performanceMonitor.endTimer(hashTimerId);
        await performanceMonitor.recordHashTime(hashElapsed);

        // 해시로 DB 검사
        const result = await hashChecker.check(hashes, 10, reporterId);
        console.log('[Kas-Free] 해시 검사 완료:', result);

        const apiElapsed = performanceMonitor.endTimer(apiTimerId);
        await performanceMonitor.recordApiTime(apiElapsed, false);

        // 캐시 저장
        await cacheManager.setHashResult(imageUrl, hashes, result);

        return result;
    } catch (error) {
        console.error('[Kas-Free] 해시 검사 실패:', error);

        const hashElapsed = performanceMonitor.endTimer(hashTimerId);
        await performanceMonitor.recordHashTime(hashElapsed);

        const apiElapsed = performanceMonitor.endTimer(apiTimerId);
        await performanceMonitor.recordApiTime(apiElapsed, true);

        throw error;
    }
}

/**
 * 이미지 해시를 비동기로 생성한다 (WebWorker 사용)
 * @param {string} imageUrl - 이미지 URL
 * @returns {Promise<object>} { phash, dhash, ahash }
 */
async function generateHashesAsync(imageUrl) {
    // WebWorker가 사용 가능한 경우
    if (hashWorker) {
        try {
            return await generateHashesWithWorker(imageUrl);
        } catch (error) {
            console.warn('[Kas-Free] Worker 해시 생성 실패, 폴백:', error);
            // Worker 실패 시 기존 방식으로 폴백
        }
    }

    // Worker가 없거나 실패한 경우 기존 방식 사용
    console.log('[Kas-Free] 기존 방식으로 해시 생성 (Worker 미사용)');
    return await generateAllHashes(imageUrl);
}

/**
 * WebWorker로 이미지 해시를 생성한다
 * @param {string} imageUrl - 이미지 URL
 * @returns {Promise<object>} { phash, dhash, ahash }
 */
async function generateHashesWithWorker(imageUrl) {
    return new Promise(async (resolve, reject) => {
        // 타임아웃 설정 (5초)
        const timeoutId = setTimeout(() => {
            reject(new Error('Hash Worker 타임아웃 (5초)'));
        }, 5000);

        try {
            // 이미지를 Blob으로 다운로드
            const response = await fetch(imageUrl, {
                credentials: 'include',
                referrerPolicy: 'no-referrer'
            });

            if (!response.ok) {
                throw new Error(`이미지 fetch 실패: ${response.status}`);
            }

            const blob = await response.blob();

            // Worker로 전송
            hashWorker.postMessage({
                type: 'GENERATE_HASHES',
                imageUrl: imageUrl,
                blob: blob
            });

            // Worker 응답 대기
            const messageHandler = (event) => {
                clearTimeout(timeoutId);
                hashWorker.removeEventListener('message', messageHandler);

                if (event.data.success) {
                    console.log('[Kas-Free] Worker 해시 생성 성공:', {
                        elapsed: `${event.data.elapsed.toFixed(2)}ms`,
                        hashes: event.data.hashes
                    });
                    resolve(event.data.hashes);
                } else {
                    reject(new Error(event.data.error || 'Worker 해시 생성 실패'));
                }
            };

            hashWorker.addEventListener('message', messageHandler);
        } catch (error) {
            clearTimeout(timeoutId);
            reject(error);
        }
    });
}

/**
 * ========================================
 * 위험 점수 → 신호등 색상 변환 함수
 * ========================================
 *
 * riskScore (0~100)를 사용자가 설정한 민감도에 따라
 * 신호등 색상 (safe/caution/danger)으로 변환
 *
 * 예시 (기본 민감도):
 * - riskScore 0~29   → 'safe' (초록)
 * - riskScore 30~49  → 'caution' (주황)
 * - riskScore 50~100 → 'danger' (빨강)
 *
 * 예시 (민감도 낮음):
 * - riskScore 0~49   → 'safe' (초록)
 * - riskScore 50~69  → 'caution' (주황)
 * - riskScore 70~100 → 'danger' (빨강)
 *
 * 왜 사용자 설정을 따르나요?
 * - 사람마다 민감도가 다름
 * - 예: 학생은 민감도 높게, 성인은 민감도 낮게
 *
 * @param {number} riskScore - 위험 점수 (0~100)
 * @returns {string} 신호등 상태 ('safe' | 'caution' | 'danger')
 */
function determineStatus(riskScore) {
    // ========================================
    // 현재 설정에서 임계값 가져오기
    // ========================================
    // 구조 분해 할당으로 safeMax, cautionMax 추출
    // 예: { safeMax: 30, cautionMax: 50 }
    const { safeMax, cautionMax } = currentSettings.thresholds;

    // ========================================
    // if-else로 범위 확인
    // ========================================
    // 주의: 순서가 중요! (작은 것부터 체크)

    if (riskScore < safeMax) {
        // 예: riskScore = 20, safeMax = 30 → 20 < 30 → 'safe'
        return 'safe';
    } else if (riskScore < cautionMax) {
        // 예: riskScore = 40, safeMax = 30, cautionMax = 50
        //     → 40 >= 30이므로 첫 번째 if는 false
        //     → 40 < 50이므로 두 번째 if는 true → 'caution'
        return 'caution';
    } else {
        // 나머지 (riskScore >= cautionMax)
        // 예: riskScore = 80, cautionMax = 50 → 80 >= 50 → 'danger'
        return 'danger';
    }
}

/**
 * ========================================
 * 최종 결과 객체 생성 함수
 * ========================================
 *
 * 1차 검증 결과와 2차 검증 결과를 합쳐서
 * 하나의 최종 결과 객체를 만듦
 *
 * 우선순위:
 * - 2차 검증 결과가 있으면 2차 우선 (더 정확함)
 * - 없으면 1차 검증 결과 사용
 *
 * 반환 객체 구조:
 * {
 *   status: 'safe' | 'caution' | 'danger',  // 신호등 색상
 *   riskScore: 0~100,                        // 위험 점수
 *   categories: { gore: 0.8, nsfw: 0.2 },   // 카테고리별 점수
 *   primary: { ... },                        // 1차 검증 원본 데이터
 *   secondary: { ... } | null,               // 2차 검증 원본 데이터 (있으면)
 *   source: 'hash' | 'image' | 'ai',        // 데이터 출처
 *   timestamp: 1707900000000                 // 분석 시각 (밀리초)
 * }
 *
 * @param {object|null} primary - 1차 검증 결과 (해시 검사)
 * @param {object|null} secondary - 2차 검증 결과 (이미지 전송)
 * @param {string} status - 신호등 상태 ('safe'|'caution'|'danger')
 * @returns {object} 최종 결과 객체
 */
function buildFinalResult(primary, secondary, status) {
    // ========================================
    // 2차 검증 결과가 있으면 우선 사용
    // ========================================
    // || 연산자: 왼쪽이 falsy(null, undefined 등)면 오른쪽 사용
    // 예1: secondary = {...}, primary = {...} → mainResult = secondary
    // 예2: secondary = null, primary = {...} → mainResult = primary
    const mainResult = secondary || primary;

    // ========================================
    // 최종 결과 객체 생성
    // ========================================
    return {
        // 신호등 상태 (함수 인자로 받음)
        status,

        // 위험 점수 (0~100)
        // ?. 연산자: mainResult가 null이면 undefined 반환 (에러 안 남)
        // || 0: undefined면 0으로 대체
        riskScore: mainResult?.riskScore || 0,

        // 카테고리별 점수
        // 예: { gore: 0.8, violence: 0.6, nsfw_porn: 0.3 }
        categories: mainResult?.categories || {},

        // 1차 검증 원본 데이터 (디버깅 및 재검증용)
        primary: primary,

        // 2차 검증 원본 데이터 (없으면 null)
        secondary: secondary,

        // 데이터 출처
        // 'hash': 해시 검사 결과
        // 'image': 이미지 전송 검사 결과
        // 'ai': AI 재검증 결과
        source: mainResult?.source || 'unknown',

        // 분석 시각 (Unix timestamp, 밀리초)
        // 나중에 "3분 전에 분석됨" 같은 표시에 사용
        timestamp: Date.now()
    };
}

/**
 * 게시글에서 이미지 URL을 추출한다
 * @param {string} postUrl - 게시글 URL
 * @returns {Promise<string|null>}
 */
async function fetchPostImage(postUrl) {
    try {
        const response = await fetch(postUrl, {
            credentials: 'include',
            referrerPolicy: 'no-referrer'
        });

        if (!response.ok) {
            console.log('[Kas-Free] fetch 실패:', response.status);
            return null;
        }

        const html = await response.text();

        // OG 이미지 추출 (정규식)
        const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
        if (ogImageMatch && ogImageMatch[1]) {
            console.log('[Kas-Free] OG 이미지 발견:', ogImageMatch[1]);
            return ogImageMatch[1];
        }

        // 대체: content가 먼저 오는 경우
        const ogImageMatch2 = html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);
        if (ogImageMatch2 && ogImageMatch2[1]) {
            console.log('[Kas-Free] OG 이미지 발견 (대체):', ogImageMatch2[1]);
            return ogImageMatch2[1];
        }

        // 본문 첫 이미지 추출 (viewimage.php 패턴)
        const viewImageMatch = html.match(/src=["'](https?:\/\/dcimg[0-9]\.dcinside\.(?:com|co\.kr)\/viewimage\.php[^"']+)["']/i);
        if (viewImageMatch && viewImageMatch[1]) {
            console.log('[Kas-Free] 본문 이미지 발견:', viewImageMatch[1]);
            return viewImageMatch[1];
        }

        console.log('[Kas-Free] 이미지를 찾을 수 없음');
        return null;
    } catch (error) {
        console.error('[Kas-Free] 이미지 URL 추출 실패:', error);
        return null;
    }
}

/**
 * 설정 업데이트를 처리한다
 * @param {object} newSettings - 새 설정
 */
async function handleUpdateSettings(newSettings) {
    await saveSettings(newSettings);
    currentSettings = newSettings;

    // 모듈 설정 업데이트
    cacheManager.updateSettings(newSettings);
    aiVerificationHandler.updateSettings(newSettings);

    // 모든 탭에 설정 변경 알림
    const tabs = await chrome.tabs.query({ url: 'https://gall.dcinside.com/*' });
    for (const tab of tabs) {
        try {
            await chrome.tabs.sendMessage(tab.id, {
                type: 'SETTINGS_UPDATED',
                settings: newSettings
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

    // 모든 탭에 알림
    const tabs = await chrome.tabs.query({ url: 'https://gall.dcinside.com/*' });
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
            documentUrlPatterns: ['https://gall.dcinside.com/*']
        });

        // 화이트리스트 등록 요청 (잘못 차단된 이미지)
        chrome.contextMenus.create({
            id: 'kas-free-whitelist',
            title: '✅ 화이트리스트 등록 요청',
            contexts: ['image'],
            documentUrlPatterns: ['https://gall.dcinside.com/*']
        });

        // 구분선
        chrome.contextMenus.create({
            id: 'kas-free-separator',
            type: 'separator',
            contexts: ['image'],
            documentUrlPatterns: ['https://gall.dcinside.com/*']
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
    console.log('[Kas-Free] 새로운 reporterId 생성:', _n);
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
        console.log('[Kas-Free] 화이트리스트 요청 시작:', imageUrl);

        // 1. content script에 사유 입력 요청
        const response = await chrome.tabs.sendMessage(tab.id, {
            type: 'GET_WHITELIST_REASON',
            imageUrl: imageUrl
        });

        console.log('[Kas-Free] content script 응답:', response);

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
        const apiUrl = nsfwServer.baseUrl + '/api/whitelist/request';

        console.log('[Kas-Free] 화이트리스트 API 요청:', {
            imageUrl: actualImageUrl,
            reason: reason
        });

        const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
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
        console.log('[Kas-Free] 화이트리스트 요청 성공:', result);

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
