# 카-스 프리 개선 플랜

**작성자**: 최진호
**작성일**: 2026-02-26
**버전**: 1.0
**프로젝트 버전**: 1.1.3
**코드 품질 점수**: 8.5/10 → 목표 9.5/10

---

## 목차

1. [개요](#1-개요)
2. [Phase 1: 보안 및 안정성](#phase-1-보안-및-안정성-1-2주)
3. [Phase 2: 성능 최적화](#phase-2-성능-최적화-1-2주)
4. [Phase 3: 코드 품질 개선](#phase-3-코드-품질-개선-2-3주)
5. [Phase 4: Chrome Extension 최적화](#phase-4-chrome-extension-최적화-1주)
6. [검증 및 테스트 계획](#검증-및-테스트-계획)
7. [리스크 관리](#리스크-관리)
8. [마일스톤 및 일정](#마일스톤-및-일정)

---

## 1. 개요

### 1.1 목표

현재 코드 품질 **8.5/10**을 **9.5/10**으로 향상시키며, 보안, 성능, 안정성을 강화합니다.

### 1.2 핵심 개선 영역

| 영역 | 현재 점수 | 목표 점수 | 주요 작업 |
|------|---------|---------|---------|
| 보안 | 8.0 | 9.5 | 입력 검증, 민감정보 보호 |
| 성능 | 9.0 | 9.5 | 메모리 최적화, 배치 처리 |
| 테스트 | 7.0 | 9.0 | 커버리지 90%, E2E 강화 |
| 유지보수성 | 8.5 | 9.5 | TypeScript, 모듈 분리 |

### 1.3 전체 일정

```
Phase 1: 보안 및 안정성    [▓▓▓▓░░░░░░] 2주 (2026-02-26 ~ 03-11)
Phase 2: 성능 최적화      [░░░░▓▓▓▓░░] 2주 (2026-03-12 ~ 03-25)
Phase 3: 코드 품질 개선    [░░░░░░░░▓▓▓▓] 3주 (2026-03-26 ~ 04-15)
Phase 4: Extension 최적화 [░░░░░░░░░░▓] 1주 (2026-04-16 ~ 04-22)
```

**총 예상 기간**: 8주 (2개월)

---

## Phase 1: 보안 및 안정성 (1-2주)

**목표**: Critical 이슈 모두 해결, 보안 점수 8.0 → 9.5
**기간**: 2026-02-26 ~ 2026-03-11 (2주)
**담당자**: 최진호

---

### 📋 Task 1.1: 설정값 범위 검증 추가

**우선순위**: 🔴 Critical
**예상 시간**: 2시간
**파일**: `src/utils/storage.js`

#### 현재 문제

```javascript
// src/utils/storage.js
export async function saveSettings(settings) {
    await chrome.storage.local.set({ settings });
    // ❌ 범위 검증 없음: safeMax = -100 가능
}
```

**위험성**:
- 사용자가 `safeMax: -100` 입력 시 모든 이미지가 위험으로 판정
- 메모리 오버플로우 가능성

#### 해결책

```javascript
// src/utils/settingsValidator.js (신규 파일)
/**
 * 설정값 범위 검증
 * @param {object} settings - 원본 설정
 * @returns {object} 검증된 설정
 */
export function validateSettings(settings) {
    const validated = { ...settings };

    // 1. 임계값 범위 검증 (0-100)
    validated.thresholds = {
        safeMax: clamp(settings.thresholds?.safeMax ?? 30, 0, 100),
        cautionMax: clamp(settings.thresholds?.cautionMax ?? 60, 0, 100)
    };

    // safeMax < cautionMax 보장
    if (validated.thresholds.safeMax >= validated.thresholds.cautionMax) {
        validated.thresholds.cautionMax = validated.thresholds.safeMax + 10;
    }

    // 2. 민감도 범위 검증 (0-100)
    const defaultSensitivity = {
        nsfw: 50,
        gore: 70,
        violence: 60
    };

    validated.sensitivity = Object.entries(defaultSensitivity).reduce(
        (acc, [key, defaultValue]) => {
            const value = settings.sensitivity?.[key] ?? defaultValue;
            acc[key] = clamp(value, 0, 100);
            return acc;
        },
        {}
    );

    // 3. API 설정 검증
    validated.apis = {
        geminiFlash: validateApiConfig(settings.apis?.geminiFlash),
        claudeHaiku: validateApiConfig(settings.apis?.claudeHaiku),
        gpt4oMini: validateApiConfig(settings.apis?.gpt4oMini)
    };

    // 4. 기타 boolean/number 검증
    validated.enabled = Boolean(settings.enabled ?? true);
    validated.debugMode = Boolean(settings.debugMode ?? false);
    validated.autoReport = Boolean(settings.autoReport ?? false);

    return validated;
}

/**
 * 값을 min-max 범위로 제한
 */
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || min));
}

/**
 * API 설정 검증
 */
function validateApiConfig(config) {
    if (!config) return { enabled: false, apiKey: '', priority: 0 };

    return {
        enabled: Boolean(config.enabled),
        apiKey: String(config.apiKey || ''),
        priority: clamp(config.priority, 0, 100)
    };
}
```

#### 적용

```javascript
// src/utils/storage.js 수정
import { validateSettings } from './settingsValidator.js';

export async function saveSettings(settings) {
    const validated = validateSettings(settings);
    await chrome.storage.local.set({ settings: validated });
}

export async function updateSettings(updates) {
    const current = await getSettings();
    const merged = { ...current, ...updates };
    const validated = validateSettings(merged);
    await chrome.storage.local.set({ settings: validated });
}
```

#### 테스트

```javascript
// tests/unit/settingsValidator.test.js (신규)
describe('settingsValidator', () => {
    test('음수 임계값 거부', () => {
        const input = { thresholds: { safeMax: -100, cautionMax: 60 } };
        const result = validateSettings(input);
        expect(result.thresholds.safeMax).toBe(0);
    });

    test('100 초과 거부', () => {
        const input = { thresholds: { safeMax: 150, cautionMax: 200 } };
        const result = validateSettings(input);
        expect(result.thresholds.safeMax).toBe(100);
        expect(result.thresholds.cautionMax).toBe(100);
    });

    test('safeMax >= cautionMax 자동 조정', () => {
        const input = { thresholds: { safeMax: 70, cautionMax: 60 } };
        const result = validateSettings(input);
        expect(result.thresholds.cautionMax).toBe(80);
    });
});
```

#### 검증 기준

- [ ] 모든 임계값이 0-100 범위 내
- [ ] safeMax < cautionMax 보장
- [ ] 잘못된 입력 시 기본값으로 복구
- [ ] 단위 테스트 통과 (100%)

---

### 📋 Task 1.2: 에러 메시지 민감정보 제거

**우선순위**: 🟠 High
**예상 시간**: 3시간
**파일**: `src/utils/errorHandler.js`, `src/background/*.js`

#### 현재 문제

```javascript
// 위험: 프로덕션 로그에 민감정보 노출
console.error('API 호출 실패:', {
    url: imageUrl,           // 개인 게시글 URL
    apiKey: apiKey,          // API 키 전체 노출
    error: error.message     // 시스템 경로 노출 가능
});
```

#### 해결책

```javascript
// src/utils/errorHandler.js 확장
const IS_PRODUCTION = !chrome.runtime.getManifest().update_url?.includes('localhost');

/**
 * 민감정보 마스킹
 */
export function maskSensitiveData(data) {
    if (typeof data === 'string') {
        // URL 마스킹
        if (data.startsWith('http')) {
            const url = new URL(data);
            return `${url.origin}/***${url.pathname.slice(-8)}`;
        }
        // API 키 마스킹
        if (data.length > 10) {
            return `${data.slice(0, 4)}***${data.slice(-4)}`;
        }
    }
    return '***';
}

/**
 * 프로덕션 안전 에러 로깅
 */
export function logError(context, error, debugMode = false) {
    const sanitized = {
        context,
        code: error.code || 'UNKNOWN_ERROR',
        message: IS_PRODUCTION ? '오류가 발생했습니다.' : error.message,
        timestamp: new Date().toISOString()
    };

    if (debugMode && !IS_PRODUCTION) {
        console.error('[Kas-Free ERROR]', {
            ...sanitized,
            stack: error.stack,
            details: error.details
        });
    } else {
        console.error('[Kas-Free]', sanitized);
    }

    // 선택: 에러 추적 서비스에 전송
    // sendToErrorTracking(sanitized);
}

/**
 * 사용자 친화적 에러 메시지 생성
 */
export function getUserFriendlyMessage(error) {
    const messages = {
        'NetworkError': '네트워크 연결을 확인해주세요.',
        'TimeoutError': '요청 시간이 초과되었습니다. 다시 시도해주세요.',
        'ApiKeyError': 'API 키를 확인해주세요.',
        'OutOfMemoryError': '메모리 부족. 브라우저를 재시작해주세요.',
        'IndexedDBError': '로컬 저장소 오류. 캐시를 삭제해보세요.'
    };

    return messages[error.code] || '알 수 없는 오류가 발생했습니다.';
}
```

#### 적용

```javascript
// src/background/service-worker.js 수정
import { logError, maskSensitiveData, getUserFriendlyMessage } from '../utils/errorHandler.js';

async function handleAnalyzeImage(message, sender) {
    try {
        const result = await analyzeImage(message.imageUrl);
        return { success: true, data: result };
    } catch (error) {
        logError('analyzeImage', error, settings.debugMode);

        return {
            success: false,
            error: getUserFriendlyMessage(error)
        };
    }
}
```

#### 테스트

```javascript
// tests/unit/errorHandler.test.js 확장
describe('maskSensitiveData', () => {
    test('URL 마스킹', () => {
        const url = 'https://gall.dcinside.com/board/view?id=12345678';
        const masked = maskSensitiveData(url);
        expect(masked).toBe('https://gall.dcinside.com/***view?id=12345678');
    });

    test('API 키 마스킹', () => {
        const key = 'sk-proj-abcdefghijklmnopqrstuvwxyz';
        const masked = maskSensitiveData(key);
        expect(masked).toBe('sk-p***wxyz');
    });
});
```

#### 검증 기준

- [ ] 프로덕션 로그에 개인정보 없음
- [ ] API 키는 앞4자+뒤4자만 노출
- [ ] 사용자에게 친화적 에러 메시지 표시
- [ ] 디버그 모드에서만 상세 로그

---

### 📋 Task 1.3: 타임아웃 경합 조건 수정

**우선순위**: 🟠 High
**예상 시간**: 4시간
**파일**: `src/background/ApiClient.js`

#### 현재 문제

```javascript
// 경합 조건: fetch 완료와 동시에 abort() 호출 가능
async fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId); // ⚠️ 이미 abort된 상태일 수 있음
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new TimeoutError(`Timeout after ${timeout}ms`);
        }
        throw error;
    }
}
```

#### 해결책

```javascript
// src/background/ApiClient.js 수정
/**
 * 타임아웃이 있는 fetch (경합 조건 해결)
 */
async fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    let timedOut = false;

    const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });

        // 타임아웃 전에 완료된 경우
        clearTimeout(timeoutId);

        // 타임아웃 후 응답 도착 (경합 조건)
        if (timedOut) {
            throw new TimeoutError(`Request completed after timeout (${timeoutMs}ms)`);
        }

        return response;
    } catch (error) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError' || timedOut) {
            throw new TimeoutError(`Timeout after ${timeoutMs}ms`, {
                url: maskSensitiveData(url),
                timeout: timeoutMs
            });
        }

        throw error;
    }
}

