/** 디시 다운로드의 탭 합산 예산, 접근 제한과 짧은 자료 재사용을 관리한다. */
export class DcRequestError extends Error {
    constructor(code, message, retryAt = null) {
        super(message);
        this.name = 'DcRequestError';
        this.code = code;
        this.retryAt = retryAt;
    }
}

const STATE_KEY = 'dcRequestBudgetV1';
const MINUTE = 60000;
const HOUR = 3600000;
const DEFAULT_LIMITS = Object.freeze({
    minimumInterval: 1500, htmlMinute: 12, htmlHour: 120,
    imageMinute: 30, imageHour: 240, totalMinute: 30, totalHour: 240,
    queueSize: 20, tabQueueSize: 5, maximumCacheBytes: 20 * 1024 * 1024
});

export function validateDcUrl(value, kind = 'image') {
    let url;
    try { url = new URL(value); } catch { throw new DcRequestError('INVALID_URL', '이미지 주소가 올바르지 않습니다.'); }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port
        || !/^(?:[a-z0-9-]+\.)*dcinside\.(?:com|co\.kr)$/.test(host)) {
        throw new DcRequestError('INVALID_URL', '허용되지 않은 디시 주소입니다.');
    }
    if (kind === 'html' && (!/^gall\.dcinside\.(com|co\.kr)$/.test(host)
        || !/^\/(?:mgallery\/|mini\/)?board\/view\/?$/.test(url.pathname)
        || !/^[a-zA-Z0-9_-]{1,100}$/.test(url.searchParams.get('id') || '')
        || !/^\d{1,20}$/.test(url.searchParams.get('no') || ''))) {
        throw new DcRequestError('INVALID_URL', '게시글 주소가 올바르지 않습니다.');
    }
    url.hash = '';
    return url.href;
}

export function retryAfterTime(value, now, fallback = MINUTE) {
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
        const seconds = Number(value.trim());
        if (Number.isSafeInteger(seconds) && seconds * 1000 <= Number.MAX_SAFE_INTEGER - now) {
            return Math.max(now + 1000, now + seconds * 1000);
        }
    }
    const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) && parsed > now ? parsed : now + fallback;
}

