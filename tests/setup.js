/**
 * Jest 테스트 환경 설정
 * @author 최진호
 * @date 2026-02-12
 */

// Chrome Extension API Mock
global.chrome = {
    storage: {
        local: {
            get: jest.fn((keys) => {
                return Promise.resolve({});
            }),
            set: jest.fn(() => {
                return Promise.resolve();
            }),
            remove: jest.fn(() => {
                return Promise.resolve();
            }),
            clear: jest.fn(() => {
                return Promise.resolve();
            })
        }
    },
    runtime: {
        onMessage: {
            addListener: jest.fn()
        },
        onInstalled: {
            addListener: jest.fn()
        },
        onStartup: {
            addListener: jest.fn()
        },
        sendMessage: jest.fn(() => Promise.resolve({}))
    },
    tabs: {
        query: jest.fn(() => Promise.resolve([])),
        sendMessage: jest.fn(() => Promise.resolve({}))
    },
    contextMenus: {
        removeAll: jest.fn((callback) => callback && callback()),
        create: jest.fn(),
        onClicked: {
            addListener: jest.fn()
        }
    }
};

// Performance API Mock
if (typeof performance === 'undefined') {
    global.performance = {
        now: jest.fn(() => Date.now())
    };
}

// Fetch API Mock
global.fetch = jest.fn(() =>
    Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('')
    })
);

// Crypto API Mock
if (typeof crypto === 'undefined') {
    global.crypto = {
        randomUUID: jest.fn(() => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx')
    };
}

// AbortSignal Mock
if (typeof AbortSignal === 'undefined') {
    global.AbortSignal = {
        timeout: jest.fn((ms) => ({
            aborted: false,
            addEventListener: jest.fn()
        }))
    };
}

// Console mock (불필요한 로그 숨기기)
global.console = {
    ...console,
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
};
