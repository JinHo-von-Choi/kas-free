/**
 * Jest 테스트 환경 설정
 * @author 최진호
 * @date 2026-02-12
 * @modified 2026-03-15
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
        sendMessage:   jest.fn(() => Promise.resolve({})),
        getManifest:   jest.fn(() => ({
            version:    '1.2.0',
            name:       'kas-free'
        }))
    },
    tabs: {
        query:       jest.fn(() => Promise.resolve([])),
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

// performance.memory를 configurable:true로 설정하여 테스트에서 재정의/삭제 가능하게 함
Object.defineProperty(global.performance, 'memory', {
    configurable: true,
    writable:     true,
    value: {
        usedJSHeapSize:  50  * 1024 * 1024,
        jsHeapSizeLimit: 100 * 1024 * 1024
    }
});

// Fetch API Mock
global.fetch = jest.fn(() =>
    Promise.resolve({
        ok:   true,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('')
    })
);

// Fetch API - Response/Request 전역 Mock (jsdom 미지원 환경 대비)
if (typeof Response === 'undefined') {
    global.Response = class Response {
        constructor(body, init = {}) {
            this._body  = body;
            this.status = init.status || 200;
            this.ok     = this.status >= 200 && this.status < 300;
            this.headers = {
                get: (name) => ((init.headers || {})[name] ?? null)
            };
        }

        async blob() {
            if (this._body instanceof Blob) return this._body;
            const text = typeof this._body === 'string'
                ? this._body
                : JSON.stringify(this._body);
            return new Blob([text]);
        }

        async json() {
            const text = typeof this._body === 'string'
                ? this._body
                : JSON.stringify(this._body);
            return JSON.parse(text);
        }

        async text() {
            return typeof this._body === 'string'
                ? this._body
                : JSON.stringify(this._body);
        }

        get size() {
            return typeof this._body === 'string' ? this._body.length : 0;
        }
    };
}

if (typeof Request === 'undefined') {
    global.Request = class Request {
        constructor(url, init = {}) {
            this.url     = url;
            this.method  = init.method || 'GET';
            this.headers = init.headers || {};
        }
    };
}

// IndexedDB Key Range Mock
if (typeof IDBKeyRange === 'undefined') {
    global.IDBKeyRange = {
        upperBound:  jest.fn((value, open = false) => ({ upper: value, upperOpen: open })),
        lowerBound:  jest.fn((value, open = false) => ({ lower: value, lowerOpen: open })),
        bound:       jest.fn((lower, upper, lowerOpen = false, upperOpen = false) => ({
            lower, upper, lowerOpen, upperOpen
        })),
        only:        jest.fn((value) => ({ lower: value, upper: value }))
    };
}

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
            aborted:         false,
            addEventListener: jest.fn()
        }))
    };
} else if (!AbortSignal.timeout) {
    AbortSignal.timeout = jest.fn((ms) => ({
        aborted:         false,
        addEventListener: jest.fn()
    }));
}

// Console mock (불필요한 로그 숨기기)
global.console = {
    ...console,
    log:   jest.fn(),
    error: jest.fn(),
    warn:  jest.fn()
};
