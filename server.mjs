import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createReadStream, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { open, rename, rm } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const devVersion = process.env.NODE_ENV === 'development' ? randomUUID() : null;
const dir = process.env.DATA_DIR || join(root, 'data');
mkdirSync(dir, { recursive: true });
const fileDir = join(dir, 'files');
mkdirSync(fileDir, { recursive: true });
const maxFileBytes = 500_000_000;
const db = new DatabaseSync(join(dir, 'chat.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT NOT NULL, text TEXT NOT NULL, createdAt INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS messages_time ON messages(createdAt);`);
const columns = new Set(db.prepare('PRAGMA table_info(messages)').all().map(row => row.name));
if (!columns.has('fileId')) db.exec('ALTER TABLE messages ADD COLUMN fileId TEXT');
if (!columns.has('fileName')) db.exec('ALTER TABLE messages ADD COLUMN fileName TEXT');
if (!columns.has('fileSize')) db.exec('ALTER TABLE messages ADD COLUMN fileSize INTEGER');
const retention = 7 * 86400_000;
const clean = () => {
  const expired = db.prepare('SELECT fileId FROM messages WHERE createdAt < ? AND fileId IS NOT NULL').all(Date.now() - retention);
  db.prepare('DELETE FROM messages WHERE createdAt < ?').run(Date.now() - retention);
  for (const {fileId} of expired) {
    try { unlinkSync(join(fileDir, fileId)); } catch (error) { if (error.code !== 'ENOENT') console.error('文件清理失败', error); }
  }
};
clean();
for (const name of readdirSync(fileDir)) {
  if (name.endsWith('.uploading') || (/^[a-f0-9-]{36}$/.test(name) && !db.prepare('SELECT 1 FROM messages WHERE fileId=?').get(name))) {
    try { unlinkSync(join(fileDir, name)); } catch (error) { console.error('残留文件清理失败', error); }
  }
}
const cleanup = setInterval(clean, 60_000);
const streams = new Map();
const shades = ['blue', 'green', 'amber', 'rose', 'violet', 'teal'];
const colors = ['蓝色', '青色', '金色', '粉色', '紫色', '碧色'];
const animals = ['水獭', '狐狸', '海豚', '小鹿', '企鹅', '松鼠', '白鲸', '熊猫', '山雀', '海豹'];
const query = `SELECT m.id,m.userId,m.text,m.createdAt,m.fileId,m.fileName,m.fileSize,u.name,u.color FROM messages m JOIN users u ON u.id=m.userId`;
const emit = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
function broadcast(type, data) { for (const res of streams.keys()) emit(res, type, data); }
function presence() { broadcast('presence', { count: new Set(streams.values()).size }); }
function identity(req, res) {
  const id = /(?:^|;\s*)lan_identity=([a-f0-9-]{36})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  let user = id && db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!user) {
    const index = Math.floor(Math.random() * shades.length);
    user = { id: randomUUID(), name: colors[index] + animals[Math.floor(Math.random() * animals.length)] + ' ' + Math.floor(1000 + Math.random() * 9000), color: shades[index] };
    db.prepare('INSERT INTO users VALUES (?,?,?)').run(user.id, user.name, user.color);
    res.setHeader('Set-Cookie', `lan_identity=${user.id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);
  }
  return user;
}
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
function sameOrigin(req) {
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
}
function fileName(raw) {
  try {
    const value = decodeURIComponent(raw || '').replace(/[\\/\x00-\x1f\x7f]/g, '_').trim();
    if (value && Buffer.byteLength(value) <= 255) return value;
  } catch {}
  return null;
}
function fileMessage(id) { return db.prepare(query + ' WHERE m.id=?').get(id); }
async function body(req) {
  let chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 24_000) throw new Error('消息太长'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString());
}
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']]
]);
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && assets.has(url.pathname)) {
      const [name, type] = assets.get(url.pathname);
      res.writeHead(200, { 'Content-Type': type }); return res.end(readFileSync(join(root, 'public', name)));
    }
    if (url.pathname === '/api/me' && req.method === 'GET') return json(res, 200, identity(req, res));
    const download = /^\/api\/files\/([a-f0-9-]{36})$/.exec(url.pathname);
    if (download && req.method === 'GET') {
      const row = db.prepare('SELECT fileName,fileSize FROM messages WHERE fileId=? AND createdAt>=?').get(download[1], Date.now() - retention);
      if (!row) return json(res, 404, { error: '文件不存在或已过期' });
      const safeAscii = row.fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': row.fileSize,
        'Content-Disposition': `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
        'X-Content-Type-Options': 'nosniff' });
      const stream = createReadStream(join(fileDir, download[1]));
      stream.on('error', error => { console.error('下载失败', error); res.destroy(error); });
      stream.pipe(res); return;
    }
    if (url.pathname === '/api/messages' && req.method === 'GET') {
      const before = url.searchParams.get('before');
      if (before && (!/^\d+$/.test(before) || !Number.isSafeInteger(Number(before)))) return json(res, 400, { error: '无效分页' });
      const rows = db.prepare(query + ' WHERE m.createdAt>=? AND m.id<? ORDER BY m.id DESC LIMIT 101').all(Date.now() - retention, before ? Number(before) : Number.MAX_SAFE_INTEGER);
      return json(res, 200, { hasMore: rows.length > 100, messages: rows.slice(0, 100).reverse() });
    }
    if (url.pathname === '/api/events' && req.method === 'GET') {
      const user = identity(req, res);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      streams.set(res, user.id); emit(res, 'ready', { devVersion }); presence();
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
      req.on('close', () => { clearInterval(heartbeat); streams.delete(res); presence(); }); return;
    }
    if (url.pathname === '/api/messages' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { error: '请求来源不匹配' });
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: '需要 JSON 消息' });
      const user = identity(req, res);
      const data = await body(req);
      const text = typeof data.text === 'string' ? data.text.trim() : '';
      if (!text || text.length > 4000) return json(res, 400, { error: '请输入 1–4000 字符的消息' });
      const createdAt = Date.now();
      const result = db.prepare('INSERT INTO messages (userId,text,createdAt) VALUES (?,?,?)').run(user.id, text, createdAt);
      const message = fileMessage(Number(result.lastInsertRowid));
      broadcast('message', message); return json(res, 201, message);
    }
    if (url.pathname === '/api/files' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { error: '请求来源不匹配' });
      if (req.headers['content-type'] !== 'application/octet-stream') return json(res, 415, { error: '需要文件数据' });
      const name = fileName(req.headers['x-file-name']);
      if (!name) return json(res, 400, { error: '文件名无效或过长' });
      const declared = Number(req.headers['content-length']);
      if (!Number.isSafeInteger(declared) || declared < 0) return json(res, 411, { error: '无法确定文件大小' });
      if (declared > maxFileBytes) return json(res, 413, { error: '文件不能超过 500 MB' });
      const user = identity(req, res);
      const id = randomUUID(), temp = join(fileDir, id + '.uploading'), dest = join(fileDir, id);
      let handle;
      try {
        handle = await open(temp, 'wx');
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > maxFileBytes || size > declared) throw new Error('文件大小超出限制');
          await handle.writeFile(chunk);
        }
        if (size !== declared) throw new Error('文件上传未完成');
        await handle.close(); handle = null;
        await rename(temp, dest);
        const createdAt = Date.now();
        const result = db.prepare('INSERT INTO messages (userId,text,createdAt,fileId,fileName,fileSize) VALUES (?,?,?,?,?,?)').run(user.id, '', createdAt, id, name, size);
        const message = fileMessage(Number(result.lastInsertRowid));
        broadcast('message', message); return json(res, 201, message);
      } catch (error) {
        if (handle) await handle.close();
        await rm(temp, { force: true });
        await rm(dest, { force: true });
        console.error('上传失败', error);
        if (!res.headersSent) return json(res, error.message.includes('大小') ? 413 : 400, { error: error.message.includes('大小') ? '文件不能超过 500 MB' : '上传失败，请重试' });
        return;
      }
    }
    json(res, 404, { error: '没有找到这个页面' });
  } catch (error) { if (!res.headersSent) json(res, 400, { error: '请求未完成，请稍后重试' }); else res.end(); console.error(error.message); }
});
server.listen(Number(process.env.PORT || 81), '0.0.0.0', () => {
  const port = server.address().port;
  console.log(`群聊已启动：http://localhost:${port}`);
  for (const list of Object.values(networkInterfaces())) for (const net of list || []) if (net.family === 'IPv4' && !net.internal) console.log(`局域网地址：http://${net.address}:${port}`);
});
function shutdown() { clearInterval(cleanup); for (const res of streams.keys()) res.end(); server.close(() => { db.close(); process.exit(0); }); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
