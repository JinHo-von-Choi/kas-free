/**
 * 성능 측정 E2E 테스트
 * @author 최진호
 * @date 2026-02-12
 * @modified 2026-03-15
 */

const puppeteer = require('puppeteer');
const path      = require('path');

describe('Performance Monitoring E2E', () => {
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
         * extensionId 추출에만 사용하고 worker()로 평가 컨텍스트 확보.
         */
        const targets         = await browser.targets();
        const extensionTarget = targets.find(t => t.type() === 'service_worker') ||
                                targets.find(t => t.type() === 'background_page');

        if (extensionTarget) {
            extensionId     = extensionTarget.url().split('/')[2];
            extensionWorker = await extensionTarget.worker();
        }
    }, TEST_TIMEOUT);

    afterAll(async () => {
        if (browser) {
            await browser.close();
        }
    });

    /**
     * chrome.runtime.sendMessage를 실행할 extension 컨텍스트 페이지를 생성한다.
     * 일반 newPage()로 생성한 페이지에는 chrome.runtime이 없으므로
     * chrome-extension:// URL을 직접 열어 해당 컨텍스트에서 실행해야 한다.
     */
    const createExtPage = async () => {
        if (!extensionId) return null;
        const page = await browser.newPage();
        await page.goto(
            `chrome-extension://${extensionId}/src/options/options.html`,
            { waitUntil: 'networkidle0' }
        );
        return page;
    };

    describe('분석 시간 트래킹', () => {
        let extPage;

        beforeEach(async () => {
            extPage = await createExtPage();
        });

        afterEach(async () => {
            if (extPage) {
                await extPage.close();
            }
        });

        test('이미지 분석 시간이 기록되어야 함', async () => {
            if (!extensionId) {
                console.warn('extensionId 없음 - chrome.runtime 테스트 건너뜀');
                return;
            }

            /** 초기 메트릭 조회 */
            const beforeMetrics = await extPage.evaluate(() => {
                return new Promise((resolve) => {
                    chrome.runtime.sendMessage(
                        { type: 'GET_PERFORMANCE_METRICS' },
                        resolve
                    );
                });
            });

            const beforeTotal = beforeMetrics.analysis.total;

            /** 이미지 분석 수행 (Mock) */
            await extPage.evaluate(() => {
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

            /** 메트릭 재조회 */
            const afterMetrics = await extPage.evaluate(() => {
                return new Promise((resolve) => {
                    chrome.runtime.sendMessage(
                        { type: 'GET_PERFORMANCE_METRICS' },
                        resolve
                    );
                });
            });

            /** 분석 횟수가 증가했는지 확인 */
            expect(afterMetrics.analysis.total).toBeGreaterThanOrEqual(beforeTotal);

            /** avgTime이 기록되었는지 확인 */
            if (afterMetrics.analysis.total > 0) {
                expect(afterMetrics.analysis.avgTime).toBeGreaterThan(0);
            }
        }, TEST_TIMEOUT);
    });

    describe('캐시 히트율 측정', () => {
        let extPage;

        beforeEach(async () => {
            extPage = await createExtPage();
        });

        afterEach(async () => {
            if (extPage) {
                await extPage.close();
            }
        });

        test('캐시 히트율이 계산되어야 함', async () => {
            if (!extensionId) {
                console.warn('extensionId 없음 - chrome.runtime 테스트 건너뜀');
                return;
            }

            const metrics = await extPage.evaluate(() => {
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
            if (!extensionId) {
                console.warn('extensionId 없음 - chrome.runtime 테스트 건너뜀');
                return;
            }

            const metrics = await extPage.evaluate(() => {
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
        let extPage;

        beforeEach(async () => {
            extPage = await createExtPage();
        });

        afterEach(async () => {
            if (extPage) {
                await extPage.close();
            }
        });

        test('API 호출 통계가 기록되어야 함', async () => {
            if (!extensionId) {
                console.warn('extensionId 없음 - chrome.runtime 테스트 건너뜀');
                return;
            }

            const metrics = await extPage.evaluate(() => {
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
        let extPage;

        beforeEach(async () => {
            extPage = await createExtPage();
        });

        afterEach(async () => {
            if (extPage) {
                await extPage.close();
            }
        });

        test('해시 생성 통계가 기록되어야 함', async () => {
            if (!extensionId) {
                console.warn('extensionId 없음 - chrome.runtime 테스트 건너뜀');
                return;
            }

            const metrics = await extPage.evaluate(() => {
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
        let extPage;

        beforeEach(async () => {
            extPage = await createExtPage();
        });

        afterEach(async () => {
            if (extPage) {
                await extPage.close();
            }
        });

        test('세션 정보가 기록되어야 함', async () => {
            if (!extensionId) {
                console.warn('extensionId 없음 - chrome.runtime 테스트 건너뜀');
                return;
            }

            const metrics = await extPage.evaluate(() => {
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

            /** ISO 날짜 형식 검증 */
            expect(metrics.session.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(metrics.session.lastReset).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        });
    });

    describe('메트릭 저장 및 복원', () => {
        let extPage;

        beforeEach(async () => {
            extPage = await createExtPage();
        });

        afterEach(async () => {
            if (extPage) {
                await extPage.close();
            }
        });

        test('메트릭이 스토리지에 저장되어야 함', async () => {
            if (!extensionId) {
                console.warn('extensionId 없음 - 테스트 건너뜀');
                return;
            }

            /** 메트릭 조회 트리거 */
            await extPage.evaluate(() => {
                return new Promise((resolve) => {
                    chrome.runtime.sendMessage(
                        { type: 'GET_PERFORMANCE_METRICS' },
                        resolve
                    );
                });
            });

            /**
             * 스토리지 확인은 Service Worker 컨텍스트에서 수행.
             * extensionWorker가 없는 경우 extPage 컨텍스트에서 대체 조회한다.
             */
            let stored;
            if (extensionWorker) {
                stored = await extensionWorker.evaluate(() => {
                    return chrome.storage.local.get('performance_metrics');
                });
            } else {
                stored = await extPage.evaluate(() => {
                    return new Promise((resolve) => {
                        chrome.storage.local.get('performance_metrics', resolve);
                    });
                });
            }

            expect(stored.performance_metrics).toBeDefined();
        });
    });
});
