/** @jest-environment node */
import { DecisionRevisionClient } from '../../src/background/DecisionRevisionClient.js';

test('동시에 요청한 revision을 공유하고 짧은 TTL 뒤 갱신한다', async () => {
    let now = 10000;
    const fetchFn=jest.fn(async()=>new Response(JSON.stringify({success:true,data:{decisionRevision:'policy:clip:1'}})));
    const client=new DecisionRevisionClient({fetchFn,now:()=>now});
    expect(await Promise.all([client.getRevision(),client.getRevision()])).toEqual(['policy:clip:1','policy:clip:1']);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now+=10001;
    fetchFn.mockResolvedValueOnce(new Response(JSON.stringify({success:true,data:{decisionRevision:'policy:clip:2'}})));
    expect(await client.getRevision()).toBe('policy:clip:2');
});
test('서버 미반영·장애·손상 응답에서 과거 revision을 재사용하지 않는다', async () => {
    let now=10000;
    const fetchFn=jest.fn(async()=>new Response(JSON.stringify({success:true,data:{decisionRevision:'v1'}})));
    const client=new DecisionRevisionClient({fetchFn,now:()=>now});
    await client.getRevision(); now+=10001;
    fetchFn.mockResolvedValueOnce(new Response('',{status:404}));
    expect(await client.getRevision()).toBeNull();
    now+=10001;
    fetchFn.mockResolvedValueOnce(new Response(JSON.stringify({success:true,data:{decisionRevision:123}})));
    expect(await client.getRevision()).toBeNull();
});
