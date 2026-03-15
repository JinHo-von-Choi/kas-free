/**
 * 이미지 해싱 유틸리티
 * @author 최진호
 * @date 2026-01-31
 * @modified 2026-03-15
 * @remarks dHash (Difference Hash) 알고리즘 구현 - Service Worker 호환
 *          Blob 기반 API 추가 (generateDHashFromBlob, generateAHashFromBlob, generateAllHashesFromBlob)
 */

/**
 * Blob에서 dHash를 생성한다 (fetch 없이 Blob 직접 수신)
 * @param {Blob} blob - 이미지 Blob
 * @returns {Promise<string>} 16자 hex 해시
 */
export async function generateDHashFromBlob(blob) {
    try {
        const imageBitmap = await createImageBitmap(blob);
        const hash        = computeDHash(imageBitmap);
        imageBitmap.close();
        return hash;
    } catch (error) {
        console.error('[Kas-Free] dHash(Blob) 생성 실패:', error);
        throw error;
    }
}

/**
 * 이미지 URL에서 dHash를 생성한다
 * @param {string} imageUrl - 이미지 URL
 * @returns {Promise<string>} 16자 hex 해시
 */
export async function generateDHash(imageUrl) {
    try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
            throw new Error(`이미지 fetch 실패: ${response.status}`);
        }
        const blob = await response.blob();
        return generateDHashFromBlob(blob);
    } catch (error) {
        console.error('[Kas-Free] dHash 생성 실패:', error);
        throw error;
    }
}

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
 * pHash를 생성한다 (간이 버전)
 * @param {string} imageUrl - 이미지 URL
 * @returns {Promise<string>} 16자 hex 해시
 */
export async function generatePHash(imageUrl) {
    // pHash는 DCT가 필요하므로 복잡함
    // 현재는 dHash와 동일하게 처리
    return generateDHash(imageUrl);
}

/**
 * Blob에서 aHash를 생성한다 (fetch 없이 Blob 직접 수신)
 * @param {Blob} blob - 이미지 Blob
 * @returns {Promise<string>} 16자 hex 해시
 */
export async function generateAHashFromBlob(blob) {
    try {
        const imageBitmap = await createImageBitmap(blob);
        const hash        = computeAHash(imageBitmap);
        imageBitmap.close();
        return hash;
    } catch (error) {
        console.error('[Kas-Free] aHash(Blob) 생성 실패:', error);
        throw error;
    }
}

/**
 * aHash를 생성한다 (Average Hash)
 * @param {string} imageUrl - 이미지 URL
 * @returns {Promise<string>} 16자 hex 해시
 */
export async function generateAHash(imageUrl) {
    try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
            throw new Error(`이미지 fetch 실패: ${response.status}`);
        }
        const blob = await response.blob();
        return generateAHashFromBlob(blob);
    } catch (error) {
        console.error('[Kas-Free] aHash 생성 실패:', error);
        throw error;
    }
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
 * Blob에서 모든 해시를 생성한다 (1회 fetch로 dHash + aHash 공유)
 * @param {Blob} blob - 이미지 Blob
 * @returns {Promise<{phash: string|null, dhash: string, ahash: string}>}
 */
export async function generateAllHashesFromBlob(blob) {
    const [dhash, ahash] = await Promise.all([
        generateDHashFromBlob(blob),
        generateAHashFromBlob(blob)
    ]);
    return { phash: null, dhash, ahash };
}

/**
 * 모든 해시를 생성한다
 * @param {string} imageUrl - 이미지 URL
 * @returns {Promise<{phash: string, dhash: string, ahash: string}>}
 */
export async function generateAllHashes(imageUrl) {
    try {
        // 1회 fetch 후 Blob을 두 해시 함수에 공유
        const response = await fetch(imageUrl);
        if (!response.ok) {
            throw new Error(`이미지 fetch 실패: ${response.status}`);
        }
        const blob       = await response.blob();
        const [dhash, ahash] = await Promise.all([
            generateDHashFromBlob(blob),
            generateAHashFromBlob(blob)
        ]);

        return {
            phash: dhash, // pHash는 dHash와 동일
            dhash: dhash,
            ahash: ahash
        };
    } catch (error) {
        console.error('[Kas-Free] 해시 생성 실패:', error);
        throw error;
    }
}
