/**
 * 이미지 인코딩 유틸리티
 * @author 최진호
 * @date 2026-01-31
 * @version 1.1.0
 * @remarks 성능 최적화: 썸네일 우선 로딩, 자동 리사이즈
 */

/** 최적 이미지 크기 설정 */
const OPTIMAL_DIMENSIONS = {
    width: 800,      // AI가 충분히 분석 가능한 크기
    height: 800,
    quality: 0.85    // JPEG 품질
};

/**
 * 디시인사이드 이미지 URL에서 썸네일 URL을 생성한다
 * @param {string} imageUrl - 원본 이미지 URL
 * @returns {string} 썸네일 URL
 * @remarks 원본 대비 10-100배 작은 크기 (1-5MB → 10-50KB)
 */
export function getThumbnailUrl(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') {
        return imageUrl;
    }

    // 디시인사이드 viewimage.php 패턴
    if (imageUrl.includes('dcinside.com/viewimage.php') ||
        imageUrl.includes('dcinside.co.kr/viewimage.php')) {
        // type=s 파라미터 추가 (small thumbnail)
        const separator = imageUrl.includes('?') ? '&' : '?';
        return imageUrl + separator + 'type=s';
    }

    // 디시인사이드가 아닌 경우 원본 반환
    return imageUrl;
}

/**
 * 이미지 URL을 Base64로 변환한다 (하위 호환성 유지)
 * @param {string} imageUrl - 이미지 URL
 * @param {boolean} useThumbnail - 썸네일 사용 여부 (기본: true)
 * @returns {Promise<string>} Base64 인코딩된 이미지 (순수 Base64 문자열)
 */
export async function imageUrlToBase64(imageUrl, useThumbnail = true) {
    // 성능 최적화: 디시인사이드 이미지는 썸네일 우선 사용
    const optimizedUrl = useThumbnail && isDcinsideImageUrl(imageUrl)
        ? getThumbnailUrl(imageUrl)
        : imageUrl;

    console.log('[ImageEncoder] 이미지 로딩:', {
        original: imageUrl.substring(0, 100),
        optimized: optimizedUrl.substring(0, 100),
        thumbnail: useThumbnail && isDcinsideImageUrl(imageUrl)
    });

    const result = await analyzeAndEncodeImage(optimizedUrl);

    if (result.type === 'extraction') {
        // GIF 프레임 추출
        return result.extraction;
    } else if (result.type === 'base64') {
        // 일반 이미지 Base64
        return result.image;
    } else {
        // type === 'url' (fetch 실패 시 폴백)
        throw new Error('이미지를 Base64로 변환할 수 없습니다.');
    }
}

/**
 * 이미지를 분석하고 인코딩한다 (Service Worker용)
 * @param {string} imageUrl - 이미지 URL
 * @returns {Promise<object>} { type, imageUrl, extraction?, mimeType }
 */
