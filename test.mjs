import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

test('identities, live delivery, presence, pagination, retention and restart persistence', {timeout:20000}, async () => {
  const dir = mkdtempSync(join(tmpdir(),'lan-chat-test-'));
  let child, base; const connections=[];
  async function start() {
    child=spawn(process.execPath,['server.mjs'],{cwd:import.meta.dirname,env:{...process.env,PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
    base=await new Promise((resolve,reject)=>{child.stdout.on('data',chunk=>{const match=chunk.toString().match(/http:\/\/localhost:\d+/);if(match)resolve(match[0]);});child.once('error',reject);child.once('exit',code=>reject(new Error('Server exited '+code)));});
  }
  async function stop(){if(child?.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}}
  async function identity(cookie){const res=await fetch(base+'/api/me',{headers:cookie?{Cookie:cookie}:{}});return {user:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]||cookie};}
  async function stream(cookie){
    const controller=new AbortController();connections.push(controller);
    const response=await fetch(base+'/api/events',{headers:{Cookie:cookie},signal:controller.signal});
    const events=[];const reader=response.body.getReader();let buffer='';
    (async()=>{try{while(true){const {value,done}=await reader.read();if(done)break;buffer+=new TextDecoder().decode(value);let end;while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const type=/event: (.*)/.exec(frame)?.[1],raw=/data: (.*)/.exec(frame)?.[1];if(type&&raw)events.push({type,data:JSON.parse(raw)});}}}catch{}})();
    return {events,controller};
  }
  async function until(fn){for(let n=0;n<100;n++){if(fn())return;await new Promise(r=>setTimeout(r,20));}assert.fail('Timed out waiting for live event');}
  async function post(cookie,text,extra={}) {return fetch(base+'/api/messages',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json',...extra},body:JSON.stringify({text})});}
  try {
    await start();const a=await identity(), b=await identity();
    assert.notEqual(a.user.id,b.user.id);assert.deepEqual((await identity(a.cookie)).user,a.user);
    const sa=await stream(a.cookie), sb=await stream(b.cookie), sa2=await stream(a.cookie);
    await until(()=>sa.events.some(e=>e.type==='presence'&&e.data.count===2));
    assert.equal(sa.events.filter(e=>e.type==='presence').at(-1).data.count,2);
    const msg=await (await post(a.cookie,'你好\n<script>alert(1)</script>')).json();
    await until(()=>sb.events.some(e=>e.type==='message'&&e.data.id===msg.id));
    assert.equal(msg.userId,a.user.id);assert.equal(msg.text,'你好\n<script>alert(1)</script>');
    const payload=Buffer.from([0,1,2,255,10,20]);
    const fileResponse=await fetch(base+'/api/files',{method:'POST',headers:{Cookie:a.cookie,Origin:base,'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent('任意文件.sh')},body:payload});
    assert.equal(fileResponse.status,201);
    const fileMessage=await fileResponse.json();
    assert.equal(fileMessage.fileName,'任意文件.sh');assert.equal(fileMessage.fileSize,payload.length);
    await until(()=>sb.events.some(e=>e.type==='message'&&e.data.fileId===fileMessage.fileId));
    const download=await fetch(base+'/api/files/'+fileMessage.fileId);
    assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'application/octet-stream');
    assert.match(download.headers.get('content-disposition'),/attachment/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()),payload);
    assert.equal((await fetch(base+'/api/files/00000000-0000-4000-8000-000000000000')).status,404);
    const tooLargeStatus=await new Promise((resolve,reject)=>{
      const socket=connect(Number(new URL(base).port),'127.0.0.1');let response='';
      socket.once('error',reject);socket.on('data',chunk=>{response+=chunk;const code=/^HTTP\/1\.1 (\d+)/.exec(response)?.[1];if(code){resolve(Number(code));socket.destroy();}});
      socket.once('connect',()=>socket.write('POST /api/files HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/octet-stream\r\nX-File-Name: oversized.bin\r\nContent-Length: 500000001\r\nConnection: close\r\n\r\n'));
    });
    assert.equal(tooLargeStatus,413);
    assert.equal((await post(a.cookie,'  ')).status,400);
    assert.equal((await post(a.cookie,'x'.repeat(4001))).status,400);
    assert.equal((await post(a.cookie,'blocked',{Origin:'http://unrelated.invalid'})).status,403);
    for(let n=0;n<105;n++)assert.equal((await post(a.cookie,'分页消息 '+n)).status,201);
    const page=await (await fetch(base+'/api/messages')).json();assert.equal(page.messages.length,100);assert.equal(page.hasMore,true);
    const older=await (await fetch(base+'/api/messages?before='+page.messages[0].id)).json();assert.equal(older.messages.length,7);assert.equal(older.hasMore,false);assert.equal(new Set([...page.messages,...older.messages].map(m=>m.id)).size,107);
    sb.controller.abort();await until(()=>sa.events.filter(e=>e.type==='presence').at(-1)?.data.count===1);
    for(const c of connections)c.abort();await stop();
    const db=new DatabaseSync(join(dir,'chat.sqlite'));
    db.prepare('INSERT INTO messages (userId,text,createdAt) VALUES (?,?,?)').run(a.user.id,'expired',Date.now()-8*86400000);
    db.prepare('UPDATE messages SET createdAt=? WHERE id=?').run(Date.now()-8*86400000,fileMessage.id);
    db.close();
    await start();assert.deepEqual((await identity(a.cookie)).user,a.user);
    const retained=await(await fetch(base+'/api/messages')).json();assert.equal(retained.messages.length,100);assert.equal(retained.messages.at(-1).text,'分页消息 104');
    const check=new DatabaseSync(join(dir,'chat.sqlite'));assert.equal(check.prepare('SELECT count(*) AS n FROM messages WHERE text=?').get('expired').n,0);check.close();
    assert.equal(existsSync(join(dir,'files',fileMessage.fileId)),false);
    assert.equal((await fetch(base+'/api/files/'+fileMessage.fileId)).status,404);
  } finally {for(const c of connections)c.abort();await stop();rmSync(dir,{recursive:true,force:true});}
});
