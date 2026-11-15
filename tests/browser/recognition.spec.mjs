import { test, expect } from '@playwright/test';
import worker from '../../worker/index.js';
import { signature } from '../../worker/pipeline.js';
import { database, seed, envDefaults } from '../fixtures.mjs';

test.beforeEach(async ({ request }) => { await request.post('/__test/reset'); });
async function stats(request) { return (await request.get('/__test/stats')).json(); }
async function picture(page, name = 'query.png') {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ea7755'; ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = '#227744'; ctx.fillRect(160, 120, 320, 240);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return { name, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') };
}
function recognition(page) { return page.getByRole('region', { name: 'Nhận diện ảnh', exact: true }); }
async function queryPhoto(page) {
  const check = recognition(page);
  await check.getByLabel('Chọn ảnh nhận diện', { exact: true }).setInputFiles(await picture(page));
  await expect(check.getByRole('button', { name: 'Nhận diện ảnh', exact: true })).toBeEnabled();
  await expect(check.getByRole('img', { name: 'Ảnh nhận diện toàn khung', exact: true })).toBeVisible();
  await expect(check.getByRole('button', { name: /Khoanh vùng vật|Dùng toàn ảnh/ })).toHaveCount(0);
  await expect(check.locator('.crop-editor, .crop-box, .crop-sliders')).toHaveCount(0);
  return check;
}