/**
 * TimeoutError 클래스
 */
class TimeoutError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'TimeoutError';
        this.code = 'TIMEOUT';
        this.details = details;
        this.needsFallback = () => true;
    }
}
```

#### 추가: 타임아웃 재시도 로직 개선

```javascript
/**
 * 재시도 로직 (Exponential Backoff + Jitter)
 */
async fetchWithRetry(url, options = {}, maxRetries = 3) {
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // 동적 타임아웃 적용
            const timeout = this.adaptiveTimeoutManager.getTimeout(url);
            const response = await this.fetchWithTimeout(url, options, timeout);

            // 성공: 응답 시간 기록
            this.adaptiveTimeoutManager.recordSuccess(url, Date.now() - startTime);

            return response;
        } catch (error) {
            lastError = error;

            // 재시도 불가능한 에러
            if (!this.isRetryable(error)) {
                throw error;
            }

            // 마지막 시도
            if (attempt === maxRetries - 1) {
                throw error;
            }

            // 지연 (Exponential Backoff + Jitter)
            const delay = this.calculateDelay(attempt);
            await this.sleep(delay);

            logError(`재시도 ${attempt + 1}/${maxRetries}`, error, this.debugMode);
        }
    }

    throw lastError;
}

/**
 * 재시도 가능 여부 판단
 */
isRetryable(error) {
    const retryableCodes = ['TIMEOUT', 'NETWORK_ERROR', 'ECONNRESET'];
    return retryableCodes.includes(error.code);
}

/**
 * 지연 시간 계산 (Exponential Backoff + Jitter)
 */
calculateDelay(attempt) {
    const baseDelay = 1000; // 1초
    const exponential = Math.pow(2, attempt) * baseDelay;
    const jitter = Math.random() * 1000; // 0-1초 랜덤
    return Math.min(exponential + jitter, 10000); // 최대 10초
}
```

#### 테스트

```javascript
// tests/unit/ApiClient.test.js 추가
describe('fetchWithTimeout', () => {
    test('정상 응답', async () => {
        const response = await apiClient.fetchWithTimeout('https://api.test.com', {}, 5000);
        expect(response.ok).toBe(true);
    });

    test('타임아웃 발생', async () => {
        await expect(
            apiClient.fetchWithTimeout('https://slow-api.test.com', {}, 100)
        ).rejects.toThrow(TimeoutError);
    });

    test('경합 조건 처리', async () => {
        // fetch가 타임아웃 직전에 완료되는 경우
        const response = await apiClient.fetchWithTimeout('https://api.test.com', {}, 1000);
        expect(response.ok).toBe(true);
    });
});

describe('fetchWithRetry', () => {
    test('재시도 성공', async () => {
        let attempts = 0;
        jest.spyOn(apiClient, 'fetchWithTimeout').mockImplementation(() => {
            attempts++;
            if (attempts < 3) throw new TimeoutError('Timeout');
            return Promise.resolve({ ok: true });
        });

        const response = await apiClient.fetchWithRetry('https://api.test.com');
        expect(attempts).toBe(3);
        expect(response.ok).toBe(true);
    });
});
```

#### 검증 기준

- [ ] 타임아웃 경합 조건 해결
- [ ] 재시도 로직 정상 작동
- [ ] Exponential Backoff 검증
- [ ] 단위 테스트 통과

---

### 📋 Task 1.4: Promise 에러 처리 강화

**우선순위**: 🟠 High
**예상 시간**: 2시간
**파일**: `src/background/service-worker.js`

#### 현재 문제

```javascript
// Promise 거부 시 sendResponse 미호출 → Content Script 무한 대기
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender, sendResponse);
    return true; // 비동기 응답
});

async function handleMessage(message, sender, sendResponse) {
    const result = await analyzeImage(message);
    sendResponse(result); // ❌ 에러 시 미호출
}
```

#### 해결책

```javascript
// src/background/service-worker.js 수정
/**
 * 메시지 리스너 (에러 처리 보장)
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessageSafely(message, sender)
        .then(result => {
            sendResponse({ success: true, data: result });
        })
        .catch(error => {
            logError('messageHandler', error, settings?.debugMode);
            sendResponse({
                success: false,
                error: getUserFriendlyMessage(error),
                code: error.code
            });
        });

    return true; // 비동기 응답 유지
});

/**
 * 메시지 핸들러 (안전한 래퍼)
 */
async function handleMessageSafely(message, sender) {
    // 메시지 타입 검증
    if (!message || !message.type) {
        throw new ValidationError('Invalid message format');
    }

    // 타입별 처리
    switch (message.type) {
        case MESSAGE_TYPES.ANALYZE_IMAGE:
            return await handleAnalyzeImage(message, sender);

        case MESSAGE_TYPES.GET_SETTINGS:
            return await getSettings();

        case MESSAGE_TYPES.UPDATE_SETTINGS:
            return await updateSettings(message.updates);

        // ... 기타 케이스

        default:
            throw new ValidationError(`Unknown message type: ${message.type}`);
    }
}

/**
 * ValidationError 클래스
 */
class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
        this.code = 'VALIDATION_ERROR';
    }
}
```

#### Content Script 에러 처리

```javascript
// src/content/content.js 수정
/**
 * 메시지 전송 (타임아웃 보장)
 */
async function sendMessageWithTimeout(message, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error('Message response timeout'));
        }, timeoutMs);

        chrome.runtime.sendMessage(message, response => {
            clearTimeout(timeoutId);

            // Chrome API 에러
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            // 응답 검증
            if (!response) {
                reject(new Error('No response from background'));
                return;
            }

            // 에러 응답
            if (!response.success) {
                reject(new Error(response.error || 'Unknown error'));
                return;
            }

            resolve(response.data);
        });
    });
}

/**
 * 사용 예시
 */
