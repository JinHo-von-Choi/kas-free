/**
 * DcParser 단위 테스트
 * @author 최진호
 * @date 2026-03-15
 */

/** ----------------------------------------------------------------
 * DcParser는 ES module export 없이 전역 window.dcParser 인스턴스를
 * 등록하는 방식이므로, 클래스를 직접 재정의하여 테스트한다.
 * ---------------------------------------------------------------- */

/** DC_SELECTORS 상수 (dcParser.js와 동기화) */
const DC_SELECTORS = {
    POST_TABLE:           'table.gall_list',
    POST_ROW:             'tr.ub-content.us-post',
    POST_ROW_VIEW:        'tr.ub-content',
    POST_ROW_WITH_IMAGE:  'tr.ub-content.us-post[data-type="icon_pic"], tr.ub-content.us-post[data-type="icon_recomimg"], tr.ub-content.us-post[data-type="icon_movie"]',
    TITLE_CELL:           'td.gall_tit',
    TITLE_LINK:           'td.gall_tit a[href*="board/view"]',
    ICON_IMG:             'em.icon_img',
    CONTENT_WRAP:         '.gallview_contents',
    WRITING_BOX:          '.writing_view_box',
    WRITE_DIV:            '.write_div',
    IMGWRAP:              '.imgwrap',
    CONTENT_IMAGE:        '.writing_view_box img[data-fileno]',
    CONTENT_IMAGE_ALT:    '.writing_view_box img[src*="viewimage.php"]',
    DCCON:                'img.written_dccon',
    AD_AREA:              '#zzbang_div',
    AD_IMAGE:             '#zzbang_div img',
    OG_IMAGE:             'meta[property="og:image"]'
};

/** DC_URL_PATTERNS 상수 */
const DC_URL_PATTERNS = {
    GALLERY_LIST: /gall\.dcinside\.com\/(mgallery\/|mini\/)?board\/lists/,
    GALLERY_VIEW: /gall\.dcinside\.com\/(mgallery\/|mini\/)?board\/view/,
    VIEW_IMAGE:   /dcimg[0-9]\.dcinside\.(com|co\.kr)\/viewimage\.php/
};

/**
 * DcParser 클래스 (테스트 대상 — dcParser.js와 동일한 구현)
 * isGalleryViewPage()를 주입 가능하도록 생성자 옵션을 추가한다.
 */
class DcParser {
    /** @param {{ forceViewPage?: boolean }} [opts] */
    constructor(opts = {}) {
        this._forceViewPage = opts.forceViewPage ?? null;
    }

    isGalleryListPage() {
        return DC_URL_PATTERNS.GALLERY_LIST.test(window.location.href);
    }

    isGalleryViewPage() {
        if (this._forceViewPage !== null) {
            return this._forceViewPage;
        }
        return DC_URL_PATTERNS.GALLERY_VIEW.test(window.location.href);
    }

    getAllPostRows() {
        if (this.isGalleryViewPage()) {
            return document.querySelectorAll(DC_SELECTORS.POST_ROW_VIEW);
        }
        return document.querySelectorAll(DC_SELECTORS.POST_ROW);
    }

    getPostRowsWithImage() {
        return document.querySelectorAll(DC_SELECTORS.POST_ROW_WITH_IMAGE);
    }

