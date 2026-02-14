/**
 * ========================================
 * 카-스 프리 설정 페이지 스크립트
 * ========================================
 *
 * 역할:
 * - 사용자 설정 UI 표시 및 관리
 * - 설정 로드/저장 (chrome.storage.local)
 * - 성능 메트릭 표시 (대시보드)
 *
 * 페이지 구성:
 * 1. API 설정 (Gemini, Claude, GPT-4o)
 * 2. 민감도 설정 (10개 카테고리)
 * 3. 임계값 설정 (safe/caution 경계)
 * 4. 동작 설정 (자동검사, 캐시 등)
 * 5. 성능 대시보드 (메트릭 표시)
 *
 * @author 최진호
 * @date 2026-01-31
 * @version 1.0.0
 */

/**
 * ========================================
 * IIFE (즉시 실행 함수)
 * ========================================
 *
 * content.js와 동일한 이유로 IIFE 사용:
 * - 전역 스코프 오염 방지
 * - 코드 격리 (다른 스크립트와 충돌 방지)
 * - 네임스페이스 역할
 */
(function() {
    'use strict';  // 엄격 모드 (실수 방지)

    /**
     * ========================================
     * 기본 설정값
     * ========================================
     *
     * content.js의 getDefaultSettings()와 동일한 구조
     *
     * 왜 두 곳에 정의되어 있나요?
     * - content.js: 설정 로드 실패 시 폴백
     * - options.js: '기본값 복원' 버튼 클릭 시 사용
     * - constants.js: Service Worker에서 사용
     *
     * DRY (Don't Repeat Yourself) 원칙 위반?
     * - 예, 중복입니다. 하지만:
     *   * 각 파일이 독립적으로 동작해야 함 (의존성 최소화)
     *   * 크기가 작아서 중복 허용 (유지보수 부담 적음)
     *   * 향후 개선: constants.js를 모든 파일에서 import
     *
     * 설정 구조:
     * - enabled, autoScan, onlyWithThumbnail: 동작 설정
     * - sensitivity: 카테고리별 민감도 (0.0 ~ 1.0)
     * - thresholds: 신호등 임계값 (safe/caution 경계)
     * - apis: AI API 설정 (Gemini, Claude, GPT-4o)
     */
    const DEFAULT_SETTINGS = {
        enabled:           true,   // 확장 활성화
        autoScan:          true,   // 자동 검사
        onlyWithThumbnail: true,   // 썸네일 있는 게시글만
        autoHideDanger:    false,  // 위험 게시글 자동 숨김
        cacheEnabled:      true,   // 캐시 사용
        cacheDuration:     24 * 60 * 60 * 1000,  // 24시간
        debugMode:         false,  // 디버그 모드
        replaceAllImages:  false,  // 모든 이미지 대체 (디버그용)

        // ========================================
        // 민감도 설정 (10개 카테고리)
        // ========================================
        // 값 범위: 0.0 (둔감) ~ 1.0 (매우 민감)
        // 기본값: 폭력/죽음/혐오 = 0.8 (높음)
        //         벌레/의료/충격 = 0.7 (중간)
        //         성인물 = 0.3 (낮음)
        //         선정성 = 0.2 (매우 낮음)
        sensitivity: {
            gore:           0.8,  // 고어 (신체 훼손, 유혈)
            violence:       0.8,  // 폭력 (폭행, 싸움)
            death:          0.8,  // 죽음 (시체, 장례)
            disturbing:     0.8,  // 혐오 (불쾌한 장면)
            insects:        0.7,  // 벌레/생물 (혐오 곤충)
            medical:        0.7,  // 의료 (수술, 상처)
            shock:          0.7,  // 충격 (사고, 재난)
            animal_cruelty: 0.8,  // 동물학대
            nsfw_porn:      0.3,  // 음란물 (명시적 성인물)
            nsfw_sexy:      0.2   // 선정성 (노출, 선정적)
        },

        // ========================================
        // 신호등 임계값
        // ========================================
        // safeMax: 이 값 미만이면 안전 (초록)
        // cautionMax: 이 값 미만이면 주의 (노랑), 이상이면 위험 (빨강)
        thresholds: {
            safeMax:    0.3,  // 30% 미만: 안전
            cautionMax: 0.6   // 60% 미만: 주의, 60% 이상: 위험
        },

        // ========================================
        // AI API 설정 (3개 모델)
        // ========================================
        // priority: 낮을수록 우선순위 높음 (1 > 2 > 3)
        apis: {
            geminiFlash: {
                enabled:  false,  // 기본 비활성화 (API 키 없음)
                apiKey:   '',     // Gemini API 키 (사용자 입력)
                priority: 1       // 최우선 순위
            },
            claudeHaiku: {
                enabled:  false,
                apiKey:   '',
                priority: 2       // 2순위
            },
            gpt4oMini: {
                enabled:  false,
                apiKey:   '',
                priority: 3       // 3순위
            }
        }
    };

    /**
     * ========================================
     * DOM 요소 캐싱 (성능 최적화)
     * ========================================
     *
     * 왜 미리 선택해서 저장하나요?
     * - document.getElementById()는 느림 (DOM 탐색)
     * - 한 번만 선택하고 재사용 (캐싱)
     * - 함수에서 매번 선택하면 성능 저하
     *
     * 객체로 묶는 이유:
     * - 전역 변수 오염 방지 (elements.goreSensitivity)
     * - 자동완성 지원 (IDE에서 elements. 입력 시 목록 표시)
     * - 유지보수 용이 (한 곳에서 관리)
     *
     * 네이밍 패턴:
     * - 슬라이더: [name]Sensitivity (예: goreSensitivity)
     * - 값 표시: [name]Value (예: goreValue)
     * - 체크박스: [name] (예: autoScan)
     * - 버튼: btn[Action] (예: btnSave)
     *
     * Template Literal 활용 (나중에 setSliderValue 함수에서):
     * elements[`${name}Sensitivity`]  // 동적 속성 접근
     * → name = 'gore'일 때 elements.goreSensitivity
     */
    const elements = {
        // ========================================
        // API 설정 (3개 모델 × 3개 필드 = 9개)
        // ========================================
        /** Gemini Flash */
        geminiFlashEnabled:    document.getElementById('geminiFlashEnabled'),    // 체크박스
        geminiFlashApiKey:     document.getElementById('geminiFlashApiKey'),     // 텍스트 입력
        geminiFlashPriority:   document.getElementById('geminiFlashPriority'),   // 숫자 입력

        /** Claude Haiku */
        claudeHaikuEnabled:    document.getElementById('claudeHaikuEnabled'),
        claudeHaikuApiKey:     document.getElementById('claudeHaikuApiKey'),
        claudeHaikuPriority:   document.getElementById('claudeHaikuPriority'),

        /** GPT-4o Mini */
        gpt4oMiniEnabled:      document.getElementById('gpt4oMiniEnabled'),
        gpt4oMiniApiKey:       document.getElementById('gpt4oMiniApiKey'),
        gpt4oMiniPriority:     document.getElementById('gpt4oMiniPriority'),

        // ========================================
        // 민감도 설정 (10개 카테고리 × 2개 필드 = 20개)
        // ========================================
        /** 고어 */
        goreSensitivity:         document.getElementById('goreSensitivity'),      // 슬라이더 (0-100)
        goreValue:               document.getElementById('goreValue'),            // 값 표시 (80%)

        /** 폭력 */
        violenceSensitivity:     document.getElementById('violenceSensitivity'),
        violenceValue:           document.getElementById('violenceValue'),

        /** 죽음 */
        deathSensitivity:        document.getElementById('deathSensitivity'),
        deathValue:              document.getElementById('deathValue'),

        /** 혐오 */
        disturbingSensitivity:   document.getElementById('disturbingSensitivity'),
        disturbingValue:         document.getElementById('disturbingValue'),

        /** 벌레/생물 */
        insectsSensitivity:      document.getElementById('insectsSensitivity'),
        insectsValue:            document.getElementById('insectsValue'),

        /** 의료공포 */
        medicalSensitivity:      document.getElementById('medicalSensitivity'),
        medicalValue:            document.getElementById('medicalValue'),

        /** 충격 */
        shockSensitivity:        document.getElementById('shockSensitivity'),
        shockValue:              document.getElementById('shockValue'),

        /** 동물학대 */
        animalCrueltySensitivity: document.getElementById('animalCrueltySensitivity'),
        animalCrueltyValue:      document.getElementById('animalCrueltyValue'),

        /** 음란물 */
        nsfwPornSensitivity:     document.getElementById('nsfwPornSensitivity'),
        nsfwPornValue:           document.getElementById('nsfwPornValue'),

        /** 선정성 */
        nsfwSexySensitivity:     document.getElementById('nsfwSexySensitivity'),
        nsfwSexyValue:           document.getElementById('nsfwSexyValue'),

        // ========================================
        // 임계값 설정 (2개)
        // ========================================
        safeMaxThreshold:    document.getElementById('safeMaxThreshold'),      // 안전 최대값 (0.3)
        cautionMaxThreshold: document.getElementById('cautionMaxThreshold'),   // 주의 최대값 (0.6)

        // ========================================
        // 동작 설정 (6개 체크박스)
        // ========================================
        autoScan:          document.getElementById('autoScan'),           // 자동 검사
        onlyWithThumbnail: document.getElementById('onlyWithThumbnail'),  // 썸네일만
        autoHideDanger:    document.getElementById('autoHideDanger'),     // 위험 자동 숨김
        cacheEnabled:      document.getElementById('cacheEnabled'),       // 캐시 사용
        debugMode:         document.getElementById('debugMode'),          // 디버그 모드
        replaceAllImages:  document.getElementById('replaceAllImages'),   // 모든 이미지 대체

        // ========================================
        // 버튼 (2개)
        // ========================================
        btnSave:  document.getElementById('btnSave'),   // 저장 버튼
        btnReset: document.getElementById('btnReset'),  // 기본값 복원 버튼

        // ========================================
        // 기타 UI 요소
        // ========================================
        toast:      document.getElementById('toast'),       // 토스트 알림 (저장 성공 메시지)
        appVersion: document.getElementById('appVersion')   // 버전 표시 (예: 1.0.0)
    };

    /**
     * 초기화
     */
    async function initialize() {
        loadVersion();
        await loadSettings();
        bindEvents();
        await loadPerformanceMetrics();
    }

    /**
     * 버전 정보를 로드한다
     */
    function loadVersion() {
        const manifest = chrome.runtime.getManifest();
        if (elements.appVersion) {
            elements.appVersion.textContent = manifest.version;
        }
    }

    /**
     * 설정을 로드한다
     */
    async function loadSettings() {
        const settings = await sendMessage({ type: 'GET_SETTINGS' });
        const merged   = mergeSettings(DEFAULT_SETTINGS, settings || {});
        applySettingsToUI(merged);
    }

    /**
     * 설정을 UI에 적용한다
     * @param {object} settings - 설정 객체
     */
    function applySettingsToUI(settings) {
        /** API 설정 */
        elements.geminiFlashEnabled.checked  = settings.apis.geminiFlash?.enabled || false;
        elements.geminiFlashApiKey.value     = settings.apis.geminiFlash?.apiKey || '';
        elements.geminiFlashPriority.value   = settings.apis.geminiFlash?.priority || 1;
        elements.claudeHaikuEnabled.checked  = settings.apis.claudeHaiku.enabled;
        elements.claudeHaikuApiKey.value     = settings.apis.claudeHaiku.apiKey;
        elements.claudeHaikuPriority.value   = settings.apis.claudeHaiku.priority;
        elements.gpt4oMiniEnabled.checked    = settings.apis.gpt4oMini.enabled;
        elements.gpt4oMiniApiKey.value       = settings.apis.gpt4oMini.apiKey;
        elements.gpt4oMiniPriority.value     = settings.apis.gpt4oMini.priority;

        /** 민감도 설정 */
        const sensitivity = settings.sensitivity;
        setSliderValue('gore', Math.round((sensitivity.gore || 0.8) * 100));
        setSliderValue('violence', Math.round((sensitivity.violence || 0.8) * 100));
        setSliderValue('death', Math.round((sensitivity.death || 0.8) * 100));
        setSliderValue('disturbing', Math.round((sensitivity.disturbing || 0.8) * 100));
        setSliderValue('insects', Math.round((sensitivity.insects || 0.7) * 100));
        setSliderValue('medical', Math.round((sensitivity.medical || 0.7) * 100));
        setSliderValue('shock', Math.round((sensitivity.shock || 0.7) * 100));
        setSliderValue('animalCruelty', Math.round((sensitivity.animal_cruelty || 0.8) * 100));
        setSliderValue('nsfwPorn', Math.round((sensitivity.nsfw_porn || 0.3) * 100));
        setSliderValue('nsfwSexy', Math.round((sensitivity.nsfw_sexy || 0.2) * 100));

        /** 임계값 설정 */
        elements.safeMaxThreshold.value    = settings.thresholds.safeMax;
        elements.cautionMaxThreshold.value = settings.thresholds.cautionMax;

        /** 동작 설정 */
        elements.autoScan.checked          = settings.autoScan;
        elements.onlyWithThumbnail.checked = settings.onlyWithThumbnail;
        elements.autoHideDanger.checked    = settings.autoHideDanger;
        elements.cacheEnabled.checked      = settings.cacheEnabled;
        elements.debugMode.checked         = settings.debugMode;
        elements.replaceAllImages.checked  = settings.replaceAllImages;
    }

    /**
     * ========================================
     * 슬라이더 값 설정 (Template Literal 활용)
     * ========================================
     *
     * Template Literal (템플릿 리터럴):
     * - `${변수}` 형식으로 문자열 안에 변수 삽입
     * - 동적 속성 접근에 사용
     *
     * 예시:
     * name = 'gore'일 때
     * - `${name}Sensitivity` → 'goreSensitivity'
     * - elements['goreSensitivity'] → elements.goreSensitivity
     * - slider = <input id="goreSensitivity">
     *
     * 왜 이렇게 하나요?
     * - 10개 카테고리마다 동일한 패턴 (Sensitivity, Value)
     * - 함수 하나로 모든 슬라이더 처리 (코드 중복 제거)
     * - 유지보수 용이 (새 카테고리 추가 시 함수 수정 불필요)
     *
     * 실생활 비유:
     * "설문지 작성:
     *  - 질문 1~10번까지 동일한 형식 (만족도 1~5)
     *  - 함수 하나로 모든 질문 처리
     *  - setAnswer(questionNum, value) 패턴"
     *
     * @param {string} name - 슬라이더 이름 ('gore', 'violence', ...)
     * @param {number} value - 값 (0-100)
     */
    function setSliderValue(name, value) {
        // ========================================
        // Template Literal로 동적 속성 접근
        // ========================================
        // 예: name = 'gore'
        // slider = elements['goreSensitivity'] = <input id="goreSensitivity">
        const slider  = elements[`${name}Sensitivity`];
        const display = elements[`${name}Value`];

        // ========================================
        // 요소 존재 확인 (방어적 프로그래밍)
        // ========================================
        // HTML에서 해당 id가 없으면 null (에러 방지)
        if (slider && display) {
            // 슬라이더 값 설정 (0-100)
            slider.value = value;

            // 값 표시 업데이트 (예: "80%")
            display.textContent = `${value}%`;
        }
    }

    /**
     * ========================================
     * UI에서 설정 수집 (저장 버튼 클릭 시)
     * ========================================
     *
     * 역방향 변환:
     * - UI 값 (슬라이더 0-100, 체크박스 true/false) → 설정 객체
     * - 설정 객체를 chrome.storage.local에 저장
     *
     * 데이터 변환:
     * - 슬라이더 값: 80 (HTML) → 0.8 (설정, ÷100)
     * - 체크박스: checked (boolean)
     * - 텍스트: trim() (공백 제거)
     * - 숫자: parseInt() / parseFloat() (문자열 → 숫자)
     *
     * 왜 parseInt(..., 10)인가요?
     * - 두 번째 인자: 진법 (10진수)
     * - 생략하면 자동 추론 (위험함)
     * - 예: parseInt('08') → 8 (10진수) vs 0 (8진수, 옛날 JS)
     *
     * @returns {object} 설정 객체
     */
    function collectSettingsFromUI() {
        return {
            // ========================================
            // 동작 설정 (체크박스)
            // ========================================
            enabled:           true,  // 확장 활성화 (항상 true, 비활성화는 팝업에서)
            autoScan:          elements.autoScan.checked,           // true/false
            onlyWithThumbnail: elements.onlyWithThumbnail.checked,  // true/false
            autoHideDanger:    elements.autoHideDanger.checked,     // true/false
            cacheEnabled:      elements.cacheEnabled.checked,       // true/false
            cacheDuration:     24 * 60 * 60 * 1000,                 // 24시간 (밀리초)
            debugMode:         elements.debugMode.checked,          // true/false
            replaceAllImages:  elements.replaceAllImages.checked,   // true/false

            // ========================================
            // 민감도 설정 (슬라이더 0-100 → 0.0-1.0)
            // ========================================
            // parseInt(value, 10): 문자열 → 정수 (10진수)
            // ÷ 100: 0-100 → 0.0-1.0
            //
            // 예: slider.value = "80" (HTML은 항상 문자열)
            //  → parseInt("80", 10) = 80
            //  → 80 / 100 = 0.8
            sensitivity: {
                gore:           parseInt(elements.goreSensitivity.value, 10) / 100,
                violence:       parseInt(elements.violenceSensitivity.value, 10) / 100,
                death:          parseInt(elements.deathSensitivity.value, 10) / 100,
                disturbing:     parseInt(elements.disturbingSensitivity.value, 10) / 100,
                insects:        parseInt(elements.insectsSensitivity.value, 10) / 100,
                medical:        parseInt(elements.medicalSensitivity.value, 10) / 100,
                shock:          parseInt(elements.shockSensitivity.value, 10) / 100,
                animal_cruelty: parseInt(elements.animalCrueltySensitivity.value, 10) / 100,
                nsfw_porn:      parseInt(elements.nsfwPornSensitivity.value, 10) / 100,
                nsfw_sexy:      parseInt(elements.nsfwSexySensitivity.value, 10) / 100
            },

            // ========================================
            // 임계값 설정 (0.0 ~ 1.0)
            // ========================================
            // parseFloat(): 문자열 → 실수 (소수점 포함)
            // 예: "0.3" → 0.3
            thresholds: {
                safeMax:    parseFloat(elements.safeMaxThreshold.value),     // 0.3
                cautionMax: parseFloat(elements.cautionMaxThreshold.value)   // 0.6
            },

            // ========================================
            // AI API 설정
            // ========================================
            // trim(): 앞뒤 공백 제거
            // 예: "  sk-abc123  " → "sk-abc123"
            apis: {
                geminiFlash: {
                    enabled:  elements.geminiFlashEnabled.checked,             // true/false
                    apiKey:   elements.geminiFlashApiKey.value.trim(),         // 공백 제거
                    priority: parseInt(elements.geminiFlashPriority.value, 10) // 1, 2, 3
                },
                claudeHaiku: {
                    enabled:  elements.claudeHaikuEnabled.checked,
                    apiKey:   elements.claudeHaikuApiKey.value.trim(),
                    priority: parseInt(elements.claudeHaikuPriority.value, 10)
                },
                gpt4oMini: {
                    enabled:  elements.gpt4oMiniEnabled.checked,
                    apiKey:   elements.gpt4oMiniApiKey.value.trim(),
                    priority: parseInt(elements.gpt4oMiniPriority.value, 10)
                }
            }
        };
    }

    /**
     * 이벤트를 바인딩한다
     */
    function bindEvents() {
        /** 민감도 슬라이더 실시간 업데이트 */
        const sliders = [
            'gore',
            'violence',
            'death',
            'disturbing',
            'insects',
            'medical',
            'shock',
            'animalCruelty',
            'nsfwPorn',
            'nsfwSexy'
        ];

        sliders.forEach(name => {
            const slider  = elements[`${name}Sensitivity`];
            const display = elements[`${name}Value`];

            if (slider && display) {
                slider.addEventListener('input', () => {
                    display.textContent = `${slider.value}%`;
                });
            }
        });

        /** 저장 버튼 */
        elements.btnSave.addEventListener('click', async () => {
            const settings = collectSettingsFromUI();
            await sendMessage({
                type:     'UPDATE_SETTINGS',
                settings: settings
            });
            showToast('설정이 저장되었습니다.');
        });

        /** 기본값 복원 버튼 */
        elements.btnReset.addEventListener('click', () => {
            if (confirm('모든 설정을 기본값으로 복원하시겠습니까?')) {
                applySettingsToUI(DEFAULT_SETTINGS);
                showToast('기본값으로 복원되었습니다.');
            }
        });

        /** 성능 메트릭 새로고침 */
        const btnRefreshMetrics = document.getElementById('btnRefreshMetrics');
        if (btnRefreshMetrics) {
            btnRefreshMetrics.addEventListener('click', async () => {
                btnRefreshMetrics.textContent = '⏳ 로딩...';
                btnRefreshMetrics.disabled = true;

                await loadPerformanceMetrics();

                btnRefreshMetrics.textContent = '🔄 새로고침';
                btnRefreshMetrics.disabled = false;
            });
        }
    }

    /**
     * 토스트 알림을 표시한다
     * @param {string} message - 메시지
     */
    function showToast(message) {
        const toast   = elements.toast;
        const msgSpan = toast.querySelector('.toast__message');

        msgSpan.textContent = message;
        toast.classList.add('toast--visible');

        setTimeout(() => {
            toast.classList.remove('toast--visible');
        }, 3000);
    }

    /**
     * ========================================
     * 설정 객체를 재귀적으로 병합 (Deep Merge)
     * ========================================
     *
     * Deep Merge란?
     * - 중첩된 객체까지 모두 병합
     * - Shallow Merge (얕은 병합)와 차이:
     *
     * Shallow Merge (Object.assign 또는 Spread):
     * ```javascript
     * const defaults  = { a: 1, b: { x: 10, y: 20 } };
     * const overrides = { b: { x: 99 } };
     * const result    = { ...defaults, ...overrides };
     * // result = { a: 1, b: { x: 99 } }  ← y: 20 사라짐 (b 전체 교체)
     * ```
     *
     * Deep Merge (이 함수):
     * ```javascript
     * const result = mergeSettings(defaults, overrides);
     * // result = { a: 1, b: { x: 99, y: 20 } }  ← y: 20 유지 (재귀 병합)
     * ```
     *
     * 왜 Deep Merge가 필요한가요?
     * - chrome.storage.local에 일부 설정만 저장될 수 있음
     * - 예: sensitivity.gore만 변경, 나머지는 기본값 사용
     * - Shallow Merge는 sensitivity 전체를 교체 → 다른 카테고리 사라짐
     * - Deep Merge는 sensitivity.gore만 교체, 나머지 유지
     *
     * 재귀 동작 과정:
     * 1. defaults를 복사 (Spread Operator)
     * 2. overrides의 각 키 순회
     * 3. 값이 객체면 재귀 호출 (Deep Merge)
     * 4. 값이 원시값이면 덮어쓰기 (Shallow Merge)
     *
     * 실생활 비유:
     * "설정 파일 업데이트:
     *  - 기본 설정: 100개 항목
     *  - 사용자 설정: 5개 항목만 변경
     *  - Deep Merge: 5개만 덮어쓰고 95개는 유지
     *  - Shallow Merge: 100개 전부 새로 설정해야 함"
     *
     * @param {object} defaults - 기본 설정 (기준)
     * @param {object} overrides - 덮어쓸 설정 (우선순위 높음)
     * @returns {object} 병합된 설정 객체
     */
    function mergeSettings(defaults, overrides) {
        // ========================================
        // 1단계: defaults를 복사 (Spread Operator)
        // ========================================
        // { ...defaults }: 얕은 복사 (1단계만 복사)
        // result는 defaults와 독립적인 객체 (원본 수정 안 됨)
        const result = { ...defaults };

        // ========================================
        // 2단계: overrides의 각 키 순회
        // ========================================
        // for...in: 객체의 모든 키 순회
        for (const key in overrides) {
            // ========================================
            // hasOwnProperty 확인 (방어적 프로그래밍)
            // ========================================
            // 프로토타입 체인의 속성은 무시 (자신의 속성만)
            // 예: toString, valueOf 같은 내장 메서드 제외
            if (overrides.hasOwnProperty(key)) {

                // ========================================
                // 3단계: 값의 타입 확인
                // ========================================
                // typeof overrides[key] === 'object': 객체 또는 null
                // overrides[key] !== null: null 제외
                // !Array.isArray(...): 배열 제외 (배열은 덮어쓰기)
                //
                // 왜 배열은 제외하나요?
                // - 배열 병합은 복잡함 (요소 순서, 중복 등)
                // - 이 프로젝트에서는 배열 설정 없음
                // - 배열은 통째로 덮어쓰기 (Shallow Merge)
                if (typeof overrides[key] === 'object' &&
                    overrides[key] !== null &&
                    !Array.isArray(overrides[key])) {

                    // ========================================
                    // 재귀 호출 (Deep Merge)
                    // ========================================
                    // defaults[key] || {}: 기본값이 없으면 빈 객체
                    // 예: sensitivity.gore 병합
                    //  → mergeSettings(defaults.sensitivity.gore, overrides.sensitivity.gore)
                    result[key] = mergeSettings(defaults[key] || {}, overrides[key]);

                } else {
                    // ========================================
                    // 원시값 덮어쓰기 (Shallow Merge)
                    // ========================================
                    // 숫자, 문자열, 불린, null 등은 통째로 교체
                    result[key] = overrides[key];
                }
            }
        }

        // ========================================
        // 4단계: 병합된 결과 반환
        // ========================================
        return result;
    }

    /**
     * 성능 메트릭을 로드한다
     */
    async function loadPerformanceMetrics() {
        try {
            // 성능 메트릭 가져오기
            const metrics = await sendMessage({ type: 'GET_PERFORMANCE_METRICS' });
            const timeoutStats = await sendMessage({ type: 'GET_TIMEOUT_STATS' });
            const healthStatus = await sendMessage({ type: 'GET_HEALTH_STATUS' });
            const resourceStats = await sendMessage({ type: 'GET_RESOURCE_STATS' });
            const memoryStats = await sendMessage({ type: 'GET_MEMORY_STATS' });

            // 메트릭 표시
            displayCacheMetrics(metrics);
            displayAnalysisMetrics(metrics);
            displayTimeoutStats(timeoutStats);
            displayResourceMetrics(metrics);
            displayHealthStatus(healthStatus);
            displayMemoryStats(memoryStats);
            displayResourceStats(resourceStats);

            console.log('[Options] 성능 메트릭 로드 완료:', { metrics, timeoutStats, healthStatus, resourceStats, memoryStats });
        } catch (error) {
            console.error('[Options] 성능 메트릭 로드 실패:', error);
        }
    }

    /**
     * 캐시 메트릭 표시
     */
    function displayCacheMetrics(metrics) {
        const hitRate = metrics?.cacheHitRate || 0;
        const entries = metrics?.cacheEntries || 0;
        const avgAccess = metrics?.avgAccessCount || 0;

        document.getElementById('metricCacheHitRate').textContent = `${(hitRate * 100).toFixed(1)}%`;
        document.getElementById('metricCacheEntries').textContent = entries;
        document.getElementById('metricAvgAccess').textContent = avgAccess.toFixed(1);

        // 색상 적용
        const hitRateEl = document.getElementById('metricCacheHitRate');
        if (hitRate >= 0.8) {
            hitRateEl.className = 'metric-card__value positive';
        } else if (hitRate >= 0.5) {
            hitRateEl.className = 'metric-card__value warning';
        } else {
            hitRateEl.className = 'metric-card__value';
        }
    }

    /**
     * 분석 메트릭 표시
     */
    function displayAnalysisMetrics(metrics) {
        const avgAnalysis = metrics?.avgAnalysisTime || 0;
        const avgHash = metrics?.avgHashTime || 0;
        const totalAnalysis = metrics?.totalAnalysis || 0;

        document.getElementById('metricAvgAnalysis').textContent = `${avgAnalysis.toFixed(0)}ms`;
        document.getElementById('metricAvgHash').textContent = `${avgHash.toFixed(0)}ms`;
        document.getElementById('metricTotalAnalysis').textContent = totalAnalysis;

        // 색상 적용 (분석 시간)
        const analysisEl = document.getElementById('metricAvgAnalysis');
        if (avgAnalysis <= 200) {
            analysisEl.className = 'metric-card__value positive';
        } else if (avgAnalysis <= 600) {
            analysisEl.className = 'metric-card__value warning';
        } else {
            analysisEl.className = 'metric-card__value danger';
        }
    }

    /**
     * 적응형 타임아웃 통계 표시
     */
    function displayTimeoutStats(timeoutStats) {
        const container = document.getElementById('timeoutStats');

        if (!timeoutStats || !timeoutStats.enabled) {
            container.innerHTML = '<p class="timeout-disabled">적응형 타임아웃이 비활성화되어 있습니다.</p>';
            return;
        }

        const endpoints = timeoutStats.endpoints || {};
        const endpointKeys = Object.keys(endpoints);

        if (endpointKeys.length === 0) {
            container.innerHTML = '<p class="loading-message">아직 API 호출 기록이 없습니다.</p>';
            return;
        }

        let html = '';
        for (const [endpoint, stats] of Object.entries(endpoints)) {
            html += `
                <div class="timeout-endpoint">
                    <div class="timeout-endpoint__header">
                        <span>${endpoint}</span>
                        <span class="timeout-endpoint__badge">${stats.count}회 호출</span>
                    </div>
                    <div class="timeout-endpoint__stats">
                        <div class="timeout-stat">
                            <span class="timeout-stat__label">평균</span>
                            <span class="timeout-stat__value">${stats.mean}ms</span>
                        </div>
                        <div class="timeout-stat">
                            <span class="timeout-stat__label">표준편차</span>
                            <span class="timeout-stat__value">${stats.stdDev}ms</span>
                        </div>
                        <div class="timeout-stat">
                            <span class="timeout-stat__label">타임아웃</span>
                            <span class="timeout-stat__value">${stats.timeout}ms</span>
                        </div>
                        <div class="timeout-stat">
                            <span class="timeout-stat__label">범위</span>
                            <span class="timeout-stat__value">${stats.min}-${stats.max}ms</span>
                        </div>
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;
    }

    /**
     * 리소스 메트릭 표시
     */
    function displayResourceMetrics(metrics) {
        const imageOptimization = metrics?.imageOptimization || 0;
        const prefetchHit = metrics?.prefetchHit || 0;
        const avgResponse = metrics?.avgResponseTime || 0;

        document.getElementById('metricImageOptimization').textContent = `${(imageOptimization * 100).toFixed(0)}%`;
        document.getElementById('metricPrefetchHit').textContent = `${(prefetchHit * 100).toFixed(1)}%`;
        document.getElementById('metricAvgResponse').textContent = `${avgResponse.toFixed(0)}ms`;

        // 색상 적용
        const optimizationEl = document.getElementById('metricImageOptimization');
        if (imageOptimization >= 0.8) {
            optimizationEl.className = 'metric-card__value positive';
        } else if (imageOptimization >= 0.5) {
            optimizationEl.className = 'metric-card__value warning';
        } else {
            optimizationEl.className = 'metric-card__value';
        }

        const responseEl = document.getElementById('metricAvgResponse');
        if (avgResponse <= 100) {
            responseEl.className = 'metric-card__value positive';
        } else if (avgResponse <= 600) {
            responseEl.className = 'metric-card__value warning';
        } else {
            responseEl.className = 'metric-card__value danger';
        }
    }

    /**
     * 건강 상태 표시
     */
    function displayHealthStatus(health) {
        if (!health) {
            return;
        }

        const status = health.status || 'unknown';
        const totalErrors = health.totalErrors || 0;
        const recentErrors = health.recentErrors || 0;
        const errorRate = (health.errorRate || 0) * 100;
        const activeRetries = health.activeRetries || 0;

        // 상태 아이콘 및 텍스트
        const iconEl = document.getElementById('healthIcon');
        const textEl = document.getElementById('healthStatusText');

        switch (status) {
            case 'healthy':
                iconEl.textContent = '✅';
                textEl.textContent = '정상';
                textEl.className = 'health-indicator__value healthy';
                break;
            case 'degraded':
                iconEl.textContent = '⚠️';
                textEl.textContent = '성능 저하';
                textEl.className = 'health-indicator__value degraded';
                break;
            case 'critical':
                iconEl.textContent = '🔴';
                textEl.textContent = '심각';
                textEl.className = 'health-indicator__value critical';
                break;
            default:
                iconEl.textContent = '❓';
                textEl.textContent = '알 수 없음';
                textEl.className = 'health-indicator__value';
        }

        // 통계 표시
        document.getElementById('healthTotalErrors').textContent = totalErrors;
        document.getElementById('healthRecentErrors').textContent = recentErrors;
        document.getElementById('healthErrorRate').textContent = `${errorRate.toFixed(1)}%`;
        document.getElementById('healthActiveRetries').textContent = activeRetries;
    }

    /**
     * 메모리 통계 표시
     */
    function displayMemoryStats(memory) {
        if (!memory) {
            document.getElementById('memoryUsage').textContent = '측정 불가';
            document.getElementById('memoryDetails').textContent = '이 브라우저는 메모리 측정을 지원하지 않습니다.';
            return;
        }

        const usagePercent = parseFloat(memory.usagePercent) || 0;
        const usedMB = memory.usedMB;
        const limitMB = memory.limitMB;
        const trend = memory.trend || '0%';

        // 메모리 사용량 표시
        const usageEl = document.getElementById('memoryUsage');
        usageEl.textContent = `${usagePercent.toFixed(1)}%`;

        // 색상 적용
        if (usagePercent < 50) {
            usageEl.className = 'memory-usage__value healthy';
        } else if (usagePercent < 80) {
            usageEl.className = 'memory-usage__value warning';
        } else {
            usageEl.className = 'memory-usage__value critical';
        }

        // 프로그레스 바
        const barEl = document.getElementById('memoryBar');
        barEl.style.width = `${usagePercent}%`;

        if (usagePercent < 50) {
            barEl.className = 'memory-usage__fill';
        } else if (usagePercent < 80) {
            barEl.className = 'memory-usage__fill warning';
        } else {
            barEl.className = 'memory-usage__fill critical';
        }

        // 상세 정보
        document.getElementById('memoryDetails').textContent =
            `사용 중: ${usedMB} MB / 제한: ${limitMB} MB | 증가율: ${trend}`;
    }

    /**
     * 리소스 통계 표시
     */
    function displayResourceStats(resources) {
        if (!resources) {
            return;
        }

        document.getElementById('resourceTimers').textContent = resources.timers || 0;
        document.getElementById('resourceListeners').textContent = resources.listeners || 0;
        document.getElementById('resourceObservers').textContent = resources.observers || 0;
        document.getElementById('resourceWorkers').textContent = resources.workers || 0;
    }

    /**
     * ========================================
     * Service Worker에 메시지 전송 (Promise 패턴)
     * ========================================
     *
     * content.js의 loadSettings()와 동일한 패턴:
     * - chrome.runtime.sendMessage()는 콜백 기반
     * - Promise로 감싸서 async/await 사용 가능
     *
     * 동작 흐름:
     * 1. Options Page → Service Worker: 메시지 전송
     * 2. Service Worker: 메시지 타입에 따라 처리
     * 3. Service Worker → Options Page: 응답 반환
     * 4. Promise resolve: async 함수에서 await 가능
     *
     * 메시지 타입 예시:
     * - GET_SETTINGS: 설정 조회
     * - UPDATE_SETTINGS: 설정 저장
     * - GET_PERFORMANCE_METRICS: 성능 메트릭 조회
     * - GET_TIMEOUT_STATS: 타임아웃 통계 조회
     *
     * 에러 처리:
     * - chrome.runtime.lastError: 메시지 전송 실패
     *   * Extension context invalidated: 확장 재로드됨
     *   * Could not establish connection: Service Worker 죽음
     * - 에러 시 null 반환 (호출자가 처리)
     *
     * 실생활 비유:
     * "고객센터에 전화:
     *  1. 전화 걸기 (메시지 전송)
     *  2. 상담원 응답 대기 (비동기)
     *  3. 답변 받기 (resolve)
     *  4. 연결 실패하면 null 반환 (lastError)"
     *
     * @param {object} message - 메시지 객체 { type: '...', ... }
     * @returns {Promise<any>} 응답 객체 또는 null (에러 시)
     */
    function sendMessage(message) {
        // ========================================
        // Promise로 콜백 감싸기 (async/await 사용 가능)
        // ========================================
        return new Promise((resolve) => {
            // ========================================
            // Service Worker에 메시지 전송
            // ========================================
            // message: { type: 'GET_SETTINGS' } 등
            // response: Service Worker가 보낸 응답
            chrome.runtime.sendMessage(message, (response) => {
                // ========================================
                // 에러 확인 (메시지 전송 실패)
                // ========================================
                // chrome.runtime.lastError:
                // - Extension context invalidated: 확장 재로드됨
                // - Could not establish connection: Service Worker 죽음
                if (chrome.runtime.lastError) {
                    console.error('[Kas-Free] Message error:', chrome.runtime.lastError);
                    resolve(null);  // 에러 시 null 반환 (reject 대신 resolve)
                    return;
                }

                // ========================================
                // 정상 응답 반환
                // ========================================
                // response: Service Worker가 보낸 데이터
                // 예: { success: true, settings: {...} }
                resolve(response);
            });
        });
    }

    /**
     * ========================================
     * 초기화 실행 (페이지 로드 시)
     * ========================================
     *
     * DOMContentLoaded 이벤트:
     * - DOM이 완전히 로드되면 발생
     * - 이미지, 스타일시트는 로드 안 되어도 발생
     * - window.onload보다 빠름 (권장)
     *
     * initialize() 함수 호출:
     * 1. loadVersion(): manifest.json에서 버전 가져오기
     * 2. loadSettings(): chrome.storage에서 설정 로드
     * 3. bindEvents(): 버튼 클릭 이벤트 등록
     * 4. loadPerformanceMetrics(): 성능 메트릭 조회
     */
    document.addEventListener('DOMContentLoaded', initialize);

})();  // IIFE 종료