test('home is a simple reference import and recognition app without gameplay or lab', async ({ page, request }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Nhập ảnh tham chiếu & nhận diện' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Sổ tem|Dataset Met|Test ảnh/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Bắt đầu hành trình|Lưu nhiệm vụ/ })).toHaveCount(0);
  await page.getByLabel('Tên hiện vật mới').fill('Hiện vật thử nghiệm');
  await page.getByRole('button', { name: 'Tạo', exact: true }).click();
  await expect(page.locator('.artifact-admin-item.selected')).toContainText('Hiện vật thử nghiệm');
  await page.getByLabel('Chọn ảnh tham chiếu', { exact: true }).setInputFiles(await picture(page, 'reference.png'));
  const editor = page.getByRole('region', { name: 'Chuẩn bị ảnh tham chiếu' });
  await expect(editor.getByRole('button', { name: 'Nhập toàn ảnh', exact: true })).toBeEnabled();
  expect((await stats(request)).embeddings).toBe(0);
  await editor.getByRole('button', { name: 'Nhập toàn ảnh', exact: true }).click();
  await expect(editor.getByText(/Đã nhập đủ 1 ảnh/)).toBeVisible();
  await editor.getByRole('button', { name: 'Hoàn tất', exact: true }).click();
  await expect(page.locator('.artifact-admin-item.selected')).toContainText('1/1 ảnh sẵn sàng');
  const catalog = (await (await request.get('/api/admin/artifacts')).json()).artifacts;
  expect(catalog.every(artifact => !('mission' in artifact))).toBe(true);
  const check = await queryPhoto(page);
  expect((await stats(request)).embeddings).toBe(1);
  await check.getByRole('button', { name: 'Nhận diện ảnh', exact: true }).click();
  await expect(check.getByText('Khớp: Chiếc bình gốm', { exact: true })).toBeVisible();
  await expect(check.getByRole('cell', { name: '0.9500', exact: true })).toBeVisible();
  expect((await stats(request)).embeddings).toBe(2);
  const updated = (await (await request.get('/api/admin/artifacts')).json()).artifacts;
  expect(updated.reduce((total, artifact) => total + artifact.image_count, 0)).toBe(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `reports/recognition-simple-${info.project.name}.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test('opening an existing catalog selects and displays ready references without importing or spending model calls', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('.artifact-admin-item.selected')).toHaveCount(1);
  await expect(page.locator('.admin-img-card')).toHaveCount(1);
  await expect(page.locator('.admin-img-card .status-chip')).toHaveText('Sẵn sàng');
  await expect(page.locator('.reference-preview-button img')).toBeVisible();
  expect((await stats(request)).embeddings).toBe(0);
});

test('recognition returns uncertain results without pretending to match an object', async ({ page, request }) => {
  await page.goto('/'); const check = await queryPhoto(page);
  await request.post('/__test/scenario', { data: { score: .6 } });
  await check.getByRole('button', { name: 'Nhận diện ảnh', exact: true }).click();
  await expect(check.getByText('Chưa đủ rõ để xác nhận', { exact: true })).toBeVisible();
  await expect(check.getByRole('cell', { name: '0.6000', exact: true })).toBeVisible();
  expect((await stats(request)).embeddings).toBe(1);
});

test('hard-negative rejection explains an out-of-catalog confuser without claiming a match', async ({ page }) => {
  await page.route('**/api/admin/query', route => route.fulfill({ json: {
    recognized: false, status: 'uncertain', artifact_id: null, artifact: null,
    best_score: .85, margin_score: .12, threshold: .8, margin: .05, dimensions: 1536,
    hard_negative_triggered: true, candidates: [{ rank: 1, id: 'a1', name: 'Phật Bà Quan Âm', score: .85 }],
  } }));
  await page.goto('/'); const check = await queryPhoto(page);
  await check.getByRole('button', { name: 'Nhận diện ảnh', exact: true }).click();
  await expect(check.getByText('Chưa đủ rõ để xác nhận', { exact: true })).toBeVisible();
  await expect(check.getByText(/Ảnh giống một hiện vật ngoài danh mục từng gây nhầm lẫn/)).toBeVisible();
  await expect(check.getByText(/^Khớp:/)).toHaveCount(0);
});

for (const [reason,message] of [
  ['pairwise_identity_not_confirmed','Ảnh chưa đủ chi tiết để xác nhận chắc chắn'],
  ['pairwise_verifier_unavailable','Chưa thể xác nhận ảnh ở bước kiểm tra an toàn'],
]) test(`Jev ${reason} shows uncertain, not a matched runner-up`, async ({page}) => {
  await page.route('**/api/admin/query', route => route.fulfill({json:{recognized:false,status:'uncertain',artifact_id:null,artifact:null,reason,
    verifier:{status:reason==='pairwise_identity_not_confirmed'?'not_confirmed':'unavailable'},best_score:.95,margin_score:.2,threshold:.8,margin:.05,dimensions:1536,candidates:[{rank:1,id:'a1',name:'Hoàng hậu Ngọc Trúc',score:.95}]}}));
  await page.goto('/');const check=await queryPhoto(page);await check.getByRole('button',{name:'Nhận diện ảnh',exact:true}).click();
  await expect(check.getByText('Chưa đủ rõ để xác nhận',{exact:true})).toBeVisible();await expect(check.getByText(message,{exact:false})).toBeVisible();await expect(check.getByText(/^Khớp:/)).toHaveCount(0);
  await expect(check.getByRole('link',{name:'TypeSafe',exact:true})).toHaveAttribute('href','https://typesafe.ai/legal/privacy-policy');
});

test('actual Worker production-gap veto replaces a previous Phat Ba match in the web UI', async ({ page }) => {
  const db=database();
  const env={...envDefaults,DB:db,RECOGNITION_PIPELINE:'image-description-v1',DESCRIPTION_MODEL:'google/gemini-2.5-flash',RECOGNITION_HARD_NEGATIVE_GAP:'-0.009'};
  seed(db,2,signature(env));
  db.sqlite.prepare("UPDATE artifacts SET name=?,external_object_id='stamp-phat-ba-quan-am' WHERE id='a1'").run('Phật Bà Quan Âm');
  for(let i=0;i<7;i++){
    const score=i===6?.9:.2;
    const vector=[score,Math.sqrt(1-score*score),...Array(1534).fill(0)];
    db.sqlite.prepare('INSERT INTO recognition_hard_negatives(id,target_artifact_id,signature,group_key,digest,vector) VALUES(?,?,?,?,?,?)')
      .run(`ui-hn-${i}`,'a1',signature(env),'ui-test',String(i+1).repeat(64),JSON.stringify(vector));
  }
  // Playwright WebKit can omit multipart file bytes from postDataBuffer().
  // Capture the actual browser upload bytes and reconstruct only its multipart envelope.
  await page.addInitScript(()=>{
    const native=window.fetch.bind(window);
    window.fetch=async(input,options)=>{
      if(String(input).endsWith('/api/admin/query')&&options?.body instanceof FormData){
        window.testQueryJPEG=Array.from(new Uint8Array(await options.body.get('file').arrayBuffer()));
      }
      return native(input,options);
    };
  });
  let top=.891+1e-7,calls=0;
  env.VECTORIZE={query:async()=>({matches:[{id:'v1',score:top,metadata:{artifact_id:'a1'}},{id:'v2',score:.6,metadata:{artifact_id:'a2'}}]})};
  await page.route('**/api/admin/query',async route=>{
    const native=globalThis.fetch;
    try{
      globalThis.fetch=async url=>{
        if(new URL(url).origin!=='https://openrouter.ai')throw Error('Unexpected test network request');
        if(String(url).endsWith('/models'))return Response.json({data:[{id:env.OPENROUTER_MODEL,architecture:{input_modalities:['image','text']}}]});
        calls++;
        if(String(url).endsWith('/chat/completions'))return Response.json({model:env.DESCRIPTION_MODEL,choices:[{finish_reason:'stop',message:{content:'A single wooden statue is visible.'}}]});
        if(String(url).endsWith('/embeddings'))return Response.json({model:env.OPENROUTER_MODEL,data:[{embedding:[1,...Array(1535).fill(0)]}]});
        throw Error('Unexpected provider endpoint');
      };
            const bytes=await page.evaluate(()=>window.testQueryJPEG);
      expect(bytes.length).toBeGreaterThan(100);
      const form=new FormData();form.set('file',new Blob([Uint8Array.from(bytes)],{type:'image/jpeg'}),'recognition.jpg');
      const response=await worker.fetch(new Request('http://localhost/api/admin/query',{method:'POST',body:form}),env);
      const result=await response.json();
      expect(response.status).toBe(200);
      expect(result.best_score).toBe(.891);
      expect(result.hard_negative_gap).toBe(-.009);
      expect(result.recognized).toBe(top>.891);
      expect(result.hard_negative_triggered).toBe(top<.891);
      if(top<.891){expect(result.reason).toBe('hard_negative_conflict');expect(result.artifact_id).toBeNull();}
      await route.fulfill({json:result});
    }finally{globalThis.fetch=native;}
  });
  try{
    await page.goto('/');
    let check=await queryPhoto(page);
    await check.getByRole('button',{name:'Nhận diện ảnh',exact:true}).click();
    await expect(check.getByText('Khớp: Phật Bà Quan Âm',{exact:true})).toBeVisible();
    top=.891-1e-7;
    check=await queryPhoto(page);
    await expect(check.getByText(/^Khớp:/)).toHaveCount(0);
    await check.getByRole('button',{name:'Nhận diện ảnh',exact:true}).click();
    await expect(check.getByText('Chưa đủ rõ để xác nhận',{exact:true})).toBeVisible();
    await expect(check.getByText(/Ảnh giống một hiện vật ngoài danh mục từng gây nhầm lẫn/)).toBeVisible();
    await expect(check.getByText(/^Khớp:/)).toHaveCount(0);
    await expect(check.getByRole('cell',{name:'Phật Bà Quan Âm',exact:true})).toBeVisible();
    await expect(check.getByRole('cell',{name:'0.8910',exact:true})).toBeVisible();
    expect(calls).toBe(4);
  }finally{try{if(!page.isClosed())await page.unroute('**/api/admin/query');}finally{db.sqlite.close();}}
});

test('semantic multi-scene guard asks for one artifact and skips embedding without an indexing warning', async ({ page, request }) => {
  await request.post('/__test/scenario', { data: { description: 'Multiple artworks are visible in a museum setting. On the left, a portrait hangs beside a landscape. On the right, another painting is above a statue.' } });
  await page.goto('/'); const check = await queryPhoto(page);
  await check.getByRole('button', { name: 'Nhận diện ảnh', exact: true }).click();
  await expect(check.getByText('Chưa đủ rõ để xác nhận', { exact: true })).toBeVisible();
  await expect(check.getByText(/Ảnh có nhiều hiện vật và chưa rõ chủ thể/)).toBeVisible();
  await expect(check.getByRole('table')).toHaveCount(0);
  await expect(check.getByText(/Vectorize có thể cần thời gian cập nhật/)).toHaveCount(0);
  await expect(check.getByText(/^Khớp:/)).toHaveCount(0);
  expect((await stats(request)).embeddings).toBe(0);
});

test('semantic no-clear-artifact guard gives retake instructions, not a fake match', async ({ page, request }) => {
  await request.post('/__test/scenario', { data: { description: 'No clear artifact is visible. A blank wall fills the frame.' } });
  await page.goto('/'); const check = await queryPhoto(page);
  await check.getByRole('button', { name: 'Nhận diện ảnh', exact: true }).click();
  await expect(check.getByText(/Chưa thấy rõ hiện vật trong ảnh/)).toBeVisible();
  await expect(check.getByRole('table')).toHaveCount(0);
  expect((await stats(request)).embeddings).toBe(0);
});

test('whole-image preview, cancel and invalid images do not call the provider', async ({ page, request }) => {
  await page.goto('/'); const check = await queryPhoto(page);
  expect((await stats(request)).embeddings).toBe(0);
  await check.getByRole('button', { name: 'Hủy ảnh nhận diện', exact: true }).click();
  await expect(check.locator('.recognition-image-preview')).toHaveCount(0);
  await check.getByLabel('Chọn ảnh nhận diện', { exact: true }).setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid') });
  await expect(check.getByRole('alert')).toContainText('Không đọc được ảnh');
  await expect(check.getByRole('button', { name: 'Nhận diện ảnh', exact: true })).toBeDisabled();
  const tiny = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 128;
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await check.getByLabel('Chọn ảnh nhận diện', { exact: true }).setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: Buffer.from(tiny, 'base64') });
  await expect(check.getByRole('alert')).toContainText('Ảnh quá nhỏ');
  await expect(check.getByRole('button', { name: 'Nhận diện ảnh', exact: true })).toBeDisabled();
  await check.getByRole('button', { name: 'Hủy ảnh nhận diện', exact: true }).click();
  await queryPhoto(page); await check.getByRole('button', { name: 'Hủy ảnh nhận diện', exact: true }).click();
  expect((await stats(request)).embeddings).toBe(0);
});

test('replacing and cancelling a recognition preview releases its object URLs without sending images', async ({ page, request }) => {
  await page.addInitScript(() => {
    window.previewUrls = new Set();
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = file => { const url = create(file); window.previewUrls.add(url); return url; };
    URL.revokeObjectURL = url => { window.previewUrls.delete(url); revoke(url); };
  });
  await page.goto('/'); const check = await queryPhoto(page);
  const first = await check.getByRole('img', { name: 'Ảnh nhận diện toàn khung', exact: true }).getAttribute('src');
  await queryPhoto(page);
  await expect.poll(() => page.evaluate(() => window.previewUrls.size)).toBe(1);
  expect(await page.evaluate(url => window.previewUrls.has(url), first)).toBe(false);
  await check.getByRole('button', { name: 'Hủy ảnh nhận diện', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.previewUrls.size)).toBe(0);
  expect((await stats(request)).embeddings).toBe(0);
});

test('provider failure remains visible, locks concurrent editing and never auto-retries', async ({ page, request }) => {
  await page.goto('/'); const check = await queryPhoto(page);
  await request.post('/__test/scenario', { data: { error: true, delay: 800 } });
  await check.getByRole('button', { name: 'Nhận diện ảnh', exact: true }).click();
  await expect(check.getByRole('button', { name: 'Đang chuẩn hóa & đối chiếu…' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Tạo', exact: true })).toBeDisabled();
  await expect(page.locator('.artifact-admin-btn').first()).toBeDisabled();
  await expect(check.getByRole('alert')).toContainText('Không tự gửi lại ảnh');
  await expect(check.getByRole('button', { name: 'Nhận diện ảnh', exact: true })).toBeEnabled();
  await page.waitForTimeout(600); expect((await stats(request)).embeddings).toBe(1);
  await request.post('/__test/scenario', { data: { error: false, delay: 0 } });
  await check.getByRole('button', { name: 'Nhận diện ảnh', exact: true }).click();
  await expect(check.getByText('Khớp: Chiếc bình gốm', { exact: true })).toBeVisible();
  expect((await stats(request)).embeddings).toBe(2);
});

test('two different ready artifacts are required, even with a valid query photo', async ({ page, request }) => {
  for (let i = 2; i <= 5; i++) expect((await request.delete(`/api/admin/artifacts/a${i}`)).ok()).toBe(true);
  await page.goto('/'); const check = recognition(page);
  await expect(check.getByRole('status')).toContainText('Cần ít nhất hai hiện vật');
  await check.getByLabel('Chọn ảnh nhận diện', { exact: true }).setInputFiles(await picture(page));
  await expect(check.getByRole('img', { name: 'Ảnh nhận diện toàn khung', exact: true })).toBeVisible();
  await expect(check.getByRole('button', { name: 'Nhận diện ảnh', exact: true })).toBeDisabled();
  expect((await stats(request)).embeddings).toBe(0);
});

test('failed reference import remains inspectable and retry uses the existing record', async ({ page, request }) => {
  await page.goto('/'); await page.locator('.artifact-admin-btn').filter({ hasText: 'Chiếc bình gốm' }).click();
  await request.post('/__test/scenario', { data: { error: true } });
  await page.getByLabel('Chọn ảnh tham chiếu', { exact: true }).setInputFiles(await picture(page, 'failed-reference.png'));
  const editor = page.getByRole('region', { name: 'Chuẩn bị ảnh tham chiếu' });
  await editor.getByRole('button', { name: 'Nhập toàn ảnh', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('OpenRouter HTTP 502');
  await editor.getByRole('button', { name: 'Hủy nhập ảnh', exact: true }).click();
  await expect(page.locator('.reference-error')).toContainText('OpenRouter HTTP 502');
  await request.post('/__test/scenario', { data: { error: false } });
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(page.locator('.artifact-admin-item.selected')).toContainText('2/2 ảnh sẵn sàng');
  await expect(page.locator('.reference-error')).toHaveCount(0); expect((await stats(request)).embeddings).toBe(2);
});

test('old pages redirect to the simple app and removed gameplay/lab APIs cannot run', async ({ page, request }) => {
  for (const path of ['/admin', '/admin/test', '/admin/test/met']) {
    await page.goto(path); await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Nhập ảnh tham chiếu & nhận diện' })).toBeVisible();
  }
  for (const path of ['/api/game', '/api/game/session', '/api/met-lab/catalog', '/api/met-lab/upload', '/api/admin/artifacts/a1/mission']) {
    const response = await request.post(path); expect(response.status()).toBe(410);
  }
  expect((await stats(request)).embeddings).toBe(0);
});

test('camera denial falls back to choosing a recognition photo', async ({ page }) => {
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Denied', 'NotAllowedError')); });
  await page.goto('/'); await page.getByRole('button', { name: 'Chụp ảnh nhận diện', exact: true }).click();
  const check = recognition(page);
  await expect(check.getByRole('alert')).toContainText('Bạn có thể chọn ảnh từ thiết bị');
  await expect(check.locator('button').filter({ hasText: 'Chọn ảnh nhận diện' })).toBeEnabled();
  await queryPhoto(page);
});
