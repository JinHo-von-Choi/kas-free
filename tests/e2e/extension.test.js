const { test,before,after }=require('node:test');
const assert=require('node:assert/strict');
const { launchFixtureBrowser,pageHtml }=require('./browserHarness');
let h;
before(async()=>{h=await launchFixtureBrowser();},{timeout:30000});
after(async()=>{if(h)await h.browser.close();});
test('확장과 설정·팝업 로드 및 메시지 응답',async()=>{
 assert.match(h.id,/^[a-z]{32}$/);
 const settings=await h.send('GET_SETTINGS');
 assert.equal(typeof settings.enabled,'boolean');
 assert.ok(await h.options.title());
 assert.equal(settings.prefetchEnabled,false);assert.equal(settings.allowServerAnalysis,false);assert.equal(settings.protectPending,true);
 assert.equal(await h.options.$$eval('#profileCategories input',nodes=>nodes.length),10);
 const popup=await h.browser.newPage();await popup.goto(`chrome-extension://${h.id}/src/popup/popup.html`);
 assert.ok(await popup.title());assert.ok(await popup.$('#statsScanned'));await popup.close();assert.deepEqual(h.errors,[]);
 const stats=await h.send('GET_STATS');assert.ok(stats.total);assert.ok(stats.today);
 const metrics=await h.send('GET_PERFORMANCE_METRICS');assert.ok(metrics.analysis);assert.ok(metrics.cache);
});
test('설정과 통계의 저장·복원 및 컨텍스트 메뉴 생성',async()=>{
 const settings=await h.send('GET_SETTINGS');
 assert.equal((await h.send('UPDATE_SETTINGS',{settings:{...settings,thresholds:{safeMax:.4,cautionMax:.7}}})).success,true);
 assert.deepEqual((await h.send('GET_SETTINGS')).thresholds,{safeMax:.4,cautionMax:.7});
 const before=await h.send('GET_STATS');await h.send('UPDATE_STATS',{signalType:'caution'});
 assert.equal((await h.send('GET_STATS')).total.caution,before.total.caution+1);
 const stored=await h.options.evaluate(()=>chrome.storage.local.get(['kas_settings','kas_stats']));
 assert.deepEqual(stored.kas_settings.thresholds,{safeMax:.4,cautionMax:.7});assert.ok(stored.kas_stats.total);
 const menu=await h.options.evaluate(()=>new Promise(resolve=>chrome.contextMenus.create({id:'fixture-menu',title:'fixture',contexts:['image']},()=>resolve(!chrome.runtime.lastError))));
 assert.equal(menu,true);
});
test('미확인 이미지는 가리고 직접 공개할 때만 노출',async()=>{
 const page=await h.newDcPage(pageHtml());
 await page.waitForFunction(()=>document.querySelector('.kas-protection-notice')?.textContent.includes('공개 가능'));
 assert.deepEqual(await page.$$eval('.writing_view_box img',images=>images.map(img=>({status:img.dataset.kasStatus,visible:getComputedStyle(img).visibility}))),
 [{status:'unchecked',visible:'hidden'},{status:'unchecked',visible:'hidden'}]);
 await page.click('.kas-protection-notice button');
 assert.deepEqual(await page.$$eval('.writing_view_box img',images=>images.map(img=>getComputedStyle(img).visibility)),['visible','visible']);
 await page.close();
});
test('동적 이미지·주소 변경에 독립 검사와 가림 적용',async()=>{
 const page=await h.newDcPage(pageHtml([3]));
 await page.waitForFunction(()=>document.querySelector('img')?.dataset.kasStatus==='unchecked');
 await page.evaluate(()=>{const img=document.createElement('img');img.src='https://dcimg4.dcinside.com/viewimage.php?id=4';document.querySelector('.write_div').append(img);});
 await page.waitForFunction(()=>document.querySelectorAll('.write_div img')[1]?.dataset.kasStatus==='unchecked');
 assert.equal(await page.$eval('.write_div img:last-child',img=>getComputedStyle(img).visibility),'hidden');
 await page.click('.kas-protection-notice button');
 await page.$eval('.write_div img:last-child',img=>{img.src='https://dcimg5.dcinside.com/viewimage.php?id=5';});
 await page.waitForFunction(()=>document.querySelector('.write_div img:last-child')?.dataset.kasCheckedSrc?.includes('id=5'));
 assert.equal(await page.$eval('.write_div img:last-child',img=>getComputedStyle(img).visibility),'hidden');
 await page.$eval('.write_div img:last-child',img=>{img.srcset='https://dcimg14.dcinside.com/viewimage.php?id=14 1x';});
 await page.waitForFunction(()=>document.querySelector('.write_div img:last-child')?.dataset.kasCheckedSrc?.includes('id=14'));
 assert.equal(await page.$eval('.write_div img:last-child',img=>getComputedStyle(img).visibility),'hidden');await page.close();
});
test('개인 범주 제외가 서버 요청과 의료 판정에 연결',async()=>{
 h.state.mode='medical';h.state.revision='fixture:2';
 const settings=await h.send('GET_SETTINGS');
 assert.equal((await h.send('UPDATE_SETTINGS',{settings:{...settings,profile:{version:1,categories:{medical:{enabled:false}},domainExceptions:[]}}})).success,true);
 const page=await h.newDcPage(pageHtml([6]));
 await page.waitForFunction(()=>document.querySelector('.write_div img')?.dataset.kasChecked==='true');
 assert.equal(await page.$eval('.write_div img',img=>img.dataset.kasStatus),'safe');
 assert.equal(JSON.parse(h.requests.findLast(row=>row.pathname==='/api/check/hash').postData).profile.categories.medical.enabled,false);
 await page.close();h.state.mode='unknown';
});
test('자동 검사를 꺼도 본문 수동 재검사는 동작',async()=>{
 const settings=await h.send('GET_SETTINGS');
 await h.send('UPDATE_SETTINGS',{settings:{...settings,autoScan:false}});
 const page=await h.newDcPage(pageHtml([10]));
 await page.waitForSelector('.kas-protection-notice');
 const before=h.requests.filter(row=>row.pathname==='/api/check/hash').length;
 await page.click('.kas-protection-notice button:last-child');
 await page.waitForFunction(()=>document.querySelector('.write_div img')?.dataset.kasStatus==='unchecked');
 assert.ok(h.requests.filter(row=>row.pathname==='/api/check/hash').length>before);
 await page.close();await h.send('UPDATE_SETTINGS',{settings});
});
test('서버 판정 버전 변경 시 공개했던 정상 이미지도 다시 검사', {timeout:35000}, async()=>{
 h.state.mode='clean';h.state.revision='fixture:3';
 const settings=await h.send('GET_SETTINGS');
 await h.send('UPDATE_SETTINGS',{settings:{...settings,profile:{version:1,categories:{},domainExceptions:[]}}});
 const page=await h.newDcPage(pageHtml([9]));
 await page.waitForFunction(()=>document.querySelector('.write_div img')?.dataset.kasStatus==='safe');
 const downloads=h.requests.filter(row=>row.pathname==='/viewimage.php').length;
 h.state.mode='medical';h.state.revision='fixture:4';
 await page.waitForFunction(()=>document.querySelector('.write_div img')?.dataset.kasStatus==='caution',{timeout:30000});
 assert.equal(await page.$eval('.write_div img',img=>getComputedStyle(img).visibility),'hidden');
 assert.equal(h.requests.filter(row=>row.pathname==='/viewimage.php').length,downloads);
 await page.close();h.state.mode='unknown';
});
test('판정 버전 조회 실패 시 만료된 정상 이미지 가림과 자동 재수집 금지', {timeout:35000},async()=>{
 h.state.mode='clean';h.state.revision='fixture:5';
 const page=await h.newDcPage(pageHtml([11]));
 await page.waitForFunction(()=>document.querySelector('.write_div img')?.dataset.kasStatus==='safe');
 await page.$eval('.write_div img',img=>{img.dataset.kasCheckedAt=String(Date.now()-61000);});
 const downloads=h.requests.filter(row=>row.pathname==='/viewimage.php').length;
 h.state.revision=null;
 await page.waitForFunction(()=>document.querySelector('.write_div img')?.dataset.kasStatus==='unchecked',{timeout:30000});
 assert.equal(await page.$eval('.write_div img',img=>getComputedStyle(img).visibility),'hidden');
 assert.equal(h.requests.filter(row=>row.pathname==='/viewimage.php').length,downloads);
 await page.close();h.state.mode='unknown';
});
test('content 메시지에는 키가 없고 설정 변경은 거부',async()=>{
 const settings=await h.send('GET_SETTINGS');
 await h.send('UPDATE_SETTINGS',{settings:{...settings,nsfwApiKey:'fixture-secret',apis:{...settings.apis,gpt4oMini:{enabled:true,apiKey:'fixture-ai-secret',priority:1}}}});
 const page=await h.newDcPage(pageHtml([]));
 const client=await page.createCDPSession();let isolated;const contexts=[];
 client.on('Runtime.executionContextCreated',event=>{if(event.context.auxData?.isDefault===false)contexts.push(event.context.id);});
 await client.send('Runtime.enable');
 for(const contextId of contexts){
  const probe=await client.send('Runtime.evaluate',{contextId,expression:"typeof chrome !== 'undefined' && chrome.runtime?.id",returnByValue:true});
  if(probe.result.value===h.id){isolated=contextId;break;}
 }
 assert.ok(isolated,'실제 확장 content 실행 컨텍스트가 필요합니다.');
 const read=await client.send('Runtime.evaluate',{contextId:isolated,expression:"chrome.runtime.sendMessage({type:'GET_SETTINGS'})",awaitPromise:true,returnByValue:true});
 assert.ok(read.result.value);assert.equal(read.exceptionDetails,undefined);
 assert.equal(JSON.stringify(read.result.value).includes('fixture-secret'),false);
 assert.equal(JSON.stringify(read.result.value).includes('fixture-ai-secret'),false);
 const direct=await client.send('Runtime.evaluate',{contextId:isolated,expression:"chrome.storage.local.get('kas_settings').then(()=>false,()=>true)",awaitPromise:true,returnByValue:true});
 assert.equal(direct.result.value,true,'content에서 원본 키 저장소를 읽을 수 없어야 합니다.');
 const denied=await client.send('Runtime.evaluate',{contextId:isolated,expression:"chrome.runtime.sendMessage({type:'UPDATE_SETTINGS',settings:{enabled:false}})",awaitPromise:true,returnByValue:true});
 assert.equal(denied.result.value.code,'INVALID_MESSAGE');await page.close();
});
test('실제 페이지 JavaScript 오류 없음',()=>assert.deepEqual(h.errors,[]));
