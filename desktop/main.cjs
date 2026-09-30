const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, clipboard, shell } = require('electron');
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
    Menu.setApplicationMenu(null);
    win = new BrowserWindow({ width: 660, height: 620, minWidth: 560, minHeight: 520,
      title: '同频 · 局域网服务', backgroundColor: '#f3f6ef',
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('close', event => { if (!quitting) { event.preventDefault(); win.hide(); } });
    await win.loadFile(path.join(__dirname, 'index.html'));
    const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 22, height: 22 });
    tray = new Tray(icon); tray.setToolTip('同频 · 局域网群聊');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示服务窗口', click: showWindow },
      { label: '打开聊天室', click: () => service && shell.openExternal(`http://localhost:${service.port}`) },
      { type: 'separator' }, { label: '退出并停止服务', click: () => app.quit() }
    ]));
    tray.on('click', showWindow);
    await start();
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
function allow(event) { if (!win || event.sender !== win.webContents) throw new Error('未知窗口'); }
ipcMain.handle('state', event => { allow(event); return state(); });
ipcMain.handle('copy', (event, address) => { allow(event); if (!state().addresses.includes(address)) throw new Error('无效地址'); clipboard.writeText(address); });
ipcMain.handle('open-chat', event => { allow(event); if (service) return shell.openExternal(`http://localhost:${service.port}`); });
ipcMain.handle('open-data', event => { allow(event); return shell.openPath(state().dataDir); });
ipcMain.handle('quit', event => { allow(event); app.quit(); });
app.on('activate', showWindow);
app.on('window-all-closed', () => {});
app.on('before-quit', event => {
  if (quitting || smoke) return;
  event.preventDefault(); quitting = true;
  Promise.resolve(service?.close()).finally(() => { tray?.destroy(); app.quit(); });
});
