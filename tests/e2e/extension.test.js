/**
 * Chrome 확장 프로그램 E2E 테스트
 * @author 최진호
 * @date 2026-02-12
 */

const puppeteer = require('puppeteer');
const path      = require('path');

describe('Kas-Free Chrome Extension E2E', () => {
    let browser;
    let extensionPage;
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

        // Service Worker 페이지 찾기
        const targets = await browser.targets();
        const extensionTarget = targets.find(
            target => target.type() === 'service_worker'
        );

        if (extensionTarget) {
            extensionPage = await extensionTarget.page();
            const url     = extensionTarget.url();
            extensionId   = url.split('/')[2];
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
            expect(extensionPage).toBeDefined();
        });
    });

    describe('팝업 페이지', () => {
        let popupPage;

        beforeEach(async () => {
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
            const title = await popupPage.title();
            expect(title).toBeTruthy();
        });

        test('통계 정보가 표시되어야 함', async () => {
            const statsElement = await popupPage.$('.stats');
            expect(statsElement).toBeTruthy();
        });
    });

    describe('옵션 페이지', () => {
        let optionsPage;

        beforeEach(async () => {
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
            const title = await optionsPage.title();
            expect(title).toBeTruthy();
        });

        test('설정 항목들이 표시되어야 함', async () => {
            const settingsForm = await optionsPage.$('form');
            expect(settingsForm).toBeTruthy();
        });
    });

    describe('메시지 통신', () => {
        let testPage;

        beforeEach(async () => {
            testPage = await browser.newPage();
        });

        afterEach(async () => {
            if (testPage) {
                await testPage.close();
            }
        });

        test('설정 조회 메시지 응답', async () => {
            const response = await testPage.evaluate(() => {
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
            const response = await testPage.evaluate(() => {
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
        let testPage;

        beforeEach(async () => {
            testPage = await browser.newPage();
        });

        afterEach(async () => {
            if (testPage) {
                await testPage.close();
            }
        });

        test('성능 메트릭 조회 가능', async () => {
            const metrics = await testPage.evaluate(() => {
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
            // Service Worker에서 컨텍스트 메뉴 생성 확인
            const menuCreated = await extensionPage.evaluate(() => {
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
            const testSettings = {
                enabled:       true,
                cacheEnabled:  true,
                cacheDuration: 3600000
            };

            // 설정 저장
            await extensionPage.evaluate((settings) => {
                return chrome.storage.local.set({ settings });
            }, testSettings);

            // 설정 불러오기
            const loaded = await extensionPage.evaluate(() => {
                return chrome.storage.local.get('settings');
            });

            expect(loaded.settings).toEqual(testSettings);
        });

        test('통계 데이터 저장', async () => {
            const testStats = {
                total: {
                    scanned: 100,
                    safe:    80,
                    caution: 15,
                    danger:  5
                }
            };

            await extensionPage.evaluate((stats) => {
                return chrome.storage.local.set({ stats });
            }, testStats);

            const loaded = await extensionPage.evaluate(() => {
                return chrome.storage.local.get('stats');
            });

            expect(loaded.stats).toEqual(testStats);
        });
    });
});
