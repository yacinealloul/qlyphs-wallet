/** Rasterize the vector mark at each native extension size, preserving transparency. */
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = await readFile(new URL('./public/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${source}`,
    );
    await page.screenshot({
      path: fileURLToPath(new URL(`./public/icon-${size}.png`, import.meta.url)),
      omitBackground: true,
    });
  }
} finally {
  await browser.close();
}
