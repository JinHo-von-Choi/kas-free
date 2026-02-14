/**
 * 이미지 신고 핸들러
 * @author 최진호
 * @date 2026-02-12
 * @version 1.1.0
 * @remarks 이미지 신고 처리 및 서버 전송
 */

import { analyzeAndEncodeImage } from '../utils/imageEncoder.js';
import { updateStats } from '../utils/storage.js';

/**
 * 이미지 신고 핸들러 클래스
 */
export class ImageReportHandler {
    /**
     * @param {object} nsfwServer - NSFW 서버 인스턴스
     */
    constructor(nsfwServer) {
        this.nsfwServer = nsfwServer;
    }

    /**
     * 이미지 신고 처리
     * @param {string} imageUrl - 이미지 URL
     * @param {string} pageUrl - 페이지 URL
     * @param {string} category - 신고 카테고리
     * @param {object} tab - 탭 정보
     * @param {function} getOrCreateReporterId - reporterId 생성 함수
     * @returns {Promise<void>}
     */
    async handleReport(imageUrl, pageUrl, category, tab, getOrCreateReporterId) {
        try {
            console.log('[ImageReport] 이미지 신고 시작:', { imageUrl, pageUrl, category });

            // 이미지 URL 유효성 검증
            if (!imageUrl || !imageUrl.startsWith('http')) {
                console.error('[ImageReport] 유효하지 않은 이미지 URL:', imageUrl);
                this.showNotification('실패', '유효하지 않은 이미지입니다.');
                return;
            }

            // 디시인사이드 이미지 여부 확인
            const isDcImage = imageUrl && (
                imageUrl.includes('dcimg') ||
                imageUrl.includes('dcinside.com') ||
                imageUrl.includes('dcinside.co.kr')
            );

            console.log('[ImageReport] 이미지 출처:', isDcImage ? 'DCInside' : 'External');

            // 신고 사유 입력받기
            const reportReason = await this.getReportReason(tab.id, category);

            if (!reportReason) {
                console.log('[ImageReport] 신고 취소됨 (사용자 입력 취소)');
                return;
            }

            console.log('[ImageReport] 신고 사유:', reportReason);

            // 진행 중 알림
            this.showNotification('신고 중', '이미지 신고 중...');

            // 이미지 처리
            const imageData = await this.processImage(imageUrl, isDcImage, tab.id);

            // 요청 body 구성
            const requestBody = this.buildRequestBody(
                imageData,
                category,
                reportReason,
                pageUrl,
                await getOrCreateReporterId()
            );

            console.log('[ImageReport] 신고 페이로드:', this.sanitizePayload(requestBody));

            // 서버 전송
            const result = await this.sendToServer(requestBody);

            console.log('[ImageReport] 신고 성공:', result);

            // 성공 알림
            this.showNotification(
                '신고 완료',
                result.data?.isNewImage
                    ? '새로운 이미지로 신고되었습니다.\nAI 검증이 진행됩니다.'
                    : '기존 데이터베이스에 매칭되었습니다.',
                1
            );

            // 통계 업데이트
            await updateStats({ reported: 1 });

        } catch (error) {
            console.error('[ImageReport] 이미지 신고 실패:', error);

            // 사용자 친화적 에러 메시지
            let userMessage = '알 수 없는 오류가 발생했습니다.';

            if (error.message.includes('시간이 초과')) {
                userMessage = '⏱️ 신고 시간이 초과되었습니다.\n잠시 후 다시 시도해주세요.';
            } else if (error.message.includes('네트워크')) {
                userMessage = '🌐 네트워크 연결을 확인해주세요.';
            } else if (error.message.includes('서버 응답 오류')) {
                userMessage = '🔧 서버에 일시적인 문제가 발생했습니다.\n잠시 후 다시 시도해주세요.';
            } else {
                userMessage = `오류: ${error.message}`;
            }

            this.showNotification('신고 실패', userMessage, 2);
        }
    }

