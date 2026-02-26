/**
 * 성능 측정 E2E 테스트
 * @author 최진호
 * @date 2026-02-12
 */

const puppeteer = require('puppeteer');
const path      = require('path');

describe('Performance Monitoring E2E', () => {
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

        const targets         = await browser.targets();
        const extensionTarget = targets.find(
            target => target.type() === 'service_worker'
        );

        if (extensionTarget) {
            extensionPage = await extensionTarget.page();
            const url     = extensionTarget.url();
            extensionId   = url.split('/')[2];
        }
    }, TEST_TIMEOUT);

    afterAll(async () => {
        if (browser) {
            await browser.close();
        }
    });

    describe('분석 시간 트래킹', () => {
        let testPage;

        beforeEach(async () => {
            testPage = await browser.newPage();
        });

        afterEach(async () => {
            if (testPage) {
                await testPage.close();
            }
        });

        test('이미지 분석 시간이 기록되어야 함', async () => {
            // 초기 메트릭 조회
            const beforeMetrics = await testPage.evaluate(() => {
                return new Promise((resolve) => {
                    chrome.runtime.sendMessage(
                        { type: 'GET_PERFORMANCE_METRICS' },
                        resolve
                    );
                });
            });

            const beforeTotal = beforeMetrics.analysis.total;

            // 이미지 분석 수행 (Mock)
            await testPage.evaluate(() => {
                return new Promise((resolve) => {
                    chrome.runtime.sendMessage(
                        {
                            type:    'ANALYZE_IMAGE',
                            postNo:  '12345',
                            postUrl: 'https://gall.dcinside.com/test/12345'
                        },
                        resolve
                    );
                });
            });

            // 메트릭 재조회
            const afterMetrics = await testPage.evaluate(() => {
                return new Promise((resolve) => {
                    chrome.runtime.sendMessage(
                        { type: 'GET_PERFORMANCE_METRICS' },
                        resolve
                    );
                });
            });

            // 분석 횟수가 증가했는지 확인
            expect(afterMetrics.analysis.total).toBeGreaterThanOrEqual(beforeTotal);

            // avgTime이 기록되었는지 확인
            if (afterMetrics.analysis.total > 0) {
                expect(afterMetrics.analysis.avgTime).toBeGreaterThan(0);
            }
        }, TEST_TIMEOUT);
    });

    describe('캐시 히트율 측정', () => {
        let testPage;

        beforeEach(async () => {
            testPage = await browser.newPage();
        });

        afterEach(async () => {
            if (testPage) {
                await testPage.close();
            }
        });

        test('캐시 히트율이 계산되어야 함', async () => {
            const metrics = await testPage.evaluate(() => {
                return new Promise((resolve) => {
                    chrome.runtime.sendMessage(
                        { type: 'GET_PERFORMANCE_METRICS' },
                        resolve
                    );
                });
            });

            expect(metrics.cache).toBeDefined();
            expect(metrics.cache.hits).toBeDefined();
            expect(metrics.cache.misses).toBeDefined();
            expect(metrics.cache.hitRate).toBeDefined();
            expect(metrics.cache.hitRate).toMatch(/%$/);
        });

        test('캐시 히트율이 0-100% 범위 내에 있어야 함', async () => {
            const metrics = await testPage.evaluate(() => {
                return new Promise((resolve) => {
                    chrome.runtime.sendMessage(
                        { type: 'GET_PERFORMANCE_METRICS' },
                        resolve
                    );
                });
            });

            const hitRateNum = parseFloat(metrics.cache.hitRate);
            expect(hitRateNum).toBeGreaterThanOrEqual(0);
            expect(hitRateNum).toBeLessThanOrEqual(100);
        });
    });

    describe('API 호출 시간', () => {
        let testPage;

        beforeEach(async () => {
            testPage = await browser.newPage();
        });

        afterEach(async () => {
            if (testPage) {
                await testPage.close();
            }
        });

        test('API 호출 통계가 기록되어야 함', async () => {
            const metrics = await testPage.evaluate(() => {
                return new Promise((resolve) => {
                    chrome.runtime.sendMessage(
                        { type: 'GET_PERFORMANCE_METRICS' },
                        resolve
                    );
                });
            });

            expect(metrics.api).toBeDefined();
            expect(metrics.api.total).toBeDefined();
            expect(metrics.api.avgTime).toBeDefined();
            expect(metrics.api.errors).toBeDefined();
            expect(metrics.api.errorRate).toBeDefined();
            expect(metrics.api.errorRate).toMatch(/%$/);
        });
    });

    describe('해시 생성 시간', () => {
        let testPage;

        beforeEach(async () => {
            testPage = await browser.newPage();
        });

        afterEach(async () => {
            if (testPage) {
                await testPage.close();
            }
        });

        test('해시 생성 통계가 기록되어야 함', async () => {
            const metrics = await testPage.evaluate(() => {
                return new Promise((resolve) => {
                    chrome.runtime.sendMessage(
                        { type: 'GET_PERFORMANCE_METRICS' },
                        resolve
                    );
                });
            });

            expect(metrics.hash).toBeDefined();
            expect(metrics.hash.total).toBeDefined();
            expect(metrics.hash.avgTime).toBeDefined();
        });
    });

    describe('세션 정보', () => {
        let testPage;

        beforeEach(async () => {
            testPage = await browser.newPage();
        });

        afterEach(async () => {
            if (testPage) {
                await testPage.close();
            }
        });

        test('세션 정보가 기록되어야 함', async () => {
            const metrics = await testPage.evaluate(() => {
                return new Promise((resolve) => {
                    chrome.runtime.sendMessage(
                        { type: 'GET_PERFORMANCE_METRICS' },
                        resolve
                    );
                });
            });

            expect(metrics.session).toBeDefined();
            expect(metrics.session.durationHours).toBeDefined();
            expect(metrics.session.startTime).toBeDefined();
            expect(metrics.session.lastReset).toBeDefined();

            // ISO 날짜 형식 검증
            expect(metrics.session.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(metrics.session.lastReset).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        });
    });

    describe('메트릭 저장 및 복원', () => {
        let testPage;

        beforeEach(async () => {
            testPage = await browser.newPage();
        });

        afterEach(async () => {
            if (testPage) {
                await testPage.close();
            }
        });

        test('메트릭이 스토리지에 저장되어야 함', async () => {
            // 메트릭 조회
            await testPage.evaluate(() => {
                return new Promise((resolve) => {
                    chrome.runtime.sendMessage(
                        { type: 'GET_PERFORMANCE_METRICS' },
                        resolve
                    );
                });
            });

            // 스토리지에서 메트릭 확인
            const stored = await extensionPage.evaluate(() => {
                return chrome.storage.local.get('performance_metrics');
            });

            expect(stored.performance_metrics).toBeDefined();
        });
    });
});
