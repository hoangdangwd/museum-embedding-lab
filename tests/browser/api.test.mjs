import { test, expect } from '@playwright/test';

test('lost diagnostic response is not claimed to be cached and never auto-retries', async ({ page, request }) => {
  await request.post('/__test/reset');
  await page.goto('/');
  const check = page.getByRole('region', { name: 'Nhận diện ảnh', exact: true });
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext('2d'); context.fillStyle = '#225533'; context.fillRect(0, 0, 320, 240);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await check.getByLabel('Chọn ảnh nhận diện', { exact: true }).setInputFiles({ name: 'query.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
  await expect(check.getByRole('button', { name: 'Nhận diện ảnh', exact: true })).toBeEnabled();
  // Intercept the response in-browser: WebKit route.fetch can lose multipart
  // file bytes, which would simulate a rejected upload rather than a lost response.
  await page.evaluate(() => {
    const nativeFetch = window.fetch.bind(window);
    let drop = true;
    window.fetch = async (...args) => {
      const response = await nativeFetch(...args);
      if (String(args[0]) === '/api/admin/query' && drop) {
        drop = false;
        await response.arrayBuffer();
        throw new TypeError('Simulated response loss after server processing');
      }
      return response;
    };
  });
  await check.getByRole('button', { name: 'Nhận diện ảnh', exact: true }).click();
  await expect(check.getByRole('alert')).toContainText('Yêu cầu có thể đã được xử lý');
  await expect(check.getByRole('alert')).not.toContainText('không bị tính thành lượt mới');
  await expect(check.getByRole('button', { name: 'Nhận diện ảnh', exact: true })).toBeEnabled();
  await page.waitForTimeout(500);
  expect((await (await request.get('/__test/stats')).json()).embeddings).toBe(1);
  await check.getByRole('button', { name: 'Nhận diện ảnh', exact: true }).click();
  await expect(check.getByText('Khớp: Chiếc bình gốm', { exact: true })).toBeVisible();
  expect((await (await request.get('/__test/stats')).json()).embeddings).toBe(2);
});
