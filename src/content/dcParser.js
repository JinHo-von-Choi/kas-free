/**
 * 디시인사이드 게시판 파서
 * @author 최진호
 * @date 2026-01-31
 * @version 1.0.0
 * @remarks DOM 구조 변경 시 DC_SELECTORS만 수정하면 됨
 */

/** 디시인사이드 DOM 선택자 */
const DC_SELECTORS = {
    POST_TABLE:           'table.gall_list',
    POST_ROW:             'tr.ub-content.us-post',
    POST_ROW_WITH_IMAGE:  'tr.ub-content.us-post[data-type="icon_pic"], tr.ub-content.us-post[data-type="icon_recomimg"], tr.ub-content.us-post[data-type="icon_movie"]',
    TITLE_CELL:           'td.gall_tit',
    TITLE_LINK:           'td.gall_tit a[href*="board/view"]',
    ICON_IMG:             'em.icon_img',
    CONTENT_WRAP:         '.gallview_contents',
    WRITING_BOX:          '.writing_view_box',
    WRITE_DIV:            '.write_div',
    IMGWRAP:              '.imgwrap',
    CONTENT_IMAGE:        '.writing_view_box img[data-fileno]',  // data-fileno가 가장 확실
    CONTENT_IMAGE_ALT:    '.writing_view_box img[src*="viewimage.php"]',  // 폴백
    DCCON:                'img.written_dccon',
    AD_AREA:              '#zzbang_div',
    AD_IMAGE:             '#zzbang_div img',
    OG_IMAGE:             'meta[property="og:image"]'
};

/** URL 패턴 */
const DC_URL_PATTERNS = {
    GALLERY_LIST: /gall\.dcinside\.com\/(mgallery\/|mini\/)?board\/lists/,
    GALLERY_VIEW: /gall\.dcinside\.com\/(mgallery\/|mini\/)?board\/view/,
    VIEW_IMAGE:   /dcimg[0-9]\.dcinside\.(com|co\.kr)\/viewimage\.php/
};

/**
 * 디시인사이드 파서 클래스
 */
class DcParser {
    /**
     * 현재 페이지가 갤러리 목록 페이지인지 확인
     * @returns {boolean}
     */
    isGalleryListPage() {
        return DC_URL_PATTERNS.GALLERY_LIST.test(window.location.href);
    }

    /**
     * 현재 페이지가 게시글 상세 페이지인지 확인
     * @returns {boolean}
     */
    isGalleryViewPage() {
        return DC_URL_PATTERNS.GALLERY_VIEW.test(window.location.href);
    }

    /**
     * 게시글 목록의 모든 게시글 Row를 가져온다
     * @returns {NodeListOf<Element>}
     */
    getAllPostRows() {
        return document.querySelectorAll(DC_SELECTORS.POST_ROW);
    }

    /**
     * 이미지가 있는 게시글 Row만 가져온다
     * @returns {NodeListOf<Element>}
     */
    getPostRowsWithImage() {
        return document.querySelectorAll(DC_SELECTORS.POST_ROW_WITH_IMAGE);
    }

    /**
     * 게시글 Row에서 정보를 추출한다
     * @param {Element} row - 게시글 Row 엘리먼트
     * @returns {object|null}
     */
    parsePostRow(row) {
        if (!row || !row.dataset) {
            return null;
        }

        const postNo    = row.dataset.no;
        const postType  = row.dataset.type;
        const titleCell = row.querySelector(DC_SELECTORS.TITLE_CELL);
        const titleLink = row.querySelector(DC_SELECTORS.TITLE_LINK);

        if (!titleCell || !titleLink) {
            return null;
        }

        const postUrl   = titleLink.href;
        const titleText = this.extractTitleText(titleLink);
        const hasImage  = this.hasImageAttachment(postType);
        const iconImg   = titleCell.querySelector(DC_SELECTORS.ICON_IMG);

        return {
            postNo,
            postType,
            postUrl,
            titleText,
            hasImage,
            titleCell,
            titleLink,
            iconImg,
            row
        };
    }

    /**
     * 제목 텍스트를 추출한다 (아이콘, 댓글 수 제외)
     * @param {Element} titleLink - 제목 링크 엘리먼트
     * @returns {string}
     */
    extractTitleText(titleLink) {
        const clone = titleLink.cloneNode(true);

        /** 아이콘 제거 */
        const icons = clone.querySelectorAll('em.icon_img');
        icons.forEach(icon => icon.remove());

        /** 댓글 수 제거 */
        const replyBox = clone.querySelector('.reply_numbox');
        if (replyBox) {
            replyBox.remove();
        }

        return clone.textContent.trim();
    }

    /**
     * 게시글 타입에 따라 이미지 첨부 여부를 확인한다
     * @param {string} postType - 게시글 타입 (data-type)
     * @returns {boolean}
     */
    hasImageAttachment(postType) {
        const imageTypes = ['icon_pic', 'icon_recomimg', 'icon_movie'];
        return imageTypes.includes(postType);
    }

    /**
     * 게시글 상세 페이지에서 분석 대상 이미지를 추출한다
     * @returns {string[]} 이미지 URL 배열
     */
    getAnalyzableImages() {
        /** 방법 1: data-fileno 속성으로 필터링 (권장, DC_HTML_STRUCTURE.md 7.3 참고) */
        let images = document.querySelectorAll(DC_SELECTORS.CONTENT_IMAGE);

        /** 폴백: data-fileno가 없는 경우 viewimage.php 패턴 사용 */
        if (images.length === 0) {
            images = document.querySelectorAll(DC_SELECTORS.CONTENT_IMAGE_ALT);
        }

        const imageUrls = [];

        images.forEach(img => {
            const src = img.src || '';

            /** 디시콘 제외 */
            if (img.classList.contains('written_dccon')) {
                return;
            }

            /** 광고 영역 제외 */
            if (img.closest(DC_SELECTORS.AD_AREA)) {
                return;
            }

            /** viewimage.php 패턴 확인 (이중 체크) */
            if (!DC_URL_PATTERNS.VIEW_IMAGE.test(src)) {
                return;
            }

            imageUrls.push(src);
        });

        return imageUrls;
    }