async function analyzeImage(imageUrl) {
    try {
        const result = await sendMessageWithTimeout({
            type: MESSAGE_TYPES.ANALYZE_IMAGE,
            imageUrl
        });
        return result;
    } catch (error) {
        console.error('[Kas-Free] 분석 실패:', error.message);
        // UI에 에러 표시
        showErrorSignal(imageUrl, error.message);
        throw error;
    }
}
```

#### 테스트

```javascript
// tests/unit/messageHandler.test.js (신규)
describe('messageHandler', () => {
    test('정상 메시지 처리', async () => {
        const message = { type: 'ANALYZE_IMAGE', imageUrl: 'https://test.com/image.jpg' };
        const result = await handleMessageSafely(message, {});
        expect(result).toHaveProperty('riskScore');
    });

    test('잘못된 메시지 타입', async () => {
        const message = { type: 'INVALID_TYPE' };
        await expect(handleMessageSafely(message, {})).rejects.toThrow(ValidationError);
    });

    test('에러 시 sendResponse 호출', (done) => {
        const sendResponse = jest.fn();
        chrome.runtime.onMessage.addListener((msg, sender, respond) => {
            expect(respond).toHaveBeenCalled();
            expect(respond.mock.calls[0][0]).toHaveProperty('success', false);
            done();
        });

        chrome.runtime.sendMessage({ type: 'INVALID_TYPE' });
    });
});
```

#### 검증 기준

- [ ] 모든 Promise 에러 처리
- [ ] Content Script 타임아웃 없음
- [ ] 사용자에게 에러 메시지 표시
- [ ] 단위 테스트 통과

---

### 📋 Task 1.5: AI API 응답 검증

**우선순위**: 🟠 High
**예상 시간**: 3시간
**파일**: `src/background/AIVerificationHandler.js`, `src/analyzers/*.js`

#### 현재 문제

```javascript
// 악의적 서버가 잘못된 응답 반환 가능
const result = await this.apiClient.callGeminiFlash(apiKey, imageData);
// { is_harmful: 999, score: "not a number" } → 예측 불가능한 동작
```

#### 해결책

```javascript
// src/utils/apiResponseValidator.js (신규)
/**
 * AI API 응답 스키마
 */
const AI_RESPONSE_SCHEMA = {
    is_harmful: 'boolean',
    score: 'number',
    category: 'string',
    confidence: 'number',
    reasoning: 'string'
};

/**
 * AI API 응답 검증
 */
export function validateAIResponse(response, source = 'unknown') {
    // null/undefined 체크
    if (!response || typeof response !== 'object') {
        throw new ValidationError('Invalid response format', { source });
    }

    // 필수 필드 검증
    const required = ['is_harmful', 'score'];
    for (const field of required) {
        if (!(field in response)) {
            throw new ValidationError(`Missing required field: ${field}`, { source });
        }
    }

    // 타입 검증
    for (const [field, expectedType] of Object.entries(AI_RESPONSE_SCHEMA)) {
        if (field in response && typeof response[field] !== expectedType) {
            throw new ValidationError(
                `Invalid type for ${field}: expected ${expectedType}, got ${typeof response[field]}`,
                { source }
            );
        }
    }

    // 범위 검증
    const validated = {
        is_harmful: Boolean(response.is_harmful),
        score: clamp(Number(response.score) || 0, 0, 1),
        category: String(response.category || 'unknown'),
        confidence: clamp(Number(response.confidence) || 0, 0, 1),
        reasoning: String(response.reasoning || '').slice(0, 500), // 최대 500자
        source
    };

    // 논리 검증
    if (validated.is_harmful && validated.score < 0.5) {
        console.warn('[Kas-Free] 모순된 응답: is_harmful=true but score < 0.5');
        validated.score = 0.5; // 최소값 보장
    }

    return validated;
}

/**
 * 값 범위 제한
 */
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * ValidationError 클래스
 */
class ValidationError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'ValidationError';
        this.code = 'VALIDATION_ERROR';
        this.details = details;
    }
}
```

#### 적용

```javascript
// src/analyzers/geminiFlash.js 수정
import { validateAIResponse } from '../utils/apiResponseValidator.js';

export class GeminiFlashAnalyzer {
    async analyze(imageBase64) {
        try {
            const rawResponse = await this.apiClient.callGeminiFlash(
                this.apiKey,
                imageBase64
            );

            // 응답 검증
            const validated = validateAIResponse(rawResponse, 'GeminiFlash');

            return {
                riskScore: validated.score * 100,
                categories: {
                    [validated.category]: validated.score
                },
                isHarmful: validated.is_harmful,
                confidence: validated.confidence,
                reasoning: validated.reasoning,
                source: 'GeminiFlash',
                timestamp: Date.now()
            };
        } catch (error) {
            logError('GeminiFlashAnalyzer', error, this.debugMode);
            throw error;
        }
    }
}
```

#### 추가: 응답 시간 검증

```javascript
/**
 * API 응답 시간 검증 (너무 빠르면 의심)
 */
export function validateResponseTime(startTime, minTimeMs = 100) {
    const elapsed = Date.now() - startTime;

    if (elapsed < minTimeMs) {
        console.warn(`[Kas-Free] 의심스러운 응답 시간: ${elapsed}ms (최소 ${minTimeMs}ms)`);
        // 캐시된 응답이거나 Mock 서버일 가능성
    }

    return elapsed;
}
```

#### 테스트

```javascript
// tests/unit/apiResponseValidator.test.js (신규)
describe('validateAIResponse', () => {
    test('정상 응답', () => {
        const response = {
            is_harmful: true,
            score: 0.85,
            category: 'gore',
            confidence: 0.9
        };
        const validated = validateAIResponse(response, 'test');
        expect(validated.score).toBe(0.85);
    });

    test('범위 초과 값 클램핑', () => {
        const response = { is_harmful: true, score: 999 };
        const validated = validateAIResponse(response, 'test');
        expect(validated.score).toBe(1);
    });

    test('잘못된 타입', () => {
        const response = { is_harmful: 'yes', score: 'high' };
        expect(() => validateAIResponse(response, 'test')).toThrow(ValidationError);
    });

    test('필수 필드 누락', () => {
        const response = { is_harmful: true };
        expect(() => validateAIResponse(response, 'test')).toThrow(ValidationError);
    });

    test('모순된 응답 자동 수정', () => {
        const response = { is_harmful: true, score: 0.1 };
        const validated = validateAIResponse(response, 'test');
        expect(validated.score).toBeGreaterThanOrEqual(0.5);
    });
});
```

#### 검증 기준

- [ ] 모든 AI API 응답 검증
- [ ] 잘못된 응답 거부
- [ ] 범위 초과 값 클램핑
- [ ] 단위 테스트 통과 (100%)

---

### 📋 Task 1.6: 메모리 누수 방지 (Observer 정리)

**우선순위**: 🔴 Critical
**예상 시간**: 2시간
**파일**: `src/content/content.js`, `src/utils/ResourceManager.js`

#### 현재 문제

```javascript
// src/content/content.js
const observer = new MutationObserver(() => {
    analyzeNewPosts();
});

observer.observe(document.body, { childList: true, subtree: true });

// ❌ 페이지 언로드 시 observer 미정리 → 메모리 누수
```

#### 해결책

```javascript
// src/content/content.js 수정
/**
 * 리소스 정리 보장
 */
function initializeContentScript() {
    const resources = [];

    // MutationObserver 생성 및 등록
    const observer = new MutationObserver(() => {
        analyzeNewPosts();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    resources.push({ type: 'observer', instance: observer });

    // 이벤트 리스너 등록
    const clickHandler = (e) => handleSignalClick(e);
    document.addEventListener('click', clickHandler);
    resources.push({ type: 'listener', target: document, event: 'click', handler: clickHandler });

    // 정기 정리 타이머
    const cleanupInterval = setInterval(() => {
        cleanupUnusedSignals();
    }, 60000);
    resources.push({ type: 'timer', id: cleanupInterval });

    // 페이지 언로드 시 정리
    window.addEventListener('beforeunload', () => {
        cleanup(resources);
    });

    // 확장 비활성화 시 정리
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'DISABLE_EXTENSION') {
            cleanup(resources);
        }
    });
}

/**
 * 리소스 정리
 */
function cleanup(resources) {
    for (const resource of resources) {
        try {
            switch (resource.type) {
                case 'observer':
                    resource.instance.disconnect();
                    break;
                case 'listener':
                    resource.target.removeEventListener(resource.event, resource.handler);
                    break;
                case 'timer':
                    clearInterval(resource.id);
                    break;
                case 'worker':
                    resource.instance.terminate();
                    break;
            }
        } catch (error) {
            console.error('[Kas-Free] 리소스 정리 실패:', error);
        }
    }

    resources.length = 0; // 배열 비우기
    console.log('[Kas-Free] 모든 리소스 정리 완료');
}
```

#### ResourceManager 강화

```javascript
// src/utils/ResourceManager.js 확장
export class ResourceManager {
    constructor() {
        this.resources = new Map();
        this.autoCleanupEnabled = true;

        // 정기 정리 (5분마다)
        this.cleanupInterval = setInterval(() => {
            if (this.autoCleanupEnabled) {
                this.cleanupUnusedResources();
            }
        }, 5 * 60 * 1000);
    }

