/**
 * Hash Worker - 이미지 해시 생성 전용 WebWorker
 * @author 최진호
 * @date 2026-02-14
 * @version 1.0.0
 * @remarks Service Worker에서 해시 생성을 별도 스레드로 분리하여 메인 스레드 차단 방지
 */

/**
 * dHash를 계산한다
 * @param {ImageBitmap} imageBitmap - 이미지 비트맵
 * @returns {string} 16자 hex 해시
 */
function computeDHash(imageBitmap) {
    const width = 9;
    const height = 8;

    // OffscreenCanvas 생성
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 이미지를 9x8로 리사이즈
    ctx.drawImage(imageBitmap, 0, 0, width, height);

    // 픽셀 데이터 가져오기
    const imageData = ctx.getImageData(0, 0, width, height);
    const pixels = imageData.data;

    // 그레이스케일 변환
    const gray = [];
    for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        // Luminosity method
        const grayValue = 0.299 * r + 0.587 * g + 0.114 * b;
        gray.push(grayValue);
    }

    // dHash 계산 (차이 비교)
    const hash = [];
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width - 1; col++) {
            const idx = row * width + col;
            const left = gray[idx];
            const right = gray[idx + 1];
            hash.push(left < right ? 1 : 0);
        }
    }

    // 비트를 16진수로 변환
    let hexHash = '';
    for (let i = 0; i < hash.length; i += 4) {
        const nibble = hash.slice(i, i + 4).join('');
        const hex = parseInt(nibble, 2).toString(16);
        hexHash += hex;
    }

    // 16자로 패딩
    return hexHash.padEnd(16, '0');
}

/**
 * aHash를 계산한다
 * @param {ImageBitmap} imageBitmap - 이미지 비트맵
 * @returns {string} 16자 hex 해시
 */
function computeAHash(imageBitmap) {
    const size = 8;

    // OffscreenCanvas 생성
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // 이미지를 8x8로 리사이즈
    ctx.drawImage(imageBitmap, 0, 0, size, size);

    // 픽셀 데이터 가져오기
    const imageData = ctx.getImageData(0, 0, size, size);
    const pixels = imageData.data;

    // 그레이스케일 변환
    const gray = [];
    for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const grayValue = 0.299 * r + 0.587 * g + 0.114 * b;
        gray.push(grayValue);
    }

    // 평균 계산
    const average = gray.reduce((a, b) => a + b, 0) / gray.length;

    // 평균보다 큰지 비교
    const hash = [];
    for (const value of gray) {
        hash.push(value > average ? 1 : 0);
    }

    // 비트를 16진수로 변환
    let hexHash = '';
    for (let i = 0; i < hash.length; i += 4) {
        const nibble = hash.slice(i, i + 4).join('');
        const hex = parseInt(nibble, 2).toString(16);
        hexHash += hex;
    }

    // 16자로 패딩
    return hexHash.padEnd(16, '0');
}

/**
 * Worker 메시지 핸들러
 */
self.addEventListener('message', async (event) => {
    const { type, imageUrl, blob } = event.data;

    try {
        if (type !== 'GENERATE_HASHES') {
            throw new Error(`Unknown message type: ${type}`);
        }

        if (!blob) {
            throw new Error('blob is required');
        }

        const startTime = performance.now();

        // Blob을 ImageBitmap으로 변환
        const imageBitmap = await createImageBitmap(blob);

        // 병렬로 해시 생성 (Promise.all)
        const [dhash, ahash] = await Promise.all([
            Promise.resolve(computeDHash(imageBitmap)),
            Promise.resolve(computeAHash(imageBitmap))
        ]);

        // ImageBitmap 해제
        imageBitmap.close();

        const elapsed = performance.now() - startTime;

        // 성공 응답
        self.postMessage({
            success: true,
            hashes: {
                phash: dhash, // pHash는 dHash와 동일
                dhash: dhash,
                ahash: ahash
            },
            elapsed: elapsed
        });

        console.log('[HashWorker] 해시 생성 완료:', {
            dhash: dhash,
            ahash: ahash,
            elapsed: `${elapsed.toFixed(2)}ms`
        });
    } catch (error) {
        // 에러 응답
        self.postMessage({
            success: false,
            error: error.message
        });

        console.error('[HashWorker] 해시 생성 실패:', error);
    }
});

console.log('[HashWorker] 초기화 완료');