    /**
     * OG 이미지 메타 태그에서 이미지 URL을 추출한다
     * @returns {string|null}
     */
    getOgImageUrl() {
        const ogImage = document.querySelector(DC_SELECTORS.OG_IMAGE);
        return ogImage ? ogImage.content : null;
    }

    /**
     * 게시글 URL에서 OG 이미지를 가져온다 (fetch)
     * @param {string} postUrl - 게시글 URL
     * @returns {Promise<string|null>}
     */
    async fetchOgImage(postUrl) {
        try {
            const response = await fetch(postUrl, {
                credentials:    'include',
                referrerPolicy: 'no-referrer'
            });

            if (!response.ok) {
                return null;
            }

            const html   = await response.text();
            const parser = new DOMParser();
            const doc    = parser.parseFromString(html, 'text/html');

            /** OG 이미지 추출 */
            const ogImage = doc.querySelector(DC_SELECTORS.OG_IMAGE);
            if (ogImage && ogImage.content) {
                return ogImage.content;
            }

            /** 본문 첫 이미지 추출 */
            const firstImage = doc.querySelector(DC_SELECTORS.CONTENT_IMAGE);
            if (firstImage && DC_URL_PATTERNS.VIEW_IMAGE.test(firstImage.src)) {
                return firstImage.src;
            }

            return null;
        } catch (error) {
            console.error('[Kas-Free] fetchOgImage error:', error);
            return null;
        }
    }

    /**
     * 게시글 본문 내용을 가져온다 (fetch)
     * @param {string} postUrl - 게시글 URL
     * @returns {Promise<{text: string, imageCount: number, dcconCount: number}|null>}
     */
    async fetchPostContent(postUrl) {
        try {
            const response = await fetch(postUrl, {
                credentials:    'include',
                referrerPolicy: 'no-referrer'
            });

            if (!response.ok) {
                return null;
            }

            const html   = await response.text();
            const parser = new DOMParser();
            const doc    = parser.parseFromString(html, 'text/html');

            /** 본문 텍스트 추출 */
            const writeDiv = doc.querySelector(DC_SELECTORS.WRITE_DIV);
            if (!writeDiv) {
                return null;
            }

            /** 본문 복제하여 이미지/디시콘 제거 후 텍스트만 추출 */
            const clone = writeDiv.cloneNode(true);

            /** 이미지 영역 제거 */
            const imgAreas = clone.querySelectorAll('.img_area, .imgwrap');
            imgAreas.forEach(area => area.remove());

            /** 디시콘 제거 */
            const dccons = clone.querySelectorAll('.written_dccon');
            dccons.forEach(dccon => dccon.remove());

            /** 텍스트 추출 */
            const text = clone.textContent.trim();

            /** 이미지 개수 (디시콘 제외) */
            const images = doc.querySelectorAll(DC_SELECTORS.CONTENT_IMAGE);
            const imageCount = Array.from(images).filter(img =>
                !img.classList.contains('written_dccon') &&
                !img.closest(DC_SELECTORS.AD_AREA)
            ).length;

            /** 디시콘 개수 */
            const dccons2 = doc.querySelectorAll(DC_SELECTORS.DCCON);
            const dcconCount = dccons2.length;

            return {
                text,
                imageCount,
                dcconCount
            };
        } catch (error) {
            // Fetch 실패는 일반적인 상황 (Rate Limiting, 네트워크 오류 등)
            // 에러 로그 제거 (프리뷰가 안 보일 뿐, 기능 문제 없음)
            return null;
        }
    }

    /**
     * 이미지가 디시인사이드 이미지인지 확인한다
     * @param {string} url - 이미지 URL
     * @returns {boolean}
     */
    isDcinsideImage(url) {
        return DC_URL_PATTERNS.VIEW_IMAGE.test(url);
    }

    /**
     * 신호등 삽입 위치를 찾는다
     * @param {Element} titleCell - 제목 셀 엘리먼트
     * @returns {Element|null} 신호등을 삽입할 위치 (앞에 삽입)
     */
    getSignalInsertPosition(titleCell) {
        const titleLink = titleCell.querySelector('a[href*="board/view"]');
        if (!titleLink) {
            return null;
        }

        const iconImg = titleLink.querySelector(DC_SELECTORS.ICON_IMG);
        return iconImg || titleLink.firstChild;
    }

    /**
     * 게시글 Row에 이미 신호등이 있는지 확인한다
     * @param {Element} row - 게시글 Row 엘리먼트
     * @returns {boolean}
     */
    hasSignal(row) {
        return row.querySelector('.kas-signal-container') !== null ||
               row.querySelector('.kas-signal') !== null;
    }

    /**
     * 갤러리 ID를 URL에서 추출한다
     * @returns {string|null}
     */
    getGalleryId() {
        const params = new URLSearchParams(window.location.search);
        return params.get('id');
    }

    /**
     * 현재 페이지 번호를 URL에서 추출한다
     * @returns {number}
     */
    getPageNumber() {
        const params = new URLSearchParams(window.location.search);
        return parseInt(params.get('page') || '1', 10);
    }
}

/** 전역 인스턴스 */
window.dcParser = new DcParser();
