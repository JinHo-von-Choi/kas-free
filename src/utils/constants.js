/**
 * ========================================
 * 카-스 프리 (Kas-Free) 상수 정의
 * ========================================
 *
 * 이 파일은 무엇인가요?
 * - 프로그램 전체에서 사용하는 고정된 값들을 한 곳에 모아둔 파일
 * - 매직 넘버 방지 (코드에 숫자 직접 쓰지 않음)
 * - 값 변경 시 한 곳만 수정하면 됨
 *
 * 왜 상수를 쓰나요?
 * - 코드 가독성 향상
 * - 실수 방지 (오타 등)
 * - 유지보수 용이
 *
 * 실생활 비유:
 * "가게 메뉴판:
 *  - 음료 가격: 3000원 (상수)
 *  - 모든 직원이 이 가격 사용
 *  - 가격 변경 시 메뉴판만 바꾸면 됨"
 *
 * @author 최진호
 * @date 2026-01-31
 * @version 1.0.0
 */

/**
 * ========================================
 * 디시인사이드 DOM 선택자
 * ========================================
 *
 * DOM 선택자란?
 * - HTML 요소를 찾기 위한 패턴
 * - document.querySelector()에서 사용
 *
 * 왜 상수로 분리하나요?
 * - 디시인사이드가 HTML 구조를 바꾸면
 * - 이 파일만 수정하면 전체 코드가 고쳐짐
 *
 * 실생활 비유:
 * "백화점 안내:
 *  - 화장품은 1층 (선택자)
 *  - 층수가 바뀌면 안내판만 바꾸면 됨"
 */
export const DC_SELECTORS = {
    // ========================================
    // 목록 페이지 (갤러리 리스트)
    // ========================================
    /**
     * 게시글 테이블
     * 모든 게시글이 담긴 <table> 요소
     */
    POST_TABLE:           'table.gall_list',

    /**
     * 게시글 행 (<tr> 요소)
     * 각 게시글이 하나의 행
     */
    POST_ROW:             'tr.ub-content.us-post',

    /**
     * 이미지가 있는 게시글 행
     * data-type 속성으로 구분
     * - icon_pic: 일반 이미지
     * - icon_recomimg: 추천 이미지
     * - icon_movie: 동영상
     */
    POST_ROW_WITH_IMAGE:  'tr.ub-content.us-post[data-type="icon_pic"], tr.ub-content.us-post[data-type="icon_recomimg"], tr.ub-content.us-post[data-type="icon_movie"]',

    /**
     * 제목 셀 (<td> 요소)
     * 게시글 제목이 있는 칸
     */
    TITLE_CELL:           'td.gall_tit',

    /**
     * 제목 링크 (<a> 요소)
     * 클릭하면 게시글로 이동
     */
    TITLE_LINK:           'td.gall_tit a[href*="board/view"]',

    /**
     * 이미지 아이콘
     * 썸네일 표시
     */
    ICON_IMG:             'em.icon_img',

    // ========================================
    // 상세 페이지 (게시글 본문)
    // ========================================
    /**
     * 본문 전체 영역
     */
    CONTENT_WRAP:         '.gallview_contents',

    /**
     * 글 내용 박스
     */
    WRITING_BOX:          '.writing_view_box',

    /**
     * 글 본문 영역
     */
    WRITE_DIV:            '.write_div',

    /**
     * 이미지 영역
     */
    IMAGE_AREA:           '.img_area',

    /**
     * 이미지 래퍼
     */
    IMGWRAP:              '.imgwrap',

    /**
     * 본문 이미지 (메인)
     * data-fileno 속성이 있는 이미지
     * → 가장 확실한 선택자
     */
    CONTENT_IMAGE:        '.writing_view_box img[data-fileno]',

    /**
     * 본문 이미지 (폴백)
     * viewimage.php가 포함된 이미지
     * → CONTENT_IMAGE로 못 찾을 때 사용
     */
    CONTENT_IMAGE_ALT:    '.writing_view_box img[src*="viewimage.php"]',

    /**
     * 디시콘 (이모티콘)
     * 분석 대상에서 제외
     */
    DCCON:                'img.written_dccon',

    /**
     * 광고 영역
     * 분석 대상에서 제외
     */
    AD_AREA:              '#zzbang_div',

    /**
     * 광고 이미지
     * 분석 대상에서 제외
     */
    AD_IMAGE:             '#zzbang_div img',

    // ========================================
    // 메타 태그
    // ========================================
    /**
     * OG 이미지 (Open Graph)
     * 게시글 대표 이미지
     * <meta property="og:image" content="...">
     */
    OG_IMAGE:             'meta[property="og:image"]'
};