export class DcRequestBroker {
    constructor({ fetchFn = (...args) => fetch(...args), storage = chrome.storage.local,
        now = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), limits = {} } = {}) {
        this.fetchFn = fetchFn;
        this.storage = storage;
        this.now = now;
        this.sleep = sleep;
        this.limits = { ...DEFAULT_LIMITS, ...limits };
        this.state = { history: [], nextStart: 0, pauseUntil: 0, manualStop: false, failures: 0, observedAt: 0 };
        this.queue = [];
        this.pending = new Map();
        this.cache = new Map();
        this.cacheBytes = 0;
        this.active = false;
        this.stats = { started: 0, completed: 0, failed: 0, shared: 0, cacheHits: 0 };
        this.ready = this.restore();
    }

    async restore() {
        try {
            const saved = (await this.storage.get(STATE_KEY))[STATE_KEY];
            if (saved) {
                if (!Array.isArray(saved.history) || saved.history.length > 1000
                    || !['nextStart', 'pauseUntil', 'failures', 'observedAt'].every(k => Number.isFinite(saved[k]) && saved[k] >= 0)
                    || typeof saved.manualStop !== 'boolean'
                    || saved.history.some(row => !Number.isFinite(row.time) || row.time < 0 || !['html', 'image'].includes(row.kind))) {
                    throw new Error('Invalid budget state');
                }
                this.state = { ...saved };
                if (this.now() < saved.observedAt) this.state.manualStop = true;
            }
        } catch {
            this.state.manualStop = true;
        }
    }

    async persist() {
        this.state.observedAt = this.now();
        try { await this.storage.set({ [STATE_KEY]: this.state }); }
        catch {
            this.state.manualStop = true;
            throw new DcRequestError('BUDGET_STORAGE_FAILED', '요청 제한 상태를 저장할 수 없어 자동 조회를 중단했습니다.');
        }
    }

    request(value, { kind = 'image', tabId = null, priority = 0, deadline = this.now() + 30000, signal } = {}) {
        if (!['html', 'image'].includes(kind)) return Promise.reject(new DcRequestError('INVALID_KIND', '지원하지 않는 조회입니다.'));
        let url;
        try { url = validateDcUrl(value, kind); } catch (error) { return Promise.reject(error); }
        const key = `${kind}:${url}`;
        if (signal?.aborted) return Promise.reject(new DcRequestError('CANCELLED', '조회가 취소됐습니다.'));
        const cached = this.cache.get(key);
        if (cached && cached.expiry > this.now()) {
            this.stats.cacheHits++;
            return Promise.resolve(cached.value);
        }
        if (tabId !== null && [...this.pending.values()].reduce((count, pending) => count + [...pending.subscriptions].filter(row => row.tabId === tabId).length, 0) >= this.limits.tabQueueSize) {
            return Promise.reject(new DcRequestError('DC_DEFERRED', '이 탭의 조회 대기열이 가득 찼습니다.', this.now() + MINUTE));
        }
        if (this.pending.has(key)) {
            this.stats.shared++;
            return this.subscribe(this.pending.get(key), signal, tabId);
        }
        if (this.queue.length >= this.limits.queueSize || (tabId !== null && this.queue.filter(x => x.tabId === tabId).length >= this.limits.tabQueueSize)) {
            return Promise.reject(new DcRequestError('DC_DEFERRED', '자동 조회 대기열이 가득 찼습니다.', this.now() + MINUTE));
        }
        let resolve, reject;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        const item = { url, key, kind, tabId, priority, deadline, resolve, reject, promise, consumers: 0, subscriptions: new Set(), controller: new AbortController() };
        this.pending.set(key, item);
        this.queue.push(item);
        const subscription = this.subscribe(item, signal, tabId);
        this.drain();
        return subscription;
    }

    subscribe(item, signal, tabId) {
        item.consumers++;
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (fn, value) => {
                if (settled) return;
                settled = true;
                signal?.removeEventListener('abort', abort);
                item.subscriptions.delete(subscription);
                item.consumers--;
                if (!item.consumers) item.controller.abort();
                fn(value);
            };
            const abort = () => finish(reject, new DcRequestError('CANCELLED', '조회가 취소됐습니다.'));
            const subscription = { tabId, abort };
            item.subscriptions.add(subscription);
            signal?.addEventListener('abort', abort, { once: true });
            item.promise.then(value => finish(resolve, value), error => finish(reject, error));
        });
    }

    nextAllowed(kind) {
        const now = this.now();
        this.state.history = this.state.history.filter(row => row.time > now - HOUR);
        let next = Math.max(this.state.nextStart, this.state.pauseUntil);
        for (const [duration, limit, type] of [
            [MINUTE, this.limits.totalMinute, null], [HOUR, this.limits.totalHour, null],
            [MINUTE, this.limits[`${kind}Minute`], kind], [HOUR, this.limits[`${kind}Hour`], kind]
        ]) {
            const rows = this.state.history.filter(row => row.time > now - duration && (!type || row.kind === type));
            if (rows.length >= limit) next = Math.max(next, rows[rows.length - limit].time + duration);
        }
        return next;
    }

    async drain() {
        if (this.active) return;
        this.active = true;
        try {
            await this.ready;
            while (this.queue.length) {
                this.queue.sort((a, b) => b.priority - a.priority);
                const item = this.queue[0];
                try {
                    if (!item.consumers || item.controller.signal.aborted) throw new DcRequestError('CANCELLED', '조회가 취소됐습니다.');
                    if (this.now() < this.state.observedAt) this.state.manualStop = true;
                    if (this.state.manualStop) throw new DcRequestError('DC_ACCESS_STOPPED', '접근 제한으로 자동 조회가 중단됐습니다. 설정에서 상태를 확인하세요.');
                    const next = this.nextAllowed(item.kind);
                    if (this.state.pauseUntil > this.now() || next >= item.deadline) {
                        throw new DcRequestError('DC_DEFERRED', '디시 요청 제한으로 수집을 대기합니다.', next);
                    }
                    if (this.now() >= item.deadline) throw new DcRequestError('DC_DEFERRED', '조회 대기 시간이 초과됐습니다.', next);
                    if (next > this.now()) {
                        await this.sleep(Math.min(next - this.now(), 250));
                        continue;
                    }
                    this.queue.shift();
                    this.state.history.push({ time: this.now(), kind: item.kind });
                    this.state.nextStart = this.now() + this.limits.minimumInterval;
                    await this.persist();
                    this.stats.started++;
                    const value = await this.download(item);
                    this.state.failures = 0;
                    await this.persist();
                    this.remember(item, value);
                    this.stats.completed++;
                    item.resolve(value);
                } catch (error) {
                    if (this.queue[0] === item) this.queue.shift();
                    this.stats.failed++;
                    item.reject(error);
                } finally {
                    if (!this.queue.includes(item)) this.pending.delete(item.key);
                }
            }
        } finally { this.active = false; }
    }

    async download(item) {
        const timeout = setTimeout(() => item.controller.abort(), Math.max(1, Math.min(15000, item.deadline - this.now())));
        try {
            const response = await this.fetchFn(item.url, {
                credentials: 'include', referrerPolicy: 'no-referrer', redirect: 'error', signal: item.controller.signal
            });
            if (response.status === 429) {
                this.state.pauseUntil = Math.max(this.state.pauseUntil, retryAfterTime(response.headers.get('Retry-After'), this.now()));
                await this.persist();
                throw new DcRequestError('DC_DEFERRED', '디시가 요청을 제한해 자동 조회를 일시 중단했습니다.', this.state.pauseUntil);
            }
            if (response.status === 401 || response.status === 403 || response.redirected) {
                this.state.manualStop = true;
                await this.persist();
                throw new DcRequestError('DC_ACCESS_STOPPED', '디시 접근 제한 또는 로그인 확인이 필요합니다.');
            }
            if (!response.ok) throw new DcRequestError('DC_HTTP_ERROR', `게시글 조회 실패 (${response.status})`);
            const type = (response.headers.get('Content-Type') || '').toLowerCase();
            const maximum = item.kind === 'html' ? 2 * 1024 * 1024 : 10 * 1024 * 1024;
            if (Number(response.headers.get('Content-Length')) > maximum) throw new DcRequestError('DC_TOO_LARGE', '다운로드 크기 제한을 초과했습니다.');
            if ((item.kind === 'html' && !type.includes('text/html')) || (item.kind === 'image' && !type.startsWith('image/'))) {
                this.state.manualStop = true;
                await this.persist();
                throw new DcRequestError('DC_UNEXPECTED_CONTENT', '이미지나 게시글 대신 접근 안내가 반환됐습니다.');
            }
            const bytes = await readBounded(response, maximum);
            if (item.kind === 'image') return new Blob([bytes], { type: type.split(';')[0] });
            const html = new TextDecoder().decode(bytes);
            if (!/class\s*=\s*["'][^"']*\b(?:writing_view_box|write_div)\b/i.test(html)) {
                if (/captcha|비정상적인\s*접근|접근이\s*제한|접속이\s*차단|로그인.*필요/i.test(html)) {
                    this.state.manualStop = true;
                    await this.persist();
                }
                throw new DcRequestError('DC_UNEXPECTED_CONTENT', '게시글 본문을 확인할 수 없습니다.');
            }
            return html;
        } catch (error) {
            if (!(error instanceof DcRequestError) || error.code === 'DC_HTTP_ERROR') {
                this.state.failures++;
                this.state.pauseUntil = Math.max(this.state.pauseUntil, this.now() + Math.min(HOUR, 10000 * 2 ** Math.min(this.state.failures - 1, 9)));
                await this.persist();
            }
            if (item.controller.signal.aborted) throw new DcRequestError('CANCELLED', '조회가 취소되거나 시간이 초과됐습니다.');
            throw error instanceof DcRequestError ? error : new DcRequestError('DC_NETWORK_ERROR', '이미지 조회에 실패했습니다.');
        } finally { clearTimeout(timeout); }
    }

    remember(item, value) {
        const bytes = typeof value === 'string' ? value.length * 2 : value.size;
        const previous = this.cache.get(item.key);
        if (previous) this.cacheBytes -= previous.bytes;
        this.cache.delete(item.key);
        while (this.cache.size && this.cacheBytes + bytes > this.limits.maximumCacheBytes) {
            const [key, row] = this.cache.entries().next().value;
            this.cache.delete(key); this.cacheBytes -= row.bytes;
        }
        if (bytes <= this.limits.maximumCacheBytes) {
            this.cache.set(item.key, { value, bytes, expiry: this.now() + (item.kind === 'html' ? MINUTE : 30000) });
            this.cacheBytes += bytes;
        }
    }

    cancelTab(tabId) {
        for (const item of this.pending.values()) {
            for (const subscription of [...item.subscriptions]) if (subscription.tabId === tabId) subscription.abort();
        }
    }

    async resume() {
        await this.ready;
        if (this.state.pauseUntil > this.now()) throw new DcRequestError('DC_DEFERRED', '대기 시간이 끝난 뒤 재개할 수 있습니다.', this.state.pauseUntil);
        this.state.manualStop = false;
        await this.persist();
    }

    getStatus() {
        return { ...this.stats, queued: this.queue.length, stopped: this.state.manualStop,
            retryAt: Math.max(this.state.pauseUntil, this.nextAllowed('html')),
            limits: { ...this.limits } };
    }
}

async function readBounded(response, maximum) {
    if (!response.body?.getReader) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > maximum) throw new DcRequestError('DC_TOO_LARGE', '다운로드 크기 제한을 초과했습니다.');
        return bytes;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maximum) throw new DcRequestError('DC_TOO_LARGE', '다운로드 크기 제한을 초과했습니다.');
            chunks.push(value);
        }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
}

let instance;
export function getDcRequestBroker() {
    if (!instance) instance = new DcRequestBroker();
    return instance;
}