    /**
     * 리소스 등록 (메타데이터 포함)
     */
    register(name, resource, metadata = {}) {
        this.resources.set(name, {
            resource,
            type: metadata.type || 'unknown',
            createdAt: Date.now(),
            lastUsed: Date.now(),
            usageCount: 0
        });
    }

    /**
     * 리소스 사용 기록
     */
    markUsed(name) {
        const entry = this.resources.get(name);
        if (entry) {
            entry.lastUsed = Date.now();
            entry.usageCount++;
        }
    }

    /**
     * 미사용 리소스 정리
     */
    cleanupUnusedResources() {
        const now = Date.now();
        const UNUSED_THRESHOLD = 10 * 60 * 1000; // 10분

        for (const [name, entry] of this.resources.entries()) {
            const timeSinceLastUse = now - entry.lastUsed;

            if (timeSinceLastUse > UNUSED_THRESHOLD && entry.usageCount === 0) {
                console.log(`[ResourceManager] 미사용 리소스 정리: ${name}`);
                this.release(name);
            }
        }
    }

    /**
     * 리소스 해제
     */
    release(name) {
        const entry = this.resources.get(name);
        if (!entry) return;

        try {
            const { resource, type } = entry;

            switch (type) {
                case 'observer':
                    resource.disconnect();
                    break;
                case 'listener':
                    resource.target.removeEventListener(resource.event, resource.handler);
                    break;
                case 'timer':
                    clearInterval(resource);
                    break;
                case 'timeout':
                    clearTimeout(resource);
                    break;
                case 'worker':
                    resource.terminate();
                    break;
                case 'controller':
                    resource.abort();
                    break;
            }

            this.resources.delete(name);
        } catch (error) {
            console.error(`[ResourceManager] 해제 실패: ${name}`, error);
        }
    }

    /**
     * 모든 리소스 해제
     */
    releaseAll() {
        for (const name of this.resources.keys()) {
            this.release(name);
        }

        clearInterval(this.cleanupInterval);
    }

    /**
     * 메모리 사용량 보고
     */
    getMemoryUsage() {
        return {
            totalResources: this.resources.size,
            byType: Array.from(this.resources.values()).reduce((acc, entry) => {
                acc[entry.type] = (acc[entry.type] || 0) + 1;
                return acc;
            }, {})
        };
    }
}

// 전역 인스턴스
export const resourceManager = new ResourceManager();
```

#### 테스트

```javascript
// tests/unit/ResourceManager.test.js 추가
describe('ResourceManager', () => {
    test('리소스 등록 및 해제', () => {
        const manager = new ResourceManager();
        const observer = new MutationObserver(() => {});

        manager.register('testObserver', observer, { type: 'observer' });
        expect(manager.resources.size).toBe(1);

        manager.release('testObserver');
        expect(manager.resources.size).toBe(0);
    });

    test('미사용 리소스 자동 정리', async () => {
        const manager = new ResourceManager();
        const observer = new MutationObserver(() => {});

        manager.register('unused', observer, { type: 'observer' });

        // 11분 경과 시뮬레이션
        const entry = manager.resources.get('unused');
        entry.lastUsed = Date.now() - 11 * 60 * 1000;

        manager.cleanupUnusedResources();
        expect(manager.resources.size).toBe(0);
    });
});
```

#### 검증 기준

- [ ] 모든 Observer 정리 보장
- [ ] 페이지 언로드 시 리소스 해제
- [ ] 24시간 메모리 150MB → 100MB
- [ ] 단위 테스트 통과

---

## Phase 2: 성능 최적화 (1-2주)

**목표**: 응답 시간 21초 → 15초, 메모리 150MB → 100MB
**기간**: 2026-03-12 ~ 2026-03-25 (2주)

---

### 📋 Task 2.1: 캐시 크기 제한

**우선순위**: 🟠 High
**예상 시간**: 3시간
**파일**: `src/background/AdvancedCacheManager.js`

#### 현재 문제

```javascript
// 캐시 크기 제한 없음 → 디스크 용량 소비
async setAnalysisResult(postUrl, result) {
    await super.setAnalysisResult(postUrl, result);
    // ❌ 무제한 증가 가능
}
```

#### 해결책

```javascript
// src/background/AdvancedCacheManager.js 수정
export class AdvancedCacheManager extends CacheManager {
    constructor() {
        super();

        // 캐시 크기 제한
        this.maxCacheSize = 5 * 1024 * 1024; // 5MB
        this.maxEntries = 1000; // 최대 1000개
        this.currentSize = 0;

        // 크기 측정
        this.calculateCurrentSize();
    }

    /**
     * 현재 캐시 크기 계산
     */
    async calculateCurrentSize() {
        let totalSize = 0;

        for (const [key, value] of this.cache.entries()) {
            const size = this.getEntrySize(key, value);
            totalSize += size;
        }

        this.currentSize = totalSize;
    }

    /**
     * 엔트리 크기 계산 (바이트)
     */
    getEntrySize(key, value) {
        const json = JSON.stringify({ key, value });
        return new Blob([json]).size;
    }

    /**
     * 캐시 설정 (크기 제한 적용)
     */
    async setAnalysisResult(postUrl, result) {
        const entrySize = this.getEntrySize(postUrl, result);

        // 크기 초과 시 정리
        while (this.currentSize + entrySize > this.maxCacheSize ||
               this.cache.size >= this.maxEntries) {
            await this.evictOne();
        }

        await super.setAnalysisResult(postUrl, result);
        this.currentSize += entrySize;
    }

    /**
     * 하나의 엔트리 제거 (LFU 점수 기반)
     */
    async evictOne() {
        if (this.cache.size === 0) return;

        // LFU 점수 계산
        const scores = Array.from(this.cache.entries()).map(([key, value]) => ({
            key,
            score: this.calculateScore(value)
        }));

        // 점수 낮은 것 제거
        scores.sort((a, b) => a.score - b.score);
        const toRemove = scores[0].key;

        const entry = this.cache.get(toRemove);
        const size = this.getEntrySize(toRemove, entry);

        this.cache.delete(toRemove);
        this.currentSize -= size;
    }

    /**
     * 캐시 통계
     */
    getStats() {
        return {
            ...super.getStats(),
            currentSize: this.currentSize,
            maxSize: this.maxCacheSize,
            utilization: (this.currentSize / this.maxCacheSize * 100).toFixed(1) + '%',
            entries: this.cache.size,
            maxEntries: this.maxEntries
        };
    }
}
```

#### 테스트

```javascript
// tests/unit/AdvancedCacheManager.test.js 추가
describe('Cache Size Limit', () => {
    test('크기 초과 시 자동 정리', async () => {
        const cache = new AdvancedCacheManager();
        cache.maxCacheSize = 1024; // 1KB로 제한

        // 큰 데이터 여러 개 추가
        for (let i = 0; i < 100; i++) {
            await cache.setAnalysisResult(`url${i}`, {
                data: 'x'.repeat(100) // 100바이트
            });
        }

        // 크기 제한 확인
        expect(cache.currentSize).toBeLessThanOrEqual(cache.maxCacheSize);
    });

    test('최대 엔트리 수 제한', async () => {
        const cache = new AdvancedCacheManager();
        cache.maxEntries = 10;

        for (let i = 0; i < 20; i++) {
            await cache.setAnalysisResult(`url${i}`, { score: i });
        }

        expect(cache.cache.size).toBeLessThanOrEqual(10);
    });
});
```

#### 검증 기준

- [ ] 캐시 크기 5MB 이하 유지
- [ ] 엔트리 수 1000개 이하
- [ ] LFU 기반 자동 정리
- [ ] 단위 테스트 통과

---

### 📋 Task 2.2: IndexedDB 배치 쓰기

**우선순위**: 🟡 Medium
**예상 시간**: 4시간
**파일**: `src/utils/db.js`

#### 현재 문제

```javascript
// 매번 즉시 쓰기 → I/O 부하
async setAnalysisResult(postNo, result) {
    await this.db.analysisResults.put({ postNo, result, timestamp: Date.now() });
}
```

#### 해결책

```javascript
// src/utils/db.js 수정
export class DatabaseManager {
    constructor() {
        this.db = null;
        this.pendingWrites = [];
        this.flushTimer = null;
        this.BATCH_SIZE = 50; // 50개씩 배치
        this.FLUSH_INTERVAL = 5000; // 5초마다
    }

