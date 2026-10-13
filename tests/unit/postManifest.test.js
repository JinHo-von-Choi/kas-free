import { extractPostManifest, aggregatePostResults } from '../../src/background/postManifest.js';

const post = 'https://gall.dcinside.com/board/view/?id=test&no=1';
test('OG와 본문 밖 이미지를 검사 대상으로 섞지 않고 본문 전체를 추출한다', () => {
    const html = `<meta property="og:image" content="https://dcimg1.dcinside.com/viewimage.php?outside=1">
        <div class="writing_view_box"><div><img data-fileno="1" src="https://dcimg1.dcinside.com/viewimage.php?id=a&amp;no=1"></div>
        <img src='https://dcimg2.dcinside.com/viewimage.php?id=b'><img class="written_dccon" src="https://dcimg1.dcinside.com/viewimage.php?dccon=1"></div>
        <img src="https://dcimg1.dcinside.com/viewimage.php?outside=2">`;
    expect(extractPostManifest(html,post)).toEqual({ imageUrls:[
        'https://dcimg1.dcinside.com/viewimage.php?id=a&no=1','https://dcimg2.dcinside.com/viewimage.php?id=b'
    ],unavailableCount:0 });
});
test('본문의 미지원 외부 이미지와 손상 주소도 부분 검사 수에 포함한다', () => {
    expect(extractPostManifest('<div class="writing_view_box"><img src="https://example.com/a.png"><img></div>',post).unavailableCount).toBe(2);
    expect(() => extractPostManifest('<div class="writing_view_box"><img>',post)).toThrow();
});
test('마지막 이미지가 위험이면 게시글도 위험이다', () => {
    expect(aggregatePostResults([{status:'safe',globalVerdict:'clean'},{status:'danger',globalVerdict:'harmful'}],2)).toMatchObject({status:'danger',globalVerdict:'harmful',complete:true});
});
test('하나라도 미확인·누락이면 전체 안전으로 집계하지 않는다', () => {
    expect(aggregatePostResults([{status:'safe',globalVerdict:'clean'}],2).status).toBe('unchecked');
    expect(aggregatePostResults([{status:'safe'},{status:'unchecked'}],2).status).toBe('unchecked');
    expect(aggregatePostResults([{status:'safe'},{status:'deferred',retryAt:123}],2)).toMatchObject({status:'deferred',retryAt:123});
});

test('srcset의 다른 원본도 게시글 검사에서 누락하지 않는다',()=>{
 const result=extractPostManifest('<div class="writing_view_box"><img src="https://dcimg1.dcinside.com/viewimage.php?id=1" srcset="https://dcimg1.dcinside.com/viewimage.php?id=2 1x, https://dcimg1.dcinside.com/viewimage.php?id=3 2x"></div>',post);
 expect(result.imageUrls).toHaveLength(3);expect(result.unavailableCount).toBe(0);
});
