# NetEase Music Unblock Worker

基于 Cloudflare Worker 的网易云音乐海外解锁 & 自动保活工具。

## ✨ 功能

- 🌏 **海外解锁** - 代理请求并伪装国内 IP，解除地区限制
- 🔄 **自动保活** - 定时刷新登录 Token，保持 Cookie 长期有效
- ☁️ **零成本** - 使用 Cloudflare Workers 免费额度，无需服务器

## 📦 部署

### 第一步：创建 Worker

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** → **Create** → **Create Worker**
3. 给 Worker 起个名字
4. 点击 **Deploy**
5. 点击 **Edit code**，删除默认代码
6. 复制 `src/worker.js` 的全部内容并粘贴
7. 点击 **Deploy** 保存

### 第二步：获取 MUSIC_U

1. 打开浏览器，登录 [网易云音乐网页版](https://music.163.com/)
2. 按 `F12` 打开开发者工具
3. 进入 `Application` → `Cookies` → `music.163.com`
4. 找到 `MUSIC_U`，复制其值

### 第三步：设置环境变量

1. 进入 Worker → **Settings** → **Variables and Secrets**
2. 点击 **Add**，添加：
   - **Name**: `MUSIC_U`
   - **Value**: 你的 MUSIC_U 值
   - **Type**: Secret（加密存储）
3. 点击 **Deploy**

### 第四步：配置定时任务

1. 进入 Worker → **Settings** → **Triggers**
2. 在 **Cron Triggers** 点击 **Add**
3. 选择 **Every 23 hours**
4. 点击 **Add**

## ⚙️ 环境变量

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `MUSIC_U` | 二选一 | 网易云音乐登录 Cookie |
| `NETEASE_COOKIE` | 二选一 | 完整 Cookie 字符串 |


## 鸣谢

- [nondanee/NetEaseMusicWorldPlus](https://github.com/nondanee/NetEaseMusicWorldPlus) - 原 Chrome 扩展项目
- [Kyle-Kyle/UnblockNetEaseMusic](https://github.com/Kyle-Kyle/UnblockNetEaseMusic) - Docker 自动保活方案

## 📄 License

MIT