    /**
     * 분석 결과 저장 (배치)
     */
    async setAnalysisResult(postNo, result) {
        return new Promise((resolve, reject) => {
            this.pendingWrites.push({
                postNo,
                result,
                timestamp: Date.now(),
                resolve,
                reject
            });

            // 배치 크기 도달 시 즉시 플러시
            if (this.pendingWrites.length >= this.BATCH_SIZE) {
                this.flush();
            } else {
                // 타이머 설정 (5초 후 플러시)
                this.scheduleFlush();
            }
        });
    }

    /**
     * 플러시 예약
     */
    scheduleFlush() {
        if (this.flushTimer) return;

        this.flushTimer = setTimeout(() => {
            this.flush();
        }, this.FLUSH_INTERVAL);
    }

    /**
     * 대기 중인 쓰기 실행
     */
    async flush() {
        if (this.pendingWrites.length === 0) return;

        clearTimeout(this.flushTimer);
        this.flushTimer = null;

        const batch = this.pendingWrites.splice(0, this.BATCH_SIZE);

        try {
            // 트랜잭션으로 배치 쓰기
            await this.db.transaction('rw', this.db.analysisResults, async () => {
                for (const item of batch) {
                    await this.db.analysisResults.put({
                        postNo: item.postNo,
                        result: item.result,
                        timestamp: item.timestamp
                    });
                }
            });

            // 모든 Promise 해결
            batch.forEach(item => item.resolve());
        } catch (error) {
            // 모든 Promise 거부
            batch.forEach(item => item.reject(error));
        }

        // 남은 항목이 있으면 계속 플러시
        if (this.pendingWrites.length > 0) {
            this.scheduleFlush();
        }
    }

    /**
     * 즉시 플러시 (중요한 경우)
     */
    async flushNow() {
        while (this.pendingWrites.length > 0) {
            await this.flush();
        }
    }
}
```

#### 페이지 언로드 시 플러시

```javascript
// src/content/content.js 추가
window.addEventListener('beforeunload', async () => {
    // 대기 중인 DB 쓰기 완료
    await dbManager.flushNow();

    // 리소스 정리
    cleanup();
});
```

#### 테스트

```javascript
// tests/unit/DatabaseManager.test.js 추가
describe('Batch Writes', () => {
    test('배치 크기 도달 시 플러시', async () => {
        const db = new DatabaseManager();
        const flushSpy = jest.spyOn(db, 'flush');

        // 50개 추가 → 자동 플러시
        for (let i = 0; i < 50; i++) {
            db.setAnalysisResult(`post${i}`, { score: i });
        }

        expect(flushSpy).toHaveBeenCalled();
    });

    test('타이머로 지연 플러시', async () => {
        jest.useFakeTimers();
        const db = new DatabaseManager();

        // 10개 추가
        for (let i = 0; i < 10; i++) {
            db.setAnalysisResult(`post${i}`, { score: i });
        }

        // 5초 경과
        jest.advanceTimersByTime(5000);

        expect(db.pendingWrites.length).toBe(0); // 플러시 완료
    });
});
```

#### 검증 기준

- [ ] I/O 횟수 50% 감소
- [ ] 배치 쓰기 정상 작동
- [ ] 페이지 언로드 시 플러시
- [ ] 단위 테스트 통과

---

### 📋 Task 2.3: 이미지 배치 분석

**우선순위**: 🟡 Medium
**예상 시간**: 6시간
**파일**: `src/content/content.js`, `src/background/service-worker.js`

#### 현재 문제

```javascript
// 각 이미지마다 개별 요청 → API 호출 과다
posts.forEach(post => {
    analyzeImage(post.imageUrl); // N번 호출
});
```

#### 해결책

```javascript
// src/content/content.js 수정
/**
 * 이미지 배치 분석
 */
async function analyzeBatch(posts) {
    const imageUrls = posts.map(p => p.imageUrl).filter(Boolean);

    if (imageUrls.length === 0) return;

    try {
        // 배치 요청
        const results = await sendMessageWithTimeout({
            type: MESSAGE_TYPES.ANALYZE_BATCH,
            imageUrls
        });

        // 결과 매핑
        results.forEach((result, index) => {
            const post = posts[index];
            updateSignal(post.element, result);
        });
    } catch (error) {
        console.error('[Kas-Free] 배치 분석 실패:', error);

        // 개별 폴백
        for (const post of posts) {
            try {
                const result = await analyzeImage(post.imageUrl);
                updateSignal(post.element, result);
            } catch (e) {
                console.error('[Kas-Free] 개별 분석 실패:', e);
            }
        }
    }
}

/**
 * 신규 게시글 감지 (배치 처리)
 */
const newPostsQueue = [];
const BATCH_SIZE = 10;
const BATCH_DELAY = 2000; // 2초 대기

function onNewPosts(posts) {
    newPostsQueue.push(...posts);

    if (newPostsQueue.length >= BATCH_SIZE) {
        processBatch();
    } else {
        scheduleBatchProcessing();
    }
}

function scheduleBatchProcessing() {
    if (batchTimer) return;

    batchTimer = setTimeout(() => {
        processBatch();
    }, BATCH_DELAY);
}

async function processBatch() {
    clearTimeout(batchTimer);
    batchTimer = null;

    if (newPostsQueue.length === 0) return;

    const batch = newPostsQueue.splice(0, BATCH_SIZE);
    await analyzeBatch(batch);

    // 남은 항목 처리
    if (newPostsQueue.length > 0) {
        scheduleBatchProcessing();
    }
}
```

#### Service Worker 배치 핸들러

```javascript
// src/background/service-worker.js 추가
/**
 * 배치 이미지 분석
 */
async function handleAnalyzeBatch(message) {
    const { imageUrls } = message;

    // 병렬 처리 (최대 5개씩)
    const PARALLEL_LIMIT = 5;
    const results = [];

    for (let i = 0; i < imageUrls.length; i += PARALLEL_LIMIT) {
        const chunk = imageUrls.slice(i, i + PARALLEL_LIMIT);

        const chunkResults = await Promise.allSettled(
            chunk.map(url => analyzeImageInternal(url))
        );

        results.push(...chunkResults.map((r, idx) => {
            if (r.status === 'fulfilled') {
                return r.value;
            } else {
                return {
                    imageUrl: chunk[idx],
                    error: r.reason.message,
                    status: 'error'
                };
            }
        }));
    }

    return results;
}

/**
 * 메시지 핸들러 확장
 */
switch (message.type) {
    case MESSAGE_TYPES.ANALYZE_BATCH:
        return await handleAnalyzeBatch(message);
    // ... 기존 케이스
}
```

#### 테스트

```javascript
// tests/unit/batchAnalysis.test.js (신규)
describe('Batch Analysis', () => {
    test('배치 요청 처리', async () => {
        const imageUrls = Array.from({ length: 10 }, (_, i) => `https://test.com/img${i}.jpg`);

        const results = await handleAnalyzeBatch({ imageUrls });

        expect(results).toHaveLength(10);
        results.forEach(r => {
            expect(r).toHaveProperty('riskScore');
        });
    });

    test('병렬 제한 (5개씩)', async () => {
        const imageUrls = Array.from({ length: 20 }, (_, i) => `https://test.com/img${i}.jpg`);

        const spy = jest.spyOn(global, 'fetch');
        await handleAnalyzeBatch({ imageUrls });

        // 호출 횟수 확인 (20개 이미지, 5개씩 병렬 → 4번 배치)
        expect(spy).toHaveBeenCalledTimes(20);
    });
});
```

#### 검증 기준

- [ ] API 호출 80% 감소
- [ ] 배치 크기 10개
- [ ] 병렬 제한 5개
- [ ] 폴백 로직 작동
- [ ] 단위 테스트 통과

---

### 📋 Task 2.4: DOM 쿼리 캐싱

**우선순위**: 🟢 Low
**예상 시간**: 2시간
**파일**: `src/content/content.js`

#### 현재 문제

```javascript
// 매번 DOM 쿼리 → 렌더링 부하
function updateSignals() {
    const posts = document.querySelectorAll('.gall_list li'); // 반복 쿼리
    posts.forEach(post => {
        // ...
    });
}
```

#### 해결책

```javascript
// src/content/domCache.js (신규)
/**
 * DOM 쿼리 캐싱
 */
export class DomCache {
    constructor() {
        this.cache = new Map();
        this.observers = new Map();
    }

    /**
     * 캐시된 쿼리
     */
    querySelectorAll(selector, root = document) {
        const key = `${selector}@${root}`;

        if (this.cache.has(key)) {
            return Array.from(this.cache.get(key));
        }

        const elements = Array.from(root.querySelectorAll(selector));
        this.cache.set(key, elements);

        // DOM 변화 감지 시 캐시 무효화
        this.watchInvalidation(key, root);

        return elements;
    }

    /**
     * 캐시 무효화 감지
     */
    watchInvalidation(key, root) {
        if (this.observers.has(key)) return;

        const observer = new MutationObserver(() => {
            this.cache.delete(key);
            observer.disconnect();
            this.observers.delete(key);
        });

        observer.observe(root, {
            childList: true,
            subtree: true
        });

        this.observers.set(key, observer);
    }

