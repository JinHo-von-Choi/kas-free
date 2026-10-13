import '../../src/utils/messageClient.global.js';
const { send } = globalThis.KasMessageClient;
describe('실제 콘텐츠 메시지 클라이언트', () => {
    let runtime,callback;
    beforeEach(()=>{jest.useFakeTimers();runtime={lastError:null,sendMessage:jest.fn((_,cb)=>{callback=cb;})};});
    afterEach(()=>{jest.useRealTimers();});
    test('응답 후 시간 제한을 해제하고 요청 ID를 보낸다',async()=>{
        const pending=send({type:'GET_SETTINGS'},{runtime});callback({enabled:true});
        await expect(pending).resolves.toEqual({enabled:true});expect(jest.getTimerCount()).toBe(0);
        expect(runtime.sendMessage.mock.calls[0][0].requestId).toMatch(/^[a-zA-Z0-9_-]{1,80}$/);
    });
    test('늦은 응답은 시간 초과를 되돌리지 않는다',async()=>{
        const pending=send({type:'GET_SETTINGS'},{runtime,timeout:100});
        const rejected=expect(pending).rejects.toThrow('시간이 초과');jest.advanceTimersByTime(100);callback({enabled:true});await rejected;
        expect(jest.getTimerCount()).toBe(0);
    });
    test('설정 변경 이전 응답을 거부한다',async()=>{
        let value=1;const pending=send({type:'GET_SETTINGS'},{runtime,generation:()=>value});value=2;callback({enabled:true});
        await expect(pending).rejects.toThrow('설정이 변경');expect(jest.getTimerCount()).toBe(0);
    });
    test.each(['missing','disconnected','throw'])('%s도 타이머를 정리한다',async reason=>{
        if(reason==='throw')runtime.sendMessage.mockImplementation(()=>{throw Error('closed');});
        const pending=send({type:'GET_SETTINGS'},{runtime});
        if(reason!=='throw'){if(reason==='disconnected')runtime.lastError={message:'closed'};callback(undefined);}
        await expect(pending).rejects.toThrow();expect(jest.getTimerCount()).toBe(0);
    });
    test('보류 상태를 손실 없이 전달한다',async()=>{
        const value={status:'deferred',code:'DC_DEFERRED',retryAt:100};const pending=send({type:'ANALYZE_IMAGE'},{runtime});callback(value);
        await expect(pending).resolves.toEqual(value);
    });
});
