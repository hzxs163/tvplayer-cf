# tvplayer-cf

纯前端影视聚合播放器（Cloudflare Pages + Pages Functions），支持多源导入、分类浏览、聚合搜索、多线路播放、选集、收藏、历史、断点续播、PWA。

## 内置演示源

项目内置了「演示源 · 公开测试流」（`/api/demo`），**无需导入任何源，部署后开箱即可体验**完整功能：
浏览 / 分类 / 搜索 / 多线路切换 / 选集 / 播放。

演示内容全部为公开流媒体测试资源（Mux、Apple、Akamai、Google Shaka 官方测试流及 Blender 开源电影），
不包含任何版权内容。可在「源管理」中删除本源，或导入自己的真实源。

> 真实影视源需要自行配置：源格式为苹果CMS（macCMS）兼容接口，JSON 数组：
> ```json
> [{
>   "key": "my_source",
>   "name": "我的源名称",
>   "api": "https://你的域名.com/api.php/provide/vod",
>   "type": 0, "searchable": 1, "filterable": 1, "playerType": 1, "group": "stable"
> }]
> ```
> 支持本地 JSON 导入、远程 URL 导入、在线编辑。

## 本地开发

```bash
npx wrangler pages dev --directory . --port 8788
```

## 部署

```bash
npx wrangler pages deploy .
```

## 优化清单（v2 已完成项 ✅ / 待办 ⬜）

| # | 优化项 | 状态 | 说明 |
| - | - | - | - |
| 1 | 首次访问无源时事件绑定失效 | ✅ 已修复 | init() 提前 return 导致导入源后切换/搜索不可用（严重 bug） |
| 2 | 搜索接口参数不标准 | ✅ 已修复 | `ac=detail&wd=` → 标准 `ac=videolist&wd=`，失败回退 `ac=list&wd=` |
| 3 | 内置默认源 | ✅ 已实现 | loadSources 回退加载 `sources.json`，部署后开箱即用 |
| 4 | 加密流支持 | ✅ 已修复 | play.js 重写 `#EXT-X-KEY` URI，加密 m3u8 可播放 |
| 5 | 非 m3u8 流式透传 | ✅ 已优化 | 不再整文件读入内存，TS/MP4/KEY 直接流式转发 |
| 6 | HLS 配置去重 | ✅ 已优化 | 4 处重复的 60 行 HLS 配置提取为共享 `HLS_CONFIG` |
| 7 | 单线路隐藏换源下拉 | ✅ 已修复 | `renderPlayerLines` 三元表达式恒真 bug |
| 8 | 断点续播 | ✅ 已接入 | 进度每 10 秒保存（此前为死代码），再次打开提示上次进度 |
| 9 | 播放器记住音量/速度 | ✅ 已实现 | localStorage 记忆，下次播放恢复 |
| 10 | 播放速度控制 | ✅ 已实现 | 0.5x–2x 下拉切换 |
| 11 | 搜索输入防抖 | ✅ 已实现 | 停止输入 500ms 自动搜索 |
| 12 | 图片淡入 | ✅ 已实现 | 加载后淡入，避免闪烁 |
| 13 | 浏览页收藏星标 | ✅ 已实现 | 已收藏影片卡片显示 ⭐ |
| 14 | HTML 页面解析修复 | ✅ 已修复 | fetchProxy 支持文本响应，`.html` 页面可提取 m3u8 |
| 15 | SW 缓存策略 | ✅ 已重写 | `/api/` 永不缓存（避免缓存视频流）、导航 network-first（更新立即可见） |
| 16 | 首页多余 `</button>` | ✅ 已修复 | HTML 结构错误 |
| 17 | 历史记录可视化 | ⬜ 待办 | 点击历史按钮弹窗显示观看记录 |
| 18 | 分页预加载 | ⬜ 待办 | 提前加载下一页，翻页更快 |
| 19 | 源导入 UI 增强 | ⬜ 待办 | 远程导入功能 UI 显眼化 |
| 20 | 原生 confirm 替换 | ⬜ 待办 | 免责声明/删除确认改用自定义弹窗（原生 confirm 阻塞且体验差） |
