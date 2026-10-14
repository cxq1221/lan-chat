const $ = id => document.getElementById(id);
let me, source, sending = false, hasMore = false, loading = false, historyLoaded = false;
let devVersion;
let upload;
const messages = new Map();
const timeline = $('timeline');
const input = $('input');
const desktopAddresses = new URLSearchParams(location.search).getAll('lan');
if (desktopAddresses.length) {
  $('desktop-access').hidden = false;
  $('desktop-address-list').replaceChildren(...desktopAddresses.map(address => {
    const row = document.createElement('div'); row.className = 'desktop-address-row';
    const value = document.createElement('code'); value.textContent = address;
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '复制';
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(address); copy.textContent = '已复制'; }
      catch { copy.textContent = '复制失败'; }
      setTimeout(() => { copy.textContent = '复制'; }, 1500);
    };
    row.append(value, copy); return row;
  }));
}
try { input.value = sessionStorage.getItem('lan-chat-dev-draft') || ''; sessionStorage.removeItem('lan-chat-dev-draft'); } catch {}
const colors = new Set(['blue','green','amber','rose','violet','teal']);
async function api(path, options) {
  const res = await fetch(path, options); const value = await res.json();
  if (!res.ok) throw new Error(value.error || '连接失败，请重试'); return value;
}
function avatar(user) { const el = document.createElement('span'); el.className = 'avatar ' + (colors.has(user.color) ? user.color : 'blue'); el.textContent = user.name.slice(2,3); return el; }
function error(text = '') { $('error').textContent = text; $('error').hidden = !text; }
function bottom() { timeline.scrollTop = timeline.scrollHeight; $('new-messages').hidden = true; }
function fileSize(bytes) { return bytes < 1000 ? bytes + ' B' : bytes < 1_000_000 ? (bytes / 1000).toFixed(1) + ' KB' : (bytes / 1_000_000).toFixed(1) + ' MB'; }
function render() {
  for (const [id,m] of messages) if (m.createdAt < Date.now()-7*86400000) messages.delete(id);
  const fragment = document.createDocumentFragment();
  for (const m of [...messages.values()].sort((a,b) => a.id-b.id)) {
    const item = document.createElement('article'); const mine = m.userId === me.id;
    item.className = 'message' + (mine ? ' mine' : ''); item.dataset.id = m.id;
    const body = document.createElement('div'); body.className = 'message-body';
    const meta = document.createElement('div'); meta.className = 'message-meta';
    const name = document.createElement('span'); name.textContent = m.name + (mine ? ' · 你' : '');
    const time = document.createElement('time'); const date = new Date(m.createdAt); time.dateTime = date.toISOString(); time.textContent = date.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}); time.title = date.toLocaleString();
    let bubble;
    if (m.fileId) {
      bubble = document.createElement('a'); bubble.className = 'file-card';
      bubble.href = '/api/files/' + encodeURIComponent(m.fileId); bubble.setAttribute('download', m.fileName);
      const icon = document.createElement('span'); icon.className = 'file-icon'; icon.textContent = '↧';
      const details = document.createElement('span'); details.className = 'file-details';
      const fileName = document.createElement('strong'); fileName.textContent = m.fileName;
      const size = document.createElement('small'); size.textContent = fileSize(m.fileSize);
      details.append(fileName,size); bubble.append(icon,details);
    } else { bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.textContent = m.text; }
    meta.append(name,time); body.append(meta,bubble); item.append(avatar(m),body); fragment.append(item);
  }
  $('messages').replaceChildren(fragment); $('welcome').classList.toggle('compact', messages.size > 0); $('load-more').hidden = !hasMore;
}
async function recent() {
  // Fill gaps after a disconnect, even when more than 100 messages arrived.
  const known = historyLoaded && messages.size ? Math.max(...messages.keys()) : 0;
  const data = await api('/api/messages');
  const collected = [...data.messages]; let page = data;
  while (known && page.hasMore && page.messages[0]?.id > known) {
    page = await api('/api/messages?before=' + page.messages[0].id); collected.push(...page.messages);
  }
  const near = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 90;
  const first = !historyLoaded;
  if (first) hasMore = data.hasMore;
  historyLoaded = true;
  for (const [id,m] of messages) if (m.createdAt < Date.now()-7*86400000) messages.delete(id);
  for (const m of collected) messages.set(m.id,m);
  render(); if (first || near) bottom();
}
async function start() {
  try {
    me = await api('/api/me');
    const details = document.createElement('div'); const name = document.createElement('strong'); name.textContent = me.name;
    const label = document.createElement('small'); label.textContent = '你的自动昵称'; details.append(name,label); $('identity').replaceChildren(avatar(me),details);
    input.disabled = false;
    $('file-input').disabled = false; $('image-input').disabled = false;
    $('attach').disabled = false; $('image').disabled = false;
    source = new EventSource('/api/events');
    source.addEventListener('ready', async e => {
      const nextVersion = JSON.parse(e.data).devVersion;
      if (devVersion && nextVersion && nextVersion !== devVersion) {
        try { sessionStorage.setItem('lan-chat-dev-draft', input.value); } catch {}
        location.reload(); return;
      }
      devVersion = nextVersion;
      $('status').textContent = '已连接'; $('status-dot').classList.add('live');
      try { await recent(); error(); } catch(e) { error(e.message); }
    });
    source.addEventListener('presence', e => { $('online').textContent = JSON.parse(e.data).count + ' 人在线'; });
    source.addEventListener('message', e => {
      const m = JSON.parse(e.data); const near = timeline.scrollHeight-timeline.scrollTop-timeline.clientHeight<90;
      messages.set(m.id,m); render(); if (near || m.userId===me.id) bottom(); else $('new-messages').hidden = false;
    });
    source.onerror = () => { $('status').textContent = '重连中'; $('status-dot').classList.remove('live'); $('online').textContent = '— 人在线'; };
  } catch(e) { error('暂时无法连接，正在重试…'); setTimeout(start,3000); }
}
$('load-more').onclick = async () => {
  if(loading || !messages.size) return; loading=true; $('load-more').disabled=true;
  const height=timeline.scrollHeight, top=timeline.scrollTop;
  try { const data=await api('/api/messages?before='+Math.min(...messages.keys())); hasMore=data.hasMore; for(const m of data.messages) messages.set(m.id,m); render(); timeline.scrollTop=top+timeline.scrollHeight-height; } catch(e) {error(e.message);} finally {loading=false;$('load-more').disabled=false;}
};
function resize() { input.style.height='auto'; input.style.height=Math.min(input.scrollHeight,150)+'px'; $('length').textContent=input.value.length+' / 4000'; $('send').disabled=sending || !input.value.trim(); }
input.addEventListener('input',resize);
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();$('composer').requestSubmit();}});
$('composer').onsubmit=async e=>{
  e.preventDefault(); if(sending || !input.value.trim() || !me)return;
  sending=true; const draft=input.value; resize();error();
  try {const m=await api('/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:draft})});messages.set(m.id,m);render();if(input.value===draft)input.value='';bottom();}
  catch(e){error('发送失败：'+e.message+'。消息已保留，请重试。');}
  finally{sending=false;resize();input.focus();}
};
$('attach').onclick = () => $('file-input').click();
$('image').onclick = () => $('image-input').click();
let uploadCanceled = false;
$('cancel-upload').onclick = () => { uploadCanceled = true; upload?.abort(); };
function setAttachBusy(busy) { $('attach').disabled = busy; $('image').disabled = busy; }
function uploadOne(file, label) {
  return new Promise(resolve => {
    error(); $('upload-progress').hidden = false;
    $('upload-meter').value = 0; $('upload-label').textContent = `${label} · 0%`;
    const xhr = new XMLHttpRequest(); upload = xhr;
    xhr.open('POST', '/api/files'); xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.upload.onprogress = e => { if (e.lengthComputable) { const percent = Math.min(100, Math.round(e.loaded / e.total * 100)); $('upload-meter').value = percent; $('upload-label').textContent = `${label} · ${percent}%`; } };
    let ok = false;
    xhr.onload = () => {
      if (xhr.status === 201) { ok = true; try { const m = JSON.parse(xhr.responseText); messages.set(m.id,m); render(); bottom(); } catch {} }
      else { try { error(JSON.parse(xhr.responseText).error || '上传失败，请重试'); } catch { error('上传失败，请重试'); } }
    };
    xhr.onerror = () => error('上传失败，请检查网络后重试');
    xhr.onabort = () => error('上传已取消');
    xhr.onloadend = () => resolve(ok);
    xhr.send(file);
  });
}
async function uploadFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length || upload) return;
  const tooBig = files.find(f => f.size > 500_000_000);
  if (tooBig) { error(`「${tooBig.name}」超过 500 MB，单个文件不能大于 500 MB`); return; }
  const tooLong = files.find(f => new TextEncoder().encode(f.name).length > 255);
  if (tooLong) { error(`「${tooLong.name}」文件名太长`); return; }
  uploadCanceled = false; setAttachBusy(true);
  const failed = []; let done = 0;
  for (let i = 0; i < files.length; i++) {
    const label = files.length > 1 ? `正在上传 ${files[i].name}（${i + 1}/${files.length}）` : `正在上传 ${files[i].name}`;
    if (await uploadOne(files[i], label)) done++; else failed.push(files[i].name);
    if (uploadCanceled) break;
  }
  upload = null; $('upload-progress').hidden = true; setAttachBusy(false);
  if (uploadCanceled) error(`上传已取消${done ? `，已完成 ${done} 个` : ''}`);
  else if (failed.length) error(`${failed.length} 个文件上传失败：${failed.slice(0,3).join('、')}${failed.length > 3 ? ' 等' : ''}`);
  else error();
}
$('file-input').onchange = () => { const files = [...($('file-input').files || [])]; $('file-input').value = ''; uploadFiles(files); };
$('image-input').onchange = () => { const files = [...($('image-input').files || [])]; $('image-input').value = ''; uploadFiles(files); };
$('new-messages').onclick=bottom;
timeline.addEventListener('scroll',()=>{if(timeline.scrollHeight-timeline.scrollTop-timeline.clientHeight<90)$('new-messages').hidden=true;});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
resize(); start();
