import { displayDecision } from '../../src/utils/decision.js';
import { DEFAULT_SETTINGS } from '../../src/utils/constants.js';
describe('실제 판정 임계값',()=>{
    test('설정 기본값과 경계를 공유한다',()=>expect(DEFAULT_SETTINGS.thresholds).toEqual({safeMax:.3,cautionMax:.6}));
    test.each([[0,'safe'],[.2999999999,'safe'],[.3,'caution'],[.5999999999,'caution'],[.6,'danger'],[1,'danger']])('%s → %s',(riskScore,status)=>{
        expect(displayDecision({riskScore},DEFAULT_SETTINGS).status).toBe(status);
    });
    test.each([[.39,'safe'],[.4,'caution'],[.69,'caution'],[.7,'danger']])('개인 임계값 %s → %s',(riskScore,status)=>{
        expect(displayDecision({riskScore},{thresholds:{safeMax:.4,cautionMax:.7}}).status).toBe(status);
    });
    test('서버 개인 정책은 임계값으로 덮어쓰지 않는다',()=>{
        expect(displayDecision({displayAction:'pass',riskScore:1},DEFAULT_SETTINGS).status).toBe('safe');
        expect(displayDecision({displayAction:'block',riskScore:0},DEFAULT_SETTINGS).status).toBe('danger');
    });
    test('미확인을 낮은 점수로 해제하지 않는다',()=>expect(displayDecision({status:'unchecked',riskScore:0},DEFAULT_SETTINGS).status).toBe('unchecked'));
    test('AI 성적 범주만 높은 자료는 기본 혐오 정책으로 고어 차단하지 않는다',()=>{
        expect(displayDecision({source:'client-ai',categories:{nsfw_porn:1,gore:0,disturbing:0}},DEFAULT_SETTINGS).status).toBe('safe');
    });
    test('AI 불쾌감 범주는 기본 정책의 차단 하한을 유지한다',()=>{
        expect(displayDecision({source:'client-ai',categories:{disturbing:.55}},DEFAULT_SETTINGS).status).toBe('danger');
    });
});
