import { test, expect } from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/__test/reset');});
async function stats(request) {return (await request.get('/__test/stats')).json();}
async function picture(page,name='reference.png',width=640,height=480) {
  const data=await page.evaluate(({width,height})=>{
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#e02020';ctx.fillRect(0,0,width,height);
    ctx.fillStyle='#20b040';ctx.fillRect(width/4,height/4,width/2,height/2);
    return canvas.toDataURL('image/png').split(',')[1];
  },{width,height});
  return {name,mimeType:'image/png',buffer:Buffer.from(data,'base64')};
}
async function pixels(image) {
  await expect(image).toBeVisible();
  await expect.poll(()=>image.evaluate(img=>img.complete && img.naturalWidth>0)).toBe(true);
  return image.evaluate(img=>{
    const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;
    const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
    return {width:c.width,height:c.height,corner:[...ctx.getImageData(5,5,1,1).data],end:[...ctx.getImageData(c.width-6,c.height-6,1,1).data],center:[...ctx.getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data]};
  });
}
function green(pixel) {expect(pixel[1]).toBeGreaterThan(150);expect(pixel[0]).toBeLessThan(60);}
function red(pixel) {expect(pixel[0]).toBeGreaterThan(170);expect(pixel[1]).toBeLessThan(60);}
async function observeRecognitionUploads(page) {
  await page.addInitScript(()=>{
    window.recognitionUploads=[];
    const nativeFetch=window.fetch.bind(window);
    window.fetch=async(...args)=>{
      if(String(args[0])==='/api/admin/query') {
        const file=args[1].body.get('file'),url=URL.createObjectURL(file),image=new Image();
        try {
          await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});
          const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
          const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
          window.recognitionUploads.push({type:file.type,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join(''),width:canvas.width,height:canvas.height,
            corner:[...ctx.getImageData(5,5,1,1).data],end:[...ctx.getImageData(canvas.width-6,canvas.height-6,1,1).data],
            center:[...ctx.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data]});
        } finally {URL.revokeObjectURL(url);}
      }
      return nativeFetch(...args);
    };
  });
}
async function phonePhoto(page) {
  const base=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=640;c.height=480;
    const ctx=c.getContext('2d');ctx.fillStyle='#e02020';ctx.fillRect(0,0,640,480);
    ctx.fillStyle='#20b040';ctx.fillRect(160,120,320,240);
    return c.toDataURL('image/jpeg',.95).split(',')[1];
  });
  // EXIF TIFF IFD: orientation 6 (rotate 90 degrees clockwise).
  const exif=Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000600000000000000','hex');
  const jpeg=Buffer.from(base,'base64');
  return {name:'portrait.jpg',mimeType:'image/jpeg',buffer:Buffer.concat([jpeg.subarray(0,2),exif,jpeg.subarray(2)])};
}
async function openAdmin(page) {
  await page.goto('/admin');
  await page.locator('.artifact-admin-btn').filter({hasText:'Chiếc bình gốm'}).click();
}
async function simulatedCamera(page) {
  await page.addInitScript(()=>{
    window.cameraTracks=[];
    navigator.mediaDevices.getUserMedia=async()=>{
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
      const ctx=canvas.getContext('2d');
      window.cameraCanvas=canvas;
      const paint=()=>{ctx.fillStyle='#e02020';ctx.fillRect(0,0,640,480);ctx.fillStyle='#20b040';const t=window.cameraTarget||{x:160,y:120,w:320,h:240};ctx.fillRect(t.x,t.y,t.w,t.h);};
      paint();const timer=setInterval(paint,40);
      const stream=canvas.captureStream(25);const track=stream.getVideoTracks()[0];
      Object.defineProperty(track,'getCapabilities',{value:()=>({})});
      const stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop();};
      window.cameraTracks.push(track);
      return stream;
    };
  });
  await page.goto('/');
  test.skip(!await page.evaluate(()=>typeof HTMLCanvasElement.prototype.captureStream==='function'),
    'This browser port cannot create the canvas camera simulator (WebKit on Windows). Run camera tests on macOS/iOS too.');
  await page.getByRole('button',{name:'Chụp ảnh nhận diện',exact:true}).click();
  await expect(page.getByRole('button',{name:'Chụp ảnh để nhận diện',exact:true})).toBeEnabled();
  await expect.poll(()=>page.locator('video').evaluate(video=>video.videoWidth)).toBe(640);
}