/** URL 패턴 */
export const DC_URL_PATTERNS = {
    GALLERY_LIST:         /gall\.dcinside\.com\/(mgallery|mini)?\/board\/lists/,
    GALLERY_VIEW:         /gall\.dcinside\.com\/(mgallery|mini)?\/board\/view/,
    VIEW_IMAGE:           /dcimg[0-9]\.dcinside\.(com|co\.kr)\/viewimage\.php/
};

/** 게시글 타입 */
export const POST_TYPES = {
    ICON_PIC:             'icon_pic',
    ICON_TXT:             'icon_txt',
    ICON_NOTICE:          'icon_notice',
    ICON_RECOMIMG:        'icon_recomimg',
    ICON_MOVIE:           'icon_movie'
};

/** 신호등 상태 */
export const SIGNAL_STATUS = {
    SAFE:                 'safe',
    CAUTION:              'caution',
    DANGER:               'danger',
    UNCHECKED:            'unchecked',
    LOADING:              'loading',
    ERROR:                'error'
};

/** 신호등 색상 */
export const SIGNAL_COLORS = {
    [SIGNAL_STATUS.SAFE]:      '#22c55e',
    [SIGNAL_STATUS.CAUTION]:   '#eab308',
    [SIGNAL_STATUS.DANGER]:    '#ef4444',
    [SIGNAL_STATUS.UNCHECKED]: '#9ca3af',
    [SIGNAL_STATUS.LOADING]:   '#3b82f6',
    [SIGNAL_STATUS.ERROR]:     '#f97316'
};

/** NSFW.js 분류 카테고리 */
export const NSFW_CATEGORIES = {
    DRAWING:              'Drawing',
    HENTAI:               'Hentai',
    NEUTRAL:              'Neutral',
    PORN:                 'Porn',
    SEXY:                 'Sexy'
};

/** 위험도 카테고리 */
export const RISK_CATEGORIES = {
    GORE:                 'gore',
    VIOLENCE:             'violence',
    DEATH:                'death',
    DISTURBING:           'disturbing',
    INSECTS:              'insects',
    MEDICAL:              'medical',
    SHOCK:                'shock',
    ANIMAL_CRUELTY:       'animal_cruelty',
    NSFW_PORN:            'nsfw_porn',
    NSFW_SEXY:            'nsfw_sexy'
};

/**
 * ========================================
 * 기본 설정값 (DEFAULT_SETTINGS)
 * ========================================
 *
 * 사용자가 설정을 변경하지 않았을 때 사용되는 기본값
 * chrome.storage.local에 저장됨
 *
 * 왜 기본값이 중요한가요?
 * - 첫 설치 시 바로 작동
 * - 설정 리셋 시 이 값으로 복구
 * - 안전한 기본값 제공
 */
