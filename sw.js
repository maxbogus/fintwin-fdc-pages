/**
 * Service Worker-«уборщик» для FDC v5 (GitHub Pages).
 *
 * Воркер НЕ кэширует ничего: обработчик `fetch` пустой (pass-through), Cache
 * Storage не участвует в выдаче ответов. Задач всего две:
 *
 *  1) снести кэши прошлых схем — в первую очередь legacy `fdc-v5-cache-v1`,
 *     который отдавал устаревший index.html и ломал «/» (404 на assets/*,
 *     NS_ERROR_CORRUPTED_CONTENT), пока «/dashboard» открывался;
 *  2) один раз перезагрузить окна, застрявшие на устаревшей оболочке: это
 *     единственный код, который у такого клиента гарантированно исполняется,
 *     потому что его HTML ссылается на уже удалённые чанки.
 *
 * Плейсхолдеры base path и build id подставляет scripts/deploy-pages.sh:
 * build id обязателен, иначе sw.js не меняется между деплоями и браузер
 * не видит обновления воркера.
 */
const CACHE_PREFIX = 'fdc-v5-';
const BASE_PATH = '/fintwin-fdc-pages/';
/**
 * Версия воркера = build id текущего деплоя.
 * Обязательна: именно из-за неё байты sw.js меняются между деплоями,
 * иначе браузер не видит обновления воркера и «уборщик» не установится.
 */
const SW_BUILD_ID = '20261101153815-f070300';
const SHELL_URLS = [BASE_PATH, `${BASE_PATH}index.html`];

/** Есть ли в кэше HTML-оболочка — признак браузера, застрявшего на старом shell. */
const hasCachedShell = async (cacheName) => {
	const cache = await caches.open(cacheName);
	for (const url of SHELL_URLS) {
		if (await cache.match(url)) return true;
	}
	return false;
};

/**
 * Удаляет кэши прошлых схем FDC.
 *
 * @returns {Promise<boolean>} `true`, если в них лежала HTML-оболочка.
 */
const purgeStaleCaches = async () => {
	const staleNames = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX));
	let hadShell = false;
	for (const name of staleNames) {
		if (!hadShell) hadShell = await hasCachedShell(name);
		await caches.delete(name);
	}
	return hadShell;
};

/** Перезагружает окна, застрявшие на устаревшей оболочке. */
const reloadStuckClients = async () => {
	const openedWindows = await self.clients.matchAll({ type: 'window' });
	await Promise.all(
		openedWindows.map((client) => {
			try {
				return Promise.resolve(client.navigate(client.url)).catch(() => null);
			} catch {
				return null;
			}
		})
	);
};

self.addEventListener('install', (event) => {
	event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			console.info('[sw] FDC v5 janitor', SW_BUILD_ID, 'activating');
			const stuck = await purgeStaleCaches();
			await self.clients.claim();
			// Перезагружаем только застрявших: у остальных кэша нет, и после
			// этой уборки он уже никогда не появится.
			if (stuck) await reloadStuckClients();
		})()
	);
});

// Pass-through: воркер не перехватывает ни один запрос — всё идёт в сеть.
// Обработчик нужен только для installability (Chrome требует fetch-handler).
self.addEventListener('fetch', () => {});