test('digital zoom captures only the guide, releases the camera and sends the exact previewed JPEG',async({page,request},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await observeRecognitionUploads(page);
  await simulatedCamera(page);
  await page.getByRole('button',{name:'Tăng zoom',exact:true}).click();
  await expect(page.getByLabel('Zoom camera')).toHaveValue('1.25');
  await page.getByRole('button',{name:'Giảm zoom',exact:true}).click();
  await expect(page.getByLabel('Zoom camera')).toHaveValue('1');
  await page.getByLabel('Zoom camera').fill('2');
  await expect(page.locator('video')).toHaveCSS('transform','matrix(2, 0, 0, 2, 0, 0)');
  const size=await page.locator('.zoom-viewfinder').evaluate(el=>({width:el.clientWidth,height:el.clientHeight}));
  const guide=await page.locator('.capture-guide').boundingBox();
  await page.screenshot({path:`reports/camera-zoom-${info.project.name}.png`,fullPage:true});
  await page.getByRole('button',{name:'Chụp ảnh để nhận diện',exact:true}).click();
  await expect(page.locator('.recognition-preview')).toBeVisible();
  const shot=await pixels(page.getByRole('img',{name:'Ảnh nhận diện đã cắt theo khung chụp',exact:true}));
  const shotHash=await page.getByRole('img',{name:'Ảnh nhận diện đã cắt theo khung chụp',exact:true}).evaluate(async img=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await (await fetch(img.src)).arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join(''));
  const scale=Math.max(size.width/640,size.height/480)*2;
  expect(shot.width).toBe(Math.round(guide.width/scale));
  expect(shot.height).toBe(Math.round(guide.height/scale));
  expect(shot.width).toBeLessThan(Math.round(size.width/scale));
  green(shot.corner);green(shot.center);
  expect(await page.evaluate(()=>window.cameraTracks.every(t=>t.readyState==='ended'))).toBe(true);
  expect((await stats(request)).embeddings).toBe(0);
  await expect(page.locator('.recognition-preview .crop-editor')).toHaveCount(0);
  await page.getByRole('button',{name:'Nhận diện ảnh',exact:true}).click();
  await expect(page.getByText('Khớp: Chiếc bình gốm',{exact:true})).toBeVisible();
  const sent=await page.evaluate(()=>window.recognitionUploads[0]);
  expect(sent.width).toBe(shot.width);expect(sent.height).toBe(shot.height);green(sent.corner);green(sent.center);
  expect(sent.sha256).toBe(shotHash);
  expect((await stats(request)).embeddings).toBe(1);
  expect(errors).toEqual([]);
});

