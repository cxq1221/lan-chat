const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
exports.run = async function () {
  const dir = mkdtempSync(path.join(tmpdir(), 'lan-chat-desktop-'));
  const { startChatServer } = await import(pathToFileURL(path.join(__dirname, '..', 'server.mjs')).href);
  let service;
  try {
    service = await startChatServer({ port: 0, dataDir: dir });
    let base = `http://127.0.0.1:${service.port}`;
    assert.equal((await fetch(base)).status, 200);
    const me = await fetch(base + '/api/me'); const cookie = me.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(base + '/api/messages', { method:'POST', headers:{ Cookie:cookie, 'Content-Type':'application/json' }, body:JSON.stringify({text:'desktop smoke'}) })).status, 201);
    const data = Buffer.from([0, 1, 2, 255]);
    const upload = await fetch(base+'/api/files', { method:'POST', headers:{Cookie:cookie, 'Content-Type':'application/octet-stream', 'X-File-Name':'smoke.bin'}, body:data });
    assert.equal(upload.status,201); const message = await upload.json();
    await service.close(); service = await startChatServer({ port:0, dataDir:dir }); base = `http://127.0.0.1:${service.port}`;
    assert.equal((await (await fetch(base+'/api/messages')).json()).messages.length,2);
    assert.deepEqual(Buffer.from(await (await fetch(base+'/api/files/'+message.fileId)).arrayBuffer()),data);
    console.log('DESKTOP_SMOKE_OK');
  } finally { await service?.close(); rmSync(dir,{recursive:true,force:true}); }
};
