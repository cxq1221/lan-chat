# 同频 · 局域网群聊

一个无需登录的局域网 Web 群聊。访问 `http://主机局域网 IP:81` 即可加入公共聊天室，无需填写昵称、密码或房间号。支持文字和任意类型文件，单文件最大 500 MB（500,000,000 字节）。

## 功能

- 自动生成昵称和头像；同一浏览器保留身份。
- 实时消息、在线人数、断线重连。
- 文字与文件上传，显示上传进度，可取消；文件以附件形式下载。
- SQLite 保存最近 7 天的消息和文件。首次加载最近 100 条，可继续加载更早内容。
- 适配电脑和手机。前端资源由本机提供，运行时不依赖互联网。

## 桌面版：双击启动

在 [GitHub Releases](https://github.com/cxq1221/lan-chat/releases) 下载对应安装包：

| 系统 | 安装包 |
| --- | --- |
| Windows x64 | `windows-x64-setup.exe` 安装版，或 `windows-x64-portable.exe` 便携版 |
| Mac Apple Silicon（M 系列） | `mac-arm64.dmg` |
| Mac Intel | `mac-x64.dmg` |

双击启动后，桌面窗口直接进入聊天室，可像其他设备一样发送消息、上传和下载文件，界面与网页一致。系统托盘/菜单栏可复制局域网地址、在浏览器中打开或退出服务。关闭窗口后服务继续运行；选择“退出并停止服务”才会停止。服务优先使用 81 端口，被占用或无权限时自动尝试 8787 和系统分配的可用端口。

桌面版内置运行环境，无需安装 Node.js。数据存放在系统应用数据目录下的 `server-data/`；更新应用不会覆盖该目录。桌面版的数据独立于源码运行的 `data/`。同一台主机同时运行两种方式时，会形成两个独立聊天室。

当前安装包没有开发者商业签名或 Apple 公证，下载后系统可能显示来源未验证提示。Windows 首次启动时如果防火墙询问网络权限，需要允许在用于聊天的私有网络接收入站连接。

## 本机运行

需要 Node.js 22.13 或更新版本，无第三方依赖。

```sh
npm start
```

终端会打印当前局域网地址。其他设备连接同一网络后访问该地址；本机可访问 `http://localhost:81`。主机需要保持运行，防火墙需允许 Node 接收入站连接。

可用 `PORT=9000 npm start` 修改端口，用 `DATA_DIR=/path/to/data npm start` 修改数据目录。默认数据库为 `data/chat.sqlite`，文件保存在 `data/files/`。这两个路径不要提交到 Git，也不要放进公开的 Web 根目录。

## Docker

```sh
docker compose up -d --build
```

访问 `http://主机局域网 IP:81`。数据库和文件保存在 Docker 命名卷 `chat-data`。首次构建需要下载 Node 基础镜像。

## 开发

```sh
npm run dev
npm test
```

开发模式监控 `server.mjs` 和 `public/`。保存文件后服务自动重启，已连接的浏览器随后自动刷新；未发送的文字草稿会保留。已占用 81 端口时，先停止该端口上的旧服务，或用 `PORT=其他端口 npm run dev`。

## 部署与数据

此应用适用于可信的局域网。能访问地址的人均可读取消息和文件，也可发消息及上传文件。默认使用 HTTP，传输内容没有加密；不要直接暴露到公网。若需跨不可信网络使用，请在前面配置 HTTPS 和访问控制。浏览器 Cookie 存放自动身份；清除 Cookie 或换浏览器会得到新身份。

单条文字消息最多 4000 字符。消息和文件每分钟清理一次；超过 7 天的内容即使清理尚未执行，也不会在查询或下载接口返回。文件上传按实际接收大小再次校验，下载统一使用附件响应，不在页面中执行文件内容。主机需要为上传文件预留磁盘空间。

代码使用 [MIT 许可证](LICENSE)。

## 构建桌面安装包

```sh
npm ci
npm run desktop
npm run desktop:smoke
npm run dist:mac -- --arm64  # Apple Silicon Mac
npm run dist:mac -- --x64    # Intel Mac
npm run dist:win            # Windows x64
```

产物保存在 `dist/`。建议在对应系统构建。GitHub Actions 会在 `v*` 标签推送后分别在 Windows、Apple Silicon Mac 和 Intel Mac 上运行测试、构建安装包并上传到 Release；也可以手动运行 Desktop apps 工作流生成构建产物。发布前如需签名，应配置自己的开发者证书并调整构建签名设置。