test('camera flip resets zoom, stops the old lens and captures after a viewport rotation',async({page,request})=>{
  await simulatedCamera(page);
  await page.getByLabel('Zoom camera').fill('3');
  await page.getByTitle('Đổi camera trước/sau').click();
  await expect(page.getByLabel('Zoom camera')).toHaveValue('1');
  await expect(page.getByRole('button',{name:'Chụp ảnh để nhận diện',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>window.cameraTracks[0].readyState)).toBe('ended');
  await page.setViewportSize({width:844,height:390});
  await page.getByLabel('Zoom camera').fill('2');
  await page.getByRole('button',{name:'Khung dọc',exact:true}).click();
  await expect(page.locator('.capture-guide')).toHaveAttribute('data-orientation','portrait');
  await page.getByRole('button',{name:'Chụp ảnh để nhận diện',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Vùng chụp có độ phân giải quá nhỏ');
  expect((await stats(request)).embeddings).toBe(0);
  await page.getByLabel('Zoom camera').fill('1.5');
  const size=await page.locator('.zoom-viewfinder').evaluate(el=>({width:el.clientWidth,height:el.clientHeight}));
  const guide=await page.locator('.capture-guide').boundingBox();
  await page.getByRole('button',{name:'Chụp ảnh để nhận diện',exact:true}).click();
  const shot=await pixels(page.getByRole('img',{name:'Ảnh nhận diện đã cắt theo khung chụp',exact:true}));
  const scale=Math.max(size.width/640,size.height/480)*1.5;
  expect(shot.width).toBe(Math.round(guide.width/scale));expect(shot.height).toBe(Math.round(guide.height/scale));
  green(shot.corner);
  expect((await stats(request)).embeddings).toBe(0);
});

for(const orientation of ['portrait','landscape']) test(`camera guide excludes outside pixels at 1x in ${orientation} mode and supports retake`,async({page,request})=>{
  await observeRecognitionUploads(page);await simulatedCamera(page);
  await page.getByRole('button',{name:orientation==='portrait'?'Khung dọc':'Khung ngang',exact:true}).click();
  const target=await page.locator('.zoom-viewfinder').evaluate(el=>{
    const v=el.getBoundingClientRect(),g=el.querySelector('.capture-guide').getBoundingClientRect();
    const scale=Math.max(v.width/640,v.height/480),w=v.width/scale,h=v.height/scale;
    return {x:(640-w)/2+(g.left-v.left)/scale,y:(480-h)/2+(g.top-v.top)/scale,w:g.width/scale,h:g.height/scale};
  });
  await page.evaluate(t=>{window.cameraTarget=t;},target);
  await expect.poll(()=>page.locator('video').evaluate(v=>v.currentTime)).toBeGreaterThan(.2);
  await page.getByRole('button',{name:'Chụp ảnh để nhận diện',exact:true}).click();
  const shot=await pixels(page.getByRole('img',{name:'Ảnh nhận diện đã cắt theo khung chụp',exact:true}));
  expect(shot.width).toBe(Math.round(target.w));expect(shot.height).toBe(Math.round(target.h));
  green(shot.corner);green(shot.end);green(shot.center);
  expect((await stats(request)).embeddings).toBe(0);
  await page.getByRole('button',{name:'Chụp lại',exact:true}).click();
  await expect(page.getByRole('button',{name:'Chụp ảnh để nhận diện',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'← Quay lại',exact:true}).click();
  await expect(page.getByRole('img',{name:'Ảnh nhận diện đã cắt theo khung chụp',exact:true})).toBeVisible();
  expect((await stats(request)).embeddings).toBe(0);
});

for (const fallback of [false,true]) {
  test(`recognition normalizes the whole photo without cropping${fallback ? ' using HTML image fallback' : ''}`,async({page,request})=>{
    await observeRecognitionUploads(page);
    if(fallback) await page.addInitScript(()=>{window.createImageBitmap=undefined;});
    await page.goto('/');
    const check=page.getByRole('region',{name:'Nhận diện ảnh',exact:true});
    await check.getByLabel('Chọn ảnh nhận diện',{exact:true}).setInputFiles(await picture(page,'whole-photo.png',2400,1800));
    const preview=await pixels(check.getByRole('img',{name:'Ảnh nhận diện toàn khung',exact:true}));
    expect(preview.width).toBe(2400);expect(preview.height).toBe(1800);red(preview.corner);red(preview.end);green(preview.center);
    await expect(check.getByRole('button',{name:'Nhận diện ảnh',exact:true})).toBeEnabled();
    await expect(check.locator('.crop-editor, .crop-box, .crop-sliders')).toHaveCount(0);
    await expect(check.getByRole('button',{name:'Khoanh vùng vật',exact:true})).toHaveCount(0);
    expect(await page.evaluate(()=>window.recognitionUploads.length)).toBe(0);
    expect((await stats(request)).embeddings).toBe(0);
    await check.getByRole('button',{name:'Nhận diện ảnh',exact:true}).click();
    await expect(check.getByText('Khớp: Chiếc bình gốm',{exact:true})).toBeVisible();
    const uploads=await page.evaluate(()=>window.recognitionUploads);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].type).toBe('image/jpeg');expect(uploads[0].width).toBe(1600);expect(uploads[0].height).toBe(1200);
    red(uploads[0].corner);red(uploads[0].end);green(uploads[0].center);
    expect((await stats(request)).embeddings).toBe(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}

test('recognition preserves the whole EXIF-oriented phone photo without crop controls',async({page,request})=>{
  await observeRecognitionUploads(page);
  await page.goto('/');
  const check=page.getByRole('region',{name:'Nhận diện ảnh',exact:true});
  await check.getByLabel('Chọn ảnh nhận diện',{exact:true}).setInputFiles(await phonePhoto(page));
  const preview=await pixels(check.getByRole('img',{name:'Ảnh nhận diện toàn khung',exact:true}));
  expect(preview.width).toBe(480);expect(preview.height).toBe(640);red(preview.corner);red(preview.end);green(preview.center);
  expect((await stats(request)).embeddings).toBe(0);
  await check.getByRole('button',{name:'Nhận diện ảnh',exact:true}).click();
  await expect(check.getByText('Khớp: Chiếc bình gốm',{exact:true})).toBeVisible();
  const sent=await page.evaluate(()=>window.recognitionUploads[0]);
  expect(sent.width).toBe(480);expect(sent.height).toBe(640);red(sent.corner);red(sent.end);green(sent.center);
  expect((await stats(request)).embeddings).toBe(1);
});

test('admin keeps each crop in a batch, uploads only its confirmed JPEG and can cancel the rest',async({page,request},info)=>{
  await openAdmin(page);
  await page.getByLabel('Chọn ảnh tham chiếu',{exact:true}).setInputFiles([await picture(page,'first.png'),await picture(page,'second.png')]);
  const editor=page.getByRole('region',{name:'Chuẩn bị ảnh tham chiếu'});
  await expect(editor).toBeVisible();
  await editor.getByRole('button',{name:'Khoanh vùng vật',exact:true}).click();
  await editor.getByLabel('Thu gọn khung').fill('50');
  await editor.getByRole('button',{name:'Để sau, xem ảnh tiếp'}).click();
  await expect(editor.getByRole('button',{name:'Nhập toàn ảnh',exact:true})).toBeEnabled();
  await editor.getByRole('button',{name:'Khoanh vùng vật',exact:true}).click();
  await editor.getByLabel('Thu gọn khung').fill('80');
  await editor.getByRole('navigation',{name:'Ảnh chờ nhập'}).getByRole('button',{name:'1',exact:true}).click();
  await expect(editor.getByLabel('Thu gọn khung')).toHaveValue('50');
  expect((await stats(request)).embeddings).toBe(0);
  await page.screenshot({path:`reports/admin-crop-${info.project.name}.png`,fullPage:true});
  await editor.getByRole('button',{name:'Nhập ảnh đã cắt',exact:true}).click();
  await expect(editor.getByText(/Đã nhập 1\/2/)).toBeVisible();
  const saved=await pixels(page.getByRole('img',{name:'first.jpg',exact:true}));
  expect(saved.width).toBe(320);expect(saved.height).toBe(240);green(saved.corner);green(saved.center);
  await expect(editor.getByLabel('Thu gọn khung')).toHaveValue('80');
  await editor.getByRole('navigation',{name:'Ảnh chờ nhập'}).getByRole('button',{name:'1 ✓',exact:true}).click();
  await expect(editor.getByText('Đã nhập ảnh này. Không cần gửi lại.')).toBeVisible();
  await expect(editor.getByRole('button',{name:'Nhập ảnh đã cắt',exact:true})).toHaveCount(0);
  await editor.getByRole('button',{name:'Đóng',exact:true}).click();
  expect((await stats(request)).embeddings).toBe(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('admin crop works with HTML image decoding fallback and non-square regions at the edge',async({page,request})=>{
  await page.addInitScript(()=>{window.createImageBitmap=undefined;AbortSignal.timeout=undefined;});
  await openAdmin(page);
  await page.getByLabel('Chụp ảnh tham chiếu',{exact:true}).setInputFiles(await picture(page));
  const editor=page.getByRole('region',{name:'Chuẩn bị ảnh tham chiếu'});
  await editor.getByRole('button',{name:'Khoanh vùng vật',exact:true}).click();
  await editor.getByLabel('Thu gọn khung').fill('50');
  await editor.getByLabel('Chiều cao khung').fill('75');
  await editor.getByLabel('Dịch ngang').fill('100');
  await editor.getByLabel('Dịch dọc').fill('100');
  await editor.getByRole('button',{name:'Nhập ảnh đã cắt',exact:true}).click();
  await expect(editor.getByText(/Đã nhập đủ 1 ảnh/)).toBeVisible();
  const saved=await pixels(page.getByRole('img',{name:'reference.jpg',exact:true}));
  expect(saved.width).toBe(320);expect(saved.height).toBe(360);
  green(saved.corner);expect(saved.end[0]).toBeGreaterThan(170);expect(saved.end[1]).toBeLessThan(60);
  await editor.getByRole('button',{name:'Hoàn tất',exact:true}).click();
  expect((await stats(request)).embeddings).toBe(1);
});

test('invalid or cancelled reference photos never call the embedding provider',async({page,request})=>{
  await openAdmin(page);
  await page.getByLabel('Chọn ảnh tham chiếu',{exact:true}).setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('invalid image')});
  const editor=page.getByRole('region',{name:'Chuẩn bị ảnh tham chiếu'});
  await expect(editor.getByRole('alert')).toContainText('Không đọc được ảnh');
  await expect(editor.getByRole('button',{name:'Nhập toàn ảnh',exact:true})).toBeDisabled();
  await editor.getByRole('button',{name:'Hủy nhập ảnh',exact:true}).click();
  await page.getByLabel('Chọn ảnh tham chiếu',{exact:true}).setInputFiles(await picture(page));
  await expect(editor.getByRole('button',{name:'Nhập toàn ảnh',exact:true})).toBeEnabled();
  await editor.getByRole('button',{name:'Khoanh vùng vật',exact:true}).click();
  await editor.getByLabel('Thu gọn khung').fill('10');
  await editor.getByRole('button',{name:'Nhập ảnh đã cắt',exact:true}).click();
  await expect(editor.getByRole('alert')).toContainText('Vùng chọn quá nhỏ');
  await editor.getByRole('button',{name:'Hủy nhập ảnh',exact:true}).click();
  expect((await stats(request)).embeddings).toBe(0);
});

test('two-finger gestures change zoom and reset to 1×',async({page,context,browserName})=>{
  await simulatedCamera(page);
  if(browserName==='chromium') {
    await page.locator('.zoom-viewfinder').scrollIntoViewIfNeeded();
    const cdp=await context.newCDPSession(page);
    const box=await page.locator('.zoom-viewfinder').boundingBox();
    const y=box.y+box.height/2,x=box.x+box.width/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-25,y,id:1},{x:x+25,y,id:2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-50,y,id:1},{x:x+50,y,id:2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect(page.getByLabel('Zoom camera')).toHaveValue('2');
    await page.getByRole('button',{name:'1×',exact:true}).click();
  }
  // Exercise the touch-event fallback on every engine without PointerEvent.
  await page.evaluate(()=>{window.PointerEvent=undefined;});
  await page.locator('.zoom-viewfinder').evaluate(el=>{
    function gesture(type,touches) {
      const event=new Event(type,{bubbles:true,cancelable:true});
      Object.defineProperty(event,'touches',{value:touches});el.dispatchEvent(event);
    }
    gesture('touchstart',[{clientX:100,clientY:100},{clientX:150,clientY:100}]);
    gesture('touchmove',[{clientX:75,clientY:100},{clientX:175,clientY:100}]);
    gesture('touchend',[]);
  });
  await expect(page.getByLabel('Zoom camera')).toHaveValue('2');
  await page.getByRole('button',{name:'1×',exact:true}).click();
  await expect(page.getByLabel('Zoom camera')).toHaveValue('1');
});

test('dragging the admin crop selects the corresponding original image pixels',async({page})=>{
  await page.setViewportSize({width:1365,height:900});
  await openAdmin(page);
  await page.getByLabel('Chọn ảnh tham chiếu',{exact:true}).setInputFiles(await picture(page,'drag.png'));
  const editor=page.getByRole('region',{name:'Chuẩn bị ảnh tham chiếu'});
  await editor.getByRole('button',{name:'Khoanh vùng vật',exact:true}).click();
  const stage=editor.locator('.crop-stage');await stage.scrollIntoViewIfNeeded();
  const box=await stage.boundingBox();
  await page.mouse.move(box.x+box.width*.3,box.y+box.height*.3);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.7,box.y+box.height*.7,{steps:4});await page.mouse.up();
  await editor.getByRole('button',{name:'Nhập ảnh đã cắt',exact:true}).click();
  const saved=await pixels(page.getByRole('img',{name:'drag.jpg',exact:true}));
  expect(Math.abs(saved.width-256)).toBeLessThan(4);expect(Math.abs(saved.height-192)).toBeLessThan(4);
  green(saved.corner);green(saved.end);
});

test('phone JPEG orientation is applied consistently to the preview and exported crop',async({page})=>{
  await openAdmin(page);
  await page.getByLabel('Chọn ảnh tham chiếu',{exact:true}).setInputFiles(await phonePhoto(page));
  const editor=page.getByRole('region',{name:'Chuẩn bị ảnh tham chiếu'});
  const preview=await pixels(editor.locator('.crop-stage img'));
  expect(preview.width).toBe(480);expect(preview.height).toBe(640);
  await editor.getByRole('button',{name:'Khoanh vùng vật',exact:true}).click();
  await editor.getByLabel('Thu gọn khung').fill('50');
  await editor.getByRole('button',{name:'Nhập ảnh đã cắt',exact:true}).click();
  const saved=await pixels(page.getByRole('img',{name:'portrait.jpg',exact:true}));
  expect(saved.width).toBe(240);expect(saved.height).toBe(320);green(saved.corner);green(saved.end);
});
