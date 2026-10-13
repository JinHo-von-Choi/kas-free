import { validateDcUrl } from './DcRequestBroker.js';

export function isExtensionPage(sender, extensionId) {
    return sender?.id === extensionId && typeof sender.url === 'string' && sender.url.startsWith(`chrome-extension://${extensionId}/`);
}

export function validateMessage(message, sender, extensionId) {
    if (!message || typeof message !== 'object' || typeof message.type !== 'string' || sender?.id !== extensionId) throw new Error('허용되지 않은 요청입니다.');
    const privileged = isExtensionPage(sender, extensionId);
    if (!privileged) {
        let source;
        try { source = new URL(sender.url); } catch { throw new Error('요청 출처를 확인할 수 없습니다.'); }
        if (source.protocol !== 'https:' || !/^gall\.dcinside\.(com|co\.kr)$/.test(source.hostname)
            || !Number.isInteger(sender.tab?.id) || sender.frameId !== 0) throw new Error('허용되지 않은 페이지입니다.');
        const allowed = ['GET_SETTINGS','GET_PROTECTION_SETTINGS','GET_DECISION_REVISION','GET_PERFORMANCE_METRICS','ANALYZE_IMAGE','ANALYZE_IMAGES','FETCH_DC_POST','VERIFY_WITH_AI','UPDATE_STATS','CANCEL_DC_REQUESTS'];
        if (!allowed.includes(message.type)) throw new Error('이 페이지에서는 설정을 변경할 수 없습니다.');
    }
    if (['ANALYZE_IMAGE','FETCH_DC_POST','VERIFY_WITH_AI','ANALYZE_IMAGES'].includes(message.type)) {
        const postUrl = validateDcUrl(message.postUrl, 'html');
        if (!privileged && new URL(postUrl).origin !== new URL(sender.url).origin) throw new Error('게시글 출처가 일치하지 않습니다.');
        if (message.imageUrl) validateDcUrl(message.imageUrl);
        if (message.imageUrls && (!Array.isArray(message.imageUrls) || message.imageUrls.length > 100)) throw new Error('이미지 목록이 올바르지 않습니다.');
        for (const url of message.imageUrls || []) validateDcUrl(url);
    }
    if (message.requestId !== undefined && (typeof message.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(message.requestId))) throw new Error('요청 ID가 올바르지 않습니다.');
    return privileged;
}

export function contentSettings(settings) {
    return { ...settings, nsfwApiKey: undefined,
        apis: Object.fromEntries(Object.entries(settings.apis || {}).map(([key, value]) => [key,
            { enabled: value.enabled, priority: value.priority, hasApiKey: Boolean(value.apiKey) }])) };
}