export const DEFAULT_SETTINGS = {
    // ========================================
    // 기본 기능 설정
    // ========================================
    /**
     * 확장 프로그램 활성화 여부
     * true: 작동함 (기본값)
     * false: 작동 안 함
     */
    enabled:              true,

    /**
     * 자동 검사 활성화
     * true: 페이지 로드 시 자동으로 이미지 검사 (기본값)
     * false: 수동으로만 검사 (클릭해야 검사)
     */
    autoScan:             true,

    /**
     * 썸네일 있는 게시글만 검사
     * true: 이미지 아이콘이 있는 게시글만 검사 (빠름, 기본값)
     * false: 모든 게시글 검사 (느림, 비효율적)
     *
     * 왜 기본값이 true인가요?
     * - 이미지 없는 게시글을 검사하는 것은 낭비
     * - 성능 향상 (불필요한 API 호출 방지)
     */
    onlyWithThumbnail:    true,

    /**
     * 빨간 신호등 게시글 자동 숨김
     * true: 위험한 게시글을 자동으로 숨김
     * false: 신호등만 표시, 숨기지 않음 (기본값)
     *
     * 왜 기본값이 false인가요?
     * - 사용자 선택권 존중
     * - 오탐 가능성 (안전한 게시글을 잘못 숨길 수 있음)
     */
    autoHideDanger:       false,

    // ========================================
    // 캐시 설정
    // ========================================
    /**
     * 캐시 활성화 여부
     * true: 한 번 분석한 게시글은 결과 저장 (기본값)
     * false: 매번 새로 분석 (느림)
     *
     * 캐시란?
     * - 분석 결과를 저장해두었다가 재사용
     * - 같은 게시글을 다시 보면 즉시 표시
     */
    cacheEnabled:         true,

    /**
     * 캐시 유지 기간 (밀리초)
     * 24시간 × 60분 × 60초 × 1000ms = 86,400,000ms
     *
     * 왜 24시간인가요?
     * - 너무 짧으면 자주 재분석 (비효율)
     * - 너무 길면 오래된 데이터 사용
     * - 24시간이 적절한 균형
     */
    cacheDuration:        24 * 60 * 60 * 1000,

    /**
     * 디버그 모드
     * true: 상세한 로그 출력 (개발자용)
     * false: 최소 로그만 출력 (기본값, 사용자용)
     */
    debugMode:            false,

    // ========================================
    // 민감도 설정 (카테고리별)
    // ========================================
    /**
     * 각 카테고리별 민감도 (0.0 ~ 1.0)
     *
     * 의미:
     * - 이 값보다 점수가 높으면 "위험"으로 판단
     * - 예: gore: 0.8 → 고어 점수가 0.8 이상이면 빨간 신호등
     *
     * 값 범위:
     * - 0.0: 매우 관대 (거의 허용)
     * - 0.5: 보통 (중간)
     * - 1.0: 매우 엄격 (거의 차단)
     *
     * 카테고리별 설명:
     */
    sensitivity: {
        gore:             0.8,   // 고어 (피, 절단, 내장) - 높음 (엄격)
        violence:         0.8,   // 폭력 (싸움, 폭행) - 높음 (엄격)
        death:            0.8,   // 죽음 (시체, 자살) - 높음 (엄격)
        disturbing:       0.8,   // 혐오 (분변, 토사물) - 높음 (엄격)
        insects:          0.7,   // 벌레 (구더기, 벌레 떼) - 보통
        medical:          0.7,   // 의료 (수술, 주사) - 보통
        shock:            0.7,   // 충격 (놀람) - 보통
        animal_cruelty:   0.8,   // 동물 학대 - 높음 (엄격)
        nsfw_porn:        0.3,   // 음란물 - 낮음 (관대)
        nsfw_sexy:        0.2    // 선정성 - 매우 낮음 (매우 관대)
    },

    // ========================================
    // 신호등 임계값
    // ========================================
    /**
     * 최종 점수 → 신호등 색상 변환 기준
     *
     * 계산 방식:
     * - 각 카테고리 점수를 민감도와 비교
     * - 가중 평균으로 최종 점수 계산
     *
     * 변환 기준:
     * - 0.0 ~ 0.29: 초록 (safe)
     * - 0.3 ~ 0.59: 주황 (caution)
     * - 0.6 ~ 1.0: 빨강 (danger)
     */
    thresholds: {
        safeMax:          0.3,   // 이 값 미만: 초록
        cautionMax:       0.6    // safeMax 이상 ~ cautionMax 미만: 주황
                                 // cautionMax 이상: 빨강
    },

    // ========================================
    // 외부 AI API 설정
    // ========================================
    /**
     * 사용자가 "재검증" 버튼 누를 때 사용할 AI API
     *
     * 3가지 선택지:
     * 1. Gemini Flash (Google) - 빠르고 저렴
     * 2. Claude Haiku (Anthropic) - 정확하고 안전
     * 3. GPT-4o-mini (OpenAI) - 균형잡힌 성능
     *
     * 기본값: 모두 비활성화
     * - 사용자가 직접 API 키를 입력해야 활성화됨
     * - priority: 우선순위 (낮을수록 먼저 시도)
     */
    apis: {
        geminiFlash: {
            enabled:      false,    // 활성화 여부
            apiKey:       '',       // API 키 (사용자 입력)
            priority:     1         // 1순위 (가장 먼저 시도)
        },
        claudeHaiku: {
            enabled:      false,
            apiKey:       '',
            priority:     2         // 2순위
        },
        gpt4oMini: {
            enabled:      false,
            apiKey:       '',
            priority:     3         // 3순위 (마지막)
        }
    }
};