    /**
     * 수동 무효화
     */
    invalidate(selector) {
        for (const key of this.cache.keys()) {
            if (key.startsWith(selector)) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * 전체 캐시 초기화
     */
    clear() {
        this.cache.clear();
        for (const observer of this.observers.values()) {
            observer.disconnect();
        }
        this.observers.clear();
    }
}

export const domCache = new DomCache();
```

#### 적용

```javascript
// src/content/content.js 수정
import { domCache } from './domCache.js';

function updateSignals() {
    // 캐시된 쿼리 사용
    const posts = domCache.querySelectorAll('.gall_list li');

    posts.forEach(post => {
        // ...
    });
}
```

#### 테스트

```javascript
// tests/unit/DomCache.test.js (신규)
describe('DomCache', () => {
    test('캐시 히트', () => {
        const cache = new DomCache();
        document.body.innerHTML = '<div class="test">1</div><div class="test">2</div>';

        const first = cache.querySelectorAll('.test');
        const second = cache.querySelectorAll('.test');

        expect(first).toBe(second); // 같은 참조
    });

    test('DOM 변화 시 캐시 무효화', (done) => {
        const cache = new DomCache();
        document.body.innerHTML = '<div class="test">1</div>';

        cache.querySelectorAll('.test');

        // DOM 변경
        document.body.innerHTML += '<div class="test">2</div>';

        setTimeout(() => {
            const elements = cache.querySelectorAll('.test');
            expect(elements.length).toBe(2); // 새로 쿼리됨
            done();
        }, 100);
    });
});
```

#### 검증 기준

- [ ] DOM 쿼리 50% 감소
- [ ] 렌더링 시간 10% 단축
- [ ] 캐시 무효화 정상 작동
- [ ] 단위 테스트 통과

---

## Phase 3: 코드 품질 개선 (2-3주)

**목표**: 순환복잡도 감소, TypeScript 마이그레이션, 테스트 90%
**기간**: 2026-03-26 ~ 2026-04-15 (3주)

---

### 📋 Task 3.1: 메시지 핸들러 분리 (파사드 패턴)

**우선순위**: 🟠 High
**예상 시간**: 8시간
**파일**: `src/background/service-worker.js` → `src/background/handlers/*.js`

#### 현재 문제

```javascript
// service-worker.js (600줄+, 순환복잡도 12)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case MESSAGE_TYPES.ANALYZE_IMAGE: { /* 50줄 */ }
        case MESSAGE_TYPES.GET_SETTINGS: { /* 30줄 */ }
        case MESSAGE_TYPES.UPDATE_SETTINGS: { /* 40줄 */ }
        // ... 9개 케이스
    }
});
```

#### 해결책

**1단계: 핸들러 인터페이스 정의**

```javascript
// src/background/handlers/BaseHandler.js (신규)
/**
 * 메시지 핸들러 기본 클래스
 */
export class BaseHandler {
    constructor() {
        this.name = this.constructor.name;
    }

    /**
     * 메시지 처리 (하위 클래스에서 구현)
     * @param {object} message - 메시지
     * @param {object} sender - 발신자
     * @returns {Promise<any>}
     */
    async handle(message, sender) {
        throw new Error(`${this.name}.handle() must be implemented`);
    }

    /**
     * 메시지 검증 (선택)
     */
    validate(message) {
        return true;
    }
}
```

**2단계: 개별 핸들러 구현**

```javascript
// src/background/handlers/AnalyzeImageHandler.js (신규)
import { BaseHandler } from './BaseHandler.js';
import { analyzeImage } from '../imageAnalyzer.js';

export class AnalyzeImageHandler extends BaseHandler {
    validate(message) {
        if (!message.imageUrl || typeof message.imageUrl !== 'string') {
            throw new ValidationError('imageUrl is required');
        }
        return true;
    }

    async handle(message, sender) {
        const { imageUrl } = message;

        // 캐시 확인
        const cached = await cacheManager.getAnalysisResult(imageUrl);
        if (cached) {
            return cached;
        }

        // 분석 실행
        const result = await analyzeImage(imageUrl);

        // 캐시 저장
        await cacheManager.setAnalysisResult(imageUrl, result);

        // 통계 업데이트
        await updateStats({ analyzed: 1 });

        return result;
    }
}
```

```javascript
// src/background/handlers/GetSettingsHandler.js (신규)
import { BaseHandler } from './BaseHandler.js';
import { getSettings } from '../../utils/storage.js';

export class GetSettingsHandler extends BaseHandler {
    async handle(message, sender) {
        return await getSettings();
    }
}
```

```javascript
// src/background/handlers/UpdateSettingsHandler.js (신규)
import { BaseHandler } from './BaseHandler.js';
import { updateSettings } from '../../utils/storage.js';

export class UpdateSettingsHandler extends BaseHandler {
    validate(message) {
        if (!message.updates || typeof message.updates !== 'object') {
            throw new ValidationError('updates is required');
        }
        return true;
    }

    async handle(message, sender) {
        const { updates } = message;
        await updateSettings(updates);
        return { success: true };
    }
}
```

**3단계: 라우터 구현**

```javascript
// src/background/MessageRouter.js (신규)
import { logError, getUserFriendlyMessage } from '../utils/errorHandler.js';

/**
 * 메시지 라우터 (파사드 패턴)
 */
export class MessageRouter {
    constructor(handlers = {}) {
        this.handlers = new Map(Object.entries(handlers));
    }

    /**
     * 핸들러 등록
     */
    register(type, handler) {
        if (!(handler instanceof BaseHandler)) {
            throw new Error('Handler must extend BaseHandler');
        }
        this.handlers.set(type, handler);
    }

    /**
     * 메시지 라우팅
     */
    async route(message, sender) {
        // 타입 확인
        if (!message || !message.type) {
            throw new ValidationError('Invalid message format');
        }

        // 핸들러 찾기
        const handler = this.handlers.get(message.type);
        if (!handler) {
            throw new ValidationError(`Unknown message type: ${message.type}`);
        }

        // 검증
        handler.validate(message);

        // 실행
        return await handler.handle(message, sender);
    }
}
```

**4단계: Service Worker 간소화**

```javascript
// src/background/service-worker.js (50줄로 축소)
import { MessageRouter } from './MessageRouter.js';
import { MESSAGE_TYPES } from '../utils/constants.js';

// 핸들러 임포트
import { AnalyzeImageHandler } from './handlers/AnalyzeImageHandler.js';
import { AnalyzeBatchHandler } from './handlers/AnalyzeBatchHandler.js';
import { GetSettingsHandler } from './handlers/GetSettingsHandler.js';
import { UpdateSettingsHandler } from './handlers/UpdateSettingsHandler.js';
import { GetStatsHandler } from './handlers/GetStatsHandler.js';
import { UpdateStatsHandler } from './handlers/UpdateStatsHandler.js';
import { ToggleExtensionHandler } from './handlers/ToggleExtensionHandler.js';
import { AIVerifyHandler } from './handlers/AIVerifyHandler.js';
import { ReportImageHandler } from './handlers/ReportImageHandler.js';
import { GetPerformanceMetricsHandler } from './handlers/GetPerformanceMetricsHandler.js';

// 라우터 초기화
const router = new MessageRouter({
    [MESSAGE_TYPES.ANALYZE_IMAGE]: new AnalyzeImageHandler(),
    [MESSAGE_TYPES.ANALYZE_BATCH]: new AnalyzeBatchHandler(),
    [MESSAGE_TYPES.GET_SETTINGS]: new GetSettingsHandler(),
    [MESSAGE_TYPES.UPDATE_SETTINGS]: new UpdateSettingsHandler(),
    [MESSAGE_TYPES.GET_STATS]: new GetStatsHandler(),
    [MESSAGE_TYPES.UPDATE_STATS]: new UpdateStatsHandler(),
    [MESSAGE_TYPES.TOGGLE_EXTENSION]: new ToggleExtensionHandler(),
    [MESSAGE_TYPES.AI_VERIFY_IMAGE]: new AIVerifyHandler(),
    [MESSAGE_TYPES.REPORT_IMAGE]: new ReportImageHandler(),
    [MESSAGE_TYPES.GET_PERFORMANCE_METRICS]: new GetPerformanceMetricsHandler()
});

// 메시지 리스너 (간결)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    router.route(message, sender)
        .then(result => {
            sendResponse({ success: true, data: result });
        })
        .catch(error => {
            logError('messageRouter', error, settings?.debugMode);
            sendResponse({
                success: false,
                error: getUserFriendlyMessage(error),
                code: error.code
            });
        });

    return true; // 비동기 응답
});

