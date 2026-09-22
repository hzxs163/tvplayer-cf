// functions/api/demo.js - 内置演示源（苹果CMS 兼容格式）
// 作用：让部署后的播放器开箱即可体验完整功能（浏览/分类/搜索/多线路/选集/播放）
// 内容：全部使用公开的流媒体测试资源（Mux / Apple / Shaka / Blender 开源电影），无任何版权内容
// 用户可随时在「源管理」中删除本源，或导入自己的真实源替换

// 分类（对应苹果CMS class 字段）
const CLASSES = [
  { type_id: 1, type_name: '测试频道', type_pid: 0 },
  { type_id: 2, type_name: '开源电影', type_pid: 0 },
  { type_id: 3, type_name: '现场直播', type_pid: 0 },
];

// 视频库（vod 字段风格对齐苹果CMS）
const VODS = [
  {
    vod_id: 1, type_id: 1, type_name: '测试频道',
    vod_name: 'Mux 多码率测试流', vod_pic: '',
    vod_score: '9.5', vod_remarks: '720P/1080P', vod_actor: 'Mux', vod_director: 'Mux',
    vod_content: 'Mux 官方公开测试流（HLS 多码率自适应），用于验证播放器码率切换与分片代理。',
    vod_play_from: 'Mux$$$Apple$$$Shaka',
    vod_play_url: '高清$https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8#标清$https://test-streams.mux.dev/x36xhzz/url_2/193039199_mp4_h264_aac_ld_7.m3u8$$$720P$https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8#480P$https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_hevc/master.m3u8$$$全片$https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8',
  },
  {
    vod_id: 2, type_id: 2, type_name: '开源电影',
    vod_name: 'Sintel · 开源电影', vod_pic: '',
    vod_score: '8.8', vod_remarks: 'CC-BY 4.0', vod_actor: 'Blender Foundation', vod_director: 'Colin Levy',
    vod_content: 'Blender 基金会出品的开源动画短片（CC-BY 协议），可用以验证长片断点续播、选集与速度控制。',
    vod_play_from: 'Akamai$$$Shaka',
    vod_play_url: '1080P$https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8#720P$https://bitdash-a.akamaihd.net/content/sintel/hls/playlist_720.m3u8$$$全片$https://storage.googleapis.com/shaka-demo-assets/sintel-hls/hls.m3u8',
  },
  {
    vod_id: 3, type_id: 2, type_name: '开源电影',
    vod_name: 'Tears of Steel · 开源电影', vod_pic: '',
    vod_score: '8.5', vod_remarks: 'CC-BY 3.0', vod_actor: 'Blender Foundation', vod_director: 'Ian Hubert',
    vod_content: 'Blender 基金会出品的开源科幻短片（CC-BY 协议）。',
    vod_play_from: 'Unified',
    vod_play_url: '全集$https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
  },
  {
    vod_id: 4, type_id: 3, type_name: '现场直播',
    vod_name: 'Akamai 直播测试频道', vod_pic: '',
    vod_score: '9.0', vod_remarks: 'LIVE', vod_actor: 'Akamai', vod_director: 'Akamai',
    vod_content: 'Akamai 官方公开直播测试流，用于验证低延迟播放与直播模式。',
    vod_play_from: 'Akamai',
    vod_play_url: '直播$https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8',
  },
  {
    vod_id: 5, type_id: 3, type_name: '现场直播',
    vod_name: 'Akamai 八频道直播', vod_pic: '',
    vod_score: '8.6', vod_remarks: 'LIVE', vod_actor: 'Akamai', vod_director: 'Akamai',
    vod_content: 'Akamai 公开直播测试流（Eight 频道）。',
    vod_play_from: 'Akamai',
    vod_play_url: '直播$https://moctobpltc-i.akamaihd.net/hls/live/571329/eight/playlist.m3u8',
  },
  {
    vod_id: 6, type_id: 1, type_name: '测试频道',
    vod_name: 'Shaka 多音轨测试流', vod_pic: '',
    vod_score: '9.2', vod_remarks: '多音轨', vod_actor: 'Google Shaka', vod_director: 'Google Shaka',
    vod_content: 'Google Shaka Player 官方公开测试资源（多语言音轨），用于验证音轨切换。',
    vod_play_from: 'Shaka',
    vod_play_url: '全集$https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8',
  },
];

// 模拟分页：每页展示 limit 条
function paginate(list, page, limit) {
  const p = Math.max(1, parseInt(page) || 1);
  const l = Math.min(50, Math.max(1, parseInt(limit) || 24));
  const start = (p - 1) * l;
  return { items: list.slice(start, start + l), page: p, limit: l, total: list.length };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const ac = url.searchParams.get('ac') || 'videolist';
  const wd = (url.searchParams.get('wd') || '').trim();

  // ============ 详情 ============
  if (ac === 'detail') {
    const ids = (url.searchParams.get('ids') || '').split(',').map(s => parseInt(s)).filter(Boolean);
    const list = VODS.filter(v => ids.includes(v.vod_id));
    return json({ code: 1, msg: '数据列表', page: 1, pagecount: 1, limit: 20, total: list.length, list });
  }

  // ============ 搜索 ============
  if (wd) {
    const kw = wd.toLowerCase();
    const list = VODS.filter(v =>
      v.vod_name.toLowerCase().includes(kw) ||
      v.vod_content.toLowerCase().includes(kw) ||
      v.vod_actor.toLowerCase().includes(kw)
    );
    return json({ code: 1, msg: '数据列表', page: 1, pagecount: 1, limit: 20, total: list.length, list });
  }

  // ============ 分类（ac=list 无 wd） ============
  if (ac === 'list') {
    return json({ code: 1, msg: '数据列表', page: 1, pagecount: 1, limit: 20, total: 0, list: [], class: CLASSES });
  }

  // ============ 列表（ac=videolist / 默认） ============
  const t = url.searchParams.get('t');
  const pg = url.searchParams.get('pg') || 1;
  const limit = url.searchParams.get('limit') || 24;

  let list = VODS;
  if (t) list = VODS.filter(v => String(v.type_id) === String(t));

  const { items, page, total } = paginate(list, pg, limit);
  const pagecount = Math.max(1, Math.ceil(total / limit));

  return json({ code: 1, msg: '数据列表', page, pagecount, limit, total, list: items, class: CLASSES });
}