export async function analyzeAndEncodeImage(imageUrl) {
    try {
        /**
         * Chrome Extension Service Worker는 host_permissions가 있으면
         * CORS 제한 없이 모든 URL에 접근 가능 (manifest.json의 <all_urls>)
         *
         * DC 이미지 서버 특성:
         * 1. Referer 체크를 할 수 있으므로 'no-referrer' 사용
         * 2. 쿠키 인증이 필요할 수 있으므로 credentials: 'include'
         * 3. 일반 CORS 모드로 시도 (Extension 특권으로 CORS 우회됨)
         */
        const response = await fetch(imageUrl, {
            credentials:     'include',          // 쿠키 포함 (인증된 이미지 지원)
            referrerPolicy:  'no-referrer'       // Referer 제거 (403 방지)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const blob = await response.blob();

        if (!blob || blob.size === 0) {
            throw new Error('Empty blob received');
        }

        const mimeType = blob.type || 'image/jpeg';  // MIME 타입이 없으면 JPEG로 추정

        console.log('[ImageEncoder] Fetch 성공:', {
            url: imageUrl.substring(0, 100) + '...',
            size: `${Math.round(blob.size / 1024)}KB`,
            type: mimeType
        });

        // 성능 최적화: 모든 이미지를 최적 크기로 리사이즈
        const optimizedBlob = await optimizeImageBlob(blob, mimeType);

        console.log('[ImageEncoder] 이미지 최적화 완료:', {
            original: `${Math.round(blob.size / 1024)}KB`,
            optimized: `${Math.round(optimizedBlob.size / 1024)}KB`,
            reduction: `${Math.round((1 - optimizedBlob.size / blob.size) * 100)}%`
        });

        // GIF인 경우 프레임 추출
        if (mimeType === 'image/gif' || imageUrl.toLowerCase().endsWith('.gif')) {
            console.log('[ImageEncoder] GIF 감지 - 프레임 추출 시작');
            const extractedBase64 = await extractGifFrame(optimizedBlob);

            return {
                type: 'extraction',
                imageUrl: imageUrl,
                extraction: extractedBase64.includes(',')
                    ? extractedBase64.split(',')[1]
                    : extractedBase64,
                mimeType: 'image/jpeg' // 추출된 프레임은 JPEG
            };
        }

        /**
         * 일반 이미지(JPEG, PNG 등)도 Base64로 변환
         * API 스펙상 type=default일 때 image 필드 필수
         */
        console.log('[ImageEncoder] 일반 이미지 Base64 변환 시작');
        const base64 = await blobToBase64(optimizedBlob);

        console.log('[ImageEncoder] blobToBase64 결과:', {
            length: base64.length,
            prefix: base64.substring(0, 50),
            mimeType: mimeType
        });

        const cleanBase64 = base64.includes(',')
            ? base64.split(',')[1]
            : base64;

        console.log('[ImageEncoder] 순수 Base64 추출:', {
            originalLength: base64.length,
            cleanLength: cleanBase64.length,
            cleanPrefix: cleanBase64.substring(0, 50)
        });

        return {
            type: 'base64',  // GIF 아닌 일반 이미지
            imageUrl: imageUrl,
            image: cleanBase64,
            mimeType: mimeType
        };
    } catch (error) {
        console.error('[ImageEncoder] Image encoding error:', error);

        /**
         * fetch 실패 시 URL만 반환
         * 서버에서 직접 다운로드하도록 위임
         */
        console.warn('[ImageEncoder] Fetch 실패, URL로 폴백');

        return {
            type: 'url',
            imageUrl: imageUrl,
            mimeType: 'image/jpeg'  // 추정값
        };
    }
}

/**
 * Blob을 Base64로 변환한다
 * @param {Blob} blob - Blob 객체
 * @returns {Promise<string>}
 */
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onloadend = () => {
            resolve(reader.result);
        };

        reader.onerror = () => {
            reject(new Error('Blob 변환 실패'));
        };

        reader.readAsDataURL(blob);
    });
}

/**
 * GIF에서 프레임을 추출한다 (Service Worker 호환)
 * @param {Blob} gifBlob - GIF Blob 객체
 * @returns {Promise<string>} Base64 인코딩된 JPEG 이미지
 */
async function extractGifFrame(gifBlob) {
    try {
        // Blob을 ImageBitmap으로 변환 (Service Worker 호환)
        const imageBitmap = await createImageBitmap(gifBlob);

        // OffscreenCanvas 사용 (Service Worker 호환)
        const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
        const ctx = canvas.getContext('2d');

        // ImageBitmap 그리기
        ctx.drawImage(imageBitmap, 0, 0);

        // ImageBitmap 해제
        imageBitmap.close();

        // Blob으로 변환 (JPEG, 85% 품질)
        const jpegBlob = await canvas.convertToBlob({
            type: 'image/jpeg',
            quality: 0.85
        });

        // Base64로 변환
        const dataUrl = await blobToBase64(jpegBlob);

        console.log('[ImageEncoder] GIF 프레임 추출 완료:', {
            width: canvas.width,
            height: canvas.height,
            size: Math.round(dataUrl.length / 1024) + 'KB'
        });

        return dataUrl;
    } catch (error) {
        console.error('[ImageEncoder] GIF 프레임 추출 실패:', error);
        // 실패 시 원본 GIF를 그대로 Base64로 변환
        return await blobToBase64(gifBlob);
    }
}

/**
 * Base64 데이터 URI에서 순수 Base64 문자열을 추출한다
 * @param {string} dataUri - data:image/...;base64,... 형식
 * @returns {string} 순수 Base64 문자열
 */
export function extractBase64FromDataUri(dataUri) {
    const matches = dataUri.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
        throw new Error('유효하지 않은 Data URI 형식입니다.');
    }
    return matches[2];
}

/**
 * Base64 데이터 URI에서 MIME 타입을 추출한다
 * @param {string} dataUri - data:image/...;base64,... 형식
 * @returns {string} MIME 타입
 */