// 초기화
initialize();
```

#### 효과

- **순환복잡도**: 12 → 2
- **파일 크기**: 600줄 → 50줄
- **테스트 용이성**: 각 핸들러 독립 테스트
- **확장성**: 새 메시지 타입 추가 간편

#### 테스트

```javascript
// tests/unit/MessageRouter.test.js (신규)
describe('MessageRouter', () => {
    test('정상 라우팅', async () => {
        const router = new MessageRouter({
            'TEST_TYPE': new TestHandler()
        });

        const result = await router.route({ type: 'TEST_TYPE', data: 'test' }, {});
        expect(result).toBeDefined();
    });

    test('알 수 없는 타입', async () => {
        const router = new MessageRouter({});

        await expect(
            router.route({ type: 'UNKNOWN' }, {})
        ).rejects.toThrow(ValidationError);
    });
});

// tests/unit/handlers/AnalyzeImageHandler.test.js (신규)
describe('AnalyzeImageHandler', () => {
    test('이미지 분석 처리', async () => {
        const handler = new AnalyzeImageHandler();
        const result = await handler.handle({
            imageUrl: 'https://test.com/image.jpg'
        }, {});

        expect(result).toHaveProperty('riskScore');
    });

    test('imageUrl 누락 시 검증 실패', () => {
        const handler = new AnalyzeImageHandler();

        expect(() => {
            handler.validate({});
        }).toThrow(ValidationError);
    });
});
```

#### 검증 기준

- [ ] service-worker.js 100줄 이하
- [ ] 순환복잡도 3 이하
- [ ] 각 핸들러 독립 테스트
- [ ] 단위 테스트 통과 (100%)

---

### 📋 Task 3.2: TypeScript 마이그레이션

**우선순위**: 🟡 Medium
**예상 시간**: 40시간 (5일)
**범위**: 전체 프로젝트

#### 마이그레이션 전략

**1단계: 설정 (1시간)**

```json
// tsconfig.json (신규)
{
    "compilerOptions": {
        "target": "ES2020",
        "module": "ES2020",
        "lib": ["ES2020", "DOM"],
        "moduleResolution": "node",
        "allowJs": true,
        "checkJs": true,
        "outDir": "./dist",
        "rootDir": "./src",
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "forceConsistentCasingInFileNames": true,
        "resolveJsonModule": true,
        "types": ["chrome"]
    },
    "include": ["src/**/*"],
    "exclude": ["node_modules", "dist", "tests"]
}
```

```json
// package.json 업데이트
{
    "devDependencies": {
        "@types/chrome": "^0.0.268",
        "typescript": "^5.3.3"
    },
    "scripts": {
        "build": "tsc",
        "watch": "tsc --watch",
        "typecheck": "tsc --noEmit"
    }
}
```

**2단계: 타입 정의 (4시간)**

```typescript
// src/types/index.ts (신규)
/**
 * 분석 결과
 */
export interface AnalysisResult {
    status: 'safe' | 'caution' | 'danger' | 'error' | 'unchecked' | 'loading';
    riskScore: number;
    categories: Record<string, number>;
    primary: AnalyzerResult | null;
    secondary: AnalyzerResult | null;
    source: string;
    timestamp: number;
    error?: string;
}

/**
 * 분석기 결과
 */
export interface AnalyzerResult {
    riskScore: number;
    categories: Record<string, number>;
    source: string;
    timestamp: number;
}

/**
 * 설정
 */
export interface Settings {
    enabled: boolean;
    debugMode: boolean;
    autoReport: boolean;
    thresholds: {
        safeMax: number;
        cautionMax: number;
    };
    sensitivity: {
        nsfw: number;
        gore: number;
        violence: number;
    };
    apis: {
        geminiFlash: ApiConfig;
        claudeHaiku: ApiConfig;
        gpt4oMini: ApiConfig;
    };
}

/**
 * API 설정
 */
export interface ApiConfig {
    enabled: boolean;
    apiKey: string;
    priority: number;
}

/**
 * 메시지 타입
 */
export type MessageType =
    | 'ANALYZE_IMAGE'
    | 'ANALYZE_BATCH'
    | 'GET_SETTINGS'
    | 'UPDATE_SETTINGS'
    | 'GET_STATS'
    | 'UPDATE_STATS'
    | 'TOGGLE_EXTENSION'
    | 'AI_VERIFY_IMAGE'
    | 'REPORT_IMAGE'
    | 'GET_PERFORMANCE_METRICS';

/**
 * 메시지
 */
export interface Message {
    type: MessageType;
    [key: string]: any;
}

/**
 * 메시지 응답
 */
export interface MessageResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    code?: string;
}

/**
 * 통계
 */
export interface Stats {
    analyzed: number;
    blocked: number;
    reported: number;
    cacheHits: number;
    cacheMisses: number;
}

/**
 * 에러 클래스
 */
export class ValidationError extends Error {
    code: string = 'VALIDATION_ERROR';
    details?: Record<string, any>;

    constructor(message: string, details?: Record<string, any>) {
        super(message);
        this.name = 'ValidationError';
        this.details = details;
    }
}

export class TimeoutError extends Error {
    code: string = 'TIMEOUT';
    details?: Record<string, any>;

    constructor(message: string, details?: Record<string, any>) {
        super(message);
        this.name = 'TimeoutError';
        this.details = details;
    }

    needsFallback(): boolean {
        return true;
    }
}

export class NetworkError extends Error {
    code: string = 'NETWORK_ERROR';

    constructor(message: string) {
        super(message);
        this.name = 'NetworkError';
    }
}
```

**3단계: 유틸리티 마이그레이션 (8시간)**

```typescript
// src/utils/storage.ts (변환)
import type { Settings, Stats } from '../types/index.js';
import { validateSettings } from './settingsValidator.js';

/**
 * 설정 불러오기
 */
export async function getSettings(): Promise<Settings> {
    const { settings } = await chrome.storage.local.get('settings');
    return settings || DEFAULT_SETTINGS;
}

/**
 * 설정 저장하기
 */
export async function saveSettings(settings: Settings): Promise<void> {
    const validated = validateSettings(settings);
    await chrome.storage.local.set({ settings: validated });
}

/**
 * 설정 일부 수정
 */
export async function updateSettings(updates: Partial<Settings>): Promise<void> {
    const current = await getSettings();
    const merged = { ...current, ...updates };
    await saveSettings(merged);
}

/**
 * 통계 불러오기
 */
export async function getStats(): Promise<Stats> {
    const { stats } = await chrome.storage.local.get('stats');
    return stats || DEFAULT_STATS;
}

/**
 * 통계 업데이트
 */
export async function updateStats(updates: Partial<Stats>): Promise<void> {
    const current = await getStats();
    const updated = { ...current };

    for (const [key, value] of Object.entries(updates)) {
        if (typeof value === 'number') {
            updated[key as keyof Stats] += value;
        }
    }

    await chrome.storage.local.set({ stats: updated });
}
```

**4단계: 핸들러 마이그레이션 (12시간)**

```typescript
// src/background/handlers/BaseHandler.ts
import type { Message, MessageResponse } from '../../types/index.js';

/**
 * 메시지 핸들러 기본 클래스
 */
export abstract class BaseHandler {
    readonly name: string;

    constructor() {
        this.name = this.constructor.name;
    }

    /**
     * 메시지 처리 (하위 클래스에서 구현)
     */
    abstract handle(message: Message, sender: chrome.runtime.MessageSender): Promise<any>;

    /**
     * 메시지 검증 (선택)
     */
    validate(message: Message): boolean {
        return true;
    }
}
```

```typescript
// src/background/handlers/AnalyzeImageHandler.ts
import { BaseHandler } from './BaseHandler.js';
import type { Message, AnalysisResult } from '../../types/index.js';
import { ValidationError } from '../../types/index.js';

interface AnalyzeImageMessage extends Message {
    type: 'ANALYZE_IMAGE';
    imageUrl: string;
}

export class AnalyzeImageHandler extends BaseHandler {
    validate(message: Message): boolean {
        const msg = message as AnalyzeImageMessage;

        if (!msg.imageUrl || typeof msg.imageUrl !== 'string') {
            throw new ValidationError('imageUrl is required');
        }

        return true;
    }