    parsePostRow(row) {
        if (!row || !row.dataset) {
            return null;
        }

        let postNo   = row.dataset.no;
        let postType = row.dataset.type;

        const titleCell = row.querySelector(DC_SELECTORS.TITLE_CELL);
        const titleLink = row.querySelector(DC_SELECTORS.TITLE_LINK);

        if (!titleCell || !titleLink) {
            return null;
        }

        /** board/view 하단 리스트: data-no 없으면 href ?no= 쿼리에서 추출 */
        if (!postNo) {
            try {
                postNo = new URL(titleLink.href).searchParams.get('no') ?? undefined;
            } catch (_) {}
        }

        /** board/view 하단 리스트: data-type 없으면 em.icon_img 클래스로 추론 */
        if (!postType) {
            const iconEm     = row.querySelector('em.icon_img');
            const candidates = ['icon_pic', 'icon_recomimg', 'icon_movie'];
            if (iconEm) {
                postType = candidates.find(cls => iconEm.classList.contains(cls));
            }
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

    extractTitleText(titleLink) {
        const clone = titleLink.cloneNode(true);
        const icons = clone.querySelectorAll('em.icon_img');
        icons.forEach(icon => icon.remove());
        const replyBox = clone.querySelector('.reply_numbox');
        if (replyBox) {
            replyBox.remove();
        }
        return clone.textContent.trim();
    }

    hasImageAttachment(postType) {
        const imageTypes = ['icon_pic', 'icon_recomimg', 'icon_movie'];
        return imageTypes.includes(postType);
    }

    hasSignal(row) {
        return row.querySelector('.kas-signal-container') !== null ||
               row.querySelector('.kas-signal') !== null;
    }
}

/** ----------------------------------------------------------------
 * DOM Fixture 헬퍼
 * ---------------------------------------------------------------- */

/**
 * Fixture A: board/lists 스타일 (data-no, data-type 속성 있음)
 * @param {string} [iconClass]
 * @returns {HTMLTableRowElement}
 */
function createFixtureA(iconClass = 'icon_pic') {
    const tr       = document.createElement('tr');
    tr.className   = 'ub-content us-post';
    tr.dataset.no  = '1055556';
    tr.dataset.type = iconClass;

    tr.innerHTML = `
        <td class="gall_tit">
            <a href="https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1055556">
                <em class="icon_img ${iconClass}"></em>
                테스트 게시글
            </a>
        </td>
    `;
    return tr;
}

/**
 * Fixture B: board/view 하단 리스트 스타일 (data-* 속성 없음)
 * @param {string} [iconClass]
 * @returns {HTMLTableRowElement}
 */
function createFixtureB(iconClass = 'icon_pic') {
    const tr     = document.createElement('tr');
    tr.className = 'ub-content';

    tr.innerHTML = `
        <td class="gall_tit">
            <a href="https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1055556">
                <em class="icon_img ${iconClass}"></em>
                테스트 게시글
            </a>
        </td>
    `;
    return tr;
}

/**
 * Fixture B (icon em 없음): 텍스트 전용 게시글
 * @returns {HTMLTableRowElement}
 */
function createFixtureBTextOnly() {
    const tr     = document.createElement('tr');
    tr.className = 'ub-content';

    tr.innerHTML = `
        <td class="gall_tit">
            <a href="https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=9999999">
                텍스트 전용 게시글
            </a>
        </td>
    `;
    return tr;
}

/** ----------------------------------------------------------------
 * 테스트 스위트
 * ---------------------------------------------------------------- */

describe('DcParser', () => {
    let parser;

    beforeEach(() => {
        parser = new DcParser();
    });

    afterEach(() => {
        document.body.innerHTML = '';
        jest.clearAllMocks();
    });

    /** ----------------------------------------------------------
     * hasImageAttachment
     * ---------------------------------------------------------- */
    describe('hasImageAttachment()', () => {
        test('icon_pic → true', () => {
            expect(parser.hasImageAttachment('icon_pic')).toBe(true);
        });

        test('icon_recomimg → true', () => {
            expect(parser.hasImageAttachment('icon_recomimg')).toBe(true);
        });

        test('icon_movie → true', () => {
            expect(parser.hasImageAttachment('icon_movie')).toBe(true);
        });

        test('undefined → false (텍스트 전용)', () => {
            expect(parser.hasImageAttachment(undefined)).toBe(false);
        });

        test('빈 문자열 → false', () => {
            expect(parser.hasImageAttachment('')).toBe(false);
        });

        test('unknown 타입 → false', () => {
            expect(parser.hasImageAttachment('icon_text')).toBe(false);
        });
    });

    /** ----------------------------------------------------------
     * parsePostRow — Fixture A (board/lists 스타일)
     * ---------------------------------------------------------- */
    describe('parsePostRow() — Fixture A (data-* 속성 있음)', () => {
        test('postNo가 data-no에서 정상 추출된다', () => {
            const row    = createFixtureA('icon_pic');
            const result = parser.parsePostRow(row);

            expect(result).not.toBeNull();
            expect(result.postNo).toBe('1055556');
        });

        test('hasImage가 true (data-type="icon_pic")', () => {
            const row    = createFixtureA('icon_pic');
            const result = parser.parsePostRow(row);

            expect(result.hasImage).toBe(true);
        });

        test('postType이 data-type에서 정상 추출된다', () => {
            const row    = createFixtureA('icon_recomimg');
            const result = parser.parsePostRow(row);

            expect(result.postType).toBe('icon_recomimg');
            expect(result.hasImage).toBe(true);
        });

        test('postUrl이 titleLink.href와 동일하다', () => {
            const row    = createFixtureA('icon_pic');
            const result = parser.parsePostRow(row);

            expect(result.postUrl).toContain('board/view');
            expect(result.postUrl).toContain('no=1055556');
        });

        test('titleText에서 icon em이 제거된다', () => {
            const row    = createFixtureA('icon_pic');
            const result = parser.parsePostRow(row);

            expect(result.titleText).toBe('테스트 게시글');
        });
    });

    /** ----------------------------------------------------------
     * parsePostRow — Fixture B (board/view 하단 리스트 스타일)
     * ---------------------------------------------------------- */
    describe('parsePostRow() — Fixture B (data-* 속성 없음, href fallback)', () => {
        test('postNo가 href ?no= 쿼리에서 추출된다', () => {
            const row    = createFixtureB('icon_pic');
            const result = parser.parsePostRow(row);

            expect(result).not.toBeNull();
            expect(result.postNo).toBe('1055556');
        });

        test('hasImage가 true (em.icon_pic 클래스 fallback)', () => {
            const row    = createFixtureB('icon_pic');
            const result = parser.parsePostRow(row);

            expect(result.hasImage).toBe(true);
        });

        test('em.icon_recomimg 클래스 → hasImage true', () => {
            const row    = createFixtureB('icon_recomimg');
            const result = parser.parsePostRow(row);

            expect(result.postType).toBe('icon_recomimg');
            expect(result.hasImage).toBe(true);
        });

        test('em.icon_movie 클래스 → hasImage true', () => {
            const row    = createFixtureB('icon_movie');
            const result = parser.parsePostRow(row);

            expect(result.postType).toBe('icon_movie');
            expect(result.hasImage).toBe(true);
        });

        test('icon em 없는 텍스트 전용 게시글 → hasImage false', () => {
            const row    = createFixtureBTextOnly();
            const result = parser.parsePostRow(row);

            expect(result).not.toBeNull();
            expect(result.hasImage).toBe(false);
            expect(result.postType).toBeUndefined();
        });
    });

    /** ----------------------------------------------------------
     * parsePostRow — 엣지 케이스
     * ---------------------------------------------------------- */
    describe('parsePostRow() — 엣지 케이스', () => {
        test('null 전달 시 null 반환', () => {
            expect(parser.parsePostRow(null)).toBeNull();
        });

        test('dataset 없는 엘리먼트 → null 반환', () => {
            const fakeRow = { querySelector: jest.fn() };
            expect(parser.parsePostRow(fakeRow)).toBeNull();
        });

        test('titleCell 없는 row → null 반환', () => {
            const tr     = document.createElement('tr');
            tr.className = 'ub-content';
            /** td.gall_tit 없이 빈 row */
            expect(parser.parsePostRow(tr)).toBeNull();
        });

        test('titleLink(a[href*=board/view]) 없는 row → null 반환', () => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="gall_tit">
                    <a href="https://example.com/other-page">링크</a>
                </td>
            `;
            expect(parser.parsePostRow(tr)).toBeNull();
        });
    });

    /** ----------------------------------------------------------
     * getAllPostRows — 선택자 분기
     * ---------------------------------------------------------- */
    describe('getAllPostRows() — 페이지 타입별 선택자 분기', () => {
        test('isGalleryViewPage() === true → POST_ROW_VIEW 선택자 사용', () => {
            const viewParser = new DcParser({ forceViewPage: true });

            /** board/view 하단 리스트 fixture (us-post 클래스 없음) 삽입 */
            const table = document.createElement('table');
            table.innerHTML = `
                <tr class="ub-content">
                    <td class="gall_tit">
                        <a href="https://gall.dcinside.com/mgallery/board/view/?id=test&no=1">A</a>
                    </td>
                </tr>
                <tr class="ub-content">
                    <td class="gall_tit">
                        <a href="https://gall.dcinside.com/mgallery/board/view/?id=test&no=2">B</a>
                    </td>
                </tr>
            `;
            document.body.appendChild(table);

            const rows = viewParser.getAllPostRows();

            expect(rows.length).toBe(2);
            /** us-post 클래스가 없는 row도 포함된다 */
            expect(rows[0].classList.contains('us-post')).toBe(false);
        });

        test('isGalleryViewPage() === false → POST_ROW (us-post) 선택자 사용', () => {
            const listParser = new DcParser({ forceViewPage: false });

            const table = document.createElement('table');
            table.innerHTML = `
                <tr class="ub-content us-post" data-no="1">
                    <td class="gall_tit">
                        <a href="https://gall.dcinside.com/mgallery/board/view/?id=test&no=1">A</a>
                    </td>
                </tr>
                <tr class="ub-content">
                    <td class="gall_tit">
                        <a href="https://gall.dcinside.com/mgallery/board/view/?id=test&no=2">B</a>
                    </td>
                </tr>
            `;
            document.body.appendChild(table);

            const rows = listParser.getAllPostRows();

            /** us-post가 있는 row만 선택된다 */
            expect(rows.length).toBe(1);
            expect(rows[0].classList.contains('us-post')).toBe(true);
        });
    });
});
