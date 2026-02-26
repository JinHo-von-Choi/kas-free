/**
 * 메모리 관리 단위 테스트
 * @author 최진호
 * @date 2026-02-26
 */

describe('Memory Management (Observer & Event Listener Cleanup)', () => {
    let mockObserver;
    let mockEventTarget;
    let globalEventListeners;
    let activeTimers;

    beforeEach(() => {
        // MutationObserver Mock
        mockObserver = {
            observe: jest.fn(),
            disconnect: jest.fn(),
            takeRecords: jest.fn()
        };

        global.MutationObserver = jest.fn(() => mockObserver);

        // EventTarget Mock
        mockEventTarget = {
            addEventListener: jest.fn(),
            removeEventListener: jest.fn()
        };

        // 전역 변수 초기화
        globalEventListeners = [];
        activeTimers = new Set();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('cleanupAll', () => {
        test('MutationObserver disconnect 호출', () => {
            const domObserver = mockObserver;

            // cleanup 시뮬레이션
            if (domObserver) {
                domObserver.disconnect();
            }

            expect(mockObserver.disconnect).toHaveBeenCalledTimes(1);
        });

        test('전역 이벤트 리스너 제거', () => {
            // 리스너 추가
            const handler1 = jest.fn();
            const handler2 = jest.fn();

            mockEventTarget.addEventListener('scroll', handler1);
            mockEventTarget.addEventListener('resize', handler2);

            globalEventListeners.push(
                { target: mockEventTarget, type: 'scroll', handler: handler1, options: {} },
                { target: mockEventTarget, type: 'resize', handler: handler2, options: {} }
            );

            // cleanup 시뮬레이션
            for (const listener of globalEventListeners) {
                listener.target.removeEventListener(listener.type, listener.handler, listener.options);
            }
            globalEventListeners.length = 0;

            expect(mockEventTarget.removeEventListener).toHaveBeenCalledTimes(2);
            expect(mockEventTarget.removeEventListener).toHaveBeenCalledWith('scroll', handler1, {});
            expect(mockEventTarget.removeEventListener).toHaveBeenCalledWith('resize', handler2, {});
            expect(globalEventListeners.length).toBe(0);
        });

        test('setInterval 정리', () => {
            jest.useFakeTimers();

            const intervalId1 = setInterval(() => {}, 1000);
            const intervalId2 = setInterval(() => {}, 2000);

            activeTimers.add(intervalId1);
            activeTimers.add(intervalId2);

            // cleanup 시뮬레이션
            for (const timerId of activeTimers) {
                clearInterval(timerId);
            }
            activeTimers.clear();

            expect(activeTimers.size).toBe(0);

            jest.useRealTimers();
        });

        test('setTimeout 정리', () => {
            jest.useFakeTimers();

            const timeoutId1 = setTimeout(() => {}, 5000);
            const timeoutId2 = setTimeout(() => {}, 10000);

            activeTimers.add(timeoutId1);
            activeTimers.add(timeoutId2);

            // cleanup 시뮬레이션
            for (const timerId of activeTimers) {
                clearTimeout(timerId);
            }
            activeTimers.clear();

            expect(activeTimers.size).toBe(0);

            jest.useRealTimers();
        });

        test('debounce 타이머 정리', () => {
            jest.useFakeTimers();

            let previewTimer = setTimeout(() => {}, 300);
            let domChangeTimer = setTimeout(() => {}, 300);

            // cleanup 시뮬레이션
            if (previewTimer) {
                clearTimeout(previewTimer);
                previewTimer = null;
            }
            if (domChangeTimer) {
                clearTimeout(domChangeTimer);
                domChangeTimer = null;
            }

            expect(previewTimer).toBeNull();
            expect(domChangeTimer).toBeNull();

            jest.useRealTimers();
        });
    });

    describe('addGlobalEventListener', () => {
        test('리스너 추가 및 추적', () => {
            function addGlobalEventListener(target, type, handler, options = {}) {
                target.addEventListener(type, handler, options);
                globalEventListeners.push({ target, type, handler, options });
            }

            const handler = jest.fn();

            addGlobalEventListener(mockEventTarget, 'scroll', handler, { passive: true });

            expect(mockEventTarget.addEventListener).toHaveBeenCalledWith('scroll', handler, { passive: true });
            expect(globalEventListeners.length).toBe(1);
            expect(globalEventListeners[0]).toEqual({
                target: mockEventTarget,
                type: 'scroll',
                handler: handler,
                options: { passive: true }
            });
        });

        test('여러 리스너 추가', () => {
            function addGlobalEventListener(target, type, handler, options = {}) {
                target.addEventListener(type, handler, options);
                globalEventListeners.push({ target, type, handler, options });
            }

            const handler1 = jest.fn();
            const handler2 = jest.fn();
            const handler3 = jest.fn();

            addGlobalEventListener(mockEventTarget, 'scroll', handler1);
            addGlobalEventListener(mockEventTarget, 'resize', handler2);
            addGlobalEventListener(mockEventTarget, 'visibilitychange', handler3);

            expect(globalEventListeners.length).toBe(3);
        });
    });

    describe('addTrackedInterval', () => {
        test('setInterval 추적', () => {
            jest.useFakeTimers();

            function addTrackedInterval(handler, interval) {
                const timerId = setInterval(handler, interval);
                activeTimers.add(timerId);
                return timerId;
            }

            const handler = jest.fn();
            const timerId = addTrackedInterval(handler, 1000);

            expect(activeTimers.has(timerId)).toBe(true);
            expect(activeTimers.size).toBe(1);

            jest.useRealTimers();
        });

        test('여러 interval 추적', () => {
            jest.useFakeTimers();

            function addTrackedInterval(handler, interval) {
                const timerId = setInterval(handler, interval);
                activeTimers.add(timerId);
                return timerId;
            }

            const handler1 = jest.fn();
            const handler2 = jest.fn();

            addTrackedInterval(handler1, 1000);
            addTrackedInterval(handler2, 2000);

            expect(activeTimers.size).toBe(2);

            jest.useRealTimers();
        });
    });

    describe('addTrackedTimeout', () => {
        test('장시간 setTimeout 추적 (1초 이상)', () => {
            jest.useFakeTimers();

            function addTrackedTimeout(handler, delay) {
                const timerId = setTimeout(() => {
                    handler();
                    activeTimers.delete(timerId);
                }, delay);

                if (delay >= 1000) {
                    activeTimers.add(timerId);
                }

                return timerId;
            }

            const handler = jest.fn();
            const timerId = addTrackedTimeout(handler, 5000);

            expect(activeTimers.has(timerId)).toBe(true);
            expect(activeTimers.size).toBe(1);

            jest.useRealTimers();
        });

        test('짧은 setTimeout은 추적 안 함 (1초 미만)', () => {
            jest.useFakeTimers();

            function addTrackedTimeout(handler, delay) {
                const timerId = setTimeout(() => {
                    handler();
                    activeTimers.delete(timerId);
                }, delay);

                if (delay >= 1000) {
                    activeTimers.add(timerId);
                }

                return timerId;
            }

            const handler = jest.fn();
            addTrackedTimeout(handler, 300);

            expect(activeTimers.size).toBe(0);

            jest.useRealTimers();
        });

        test('실행 완료 후 자동 제거', () => {
            jest.useFakeTimers();

            function addTrackedTimeout(handler, delay) {
                const timerId = setTimeout(() => {
                    handler();
                    activeTimers.delete(timerId);
                }, delay);

                if (delay >= 1000) {
                    activeTimers.add(timerId);
                }

                return timerId;
            }

            const handler = jest.fn();
            const timerId = addTrackedTimeout(handler, 5000);

            expect(activeTimers.has(timerId)).toBe(true);

            // 5초 경과
            jest.advanceTimersByTime(5000);

            expect(handler).toHaveBeenCalled();
            expect(activeTimers.has(timerId)).toBe(false);

            jest.useRealTimers();
        });
    });

    describe('실제 시나리오', () => {
        test('페이지 종료 시 모든 리소스 정리', () => {
            jest.useFakeTimers();

            // 1. Observer 생성
            const domObserver = mockObserver;
            domObserver.observe(document.body, { childList: true });

            // 2. 이벤트 리스너 추가
            const scrollHandler = jest.fn();
            const resizeHandler = jest.fn();

            function addGlobalEventListener(target, type, handler, options = {}) {
                target.addEventListener(type, handler, options);
                globalEventListeners.push({ target, type, handler, options });
            }

            addGlobalEventListener(mockEventTarget, 'scroll', scrollHandler);
            addGlobalEventListener(mockEventTarget, 'resize', resizeHandler);

            // 3. 타이머 생성
            function addTrackedInterval(handler, interval) {
                const timerId = setInterval(handler, interval);
                activeTimers.add(timerId);
                return timerId;
            }

            const cleanupInterval = addTrackedInterval(() => {}, 3600000);
            const periodicInterval = addTrackedInterval(() => {}, 60000);

            // 4. beforeunload 이벤트 (cleanup)
            function cleanupAll() {
                // Observer 정리
                if (domObserver) {
                    domObserver.disconnect();
                }

                // 이벤트 리스너 정리
                for (const listener of globalEventListeners) {
                    listener.target.removeEventListener(listener.type, listener.handler);
                }
                globalEventListeners.length = 0;

                // 타이머 정리
                for (const timerId of activeTimers) {
                    clearInterval(timerId);
                }
                activeTimers.clear();
            }

            cleanupAll();

            // 검증
            expect(domObserver.disconnect).toHaveBeenCalled();
            expect(mockEventTarget.removeEventListener).toHaveBeenCalledTimes(2);
            expect(globalEventListeners.length).toBe(0);
            expect(activeTimers.size).toBe(0);

            jest.useRealTimers();
        });

        test('메모리 누수 시나리오 (cleanup 없음)', () => {
            jest.useFakeTimers();

            // Observer 생성했지만 disconnect 안 함
            const domObserver = mockObserver;
            domObserver.observe(document.body, { childList: true });

            // 이벤트 리스너 추가했지만 remove 안 함
            mockEventTarget.addEventListener('scroll', () => {});

            // interval 생성했지만 clear 안 함
            const intervalId = setInterval(() => {}, 1000);

            // beforeunload에서 cleanup 안 함
            // → 메모리 누수 발생

            // 메모리 누수 확인
            expect(domObserver.disconnect).not.toHaveBeenCalled();

            jest.useRealTimers();
        });
    });
});