/** API 엔드포인트 */
export const API_ENDPOINTS = {
    GOOGLE_VISION:        'https://vision.googleapis.com/v1/images:annotate',
    CLAUDE:               'https://api.anthropic.com/v1/messages',
    OPENAI:               'https://api.openai.com/v1/chat/completions'
};

/** API 타임아웃 (ms) */
export const API_TIMEOUT = 10000;

/** 클라이언트 AI 분석 시스템 프롬프트 (/api/report/v2 전용) */
export const AI_ANALYSIS_PROMPT = `You are an image content analyzer. Analyze the provided image and return a JSON object with the following structure:

{
  "scores": {
    "gore": 0.0-1.0,          // 신체 훼손, 절단, 내장 노출, 피 흘림
    "violence": 0.0-1.0,      // 물리적 폭력, 폭행, 싸움
    "death": 0.0-1.0,         // 시체, 사망 장면, 자살
    "disturbing": 0.0-1.0,    // 불쾌한 이미지, 트라우마 유발, **분변(대변/똥), 토사물(구토물), 오물, 체액, 부패물, 썩은 음식, 곰팡이**
    "insects": 0.0-1.0,       // 혐오 곤충, 벌레 떼, 구더기
    "medical": 0.0-1.0,       // 수술, 주사, 의료 기구, 개방된 상처
    "shock": 0.0-1.0,         // 충격적인 콘텐츠
    "animal_cruelty": 0.0-1.0,// 동물에 대한 학대, 폭력
    "nsfw_porn": 0.0-1.0,     // 성인 콘텐츠
    "nsfw_sexy": 0.0-1.0      // 선정적 의상, 포즈
  },
  "is_harmful": true/false,
  "suggested_severity": 1-5,   // 1=매우 약함, 5=매우 심각
  "suggestedAction": "block" | "warn" | "pass",
  "final_score": 0.0-1.0,      // 전체적인 유해도
  "description": "이미지에 대한 객관적 설명",
  "reasoning": "판단 근거 설명"
}

## Action 결정 기준:
- block: final_score >= 0.7 또는 gore/death/disturbing/nsfw_porn >= 0.7
- warn: final_score >= 0.4 또는 고위험 카테고리 >= 0.4
- pass: 그 외

## 특별 지침 (CRITICAL):
**다음 항목들은 반드시 "disturbing" 카테고리에서 높은 점수(0.7-1.0)를 부여해야 합니다:**
1. 분변, 대변, 똥 (human feces, excrement, poop)
2. 토사물, 구토물 (vomit, throw up)
3. 오물, 체액 (bodily fluids, waste)
4. 부패한 음식, 썩은 음식 (rotten food, decaying food)
5. 곰팡이가 심하게 핀 물체 (moldy objects)
6. 불결하거나 비위생적인 장면 (unsanitary conditions)

**이러한 내용이 이미지의 주요 초점이거나 명확하게 보이는 경우:**
- disturbing: 0.8-1.0
- is_harmful: true
- suggestedAction: "block"
- suggested_severity: 4-5

## 판단 기준 (IMPORTANT):
**위험도 점수는 다음 두 가지 관점을 모두 고려해야 합니다:**

1. **실제 유해성 (Actual Harm)**
   - 신체적/정신적 피해를 줄 수 있는가?
   - 법적으로 문제가 되는가?
   - 예: 폭력, 고어, 성인 콘텐츠, 자살

2. **상식적 불쾌감 (Common Sense Disgust)** ⚠️ 매우 중요
   - 일반적인 인간이 보았을 때 혐오감이나 불쾌감을 느끼는가?
   - 사회적 통념상 공개 장소에서 보여줄 수 없는 내용인가?
   - 대부분의 사람들이 "보고 싶지 않다"고 느낄 내용인가?
   - 예: 분변, 토사물, 썩은 음식, 곰팡이, 불결한 장면

**중요: 실제로 유해하지 않더라도, 일반인의 관점에서 강한 혐오감을 유발하는 경우 높은 점수를 부여해야 합니다.**

예시:
- 분변 이미지: 건강상 직접적 위해는 없지만 → disturbing: 0.9 (상식적으로 매우 불쾌함)
- 토사물: 전염병 위험은 낮지만 → disturbing: 0.9 (누구나 보기 싫어함)
- 곰팡이 핀 음식: 먹지 않으면 안전하지만 → disturbing: 0.7 (시각적으로 불쾌함)

## 중요:
- 반드시 유효한 JSON만 출력
- 모든 점수는 0.0-1.0 범위
- is_harmful은 suggestedAction이 block 또는 warn일 때 true
- "기술적으로 무해"와 "보기에 괜찮음"은 다른 개념임
- 분변/토사물/썩은 음식 등은 일반적으로 무해하다고 판단하지 말 것
- 상식적인 인간의 관점에서 혐오스럽다면 높은 점수 부여 필수`;

