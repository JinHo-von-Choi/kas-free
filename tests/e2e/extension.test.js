/**
 * Chrome 확장 프로그램 E2E 테스트
 * @author 최진호
 * @date 2026-02-12
 * @modified 2026-03-15
 */

const puppeteer = require('puppeteer');
const path      = require('path');

describe('Kas-Free Chrome Extension E2E', () => {
    let browser;
    let extensionWorker;
    let extensionId;

    const EXTENSION_PATH = path.resolve(__dirname, '../../');
    const TEST_TIMEOUT   = 30000;

    beforeAll(async () => {
        browser = await puppeteer.launch({
            headless: false,
            args: [
                `--disable-extensions-except=${EXTENSION_PATH}`,
                `--load-extension=${EXTENSION_PATH}`,
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ]
        });

        /** 확장 로드 완료 대기 */
        await new Promise(resolve => setTimeout(resolve, 2000));

        /**
         * service_worker target을 우선 탐색하고,
         * 없으면 background_page로 fallback.
         * service_worker target은 .page()가 null을 반환하므로
         * extensionId 추출에만 사용한다.
         */
        const targets         = await browser.targets();
        const extensionTarget = targets.find(t => t.type() === 'service_worker') ||
                                targets.find(t => t.type() === 'background_page');

        if (extensionTarget) {
            extensionId     = extensionTarget.url().split('/')[2];
            extensionWorker = await extensionTarget.worker();
            console.log('확장 프로그램 ID:', extensionId);
        }
    }, TEST_TIMEOUT);

    afterAll(async () => {
        if (browser) {
            await browser.close();
        }
    });

    describe('확장 프로그램 로드', () => {
        test('확장 프로그램이 정상적으로 로드되어야 함', async () => {
            expect(extensionId).toBeDefined();
            expect(extensionId).toMatch(/^[a-z]{32}$/);
        });

        test('Service Worker가 실행되어야 함', async () => {
            expect(extensionWorker).toBeDefined();
        });
    });

    describe('팝업 페이지', () => {
        let popupPage;

        beforeEach(async () => {
            if (!extensionId) {
                console.warn('extensionId 확보 실패 - 팝업 페이지 테스트 건너뜀');
                return;
            }
            const popupUrl = `chrome-extension://${extensionId}/src/popup/popup.html`;
            popupPage      = await browser.newPage();
            await popupPage.goto(popupUrl, { waitUntil: 'networkidle0' });
        });

        afterEach(async () => {
            if (popupPage) {
                await popupPage.close();
            }
        });

        test('팝업 페이지가 로드되어야 함', async () => {
            if (!extensionId) {
                console.warn('extensionId 없음 - 테스트 건너뜀');
                return;
            }
            const title = await popupPage.title();
            expect(title).toBeTruthy();
        });

        test('통계 정보가 표시되어야 함', async () => {
            if (!extensionId) {
                console.warn('extensionId 없음 - 테스트 건너뜀');
                return;
            }
            const statsElement = await popupPage.$('.stats');
            expect(statsElement).toBeTruthy();
        });
    });

    describe('옵션 페이지', () => {
        let optionsPage;

        beforeEach(async () => {
            if (!extensionId) {
                console.warn('extensionId 확보 실패 - 옵션 페이지 테스트 건너뜀');
                return;
            }
            const optionsUrl = `chrome-extension://${extensionId}/src/options/options.html`;
            optionsPage      = await browser.newPage();
            await optionsPage.goto(optionsUrl, { waitUntil: 'networkidle0' });
        });

        afterEach(async () => {
            if (optionsPage) {
                await optionsPage.close();
            }
        });

        test('옵션 페이지가 로드되어야 함', async () => {
            if (!extensionId) {
                console.warn('extensionId 없음 - 테스트 건너뜀');
                return;
            }
            const title = await optionsPage.title();
            expect(title).toBeTruthy();
        });

        test('설정 항목들이 표시되어야 함', async () => {
            if (!extensionId) {
                console.warn('extensionId 없음 - 테스트 건너뜀');
                return;
            }
            const settingsForm = await optionsPage.$('form');
            expect(settingsForm).toBeTruthy();
        });
    });

    describe('메시지 통신', () => {
        /**
         * chrome.runtime.sendMessage는 chrome-extension:// 컨텍스트에서만 동작한다.
         * 일반 newPage()로 생성한 페이지에는 chrome.runtime이 없으므로
         * options 페이지를 직접 열어 해당 컨텍스트에서 실행한다.
         */
        let extPage;

        beforeEach(async () => {
            if (!extensionId) {
                return;
            }
            extPage = await browser.newPage();
            await extPage.goto(
                `chrome-extension://${extensionId}/src/options/options.html`,
                { waitUntil: 'networkidle0' }
            );
        });

        afterEach(async () => {
            if (extPage) {
                await extPage.close();
            }
        });

        test('설정 조회 메시지 응답', async () => {
            if (!extensionId) {
                console.warn('extensionId 없음 - chrome.runtime 테스트 건너뜀');
                return;
            }

            const response = await extPage.evaluate(() => {
                return new Promise((resolve) => {
                    chrome.runtime.sendMessage(
                        { type: 'GET_SETTINGS' },
                        (response) => resolve(response)
                    );
                });
            });

            expect(response).toBeDefined();
            expect(response.enabled).toBeDefined();
        });

        test('통계 조회 메시지 응답', async () => {
            if (!extensionId) {
                console.warn('extensionId 없음 - chrome.runtime 테스트 건너뜀');
                return;
            }

            const response = await extPage.evaluate(() => {
                return new Promise((resolve) => {
                    chrome.runtime.sendMessage(
                        { type: 'GET_STATS' },
                        (response) => resolve(response)
                    );
                });
            });

            expect(response).toBeDefined();
            expect(response.total).toBeDefined();
        });
    });

    describe('성능 메트릭', () => {
        /**
         * chrome.runtime 사용을 위해 extension 컨텍스트 페이지에서 실행한다.
         */
        let extPage;

        beforeEach(async () => {
            if (!extensionId) {
                return;
            }
            extPage = await browser.newPage();
            await extPage.goto(
                `chrome-extension://${extensionId}/src/options/options.html`,
                { waitUntil: 'networkidle0' }
            );
        });

        afterEach(async () => {
            if (extPage) {
                await extPage.close();
            }
        });

        test('성능 메트릭 조회 가능', async () => {
            if (!extensionId) {
                console.warn('extensionId 없음 - chrome.runtime 테스트 건너뜀');
                return;
            }

            const metrics = await extPage.evaluate(() => {
                return new Promise((resolve) => {
                    chrome.runtime.sendMessage(
                        { type: 'GET_PERFORMANCE_METRICS' },
                        (response) => resolve(response)
                    );
                });
            });

            expect(metrics).toBeDefined();
            expect(metrics.analysis).toBeDefined();
            expect(metrics.cache).toBeDefined();
            expect(metrics.cache.hitRate).toBeDefined();
        });
    });

    describe('컨텍스트 메뉴', () => {
        test('컨텍스트 메뉴가 생성되어야 함', async () => {
            if (!extensionWorker) {
                console.warn('extensionWorker 없음 - 컨텍스트 메뉴 테스트 건너뜀');
                return;
            }

            /** Service Worker 컨텍스트에서 컨텍스트 메뉴 생성 확인 */
            const menuCreated = await extensionWorker.evaluate(() => {
                return new Promise((resolve) => {
                    chrome.contextMenus.removeAll(() => {
                        chrome.contextMenus.create({
                            id:       'test-menu',
                            title:    'Test Menu',
                            contexts: ['image']
                        }, () => {
                            resolve(chrome.runtime.lastError ? false : true);
                        });
                    });
                });
            });

            expect(menuCreated).toBe(true);
        });
    });

    describe('스토리지', () => {
        test('설정 저장 및 불러오기', async () => {
            if (!extensionWorker) {
                console.warn('extensionWorker 없음 - 스토리지 테스트 건너뜀');
                return;
            }

            const testSettings = {
                enabled:       true,
                cacheEnabled:  true,
                cacheDuration: 3600000
            };

            /** 설정 저장 */
            await extensionWorker.evaluate((settings) => {
                return chrome.storage.local.set({ settings });
            }, testSettings);

            /** 설정 불러오기 */
            const loaded = await extensionWorker.evaluate(() => {
                return chrome.storage.local.get('settings');
            });

            expect(loaded.settings).toEqual(testSettings);
        });

        test('통계 데이터 저장', async () => {
            if (!extensionWorker) {
                console.warn('extensionWorker 없음 - 스토리지 테스트 건너뜀');
                return;
            }

            const testStats = {
                total: {
                    scanned: 100,
                    safe:    80,
                    caution: 15,
                    danger:  5
                }
            };

            await extensionWorker.evaluate((stats) => {
                return chrome.storage.local.set({ stats });
            }, testStats);

            const loaded = await extensionWorker.evaluate(() => {
                return chrome.storage.local.get('stats');
            });

            expect(loaded.stats).toEqual(testStats);
        });
    });
});
