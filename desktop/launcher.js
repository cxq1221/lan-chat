const $ = id => document.getElementById(id);
let last = '';
async function update() {
  try {
    const state = await window.host.state();
    $('status').textContent = state.running ? '● 服务运行中' : state.error ? '启动失败' : '正在启动';
    $('open').disabled = !state.running;
    $('notice').textContent = state.error || (state.running && !state.addresses.length ? '未检测到局域网地址，请连接 Wi-Fi 或有线网络。' : state.port && state.port !== 81 ? `81 端口不可用，已自动使用 ${state.port}。` : '');
    const next = JSON.stringify(state.addresses);
    if (next === last) return; last = next;
    $('addresses').replaceChildren(...state.addresses.map(address => {
      const row = document.createElement('div'); row.className = 'address';
      const code = document.createElement('code'); code.textContent = address;
      const button = document.createElement('button'); button.textContent = '复制';
      button.onclick = async () => { await window.host.copy(address); button.textContent = '已复制'; setTimeout(() => button.textContent = '复制', 1500); };
      row.append(code,button); return row;
    }));
  } catch { $('notice').textContent = '无法读取服务状态，请重新启动应用。'; }
}
$('open').onclick = () => window.host.open();
$('data').onclick = () => window.host.data();
$('quit').onclick = () => window.host.quit();
update(); setInterval(update, 2000);