    /**
     * 신고 사유 입력받기
     * @param {number} tabId - 탭 ID
     * @param {string} category - 카테고리
     * @returns {Promise<string|null>}
     */
    async getReportReason(tabId, category) {
        try {
            const response = await chrome.tabs.sendMessage(tabId, {
                type: 'GET_REPORT_REASON',
                category: category
            });

            if (!response || response.cancelled) {
                return null;
            }

            return response.reason || '사유 없음';
        } catch (error) {
            console.warn('[ImageReport] 신고 사유 입력 실패, 기본값 사용:', error);
            return '사용자 신고 (Chrome Extension)';
        }
    }

    /**
     * 이미지 처리 (다운로드 및 변환)
     * @param {string} imageUrl - 이미지 URL
     * @param {boolean} isDcImage - 디시인사이드 이미지 여부
     * @param {number} tabId - 탭 ID
     * @returns {Promise<object>}
     */
    async processImage(imageUrl, isDcImage, tabId) {
        let imageData;

        // 1차 시도: Content Script (Canvas 추출)
        try {
            console.log('[ImageReport] Content Script에 메시지 전송 중...');
            imageData = await chrome.tabs.sendMessage(tabId, {
                type: 'PROCESS_IMAGE',
                imageUrl: imageUrl
            });

            if (imageData.error) {
                throw new Error(imageData.error);
            }

            console.log('[ImageReport] 이미지 처리 완료 (Content Script):', {
                type: imageData.type,
                mimeType: imageData.mimeType,
                hasExtraction: !!imageData.extraction,
                imageSize: imageData.image ? `${Math.round(imageData.image.length / 1024)}KB` : 'N/A'
            });

            // Content Script가 URL만 반환한 경우 (Canvas tainted)
            if (imageData.type === 'url') {
                throw new Error('NEED_SERVICE_WORKER_RETRY');
            }
        } catch (error) {
            console.warn('[ImageReport] Content Script 처리 실패:', error.message);

            // 2차 시도: Service Worker (fetch)
            console.log('[ImageReport] Service Worker에서 재시도...');

            try {
                if (!isDcImage) {
                    // 외부 이미지는 직접 fetch
                    console.log('[ImageReport] 외부 이미지 처리 중...');
                    imageData = await this.fetchAndConvertExternalImage(imageUrl);
                } else {
                    // 디시 이미지는 기존 로직 사용
                    imageData = await analyzeAndEncodeImage(imageUrl);
                }

                console.log('[ImageReport] 이미지 처리 완료 (Service Worker):', {
                    type: imageData.type,
                    mimeType: imageData.mimeType,
                    hasExtraction: !!imageData.extraction,
                    size: imageData.image ? `${Math.round(imageData.image.length / 1024)}KB` : 'N/A'
                });
            } catch (fetchError) {
                console.error('[ImageReport] Service Worker 처리도 실패:', {
                    imageUrl: imageUrl?.substring(0, 100) + '...',
                    errorType: fetchError.name,
                    errorMessage: fetchError.message
                });

                // 최후의 수단: URL만 전송
                imageData = {
                    type: 'url',
                    imageUrl: imageUrl,
                    mimeType: 'image/jpeg',
                    error: fetchError.message
                };
            }
        }

        // 이미지 크기 체크 및 리사이즈
        return await this.checkAndResizeImage(imageData);
    }

    /**
     * 이미지 크기 체크 및 리사이즈
     * @param {object} imageData - 이미지 데이터
     * @returns {Promise<object>}
     */
    async checkAndResizeImage(imageData) {
        if (!imageData.image && !imageData.extraction) {
            return imageData;
        }

        const base64Data = imageData.image || imageData.extraction;
        const sizeKB = Math.round(base64Data.length / 1024);

        console.log('[ImageReport] 이미지 크기 확인:', { sizeKB });

        // 500KB 이상이면 리사이즈
        if (sizeKB > 500) {
            console.log('[ImageReport] 이미지 크기 초과, 리사이즈 시도...');

            try {
                const resizedBase64 = await this.resizeImageData(base64Data, imageData.mimeType);
                const newSizeKB = Math.round(resizedBase64.length / 1024);

                console.log('[ImageReport] 리사이즈 완료:', {
                    originalSize: `${sizeKB}KB`,
                    resizedSize: `${newSizeKB}KB`,
                    reduction: `${Math.round((1 - newSizeKB / sizeKB) * 100)}%`
                });

                // 리사이즈된 데이터로 교체
                if (imageData.image) {
                    imageData.image = resizedBase64;
                }
                if (imageData.extraction) {
                    imageData.extraction = resizedBase64;
                }
            } catch (resizeError) {
                console.error('[ImageReport] 리사이즈 실패, 원본 사용:', resizeError);
            }
        }

        return imageData;
    }

