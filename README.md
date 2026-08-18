# 考研阅读 · Web 版

与 Android 版功能对齐的网页版本：126 篇考研同源外刊（含真实《卫报》文章）、双语对照阅读、语音朗读、点词查词（词性 + 音标 + 中英释义，含在线兜底）、生词本、收藏、阅读进度记忆。纯静态无构建依赖，可"添加到主屏幕"当 App 用（首次加载后支持离线）。

**设计**：参考 englio.ai 的编辑风卡片广场 —— 桌面宽屏顶部导航 + 2/3 列卡片网格 + 分组筛选面板（来源/话题/难度），卡片渐入、悬停上浮、路由切换等动效；移动端保持单列 + 底部导航。支持深浅色自动切换，遵循 `prefers-reduced-motion`。

## 功能对比

| 功能 | 网页版实现 |
| --- | --- |
| 文章库 + 筛选 + 搜索 | 分组筛选面板（收藏/来源/话题/难度）+ 搜索框 + 统计与一键清除 |
| 双语对照阅读 | 逐段译文开关 + 一键全部展开 |
| 语音朗读 | 系统浏览器语音（默认）+ 火山方舟云端（可选）；修复快速连续点读/切换报错 |
| 点词查词 | 点击/键盘选中单词弹窗：音标 + 词性徽章 + 中文释义（在线查词经 MyMemory/Google 双源自动翻译）+ 英文释义 + 发音；结果缓存本地 |
| 生词本 | 词性标注展示 / 发音 / 删除 / 清空（localStorage 持久化） |
| 收藏文章 | 星标收藏 + "仅看收藏"筛选 |
| 阅读进度记忆 | 自动记录段落位置，重开显示"继续上次阅读" |
| 设置 | 引擎切换、音色、语速、字号、云端配置 |

## 数据说明

- `data/articles/*.json`：126 篇文章源文件（20 篇原创 + 106 篇《卫报》官方开放 API 抓取的真实文章，逐段中英对照）。文件名必须与文章 `id` 一致，正文按篇懒加载
- `data/dictionary.json`：3388 词本地词典（词性 + 音标 + 中文释义；历史损坏的 1139 条释义已在 `data/dict-fix/` 中重写并合并修复）
- `data/index.js`：文章元信息索引（不含正文），由构建脚本生成，勿手改
- `data/dict.js`：词典数据，由构建脚本生成，勿手改
- 重新生成数据：`npm run build`（含 schema 校验：必填字段、段落中英对齐、id/单词去重、产物体积报告；同时自动向 `sw.js` 注入缓存版本号）

## 更新文章数据（卫报）

```powershell
npm run update-guardian
# 等价于依次执行：fetch-guardian -> clean-raw -> curate-raw -> apply-zh -> fix-wordcount -> build-data
# 注意：新增文章需先在 data/zh-add/ 补充中文译文（batch-*.json），apply-zh 才能合并；
# 缺译文的文章会被跳过并在控制台列出（MISSING zh）。
```

> 卫报内容经官方 Open Platform API（api-key=test）获取，仅供个人学习使用；版权归 Guardian News & Media Ltd. 所有。

## 使用方法

### 1. 启动服务（电脑上）

```powershell
cd D:\桌面\web
python tools/serve.py 8080
```

保持窗口开着即可。关闭后重新启动用上面两条命令。

> **注意**：必须使用 `python tools/serve.py` 启动（而非 `python -m http.server`），因为代理脚本解决了火山方舟 TTS 接口的跨域问题。

### 2. 手机访问

手机和电脑连同一个 Wi-Fi，浏览器打开 `http://<电脑局域网IP>:8080`。

> 用 `ipconfig` 查看电脑无线网卡的 IPv4 地址（"无线局域网适配器 WLAN" 一节）。换网络后 IP 可能变化，需重新查询。

### 3. 添加到主屏幕（像 App 一样使用）

- **Android Chrome**：打开页面 → 右上角菜单 → "安装应用"或"添加到主屏幕"
- 首次加载后 Service Worker 会缓存页面、字体与数据索引，读过的文章也会缓存，之后无网络也能打开阅读

### 4. 常见问题

- **手机打不开**：Windows 防火墙首次会弹窗询问是否允许 Python 联网，选择"允许"；如果之前拒绝了，在"防火墙"设置中放行 python，或临时关闭防火墙测试
- **没有声音**：设置页确认"朗读引擎"为"系统语音" → 点"试听发音"；若仍无声，手机浏览器设置中检查语音/TTS 权限，或点页面任意位置后再试听（浏览器需要用户手势才能播声）
- **想换字体大小**：阅读器右上角 A-/A+，或"设置 → 语音与阅读 → 字号"
- **云端语音**：设置页切到"云端 · 火山方舟"，填 API Key/端点/模型/音色。注意浏览器跨域 (CORS) 限制：火山方舟接口若不允许浏览器直接调用会失败（会在提示里说明），此时请切回"系统语音"

## 部署建议

任意静态托管均可（GitHub Pages / Vercel / Nginx 等）。建议开启 gzip/brotli 压缩：`data/*.js` 与 `js/*.js` 压缩后可减少约 60~70% 传输体积。

## 目录结构

```
web/
├── index.html          入口（桌面顶部导航 + 移动端底部导航）
├── data/               JSON 数据源 + 生成的数据脚本产物
│   ├── index.js        文章元信息索引（构建生成，首屏加载）
│   ├── dict.js         词典数据（构建生成，首屏加载）
│   ├── articles/       文章正文（按篇懒加载，阅读后由 SW 缓存供离线使用）
│   ├── dictionary.json 词典源数据
│   ├── dict-fix/       词典释义修复补丁
│   ├── articles-raw/   卫报抓取原始数据
│   └── zh-add/         新增文章的中文译文批次
├── css/styles.css      编辑风卡片设计系统（自动深浅色）
├── css/fonts.css       自托管字体声明（构建生成）
├── fonts/              Libre Bodoni / Public Sans woff2（latin 子集）
├── js/ui.js            图标/弹窗/Toast（含焦点管理与 Esc 关闭）
├── js/tts.js           双引擎语音服务
├── js/store.js         localStorage 持久化封装（含数据版本迁移）
├── js/dict.js          词典服务（词性解析/翻译降级链/在线查词）
├── js/app.js           路由与四个页面
├── manifest.json       PWA 清单
├── sw.js               Service Worker（离线缓存 + 后台更新，版本号由构建注入）
├── package.json        构建脚本入口（npm run build / update-guardian 等）
├── icons/              应用图标
└── tools/              数据构建脚本
    ├── build-data.js   校验 + 生成 data/index.js、data/dict.js + 注入 SW 版本
    ├── fetch-guardian.js  抓取卫报最新文章到 data/articles-raw/
    ├── clean-raw.js    清理垃圾段落/过短文章
    ├── curate-raw.js   按精选名单保留（可编辑此脚本调整）
    ├── apply-zh.js     合并 data/zh-add/ 译文 -> data/articles/
    ├── fix-wordcount.js 按英文段落重新统计词数
    ├── apply-dict-fix.js 合并 data/dict-fix/ 词典修复补丁
    └── fetch-fonts.js  下载 Google Fonts latin 子集到 fonts/ 并生成 css/fonts.css
```
