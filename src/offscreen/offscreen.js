/**
 * Offscreen Document for NSFW.js Analysis
 * @author 최진호
 * @date 2026-01-31
 * @remarks DOM API가 필요한 NSFW.js 분석을 처리
 */

console.log('[Kas-Free Offscreen] 스크립트 로드됨');
console.log('[Kas-Free Offscreen] TensorFlow.js 로드 여부:', typeof tf !== 'undefined');
console.log('[Kas-Free Offscreen] NSFW.js 로드 여부:', typeof nsfwjs !== 'undefined');

/** NSFW.js 모델 및 상태 */
let model = null;
let isLoading = false;
let isLoaded = false;
let loadError = null;

/**
 * NSFW.js 모델 로드
 */
async function loadModel() {
    if (isLoaded) {
        console.log('[Kas-Free Offscreen] 모델 이미 로드됨');
        return true;
    }

    if (isLoading) {
        console.log('[Kas-Free Offscreen] 모델 로딩 중...');
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if (isLoaded) {
                    clearInterval(checkInterval);
                    resolve(true);
                }
            }, 100);
        });
    }

    isLoading = true;

    try {
        console.log('[Kas-Free Offscreen] NSFW.js 모델 로딩 시작...');

        // TensorFlow.js 확인
        if (typeof tf === 'undefined') {
            throw new Error('TensorFlow.js가 로드되지 않았습니다.');
        }

        // nsfwjs 확인
        if (typeof nsfwjs === 'undefined') {
            throw new Error('nsfwjs 라이브러리가 로드되지 않았습니다.');
        }

        console.log('[Kas-Free Offscreen] TensorFlow.js 버전:', tf.version.tfjs);
        console.log('[Kas-Free Offscreen] 현재 백엔드:', tf.getBackend());

        // WASM 백엔드 설정 시도 (CSP 'unsafe-eval' 없이 작동)
        try {
            if (typeof tf.setBackend === 'function') {
                await tf.setBackend('wasm');
                await tf.ready();
                console.log('[Kas-Free Offscreen] WASM 백엔드 설정 완료');
            }
        } catch (backendError) {
            console.warn('[Kas-Free Offscreen] WASM 백엔드 설정 실패, 기본 백엔드 사용:', backendError);
        }

        // CDN에서 사전 훈련된 모델 로드 (로컬 model.json 오류 회피)
        console.log('[Kas-Free Offscreen] CDN에서 기본 모델 로드 시도...');
        model = await nsfwjs.load();

        isLoaded = true;
        isLoading = false;

        console.log('[Kas-Free Offscreen] NSFW.js 모델 로드 완료');
        loadError = null;
        return true;
    } catch (error) {
        isLoading = false;
        loadError = error.message;
        console.error('[Kas-Free Offscreen] 모델 로드 실패:', error);
        console.error('[Kas-Free Offscreen] 에러 메시지:', error.message);
        console.error('[Kas-Free Offscreen] 에러 스택:', error.stack);
        throw error;
    }
}

/**
 * 이미지 분석
 */
async function analyzeImage(imageUrl) {
    console.log('[Kas-Free Offscreen] 이미지 분석 시작:', imageUrl);

    if (!isLoaded) {
        await loadModel();
    }

    try {
        // 이미지 로드
        const img = await loadImage(imageUrl);
        console.log('[Kas-Free Offscreen] 이미지 로드 완료');

        // NSFW.js 분석
        const predictions = await model.classify(img);
        console.log('[Kas-Free Offscreen] 분석 완료:', predictions);

        // 결과 변환
        const result = transformResult(predictions);
        return result;
    } catch (error) {
        console.error('[Kas-Free Offscreen] 분석 실패:', error);
        throw error;
    }
}

/**
 * 이미지 로드
 */
function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();

        // CORS 우회: 디시인사이드는 CORS를 허용하지 않으므로
        // crossOrigin을 설정하지 않음 (같은 출처로 처리)
        // img.crossOrigin = 'anonymous';

        img.onload = () => {
            console.log('[Kas-Free Offscreen] 이미지 로드 성공:', img.width, 'x', img.height);
            resolve(img);
        };

        img.onerror = (error) => {
            console.error('[Kas-Free Offscreen] 이미지 로드 에러:', error);
            reject(new Error('이미지 로드 실패: ' + url));
        };

        // 타임아웃 설정 (10초)
        setTimeout(() => {
            if (!img.complete) {
                reject(new Error('이미지 로드 타임아웃'));
            }
        }, 10000);

        console.log('[Kas-Free Offscreen] 이미지 로딩 시작:', url);
        img.src = url;
    });
}

/**
 * NSFW.js 결과를 변환
 */
function transformResult(predictions) {
    const categories = {};
    predictions.forEach(p => {
        categories[p.className.toLowerCase()] = p.probability;
    });

    // 위험도 계산 (간단한 버전)
    const goreViolence = 0; // NSFW.js는 gore/violence 미지원
    const disturbing = 0;
    const porn = categories.porn || 0;
    const hentai = categories.hentai || 0;
    const sexy = categories.sexy || 0;

    // 민감도 기본값 적용
    const sensitivity = {
        goreViolence: 0.8,
        disturbing: 0.8,
        porn: 0.3,
        hentai: 0.3,
        sexy: 0.2
    };

    const riskScore = Math.max(
        goreViolence * sensitivity.goreViolence,
        disturbing * sensitivity.disturbing,
        porn * sensitivity.porn,
        hentai * sensitivity.hentai,
        sexy * sensitivity.sexy
    );

    return {
        riskScore,
        categories: {
            goreViolence,
            disturbing,
            porn,
            hentai,
            sexy,
            drawing: categories.drawing || 0,
            neutral: categories.neutral || 0
        },
        source: 'nsfwjs',
        rawPredictions: predictions
    };
}

/**
 * 메시지 핸들러
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { type } = message;

    console.log('[Kas-Free Offscreen] 메시지 수신:', type);

    if (type === 'ANALYZE_IMAGE_NSFWJS') {
        analyzeImage(message.imageUrl)
            .then(result => {
                console.log('[Kas-Free Offscreen] 분석 성공, 결과 전송');
                sendResponse(result);
            })
            .catch(error => {
                console.error('[Kas-Free Offscreen] 분석 에러:', error);
                sendResponse({ error: error.message });
            });
        return true; // 비동기 응답
    }

    if (type === 'PING_OFFSCREEN') {
        console.log('[Kas-Free Offscreen] PING 요청');
        console.log('[Kas-Free Offscreen] - 모델 로드됨:', isLoaded);
        console.log('[Kas-Free Offscreen] - 로딩 중:', isLoading);
        console.log('[Kas-Free Offscreen] - 로드 에러:', loadError);
        console.log('[Kas-Free Offscreen] - tf 존재:', typeof tf !== 'undefined');
        console.log('[Kas-Free Offscreen] - nsfwjs 존재:', typeof nsfwjs !== 'undefined');

        sendResponse({
            status: 'ready',
            modelLoaded: isLoaded,
            modelLoading: isLoading,
            error: loadError,
            tfLoaded: typeof tf !== 'undefined',
            nsfwjsLoaded: typeof nsfwjs !== 'undefined'
        });
        return false;
    }

    sendResponse({ error: '알 수 없는 메시지 타입' });
    return false;
});

/** 초기화 실행 */
console.log('[Kas-Free Offscreen] 초기화 시작');
loadModel().catch(error => {
    console.error('[Kas-Free Offscreen] 초기 로드 실패:', error);
});
