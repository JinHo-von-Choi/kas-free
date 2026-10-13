import { normalizeCheck, displayDecision, sensitivityScore } from '../../src/utils/decision.js';
import { validateMessage, contentSettings } from '../../src/background/messageSecurity.js';
import { validateProfile } from '../../src/utils/personalProfile.js';

describe('판정 계약과 메시지 보안', () => {
    test('서버 의료 경고와 개인 pass를 보존하고 고어로 바꾸지 않는다', () => {
        const result = normalizeCheck({ matched:true, categoryScores:{ medical:{ similarity:.72, severity:2, imageId:1 } },
            composite:{ suggestedAction:'warn' },personalDecision:{ action:'pass',reason:'category_or_similarity_excluded' } },'server');
        expect(result.categories.medical).toBe(.4);
        expect(result.categories.gore).toBe(0);
        expect(result.globalVerdict).toBe('harmful');
        expect(displayDecision(result).status).toBe('safe');
        expect(result.personalDecision.reason).toBe('category_or_similarity_excluded');
    });
    test('해시 미일치는 미확인, 정상 확정은 clean으로 구분한다', () => {
        const unknown = normalizeCheck({ matched:false },'hash');
        expect(displayDecision(unknown).status).toBe('unchecked');
        expect(unknown.globalVerdict).toBe('unknown');
        expect(normalizeCheck({ matched:false,isVerified:true },'server').globalVerdict).toBe('clean');
    });
    test('개인 no-known-match도 정상 판정으로 표시하지 않는다', () => {
        const result = normalizeCheck({ matched:false,personalDecision:{action:'pass',reason:'no_known_match'} },'server');
        expect(displayDecision(result).status).toBe('unchecked');
        expect(result.globalVerdict).toBe('unknown');
    });
    test.each(['error','deferred','cancelled','unchecked'])('%s는 0점 범주가 있어도 안전으로 바뀌지 않는다', status => {
        expect(displayDecision({ status, categories:{gore:0},riskScore:0 }).status).toBe(status);
    });
    test('작은 다른 점수로 고어가 희석되지 않고 명시한 민감도 0을 존중한다', () => {
        expect(sensitivityScore({ categories:{gore:1,violence:.001,medical:.001} })).toBe(1);
        expect(sensitivityScore({ categories:{gore:1} },{gore:0})).toBe(0);
    });
    test.each([{ matched:true,composite:{suggestedAction:'invalid'} }, { matched:true,categoryScores:{gore:{similarity:NaN,severity:5}} }])('손상 응답은 안전 기본값으로 정규화하지 않는다', data => {
        expect(() => normalizeCheck(data,'server')).toThrow();
    });
    test('본문 content에 API 키를 보내지 않는다', () => {
        const result = contentSettings({ nsfwApiKey:'test-key', apis:{ gpt4oMini:{enabled:true,apiKey:'test-ai-key'} } });
        expect(JSON.stringify(result)).not.toContain('test-key');
        expect(JSON.stringify(result)).not.toContain('test-ai-key');
        expect(result.apis.gpt4oMini.hasApiKey).toBe(true);
    });
    test('content가 설정 변경이나 임의 URL fetch를 요청할 수 없다', () => {
        const sender={id:'extension',url:'https://gall.dcinside.com/board/lists/?id=test',tab:{id:1},frameId:0};
        expect(() => validateMessage({type:'UPDATE_SETTINGS'},sender,'extension')).toThrow();
        expect(() => validateMessage({type:'FETCH_DC_POST',postUrl:'https://127.0.0.1/'},sender,'extension')).toThrow();
        expect(validateMessage({type:'GET_SETTINGS'},sender,'extension')).toBe(false);
    });
    test('profile는 범주 제외·도메인·만료를 보존하고 위험 도메인 문자열을 거부한다', () => {
        expect(validateProfile({categories:{gore:{enabled:false}},domainExceptions:['Example.COM.']})).toMatchObject({categories:{gore:{enabled:false}},domainExceptions:['example.com']});
        for (const domain of ['example.com:443','example.com@evil.test','example.com/path','example.com\\evil']) expect(() => validateProfile({domainExceptions:[domain]})).toThrow();
    });
    test('갤러리·범주 설정이 다른 캐시는 충돌하지 않는다', () => {
        const a=globalThis.KasDecision.cacheKey(1,'https://gall.dcinside.com/board/view/?id=a&no=1');
        const b=globalThis.KasDecision.cacheKey(1,'https://gall.dcinside.com/board/view/?id=b&no=1');
        expect(a).not.toBe(b);
    });
});
