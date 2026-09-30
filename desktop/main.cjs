const { app, BrowserWindow, Tray, Menu, nativeImage, clipboard, shell, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { networkInterfaces } = require('node:os');

const smoke = process.argv.includes('--smoke-test');
let win, tray, service, quitting = false, failure = '';
app.setName('同频');
if (!smoke && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(async () => {
    if (smoke) {
      try { await require('./smoke.cjs').run(); app.exit(0); }
      catch (error) { console.error(error); app.exit(1); }
      return;
    }
    await start();
    if (!service) {
      dialog.showErrorBox('同频启动失败', failure || '无法启动聊天服务');
      app.quit();
      return;
    }
    Menu.setApplicationMenu(null);
    win = new BrowserWindow({ width: 1120, height: 780, minWidth: 680, minHeight: 560,
      title: '同频 · 公共聊天室', backgroundColor: '#f3f6ef',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    win.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== `http://localhost:${service.port}`) event.preventDefault();
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('close', event => { if (!quitting) { event.preventDefault(); win.hide(); } });
    await win.loadURL(chatURL());
    const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 22, height: 22 });
    tray = new Tray(icon); tray.setToolTip('同频 · 局域网群聊');
    const addressItems = state().addresses.map(address => ({ label: address, click: () => clipboard.writeText(address) }));
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示聊天室', click: showWindow },
      { label: '复制局域网地址', submenu: addressItems.length ? addressItems : [{ label: '尚未检测到局域网地址', enabled: false }] },
      { label: '在浏览器中打开', click: () => service && shell.openExternal(chatURL()) },
      { type: 'separator' }, { label: '退出并停止服务', click: () => app.quit() }
    ]));
    tray.on('click', showWindow);
  }).catch(error => { console.error(error); app.exit(1); });
}

function showWindow() { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } }
async function start() {
  try {
    const { startChatServer } = await import(pathToFileURL(path.join(__dirname, '..', 'server.mjs')).href);
    service = await startChatServer({ port: 81, fallback: true, dataDir: path.join(app.getPath('userData'), 'server-data') });
    failure = '';
  } catch (error) { failure = '服务启动失败：' + error.message; }
}
function state() {
  const addresses = [];
  if (service) for (const nets of Object.values(networkInterfaces())) for (const net of nets || []) {
    if (net.family === 'IPv4' && !net.internal) addresses.push(`http://${net.address}:${service.port}`);
  }
  return { running: !!service, error: failure, addresses: [...new Set(addresses)], port: service?.port, dataDir: path.join(app.getPath('userData'), 'server-data') };
}
function chatURL() {
  const url = new URL(`http://localhost:${service.port}/`);
  for (const address of state().addresses) url.searchParams.append('lan', address);
  return url.href;
}
app.on('activate', showWindow);
app.on('window-all-closed', () => {});
app.on('before-quit', event => {
  if (quitting || smoke) return;
  event.preventDefault(); quitting = true;
  Promise.resolve(service?.close()).finally(() => { tray?.destroy(); app.quit(); });
});
