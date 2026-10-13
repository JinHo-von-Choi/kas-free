const path = require('node:path');
const fs = require('node:fs');

function pageHtml(images = [1,2]) {
    return `<!doctype html><html lang="ko"><head><title>이미지 보호 검증</title></head><body><h1>이미지 보호 검증</h1><div class="writing_view_box"><div class="write_div">비민감 테스트 자료${images.map(i=>`<img data-fileno="${i}" width="80" height="80" src="https://dcimg${i}.dcinside.com/viewimage.php?id=${i}">`).join('')}</div></div></body></html>`;
}

async function launchFixtureBrowser() {
    const { default: puppeteer } = await import('puppeteer');
    const root = path.resolve(__dirname, '../..');
    const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || await puppeteer.executablePath(), headless:true, enableExtensions:[root], args:['--no-sandbox'] });
    const errors = [];
    const target = await browser.waitForTarget(t=>t.type()==='service_worker' && t.url().startsWith('chrome-extension://'),{timeout:15000});
    const id = new URL(target.url()).host;
    const session = await target.createCDPSession();
    const image = fs.readFileSync(path.join(root,'tests/fixtures/marker.png'));
    const requests = [];
    const state = { revision:'fixture:1',mode:'unknown',dcStatus:200,retryAfter:'60' };
    await session.send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
    session.on('Fetch.requestPaused',async event=>{
        const url = new URL(event.request.url);
        requests.push({pathname:url.pathname,hostname:url.hostname,time:Date.now(),postData:event.request.postData});
        let status=200,type='application/json',body=''; const headers=[];
        if (/\.dcinside\.(com|co\.kr)$/.test(url.hostname)) {
            status=state.dcStatus;
            if(status===429)headers.push({name:'Retry-After',value:state.retryAfter});
            if(url.pathname==='/viewimage.php'){type='image/png';body=image.toString('base64');}
            else{type='text/html';body=Buffer.from(pageHtml()).toString('base64');}
        } else if(url.pathname==='/api/policy/revision')body=Buffer.from(JSON.stringify({success:true,data:{decisionRevision:state.revision}})).toString('base64');
        else if(url.pathname==='/api/check/hash') {
            let data={matched:false,suggestedAction:null};
            if(state.mode==='medical')data={matched:true,image:{id:1,category:6,severity:2},scores:{medical:.4},suggestedAction:'warn'};
            if(state.mode==='clean')data={matched:false,isVerified:true};
            const profile=JSON.parse(event.request.postData||'{}').profile;
            if(profile?.categories?.medical?.enabled===false && data.matched)data.personalDecision={action:'pass',reason:'category_or_similarity_excluded'};
            body=Buffer.from(JSON.stringify({success:true,data})).toString('base64');
        } else if(url.pathname==='/health')body=Buffer.from('{"status":"healthy"}').toString('base64');
        else if(url.pathname==='/api/check')body=Buffer.from(JSON.stringify({success:true,data:{matched:false,categoryScores:{},composite:{suggestedAction:'pass'}}})).toString('base64');
        else status=404;
        try{await session.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:type},...headers],body});}
        catch(error){if(!/Target closed|Invalid InterceptionId|Session closed/.test(error.message))errors.push(error.message);}
    });
    const options=await browser.newPage();options.on('pageerror',e=>errors.push(e.message));
    await options.goto(`chrome-extension://${id}/src/options/options.html`);
    await options.waitForFunction(()=>document.querySelectorAll('#profileCategories input').length===10);
    const send=(type,extra={})=>options.evaluate((type,extra)=>chrome.runtime.sendMessage({type,...extra}),type,extra);
    const newDcPage=async(html,postNo=1)=>{
        const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
        await page.setRequestInterception(true);
        page.on('request',request=>{
            if(request.url().startsWith('https://gall.dcinside.com'))request.respond({status:200,contentType:'text/html',body:html});
            else if(/^https:\/\/dcimg\d+\.dcinside\.com\//.test(request.url()))request.respond({status:200,contentType:'image/png',body:image});
            else if(request.url().startsWith('chrome-extension://'))request.continue();
            else request.abort();
        });
        await page.goto(`https://gall.dcinside.com/board/view/?id=tests&no=${postNo}`);return page;
    };
    return {browser,options,id,state,requests,errors,send,newDcPage,session,root};
}
module.exports={launchFixtureBrowser,pageHtml};