    /**
     * Base64 이미지 데이터 리사이즈
     * @param {string} base64Data - Base64 데이터
     * @param {string} mimeType - MIME 타입
     * @returns {Promise<string>}
     */
    async resizeImageData(base64Data, mimeType) {
        // Base64를 Blob으로 변환
        const base64WithoutPrefix = base64Data.includes(',')
            ? base64Data.split(',')[1]
            : base64Data;

        const byteCharacters = atob(base64WithoutPrefix);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: mimeType || 'image/jpeg' });

        // 리사이즈
        const resizedBlob = await this.resizeImage(blob);

        // Blob을 다시 Base64로 변환
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const dataUrl = reader.result;
                const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(resizedBlob);
        });
    }

    /**
     * 이미지 리사이즈 (Canvas 사용)
     * @param {Blob} blob - 이미지 Blob
     * @returns {Promise<Blob>}
     */
    async resizeImage(blob) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(blob);

            img.onload = () => {
                try {
                    let width = img.width;
                    let height = img.height;

                    // 최대 크기 설정 (1920x1920)
                    const MAX_SIZE = 1920;

                    // 비율 유지하며 리사이즈
                    if (width > height) {
                        if (width > MAX_SIZE) {
                            height = Math.round((height * MAX_SIZE) / width);
                            width = MAX_SIZE;
                        }
                    } else {
                        if (height > MAX_SIZE) {
                            width = Math.round((width * MAX_SIZE) / height);
                            height = MAX_SIZE;
                        }
                    }

                    // Canvas에 그리기
                    const canvas = new OffscreenCanvas(width, height);
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // Blob으로 변환 (JPEG, 품질 85%)
                    canvas.convertToBlob({
                        type: 'image/jpeg',
                        quality: 0.85
                    }).then(resizedBlob => {
                        URL.revokeObjectURL(url);
                        resolve(resizedBlob);
                    }).catch(reject);
                } catch (error) {
                    URL.revokeObjectURL(url);
                    reject(error);
                }
            };

            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('이미지 로드 실패'));
            };

            img.src = url;
        });
    }

    /**
     * 외부 이미지 fetch 및 변환
     * @param {string} imageUrl - 이미지 URL
     * @returns {Promise<object>}
     */
    async fetchAndConvertExternalImage(imageUrl) {
        try {
            console.log('[ImageReport] 외부 이미지 다운로드 시작:', imageUrl);

            const response = await fetch(imageUrl);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const blob = await response.blob();
            const mimeType = blob.type || 'image/jpeg';

            console.log('[ImageReport] 이미지 다운로드 완료:', {
                size: `${Math.round(blob.size / 1024)}KB`,
                mimeType: mimeType
            });

            // 외부 이미지는 크기 무관하게 재인코딩
            console.log('[ImageReport] 외부 이미지 재인코딩 시작');
            const reEncodedBlob = await this.resizeImage(blob);

            const finalBlob = reEncodedBlob.size < blob.size ? reEncodedBlob : blob;

            console.log('[ImageReport] 이미지 처리 완료:', {
                originalSize: `${Math.round(blob.size / 1024)}KB`,
                reEncodedSize: `${Math.round(reEncodedBlob.size / 1024)}KB`,
                finalSize: `${Math.round(finalBlob.size / 1024)}KB`,
                used: finalBlob === reEncodedBlob ? 're-encoded' : 'original'
            });

            // Blob을 Base64로 변환
            const base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const dataUrl = reader.result;
                    const base64Data = dataUrl.includes(',')
                        ? dataUrl.split(',')[1]
                        : dataUrl;
                    resolve(base64Data);
                };
                reader.onerror = () => reject(new Error('FileReader 실패'));
                reader.readAsDataURL(finalBlob);
            });

            return {
                type: 'base64',
                image: base64,
                imageUrl: imageUrl,
                mimeType: mimeType
            };
        } catch (error) {
            console.error('[ImageReport] 외부 이미지 처리 실패:', error);

            return {
                type: 'url',
                imageUrl: imageUrl,
                mimeType: 'image/jpeg',
                error: error.message
            };
        }
    }

    /**
     * 요청 body 구성
     * @param {object} imageData - 이미지 데이터
     * @param {string} category - 카테고리
     * @param {string} reason - 신고 사유
     * @param {string} pageUrl - 페이지 URL
     * @param {string} reporterId - 신고자 ID
     * @returns {object}
     */
    buildRequestBody(imageData, category, reason, pageUrl, reporterId) {
        // context 동적 생성 (도메인 추출)
        let context = 'Chrome Extension';
        try {
            const url = new URL(pageUrl);
            context = `${url.hostname} 웹 페이지`;
        } catch (error) {
            console.warn('[ImageReport] pageUrl 파싱 실패, 기본 context 사용:', error);
        }

        const requestBody = {
            category: category,
            reason: reason,
            context: context,
            imageUrl: imageData.imageUrl,
            pageUrl: pageUrl,
            reporterId: reporterId
        };

        // 이미지 데이터 처리
        if (imageData.type === 'extraction' && imageData.extraction) {
            // GIF 프레임 추출 성공
            requestBody.type = 'gif';
            requestBody.extraction = imageData.extraction;
            requestBody.image = null;
        } else if (imageData.type === 'base64' && imageData.image) {
            // 일반 이미지 Base64 변환 성공
            requestBody.type = 'default';
            requestBody.image = imageData.image;
            requestBody.extraction = null;
        } else {
            // Base64 변환 실패 → URL만 서버에 전송
            requestBody.type = 'default';
            requestBody.image = null;
            requestBody.extraction = null;

            console.warn('[ImageReport] 이미지 다운로드 실패, URL만 서버에 전송:', {
                imageUrl: imageData.imageUrl?.substring(0, 100) + '...',
                error: imageData.error || '알 수 없는 오류'
            });
        }

        return requestBody;
    }

    /**
     * 서버로 신고 전송
     * @param {object} requestBody - 요청 body
     * @returns {Promise<object>}
     */
    async sendToServer(requestBody) {
        const response = await fetch('https://nsfw.nerdvana.kr/api/report', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));

            console.error('[ImageReport] 신고 실패 (서버 응답):', {
                status: response.status,
                statusText: response.statusText,
                error: errorData.error,
                message: errorData.message
            });

            throw new Error(errorData.error || errorData.message || `서버 응답 오류: ${response.status}`);
        }

        return await response.json();
    }

    /**
     * 알림 표시
     * @param {string} title - 제목
     * @param {string} message - 메시지
     * @param {number} priority - 우선순위 (0: 기본, 1: 중요, 2: 긴급)
     */
    showNotification(title, message, priority = 0) {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon128.png'),
            title: `Kas-Free - ${title}`,
            message: message,
            priority: priority
        });
    }

    /**
     * 페이로드 민감 정보 제거 (로깅용)
     * @param {object} payload - 페이로드
     * @returns {object}
     */
    sanitizePayload(payload) {
        return {
            ...payload,
            image: payload.image
                ? `${payload.image.substring(0, 100)}... (${Math.round(payload.image.length / 1024)}KB)`
                : null,
            extraction: payload.extraction
                ? `${payload.extraction.substring(0, 100)}... (${Math.round(payload.extraction.length / 1024)}KB)`
                : null
        };
    }
}