/** 에러 코드 */
export const ERROR_CODES = {
    RATE_LIMIT:           429,
    INSUFFICIENT_FUNDS:   402,
    UNAUTHORIZED:         401,
    TIMEOUT:              'TIMEOUT',
    NETWORK_ERROR:        'NETWORK_ERROR',
    MODEL_LOAD_FAILED:    'MODEL_LOAD_FAILED'
};

/** 메시지 타입 (Background <-> Content Script) */
export const MESSAGE_TYPES = {
    ANALYZE_IMAGE:        'ANALYZE_IMAGE',
    ANALYZE_RESULT:       'ANALYZE_RESULT',
    GET_SETTINGS:         'GET_SETTINGS',
    UPDATE_SETTINGS:      'UPDATE_SETTINGS',
    GET_STATS:            'GET_STATS',
    UPDATE_STATS:         'UPDATE_STATS',
    TOGGLE_EXTENSION:     'TOGGLE_EXTENSION'
};

/** 스토리지 키 */
export const STORAGE_KEYS = {
    SETTINGS:             'kas_settings',
    STATS:                'kas_stats',
    CACHE:                'kas_cache',
    HASH_CACHE:           'kas_hash_cache',
    PERFORMANCE_METRICS:  'performance_metrics'
};

/** 통계 초기값 */
export const DEFAULT_STATS = {
    today: {
        date:             null,
        scanned:          0,
        safe:             0,
        caution:          0,
        danger:           0
    },
    total: {
        scanned:          0,
        safe:             0,
        caution:          0,
        danger:           0
    }
};
