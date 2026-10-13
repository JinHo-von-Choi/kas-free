/** @jest-environment node */
import { DcRequestBroker, validateDcUrl, retryAfterTime } from '../../src/background/DcRequestBroker.js';

const image = n => `https://dcimg1.dcinside.com/viewimage.php?id=${n}`;
const post = n => `https://gall.dcinside.com/board/view/?id=test&no=${n}`;
function harness(fetchFn = jest.fn(async () => new Response('pixels', { headers: { 'Content-Type': 'image/png' } })), limits = {}) {
    fetchFn = jest.fn(fetchFn);
    let clock = 1000000;
    const saved = {};
    const storage = { get: jest.fn(async key => ({ [key]: saved[key] })), set: jest.fn(async value => Object.assign(saved, JSON.parse(JSON.stringify(value)))) };
    const options = { storage, fetchFn, now: () => clock, sleep: async ms => { clock += ms; }, limits };
    return { broker: new DcRequestBroker(options), options, saved, storage, fetchFn, advance: ms => { clock += ms; }, now: () => clock };
}

describe('DC request broker', () => {
    test('큐가 비어도 다음 요청의 최소 간격을 지킨다', async () => {
        const times = [];
        const h = harness(async () => { times.push(h.now()); return new Response('x', { headers: { 'Content-Type': 'image/png' } }); });
        await h.broker.request(image(1)); await h.broker.request(image(2)); await h.broker.request(image(3));
        expect(times).toEqual([1000000,1001500,1003000]);
    });
    test('10개 탭의 같은 자료는 하나의 다운로드를 공유한다', async () => {
        const h = harness();
        const requests = Array.from({ length: 10 }, (_, tabId) => h.broker.request(image(1), { tabId }));
        const results = await Promise.all(requests);
        expect(h.fetchFn).toHaveBeenCalledTimes(1);
        expect(results.every(blob => blob.size === 6)).toBe(true);
        expect(h.broker.getStatus().shared).toBe(9);
    });
    test('같은 URL 구독도 탭 대기 상한을 우회하지 못한다',async()=>{
        const h=harness();
        const pending=Array.from({length:5},()=>h.broker.request(image(1),{tabId:1}));
        await expect(h.broker.request(image(1),{tabId:1})).rejects.toMatchObject({code:'DC_DEFERRED'});
        await expect(h.broker.request(image(2),{tabId:1})).rejects.toMatchObject({code:'DC_DEFERRED'});
        await Promise.all(pending);expect(h.fetchFn).toHaveBeenCalledTimes(1);
    });
    test('HTML 분 상한을 모든 탭에 합산한다', async () => {
        const h = harness(async () => new Response('<div class="writing_view_box">text</div>', { headers: { 'Content-Type': 'text/html' } }), { htmlMinute: 2 });
        await h.broker.request(post(1), { kind: 'html', tabId: 1 });
        await h.broker.request(post(2), { kind: 'html', tabId: 2 });
        await expect(h.broker.request(post(3), { kind: 'html', tabId: 3 })).rejects.toMatchObject({ code: 'DC_DEFERRED', retryAt: 1060000 });
        expect(h.fetchFn).toHaveBeenCalledTimes(2);
    });
    test('시간 상한·최소 간격은 새 broker에서도 유지된다', async () => {
        const h = harness(undefined, { totalHour: 1 });
        await h.broker.request(image(1));
        const restarted = new DcRequestBroker(h.options);
        await expect(restarted.request(image(2))).rejects.toMatchObject({ code: 'DC_DEFERRED', retryAt: 4600000 });
        expect(h.fetchFn).toHaveBeenCalledTimes(1);
    });
    test('429 뒤 다른 URL 요청도 정지하고 재시작으로 초기화되지 않는다', async () => {
        const h = harness(jest.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } })));
        await expect(h.broker.request(image(1))).rejects.toMatchObject({ code: 'DC_DEFERRED', retryAt: 1120000 });
        await expect(new DcRequestBroker(h.options).request(image(2))).rejects.toMatchObject({ code: 'DC_DEFERRED' });
        expect(h.fetchFn).toHaveBeenCalledTimes(1);
        expect(h.broker.getStatus().completed).toBe(0);
    });
    test.each([403,401])('접근 제한 %i 뒤 자동 요청을 멈춘다', async status => {
        const h = harness(jest.fn(async () => new Response('', { status })));
        await expect(h.broker.request(image(1))).rejects.toMatchObject({ code: 'DC_ACCESS_STOPPED' });
        await expect(h.broker.request(image(2))).rejects.toMatchObject({ code: 'DC_ACCESS_STOPPED' });
        expect(h.fetchFn).toHaveBeenCalledTimes(1);
        await h.broker.resume();
        expect(h.broker.state.history).toHaveLength(1);
    });
    test('200 차단 HTML을 이미지 없는 정상 게시글로 처리하지 않는다', async () => {
        const h = harness(jest.fn(async () => new Response('<html>비정상적인 접근으로 접속이 차단되었습니다.</html>', { headers: { 'Content-Type': 'text/html' } })));
        await expect(h.broker.request(post(1), { kind: 'html' })).rejects.toMatchObject({ code: 'DC_UNEXPECTED_CONTENT' });
        expect(h.broker.getStatus().stopped).toBe(true);
        expect(h.broker.getStatus().completed).toBe(0);
    });
    test('예산 저장 실패 때 다운로드하지 않는다', async () => {
        const h = harness(); h.storage.set.mockRejectedValue(new Error('disk'));
        await expect(h.broker.request(image(1))).rejects.toMatchObject({ code: 'BUDGET_STORAGE_FAILED' });
        expect(h.fetchFn).not.toHaveBeenCalled();
    });
    test('같은 다운로드에서 한 소비자 취소가 다른 탭을 취소하지 않는다', async () => {
        const h = harness(); const controller = new AbortController();
        const first = h.broker.request(image(1), { signal: controller.signal, tabId: 1 });
        const second = h.broker.request(image(1), { tabId: 2 });
        controller.abort();
        await expect(first).rejects.toMatchObject({ code: 'CANCELLED' });
        await expect(second).resolves.toBeInstanceOf(Blob);
        expect(h.fetchFn).toHaveBeenCalledTimes(1);
    });
    test('중단 후 소비자 없는 요청을 보내지 않는다', async () => {
        const h = harness(); const controller = new AbortController(); controller.abort();
        await expect(h.broker.request(image(1), { signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
        expect(h.fetchFn).not.toHaveBeenCalled();
    });
    test('탭 취소는 같은 자료를 기다리는 다른 탭의 구독을 보존한다', async () => {
        const h = harness();
        const first = h.broker.request(image(1), { tabId: 1 });
        const second = h.broker.request(image(1), { tabId: 2 });
        h.broker.cancelTab(1);
        await expect(first).rejects.toMatchObject({ code: 'CANCELLED' });
        await expect(second).resolves.toBeInstanceOf(Blob);
        expect(h.fetchFn).toHaveBeenCalledTimes(1);
    });
    test('스트림이 크기 제한을 초과하면 실패한다', async () => {
        const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1)); controller.close(); } });
        const h = harness(async () => new Response(stream, { headers: { 'Content-Type': 'image/png' } }));
        await expect(h.broker.request(image(1))).rejects.toMatchObject({ code: 'DC_TOO_LARGE' });
    });
    test('외부·사용자정보·비표준 포트·잘못된 게시글 경로는 전송 전에 거부한다', () => {
        for (const url of ['https://dcinside.com.evil.test/x','https://user@dcinside.com/x','http://dcinside.com/x','https://dcinside.com:8443/x','https://127.0.0.1/x']) expect(() => validateDcUrl(url)).toThrow();
        expect(() => validateDcUrl('https://gall.dcinside.com/board/delete/?id=test&no=1','html')).toThrow();
    });
    test('Retry-After 초·HTTP 날짜·오류 형식을 구분한다', () => {
        const now = Date.parse('2026-10-13T00:00:00Z');
        expect(retryAfterTime('120',now)).toBe(now+120000);
        expect(retryAfterTime('Tue, 13 Oct 2026 00:02:00 GMT',now)).toBe(now+120000);
        expect(retryAfterTime('invalid',now)).toBe(now+60000);
    });
});
