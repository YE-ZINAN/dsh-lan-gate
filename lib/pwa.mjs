/**
 * PWA 支持：manifest + 图标 + Apple 全屏 meta。
 *
 * 前提说明：局域网 http:// 下，浏览器不会走完整 PWA 安装流程（那需要 HTTPS），
 * 但「添加到主屏幕 / 有图标 / 全屏无地址栏」这三件事可以做到 —— 这正是目标。
 *
 * 图标来自 assets/ 下的真实图片，由 tools/make-icons.py 从母图生成（可重新生成）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ASSETS_DIR = path.join(HERE, '..', 'assets');

export const MANIFEST_PATH = '/__langate/manifest.webmanifest';

/** 允许对外提供的图标：URL 路径 → 磁盘文件名 + MIME。 */
export const ICON_ROUTES = {
  '/__langate/icon-512.png': { file: 'icon-512.png', type: 'image/png' },
  '/__langate/icon-192.png': { file: 'icon-192.png', type: 'image/png' },
  '/__langate/icon-180.png': { file: 'icon-180.png', type: 'image/png' },
  '/__langate/icon-maskable-512.png': { file: 'icon-maskable-512.png', type: 'image/png' },
};

const iconCache = new Map();

/** 读取图标（带缓存），读不到返回 null。 */
export function readIcon(urlPath) {
  const route = ICON_ROUTES[urlPath];
  if (!route) return null;
  if (iconCache.has(route.file)) return iconCache.get(route.file);
  try {
    const buf = fs.readFileSync(path.join(ASSETS_DIR, route.file));
    const entry = { buf, type: route.type };
    iconCache.set(route.file, entry);
    return entry;
  } catch {
    return null;
  }
}

/**
 * 图标 URL 的版本号。
 *
 * 为什么要这个：iOS 对「添加到主屏幕」的图标缓存极狠，而且会记住「本网站没有可用图标」。
 * 早期这里指向的是 SVG（iOS 不支持 SVG 作桌面图标），那次失败被 iOS 缓存住了，
 * 之后即使换成 PNG，只要 URL 没变，iOS 仍可能沿用旧的失败结果。
 * 换图标时把这个版本号 +1 即可强制 iOS 重新抓取。
 */
export const ICON_VERSION = '3';

/** 生成带版本号的图标 URL。 */
const iconUrl = (name) => `/__langate/${name}?v=${ICON_VERSION}`;

/** 生成 manifest。 */
export function buildManifest() {
  return {
    name: 'DSH 口袋版 · DeepSeek Harness',
    short_name: 'DSH',
    description: '在手机/平板上访问电脑上的 DeepSeek Harness（局域网，经 lan-gate 网关）',
    start_url: '/?utm_source=homescreen',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'any',
    background_color: '#f9faf9',
    theme_color: '#1b2a41',
    lang: 'zh-CN',
    dir: 'ltr',
    icons: [
      { src: iconUrl('icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: iconUrl('icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: iconUrl('icon-maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

/**
 * 往 HTML 的 <head> 注入 PWA 相关标签。
 *
 * 注意：宿主自己已经有一个 `<link rel="manifest" href="./manifest.webmanifest">`，
 * 而且是**排在最前面的** —— 浏览器只认第一个 manifest，所以再注入一个链接会被忽略
 * （实测过：CDP 读到的仍是宿主的 "DeepSeek Harness"）。
 * 因此这里**不注入 manifest 链接**，改为在网关层直接接管宿主的那个路径。
 */
export function injectPwa(html) {
  const tags = [
    `<link rel="icon" type="image/png" sizes="192x192" href="${iconUrl('icon-192.png')}">`,
    // 多声明几个尺寸：iOS 会挑最合适的一个，声明越多命中率越高
    `<link rel="apple-touch-icon" sizes="180x180" href="${iconUrl('icon-180.png')}">`,
    `<link rel="apple-touch-icon" sizes="192x192" href="${iconUrl('icon-192.png')}">`,
    `<link rel="apple-touch-icon" sizes="512x512" href="${iconUrl('icon-512.png')}">`,
    `<meta name="theme-color" content="#1b2a41">`,
    // iOS：加主屏幕后全屏运行（这两条缺一不可）
    `<meta name="apple-mobile-web-app-capable" content="yes">`,
    `<meta name="mobile-web-app-capable" content="yes">`,
    `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`,
    `<meta name="apple-mobile-web-app-title" content="DSH">`,
    `<meta name="application-name" content="DSH">`,
  ].join('');

  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, tags + '</head>');
  return html + tags;
}