    async handle(message: Message, sender: chrome.runtime.MessageSender): Promise<AnalysisResult> {
        const { imageUrl } = message as AnalyzeImageMessage;

        // 캐시 확인
        const cached = await cacheManager.getAnalysisResult(imageUrl);
        if (cached) {
            return cached;
        }

        // 분석 실행
        const result = await analyzeImage(imageUrl);

        // 캐시 저장
        await cacheManager.setAnalysisResult(imageUrl, result);

        // 통계 업데이트
        await updateStats({ analyzed: 1 });

        return result;
    }
}
```

**5단계: 점진적 마이그레이션 (15시간)**

- 나머지 파일들을 .js → .ts로 변환
- 타입 에러 수정
- strict 모드 활성화

#### 검증 기준

- [ ] 모든 파일 TypeScript 변환
- [ ] strict 모드 활성화
- [ ] 타입 에러 0개
- [ ] 빌드 성공

---

### 📋 Task 3.3: 테스트 커버리지 90%

**우선순위**: 🟠 High
**예상 시간**: 20시간 (2.5일)

#### 현재 커버리지

```
branches: 70%
functions: 70%
lines: 70%
statements: 70%
```

#### 목표

```
branches: 90%
functions: 90%
lines: 90%
statements: 90%
```

#### 전략

**1. 누락된 테스트 식별**

```bash
npm run test:coverage
# 커버리지 리포트 확인
open coverage/lcov-report/index.html
```

**2. 우선순위 테스트 작성**

| 모듈 | 현재 | 목표 | 시간 |
|------|------|------|------|
| ErrorRecoveryManager | 0% | 90% | 4시간 |
| ApiClient | 50% | 90% | 3시간 |
| AdvancedCacheManager | 70% | 90% | 2시간 |
| AIVerificationHandler | 0% | 90% | 3시간 |
| MessageRouter | 0% | 95% | 2시간 |
| Handlers | 0% | 90% | 6시간 |

**3. 테스트 예시**

```typescript
// tests/unit/ErrorRecoveryManager.test.ts (신규)
describe('ErrorRecoveryManager', () => {
    let manager: ErrorRecoveryManager;

    beforeEach(() => {
        manager = new ErrorRecoveryManager();
    });

    describe('recover', () => {
        test('NetworkError → 재시도', async () => {
            const error = new NetworkError('Connection failed');
            const context = { url: 'https://api.test.com', attempt: 0 };

            const result = await manager.recover(error, context);

            expect(result.action).toBe('retry');
            expect(result.delay).toBeGreaterThan(0);
        });

        test('TimeoutError → 캐시 폴백', async () => {
            const error = new TimeoutError('Timeout after 15s');
            const context = { url: 'https://api.test.com', attempt: 2 };

            const result = await manager.recover(error, context);

            expect(result.action).toBe('fallback');
            expect(result.source).toBe('cache');
        });

        test('IndexedDBError → 재초기화', async () => {
            const error = new Error('DB connection failed');
            error.name = 'IndexedDBError';
            const context = { operation: 'put' };

            const result = await manager.recover(error, context);

            expect(result.action).toBe('reinitialize');
        });

        test('ApiKeyError → 다른 API로 전환', async () => {
            const error = new Error('Invalid API key');
            error.code = 'API_KEY_ERROR';
            const context = { api: 'geminiFlash' };

            const result = await manager.recover(error, context);

            expect(result.action).toBe('switchAPI');
            expect(result.nextAPI).not.toBe('geminiFlash');
        });
    });

    describe('calculateDelay', () => {
        test('Exponential Backoff', () => {
            expect(manager.calculateDelay(0)).toBeLessThanOrEqual(2000); // 1초 + jitter
            expect(manager.calculateDelay(1)).toBeLessThanOrEqual(3000); // 2초 + jitter
            expect(manager.calculateDelay(2)).toBeLessThanOrEqual(5000); // 4초 + jitter
        });

        test('최대 10초 제한', () => {
            expect(manager.calculateDelay(10)).toBeLessThanOrEqual(10000);
        });
    });
});
```

#### 검증 기준

- [ ] 전체 커버리지 90% 이상
- [ ] 각 모듈 커버리지 90% 이상
- [ ] 모든 에러 시나리오 테스트
- [ ] E2E 테스트 5개 이상

---

## Phase 4: Chrome Extension 최적화 (1주)

**목표**: 권한 최소화, Service Worker 최적화
**기간**: 2026-04-16 ~ 2026-04-22 (1주)

---

### 📋 Task 4.1: host_permissions 최소화

**우선순위**: 🟠 High
**예상 시간**: 2시간

#### 현재

```json
{
    "host_permissions": [
        "<all_urls>"
    ]
}
```

#### 개선

```json
{
    "host_permissions": [
        "https://gall.dcinside.com/*",
        "https://*.dcinside.com/*",
        "https://*.dcinside.co.kr/*",
        "https://api.openai.com/*",
        "https://api.anthropic.com/*",
        "https://generativelanguage.googleapis.com/*",
        "https://nerdvana.kr/*"
    ]
}
```

#### 검증 기준

- [ ] 디시인사이드에서만 작동
- [ ] AI API 호출 정상
- [ ] 권한 최소화 원칙 준수

---

### 📋 Task 4.2: CSP 명시적 정의

**우선순위**: 🟡 Medium
**예상 시간**: 1시간

```json
{
    "content_security_policy": {
        "extension_pages": "script-src 'self'; object-src 'self'"
    }
}
```

#### 검증 기준

- [ ] CSP 정책 명시
- [ ] 외부 스크립트 차단
- [ ] 확장 기능 정상 작동

---

### 📋 Task 4.3: Service Worker 메모리 최적화

**우선순위**: 🟠 High
**예상 시간**: 4시간

#### 개선 사항

1. **Lazy Loading**: 필요할 때만 모듈 로드
2. **메모리 모니터링**: 주기적으로 메모리 사용량 확인
3. **자동 정리**: 메모리 한계 도달 시 캐시 정리

```typescript
// src/background/service-worker.ts 추가
/**
 * 메모리 모니터링
 */
setInterval(async () => {
    if (performance.memory) {
        const usage = performance.memory.usedJSHeapSize / 1024 / 1024; // MB

        if (usage > 40) { // 40MB 초과
            console.warn(`[Kas-Free] 메모리 사용량 높음: ${usage.toFixed(1)}MB`);

            // 캐시 정리
            await cacheManager.smartCleanup();

            // 리소스 정리
            resourceManager.cleanupUnusedResources();
        }
    }
}, 5 * 60 * 1000); // 5분마다
```

#### 검증 기준

- [ ] 메모리 사용량 50MB 이하
- [ ] 자동 정리 작동
- [ ] Service Worker 안정성

---

## 검증 및 테스트 계획

### 단위 테스트

```bash
npm test
# 목표: 90% 커버리지
```

### 통합 테스트

```bash
npm run test:e2e
# 시나리오:
# 1. 확장 설치 및 활성화
# 2. 디시인사이드 페이지 로드
# 3. 이미지 분석 실행
# 4. 신호등 표시 확인
# 5. 설정 변경
# 6. 통계 확인
```

### 성능 테스트

```bash
npm run test:performance
# 측정:
# - 평균 응답 시간
# - 메모리 사용량
# - 캐시 히트율
# - API 호출 횟수
```

### 보안 테스트

- [ ] XSS 취약점 스캔
- [ ] CSRF 가능성 검토
- [ ] API 키 노출 확인
- [ ] 민감 정보 로깅 확인

---

## 리스크 관리

| 리스크 | 가능성 | 영향도 | 대응 방안 |
|--------|--------|--------|---------|
| TypeScript 마이그레이션 지연 | 중간 | 높음 | 점진적 마이그레이션, 주간 검토 |
| 테스트 커버리지 목표 미달 | 낮음 | 중간 | 우선순위 모듈 집중 테스트 |
| 성능 저하 | 낮음 | 높음 | 각 Phase 후 성능 테스트 |
| 호환성 문제 | 낮음 | 중간 | E2E 테스트로 사전 검증 |
| Chrome API 변경 | 낮음 | 높음 | Chrome 릴리즈 노트 모니터링 |

---

## 마일스톤 및 일정

```
2026-02-26  Phase 1 시작 (보안 및 안정성)
2026-03-11  Phase 1 완료, Phase 2 시작 (성능 최적화)
2026-03-25  Phase 2 완료, Phase 3 시작 (코드 품질)
2026-04-15  Phase 3 완료, Phase 4 시작 (Extension 최적화)
2026-04-22  Phase 4 완료, 최종 검증
2026-04-29  버전 1.2.0 릴리즈
```

### 주간 체크포인트

- **매주 금요일**: 진행 상황 리뷰
- **매주 월요일**: 다음 주 작업 계획
- **Phase 종료 시**: 성능 테스트 및 검증

---

## 다음 단계

1. **Phase 1 Task 1.1 시작**: 설정값 범위 검증 추가
2. **Git Branch 생성**: `feature/improvement-plan`
3. **작업 추적**: GitHub Issues 또는 Jira 티켓 생성
4. **일일 커밋**: 작은 단위로 커밋, CI/CD 통과 확인

---

**문서 버전**: 1.0
**다음 업데이트**: 2026-03-11 (Phase 1 완료 후)
**담당자**: 최진호
**검토자**: -

---

이 개선 플랜은 **Living Document**입니다. 진행 상황에 따라 지속적으로 업데이트됩니다.
