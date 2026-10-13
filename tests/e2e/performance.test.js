const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {launchFixtureBrowser}=require('./browserHarness');
let h;
before(async()=>{h=await launchFixtureBrowser();},{timeout:30000});
after(async()=>{if(h)await h.browser.close();});
const postUrl='https://gall.dcinside.com/board/view/?id=tests&no=1';
test('동시 다운로드의 전체 간격·재조회 공유·실제 분석 계측',async()=>{
 const results=await Promise.all([1,2,3].map(i=>h.send('ANALYZE_IMAGE',{postUrl,imageUrl:`https://dcimg${i}.dcinside.com/viewimage.php?id=${i}`})));
 assert.ok(results.every(result=>result.status==='unchecked'));
 const downloads=h.requests.filter(row=>row.pathname==='/viewimage.php');assert.equal(downloads.length,3);
 for(let i=1;i<downloads.length;i++)assert.ok(downloads[i].time-downloads[i-1].time>=1450);
 await h.send('ANALYZE_IMAGE',{postUrl,imageUrl:'https://dcimg1.dcinside.com/viewimage.php?id=1'});
 assert.equal(h.requests.filter(row=>row.pathname==='/viewimage.php').length,3);
 const metrics=await h.send('GET_PERFORMANCE_METRICS');
 assert.equal(metrics.analysis.total,4);assert.equal(metrics.hash.total,4);assert.equal(metrics.api.total,4);
 assert.ok(metrics.hash.avgTime>0);assert.ok(metrics.api.avgTime>0);
});
test('429 뒤 다른 URL·수동 요청도 전송 중단',async()=>{
 h.state.dcStatus=429;
 assert.equal((await h.send('ANALYZE_IMAGE',{postUrl,imageUrl:'https://dcimg7.dcinside.com/viewimage.php?id=7'})).status,'deferred');
 const count=h.requests.filter(row=>row.pathname==='/viewimage.php').length;
 assert.equal((await h.send('ANALYZE_IMAGE',{postUrl,imageUrl:'https://dcimg8.dcinside.com/viewimage.php?id=8',userInitiated:true})).status,'deferred');
 assert.equal(h.requests.filter(row=>row.pathname==='/viewimage.php').length,count);
 assert.equal((await h.send('RESUME_DC_REQUESTS')).status,'deferred');
});
test('예산과 cooldown 영속 상태 확인',async()=>{
 const persisted=await h.options.evaluate(()=>chrome.storage.local.get('dcRequestBudgetV1'));
 assert.equal(persisted.dcRequestBudgetV1.history.length,4);
 assert.ok(persisted.dcRequestBudgetV1.pauseUntil>Date.now());assert.deepEqual(h.errors,[]);
});
test('기존 성능·캐시·API·해시·세션 지표 계약과 저장 유지',async()=>{
 const metrics=await h.send('GET_PERFORMANCE_METRICS');
 assert.ok(metrics.analysis.total>0);assert.ok(metrics.analysis.avgTime>0);
 for(const field of ['hits','misses','hitRate'])assert.ok(Object.hasOwn(metrics.cache,field));
 assert.match(metrics.cache.hitRate,/%$/);assert.ok(parseFloat(metrics.cache.hitRate)>=0 && parseFloat(metrics.cache.hitRate)<=100);
 for(const field of ['total','avgTime','errors','errorRate'])assert.ok(Object.hasOwn(metrics.api,field));
 assert.match(metrics.api.errorRate,/%$/);
 assert.ok(Object.hasOwn(metrics.hash,'total'));assert.ok(Object.hasOwn(metrics.hash,'avgTime'));
 assert.ok(Object.hasOwn(metrics.session,'durationHours'));
 assert.match(metrics.session.startTime,/^\d{4}-\d{2}-\d{2}T/);assert.match(metrics.session.lastReset,/^\d{4}-\d{2}-\d{2}T/);
 const stored=await h.options.evaluate(()=>chrome.storage.local.get('performance_metrics'));
 assert.ok(stored.performance_metrics);
});
