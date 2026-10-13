import { validateDcUrl } from './DcRequestBroker.js';

/** 본문 div의 범위를 찾아 이미지 주소만 추출한다. HTML은 실행하지 않는다. */
export function extractPostManifest(html, postUrl) {
    const open = /<div\b(?:[^>"']|"[^"]*"|'[^']*')*\bclass\s*=\s*["'][^"']*\bwriting_view_box\b[^"']*["'](?:[^>"']|"[^"]*"|'[^']*')*>/i.exec(html);
    if (!open) throw new Error('게시글 본문 범위를 확인할 수 없습니다.');
    const start = open.index + open[0].length;
    const tags = /<\/?div\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
    tags.lastIndex = start;
    let depth = 1, end = html.length, tag;
    while ((tag = tags.exec(html))) {
        depth += /^<\//.test(tag[0]) ? -1 : 1;
        if (depth === 0) { end = tag.index; break; }
    }
    if (depth !== 0) throw new Error('게시글 본문이 완전하지 않습니다.');
    const body = html.slice(start, end).replace(/<(script|style|iframe)\b[\s\S]*?<\/\1\s*>/gi, '');
    const urls = [];
    let unavailableCount = 0;
    for (const match of body.matchAll(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
        if (/\bwritten_dccon\b/.test(match[0])) continue;
        const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[0]);
        const srcset = /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[0]);
        const candidates = [];
        if (src) candidates.push(src[1] ?? src[2] ?? src[3]);
        if (srcset) candidates.push(...(srcset[1] ?? srcset[2] ?? srcset[3]).split(',').map(row => row.trim().split(/\s+/)[0]));
        if (!candidates.length) { unavailableCount++; continue; }
        for (const candidate of candidates) {
            const value = candidate.replace(/&amp;/gi, '&').replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Math.min(Number(number), 0x10ffff)));
            try {
                const url = validateDcUrl(new URL(value, postUrl).href);
                if (/\/viewimage\.php(?:\?|$)/i.test(url)) urls.push(url);
                else unavailableCount++;
            } catch { unavailableCount++; }
        }
    }
    return { imageUrls: [...new Set(urls)], unavailableCount };
}

export function extractPostImages(html, postUrl) { return extractPostManifest(html, postUrl).imageUrls; }

/** 하나라도 미확인인 게시글은 전체 정상으로 표시하지 않는다. */
export function aggregatePostResults(results, total) {
    const danger = results.find(result => result.status === 'danger');
    const caution = results.find(result => result.status === 'caution');
    const failure = results.find(result => ['error', 'deferred', 'cancelled'].includes(result.status));
    const selected = danger || caution || failure || results.find(result => result.status !== 'safe') || results[0];
    const complete = results.length === total && total > 0;
    const status = danger ? 'danger' : caution ? 'caution' : failure ? failure.status : complete && results.every(result => result.status === 'safe') ? 'safe' : 'unchecked';
    return { ...(selected || {}), status, displayAction: status === 'danger' ? 'block' : status === 'caution' ? 'warn' : status === 'safe' ? 'pass' : 'review',
        globalVerdict: results.some(result => result.globalVerdict === 'harmful') ? 'harmful'
            : complete && results.every(result => result.globalVerdict === 'clean') ? 'clean' : 'unknown',
        complete, checkedImageCount: results.length, imageCount: total, imageResults: results };
}