export function extractMimeTypeFromDataUri(dataUri) {
    const matches = dataUri.match(/^data:([^;]+);base64,/);
    if (!matches) {
        throw new Error('유효하지 않은 Data URI 형식입니다.');
    }
    return matches[1];
}

/**
 * 이미지를 HTMLImageElement로 로드한다
 * @param {string} src - 이미지 소스 (URL 또는 Data URI)
 * @returns {Promise<HTMLImageElement>}
 */
export function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img     = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
            resolve(img);
        };

        img.onerror = () => {
            reject(new Error('이미지 로드 실패'));
        };

        img.src = src;
    });
}

/**
 * 이미지를 리사이즈한다 (분석 성능 향상용)
 * @param {HTMLImageElement} image - 이미지 엘리먼트
 * @param {number} maxSize - 최대 크기 (가로/세로 중 큰 쪽)
 * @returns {string} 리사이즈된 이미지의 Data URI
 */
export function resizeImage(image, maxSize = 512) {
    const canvas  = document.createElement('canvas');
    const ctx     = canvas.getContext('2d');

    let width     = image.naturalWidth || image.width;
    let height    = image.naturalHeight || image.height;

    /** 비율 유지하며 리사이즈 */
    if (width > maxSize || height > maxSize) {
        if (width > height) {
            height = Math.round((height * maxSize) / width);
            width  = maxSize;
        } else {
            width  = Math.round((width * maxSize) / height);
            height = maxSize;
        }
    }

    canvas.width  = width;
    canvas.height = height;

    ctx.drawImage(image, 0, 0, width, height);

    return canvas.toDataURL('image/jpeg', 0.8);
}

/**
 * 이미지 URL이 유효한지 확인한다
 * @param {string} url - 이미지 URL
 * @returns {boolean}
 */
export function isValidImageUrl(url) {
    if (!url || typeof url !== 'string') {
        return false;
    }

    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * 디시인사이드 이미지 URL인지 확인한다
 * @param {string} url - 이미지 URL
 * @returns {boolean}
 */
export function isDcinsideImageUrl(url) {
    if (!url || typeof url !== 'string') {
        return false;
    }

    const pattern = /dcimg[0-9]\.dcinside\.(com|co\.kr)\/viewimage\.php/;
    return pattern.test(url);
}

/**
 * 이미지 Blob을 최적 크기로 리사이즈한다 (Service Worker 환경)
 * @param {Blob} blob - 원본 이미지 Blob
 * @param {string} mimeType - MIME 타입
 * @returns {Promise<Blob>} 최적화된 이미지 Blob
 * @remarks OffscreenCanvas 사용으로 Service Worker에서 동작
 */
async function optimizeImageBlob(blob, mimeType) {
    try {
        // ImageBitmap으로 변환 (Service Worker 호환)
        const bitmap = await createImageBitmap(blob);

        const originalWidth  = bitmap.width;
        const originalHeight = bitmap.height;

        // 리사이즈가 필요 없는 경우 (이미 충분히 작음)
        if (originalWidth <= OPTIMAL_DIMENSIONS.width &&
            originalHeight <= OPTIMAL_DIMENSIONS.height &&
            blob.size <= 200 * 1024) {  // 200KB 이하
            bitmap.close();
            console.log('[ImageEncoder] 리사이즈 불필요 (이미 최적 크기)');
            return blob;
        }

        // 비율 유지하며 리사이즈
        const scale = Math.min(
            OPTIMAL_DIMENSIONS.width / originalWidth,
            OPTIMAL_DIMENSIONS.height / originalHeight,
            1.0  // 원본보다 크게 안 함
        );

        const targetWidth  = Math.round(originalWidth * scale);
        const targetHeight = Math.round(originalHeight * scale);

        // OffscreenCanvas 생성
        const canvas = new OffscreenCanvas(targetWidth, targetHeight);
        const ctx = canvas.getContext('2d');

        // 이미지 그리기
        ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

        // ImageBitmap 해제
        bitmap.close();

        // JPEG Blob으로 변환
        const optimizedBlob = await canvas.convertToBlob({
            type: 'image/jpeg',
            quality: OPTIMAL_DIMENSIONS.quality
        });

        console.log('[ImageEncoder] 리사이즈 완료:', {
            from: `${originalWidth}x${originalHeight}`,
            to: `${targetWidth}x${targetHeight}`,
            scale: `${Math.round(scale * 100)}%`
        });

        return optimizedBlob;
    } catch (error) {
        console.error('[ImageEncoder] 이미지 최적화 실패:', error);
        // 실패 시 원본 반환
        return blob;
    }
}
