/** 서버 근거와 개인 표시 조치를 분리하는 공통 판정 함수. */
(function(root) {
    'use strict';
    const defaults = { gore: .8, violence: .8, death: .8, disturbing: .8, insects: .7,
        medical: .7, shock: .7, animal_cruelty: .8, nsfw_porn: .3, nsfw_sexy: .2 };
    const actionStatus = { pass: 'safe', warn: 'caution', blur: 'danger', block: 'danger', review: 'unchecked' };
    const failureStates = new Set(['error', 'unchecked', 'deferred', 'cancelled', 'loading']);

    function normalizeCheck(data, source) {
        if (!data || typeof data.matched !== 'boolean') throw new Error('검사 응답 형식이 올바르지 않습니다.');
        const personalDecision = data.personalDecision || null;
        if (personalDecision && !Object.hasOwn(actionStatus, personalDecision.action)) throw new Error('개인 판정 응답이 올바르지 않습니다.');
        const suggestedAction = data.composite?.suggestedAction ?? data.suggestedAction;
        if (suggestedAction != null && !Object.hasOwn(actionStatus, suggestedAction)) throw new Error('검사 조치를 확인할 수 없습니다.');
        const evidence = data.categoryScores || {};
        const categories = Object.fromEntries(Object.keys(defaults).map(name => [name, 0]));
        for (const [name, row] of Object.entries(evidence)) {
            if (!Object.hasOwn(defaults, name) || !row || !Number.isFinite(row.similarity)
                || row.similarity < 0 || row.similarity > 1 || !Number.isFinite(row.severity) || row.severity < 1 || row.severity > 5) {
                throw new Error('검색 근거 형식이 올바르지 않습니다.');
            }
            categories[name] = row.severity / 5;
        }
        if (data.scores) {
            for (const [name, score] of Object.entries(data.scores)) {
                if (Object.hasOwn(defaults, name)) {
                    if (!Number.isFinite(score) || score < 0 || score > 1) throw new Error('범주 점수가 올바르지 않습니다.');
                    categories[name] = score;
                }
            }
        }
        if (!Object.keys(evidence).length && !data.scores && data.image) {
            const name = Object.keys(defaults)[[1,2,3,4,5,6,7,8,9,10].indexOf(Number(data.image.category))];
            if (name && Number.isFinite(data.image.severity) && data.image.severity >= 1 && data.image.severity <= 5) categories[name] = data.image.severity / 5;
        }
        let globalVerdict = data.isVerified && !data.matched ? 'clean' : data.matched ? 'harmful' : 'unknown';
        let action = suggestedAction;
        if (!data.matched && !data.isVerified) action = 'review';
        if (data.isVerified && !data.matched) action = 'pass';
        if (data.matched && !action) action = 'review';
        const explicitBypass = ['domain_exception', 'temporary_bypass', 'category_or_similarity_excluded'].includes(personalDecision?.reason);
        const displayAction = globalVerdict === 'unknown' && !explicitBypass ? 'review' : personalDecision?.action ?? action;
        return { ...data, categories, evidence, personalDecision, suggestedAction: action, displayAction,
            globalVerdict, status: actionStatus[displayAction] || 'unchecked',
            riskScore: data.matched ? Math.max(...Object.values(categories)) : data.isVerified ? 0 : null,
            imageId: data.image?.id ?? data.primaryMatch?.imageId,
            severity: data.image?.severity ?? data.primaryMatch?.severity,
            scoreKind: Object.keys(evidence).length ? 'severity' : 'classification',
            source, analysisState: 'completed', timestamp: Date.now(), decisionVersion: 2 };
    }

    function sensitivityScore(result, sensitivity = {}) {
        const categories = result.categories || result.detailedScores;
        if (!categories) return Number.isFinite(result.riskScore) ? result.riskScore : 0;
        let strongest = 0;
        for (const [name, score] of Object.entries(categories)) {
            if (!Object.hasOwn(defaults, name) || !Number.isFinite(score) || score < 0 || score > 1) continue;
            const chosen = sensitivity[name] ?? defaults[name];
            const contribution = Math.max(0, Math.min(1, score * chosen / defaults[name]));
            strongest = Math.max(strongest, contribution);
        }
        return strongest;
    }

    function displayDecision(result, settings = {}) {
        if (!result) return { status: 'unchecked', riskScore: null };
        if (failureStates.has(result.status)) return { status: result.status, riskScore: null };
        if (result.displayAction) return { status: actionStatus[result.displayAction] || 'unchecked', riskScore: result.riskScore };
        if (result.personalDecision) return { status: actionStatus[result.personalDecision.action] || 'unchecked', riskScore: result.riskScore };
        if (result.suggestedAction) return { status: actionStatus[result.suggestedAction] || 'unchecked', riskScore: result.riskScore };
        let riskScore = sensitivityScore(result, settings.sensitivity);
        if (result.source === 'client-ai') {
            const weights = { disturbing:1.30,gore:1.15,shock:1.05,death:1,animal_cruelty:1,violence:.85,medical:.75,insects:.60,nsfw_porn:.25,nsfw_sexy:.10 };
            const rows = Object.entries(result.categories || {}).filter(([name,score])=>Object.hasOwn(weights,name) && Number.isFinite(score) && score>=0 && score<=1)
                .map(([name,score])=>({name,raw:score,sexual:name.startsWith('nsfw_'),contribution:weights[name]*Math.min(1,score*(settings.sensitivity?.[name] ?? defaults[name])/defaults[name])}))
                .sort((a,b)=>b.contribution-a.contribution);
            if (!rows.length) return {status:'error',riskScore:null};
            const top=rows[0];
            const nonSexual=rows.filter(row=>!row.sexual);
            const second=nonSexual.find(row=>row.name!==top.name);
            riskScore=Math.min(1,top.contribution+(second?.contribution || 0)*.15);
            if(top.sexual && Math.max(0,...nonSexual.map(row=>row.raw))<.35)riskScore=Math.min(.3,riskScore);
            const status=riskScore<.35?'safe':riskScore<.55?'caution':'danger';
            return {status:(result.categories?.disturbing ?? 0)>=.55 && status!=='danger'?'danger':status,riskScore};
        }
        const { safeMax = .3, cautionMax = .6 } = settings.thresholds || {};
        return { status: riskScore < safeMax ? 'safe' : riskScore < cautionMax ? 'caution' : 'danger', riskScore };
    }

    function cacheKey(postNo, pageUrl, settings = {}) {
        const url = new URL(pageUrl);
        return JSON.stringify([url.origin, url.pathname.includes('/mini/') ? 'mini' : url.pathname.includes('/mgallery/') ? 'minor' : 'gallery',
            url.searchParams.get('id'), String(postNo), settings.profile || null, settings.sensitivity || null, settings.thresholds || null]);
    }
    root.KasDecision = Object.freeze({ normalizeCheck, sensitivityScore, displayDecision, cacheKey, categories: Object.keys(defaults) });
})(globalThis);
