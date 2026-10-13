/** 서버 요청별 개인 정책의 입력 경계를 검증한다. */
export function validateProfile(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some(key => !['version', 'categories', 'domainExceptions', 'bypassUntil'].includes(key))
        || (input.version !== undefined && input.version !== 1)) throw new Error('개인 필터 설정이 올바르지 않습니다.');
    const names = ['gore','violence','death','disturbing','insects','medical','shock','animal_cruelty','nsfw_porn','nsfw_sexy'];
    const categories = {};
    if (input.categories && (typeof input.categories !== 'object' || Array.isArray(input.categories))) throw new Error('범주 설정이 올바르지 않습니다.');
    for (const [name, rule] of Object.entries(input.categories || {})) {
        if (!names.includes(name) || !rule || typeof rule !== 'object' || Array.isArray(rule)
            || Object.keys(rule).some(key => !['enabled','minimumSimilarity'].includes(key))
            || (rule.enabled !== undefined && typeof rule.enabled !== 'boolean')
            || (rule.minimumSimilarity !== undefined && (!Number.isFinite(rule.minimumSimilarity) || rule.minimumSimilarity < 0 || rule.minimumSimilarity > 1))) throw new Error('범주 설정이 올바르지 않습니다.');
        categories[name] = { ...rule };
    }
    if (input.domainExceptions !== undefined && (!Array.isArray(input.domainExceptions) || input.domainExceptions.length > 100)) throw new Error('사이트 예외는 100개까지 지정할 수 있습니다.');
    const domainExceptions = [...new Set((input.domainExceptions || []).map(domain => {
        if (typeof domain !== 'string' || !domain || /[\s\\/@?#:]/.test(domain)) throw new Error('사이트 예외에는 포트나 경로 없는 도메인을 입력하세요.');
        const host = new URL('https://' + domain).hostname.toLowerCase().replace(/\.$/, '');
        if (!host || host.length > 253 || host.startsWith('.') || host.includes('..')) throw new Error('도메인이 올바르지 않습니다.');
        return host;
    }))].sort();
    const profile = { version: 1, categories, domainExceptions };
    if (input.bypassUntil !== undefined) {
        if (typeof input.bypassUntil !== 'string' || !Number.isFinite(Date.parse(input.bypassUntil))) throw new Error('일시 해제 시간이 올바르지 않습니다.');
        profile.bypassUntil = new Date(input.bypassUntil).toISOString();
    }
    return profile;
}
