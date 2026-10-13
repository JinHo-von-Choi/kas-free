/** 콘텐츠 메시지의 시간 제한과 설정 변경에 따른 오래된 응답 거부. */
(() => {
    function send(message, { timeout = 30000, runtime = chrome.runtime, generation = () => 0 } = {}) {
        const initial = generation();
        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => finish(reject, new Error('조회 시간이 초과됐습니다.')), timeout);
            function finish(fn, value) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                fn(value);
            }
            try {
                runtime.sendMessage({ ...message, requestId: crypto.randomUUID() }, response => {
                    if (runtime.lastError) return finish(reject, new Error('확장 프로그램 연결이 끊겼습니다.'));
                    if (initial !== generation()) return finish(reject, new Error('설정이 변경돼 이전 검사를 취소했습니다.'));
                    if (!response) return finish(reject, new Error('조회 응답이 없습니다.'));
                    finish(resolve, response);
                });
            } catch { finish(reject, new Error('확장 프로그램 연결이 끊겼습니다.')); }
        });
    }
    globalThis.KasMessageClient = Object.freeze({ send });
})();
