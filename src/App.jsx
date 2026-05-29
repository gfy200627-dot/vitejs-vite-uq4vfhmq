import React from 'react';
import { createClient } from '@supabase/supabase-js';
// ============================================================
// Supabase 配置
// ============================================================
const SUPABASE_URL = "https://nojdevvfjivwepjwvyal.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_W-o5oaYeO1x9PFe53ww3Xw_xDuBTZI2";

// ============================================================
// 【移动端关键修复】安全存储适配器
// 微信/微博/抖音/QQ 内置浏览器、Safari 隐私模式下，访问 localStorage
// 可能直接抛异常。Supabase 默认用 localStorage 存 session，一旦抛错，
// getSession() 会卡住或 reject，导致首屏永久转圈（PC 正常、手机加载不出来）。
// 这里用 try/catch 包一层，失败时退化到内存存储，保证永远不抛。
// ============================================================
const _memStore = {};
const safeLocalStorage = {
    getItem(key) { try { return window.localStorage.getItem(key); } catch (e) { return key in _memStore ? _memStore[key] : null; } },
    setItem(key, value) { try { window.localStorage.setItem(key, value); } catch (e) { _memStore[key] = String(value); } },
    removeItem(key) { try { window.localStorage.removeItem(key); } catch (e) { delete _memStore[key]; } }
};
const _memSession = {};
const safeSessionStorage = {
    getItem(key) { try { return window.sessionStorage.getItem(key); } catch (e) { return key in _memSession ? _memSession[key] : null; } },
    setItem(key, value) { try { window.sessionStorage.setItem(key, value); } catch (e) { _memSession[key] = String(value); } },
    removeItem(key) { try { window.sessionStorage.removeItem(key); } catch (e) { delete _memSession[key]; } }
};

// 给任意 Promise 加超时兜底：移动网络/冷启动卡住时不至于无限等待
function withTimeout(promise, ms, fallback) {
    return new Promise((resolve) => {
        let done = false;
        const t = setTimeout(() => { if (!done) { done = true; resolve(fallback); } }, ms);
        Promise.resolve(promise).then(
            (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } },
            (e) => { if (!done) { done = true; clearTimeout(t); console.error('[withTimeout] rejected:', e); resolve(fallback); } }
        );
    });
}

// 统一获取当前用户 id：优先用 bootstrap 已缓存的 window._ehpUserId（不发网络请求），
// 没有才回落到带 5 秒超时的 getSession()。手机端网络卡住时最多等 5 秒就放弃，
// 绝不会让云端同步/读取无限挂起拖垮整个页面。
async function getCurrentUserId() {
    if (typeof window !== 'undefined' && window._ehpUserId) return window._ehpUserId;
    const r = await withTimeout(supabaseClient.auth.getSession(), 5000, { data: { session: null } });
    const uid = r?.data?.session?.user?.id || null;
    if (uid && typeof window !== 'undefined') window._ehpUserId = uid;
    return uid;
}

// ============================================================
// 【抗杀续档】活动槽位指针
// sessionStorage 在 App 被系统杀死（iOS 主屏 PWA 重启、内存回收）后会清空，
// 导致重开时回到存档选择页、而不是刚才那一幕。这里额外把“最近活动槽位 + 时间戳”
// 写进 localStorage：
//   · 30 分钟内重开 → 自动续上（无缝回到游戏）
//   · 超过 30 分钟  → 进选择页，但顶部出现“继续上次”一键回到该存档
// 存档数据本身始终在 localStorage(ehp_v16_*) + 云端，绝不会因被杀而丢失。
// 想改成“只用按钮、永不自动续”，把 RESUME_WINDOW_MS 设为 0 即可。
// ============================================================
const ACTIVE_SLOT_KEY = 'ehp_activeSlot';   // 当前会话（sessionStorage，刷新/切后台用）
const LAST_ACTIVE_KEY = 'ehp_lastActive';   // 跨重启（localStorage，带时间戳）
const RESUME_WINDOW_MS = 30 * 60 * 1000;    // 30 分钟内自动续档；设 0 则禁用自动续

function markActiveSlot(slotId) {
    safeSessionStorage.setItem(ACTIVE_SLOT_KEY, String(slotId));
    safeLocalStorage.setItem(LAST_ACTIVE_KEY, JSON.stringify({ slot: slotId, ts: Date.now() }));
}
// 仅刷新时间戳（游戏内每次自动存档时调用，保持“最近在玩”判定新鲜）
function touchActiveSlot(slotId) {
    safeLocalStorage.setItem(LAST_ACTIVE_KEY, JSON.stringify({ slot: slotId, ts: Date.now() }));
}
function clearActiveSlot() {
    safeSessionStorage.removeItem(ACTIVE_SLOT_KEY);
    safeLocalStorage.removeItem(LAST_ACTIVE_KEY);
}
// 读取跨重启指针，返回 { slot, ts, fresh } 或 null（fresh=是否在自动续窗口内）
function readLastActive() {
    const raw = safeLocalStorage.getItem(LAST_ACTIVE_KEY);
    if (!raw) return null;
    try {
        const obj = JSON.parse(raw);
        const slot = parseInt(obj.slot);
        if (isNaN(slot)) return null;
        const ts = Number(obj.ts) || 0;
        return { slot, ts, fresh: RESUME_WINDOW_MS > 0 && (Date.now() - ts) <= RESUME_WINDOW_MS };
    } catch (e) { return null; }
}

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        storage: safeLocalStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/chat`;

// ============================================================
// 常量数据
// ============================================================
const FANS = [
    { id: "wonjeong", name: "梁祯元", handle: "@Won_Jung_", age: 22, emoji: "⚔️", color: "#e74c3c", type: "事业粉", personality: "嘴硬心软，战斗力爆表", famousEvent: "抨击你时语言太过犀利被西村力疯狂辱骂，两人评论区撕逼金句频出；帮你们撕走倒油Cody后一秒切战斗粉催数据" },
    { id: "jongseong", name: "朴综星", handle: "@JAYPARK_0420", age: 24, emoji: "💎", color: "#9b59b6", type: "氪金粉", personality: "财阀二代，宠溺", famousEvent: "送你价值百万皇冠冲上热搜；用钞能力投喂资源，被造谣有金主后直接放律师函" },
    { id: "jaeyun", name: "沈载伦", handle: "@JAKE_S", age: 24, emoji: "💍", color: "#3498db", type: "男友粉", personality: "爱吃醋，从不叫你姐姐", famousEvent: "梦男文被评镇圈神文后被一脚踹下神文榜；犯姐夫瘾被投稿后怒发二十张自拍自证清白" },
    { id: "sunghoon", name: "朴成训", handle: "@IceShP", age: 24, emoji: "📸", color: "#1abc9c", type: "站哥", personality: "忧郁安静，安全感极低", famousEvent: "误入西村力梁祯元撕逼现场因打字太慢被围攻；线下太帅被星探挖，一听是对家让星探滚" },
    { id: "sunoo", name: "金善禹", handle: "@KiMSunOo.O", age: 22, emoji: "🌟", color: "#f39c12", type: "接生粉", personality: "温暖治愈，全肯定", famousEvent: "早期接生粉，有你最早期的视频图片；搬运签售美谈让你大涨粉，你公开感激过他" },
    { id: "riki", name: "西村力", handle: "@Riki_", age: 20, emoji: "🔪", color: "#e67e22", type: "辱追粉", personality: "毒舌护短，骂得越狠爱得越深", famousEvent: "嘴太毒大战队友粉一战成名；跟梁祯元约架直播打LOL越塔强杀后开麦嘲笑十分钟" }
];

const ALL_ROLES = ["全能ACE", "主唱", "主舞", "Rapper"];
const STATUSES = ["跟团发展", "独立Solo期"];
const SOCIAL_PLATFORMS = [
    { id: "weverseId", name: "Weverse", icon: "🌐", placeholder: "chen_official" },
    { id: "instagramId", name: "Instagram", icon: "📷", placeholder: "@chen_official" },
    { id: "twitterId", name: "X/Twitter", icon: "𝕏", placeholder: "@chen_official" },
    { id: "kakaoId", name: "KakaoTalk", icon: "💬", placeholder: "chen_123" },
    { id: "tiktokId", name: "TikTok", icon: "🎵", placeholder: "@chen_official" },
    { id: "biliId", name: "Bilibili", icon: "📺", placeholder: "晨晨官方" },
    { id: "weiboId", name: "微博", icon: "🌊", placeholder: "晨晨官方" },
    { id: "threadsId", name: "Threads", icon: "🧵", placeholder: "@chen" }
];

const KAKAO_ACTIONS = [
    { name: "💕撩", prompt: "撩了对方一下", heartDelta: 3, riskDelta: 0 },
    { name: "🥺撒娇", prompt: "向对方撒娇", heartDelta: 4, riskDelta: 0 },
    { name: "😤吃醋", prompt: "表现出吃醋", heartDelta: 2, riskDelta: 1 },
    { name: "🤝约见面", prompt: "提出想见面", heartDelta: 5, riskDelta: 2 },
    { name: "😐冷淡", prompt: "表现得很冷淡", heartDelta: -2, riskDelta: 0 },
    { name: "🔍试探", prompt: "试探对方心意", heartDelta: 1, riskDelta: 0 }
];

const SHOP_ITEMS = [
    { id: "luxury_bag", name: "奢侈品包", price: 50, effect: { fashion: 5, beauty: 3 }, desc: "时尚+5 颜值+3" },
    { id: "dinner", name: "请粉丝吃饭", price: 20, effect: { popularity: 5 }, desc: "人气+5" },
    { id: "gym", name: "私教健身课", price: 15, effect: { beauty: 5 }, desc: "颜值+5" },
    { id: "clothes", name: "情侣款衣服", price: 30, effect: { risk: 2, heart: 5 }, desc: "风险+2 心动+5" }
];

const GIFT_ITEMS = [
    { id: "rose", name: "🌹 红玫瑰", price: 5, heartDelta: 3, emotionDelta: { affection: 2, jealousy: 1 } },
    { id: "perfume", name: "💝 限量香水", price: 15, heartDelta: 8, emotionDelta: { affection: 5, obsession: 3 } },
    { id: "bracelet", name: "💫 情侣手链", price: 25, heartDelta: 12, emotionDelta: { affection: 8, obsession: 5, jealousy: 3 } },
    { id: "letter", name: "✉️ 手写信", price: 3, heartDelta: 5, emotionDelta: { trust: 5, affection: 3 } }
];

// 第1天开场剧情：用函数动态注入主角艺名/花名，避免出现"主控"游戏术语
function buildInitStory(char) {
    const name = char?.artistName || char?.nickname || "晨晨";
    return `【第1天】

签名笔终于放下的时候，你才意识到虎口已经泛红。

后台化妆间安静得能听到空调的嗡鸣。几百人呼吸过的燥热还残留在空气里，你摘下耳边嗡嗡作响的耳返，把自己摔进沙发。皮质座椅发出一声沉闷的叹息。

经纪人欧尼的声音从走廊那头飘来："车还要等一会儿。"

工作模式，下线了。

你下意识往门口扫了一眼——没人。这才掏出手机，屏幕亮光映在脸上。熟练地切到那个连经纪人都不知道的账号，心跳莫名快了一拍。

Pann首页热度第一的帖子让你愣了一秒——

【🍉 签售姐来报——今天妆造是跟${name}有仇吗？】

> @Won_Jung_：妆造问题我已整理邮件发公司，后续跟进。另，${name}今天高音稳得不像话。

> @Riki_：梁祯元你管天管地，你上次说"沟通妆造"沟通出什么了？屁都没有。

> @Won_Jung_：@Riki_ 你有时间阴阳，不如把直拍数据做一做，点赞还被对家压着。

> 散粉：爸爸们别吵了😭 ${name}看到会难过的……

你嘴角忍不住翘起来。

就在这时，KakaoTalk弹出一条新消息。

未知联系人。

> 「今天辛苦了。妆造的事不用担心。」

屏幕上那行字像一颗石子扔进心里。你咬着嘴唇，指尖悬在键盘上方，停了整整三秒。`;
}
// 兼容旧存档：fallback 用一个无具体艺名的版本
const INIT_STORY = buildInitStory(null);

const INIT_CHOICES = [
    "心跳漏了一拍，还是故作镇定打出：「你…怎么会有我的号码？」",
    "装作若无其事，回了句「谢谢」，然后试探：「你是谁？」",
    "先不回复，截了图，默默观察他下一步"
];

function initFanEmotions() {
    const emotions = {};
    FANS.forEach(fan => { emotions[fan.id] = { affection: 30, trust: 40, obsession: 20, jealousy: 25, recentInteractions: [] }; });
    return emotions;
}

// === Game Juice helpers ===
function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch(e) { /* iOS Safari 不支持，静默 */ }
}
// 预设震动模式
const VIBE = {
    dmReceive: 40,
    heartUp: [30, 20, 30],
    riskUp: [80, 40, 80],
    crisis: [200, 100, 200, 100, 400],
    unlock: [60, 30, 60, 30, 100],
    softTap: 15,
};
// 音效 hook（留空，等接入音频资产）
const SFX_ENABLED = false;
const SFX_URLS = {
    dm: '', heartUp: '', risk: '', crisis: '', unlock: '', bgmCalm: '', bgmCrisis: ''
};
function playSFX(key) {
    if (!SFX_ENABLED || !SFX_URLS[key]) return;
    try { new Audio(SFX_URLS[key]).play().catch(()=>{}); } catch(e) {}
}

// ============================================================
// AI 输出净化器：兜底过滤 AI 偶尔违反 SYSTEM_PROMPT 的情况
// 把"主控"/"海后值"等系统术语强制替换为粉圈内能用的称呼
// ============================================================
function sanitizeAIText(text, char) {
    if (typeof text !== 'string' || !text) return text;
    const hasEnhypen = /enhypen/i.test(text);
    if (!text.includes('主控') && !text.includes('海后值') && !hasEnhypen) return text;
    const name = char?.artistName || char?.nickname || '她';
    // 各种"主控"组合都替换为艺名
    let cleaned = text
        .replace(/主控大人/g, name)
        .replace(/主控姐姐/g, name)
        .replace(/主控姐/g, name)
        .replace(/主控/g, name);
    // "海后值" → 用粉圈黑话代替
    cleaned = cleaned
        .replace(/海后值很?高/g, '心太大')
        .replace(/海后值\s*[:：]?\s*\d+/g, '时间管理大师')
        .replace(/海后值/g, '养鱼程度');
    // ⭐ 兜底：六位大粉不是偶像，AI 偶尔会把他们写成 "ENHYPEN"。
    // 标签(#ENHYPEN / #WhoIsNext) 直接删除，独立出现的组合名替换成中性的"应援团"
    cleaned = cleaned
        .replace(/#\s*enhypen/gi, '')
        .replace(/#\s*whoisnext/gi, '')
        .replace(/enhypen/gi, '应援团');
    return cleaned;
}

// 深度遍历对象/数组，对所有 string 字段做净化
function sanitizeAIResult(obj, char) {
    if (obj == null) return obj;
    if (typeof obj === 'string') return sanitizeAIText(obj, char);
    if (Array.isArray(obj)) return obj.map(item => sanitizeAIResult(item, char));
    if (typeof obj === 'object') {
        const cleaned = {};
        for (const k in obj) {
            cleaned[k] = sanitizeAIResult(obj[k], char);
        }
        return cleaned;
    }
    return obj;
}

async function callEdgeFunction(action, data) {
    // 45 秒超时：forum/comments 现在 max_tokens 更大，生成更完整也更耗时，给足余量；
    // DeepSeek 排队/边缘函数冷启动卡住时，超时返回错误而不是无限等待
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
        // 注入 userId 供后端 rate limiter 按用户识别
        const userId = window._ehpUserId || 'guest';
        const res = await fetch(FUNCTION_URL, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({ action, data: { ...(data || {}), userId } })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
        // 【兜底净化】AI 偶尔会违反 SYSTEM_PROMPT 输出"主控"/"海后值"
        // 在前端再扫一遍，强制替换为艺名/粉圈暗语
        const char = window._ehpCurrentChar;
        if (char) return sanitizeAIResult(payload, char);
        return payload;
    } catch(e) {
        console.error(e);
        const msg = e?.name === 'AbortError' ? '请求超时，请重试' : (e?.message || '网络错误');
        return { error: msg };
    } finally {
        clearTimeout(timer);
    }
}

function saveGameToSlot(slotId, data) {
    try {
        // 裁剪可能过长的字段，防止 localStorage 配额超限
        const trimmed = { ...data };
        if (trimmed.paidDmDaily?.thread?.length > 150) {
            trimmed.paidDmDaily = { ...trimmed.paidDmDaily, thread: trimmed.paidDmDaily.thread.slice(-100) };
        }
        if (trimmed.worldState?.length > 80) {
            trimmed.worldState = trimmed.worldState.slice(-60);
        }
        if (trimmed.history?.length > 30) {
            trimmed.history = trimmed.history.slice(-20);
        }
        localStorage.setItem(`ehp_v16_${slotId}`, JSON.stringify(trimmed));
        return { ok: true };
    } catch (e) {
        console.error('[saveGameToSlot] localStorage 写入失败:', e);
        // 配额超限或其他写入失败
        if (e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014)) {
            return { ok: false, reason: 'quota', message: '本地存档空间已满，请删除旧存档或导出后清理' };
        }
        return { ok: false, reason: 'unknown', message: e?.message || '本地存档写入失败' };
    }
}
function migrateSaveData(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    // 补齐 V17 → V18 可能缺失的字段，避免 undefined 显示和访问异常
    const data = { ...raw };
    // attrs 新增了 vocal/dance/rap/iq/eq
    if (data.attrs && typeof data.attrs === 'object') {
        data.attrs = {
            人气值: data.attrs.人气值 ?? 70,
            颜值: data.attrs.颜值 ?? 75,
            国民度: data.attrs.国民度 ?? 60,
            时尚度: data.attrs.时尚度 ?? 60,
            金钱值: data.attrs.金钱值 ?? 50,
            vocal: data.attrs.vocal ?? 70,
            dance: data.attrs.dance ?? 70,
            rap: data.attrs.rap ?? 60,
            iq: data.attrs.iq ?? 80,
            eq: data.attrs.eq ?? 75,
            ...data.attrs
        };
    }
    // V18 新增字段：补默认值
    if (data.suspicion === undefined) data.suspicion = 0;
    if (data.companyContract === undefined) data.companyContract = null;
    // 旧版本 companyContract 可能没有 signed 字段，导致管控惩罚不生效
    if (data.companyContract && typeof data.companyContract === 'object' && data.companyContract.signed === undefined) {
        data.companyContract = { ...data.companyContract, signed: true };
    }
    if (data.scheduleMap === undefined) data.scheduleMap = {};
    if (data.tiktokAlt === undefined) data.tiktokAlt = null;
    if (data.socialDynamics === undefined) data.socialDynamics = [];
    if (data.socialFeeds === undefined) data.socialFeeds = {};
    if (data.paidDmDaily === undefined || Array.isArray(data.paidDmDaily)) {
        data.paidDmDaily = { lastChatDate: null, messages: {}, thread: [] };
    }
    if (!data.paidDmDaily.thread) {
        data.paidDmDaily.thread = [];
    }
    if (data.coupleExposure === undefined) data.coupleExposure = null;
    // 【兜底】旧存档可能写入了"主控"字样的剧情文本，加载时清洗一遍
    if (data.char) {
        if (typeof data.currentStory === 'string') {
            data.currentStory = sanitizeAIText(data.currentStory, data.char);
        }
        if (Array.isArray(data.history)) {
            data.history = data.history.map(s => sanitizeAIText(s, data.char));
        }
        if (typeof data.storySummary === 'string') {
            data.storySummary = sanitizeAIText(data.storySummary, data.char);
        }
    }
    return data;
}
function loadGameFromSlot(slotId) {
    const d = safeLocalStorage.getItem(`ehp_v16_${slotId}`);
    if (!d) return null;
    try { return migrateSaveData(JSON.parse(d)); } catch(e) { return null; }
}
function deleteGameFromSlot(slotId) {
    safeLocalStorage.removeItem(`ehp_v16_${slotId}`);
    // 同时尝试删除云端存档（失败不阻塞）
    (async () => {
        try {
            const uid = await getCurrentUserId();
            if (uid) await supabaseClient.from('saves').delete().eq('user_id', uid).eq('slot_id', slotId);
        } catch(e) { /* ignore */ }
    })();
}

async function syncToCloud(slotId, data) {
    try {
        const uid = await getCurrentUserId();
        if (!uid) return false;
        await supabaseClient.from('saves').upsert({ user_id: uid, slot_id: slotId, game_data: data, updated_at: new Date() });
        return true;
    } catch(e) { return false; }
}

async function loadFromCloud(slotId) {
    try {
        const uid = await getCurrentUserId();
        if (!uid) return null;
        const query = supabaseClient.from('saves').select('game_data').eq('user_id', uid).eq('slot_id', slotId).maybeSingle();
        const { data } = await withTimeout(query, 6000, { data: null });
        return data?.game_data ? migrateSaveData(data.game_data) : null;
    } catch(e) { return null; }
}

// ==================== 存档导出 / 导入 ====================
function exportSaveToFile(slotId) {
    const data = loadGameFromSlot(slotId);
    if (!data) { alert('存档 ' + slotId + ' 没有数据，无法导出'); return; }
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const charName = data.char ? data.char.artistName || '角色' : '角色';
    const dayNum = data.day || 1;
    a.download = 'EHP_存档' + slotId + '_' + charName + '_第' + dayNum + '天.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importSaveFromFile(slotId, onSuccess) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = function(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(ev) {
            try {
                const parsed = JSON.parse(ev.target.result);
                if (!parsed.char || !parsed.day) {
                    alert('无效的存档文件，请选择正确的 EHP 存档 JSON');
                    return;
                }
                const r = saveGameToSlot(slotId, parsed);
                if (r.ok) {
                    const name = parsed.char.artistName || '未知角色';
                    alert('存档导入成功！存档 ' + slotId + ' 已覆盖为：' + name + ' 第' + parsed.day + '天');
                    if (onSuccess) onSuccess();
                } else {
                    alert('导入失败：' + r.message);
                }
            } catch(err) {
                alert('文件解析失败：' + (err.message || '格式错误'));
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function generateRandomSchedule(day) {
    const schedules = [
        { name: "回归打歌",素材:5,人气:3 }, { name: "综艺录制",素材:4,人气:4 },
        { name: "品牌站台",素材:3,人气:2 }, { name: "杂志拍摄",素材:4,人气:2 },
        { name: "粉丝签售",素材:3,人气:4 }, { name: "休息日",素材:1,人气:0 }
    ];
    return schedules[(day-1) % schedules.length];
}

// ============================================================
// 社交引擎：计数解析/格式化 + AI内容归一化 + 平台配置
// ============================================================
function parseCount(v) {
    if (typeof v === "number") return Math.round(v);
    if (!v) return Math.floor(Math.random() * 9000) + 500;
    const s = String(v).trim().replace(/[, ]/g, "");
    const m = s.match(/^([\d.]+)\s*([万kKmMwW]?)/);
    if (!m) return Math.floor(Math.random() * 9000) + 500;
    let n = parseFloat(m[1]);
    const u = m[2].toLowerCase();
    if (u === "k") n *= 1e3;
    else if (u === "m") n *= 1e6;
    else if (u === "万" || u === "w") n *= 1e4;
    return Math.round(n);
}
function formatCount(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
}
let _pid = 0;
// 六位大粉的 handle 列表，用于识别大粉发的帖子
const BIG_FAN_HANDLES = ["@Won_Jung_", "@JAYPARK_0420", "@JAKE_S", "@IceShP", "@KiMSunOo.O", "@Riki_",
    "梁祯元", "朴综星", "沈载伦", "朴成训", "金善禹", "西村力"];
function makePost(p) {
    const likes = parseCount(p.likes ?? p.views);
    const isFanPost = !!p.isFanPost || BIG_FAN_HANDLES.some(h => (p.author || "").includes(h.replace("@", "")));
    // 识别是哪位大粉
    const bigFanMatch = isFanPost ? FANS.find(f => (p.author || "").includes(f.name) || (p.author || "").includes(f.handle.replace("@",""))) : null;
    return {
        id: `p${Date.now()}_${_pid++}`,
        mine: !!p.mine,
        isFanPost,
        bigFan: bigFanMatch || null,
        author: p.author || p.user || "",
        content: p.content || p.title || "",
        title: p.title || "",
        media: p.media || null,
        likes,
        liked: false,
        commentsCount: p.comments != null ? parseCount(p.comments) : Math.max(3, Math.floor(likes / 30)),
        comments: null,
        time: p.time || "刚刚",
        type: p.type || "official"
    };
}
// 把后端 social 返回的不同形状归一化成统一 post 列表
function normalizeSocialResult(platform, r) {
    if (!r) return [];
    const arr = r.posts || r.tweets || r.videos || [];
    // ⭐ 过滤掉 AI 返回的空帖（没有正文/标题/媒体）——否则会渲染出只有点赞数和
    // "做数据"按钮、却没有任何文字的"幽灵帖"（微博/INS 里那种空白卡片）。
    return arr
        .map(makePost)
        .filter(p => p.mine || (p.content && p.content.trim()) || (p.title && p.title.trim()) || p.media);
}
// 平台配置：标题、是否可发帖、发帖类型、卡片样式、主控可发自拍/视频的媒体标签
const SOCIAL_CFG = {
    instagram: { title: "📷 Instagram", icon: "📷", canPost: true, kind: "自拍", media: "📸 自拍", card: "insta" },
    twitter:   { title: "𝕏 Twitter",    icon: "𝕏", canPost: true, kind: "推文", media: null,     card: "tweet" },
    tiktok:    { title: "🎵 TikTok",     icon: "🎵", canPost: true, kind: "视频", media: "🎬 视频", card: "tiktok" },
    youtube:   { title: "📺 YouTube",    icon: "📺", canPost: true, kind: "视频/Vlog", media: "🎬 视频", card: "youtube" },
    threads:   { title: "🧵 Threads",    icon: "🧵", canPost: false, card: "threads" },
    weverse:   { title: "🌐 Weverse",    icon: "🌐", canPost: true, kind: "动态", media: "📸 自拍", card: "weverse" },
    "cpost:weibo":  { title: "🌊 微博", icon: "🌊", canPost: true, kind: "微博", media: null, card: "cpost" },
    "cpost:douban": { title: "🥬 豆瓣", icon: "🥬", canPost: false, card: "cpost" },
    "jiefu:jiefu":      { title: "⚠️ 姐夫你别这样", icon: "⚠️", canPost: false, card: "jiefu" },
    "jiefu:jiefubing":  { title: "💊 有姐夫病没姐夫命", icon: "💊", canPost: false, card: "jiefu" }
};

// 单条帖子卡片（按平台样式渲染）+ 互动栏
function PostCard({ post, cfg, artistName, onOpen, onLike, onData }) {
    const card = cfg.card;
    const isBigFan = post.isFanPost && post.bigFan;
    const fanColor = post.bigFan?.color || "#a855f7";
    const initial = (post.mine ? (artistName || "我") : (post.author || "?"))[0];
    const name = post.mine ? `${artistName || "我"}Official` : (post.author || "粉丝");
    let body = null;
    if (card === "insta") {
        body = (<>
            <div className="insta-header">
                <div className="insta-avatar" style={isBigFan ? { background: fanColor } : {}}>{isBigFan ? post.bigFan.emoji : initial}</div>
                <div><div className="insta-name">{name}</div>{isBigFan && <div style={{ fontSize: 9, color: fanColor }}>💌 大粉账号</div>}</div>
            </div>
            {post.media && <div className="insta-image">{post.media}</div>}
            <div className="post-content">{post.content}</div>
        </>);
    } else if (card === "tweet") {
        body = (<>
            <div className="tweet-header">
                <div className="tweet-avatar" style={isBigFan ? { background: fanColor } : {}}>{isBigFan ? post.bigFan.emoji : initial}</div>
                <div><div className="tweet-name">{name}</div>{isBigFan && <div style={{ fontSize: 9, color: fanColor }}>💌 大粉账号</div>}</div>
            </div>
            <div className="post-content">{post.content}</div>
        </>);
    } else if (card === "tiktok") {
        body = (<div style={{ display: "flex", gap: 12 }}>
            <div className="tiktok-thumb" style={isBigFan ? { background: `linear-gradient(135deg, ${fanColor}33, #fdf4ff)`, fontSize: 28 } : {}}>{isBigFan ? post.bigFan.emoji : "🎬"}</div>
            <div style={{ flex: 1 }}>
                <div className="youtube-title">{post.title || post.content}</div>
                {isBigFan && <div style={{ fontSize: 9, color: fanColor, marginTop: 4 }}>💌 {post.bigFan.name}发布</div>}
            </div>
        </div>);
    } else if (card === "youtube") {
        body = (<>
            <div className="youtube-thumb">{isBigFan ? post.bigFan.emoji : "🎬"} {post.media || "视频"}</div>
            <div className="youtube-title">{post.title || post.content}</div>
            {isBigFan && <div style={{ fontSize: 9, color: fanColor, marginTop: 4 }}>💌 {post.bigFan.name}发布</div>}
        </>);
    } else if (card === "threads") {
        body = (<>
            <div className="threads-header"><div className="threads-avatar">🤬</div><div className="threads-name">{post.author || "辱追"}</div></div>
            <div className="threads-content">{post.content}</div>
        </>);
    } else if (card === "cpost") {
        body = (<>
            {post.title && <div className="cpost-title">{post.title}</div>}
            <div className="cpost-content">{post.content}</div>
        </>);
    } else if (card === "jiefu") {
        body = (<>
            {post.title && <div className="jiefu-title">{post.title}</div>}
            <div className="jiefu-content">{post.content}</div>
        </>);
    } else { // weverse
        body = (<>
            <div className="post-author">
                <div className="post-avatar" style={isBigFan ? { background: fanColor } : {}}>{isBigFan ? post.bigFan.emoji : initial}</div>
                <div><div className="post-name">{name}</div><div className="post-time">{post.time}{isBigFan && <span style={{ color: fanColor, marginLeft: 8 }}>💌 大粉</span>}</div></div>
            </div>
            {post.media && <div className="insta-image">{post.media}</div>}
            <div className="post-content">{post.content}</div>
        </>);
    }
    const wrapClass = card === "insta" ? "insta-post" : card === "tweet" ? "tweet" : card === "tiktok" ? "tiktok-video" : card === "youtube" ? "youtube-video" : card === "threads" ? "threads-post" : card === "cpost" ? "cpost" : card === "jiefu" ? "jiefu-post" : "weverse-post";
    return (
        <div className={wrapClass} style={
            post.mine ? { border: "1px solid rgba(225,29,72,0.4)" } :
            isBigFan ? { border: `1px solid ${fanColor}44`, background: `linear-gradient(180deg, ${fanColor}08, transparent)` } : {}
        }>
            {post.mine && <div style={{ fontSize: 10, color: "#d946a8", marginBottom: 6 }}>● 我发布的</div>}
            {isBigFan && !post.mine && <div style={{ fontSize: 10, color: fanColor, marginBottom: 6 }}>✦ 大粉账号 · {post.bigFan.type}</div>}
            {body}
            <div className="feed-actions">
                <button className="feed-act" onClick={() => onLike(post.id)} style={post.liked ? { color: "#d946a8" } : {}}>{post.liked ? "❤️" : "🤍"} {formatCount(post.likes)}</button>
                <button className="feed-act" onClick={() => onOpen(post)}>💬 {formatCount(post.commentsCount)}</button>
                <button className="feed-act" onClick={() => onData(post.id)}>📊 做数据</button>
            </div>
        </div>
    );
}

// ⭐ 过滤弱模型返回的空弹幕/重复弹幕：text 为空的直接丢（治直播里反复出现的
// "空名"——只有用户名没正文的那种），并去掉同一批里完全重复的条目，顺手 trim。
function cleanDanmakuList(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const c of list) {
        const text = (c?.text ?? "").toString().trim();
        if (!text) continue;
        const user = (c?.user ?? "").toString().trim();
        const key = `${user}|${text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...c, text, user });
    }
    return out;
}

// 发帖器
// ============================================================
// 直播组件（独立，避免 renderModal 里 Hooks 违规）
// ============================================================
function LiveModal({ char, seaLevel, currentRisk, fandomHeat, antiCount, coupleExposure,
    liveMessages, setLiveMessages, liveActive, setLiveActive,
    hearts, updateHearts, updateRisk, addWorldState, triggerSocialDynamic,
    onClose }) {
    const [liveTopic, setLiveTopic] = React.useState("");
    const [liveStarted, setLiveStarted] = React.useState(false);
    const [viewerCount, setViewerCount] = React.useState(Math.floor(Math.random() * 50000) + 10000);
    const [livePlatform, setLivePlatform] = React.useState("Weverse");
    const [selectedDanmaku, setSelectedDanmaku] = React.useState(null);
    const [liveInput, setLiveInput] = React.useState(""); // ⭐ 受控输入框，支持"回复某条弹幕"模式
    const liveInputRef = React.useRef(null);
    const [livePhase, setLivePhase] = React.useState(0); // 0:起始 1:高潮 2:尾声
    const msgEndRef = React.useRef(null);
    // 弹幕缓冲区：一次请求的弹幕不全部显示，而是每隔1.5s逐条滚出
    // 弹幕缓冲区：一次请求的弹幕不全部显示，而是每隔1.5s逐条滚出
    const danmakuBufferRef = React.useRef([]);
    const drippingRef = React.useRef(false);
    const liveTopicRef = React.useRef(liveTopic);
    const liveContextRef = React.useRef({ seaLevel, currentRisk, fandomHeat, antiCount });
    const livePhaseRef = React.useRef(0);
    // ⭐ 记录玩家最近一次直播发言（30秒内有效），让后台批量拉的弹幕也能呼应
    const lastPlayerSpeechRef = React.useRef(null);

    React.useEffect(() => { liveTopicRef.current = liveTopic; }, [liveTopic]);
    React.useEffect(() => { liveContextRef.current = { seaLevel, currentRisk, fandomHeat, antiCount }; }, [seaLevel, currentRisk, fandomHeat, antiCount]);
    React.useEffect(() => { livePhaseRef.current = livePhase; }, [livePhase]);
    React.useEffect(() => { msgEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [liveMessages]);

    // 观众数波动
    React.useEffect(() => {
        if (!liveStarted) return;
        const t = setInterval(() => setViewerCount(v => Math.max(1000, v + Math.floor((Math.random() - 0.3) * 2000))), 4000);
        return () => clearInterval(t);
    }, [liveStarted]);

    // 逐条滴落弹幕（每条间隔1.2~2.5s，更真实）
    const startDrip = React.useCallback(() => {
        if (drippingRef.current) return;
        drippingRef.current = true;
        const drip = () => {
            const buf = danmakuBufferRef.current;
            if (buf.length === 0) { drippingRef.current = false; return; }
            const msg = buf.shift();
            setLiveMessages(prev => [...prev, { ...msg, time: new Date().toLocaleTimeString() }].slice(-60));
            // ⭐ 玩家触发的高优先级弹幕快速滚出（0.3~0.6s），普通后台弹幕维持自然节奏（1.2~2.5s）
            const delay = msg?._priority ? (300 + Math.random() * 300) : (1200 + Math.random() * 1300);
            setTimeout(drip, delay);
        };
        drip();
    }, [setLiveMessages]);

    // 后台定时批量拉弹幕，补充buffer（每18秒一批）
    React.useEffect(() => {
        if (!liveStarted) return;
        const fetchBatch = async (phaseHint) => {
            const ctx = liveContextRef.current;
            const topic = liveTopicRef.current;
            const phase = livePhaseRef.current;
            const phaseLabel = phase === 0 ? "开播暖场" : phase === 1 ? "直播高潮互动" : "下播前最后互动";
            // ⭐ 取最近30秒内玩家说过的话；如果有，则让本批弹幕呼应它
            const lastSpeech = lastPlayerSpeechRef.current;
            const isFresh = lastSpeech && (Date.now() - lastSpeech.time < 30000);
            const liveContextPayload = {
                topic: `${topic}·${phaseHint || phaseLabel}`,
                platform: livePlatform,
                ...(isFresh ? {
                    playerSpeech: lastSpeech.text,
                    instruction: `主播刚刚说过：「${lastSpeech.text}」。本批新弹幕中至少有 4 条必须直接呼应/接梗/反应这句话的具体内容，不要泛泛而谈。`
                } : {})
            };
            try {
                const result = await callEdgeFunction('live', {
                    gameContext: { seaLevel: ctx.seaLevel, riskLevel: ctx.currentRisk, fandomHeat: ctx.fandomHeat, antiCount: ctx.antiCount, artistName: char?.artistName, nickname: char?.nickname },
                    liveContext: liveContextPayload
                });
                const clean = cleanDanmakuList(result.comments);  // ⭐ 丢空弹幕/重复
                if (clean.length) {
                    danmakuBufferRef.current.push(...clean);
                    startDrip();
                } else {
                    // ✅ 服务器/网络错误或全是空弹幕：放一条占位，避免永远停在"弹幕加载中…"
                    danmakuBufferRef.current.push({ user: "💬", text: "（弹幕加载有点慢，稍等一下~）", type: "fan" });
                    startDrip();
                }
            } catch(e) {
                console.error('[live]批量拉弹幕失败', e);
                // ✅ 异常兜底：同样放占位弹幕
                danmakuBufferRef.current.push({ user: "💬", text: "（弹幕加载有点慢，稍等一下~）", type: "fan" });
                startDrip();
            }
        };
        // 开播立刻拉一批
        fetchBatch("开播");
        // 每18s自动续一批（先更新phase，让ref同步，再拉弹幕）
        const t = setInterval(() => {
            setLivePhase(p => {
                const next = Math.min(p + 1, 2);
                livePhaseRef.current = next; // 立即同步ref，确保fetchBatch读到最新值
                return next;
            });
            // 用 setTimeout(0) 确保 livePhaseRef 已更新
            setTimeout(() => fetchBatch(), 0);
        }, 18000);
        return () => clearInterval(t);
    }, [liveStarted, livePlatform, startDrip]);

    const startLive = async () => {
        if (!liveTopic.trim()) { alert("先填直播主题~"); return; }
        setLiveStarted(true);
        setLiveActive(true);
        setLivePhase(0);
        danmakuBufferRef.current = [];
        // ⭐ 立即塞几条进场弹幕，避免开播瞬间一直停在"弹幕加载中…"（AI首批要几秒）
        const seedName = char?.artistName || char?.nickname || "主播";
        danmakuBufferRef.current.push(
            { user: "달려가는중", text: "冲！到了到了～", type: "fan", _priority: true },
            { user: "想你的粉", text: `${seedName}开播啦！等你好久了😭`, type: "fan", _priority: true },
            { user: "新粉报道", text: "第一次蹲直播，好紧张", type: "passerby", _priority: true }
        );
        startDrip();
        addWorldState(`在${livePlatform}开了直播：${liveTopic.slice(0, 30)}`);
    };

    const endLive = () => {
        // 只有直播时背景有情侣款物品 or 随机5%"被人识破位置"才增加风险
        const hasExposure = !!coupleExposure;
        const randomBusted = Math.random() < 0.05;
        if (hasExposure || randomBusted) {
            updateRisk(hasExposure ? 2 : 1);
        }
        setLiveActive(false);
        addWorldState(`直播结束，在线${formatCount(viewerCount)}人`);
        triggerSocialDynamic(`在${livePlatform}直播了「${liveTopic}」，在线人数${formatCount(viewerCount)}`);
        setTimeout(() => { onClose(); setLiveMessages([]); }, 800);
    };

    // ⭐ 点击弹幕 = 选它作为"回复目标"。关键修复：不再 4 秒后自动消失，
    // 而是一直保持选中，直到玩家发出回复或手动取消。心动值改到"真正回复时"再加。
    const selectDanmaku = (msg) => {
        setSelectedDanmaku(msg);
        addWorldState(`直播时翻到了${msg.user}的弹幕`);
        if (currentRisk >= 5 && (msg.text.includes("背景") || msg.text.includes("位置"))) updateRisk(1);
        // 选中后自动聚焦输入框，方便直接打字回复
        setTimeout(() => liveInputRef.current?.focus(), 50);
    };
    const cancelReply = () => setSelectedDanmaku(null);

    const getBigFanColor = (msg) => {
        // ⭐ 关键修复：先按用户名/handle 直接匹配大粉。弱模型经常只把 user 填成
        // "梁祯元"，却漏了 type/fanId/color 这几个字段——旧逻辑会因此 return null，
        // 导致一屋子大粉里只有恰好填全字段的那一个被标注（"只有男主被标大粉"）。
        const fan = FANS.find(f =>
            f.id === msg.fanId ||
            (msg.user && (msg.user.includes(f.name) || msg.user.includes(f.handle.replace("@", "")))));
        if (fan) return fan.color;
        // 没匹配到具体人，但模型显式标了 big_fan / 给了颜色，也按大粉处理
        if (msg.type === "big_fan" || msg.color) return msg.color || "#a855f7";
        return null;
    };

    // ✅ 防重入 ref：玩家连续快速发言时只保留最新一次请求
    const fetchingDanmakuRef = React.useRef(false);

    // isSpeech=true 时传 playerSpeech，false 时传 playerAction
    // isSpeech=true 时传 playerSpeech，false 时传 playerAction
    const fetchMoreDanmaku = async (action, isSpeech = false, replyTarget = null) => {
        addWorldState(`直播中${replyTarget ? `回复${replyTarget.user}：` : isSpeech ? "说：" : ""}${action.slice(0, 30)}`);
        // ⭐ 玩家说话时，记录到 ref，让后台批量拉的也能用上
        if (isSpeech) {
            lastPlayerSpeechRef.current = { text: action, time: Date.now() };
        }
        // ⭐ 真正"回复了某条大粉弹幕" → 该大粉心动 +3（从原来"点一下就加"挪到这里，更合理也更难刷）
        // ✅ 防重入：如果上一次请求还没回来，跳过（不阻塞直播体验）
        if (fetchingDanmakuRef.current) return;
        fetchingDanmakuRef.current = true;
        if (replyTarget?.fanId) updateHearts({ [replyTarget.fanId]: 3 });
        // 取最近8条弹幕做上下文
        const recentDanmaku = liveMessages.slice(-8).map(m => ({ user: m.user, text: m.text }));
        const liveContextPayload = {
            topic: `${liveTopic}·${replyTarget ? "主播回复弹幕" : isSpeech ? "主播刚开口说话" : action}`,
            platform: livePlatform,
            recentDanmaku,
            // ⭐ 回复某条弹幕时把被回复的弹幕带给后端，让被回复者狂喜、其他人羡慕起哄
            ...(replyTarget ? {
                replyTo: {
                    user: replyTarget.user,
                    text: replyTarget.text,
                    isBigFan: replyTarget.type === "big_fan" || !!replyTarget.fanId,
                    fanId: replyTarget.fanId || ""
                }
            } : {}),
            ...(isSpeech
                ? {
                    playerSpeech: action,
                    // ⭐ 强约束：必须直接回应主播刚说的话
                    instruction: replyTarget
                        ? `主播（${char?.artistName || "本人"}）在直播间公开回复了【${replyTarget.user}】的弹幕「${replyTarget.text}」，并对TA说：「${action}」。请让【${replyTarget.user}】本人激动回应，其余粉丝羡慕起哄。`
                        : `主播（${char?.artistName || "本人"}）刚刚开口说：「${action}」。生成的弹幕里至少有 5 条必须直接回应这句话的具体内容（接梗、反应、追问、起哄、共情等），不要写跟这句话无关的通用弹幕。`
                }
                : {
                    playerAction: action,
                    instruction: `主播刚刚做了「${action}」这个动作/互动，新弹幕要紧贴这个具体行为生成反应。`
                }
            )
        };
        try {
            const result = await callEdgeFunction('live', {
                gameContext: { seaLevel, riskLevel: currentRisk, fandomHeat, antiCount, artistName: char?.artistName, nickname: char?.nickname },
                liveContext: liveContextPayload
            });
            const clean = cleanDanmakuList(result.comments);  // ⭐ 丢空弹幕/重复
            if (clean.length) {
                // ⭐ 玩家刚说话/做动作触发的弹幕：插到缓冲队列最前面，并打上 _priority 标记，
                // 否则会排在后台批量拉的十几条后面，要等 15-25 秒才滚出来（体感"说了话没人理"）。
                danmakuBufferRef.current.unshift(...clean.map(c => ({ ...c, _priority: true })));
                startDrip();
            } else {
                // ✅ API 返回但评论为空时：给一条占位弹幕，避免"说了话没人理"
                danmakuBufferRef.current.unshift({ user: "💬", text: "（弹幕涌入中...）", type: "fan", _priority: true });
                startDrip();
            }
        } catch(e) {
            console.error('[fetchMoreDanmaku] 失败:', e);
            // ✅ 网络失败时给一条友好提示弹幕，而不是静默卡住
            danmakuBufferRef.current.unshift({ user: "💬", text: "（弹幕加载中，稍等一下~）", type: "fan", _priority: true });
            startDrip();
        } finally {
            fetchingDanmakuRef.current = false;
        }
    };

    // ⭐ 统一的"发言/回复"入口：受控输入框 + 是否在回复某条弹幕
    const sendLiveReply = () => {
        const txt = liveInput.trim();
        if (!txt) return;
        const target = selectedDanmaku; // 若选中了某条弹幕，则这条发言是"回复它"
        // 1) 立即把主播发言显示成右侧气泡；回复时带上被回复的弹幕（气泡里显示引用）
        setLiveMessages(prev => [...prev, {
            user: char?.artistName || "主播",
            text: txt,
            type: "host",
            isHost: true,
            ...(target ? { replyTo: { user: target.user, text: target.text } } : {}),
            time: new Date().toLocaleTimeString()
        }].slice(-60));
        // 2) 通知后端生成响应弹幕（把回复目标一起传过去）
        fetchMoreDanmaku(txt, true, target || null);
        // 3) 清空输入框 + 退出回复模式
        setLiveInput("");
        setSelectedDanmaku(null);
    };

    if (!liveStarted) {
        return (
            <div className="modal-overlay" onClick={onClose}>
                <div className="modal-content" onClick={e => e.stopPropagation()}>
                    <div className="modal-header"><h3>🎥 Weverse 直播</h3><button className="modal-close" onClick={onClose}>×</button></div>
                    <div style={{ padding: 16 }}>
                        <div style={{ background: "rgba(225,29,72,0.08)", borderRadius: 12, padding: 10, marginBottom: 12, fontSize: 11, color: "#9d6db8" }}>
                            📡 直播平台：<span style={{ color: "#d946a8", fontWeight: "bold" }}>Weverse LIVE</span>（直播仅支持Weverse）
                        </div>
                        <div style={{ color: "#9d6db8", fontSize: 12, marginBottom: 8 }}>直播主题</div>
                        <input placeholder="例：安利新专辑 / Q&A / 吃播 / 后台日常..." value={liveTopic} onChange={e => setLiveTopic(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && startLive()} style={{ marginBottom: 12 }} />
                        <div style={{ background: "rgba(225,29,72,0.08)", borderRadius: 12, padding: 10, marginBottom: 16, fontSize: 11, color: "#f87171", lineHeight: 1.6 }}>
                            ⚠️ 大粉可能从弹幕里发现恋爱痕迹（背景/物品），风险会上升。<br/>
                            💡 直播中点任意弹幕选中 → 在输入框打字即可「回复TA」，被回复的粉丝会激动回应、其他人羡慕起哄（回复大粉心动+3）
                        </div>
                        <button className="btn-primary" style={{ width: "100%" }} onClick={startLive}>🔴 开始直播</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="modal-overlay">
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ height: "90vh", display: "flex", flexDirection: "column" }}>
                {/* 直播头部 */}
                <div style={{ background: "linear-gradient(135deg, #ec4899, #a855f7)", padding: "12px 16px", borderBottom: "1px solid rgba(217,70,168,0.12)", flexShrink: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#d946a8", animation: "pulse 1s infinite" }}></div>
                            <span style={{ color: "white", fontWeight: "bold", fontSize: 14 }}>LIVE · {livePlatform}</span>
                            <span style={{ color: "#b88dc7", fontSize: 11 }}>👁 {formatCount(viewerCount)}</span>
                        </div>
                        <button style={{ background: "#9d6db8", color: "white", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: 11, cursor: "pointer" }} onClick={endLive}>下播</button>
                    </div>
                    <div style={{ color: "#9d6db8", fontSize: 11, marginTop: 4 }}>
                        「{liveTopic}」{coupleExposure && <span style={{ color: "#f87171", marginLeft: 8 }}>⚠️ 情侣款物品在背景里</span>}
                    </div>
                </div>

                {/* 回复提示条：选中弹幕后常驻，直到发出回复或点 × 取消 */}
                {selectedDanmaku && (
                    <div style={{ background: "rgba(217,70,168,0.12)", border: "1px solid #d946a8", padding: "8px 16px", flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 10, color: "#9d6db8" }}>
                                ✍️ 正在回复 {selectedDanmaku.type === "big_fan" || selectedDanmaku.fanId ? "💌 大粉（回复后心动+3）" : "这条弹幕"} · 在下方输入框打字回复
                            </div>
                            <div style={{ color: "#4a1d5a", fontSize: 12, marginTop: 2, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>「{selectedDanmaku.text}」— {selectedDanmaku.user}</div>
                        </div>
                        <button onClick={cancelReply} style={{ flexShrink: 0, background: "rgba(217,70,168,0.18)", color: "#9d2b73", border: "none", borderRadius: 14, width: 26, height: 26, fontSize: 15, lineHeight: "26px", cursor: "pointer", padding: 0 }} aria-label="取消回复">×</button>
                    </div>
                )}

                {/* 弹幕区 */}
                <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", background: "linear-gradient(180deg, #fdf4ff, #fce7f3)" }}>
                    {liveMessages.map((msg, i) => {
                        const isHost = msg.isHost || msg.type === "host";
                        // ⭐ 双保险：任何漏网的空文本弹幕（非主播）一律不渲染
                        if (!isHost && !(msg.text && String(msg.text).trim())) return null;
                        const bigFanColor = !isHost ? getBigFanColor(msg) : null;
                        const isBigFan = !!bigFanColor;
                        const fanObj = isBigFan ? FANS.find(f => f.id === msg.fanId || msg.user.includes(f.name)) : null;
                        if (isHost) {
                            // 主播自己说的话：右对齐粉紫渐变气泡，不可被点击回应
                            return (
                                <div key={i} style={{ padding: "5px 0", display: "flex", justifyContent: "flex-end" }}>
                                    <div style={{ maxWidth: "75%", background: "linear-gradient(135deg,#ec4899,#a855f7)", borderRadius: "16px 4px 16px 16px", padding: "6px 12px" }}>
                                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.7)", marginBottom: 2 }}>🎙️ {msg.user} · 主播</div>
                                        {msg.replyTo && (
                                            <div style={{ background: "rgba(255,255,255,0.18)", borderLeft: "2px solid rgba(255,255,255,0.7)", borderRadius: 6, padding: "3px 7px", marginBottom: 4 }}>
                                                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.95)", fontWeight: 600 }}>↪ 回复 {msg.replyTo.user}：</span>
                                                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.8)" }}> {String(msg.replyTo.text).slice(0, 24)}{String(msg.replyTo.text).length > 24 ? "…" : ""}</span>
                                            </div>
                                        )}
                                        <div style={{ color: "white", fontSize: 12, lineHeight: 1.5 }}>{msg.text}</div>
                                    </div>
                                </div>
                            );
                        }
                        return (
                            <div key={i} onClick={() => selectDanmaku(msg)} style={{ padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 6, background: selectedDanmaku && selectedDanmaku.text === msg.text && selectedDanmaku.user === msg.user ? "rgba(217,70,168,0.12)" : "transparent", borderRadius: 8 }}>
                                {isBigFan && <span style={{ fontSize: 13, flexShrink: 0 }}>{fanObj?.emoji || "💌"}</span>}
                                <div>
                                    <span style={{ fontWeight: "bold", fontSize: 11, color: isBigFan ? bigFanColor : (msg.type === "blackfan" ? "#f87171" : "#b88dc7") }}>
                                        {msg.user}
                                        {isBigFan && <span style={{ fontSize: 9, marginLeft: 4, background: bigFanColor + "22", padding: "1px 4px", borderRadius: 6 }}>大粉</span>}
                                    </span>
                                    {/* 修复：大粉弹幕文字色由 "white"（白底不可见）改为深紫 */}
                                    <span style={{ fontSize: 12, color: isBigFan ? "#3a1050" : (msg.type === "blackfan" ? "#f9a8d4" : "#6b3d7e"), marginLeft: 6, lineHeight: 1.5 }}>
                                        {msg.text}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                    <div ref={msgEndRef} />
                    {liveMessages.length === 0 && <div style={{ color: "#9d6db8", textAlign: "center", padding: 20, fontSize: 12 }}>弹幕加载中...</div>}
                </div>

                {/* 快捷操作 + 发言/回复输入框 */}
                <div style={{ padding: "10px 16px", background: "#ffffff", borderTop: "1px solid rgba(217,70,168,0.1)", flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: "#b88dc7", marginBottom: 8 }}>
                        {selectedDanmaku ? "💞 点击弹幕选中后，在这里打字就是「回复TA」——被回复的粉丝会激动回应" : "点弹幕可回复 TA · 点按钮触发互动 · 输入框说话会实时触发弹幕回应"}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                        {["😊 聊日常", "🎤 唱一首", "💃 跳一段", "👀 偷看私信", "😴 要去睡了"].map(a => (
                            <button key={a} className="btn-secondary" style={{ fontSize: 10, padding: "4px 8px" }} onClick={() => fetchMoreDanmaku(a, false)}>{a}</button>
                        ))}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                        <input ref={liveInputRef} value={liveInput}
                            placeholder={selectedDanmaku ? `回复 @${selectedDanmaku.user}...` : "对粉丝说点什么..."}
                            style={{ flex: 1, background: "#ffffff", border: selectedDanmaku ? "1px solid #d946a8" : "1px solid #f3d5ed", borderRadius: 20, padding: "8px 14px", color: "#4a1d5a", fontSize: 13 }}
                            onChange={e => setLiveInput(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); sendLiveReply(); } }} />
                        <button className="btn-primary" style={{ padding: "8px 16px", fontSize: 12 }} onClick={sendLiveReply}>
                            {selectedDanmaku ? "回复" : "说"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function PostComposerModal({ cfg, onClose, onPublish }) {
    const [text, setText] = React.useState("");
    const [withMedia, setWithMedia] = React.useState(false);
    if (!cfg) return null;
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header"><h3>✍️ 发布到 {cfg.title}</h3><button className="modal-close" onClick={onClose}>×</button></div>
                <div style={{ padding: 16 }}>
                    <textarea rows={4} autoFocus placeholder={`发一条${cfg.kind || "动态"}...`} value={text} onChange={e => setText(e.target.value)} style={{ width: "100%", background: "#ffffff", border: "1px solid #f3d5ed", borderRadius: 16, padding: 12, color: "#4a1d5a", marginBottom: 12 }} />
                    {cfg.media && (
                        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#9d6db8", fontSize: 13, marginBottom: 12, cursor: "pointer" }}>
                            <input type="checkbox" checked={withMedia} onChange={e => setWithMedia(e.target.checked)} style={{ width: "auto", margin: 0 }} />
                            附带 {cfg.media}（恋爱后小心情侣款出镜风险）
                        </label>
                    )}
                    <button className="btn-primary" style={{ width: "100%" }} onClick={() => { if (text.trim()) onPublish(text.trim(), withMedia ? cfg.media : null); else alert("请输入内容"); }}>✨ 发布</button>
                </div>
            </div>
        </div>
    );
}

// 评论区（点开帖子）
function CommentSheetModal({ post, cfg, loading, onClose, onLike, onRetry }) {
    if (!post) return null;
    const comments = post.comments || [];
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ height: "80vh" }}>
                <div className="modal-header"><h3>💬 {cfg?.icon} 评论区</h3><button className="modal-close" onClick={onClose}>×</button></div>
                <div style={{ padding: 16, overflowY: "auto" }}>
                    <div style={{ background: "#fdf4ff", borderRadius: 14, padding: 12, marginBottom: 12 }}>
                        <div style={{ color: "#4a1d5a", fontSize: 14 }}>{post.title || post.content}</div>
                        <div style={{ color: "#b88dc7", fontSize: 11, marginTop: 6 }}>
                            <span style={{ color: post.liked ? "#d946a8" : "#b88dc7", cursor: "pointer" }} onClick={() => onLike(post.id)}>{post.liked ? "❤️" : "🤍"} {formatCount(post.likes)}</span>
                            <span style={{ marginLeft: 16 }}>💬 {formatCount(post.commentsCount)}</span>
                        </div>
                    </div>
                    {loading && <div className="loading-spinner"><div className="spinner"></div><div>加载评论中...</div></div>}
                    {!loading && comments.length === 0 && (
                        <div style={{ color: "#b88dc7", textAlign: "center", padding: 20 }}>
                            <div style={{ marginBottom: 12 }}>评论还没刷出来～</div>
                            {onRetry && <button className="btn-primary" style={{ padding: "6px 18px", fontSize: 12 }} onClick={onRetry}>🔄 重新加载评论</button>}
                        </div>
                    )}
                    {comments.map((c, i) => (
                        <div key={i} className="comment-item">
                            <div className="comment-user" style={{ color: c.type === "blackfan" ? "#f472b6" : c.type === "big_fan" ? "#a855f7" : c.type === "teammate_fan" ? "#a78bfa" : c.type === "water_army" ? "#b88dc7" : "#6b3d7e" }}>
                                {c.floor ? `${c.floor}F ` : ""}{c.user}{c.type === "big_fan" && " 💌"}
                            </div>
                            <div className="comment-text">{c.text}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}


// ============================================================
// 关系图谱组件
// ============================================================
function RelationGraph({ fans, hearts, onSelectFan }) {
    const canvasRef = React.useRef(null);
    
    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const width = canvas.parentElement.clientWidth;
        const height = 340;
        canvas.width = width;
        canvas.height = height;
        
        const centerX = width / 2;
        const centerY = height / 2;
        const radius = Math.min(width, height) * 0.32;
        
        ctx.clearRect(0, 0, width, height);
        
        // 中心圆（主控）
        ctx.beginPath();
        ctx.arc(centerX, centerY, 28, 0, Math.PI * 2);
        ctx.fillStyle = '#d946a8';
        ctx.fill();
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'white';
        ctx.font = 'bold 14px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('你', centerX, centerY);
        
        const angleStep = (Math.PI * 2) / fans.length;
        fans.forEach((fan, i) => {
            const angle = i * angleStep - Math.PI / 2;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            const heartValue = hearts[fan.id] || 30;
            
            // 连线
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(x, y);
            ctx.strokeStyle = `rgba(217,70,168,${0.2 + heartValue / 200})`;
            ctx.lineWidth = 1 + heartValue / 100;
            ctx.stroke();
            
            // 连线上的数值
            const midX = (centerX + x) / 2;
            const midY = (centerY + y) / 2;
            ctx.fillStyle = '#a855f7';
            ctx.font = '10px system-ui';
            ctx.fillText(heartValue, midX, midY - 5);
            
            // 大粉节点
            ctx.beginPath();
            ctx.arc(x, y, 24, 0, Math.PI * 2);
            ctx.fillStyle = fan.color + '33';
            ctx.fill();
            ctx.strokeStyle = fan.color;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = 'white';
            ctx.font = '20px system-ui';
            ctx.fillText(fan.emoji, x, y);
            ctx.fillStyle = '#4a1d5a';
            ctx.font = '10px system-ui';
            ctx.fillText(fan.name, x, y + 28);
        });
        
        // 点击交互
        const handleClick = (e) => {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const mouseX = (e.clientX - rect.left) * scaleX;
            const mouseY = (e.clientY - rect.top) * scaleY;
            
            fans.forEach((fan, i) => {
                const angle = i * angleStep - Math.PI / 2;
                const x = centerX + radius * Math.cos(angle);
                const y = centerY + radius * Math.sin(angle);
                const dx = mouseX - x;
                const dy = mouseY - y;
                if (Math.sqrt(dx * dx + dy * dy) < 28) onSelectFan(fan);
            });
        };
        
        canvas.addEventListener('click', handleClick);
        return () => canvas.removeEventListener('click', handleClick);
    }, [fans, hearts]);
    
    return <canvas ref={canvasRef} style={{ width: '100%', height: '340px' }} />;
}

// ============================================================
// 主游戏组件
// ============================================================
function GameApp({ slotId, initialData, onBack }) {
    // 主线摘要与送礼目标（history 在下方原有状态区统一声明，避免重复）
    const [storySummary, setStorySummary] = React.useState(initialData.storySummary || "");
    const [selectedGiftFan, setSelectedGiftFan] = React.useState(null);
    // 角色信息
    const [char] = React.useState(initialData.char);
    const [teammates] = React.useState(initialData.teammates);
    // 把 char 挂到 window 上，供 callEdgeFunction 兜底净化器使用
    React.useEffect(() => { window._ehpCurrentChar = char; }, [char]);
    const [day, setDay] = React.useState(initialData.day || 1);
    
    // 大粉系统
    const [hearts, setHearts] = React.useState(initialData.hearts);
    const [unlocked, setUnlocked] = React.useState(initialData.unlocked || []);
    const [fanEmotions, setFanEmotions] = React.useState(initialData.fanEmotions || initFanEmotions());
    const [dmReadStatus, setDmReadStatus] = React.useState(initialData.dmReadStatus || {});
    const [dmHistories, setDmHistories] = React.useState(initialData.dmHistories || {});
    
    // 世界状态
    const [seaLevel, setSeaLevel] = React.useState(initialData.seaLevel || 0);
    const [currentRisk, setCurrentRisk] = React.useState(initialData.currentRisk || 0);
    const [suspicion, setSuspicion] = React.useState(initialData.suspicion || 0); // 粉丝疑虑值（0-10），疑虑>=5时下次失误触发真实风险
    // 【同回合 risk 累积上限】一个回合内（一段剧情期间）最多累积 +3 风险，防止多触发点叠加暴毙
    const riskTurnAccumRef = React.useRef(0);
    const RISK_TURN_CAP = 3;
    const [fandomHeat, setFandomHeat] = React.useState(initialData.fandomHeat || 65);
    const [antiCount, setAntiCount] = React.useState(initialData.antiCount || 30);
    const [money, setMoney] = React.useState(initialData.money || 45);
    const [companyFavor, setCompanyFavor] = React.useState(initialData.companyFavor || 60);
    const [companyContract, setCompanyContract] = React.useState(initialData.companyContract || null); // 不平等条约
    
    // 完整属性系统
    const [attrs, setAttrs] = React.useState(initialData.attrs || {
        人气值: Math.floor(Math.random() * 31) + 65,
        颜值: Math.floor(Math.random() * 29) + 70,
        国民度: Math.floor(Math.random() * 41) + 50,
        时尚度: Math.floor(Math.random() * 48) + 45,
        金钱值: Math.floor(Math.random() * 56) + 30,
        vocal: Math.floor(Math.random() * 31) + 60,
        dance: Math.floor(Math.random() * 31) + 60,
        rap: Math.floor(Math.random() * 31) + 50,
        iq: Math.floor(Math.random() * 21) + 75,
        eq: Math.floor(Math.random() * 21) + 70
    });
    
    // 剧情状态
    const [currentStory, setCurrentStory] = React.useState(initialData.currentStory || INIT_STORY);
    const [currentChoices, setCurrentChoices] = React.useState(initialData.currentChoices || INIT_CHOICES);
    const [history, setHistory] = React.useState(initialData.history || []);
    const [schedules, setSchedules] = React.useState(initialData.schedules || {});
    const [scheduleMap, setScheduleMap] = React.useState(initialData.scheduleMap || {}); // 每天实际行程记录
    const [currentSchedule, setCurrentSchedule] = React.useState(initialData.currentSchedule || generateRandomSchedule(1));
    const [activeEvents, setActiveEvents] = React.useState(initialData.activeEvents || []);
    const [coupleExposure, setCoupleExposure] = React.useState(initialData.coupleExposure || null);
    
    // 付费DM
    const [paidDmDaily, setPaidDmDaily] = React.useState(initialData.paidDmDaily || { lastChatDate: null, messages: {}, thread: [] });
    const [selectedPaidFan, setSelectedPaidFan] = React.useState(null);
    const [paidDmInput, setPaidDmInput] = React.useState("");
    const [quotingFan, setQuotingFan] = React.useState(null);   // 引用回复目标 msgId（可以是大粉或普通粉丝）
    const [quotingMsgInfo, setQuotingMsgInfo] = React.useState(null); // {name, text} 引用消息预览
    const dmEndRef = React.useRef(null); // DM线程自动滚动ref（必须用useRef而非createRef，后者在渲染时每次新建）
    // DM线程新消息时自动滚到底
    React.useEffect(() => { dmEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [paidDmDaily]);
    
    // UI 状态
    const [activeTab, setActiveTab] = React.useState("story");
    const [showSidebar, setShowSidebar] = React.useState(false);
    const [showPhone, setShowPhone] = React.useState(false);
    const [activeModal, setActiveModal] = React.useState(null);
    const [showPrivateChat, setShowPrivateChat] = React.useState(null);
    const [showFanDetail, setShowFanDetail] = React.useState(null);
    const [showGift, setShowGift] = React.useState(false);
    const [showRelationGraph, setShowRelationGraph] = React.useState(false);
    const [worldState, setWorldState] = React.useState([]);
    const [loading, setLoading] = React.useState(false);
    const [forumLoading, setForumLoading] = React.useState(false); // 论坛/帖子详情独立加载态，不影响主线
    const [dynamicLoading, setDynamicLoading] = React.useState(false); // 舆论涟漪加载状态
    const [streamingStory, setStreamingStory] = React.useState("");
    const [error, setError] = React.useState(null);
    const [customMode, setCustomMode] = React.useState(false);
    const [customText, setCustomText] = React.useState("");
    
    // 社交平台数据缓存
    const [socialCache, setSocialCache] = React.useState({});
    const [forumContext, setForumContext] = React.useState({ posts: [], activePlatform: "pann", selectedPost: null, postTab: "hot" });
    const [businessComments, setBusinessComments] = React.useState(null);
    
    // Tab 状态
    const [weverseTab, setWeverseTab] = React.useState("recommend");
    const [youtubeTab, setYoutubeTab] = React.useState("videos");
    const [cpostTab, setCpostTab] = React.useState("weibo");
    const [jiefuTab, setJiefuTab] = React.useState("jiefu");

    // 【社交引擎】各平台 feed（持久化）+ 发帖器/评论区/加载态
    const SOCIAL_MODALS = ["youtube", "instagram", "twitter", "tiktok", "cpost", "threads", "jiefu", "weverse"];
    const [socialFeeds, setSocialFeeds] = React.useState(initialData.socialFeeds || {});
    const [socialLoadingKey, setSocialLoadingKey] = React.useState(null);
    const [postComposer, setPostComposer] = React.useState(null);   // { platformKey }
    const [commentSheet, setCommentSheet] = React.useState(null);   // { feedKey, postId }
    const [commentLoading, setCommentLoading] = React.useState(false);
    const [tiktokAlt, setTiktokAlt] = React.useState(initialData.tiktokAlt || false);        // TikTok 小号开关
    const [snsInput, setSnsInput] = React.useState("");             // 小号发文输入
    const [liveMessages, setLiveMessages] = React.useState([]);     // 直播弹幕
    const [liveActive, setLiveActive] = React.useState(false);      // 直播进行中
    const [toastMsg, setToastMsg] = React.useState("");             // 手机操作就地反馈（不推主线）

    // 当前 activeModal 对应的 feed key（cpost/jiefu 含子tab）
    const feedKeyFor = (modal) => {
        if (modal === "cpost") return `cpost:${cpostTab}`;
        if (modal === "jiefu") return `jiefu:${jiefuTab}`;
        return modal;
    };

    // 【舆论涟漪】存储最近一次 getSocialDynamic 的结果，在剧情页底部显示
    const [socialDynamics, setSocialDynamics] = React.useState(initialData.socialDynamics || []);
    const triggerSocialDynamic = async (events) => {
        setDynamicLoading(true);
        const result = await callEdgeFunction('getSocialDynamic', {
            currentEvents: events,
            riskLevel: currentRisk,
            seaLevel,
            artistName: char?.artistName,
            nickname: char?.nickname,
            unlockedFans: unlocked.map(id => FANS.find(f => f.id === id)?.name).filter(Boolean).join("、")
        });
        if (result.dynamics?.length) {
            setSocialDynamics(result.dynamics);
            // 同时把大粉/姐夫站帖子注入对应 feed
            result.dynamics.forEach(d => {
                const feedKey = d.platform?.includes("姐夫") ? `jiefu:jiefu` : d.platform === "Pann" ? null : "cpost:weibo";
                if (feedKey && d.content && String(d.content).trim()) {  // ⭐ 空内容不注入，避免幽灵帖
                    const ripplePost = makePost({ author: d.author, content: d.content, likes: Math.floor(Math.random() * 5000) + 500, time: "刚刚" });
                    setSocialFeeds(prev => ({ ...prev, [feedKey]: [ripplePost, ...(prev[feedKey] || []).slice(0, 8)] }));
                }
            });
            // 风险类涟漪影响 risk
            result.dynamics.filter(d => d.impactType === "risk").forEach(() => updateRisk(1));
        }
        setDynamicLoading(false);
    };

    // 打开社交弹窗 / 切换子tab 时，若该 feed 没有AI内容则填充（保留玩家自己的帖）
    React.useEffect(() => {
        if (!SOCIAL_MODALS.includes(activeModal)) return;
        if (activeModal === "weverse") return;            // Weverse 不AI填充，由玩家发帖/营业生成
        const key = feedKeyFor(activeModal);
        const hasAi = (socialFeeds[key] || []).some(p => !p.mine);
        if (hasAi) return;
        setSocialLoadingKey(key);
        refreshSocialContent(activeModal, activeModal).then(r => {
            const posts = normalizeSocialResult(activeModal, r);
            setSocialFeeds(prev => {
                const mine = (prev[key] || []).filter(p => p.mine).slice(-15);
                return { ...prev, [key]: [...mine, ...posts].slice(0, 30) };
            });
            setSocialLoadingKey(null);
        });
    }, [activeModal, cpostTab, jiefuTab]);

    // 直播：进入时重置弹幕（轮询统一在 LiveModal 内部管理，不在这里重复）
    React.useEffect(() => {
        if (activeModal === "live") { setLiveMessages([]); }
    }, [activeModal]);
    
    const addWorldState = (action) => setWorldState(prev => [...prev.slice(-5), action]);
    const clearWorldState = () => setWorldState([]);
    const addRecentInteraction = (fanId, interaction) => {
        setFanEmotions(prev => ({ ...prev, [fanId]: { ...prev[fanId], recentInteractions: [...(prev[fanId]?.recentInteractions || []), interaction].slice(-10) } }));
    };

    // ====== 社交引擎：点赞 / 做数据 / 打开评论 / 发帖 ======
    const updatePost = (feedKey, postId, patch) => {
        setSocialFeeds(prev => ({
            ...prev,
            [feedKey]: (prev[feedKey] || []).map(p => p.id === postId ? { ...p, ...(typeof patch === "function" ? patch(p) : patch) } : p)
        }));
    };
    const toggleLike = (feedKey, postId) => {
        updatePost(feedKey, postId, p => ({ liked: !p.liked, likes: p.likes + (p.liked ? -1 : 1) }));
    };
    const farmData = (feedKey, postId) => {
        const boost = Math.floor(Math.random() * 4000) + 800;
        updatePost(feedKey, postId, p => ({ likes: p.likes + boost, commentsCount: p.commentsCount + Math.floor(boost / 50) }));
        updateAttrs({ 人气值: Math.min(100, attrs.人气值 + 1) });
        addWorldState(`给一条帖子做数据，数据+${formatCount(boost)}`);
    };
    const openComments = async (feedKey, post) => {
        setCommentSheet({ feedKey, postId: post.id });
        // ✅ 修复：空数组([])也要重新请求，之前 post.comments=[] 时被误判为"已加载"跳过
        if (post.comments && post.comments.length > 0) return;
        setCommentLoading(true);
        const platformId = feedKey.startsWith("cpost") ? cpostTab : (feedKey.startsWith("jiefu") ? "weibo" : feedKey);
        const unlockedNames = unlocked.map(id => FANS.find(f => f.id === id)?.name).filter(Boolean);
        const result = await callEdgeFunction('comments', {
            postTitle: post.title || post.content?.slice(0, 30),
            postContent: post.content || post.title || "",       // ⭐ 完整帖子内容
            postAuthor: post.author || "",                        // ⭐ 谁发的
            isMinePost: !!post.mine,                              // ⭐ 是不是玩家本人发的
            isFanPost: !!post.isFanPost,                          // ⭐ 是不是大粉发的
            bigFanName: post.bigFan?.name || null,                // ⭐ 哪位大粉
            platformId,
            gameContext: {
                artistName: char?.artistName, nickname: char?.nickname,
                seaLevel, riskLevel: currentRisk, antiCount, fandomHeat,
                day,                                              // ⭐ 第几天
                hasStartedDating: unlocked.length > 0,            // ⭐ 是否已开始私联
                unlockedFans: unlockedNames,                      // ⭐ 私联了谁
                forbidDatingGossip: unlocked.length === 0         // ⭐ 显式禁止编恋爱话题
            }
        });
        if (result?.error) {
            // ✅ 修复：API 失败时给用户可见反馈，而不是静默显示"还没有评论"
            updatePost(feedKey, post.id, { comments: null }); // 重置为 null 以便下次可重试
            setCommentLoading(false);
            setToastMsg(`💬 评论加载失败，请稍后重试`);
            setTimeout(() => setToastMsg(""), 3000);
            return;
        }
        updatePost(feedKey, post.id, { comments: result.comments || [], commentsCount: (result.comments || []).length || post.commentsCount });
        setCommentLoading(false);
    };
    // 发帖：把我的帖子放进 feed，并调用 business 拿真实评论/人气/支线
    const publishPost = async (platformKey, content, media) => {
        const platformName = platformKey === "twitter" ? "Twitter" : platformKey === "instagram" ? "Instagram"
            : platformKey === "tiktok" ? "TikTok" : platformKey === "youtube" ? "YouTube"
            : platformKey === "weverse" ? "Weverse" : platformKey.startsWith("cpost") ? "微博" : "SNS";
        const myPost = makePost({ mine: true, content, media, likes: Math.floor(Math.random() * 800) + 200, comments: 0, time: "刚刚", type: "me" });
        setSocialFeeds(prev => ({ ...prev, [platformKey]: [myPost, ...(prev[platformKey] || [])].slice(0, 30) }));
        setPostComposer(null);
        addWorldState(`在${platformName}发布${media ? "（带" + media + "）" : ""}：${content.slice(0, 25)}`);
        // 恋爱后带自拍/视频 → 暴露风险
        if (media && unlocked.length > 0) updateRisk(2);
        const result = await callEdgeFunction('business', {
            platform: platformName, type: "发帖", content,
            gameContext: { popularity: attrs.人气值, seaLevel, antiCount, fandomHeat, artistName: char?.artistName, nickname: char?.nickname, unlockedFans: unlocked.map(id => FANS.find(f => f.id === id)?.name) }
        });
        if (result?.error) {
            console.warn('[handlePostInSocial] 评论生成失败:', result.error);
            // 帖子已发出去（mine post 已加入 feed），评论会延后再说，不强打断玩家
        }
        if (result.popularityChange) setAttrs(prev => ({ ...prev, 人气值: Math.max(0, Math.min(100, prev.人气值 + result.popularityChange)) }));
        if (result.riskChange) updateRisk(result.riskChange);
        if (result.comments) {
            updatePost(platformKey, myPost.id, { comments: result.comments, commentsCount: result.comments.length });
        }
    };

    // 海后值联动大粉情绪
    React.useEffect(() => {
        const jealousyIncrease = Math.floor(seaLevel / 20);
        if (jealousyIncrease > 0) {
            setFanEmotions(prev => {
                const next = { ...prev };
                Object.keys(next).forEach(fanId => {
                    if (next[fanId]) next[fanId].jealousy = Math.min(100, next[fanId].jealousy + jealousyIncrease / 10);
                });
                return next;
            });
        }
    }, [seaLevel]);
    
    // 心动值≥90 特殊剧情提示
    const [highHeartEvent, setHighHeartEvent] = React.useState(null);
    React.useEffect(() => {
        const highHeartFans = Object.entries(hearts).filter(([id, val]) => val >= 90);
        if (highHeartFans.length > 0 && !highHeartEvent) {
            const fan = FANS.find(f => f.id === highHeartFans[0][0]);
            setHighHeartEvent({
                fan: fan,
                message: `💗 ${fan.name} 对你的心动值已达90！他似乎愿意为你做任何事，甚至...`
            });
            setTimeout(() => setHighHeartEvent(null), 8000);
        }
    }, [hearts]);
    
    // 自动保存（用 ref 避免重复 alert）
    const saveFailedRef = React.useRef(false);
    React.useEffect(() => {
        const saveData = {
            char, day, hearts, seaLevel, unlocked, currentStory, currentChoices, currentRisk, suspicion,
            history, storySummary, schedules, attrs, money, teammates, fandomHeat, antiCount, fanEmotions,
            activeEvents, currentSchedule, dmReadStatus, dmHistories, coupleExposure, paidDmDaily,
            companyFavor, socialFeeds, socialDynamics, tiktokAlt, scheduleMap, companyContract
        };
        const r = saveGameToSlot(slotId, saveData);
        if (r && r.ok === false) {
            if (!saveFailedRef.current) {
                saveFailedRef.current = true;
                alert(`⚠️ 自动存档失败：${r.message}\n你可以继续游戏，但建议尽快导出存档备份。`);
            }
        } else if (r && r.ok === true) {
            saveFailedRef.current = false;
        }
        syncToCloud(slotId, saveData);
        touchActiveSlot(slotId);   // 刷新“最近在玩”时间戳，支撑被杀后 30 分钟内自动续档
    }, [day, hearts, seaLevel, currentStory, currentChoices, currentRisk, suspicion, history, storySummary, schedules,
        attrs, money, teammates, fandomHeat, antiCount, fanEmotions, activeEvents, currentSchedule, dmReadStatus, dmHistories,
        coupleExposure, paidDmDaily, companyFavor, socialFeeds, socialDynamics, tiktokAlt, scheduleMap, companyContract]);
    
    // 每日推进
    React.useEffect(() => {
        setCurrentSchedule(generateRandomSchedule(day));
    }, [day]);
    
    // 事件系统
    React.useEffect(() => {
        if (day > 1 && activeEvents.length < 2 && Math.random() < 0.3) {
            const eventNames = ["恋爱绯闻", "品牌邀约", "粉圈大战", "黑热搜"];
            setActiveEvents(prev => [...prev, {
                id: Date.now(), name: eventNames[Math.floor(Math.random() * 4)],
                stage: 1, maxStage: 3, currentDesc: "事件刚刚开始..."
            }]);
        }
        setActiveEvents(prev => prev.map(e => {
            if (e.stage < e.maxStage && Math.random() < 0.2) {
                return { ...e, stage: e.stage + 1, currentDesc: `${e.name}进入第${e.stage + 1}阶段` };
            }
            return e;
        }).filter(e => e.stage <= e.maxStage));
    }, [day]);
    
    // 更新函数
    const updateHearts = (changes) => {
        if (!changes) return;
        setHearts(prev => {
            const next = { ...prev };
            Object.entries(changes).forEach(([id, delta]) => {
                const value = Number(delta);
                if (next[id] !== undefined && Number.isFinite(value)) next[id] = Math.min(100, Math.max(0, next[id] + value));
            });
            return next;
        });
    };
    const updateRisk = (delta) => {
        if (delta <= 0) {
            // 风险下降不受限制
            setCurrentRisk(prev => Math.min(10, Math.max(0, prev + delta)));
            return;
        }
        // 【同回合累积上限】单回合内 risk 上涨已超过 RISK_TURN_CAP 则丢弃
        if (riskTurnAccumRef.current >= RISK_TURN_CAP) return;
        // 把本次 delta 限制在剩余配额内
        const allowed = Math.min(delta, RISK_TURN_CAP - riskTurnAccumRef.current);
        delta = allowed;
        riskTurnAccumRef.current += allowed;
        // 疑虑期缓冲：在 setCurrentRisk 的 functional update 里判断实时 risk，避免闭包陷阱
        setCurrentRisk(prevRisk => {
            // 直接增长情况：风险已经 >= 7 时跳过疑虑缓冲，直接加
            if (prevRisk >= 7) {
                const newRisk = Math.min(10, prevRisk + Math.min(delta, 2));
                // 进入或继续危机模式：强震动
                if (newRisk >= 8 && prevRisk < 8) { vibrate(VIBE.crisis); playSFX('crisis'); }
                else if (newRisk > prevRisk) { vibrate(VIBE.riskUp); playSFX('risk'); }
                return newRisk;
            }
            return prevRisk; // 否则不动 risk，由下面 setSuspicion 决定
        });
        setSuspicion(prev => {
            const newSusp = Math.min(10, prev + delta);
            if (newSusp >= 5) {
                // 疑虑爆发 → 转化为真实风险
                setCurrentRisk(r => {
                    const newRisk = Math.min(10, r + Math.min(delta, 2));
                    if (newRisk >= 8 && r < 8) { vibrate(VIBE.crisis); playSFX('crisis'); }
                    else if (newRisk > r) { vibrate(VIBE.riskUp); playSFX('risk'); }
                    return newRisk;
                });
                return Math.max(0, newSusp - 5);
            }
            return newSusp; // 暂时积累疑虑
        });
    };
    const updateSuspicion = (delta) => setSuspicion(prev => Math.min(10, Math.max(0, prev + delta)));
    const updateSeaLevel = (delta) => setSeaLevel(prev => {
        // 公司管控等级越高，海后值增长越被压制（只压制上涨，下降不打折）
        let finalDelta = delta;
        if (delta > 0 && companyContract?.signed) {
            const control = companyContract.control || 0;
            finalDelta = Math.max(1, Math.ceil(delta / (control + 1)));
        }
        return Math.min(100, Math.max(0, prev + finalDelta));
    });
    const updateMoney = (delta) => setMoney(prev => Math.max(0, prev + delta));
    const updateAttrs = (changes) => setAttrs(prev => ({ ...prev, ...changes }));
    const updateFanEmotion = (fanId, changes) => {
        if (!changes) return;
        setFanEmotions(prev => ({
            ...prev,
            [fanId]: {
                ...(prev[fanId] || { affection: 30, trust: 40, obsession: 20, jealousy: 25, recentInteractions: [] }),
                affection: Math.min(100, Math.max(0, (prev[fanId]?.affection || 30) + (Number(changes.affection) || 0))),
                trust: Math.min(100, Math.max(0, (prev[fanId]?.trust || 40) + (Number(changes.trust) || 0))),
                obsession: Math.min(100, Math.max(0, (prev[fanId]?.obsession || 20) + (Number(changes.obsession) || 0))),
                jealousy: Math.min(100, Math.max(0, (prev[fanId]?.jealousy || 25) + (Number(changes.jealousy) || 0))),
                relationshipStatus: changes.relationshipStatus ?? prev[fanId]?.relationshipStatus
            }
        }));
    };
    
    // 社交平台内容刷新
    const refreshSocialContent = async (platform, type) => {
        const unlockedNames = unlocked.map(id => FANS.find(f => f.id === id)?.name).filter(Boolean);
        const gameContext = {
            day, seaLevel, riskLevel: currentRisk, popularity: attrs.人气值,
            fandomHeat, antiCount, recentEvent: activeEvents[0]?.name,
            artistName: char?.artistName, nickname: char?.nickname,    // ⭐ 让 AI 知道艺人是谁
            hasStartedDating: unlocked.length > 0,                      // ⭐ 是否已开始私联
            unlockedFans: unlockedNames,                                // ⭐ 私联了谁
            forbidDatingGossip: unlocked.length === 0                   // ⭐ 初始阶段禁止恋爱八卦
        };
        if (type === "cpost") gameContext.cpostType = cpostTab;
        if (type === "jiefu") gameContext.jiefuType = jiefuTab;
        const result = await callEdgeFunction('social', { platform, gameContext });
        if (!result.error) return result;
        return {};
    };
    
    // 剧情推进
    // ────────── 流式读取 helper ──────────
    // 从积累的 SSE 文本里提取 "story" 字段内容（逐字解 JSON 转义）
    const extractStreamStory = (accumulated) => {
        const match = accumulated.match(/"story"\s*:\s*"/);
        if (!match) return null;
        const start = match.index + match[0].length;
        let text = '';
        let i = start;
        while (i < accumulated.length) {
            const ch = accumulated[i];
            if (ch === '\\') {
                if (i + 1 >= accumulated.length) break; // 末尾截断的转义序列，等下一个chunk
                const next = accumulated[i + 1];
                if (next === 'n') { text += '\n'; i += 2; }
                else if (next === '"') { text += '"'; i += 2; }
                else if (next === '\\') { text += '\\'; i += 2; }
                else if (next === 't') { text += '\t'; i += 2; }
                else { text += ch; i++; }
            } else if (ch === '"') {
                break; // story 字段结束
            } else {
                text += ch; i++;
            }
        }
        return text || null;
    };

    const continueStoryLockRef = React.useRef(false);
    const continueStory = async (playerAction) => {
        // 重入保护：useRef 在同一次事件循环中立即生效，比 loading state 更可靠
        if (continueStoryLockRef.current) {
            console.warn('[continueStory] 重入被拦截：上一个剧情请求还在进行');
            return;
        }
        continueStoryLockRef.current = true;
        setLoading(true);
        setError(null);
        setStreamingStory("");
        const worldStateSummary = worldState.length ? `玩家在做决定前还做了：${worldState.join("；")}` : "";
        clearWorldState();
        
        const storyData = {
            context: {
                character: char,
                day, heartLevels: hearts, seaLevel, unlockedFans: unlocked, attrs,
                teammates: teammates?.map(t => t.name) || [],
                previousStory: currentStory,
                storySummary,
                worldStateSummary, coupleExposure
            },
            playerAction,
            worldState: { seaLevel, currentRisk, suspicion, popularity: attrs.人气值, fandomHeat, antiCount, companyFavor },
            stream: true  // 请求流式输出
        };

        let result = null;

        // ── 尝试流式读取 ──
        try {
            const res = await fetch(FUNCTION_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
                // ⭐ 注入 userId：流式分支之前没带，后端 rate limiter 只能退回 IP 识别（同一出口IP的多人会互相挤限额）
                body: JSON.stringify({ action: 'story', data: { ...storyData, userId: window._ehpUserId || 'guest' } })
            });

            if (res.headers.get('content-type')?.includes('event-stream') && res.body) {
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let fullText = '';
                let lastStoryText = '';

                outer: while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        if (!line.startsWith('data: ')) continue;
                        const chunk = line.slice(6).trim();
                        if (chunk === '[DONE]') break outer;
                        try {
                            const parsed = JSON.parse(chunk);
                            const delta = parsed.choices?.[0]?.delta?.content || '';
                            if (!delta) continue;
                            fullText += delta;
                            // 实时显示 story 字段文本
                            const storyText = extractStreamStory(fullText);
                            if (storyText) {
                                lastStoryText = storyText;
                                setStreamingStory(storyText);
                            }
                        } catch { /* partial JSON chunk, ignore */ }
                    }
                }
                // 流读完，解析完整 JSON
                setStreamingStory('');
                const jsonMatch = fullText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try { result = JSON.parse(jsonMatch[0]); } catch {
                        // JSON 不完整时用 extractJsonObject 兜底
                        result = { story: lastStoryText, choices: ['继续', '等待', '观察'], newUnlockedFan: null };
                    }
                } else {
                    result = { story: lastStoryText, choices: ['继续', '等待', '观察'], newUnlockedFan: null };
                }
            } else {
                // 后端没返回 SSE（可能是错误响应），回退到 JSON
                result = await res.json().catch(() => ({}));
            }
        } catch (streamErr) {
            console.warn('streaming failed, falling back:', streamErr);
            result = await callEdgeFunction('story', storyData);
        }
        
        if (result?.error) {
            setError(result.error);
        } else if (result?.story) {
            setCurrentStory(result.story);
            setCurrentChoices(result.choices || ["继续", "等待", "观察"]);
            if (result.heartChanges) updateHearts(result.heartChanges);
            if (result.emotionChanges) Object.entries(result.emotionChanges).forEach(([fanId, changes]) => updateFanEmotion(fanId, changes));
            if (result.seaChange) updateSeaLevel(result.seaChange);
            if (result.riskChange) updateRisk(result.riskChange);
            if (result.suspicionChange) updateSuspicion(result.suspicionChange); // 疑虑期：小失误转疑虑，不直接爆发
            if (result.popularityChange) setAttrs(prev => ({ ...prev, 人气值: Math.max(0, Math.min(100, prev.人气值 + result.popularityChange)) }));
            if (result.coupleExposure) setCoupleExposure(result.coupleExposure);

            // 私联解锁
            if (result.newUnlockedFan && !unlocked.includes(result.newUnlockedFan)) {
                const newFan = FANS.find(f => f.id === result.newUnlockedFan);
                if (newFan) {
                    setUnlocked(prev => prev.includes(newFan.id) ? prev : [...prev, newFan.id]);
                    addWorldState(`成功私联了${newFan.name}`);
                    vibrate(VIBE.unlock); playSFX('unlock');
                    setTimeout(() => alert(`💌 你成功私联了新大粉：${newFan.emoji} ${newFan.name}！现在可以在手机里主动私聊、找他要钱了。`), 300);
                }
            }

            // history 截断到最近 25 条，避免无限增长撑爆 localStorage（5MB 配额）
            // 旧剧情会被 storySummary 压缩接管
            const HISTORY_MAX = 25;
            const merged = [...history, result.story];
            const newHistory = merged.length > HISTORY_MAX ? merged.slice(-HISTORY_MAX) : merged;
            setHistory(newHistory);
            
            // 每 5 天压缩摘要
            if ((day + 1) % 5 === 0) {
                callEdgeFunction('summarize_story', { history: newHistory.slice(-5) }).then(res => {
                    if (res.summary) setStorySummary(res.summary);
                });
            }
            setDay(prev => prev + 1);
            // 【自然衰减】互联网是没有记忆的——每过一天风险自然下降 1（最低 0）
            // 但风险 >= 8 的危机模式下不衰减（爆瓜中正在发酵）
            setCurrentRisk(prev => prev >= 8 ? prev : Math.max(0, prev - 1));
            // 疑虑值也每天衰减 1（粉丝吃过瓜后会慢慢淡忘）
            setSuspicion(prev => Math.max(0, prev - 1));
            // 重置同回合 risk 累积计数
            riskTurnAccumRef.current = 0;
            // 记录今天的日程到 scheduleMap（日历持久化）
            setScheduleMap(prev => ({ ...prev, [day]: currentSchedule }));
            setSocialCache({});
            setSocialFeeds(prev => {
                const next = {};
                Object.keys(prev).forEach(k => {
                    const mine = (prev[k] || []).filter(p => p.mine);
                    if (mine.length) next[k] = mine;
                });
                return next;
            });
            // 【延迟触发涟漪】剧情渲染后 1.5s 再触发，不阻塞主流程
            const eventSummary = (worldStateSummary || playerAction || "").slice(0, 80);
            if (currentRisk >= 7 || (newHistory.length % 3 === 0 && Math.random() < 0.35)) {
                setTimeout(() => triggerSocialDynamic(eventSummary), 1500);
            }
        } else {
            // 流式 + fallback 都失败、或后端没返回 story 字段
            setError("剧情生成失败，请重试。若反复失败，请稍后再来或检查网络。");
        }
        setLoading(false);
        continueStoryLockRef.current = false;
    };
    
    const handleChoice = (choice) => continueStory(choice);
    const handleCustom = () => {
        if (customText.trim()) {
            continueStory("【自定义】" + customText);
            setCustomText("");
            setCustomMode(false);
        }
    };
    // ========== 手机功能函数 ==========
    
    // 营业
    const [businessResult, setBusinessResult] = React.useState(null);

    const handleBusiness = async (platform, type, content, triggerSpinoff) => {
        addWorldState(`在${platform}进行了${type}：${content.slice(0,25)}`);
        const gameContext = {
            popularity: attrs.人气值, seaLevel, antiCount, fandomHeat,
            artistName: char?.artistName, nickname: char?.nickname,
            unlockedFans: unlocked.map(id => FANS.find(f=>f.id===id)?.name)
        };
        const result = await callEdgeFunction('business', { platform, type, content, gameContext });
        if (result?.error || !result?.comments) {
            alert(`💬 评论区加载失败${result?.error ? `（${result.error.slice(0, 60)}）` : ''}，请稍后再试。`);
            return;
        }
        if (result.popularityChange) setAttrs(prev => ({ ...prev, 人气值: Math.max(0, Math.min(100, prev.人气值 + result.popularityChange)) }));
        if (result.riskChange) updateRisk(result.riskChange);
        if (result.comments) {
            setBusinessResult({ platform, type, content, comments: result.comments, spinoffHint: result.spinoffHint || "" });
            setBusinessComments(result.comments);
        }
        if (triggerSpinoff && result.spinoffHint) {
            continueStory(`【营业支线】我在${platform}进行了${type}：${content}。结果：${result.spinoffHint}`);
            setActiveModal(null);
            setBusinessResult(null);
        }
    };
    
    // 小号操作
    const handleSNS = async (content) => {
        const result = await callEdgeFunction('sns', { content, currentRisk });
        if (result?.error || !result?.story) {
            alert(`📱 小号发送失败，请稍后再试。`);
            return;
        }
        updateRisk(result.riskIncrease || 2);
        addWorldState(`用小号发布了：${content.slice(0, 30)}`);
        continueStory(`【小号操作】${result.story}`);
        setActiveModal(null);
    };
    
    // 购物
    const handleBuy = (item) => {
        if (money >= item.price) {
            updateMoney(-item.price);
            if (item.effect.fashion || item.effect.beauty || item.effect.popularity) {
                setAttrs(prev => ({
                    ...prev,
                    时尚度: item.effect.fashion ? (prev.时尚度 || 0) + item.effect.fashion : prev.时尚度,
                    颜值: item.effect.beauty ? prev.颜值 + item.effect.beauty : prev.颜值,
                    人气值: item.effect.popularity ? prev.人气值 + item.effect.popularity : prev.人气值,
                }));
            }
            if (item.effect.risk) updateRisk(item.effect.risk);
            if (item.effect.heart && unlocked.length > 0) updateHearts({ [unlocked[0]]: item.effect.heart });
            addWorldState(`购物：买了${item.name}，花了${item.price}万`);
            setToastMsg(`🛍️ 购买成功！${item.name} 已入手${item.effect.fashion ? `，时尚度+${item.effect.fashion}` : ""}${item.effect.beauty ? `，颜值+${item.effect.beauty}` : ""}${item.effect.popularity ? `，人气+${item.effect.popularity}` : ""}`);
            setTimeout(() => setToastMsg(""), 3000);
            setActiveModal(null);
        } else alert(`金钱不足！需要${item.price}万`);
    };
    
    // 送礼
    const handleSendGift = (fan, gift) => {
        updateMoney(-gift.price);
        updateHearts({ [fan.id]: gift.heartDelta });
        updateFanEmotion(fan.id, gift.emotionDelta);
        addRecentInteraction(fan.id, `送了你${gift.name}，你❤️+${gift.heartDelta}`);
        addWorldState(`给${fan.name}送了${gift.name}`);
        setToastMsg(`🎁 已送出 ${gift.name} 给 ${fan.name}！❤️+${gift.heartDelta}`);
        setTimeout(() => setToastMsg(""), 3000);
        setShowGift(false);
    };
    
    // 要钱
    const handleAskMoney = async (fanId) => {
        const fan = FANS.find(f => f.id === fanId);
        const result = await callEdgeFunction('askMoney', { fanName: fan?.name, fanType: fan?.type, heartLevel: hearts[fanId] });
        if (result?.error || !result?.story) {
            alert(`💔 ${fan?.name || "对方"}没回应，可能是网络问题，稍后再试。`);
            return;
        }
        if (result.moneyGained) updateMoney(result.moneyGained);
        if (result.heartChange) updateHearts({ [fanId]: result.heartChange });
        addRecentInteraction(fanId, `借了你${result.moneyGained}万`);
        addWorldState(`找${fan?.name}要了${result.moneyGained || 0}万：${result.story.slice(0, 30)}`);
        setToastMsg(`💰 ${fan?.name}：${result.story.slice(0, 50)}${result.moneyGained ? `  +${result.moneyGained}万` : ""}`);
        setTimeout(() => setToastMsg(""), 4000);
        setActiveModal(null);
    };
    
    // 公司交涉
    const handleCompany = async (action) => {
        const result = await callEdgeFunction('company', { action, companyFavor, seaLevel, currentRisk, artistName: char?.artistName });
        if (result?.error || !result?.story) {
            alert(`📞 公司这边没接通，请稍后重试。`);
            return;
        }
        if (result.companyFavorChange) setCompanyFavor(prev => Math.min(100, Math.max(0, prev + result.companyFavorChange)));
        if (result.companyChange) setCompanyFavor(prev => Math.min(100, Math.max(0, prev + result.companyChange)));
        if (result.seaChange) updateSeaLevel(result.seaChange);
        if (result.riskChange) updateRisk(result.riskChange);
        // 签约逻辑
        if (result.contractTerms) {
            setCompanyContract({ terms: result.contractTerms, control: result.companyControl || 1, signedDay: day, signed: true });
            if (result.seaChange) updateSeaLevel(result.seaChange);
        }
        addWorldState(`公司交涉(${action})：${result.story.slice(0, 40)}`);
        setToastMsg(`🏢 ${result.story.slice(0, 80)}`);
        setTimeout(() => setToastMsg(""), 5000);
        setActiveModal(null);
    };
    
    // DM 私聊（含情感联动和沈载伦特殊规则）
    // DM消息历史（内存中，按fanId存储）
    const addDmMessage = (fanId, msg) => {
        setDmHistories(prev => ({ ...prev, [fanId]: [...(prev[fanId] || []), msg].slice(-30) }));
    };
const sendDM = async (fan, text, actionItem) => {
        const messageText = text || (actionItem ? actionItem.prompt : "");
        if (!messageText) return;
        
        const jealousy = fanEmotions[fan.id]?.jealousy || 25;
        const isJealous = jealousy > 70;
        let heartBonus = seaLevel > 80 ? 0 : (seaLevel > 60 ? 0.5 : (seaLevel > 40 ? 0.8 : 1));
        
        let processedMessage = messageText;
        if (fan.name === "沈载伦") processedMessage = messageText.replace(/姐姐|欧尼/g, "你");
        
        addWorldState(`和${fan.name}聊了天：${processedMessage.slice(0, 30)}`);
        addRecentInteraction(fan.id, `发了消息：${processedMessage.slice(0, 40)}`);
        
        const myMsg = { role: "user", content: processedMessage, time: new Date().toLocaleTimeString() };
        addDmMessage(fan.id, { ...myMsg, isMe: true });
        
        const currentHistory = (dmHistories[fan.id] || []).slice(-10).map(m => ({
            role: m.isMe ? "user" : "assistant",
            content: m.content
        }));
        
        const result = await callEdgeFunction('dm', {
            fan: { name: fan.name, handle: fan.handle, type: fan.type, personality: fan.personality, age: fan.age || 22, famousEvent: fan.famousEvent },
            charAge: Number(char?.age) || 20, // 【传入年龄判定】
            userMessage: isJealous ? `[吃醋模式] ${processedMessage}` : processedMessage,
            history: currentHistory,
            emotions: fanEmotions[fan.id],
        });
        
        if (result.reply) {
            addDmMessage(fan.id, { role: "assistant", content: result.reply, isMe: false, time: new Date().toLocaleTimeString() });
            updateHearts({ [fan.id]: Math.floor((actionItem ? actionItem.heartDelta : 1) * heartBonus) });
            vibrate(VIBE.dmReceive); playSFX('dm');
            
            // 【每聊 8 句触发关系摘要】修复闭包：手动拼上刚发/刚收的两条，避免拿到旧 state
            const newCount = (dmHistories[fan.id]?.length || 0) + 2;
            if (newCount > 0 && newCount % 8 === 0) {
                const latestMsgs = [
                    ...((dmHistories[fan.id] || []).slice(-6)),
                    { isMe: true, content: processedMessage },
                    { isMe: false, content: result.reply }
                ];
                const recentText = latestMsgs.map(m => `${m.isMe ? '我' : '他'}: ${m.content}`);
                callEdgeFunction('summarize_relationship', { fanName: fan.name, history: recentText }).then(res => {
                    if(res.status) updateFanEmotion(fan.id, { relationshipStatus: res.status });
                });
            }
            setDmReadStatus(prev => ({ ...prev, [fan.id]: Date.now() }));
        } else {
            // API 失败或无回复：给玩家可见反馈，避免"消息发出去石沉大海"的困惑
            addDmMessage(fan.id, { role: "assistant", content: `[消息发送了，但${fan.name}还没回复...可能是网络问题，稍后再试或重新发送]`, isMe: false, time: new Date().toLocaleTimeString(), isError: true });
        }
    };
    
    // 付费DM（群发模式：发一条，所有六位大粉都收到，每人都给你私回）
    const sendPaidDM = async (message, quoteInfo) => {
        // quoteInfo: { msgId, fanId, fanName, text } 或 null
        if (!message.trim()) return;
        const nickname = char?.nickname || char?.artistName || "晨晨";
        addWorldState(`在Weverse发了付费DM：${message.slice(0, 30)}`);

        // 1. 先把玩家消息加入thread（快照当前thread用于history）
        const msgId = Date.now();
        const snapshotThread = paidDmDaily.thread || [];
        const playerMsg = {
            id: msgId,
            from: "player",
            text: message,
            quoteInfo: quoteInfo || null,
            time: new Date().toLocaleTimeString()
        };
        setPaidDmDaily(prev => ({ ...prev, thread: [...(prev.thread || []), playerMsg] }));
        setQuotingFan(null);
        setQuotingMsgInfo(null);

        // 构建 history（用快照，避免闭包拿到旧值）
        const historyForApi = snapshotThread.slice(-8).map(m => {
            const isFan = m.from !== "player";
            const fanName = isFan ? (FANS.find(f => f.id === m.from)?.name || m.senderName || m.from) : null;
            return {
                role: m.from === "player" ? "user" : "assistant",
                content: m.from === "player" ? m.text : `[${fanName}的私回] ${m.text}`
            };
        });

        // 2. 生成1-3条普通粉丝回复（AI生成，异步插入）
        // 普通粉丝的账号名根据当前主角（玩家昵称/艺名）动态生成，不再写死"晨晨"。
        const fanBase = (char?.nickname || char?.artistName || "小姐姐").trim();
        const commonFanNames = [
            `${fanBase}是我老婆`,
            `${fanBase}的小太阳`,
            `守护${fanBase}`,
            `${fanBase}贴贴`,
            `${fanBase}_data站`,
            `我宣布${fanBase}是我的`,
            // 几个不含名字的通用饭圈ID，增加多样性
            "sun_cheer", "노바랑", "coco_fan07", "今天也在追星",
        ];
        const randomFanCount = 1 + Math.floor(Math.random() * 2); // 1-2条
        const commonFanTexts = [
            "啊啊啊看到了！冲！！😭",
            `${char?.artistName}我爱你！！！`,
            "这DM今晚睡觉都会笑出声",
            "救命这条太珍贵了要截图",
            "已截图放桌面了老婆我爱你",
            "啊啊看到啦老婆今天也加油💕",
            "看到了！！开心！！😭❤️",
            "心脏不行了，谢谢偶像",
            "哇这条好甜！！！！！！",
            `${char?.nickname || char?.artistName}谢谢你发DM啊呜呜`
        ];
        // 延迟1-3秒后陆续插入普通粉丝回复
        for (let i = 0; i < randomFanCount; i++) {
            setTimeout(() => {
                const randName = commonFanNames[Math.floor(Math.random() * commonFanNames.length)];
                const randText = commonFanTexts[Math.floor(Math.random() * commonFanTexts.length)];
                const cid = Date.now() + Math.floor(Math.random() * 9999);
                setPaidDmDaily(prev => ({
                    ...prev,
                    thread: [...(prev.thread || []), {
                        id: cid,
                        from: "common_fan",
                        senderName: randName,
                        text: randText,
                        senderType: "common_fan",
                        time: new Date().toLocaleTimeString()
                    }]
                }));
            }, 1000 + i * 1500 + Math.random() * 1000);
        }

        // 3. 并发请求六位大粉回复（Promise.all，不再串行）
        // 3. 并发请求六位大粉回复（Promise.all，不再串行）
        FANS.forEach(fan => addRecentInteraction(fan.id, `你在付费DM发消息：${message.slice(0, 40)}`));
        
        const fanPromises = FANS.map(async (fan) => {
            // ⭐ 重写 userMessage：把玩家消息放最前面，引用信息和场景说明放后面
            const isQuoted = fan.id === quoteInfo?.fanId;
            const quotedPrev = isQuoted ? (quoteInfo.text || "").slice(0, 80) : null;
            const userMessage = 
                `${nickname}在Weverse付费DM群发了下面这条消息（所有大粉都收到）：\n` +
                `「${message}」\n` +
                (isQuoted ? `\n（这次群发中她特意引用了你${fan.name}之前对她说的「${quotedPrev}」）\n` : "") +
                `\n请你（${fan.name}，${fan.type}，${fan.personality}）以你的人设，直接回应${nickname}刚说的「${message.slice(0, 60)}${message.length > 60 ? '...' : ''}」这句话的具体内容——可以是接话、追问、调侃、共情、吃醋、撒娇等，但必须针对这条消息本身，不要写"今天的DM也好甜"、"老婆我爱你"这种跟内容脱节的通用粉丝彩虹屁。`;
            
            try {
                const result = await callEdgeFunction('paid_dm', {
                    fan: { name: fan.name, handle: fan.handle, type: fan.type, personality: fan.personality, age: fan.age, famousEvent: fan.famousEvent },
                    charAge: Number(char?.age) || 20,
                    userMessage,
                    playerMessage: message,           // ⭐ 额外字段：纯净的玩家消息（如果 edge function 支持就用得上）
                    quotedFanReply: quotedPrev,       // ⭐ 额外字段：被引用的对方上条
                    isQuotedFan: isQuoted,            // ⭐ 是否就是被引用的那位
                    history: historyForApi,
                    emotions: fanEmotions[fan.id],
                    playerNickname: nickname,
                });
                if (result?.reply) {
                    const replyId = Date.now() + Math.floor(Math.random() * 99999);
                    setPaidDmDaily(prev => ({
                        ...prev,
                        thread: [...(prev.thread || []), {
                            id: replyId,
                            from: fan.id,
                            senderName: fan.name,
                            senderType: "big_fan",
                            text: result.reply,
                            time: new Date().toLocaleTimeString()
                        }]
                    }));
                    updateHearts({ [fan.id]: 2 });
                    addDmMessage(fan.id, { role: "assistant", content: `[Weverse DM私回] ${result.reply}`, isMe: false, time: new Date().toLocaleTimeString() });
                    setDmReadStatus(prev => ({ ...prev, [fan.id]: Date.now() }));
                    return { fanId: fan.id, reply: result.reply };
                }
            } catch (e) {
                console.error(`[paidDM] ${fan.name} 失败:`, e);
            }
            return null;
        });
        await Promise.all(fanPromises);

        // 4. 如果引用的是某位大粉，触发炫耀帖
        if (quoteInfo?.fanId) {
            try {
                const showoffResult = await callEdgeFunction('fanShowoff', {
                    fanName: quoteInfo.fanName,
                    fanHandle: FANS.find(f => f.id === quoteInfo.fanId)?.handle || "",
                    fanType: FANS.find(f => f.id === quoteInfo.fanId)?.type || "",
                    quoteContent: quoteInfo.text || "",
                    playerMessage: message,
                    artistName: char?.artistName,
                    nickname: char?.nickname,
                    seaLevel
                });
                if (showoffResult?.showoffPost) {
                    // 注入到对应社交平台 feed
                    const post = showoffResult.showoffPost;
                    const platformKey = post.platform?.toLowerCase().includes("weibo") ? "weibo"
                        : post.platform?.toLowerCase().includes("twitter") || post.platform?.toLowerCase().includes("x") ? "twitter"
                        : "twitter";
                    const newPost = {
                        id: Date.now(),
                        author: post.author,
                        content: post.text,
                        likes: Math.floor(Math.random() * 3000) + 500,
                        time: "刚刚",
                        isFanPost: true,
                        fanId: quoteInfo.fanId
                    };
                    setSocialFeeds(prev => ({
                        ...prev,
                        [platformKey]: [newPost, ...(prev[platformKey] || [])].slice(0, 30)
                    }));
                }
                if (showoffResult?.jiefuSubmission) {
                    const sub = showoffResult.jiefuSubmission;
                    const jiefuPost = {
                        id: Date.now() + 1,
                        title: sub.title,
                        content: sub.content,
                        likes: Math.floor(Math.random() * 8000) + 1000,
                        comments: Math.floor(Math.random() * 200) + 30,
                        time: "刚刚",
                        submitter: sub.submitter
                    };
                    setSocialFeeds(prev => ({
                        ...prev,
                        jiefu: [jiefuPost, ...(prev.jiefu || [])].slice(0, 20)
                    }));
                    addWorldState(`${quoteInfo.fanName}在社交媒体炫耀被你引用，投稿到了姐夫站`);
                }
            } catch(e) {
                console.error('[fanShowoff] 炫耀帖生成失败:', e);
            }
        }
    };
    
    // 论坛
    const [forumCache, setForumCache] = React.useState({});
    const loadForum = async (platformId) => {
        // ⭐ cacheKey 加入 unlocked 数量 + 当前活跃事件，避免开局/恋爱后、以及剧情事件
        //   推进后仍共用同一份过时缓存（这是"帖子和当前剧情对不上"的另一半原因）。
        const evtTag = (activeEvents[0]?.name || "none").slice(0, 8);
        const cacheKey = `${platformId}_day${day}_sea${Math.floor(seaLevel/20)}_risk${Math.floor(currentRisk/3)}_unlock${unlocked.length}_evt${evtTag}`;
        // 先显示缓存内容（如果有）
        if (forumCache[cacheKey]) {
            setForumContext({ posts: forumCache[cacheKey], activePlatform: platformId, selectedPost: null, postTab: "hot" });
            addWorldState(`刷了${platformId === 'pann' ? 'Pann' : platformId === 'weibo' ? '微博' : '豆瓣'}论坛`);
            return;
        }
        setForumLoading(true); // ✅ 用独立 loading，不影响主线剧情转圈
        addWorldState(`刷了${platformId === 'pann' ? 'Pann' : platformId === 'weibo' ? '微博' : '豆瓣'}论坛`);
        const unlockedNames = unlocked.map(id => FANS.find(f => f.id === id)?.name).filter(Boolean);
        const gameContext = {
            artistName: char?.artistName, nickname: char?.nickname,
            day, seaLevel, riskLevel: currentRisk, fandomHeat, antiCount,
            recentEvent: activeEvents[0]?.name,
            worldStateSummary: worldState.join("；"),
            hasStartedDating: unlocked.length > 0,           // ⭐
            unlockedFans: unlockedNames,                     // ⭐
            forbidDatingGossip: unlocked.length === 0        // ⭐ 初始论坛只讨论公开人设/团内/作品
        };
        const result = await callEdgeFunction('forum', { platformId, gameContext });
        if (result?.error) {
            setForumLoading(false);
            alert(`📱 论坛加载失败：${result.error.slice(0, 80)}，请稍后再试。`);
            return;
        }
        const posts = result.posts || [];
        setForumContext({ posts, activePlatform: platformId, selectedPost: null, postTab: "hot" });
        setForumCache(prev => {
            // 限制保留最近 20 个 cacheKey，避免长期游玩内存累积（FIFO）
            const updated = { ...prev, [cacheKey]: posts };
            const keys = Object.keys(updated);
            if (keys.length > 20) {
                const trimmed = {};
                keys.slice(-20).forEach(k => { trimmed[k] = updated[k]; });
                return trimmed;
            }
            return updated;
        });
        setForumLoading(false);
    };
    
    const viewPost = async (post) => {
        setForumLoading(true); // ✅ 独立 loading，不影响主线剧情
        addWorldState(`看了帖子《${post.title.slice(0,20)}》`);
        const unlockedNames = unlocked.map(id => FANS.find(f => f.id === id)?.name).filter(Boolean);
        const gameContext = {
            artistName: char?.artistName, nickname: char?.nickname,
            seaLevel, riskLevel: currentRisk, antiCount, fandomHeat,
            day,
            hasStartedDating: unlocked.length > 0,
            unlockedFans: unlockedNames,
            forbidDatingGossip: unlocked.length === 0
        };
        const result = await callEdgeFunction('comments', {
            postTitle: post.title,
            // ⭐ 论坛帖的正文在 preview 字段（楼主内容+楼层），旧代码取 post.content（不存在）
            //   导致评论只凭一个耸动标题瞎编 → 牛头不对马嘴。现在优先用 preview。
            postContent: post.preview || post.content || post.title || "",
            postAuthor: post.author || post.submitter || "",    // ⭐ 谁发的
            platformId: forumContext.activePlatform,
            gameContext
        });
        if (result?.error) {
            setForumLoading(false);
            alert(`💬 评论加载失败：${result.error.slice(0, 80)}，请稍后再试。`);
            return;
        }
        setForumContext(prev => ({ ...prev, selectedPost: { ...post, comments: result.comments || [], hot_comment: result.hot_comment } }));
        setForumLoading(false);
    };
    
    // 风险等级
    const riskClass = currentRisk >= 7 ? "risk-high" : (currentRisk >= 4 ? "risk-mid" : "risk-low");
    const riskText = currentRisk >= 7 ? "🔴 危险" : (currentRisk >= 4 ? "🟡 注意" : "🟢 安全");
    const displayStory = loading && streamingStory ? streamingStory : currentStory;
    const currentEvent = activeEvents[0];
    
    // 侧边栏内容
    const SidebarContent = () => (
        <div className="sidebar">
            <div className="sidebar-header">
                <h2>{char?.artistName || char?.nickname || "晨晨"}</h2>
                <p>{char?.groupName || "NOVA"} · {char?.name || ""} · {char?.role || "全能ACE"}</p>
                <p style={{ fontSize: 10, color: "#b88dc7", marginTop: 4 }}>{char?.status || "跟团发展"}</p>
            </div>
            <div className="sidebar-section">
                <h4>📊 核心属性</h4>
                <div className="sidebar-item"><span>⭐ 人气值</span><span className="sidebar-value">{attrs.人气值}</span></div>
                <div className="sidebar-item"><span>💎 颜值</span><span className="sidebar-value">{attrs.颜值}</span></div>
                <div className="sidebar-item"><span>📺 国民度</span><span className="sidebar-value">{attrs.国民度}</span></div>
                <div className="sidebar-item"><span>💃 时尚度</span><span className="sidebar-value">{attrs.时尚度}</span></div>
                <div className="sidebar-item"><span>💰 资金</span><span className="sidebar-value">{money}万</span></div>
            </div>
            <div className="sidebar-section">
                <h4>🎤 实力属性</h4>
                <div className="sidebar-item"><span>🎵 Vocal</span><span className="sidebar-value">{attrs.vocal}</span></div>
                <div className="sidebar-item"><span>💃 Dance</span><span className="sidebar-value">{attrs.dance}</span></div>
                <div className="sidebar-item"><span>🎙️ Rap</span><span className="sidebar-value">{attrs.rap}</span></div>
                <div className="sidebar-item"><span>🧠 智商</span><span className="sidebar-value">{attrs.iq}</span></div>
                <div className="sidebar-item"><span>❤️ 情商</span><span className="sidebar-value">{attrs.eq}</span></div>
            </div>
            <div className="sidebar-section">
                <h4>⚠️ 风险与状态</h4>
                <div className="sidebar-item"><span>🌊 海后值</span><span className="sidebar-value">{seaLevel}</span></div>
                <div className="sidebar-item"><span>⚡ 暴露风险</span><span className="sidebar-value">{currentRisk}/10</span></div>
                <div className="sidebar-item"><span>🔥 粉圈热度</span><span className="sidebar-value">{fandomHeat}</span></div>
                <div className="sidebar-item"><span>🗡️ 黑粉数量</span><span className="sidebar-value">{antiCount}</span></div>
            </div>
            <div className="sidebar-section">
                <h4>❤️ 大关心动值</h4>
                {FANS.map(fan => {
                    const emotions = fanEmotions[fan.id];
                    return (
                        <div key={fan.id} className="heart-sidebar" onClick={() => setShowFanDetail(fan)}>
                            <span>{fan.emoji}</span>
                            <span style={{ width: 50 }}>{fan.name}</span>
                            <div className="heart-sidebar-bar"><div style={{ width: `${hearts[fan.id]}%`, height: "100%", background: fan.color, borderRadius: 4 }} /></div>
                            <span>{hearts[fan.id]}</span>
                            {hearts[fan.id] >= 90 && <span style={{ color: "#d946a8", fontSize: 10 }}>💗</span>}
                            {unlocked.includes(fan.id) && <span style={{ color: "#d946a8" }}>💌</span>}
                            {dmReadStatus[fan.id] && <span style={{ color: "#10b981", fontSize: 10 }}>✓</span>}
                            {emotions?.jealousy > 70 && <span style={{ color: "#fb923c", fontSize: 10 }}>😤</span>}
                        </div>
                    );
                })}
            </div>
            <div className="sidebar-section">
                <h4>🎪 队友</h4>
                {teammates?.map((tm, i) => (
                    <div key={i} className="sidebar-item"><span>{tm.name} ({tm.artistName})</span><span>{tm.role}</span></div>
                ))}
            </div>
            <div className="sidebar-section">
                <h4>📋 今日日程</h4>
                <div className="sidebar-item"><span>{currentSchedule.name}</span><span>素材+{currentSchedule.素材}</span></div>
            </div>
            <div className="sidebar-section">
                <h4>📱 社交账号</h4>
                <div className="sidebar-item"><span>🌐 Weverse</span><span>{char?.weverseId || "未设置"}</span></div>
                <div className="sidebar-item"><span>📷 Instagram</span><span>{char?.instagramId || "未设置"}</span></div>
                <div className="sidebar-item"><span>𝕏 Twitter</span><span>{char?.twitterId || "未设置"}</span></div>
                <div className="sidebar-item"><span>💬 Kakao</span><span>{char?.kakaoId || "未设置"}</span></div>
            </div>
            <div className="sidebar-section">
                <h4>⚙️ 系统</h4>
                <div className="sidebar-item" style={{ cursor: "pointer" }} onClick={() => { supabaseClient.auth.signOut(); onBack(); }}>🚪 退出登录</div>
                <div className="sidebar-item" style={{ cursor: "pointer" }} onClick={onBack}>💾 返回存档列表</div>
            </div>
        </div>
    );
    // ========== 渲染主内容 ==========
    const renderContent = () => {
        // 剧情页
        if (activeTab === "story") {
            return (
                <>
                    {currentEvent && (
                        <div style={{ background: "rgba(217,70,168,0.12)", borderRadius: 16, margin: "0 16px 12px", padding: "10px 14px" }}>
                            <span style={{ color: "#a855f7", fontSize: 11 }}>⚡ {currentEvent.name}</span>
                            <span style={{ color: "#9d6db8", fontSize: 11, marginLeft: 8 }}>阶段 {currentEvent.stage}/{currentEvent.maxStage}</span>
                            <div style={{ color: "#4a1d5a", fontSize: 11, marginTop: 4 }}>{currentEvent.currentDesc}</div>
                        </div>
                    )}
                    {coupleExposure && (
                        <div style={{ background: "rgba(236,72,153,0.2)", borderRadius: 16, margin: "0 16px 12px", padding: "10px 14px", border: "1px solid #ec4899" }}>
                            <span style={{ color: "#f9a8d4", fontSize: 11 }}>💕 {coupleExposure.fan}的{coupleExposure.item}被粉丝发现</span>
                        </div>
                    )}
                    {suspicion >= 5 && (
                        <div style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 14, margin: "0 16px 10px", padding: "8px 14px", fontSize: 11, color: "#fde68a" }}>
                            👀 {suspicion >= 8 ? "粉丝疑虑极高，论坛已有人在数据分析，下次任何可疑举动都会引爆舆论" : "已有粉丝注意到一些反常迹象，蛛丝马迹正在积累..."}
                        </div>
                    )}
                    {seaLevel > 60 && (
                        <div className="sea-warning">
                            ⚠️ 大粉们开始互相猜忌，私聊语气变酸，论坛出现"养鱼"讨论...
                        </div>
                    )}
                    {currentRisk >= 8 && (
                        <div className="high-heart-event" style={{ background: "linear-gradient(135deg, #ec4899, #a855f7)" }}>
                            🚨 狗仔/小号随时可能爆瓜，公司高管已在会议室等你（只会施压，不能替你做决定）。下一步选择将触发危机剧情。
                        </div>
                    )}
                    {highHeartEvent && (
                        <div className="high-heart-event">
                            💕 {highHeartEvent.message} 💕
                        </div>
                    )}
                    <div className="story-card">
                        {/* 氛围标签 */}
                        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 10, color: "#b88dc7" }}>🎭 氛围：</span>
                            <span style={{ fontSize: 10, fontWeight: "bold", color: seaLevel > 60 ? "#fb923c" : currentRisk > 5 ? "#f472b6" : Object.values(hearts).some(v => v > 80) ? "#ec4899" : "#10b981" }}>
                                {seaLevel > 70 ? "💢 暗流汹涌，粉圈地震" :
                                 seaLevel > 50 ? "🌊 暗流涌动，互相猜忌" :
                                 currentRisk > 7 ? "🚨 危如累卵，随时爆瓜" :
                                 currentRisk > 4 ? "⚠️ 风雨欲来，注意言行" :
                                 Object.values(hearts).some(v => v > 80) ? "💕 暧昧升温，心跳加速" :
                                 "☕ 日常营业"}
                            </span>
                        </div>
                        <div className="story-text">
                            {displayStory.split('\n').map((line, i) => {
                                if (line.startsWith('>')) return <div key={i} className="kakao-block">{line}</div>;
                                if (line.startsWith('【')) return <div key={i} className="forum-block">{line}</div>;
                                return <p key={i}>{line}</p>;
                            })}
                            {loading && !streamingStory && <span className="streaming-text">▊</span>}
                        </div>
                    </div>
                    {/* 舆论涟漪面板 */}
                    {(socialDynamics.length > 0 || dynamicLoading) && (
                        <div style={{ background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 16, margin: "0 16px 12px", padding: 12 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                                <div style={{ color: "#d946a8", fontSize: 11, fontWeight: "bold" }}>🌐 舆论涟漪·粉圈动态</div>
                                <div style={{ display: "flex", gap: 6 }}>
                                    <button style={{ background: "none", border: "1px solid rgba(217,70,168,0.3)", color: "#d946a8", fontSize: 9, borderRadius: 10, padding: "2px 8px", cursor: "pointer" }}
                                        onClick={() => triggerSocialDynamic(worldState.join("；") || "玩家日常营业")}>
                                        {dynamicLoading ? "⏳" : "🔄 刷新"}
                                    </button>
                                    <button style={{ background: "none", border: "none", color: "#b88dc7", fontSize: 10, cursor: "pointer" }} onClick={() => setSocialDynamics([])}>×</button>
                                </div>
                            </div>
                            {dynamicLoading && (
                                <div style={{ color: "#b88dc7", fontSize: 11, textAlign: "center", padding: "8px 0" }}>
                                    <div className="spinner" style={{ width: 16, height: 16, margin: "0 auto 6px" }}></div>
                                    正在同步社交媒体动态...
                                </div>
                            )}
                            {!dynamicLoading && socialDynamics.map((d, i) => (
                                <div key={i} style={{ background: "rgba(30,30,42,0.8)", borderRadius: 12, padding: 10, marginBottom: 8, borderLeft: `3px solid ${d.impactType === "risk" ? "#f472b6" : d.impactType === "popularity" ? "#10b981" : "#b88dc7"}` }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                        <span style={{ fontSize: 10, color: "#a855f7", fontWeight: "bold" }}>{d.platform}</span>
                                        <span style={{ fontSize: 10, color: d.impactType === "risk" ? "#f472b6" : "#b88dc7" }}>{d.impact}</span>
                                    </div>
                                    <div style={{ fontSize: 11, color: "#9d6db8", marginBottom: 3 }}>@{d.author}</div>
                                    <div style={{ fontSize: 12, color: "#4a1d5a", lineHeight: 1.5 }}>{d.content}</div>
                                </div>
                            ))}
                        </div>
                    )}
                    {businessComments && (
                        <div style={{ background: "#fdf4ff", borderRadius: 16, margin: "0 16px 12px", padding: 12 }}>
                            <div style={{ color: "#a855f7", fontSize: 11, marginBottom: 8 }}>💬 营业评论区</div>
                            {businessComments.slice(0, 6).map((c, i) => (
                                <div key={i} className="comment-item">
                                    <div className="comment-user" style={{ color: c.type === "blackfan" ? "#f472b6" : "#a855f7" }}>{c.user}</div>
                                    <div className="comment-text">{c.text}</div>
                                </div>
                            ))}
                        </div>
                    )}
                    {error && <div className="error-text">{error}</div>}
                    <div className="choices-container">
                        {loading ? (
                            <div className="loading-spinner"><div className="spinner"></div><div>AI 正在思考...</div></div>
                        ) : (
                            <>
                                {currentChoices.map((choice, idx) => (
                                    <button key={idx} className="choice-btn" onClick={() => handleChoice(choice)}>
                                        <span className="choice-label">{String.fromCharCode(65 + idx)}</span>
                                        <span>{choice}</span>
                                    </button>
                                ))}
                                {!customMode ? (
                                    <button className="choice-btn" onClick={() => setCustomMode(true)} style={{ border: "1px dashed #d946a8", textAlign: "center" }}>
                                        ✏️ 自定义行动
                                    </button>
                                ) : (
                                    <div>
                                        <textarea rows={2} placeholder="输入你想做的任何事..." value={customText} onChange={e => setCustomText(e.target.value)} />
                                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                                            <button onClick={handleCustom} className="btn-primary" style={{ flex: 1 }}>确认</button>
                                            <button onClick={() => { setCustomMode(false); setCustomText(""); }} className="btn-secondary" style={{ flex: 1 }}>取消</button>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </>
            );
        }
        
        // 关系图谱页
        if (activeTab === "relation") {
            return (
                <div style={{ padding: 16 }}>
                    <RelationGraph fans={FANS} hearts={hearts} onSelectFan={(fan) => setShowFanDetail(fan)} />
                    <div style={{ fontSize: 11, color: "#b88dc7", textAlign: "center", marginTop: 8 }}>
                        点击头像查看大粉详情（含吃醋度、出名事件）
                    </div>
                    {showFanDetail && (
                        <div className="modal-overlay" onClick={() => setShowFanDetail(null)}>
                            <div className="modal-content" onClick={e => e.stopPropagation()}>
                                <div className="modal-header">
                                    <h3>{showFanDetail.emoji} {showFanDetail.name}</h3>
                                    <button className="modal-close" onClick={() => setShowFanDetail(null)}>×</button>
                                </div>
                                <div style={{ padding: 20 }}>
                                    <div className="sidebar-item"><span>❤️ 好感度</span><span className="sidebar-value">{fanEmotions[showFanDetail.id]?.affection || 30}</span></div>
                                    <div className="sidebar-item"><span>🤝 信任度</span><span className="sidebar-value">{fanEmotions[showFanDetail.id]?.trust || 40}</span></div>
                                    <div className="sidebar-item"><span>🌀 痴迷度</span><span className="sidebar-value">{fanEmotions[showFanDetail.id]?.obsession || 20}</span></div>
                                    <div className="sidebar-item"><span>💢 吃醋度</span><span className="sidebar-value">{fanEmotions[showFanDetail.id]?.jealousy || 25}</span></div>
                                    <div className="sidebar-item"><span>💕 心动值</span><span className="sidebar-value">{hearts[showFanDetail.id]}</span></div>
                                    {hearts[showFanDetail.id] >= 90 && (
                                        <div style={{ background: "linear-gradient(135deg, #f472b6, #c084fc)", borderRadius: 12, padding: 8, marginBottom: 12, textAlign: "center" }}>
                                            <span style={{ color: "white", fontSize: 11 }}>💗 心动值≥90！他愿意为你做任何事，甚至当男小三</span>
                                        </div>
                                    )}
                                    {fanEmotions[showFanDetail.id]?.jealousy > 70 && (
                                        <div style={{ background: "rgba(251,191,36,0.2)", borderRadius: 12, padding: 8, marginBottom: 12, textAlign: "center" }}>
                                            <span style={{ color: "#fcd34d", fontSize: 11 }}>😤 吃醋度极高！他最近很敏感</span>
                                        </div>
                                    )}
                                    <div style={{ marginTop: 16 }}>
                                        <div style={{ color: "#a855f7", fontSize: 11, marginBottom: 8 }}>🔥 粉圈出名事件</div>
                                        <div className="famous-event"><div className="event-desc">{showFanDetail.famousEvent}</div></div>
                                    </div>
                                    {fanEmotions[showFanDetail.id]?.recentInteractions?.length > 0 && (
                                        <div style={{ marginTop: 16 }}>
                                            <div style={{ color: "#a855f7", fontSize: 11, marginBottom: 8 }}>📝 最近互动</div>
                                            {fanEmotions[showFanDetail.id].recentInteractions.slice(-3).map((m, i) => (
                                                <div key={i} style={{ fontSize: 11, color: "#9d6db8", padding: "4px 0" }}>• {m}</div>
                                            ))}
                                        </div>
                                    )}
                                    <button className="btn-primary" style={{ width: "100%", marginTop: 16 }} onClick={() => setShowFanDetail(null)}>关闭</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }
        
        // 手机桌面页
        if (activeTab === "phone") {
            return (
                <div className="phone-panel" style={{ position: "relative", bottom: "auto", maxHeight: "calc(100vh - 120px)" }}>
                    <div className="phone-header">
                        <h3>📱 {char?.artistName || "晨晨"}Phone</h3>
                        <button className="phone-close" onClick={() => setActiveTab("story")}>×</button>
                    </div>
                    <div className="phone-apps">
                        <div className="phone-app" onClick={() => setActiveModal("weverse")}><div className="phone-app-icon">🌐</div><div className="phone-app-name">Weverse</div></div>
                        <div className="phone-app" onClick={() => setActiveModal("kakao")}><div className="phone-app-icon">💬</div><div className="phone-app-name">KakaoTalk</div></div>
                        <div className="phone-app" onClick={() => setActiveModal("instagram")}><div className="phone-app-icon">📷</div><div className="phone-app-name">Instagram</div></div>
                        <div className="phone-app" onClick={() => { loadForum("pann"); setActiveModal("pann"); }}><div className="phone-app-icon">🔥</div><div className="phone-app-name">Pann</div></div>
                        <div className="phone-app" onClick={() => setActiveModal("twitter")}><div className="phone-app-icon">𝕏</div><div className="phone-app-name">Twitter</div></div>
                        <div className="phone-app" onClick={() => setActiveModal("tiktok")}><div className="phone-app-icon">🎵</div><div className="phone-app-name">TikTok</div></div>
                        <div className="phone-app" onClick={() => setActiveModal("cpost")}><div className="phone-app-icon">🌊</div><div className="phone-app-name">微博/豆瓣</div></div>
                        <div className="phone-app" onClick={() => setActiveModal("threads")}><div className="phone-app-icon">🧵</div><div className="phone-app-name">Threads</div></div>
                        <div className="phone-app" onClick={() => setActiveModal("jiefu")}><div className="phone-app-icon">⚠️</div><div className="phone-app-name">姐夫站</div></div>
                        <div className="phone-app" onClick={() => setActiveModal("youtube")}><div className="phone-app-icon">📺</div><div className="phone-app-name">YouTube</div></div>
                        <div className="phone-app" onClick={() => setActiveModal("shop")}><div className="phone-app-icon">🛒</div><div className="phone-app-name">商城</div></div>
                        <div className="phone-app" onClick={() => setActiveModal("company")}><div className="phone-app-icon">🏢</div><div className="phone-app-name">公司</div></div>
                        <div className="phone-app" onClick={() => setActiveModal("calendar")}><div className="phone-app-icon">📅</div><div className="phone-app-name">日程</div></div>
                        <div className="phone-app" onClick={() => { setActiveModal("graph"); setShowRelationGraph(true); }}><div className="phone-app-icon">🕸️</div><div className="phone-app-name">关系图谱</div></div>
                        <div className="phone-app" onClick={() => { setActiveModal("gift"); setShowGift(true); }}><div className="phone-app-icon">🎁</div><div className="phone-app-name">礼物</div></div>
                        <div className="phone-app" onClick={() => setActiveModal("sns")}><div className="phone-app-icon">🎭</div><div className="phone-app-name">匿名小号</div></div>
                    </div>
                </div>
            );
        }
        
        // 设置页
        if (activeTab === "settings") {
            return (
                <div style={{ padding: 16 }}>
                    <div className="sidebar-section">
                        <h4>📊 核心属性</h4>
                        <div className="sidebar-item"><span>⭐ 人气值</span><span className="sidebar-value">{attrs.人气值}</span></div>
                        <div className="sidebar-item"><span>💎 颜值</span><span className="sidebar-value">{attrs.颜值}</span></div>
                        <div className="sidebar-item"><span>📺 国民度</span><span className="sidebar-value">{attrs.国民度}</span></div>
                        <div className="sidebar-item"><span>💃 时尚度</span><span className="sidebar-value">{attrs.时尚度}</span></div>
                        <div className="sidebar-item"><span>💰 资金</span><span className="sidebar-value">{money}万</span></div>
                    </div>
                    <div className="sidebar-section">
                        <h4>🎤 实力属性</h4>
                        <div className="sidebar-item"><span>🎵 Vocal</span><span className="sidebar-value">{attrs.vocal}</span></div>
                        <div className="sidebar-item"><span>💃 Dance</span><span className="sidebar-value">{attrs.dance}</span></div>
                        <div className="sidebar-item"><span>🎙️ Rap</span><span className="sidebar-value">{attrs.rap}</span></div>
                        <div className="sidebar-item"><span>🧠 智商</span><span className="sidebar-value">{attrs.iq}</span></div>
                        <div className="sidebar-item"><span>❤️ 情商</span><span className="sidebar-value">{attrs.eq}</span></div>
                    </div>
                    <div className="sidebar-section">
                        <h4>⚠️ 风险与状态</h4>
                        <div className="sidebar-item"><span>🌊 海后值</span><span className="sidebar-value">{seaLevel}</span></div>
                        <div className="sidebar-item"><span>⚡ 暴露风险</span><span className="sidebar-value">{currentRisk}/10</span></div>
                        <div className="sidebar-item"><span>🔥 粉圈热度</span><span className="sidebar-value">{fandomHeat}</span></div>
                        <div className="sidebar-item"><span>🗡️ 黑粉数量</span><span className="sidebar-value">{antiCount}</span></div>
                    </div>
                    <div className="sidebar-section">
                        <h4>❤️ 大关心动值</h4>
                        {FANS.map(fan => (
                            <div key={fan.id} className="heart-sidebar" onClick={() => setShowFanDetail(fan)}>
                                <span>{fan.emoji}</span>
                                <span style={{ width: 50 }}>{fan.name}</span>
                                <div className="heart-sidebar-bar"><div style={{ width: `${hearts[fan.id]}%`, height: "100%", background: fan.color, borderRadius: 4 }} /></div>
                                <span>{hearts[fan.id]}</span>
                                {hearts[fan.id] >= 90 && <span style={{ color: "#d946a8", fontSize: 10, marginLeft: 4 }}>💗</span>}
                                {unlocked.includes(fan.id) && <span style={{ color: "#d946a8" }}>💌</span>}
                                {dmReadStatus[fan.id] && <span style={{ color: "#10b981", fontSize: 10 }}>✓</span>}
                                {fanEmotions[fan.id]?.jealousy > 70 && <span style={{ color: "#fb923c", fontSize: 10 }}>😤</span>}
                            </div>
                        ))}
                    </div>
                    <div className="sidebar-section">
                        <h4>🎪 队友</h4>
                        {teammates?.map((tm, i) => (
                            <div key={i} className="sidebar-item"><span>{tm.name} ({tm.artistName})</span><span>{tm.role}</span></div>
                        ))}
                    </div>
                    <div className="sidebar-section">
                        <h4>📋 今日日程</h4>
                        <div className="sidebar-item"><span>{currentSchedule.name}</span><span>素材+{currentSchedule.素材}</span></div>
                    </div>
                    <div className="sidebar-section">
                        <h4>📱 社交账号</h4>
                        <div className="sidebar-item"><span>🌐 Weverse</span><span>{char?.weverseId || "未设置"}</span></div>
                        <div className="sidebar-item"><span>📷 Instagram</span><span>{char?.instagramId || "未设置"}</span></div>
                        <div className="sidebar-item"><span>𝕏 Twitter</span><span>{char?.twitterId || "未设置"}</span></div>
                        <div className="sidebar-item"><span>💬 Kakao</span><span>{char?.kakaoId || "未设置"}</span></div>
                        <div className="sidebar-item"><span>🎵 TikTok</span><span>{char?.tiktokId || "未设置"}</span></div>
                        <div className="sidebar-item"><span>🌊 微博</span><span>{char?.weiboId || "未设置"}</span></div>
                        <div className="sidebar-item"><span>🧵 Threads</span><span>{char?.threadsId || "未设置"}</span></div>
                    </div>
                    <div className="sidebar-section">
                        <h4>⚙️ 系统</h4>
                        <div className="sidebar-item" style={{ cursor: "pointer" }} onClick={() => { supabaseClient.auth.signOut(); onBack(); }}>🚪 退出登录</div>
                        <div className="sidebar-item" style={{ cursor: "pointer" }} onClick={onBack}>💾 返回存档列表</div>
                    </div>
                </div>
            );
        }
        
        return null;
    };
    // ========== 弹窗渲染 ==========
    const renderModal = () => {
        // ========== 通用社交 App（feed + 发帖 + 评论 + 点赞 + 做数据）==========
        if (["youtube", "instagram", "twitter", "tiktok", "threads"].includes(activeModal)) {
            const key = activeModal;
            const cfg = SOCIAL_CFG[key];
            const feed = socialFeeds[key] || [];
            const loading = socialLoadingKey === key;
            return (
                <div className="modal-overlay" onClick={() => setActiveModal(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3>{cfg.title}{key === "tiktok" && tiktokAlt && <span style={{ fontSize: 12, color: "#a855f7", marginLeft: 8 }}>· 小号</span>}</h3><button className="modal-close" onClick={() => setActiveModal(null)}>×</button></div>
                        <div style={{ padding: 16, overflowY: "auto" }}>
                            {key === "youtube" && (
                                <div className="weverse-tabs">
                                    <button className={`weverse-tab ${youtubeTab === "videos" ? "active" : ""}`} onClick={() => setYoutubeTab("videos")}>视频</button>
                                    <button className={`weverse-tab ${youtubeTab === "shorts" ? "active" : ""}`} onClick={() => setYoutubeTab("shorts")}>Shorts</button>
                                </div>
                            )}
                            {cfg.canPost && (
                                <button className="btn-primary compose-fab" onClick={() => setPostComposer({ platformKey: key })}>+ 发布{cfg.kind}</button>
                            )}
                            {key === "instagram" && unlocked.length > 0 && (
                                <div style={{ marginBottom: 14 }}>
                                    <div style={{ fontSize: 11, color: "#9d6db8", marginBottom: 6 }}>📱 小号 · INS私信（DM）已互关大粉</div>
                                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                        {unlocked.map(id => {
                                            const fan = FANS.find(f => f.id === id);
                                            return fan ? (
                                                <button key={id} style={{ background: `${fan.color}22`, border: `1px solid ${fan.color}44`, color: fan.color, borderRadius: 16, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}
                                                    onClick={() => { setShowPrivateChat(fan); setActiveModal("kakao_dm"); }}>
                                                    {fan.emoji} {fan.name}
                                                </button>
                                            ) : null;
                                        })}
                                    </div>
                                </div>
                            )}
                            {key === "tiktok" && (
                                <div style={{ marginBottom: 8 }}>
                                    <button className="btn-secondary" style={{ width: "100%", marginBottom: 6 }} onClick={() => setTiktokAlt(v => !v)}>🔁 {tiktokAlt ? "切回大号" : "切换小号（和大粉互关）"}</button>
                                    {tiktokAlt && unlocked.length > 0 && (
                                        <div>
                                            <div style={{ fontSize: 11, color: "#9d6db8", marginBottom: 6 }}>TikTok小号已互关的大粉（可私信）：</div>
                                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                                {unlocked.map(id => {
                                                    const fan = FANS.find(f => f.id === id);
                                                    return fan ? (
                                                        <button key={id} style={{ background: `${fan.color}22`, border: `1px solid ${fan.color}44`, color: fan.color, borderRadius: 16, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}
                                                            onClick={() => { setShowPrivateChat(fan); setActiveModal("kakao_dm"); }}>
                                                            {fan.emoji} {fan.name}
                                                        </button>
                                                    ) : null;
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                            {loading && <div className="loading-spinner"><div className="spinner"></div></div>}
                            {!loading && feed.length === 0 && <div style={{ color: "#b88dc7", textAlign: "center", padding: 20 }}>还没有内容，发一条吧~</div>}
                            {feed.map(post => (
                                <PostCard key={post.id} post={post} cfg={cfg} artistName={char?.artistName}
                                    onOpen={p => openComments(key, p)} onLike={id => toggleLike(key, id)} onData={id => farmData(key, id)} />
                            ))}
                        </div>
                    </div>
                </div>
            );
        }

        // ========== 微博/豆瓣（中国平台，含子tab）==========
        if (activeModal === "cpost") {
            const key = `cpost:${cpostTab}`;
            const cfg = SOCIAL_CFG[key];
            const feed = socialFeeds[key] || [];
            const loading = socialLoadingKey === key;
            return (
                <div className="modal-overlay" onClick={() => setActiveModal(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3>{cfg.title}</h3><button className="modal-close" onClick={() => setActiveModal(null)}>×</button></div>
                        <div style={{ padding: 16, overflowY: "auto" }}>
                            <div className="weverse-tabs">
                                <button className={`weverse-tab ${cpostTab === "weibo" ? "active" : ""}`} onClick={() => setCpostTab("weibo")}>微博</button>
                                <button className={`weverse-tab ${cpostTab === "douban" ? "active" : ""}`} onClick={() => setCpostTab("douban")}>豆瓣</button>
                            </div>
                            {cfg.canPost && (
                                <button className="btn-primary compose-fab" onClick={() => setPostComposer({ platformKey: key })}>+ 发微博</button>
                            )}
                            {loading && <div className="loading-spinner"><div className="spinner"></div></div>}
                            {feed.map(post => (
                                <PostCard key={post.id} post={post} cfg={cfg} artistName={char?.artistName}
                                    onOpen={p => openComments(key, p)} onLike={id => toggleLike(key, id)} onData={id => farmData(key, id)} />
                            ))}
                        </div>
                    </div>
                </div>
            );
        }

        // ========== 姐夫站（辱追投稿，含子tab）==========
        if (activeModal === "jiefu") {
            const key = `jiefu:${jiefuTab}`;
            const cfg = SOCIAL_CFG[key];
            const feed = socialFeeds[key] || [];
            const loading = socialLoadingKey === key;
            return (
                <div className="modal-overlay" onClick={() => setActiveModal(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3>{cfg.title}</h3><button className="modal-close" onClick={() => setActiveModal(null)}>×</button></div>
                        <div style={{ padding: 16, overflowY: "auto" }}>
                            <div className="weverse-tabs">
                                <button className={`weverse-tab ${jiefuTab === "jiefu" ? "active" : ""}`} onClick={() => setJiefuTab("jiefu")}>姐夫你别这样</button>
                                <button className={`weverse-tab ${jiefuTab === "jiefubing" ? "active" : ""}`} onClick={() => setJiefuTab("jiefubing")}>有姐夫病没姐夫命</button>
                            </div>
                            <div style={{ fontSize: 11, color: "#b88dc7", marginBottom: 12 }}>💡 这里是粉丝/辱追的投稿区，你只能围观和点开看评论</div>
                            {loading && <div className="loading-spinner"><div className="spinner"></div></div>}
                            {feed.map(post => (
                                <PostCard key={post.id} post={post} cfg={cfg} artistName={char?.artistName}
                                    onOpen={p => openComments(key, p)} onLike={id => toggleLike(key, id)} onData={id => farmData(key, id)} />
                            ))}
                        </div>
                    </div>
                </div>
            );
        }

        // ========== 论坛帖子列表 ==========
        if (activeModal === "pann" && !forumContext.selectedPost) {
            const filteredPosts = forumContext.posts.filter(p => {
                if (forumContext.postTab === "hot") return true;
                return p.comments_count > 50;
            });
            return (
                <div className="modal-overlay" onClick={() => setActiveModal(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3>🔥 Pann</h3><button className="modal-close" onClick={() => setActiveModal(null)}>×</button></div>
                        <div className="forum-header">
                            <button className={`forum-tab ${forumContext.postTab === "hot" ? "active" : ""}`} onClick={() => setForumContext(prev => ({ ...prev, postTab: "hot" }))}>热门</button>
                            <button className={`forum-tab ${forumContext.postTab === "latest" ? "active" : ""}`} onClick={() => setForumContext(prev => ({ ...prev, postTab: "latest" }))}>最新</button>
                        </div>
                        <div style={{ padding: 16, overflowY: "auto" }}>
                            {forumLoading && (
                                <div>
                                    {[1,2,3].map(i => (
                                        <div key={i} style={{ background: "#ffffff", borderRadius: 16, padding: 16, marginBottom: 12, animation: "pulse 1.5s infinite" }}>
                                            <div style={{ height: 16, background: "#fce7f3", borderRadius: 8, marginBottom: 8, width: `${60 + i * 10}%` }}></div>
                                            <div style={{ height: 10, background: "#fce7f3", borderRadius: 6, width: "40%" }}></div>
                                        </div>
                                    ))}
                                    <div style={{ color: "#b88dc7", textAlign: "center", fontSize: 11 }}>正在连接 Pann...</div>
                                </div>
                            )}
                            {!forumLoading && forumContext.posts.length === 0 && (
                                <div style={{ textAlign: "center", padding: "40px 20px", color: "#b88dc7" }}>
                                    <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
                                    <div style={{ fontSize: 13, marginBottom: 16 }}>论坛暂时没刷出帖子，可能是网络或服务器繁忙。</div>
                                    <button className="btn-primary" style={{ padding: "8px 20px", fontSize: 12 }}
                                        onClick={() => { setForumCache(prev => { const c = { ...prev }; Object.keys(c).filter(k => k.startsWith(forumContext.activePlatform)).forEach(k => delete c[k]); return c; }); loadForum(forumContext.activePlatform); }}>
                                        🔄 重新加载
                                    </button>
                                </div>
                            )}
                            {!forumLoading && filteredPosts.map((post, i) => {
                                // 根据海后值/风险值生成舆论氛围标签
                                const opinionTag = seaLevel > 60 ? { text: "⚡ 粉圈在讨论", color: "#fb923c" } :
                                    currentRisk >= 5 ? { text: "🔍 有人扒料中", color: "#f472b6" } :
                                    seaLevel > 30 ? { text: "👀 有些奇怪风向", color: "#a855f7" } :
                                    { text: "🌱 安全", color: "#10b981" };
                                return (
                                <div key={i} className="forum-post" onClick={() => viewPost(post)}>
                                    <div className="forum-title">{post.title}</div>
                                    <div className="forum-stats">
                                        <span>🔥 {post.heat || "8.2万"}</span>
                                        <span>💬 {post.comments_count || 234}条评论</span>
                                        <span style={{ color: opinionTag.color }}>{opinionTag.text}</span>
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            );
        }

        // ========== 论坛帖子详情（评论区） ==========
        if (activeModal === "pann" && forumContext.selectedPost) {
            return (
                <div className="modal-overlay" onClick={() => setForumContext(prev => ({ ...prev, selectedPost: null }))}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3>🔥 {forumContext.selectedPost.title}</h3><button className="modal-close" onClick={() => setForumContext(prev => ({ ...prev, selectedPost: null }))}>×</button></div>
                        <div style={{ padding: 16, overflowY: "auto" }}>
                            {forumLoading && <div className="loading-spinner"><div className="spinner"></div><div>加载评论中...</div></div>}
                            {/* ⭐ 楼主正文：后端在 preview 字段返回（楼主内容+楼层），之前从不显示，
                                导致点进帖子直接是评论、看着很割裂。现在补上正文区。 */}
                            {(forumContext.selectedPost.preview || forumContext.selectedPost.content) && (
                                <div style={{ background: "rgba(168,85,247,0.06)", borderRadius: 12, padding: 14, marginBottom: 14, whiteSpace: "pre-wrap", color: "#4a1d5a", fontSize: 13, lineHeight: 1.7 }}>
                                    {forumContext.selectedPost.preview || forumContext.selectedPost.content}
                                </div>
                            )}
                            {forumContext.selectedPost.hot_comment && (
                                <div style={{ background: "rgba(250,204,21,0.1)", borderRadius: 12, padding: 12, marginBottom: 12 }}>
                                    <span style={{ color: "#a855f7", fontSize: 11 }}>🏆 最高赞 · {forumContext.selectedPost.hot_comment.user}</span>
                                    <div style={{ color: "#4a1d5a", fontSize: 13, marginTop: 4 }}>{forumContext.selectedPost.hot_comment.text}</div>
                                </div>
                            )}
                            {forumContext.selectedPost.comments?.map((c, i) => (
                                <div key={i} className="comment-item">
                                    <div className="comment-user" style={{ color: c.type === "blackfan" ? "#f472b6" : "#a855f7" }}>{c.user}</div>
                                    <div className="comment-text">{c.text}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            );
        }

        // ========== Weverse（含付费DM） ==========
        if (activeModal === "weverse") {
            // 付费DM线程消息渲染
            const dmThread = paidDmDaily.thread || [];
            // dmEndRef 已在组件顶层用 useRef 声明，不在这里重建

            return (
                <div className="modal-overlay" onClick={() => setActiveModal(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ height: "85vh", display: "flex", flexDirection: "column" }}>
                        <div className="modal-header"><h3>🌐 Weverse</h3><button className="modal-close" onClick={() => setActiveModal(null)}>×</button></div>
                        
                        <div className="weverse-tabs" style={{ flexShrink: 0 }}>
                            <button className={`weverse-tab ${weverseTab === "dm" ? "active" : ""}`} onClick={() => setWeverseTab("dm")}>💎 DM</button>
                            <button className={`weverse-tab ${weverseTab === "community" ? "active" : ""}`} onClick={() => setWeverseTab("community")}>📣 社区</button>
                            <button className={`weverse-tab ${weverseTab === "live" ? "active" : ""}`} onClick={() => setWeverseTab("live")}>🎥 直播</button>
                        </div>

                        {/* DM 线程页 */}
                        {weverseTab === "dm" && (
                            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                                {/* DM 头部说明 */}
                                <div style={{ padding: "8px 16px", background: "rgba(225,29,72,0.06)", borderBottom: "1px solid rgba(217,70,168,0.08)", flexShrink: 0 }}>
                                    <div style={{ fontSize: 11, color: "#a855f7" }}>💎 Weverse DM · 付费订阅群发</div>
                                    <div style={{ fontSize: 10, color: "#b88dc7", marginTop: 2 }}>
                                        发消息给所有付费粉丝 · 大粉会单独私回你 · 随时可以继续发
                                    </div>
                                </div>
                                {/* 消息线程 */}
                                <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
                                    {dmThread.length === 0 && (
                                        <div style={{ color: "#9d6db8", textAlign: "center", padding: "30px 0", fontSize: 12 }}>
                                            发一条群发DM，看看大家怎么回应吧～
                                        </div>
                                    )}
                                    {dmThread.map((msg, i) => {
                                        const isPlayer = msg.from === "player";
                                        const isCommonFan = msg.from === "common_fan" || msg.senderType === "common_fan";
                                        const isBigFan = !isPlayer && !isCommonFan;
                                        const fan = isBigFan ? FANS.find(f => f.id === msg.from) : null;
                                        // 引用消息预览
                                        const quoteInfo = msg.quoteInfo;
                                        return (
                                            <div key={msg.id || i} style={{ marginBottom: 12, display: "flex", flexDirection: "column", alignItems: isPlayer ? "flex-end" : "flex-start" }}>
                                                {/* 引用标注 */}
                                                {quoteInfo && isPlayer && (
                                                    <div style={{ fontSize: 9, color: "#b88dc7", marginBottom: 4, paddingRight: 4, maxWidth: "80%", textAlign: "right" }}>
                                                        💬 回复了 {quoteInfo.fanName} 的私回：「{(quoteInfo.text||"").slice(0,20)}…」
                                                    </div>
                                                )}
                                                {isPlayer ? (
                                                    // 玩家发出的群发
                                                    <div style={{ maxWidth: "80%", background: "rgba(225,29,72,0.18)", border: "1px solid rgba(217,70,168,0.3)", borderRadius: "16px 16px 4px 16px", padding: "10px 14px" }}>
                                                        <div style={{ fontSize: 9, color: "#d946a8", marginBottom: 4 }}>📣 {char?.nickname || char?.artistName} · {msg.time}</div>
                                                        <div style={{ color: "#4a1d5a", fontSize: 13, lineHeight: 1.6 }}>{msg.text}</div>
                                                    </div>
                                                ) : isCommonFan ? (
                                                    // 普通粉丝回复（轻量样式）
                                                    <div style={{ maxWidth: "82%", display: "flex", gap: 6, alignItems: "flex-start" }}>
                                                        <div style={{ width: 24, height: 24, borderRadius: "50%", background: `hsl(${(msg.senderName||"").charCodeAt(0)*37%360||200},35%,55%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, flexShrink: 0, color: "white" }}>
                                                            {(msg.senderName||"粉")[0]}
                                                        </div>
                                                        <div>
                                                            <div style={{ fontSize: 9, color: "#9d6db8", marginBottom: 3 }}>
                                                                <span style={{ fontWeight: 600 }}>{msg.senderName || "粉丝"}</span>
                                                                <span style={{ marginLeft: 4, opacity: 0.7 }}>· {msg.time}</span>
                                                            </div>
                                                            <div style={{ background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.15)", borderRadius: "4px 14px 14px 14px", padding: "7px 12px" }}>
                                                                <div style={{ color: "#6b3d7e", fontSize: 12, lineHeight: 1.5 }}>{msg.text}</div>
                                                            </div>
                                                            <button onClick={() => {
                                                                setQuotingFan(msg.id);
                                                                setQuotingMsgInfo({ name: msg.senderName || "粉丝", text: msg.text, fanId: null });
                                                            }} style={{ fontSize: 9, color: "#b88dc7", background: "none", border: "none", cursor: "pointer", marginTop: 3, padding: 0 }}>
                                                                💬 引用
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    // 大粉私回（视觉和普通粉丝同款列表，只是颜色+标签区分）
                                                    <div style={{ maxWidth: "85%", display: "flex", gap: 8, alignItems: "flex-start" }}>
                                                        <div style={{ width: 32, height: 32, borderRadius: "50%", background: fan?.color || "#9d6db8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>{fan?.emoji || "👤"}</div>
                                                        <div>
                                                            <div style={{ fontSize: 10, color: fan?.color || "#9d6db8", marginBottom: 4, display: "flex", gap: 6, alignItems: "center" }}>
                                                                <span style={{ fontWeight: "bold" }}>{fan?.name || msg.senderName || msg.from}</span>
                                                                <span style={{ fontSize: 9, background: (fan?.color || "#9d6db8") + "22", padding: "1px 5px", borderRadius: 6 }}>大粉</span>
                                                                <span style={{ color: "#9d6db8" }}>· ❤️{hearts[fan?.id]}</span>
                                                                <span style={{ color: "#9d6db8" }}>· {msg.time}</span>
                                                            </div>
                                                            <div style={{ background: `${fan?.color || "#9d6db8"}14`, border: `1px solid ${fan?.color || "#9d6db8"}33`, borderRadius: "4px 16px 16px 16px", padding: "10px 14px" }}>
                                                                <div style={{ color: "#4a1d5a", fontSize: 13, lineHeight: 1.6 }}>{msg.text}</div>
                                                            </div>
                                                            {/* 引用按钮：传完整 quoteInfo 对象 */}
                                                            <button onClick={() => {
                                                                setQuotingFan(msg.id);
                                                                setQuotingMsgInfo({ name: fan?.name, text: msg.text, fanId: fan?.id });
                                                            }} style={{ fontSize: 9, color: "#b88dc7", background: "none", border: "none", cursor: "pointer", marginTop: 4, padding: 0 }}>
                                                                💬 引用回复 {fan?.name ? `（可触发炫耀帖）` : ""}
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    <div ref={dmEndRef} />
                                </div>
                                {/* 输入区（引用提示 + 发送） */}
                                <div style={{ padding: "10px 16px", background: "#ffffff", borderTop: "1px solid rgba(217,70,168,0.1)", flexShrink: 0 }}>
                                    {quotingMsgInfo && (
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(100,100,120,0.12)", borderRadius: 8, padding: "5px 10px", marginBottom: 8, fontSize: 11 }}>
                                            <div>
                                                <span style={{ color: "#9d6db8" }}>💬 引用 <b>{quotingMsgInfo.name}</b> 的回复</span>
                                                <div style={{ color: "#b88dc7", fontSize: 9, marginTop: 1 }}>「{(quotingMsgInfo.text||"").slice(0,30)}…」</div>
                                            </div>
                                            <button onClick={() => { setQuotingFan(null); setQuotingMsgInfo(null); }} style={{ color: "#b88dc7", background: "none", border: "none", cursor: "pointer", fontSize: 13 }}>×</button>
                                        </div>
                                    )}
                                    <div style={{ display: "flex", gap: 8 }}>
                                        <input id="wdmInput" placeholder={quotingMsgInfo ? `回复 ${quotingMsgInfo.name}…` : "给大家发条消息..."}
                                            style={{ flex: 1, background: "#ffffff", border: "1px solid #f3d5ed", borderRadius: 20, padding: "10px 14px", color: "#4a1d5a", fontSize: 13 }}
                                            onKeyDown={e => {
                                                if (e.key === "Enter" && e.target.value.trim()) {
                                                    sendPaidDM(e.target.value.trim(), quotingMsgInfo);
                                                    e.target.value = "";
                                                }
                                            }} />
                                        <button className="btn-primary" style={{ padding: "10px 16px", fontSize: 12 }} onClick={() => {
                                            const el = document.getElementById("wdmInput");
                                            if (el?.value?.trim()) { sendPaidDM(el.value.trim(), quotingMsgInfo); el.value = ""; }
                                        }}>发送</button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 社区动态页 */}
                        {weverseTab === "community" && (
                            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
                                <button className="btn-primary" style={{ width: "100%", marginBottom: 12 }} onClick={() => setPostComposer({ platformKey: "weverse" })}>+ 发布动态</button>
                                {(socialFeeds["weverse"] || []).length === 0 && (
                                    <div className="weverse-post"><div className="post-content" style={{ color: "#b88dc7" }}>还没发过动态，点上面发布吧~</div></div>
                                )}
                                {(socialFeeds["weverse"] || []).map(post => (
                                    <PostCard key={post.id} post={post} cfg={SOCIAL_CFG["weverse"]} artistName={char?.artistName}
                                        onOpen={p => openComments("weverse", p)} onLike={id => toggleLike("weverse", id)} onData={id => farmData("weverse", id)} />
                                ))}
                            </div>
                        )}

                        {/* 直播入口页 */}
                        {weverseTab === "live" && (
                            <div style={{ flex: 1, padding: 24, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
                                <div style={{ fontSize: 48 }}>📡</div>
                                <div style={{ color: "#4a1d5a", fontSize: 18, fontWeight: "bold" }}>Weverse LIVE</div>
                                <div style={{ color: "#b88dc7", fontSize: 12, textAlign: "center" }}>
                                    只有Weverse才能开播<br/>直播会对所有订阅粉丝可见
                                </div>
                                {liveActive ? (
                                    <div style={{ color: "#f472b6", fontWeight: "bold" }}>🔴 直播进行中...</div>
                                ) : (
                                    <button className="btn-primary" style={{ padding: "14px 40px", fontSize: 16 }} onClick={() => setActiveModal("live")}>
                                        🔴 开始直播
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        // ========== KakaoTalk 联系人列表 ==========
        if (activeModal === "kakao") {
            const defaultContacts = [
                { id: "_group", name: `${char?.groupName || "EHP"} 仙女群`, type: "group", emoji: "👯", color: "#10b981", isDefault: true, desc: "队友们的秘密小群" },
                { id: "_manager", name: "金室长（经纪人）", type: "manager", emoji: "👔", color: "#a855f7", isDefault: true, desc: "公司专属经纪人" },
                { id: "_stylist", name: "造型师小徐", type: "stylist", emoji: "💄", color: "#ec4899", isDefault: true, desc: "造型团队负责人" }
            ];
            const unlockedContacts = unlocked.map(id => FANS.find(f => f.id === id)).filter(Boolean);
            const allContacts = [...defaultContacts, ...unlockedContacts];
            return (
                <div className="modal-overlay" onClick={() => setActiveModal(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ height: "75vh" }}>
                        <div className="modal-header" style={{ background: "linear-gradient(135deg, #ec4899, #a855f7)", borderRadius: "28px 28px 0 0" }}>
                            <h3 style={{ color: "white" }}>💬 KakaoTalk</h3>
                            <button className="modal-close" onClick={() => setActiveModal(null)} style={{ color: "white" }}>×</button>
                        </div>
                        <div style={{ padding: 16, overflowY: "auto" }}>
                            {unlockedContacts.length === 0 && (
                                <div style={{ background: "rgba(250,204,21,0.08)", borderRadius: 12, padding: 12, marginBottom: 12, fontSize: 11, color: "#9d6db8" }}>
                                    💡 大粉的私联号码会在剧情中解锁——<br/>签售悄悄塞纸条、发现小号、公司代为传话…
                                </div>
                            )}
                            {allContacts.map((contact, i) => (
                                <div key={contact.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, background: "#ffffff", borderRadius: 16, marginBottom: 8, cursor: "pointer", transition: "background 0.15s" }}
                                    onClick={() => {
                                        if (!contact.isDefault) {
                                            setShowPrivateChat(contact); setActiveModal("kakao_dm");
                                        } else {
                                            // 默认联系人：只记录后台，不推主线，就地 toast 反馈
                                            const msgs = {
                                                "_group": `和${char?.groupName || "队友"}的小群聊了聊今天的行程`,
                                                "_manager": `和经纪人金室长确认了今天的行程安排`,
                                                "_stylist": `和造型师小徐沟通了明天的造型方案`
                                            };
                                            const toasts = {
                                                "_group": `👯 ${char?.groupName || "队友"}群：大家在讨论明天的排练和饭局`,
                                                "_manager": `👔 金室长：行程已确认，注意休息`,
                                                "_stylist": `💄 小徐：方案已收到，明天见！`
                                            };
                                            addWorldState(msgs[contact.id] || "刷了一眼聊天记录");
                                            setToastMsg(toasts[contact.id] || "📱 看了一眼消息");
                                            setTimeout(() => setToastMsg(""), 3000);
                                        }
                                    }}>
                                    <div style={{ width: 44, height: 44, borderRadius: 12, background: contact.color || "#d946a8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{contact.emoji}</div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ color: "#4a1d5a", fontWeight: "bold", fontSize: 14 }}>{contact.name}</div>
                                        <div style={{ fontSize: 11, color: "#b88dc7", marginTop: 2 }}>
                                            {contact.isDefault ? contact.desc : `${contact.type} · ❤️${hearts[contact.id]}`}
                                        </div>
                                    </div>
                                    {!contact.isDefault && (
                                        <div style={{ textAlign: "right" }}>
                                            <div style={{ fontSize: 9, color: "#d946a8" }}>💌 私联成功</div>
                                            {dmHistories[contact.id]?.length > 0 && (
                                                <div style={{ fontSize: 9, color: "#b88dc7", marginTop: 2 }}>
                                                    {dmHistories[contact.id].slice(-1)[0]?.content?.slice(0, 12)}...
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            );
        }
        // ========== KakaoTalk 私聊 ==========
        if (activeModal === "kakao_dm" && showPrivateChat) {
            const jealousy = fanEmotions[showPrivateChat.id]?.jealousy || 25;
            const msgs = dmHistories[showPrivateChat.id] || [];
            const sendFromInput = () => {
                const el = document.getElementById("dmInput");
                const text = el?.value?.trim();
                if (text) { sendDM(showPrivateChat, text, null); el.value = ""; }
            };
            const startVideoCall = () => {
                // 视频通话：记录后台，不推主线
                const riskInc = unlocked.includes(showPrivateChat.id) ? 1 : 3;
                updateRisk(riskInc);
                updateHearts({ [showPrivateChat.id]: 5 });
                addWorldState(`和${showPrivateChat.name}视频通话了，通话氛围${jealousy > 60 ? "有点紧张他有点吃醋" : hearts[showPrivateChat.id] > 70 ? "非常暧昧" : "还算自然"}`);
                setToastMsg(`📹 和${showPrivateChat.name}视频通话中… 心动+5${riskInc > 1 ? `，风险+${riskInc}` : ""}`);
                setTimeout(() => setToastMsg(""), 3500);
            };
            return (
                <div className="modal-overlay" onClick={() => { setActiveModal(null); setShowPrivateChat(null); }}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ height: "80vh" }}>
                        <div className="modal-header" style={{ background: "linear-gradient(135deg, #ec4899, #a855f7)", borderBottom: "1px solid #fbbf24" }}>
                            <div style={{ display: "flex", flexDirection: "column" }}>
                                <h3 style={{ margin: 0 }}>
                                    <span style={{ fontSize: 10, color: "#fbbf24", marginRight: 6, verticalAlign: "middle" }}>💬 KakaoTalk</span>
                                    {showPrivateChat.emoji} {showPrivateChat.name}
                                    <span style={{ fontSize: 11, color: "#a855f7", marginLeft: 8 }}>❤️{hearts[showPrivateChat.id]}</span>
                                    {jealousy > 70 && <span style={{ color: "#fb923c", fontSize: 11, marginLeft: 6 }}>(吃醋中😤)</span>}
                                </h3>
                                <div style={{ fontSize: 10, color: "#b88dc7", marginTop: 2 }}>{fanEmotions[showPrivateChat.id]?.relationshipStatus || showPrivateChat.type}</div>
                            </div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <button title="视频通话" style={{ background: "rgba(34,197,94,0.2)", border: "1px solid #10b981", color: "#10b981", borderRadius: 20, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}
                                    onClick={startVideoCall}>📹 视频</button>
                                <button className="modal-close" onClick={() => { setActiveModal(null); setShowPrivateChat(null); }}>×</button>
                            </div>
                        </div>
                        <div className="dm-chat-container">
                            <div className="dm-messages-area">
                                {msgs.length === 0 && (
                                    <div className="dm-message other"><div className="dm-bubble">（还没有聊天记录，发条消息开启对话吧~）</div></div>
                                )}
                                {msgs.map((m, i) => (
                                    <div key={i} className={`dm-message ${m.isMe ? "me" : "other"}`}>
                                        <div className="dm-bubble">{m.content}</div>
                                        <div className="dm-time">{m.time || ""}{m.isMe && <span className="dm-read">已读</span>}</div>
                                    </div>
                                ))}
                            </div>
                            <div className="dm-actions">
                                {KAKAO_ACTIONS.map((action, i) => (
                                    <button key={i} className="dm-action-btn" onClick={() => sendDM(showPrivateChat, null, action)}>{action.name}</button>
                                ))}
                            </div>
                            <div className="dm-input-area">
                                <input id="dmInput" className="dm-input" placeholder="输入消息..." onKeyDown={e => { if (e.key === "Enter") sendFromInput(); }} />
                                <button className="btn-primary" style={{ padding: "10px 20px" }} onClick={sendFromInput}>发送</button>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }
        // ========== 匿名小号 ==========
        if (activeModal === "sns") {
            const SNS_PRESETS = [
                { label: "🗡️ 发黑帖撕对家", text: "用小号发黑帖攻击对家爱豆，带节奏踩一捧一" },
                { label: "🧼 洗白自己", text: "用小号下场帮自己澄清黑料、引导风向洗白" },
                { label: "🔥 带节奏拱火", text: "用小号在热帖下拱火，把粉圈骂战搅得更大" },
                { label: "🤫 暗示恋情", text: "用小号暗戳戳暗示自己疑似恋爱，试探风向" }
            ];
            const doSns = (text) => {
                handleSNS(text);
                setSnsInput("");
            };
            return (
                <div className="modal-overlay" onClick={() => setActiveModal(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3>🎭 匿名小号</h3><button className="modal-close" onClick={() => setActiveModal(null)}>×</button></div>
                        <div style={{ padding: 16 }}>
                            <div style={{ fontSize: 11, color: "#9d6db8", marginBottom: 12 }}>
                                ⚠️ 小号下场有风险，被扒出来暴露风险会飙升。当前风险 {currentRisk}/10
                            </div>
                            {SNS_PRESETS.map((p, i) => (
                                <button key={i} className="choice-btn" style={{ marginBottom: 8 }} onClick={() => doSns(p.text)}>{p.label}</button>
                            ))}
                            <textarea rows={3} placeholder="或自定义小号操作..." value={snsInput} onChange={e => setSnsInput(e.target.value)} style={{ width: "100%", background: "#ffffff", border: "1px solid #f3d5ed", borderRadius: 16, padding: 12, color: "#4a1d5a", marginTop: 8, marginBottom: 12 }} />
                            <button className="btn-primary" style={{ width: "100%" }} onClick={() => { if (snsInput.trim()) doSns(snsInput.trim()); else alert("请选择或输入小号操作"); }}>🎭 用小号发布</button>
                        </div>
                    </div>
                </div>
            );
        }
        // ========== 商城 ==========
        if (activeModal === "shop") {
            return (
                <div className="modal-overlay" onClick={() => setActiveModal(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3>🛒 商城 · 余额 {money}万</h3><button className="modal-close" onClick={() => setActiveModal(null)}>×</button></div>
                        <div style={{ padding: 16, overflowY: "auto" }}>
                            {SHOP_ITEMS.map(item => (
                                <div key={item.id} style={{ background: "#ffffff", borderRadius: 16, padding: 12, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div>
                                        <div style={{ color: "#4a1d5a", fontWeight: "bold" }}>{item.name}</div>
                                        <div style={{ fontSize: 11, color: "#9d6db8" }}>{item.desc}</div>
                                    </div>
                                    <button className="btn-secondary" onClick={() => handleBuy(item)}>💰 {item.price}万</button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            );
        }

        // ========== 公司交涉 ==========
        if (activeModal === "company") {
            return (
                <div className="modal-overlay" onClick={() => setActiveModal(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3>🏢 公司交涉</h3><button className="modal-close" onClick={() => setActiveModal(null)}>×</button></div>
                        <div style={{ padding: 16 }}>
                            {companyContract && (
                                <div style={{ background: "rgba(220,38,38,0.1)", border: "1px solid rgba(244,114,182,0.25)", borderRadius: 12, padding: 10, marginBottom: 14, fontSize: 11 }}>
                                    <div style={{ color: "#f9a8d4", fontWeight: "bold", marginBottom: 4 }}>📋 已签约（第{companyContract.signedDay}天）</div>
                                    <div style={{ color: "#9d6db8" }}>{companyContract.terms}</div>
                                    <div style={{ color: "#b88dc7", marginTop: 4 }}>公司管控等级：{"★".repeat(companyContract.control)}{"☆".repeat(3 - Math.min(companyContract.control, 3))}</div>
                                </div>
                            )}
                            <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                                <button className="btn-primary" style={{ flex: 1 }} onClick={() => handleCompany("求助")}>🆘 求助公司</button>
                                <button className="btn-secondary" style={{ flex: 1 }} onClick={() => handleCompany("交涉")}>⚖️ 争取自主权</button>
                            </div>
                            {currentRisk >= 5 && !companyContract && (
                                <div>
                                    <div style={{ fontSize: 10, color: "#fb923c", textAlign: "center", marginBottom: 8 }}>
                                        ⚠️ 风险值{currentRisk}，公司正在施压……
                                    </div>
                                    <button style={{ width: "100%", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)", color: "#f9a8d4", borderRadius: 16, padding: "10px 16px", cursor: "pointer", fontSize: 13 }}
                                        onClick={() => handleCompany("sign_contract")}>
                                        📋 签署"形象管理协议"（风险-3 但公司管控你）
                                    </button>
                                    <div style={{ fontSize: 10, color: "#b88dc7", textAlign: "center", marginTop: 6 }}>
                                        签约后海后值增长变慢，但暴露风险立即压制
                                    </div>
                                </div>
                            )}
                            {currentRisk >= 5 && companyContract && (
                                <div style={{ fontSize: 11, color: "#b88dc7", textAlign: "center" }}>已签约，无法再签新约（除非重新谈判）</div>
                            )}
                        </div>
                        <div style={{ padding: "0 16px 14px", fontSize: 11, color: "#b88dc7", textAlign: "center" }}>
                            💡 公司好感影响交涉结果 · 朴综星是财阀，公司不敢惹他
                        </div>
                    </div>
                </div>
            );
        }

        // ========== 要钱 ==========
        if (activeModal === "askMoney") {
            return (
                <div className="modal-overlay" onClick={() => setActiveModal(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3>💰 找大粉要钱</h3><button className="modal-close" onClick={() => setActiveModal(null)}>×</button></div>
                        <div style={{ padding: 16 }}>
                            <select id="askTarget" style={{ width: "100%", background: "#ffffff", border: "1px solid #f3d5ed", borderRadius: 16, padding: 12, color: "#4a1d5a", marginBottom: 16 }}>
                                {unlocked.map(id => {
                                    const fan = FANS.find(f => f.id === id);
                                    return <option key={id} value={id}>{fan?.name} (❤️{hearts[id]})</option>;
                                })}
                                {unlocked.length === 0 && <option>暂无已私联大粉</option>}
                            </select>
                            <button className="btn-primary" style={{ width: "100%" }} onClick={() => {
                                const target = document.getElementById("askTarget").value;
                                if (target) handleAskMoney(target);
                            }}>💸 开口要钱</button>
                            <div className="warning-text" style={{ fontSize: 10, color: "#f43f5e", textAlign: "center", marginTop: 12 }}>
                                ⚠️ 可能需要付出代价，心动值可能下降
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        // ========== 日程表 ==========
        if (activeModal === "calendar") {
            return (
                <div className="modal-overlay" onClick={() => setActiveModal(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3>📅 日程表 · 第 {day} 天</h3><button className="modal-close" onClick={() => setActiveModal(null)}>×</button></div>
                        <div style={{ padding: "8px 16px", color: "#a855f7", fontSize: 13, textAlign: "center" }}>
                            今日：{currentSchedule.name}（素材+{currentSchedule.素材} · 人气+{currentSchedule.人气}）
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, padding: 16 }}>
                            {["一", "二", "三", "四", "五", "六", "日"].map(d => <div key={d} style={{ color: "#b88dc7", fontSize: 11, textAlign: "center" }}>{d}</div>)}
                            {Array.from({ length: 30 }, (_, i) => i + 1).map(d => {
                                // 优先用记录的真实行程，其次用随机生成
                                const sch = scheduleMap[d] || generateRandomSchedule(d);
                                const isToday = d === day;
                                const isPast = d < day;
                                const isReal = !!scheduleMap[d]; // 有真实记录
                                return (
                                    <div key={d} onClick={() => alert(`第${d}天${isReal ? "（已过）" : "（预定）"}：\n${sch.name}\n素材+${sch.素材} · 人气+${sch.人气}`)}
                                        style={{ background: isToday ? "#d946a8" : (isPast ? "#e9d5ff" : "#ffffff"), borderRadius: 10, padding: "8px 4px", textAlign: "center", fontSize: 13, color: isToday ? "white" : "#4a1d5a", cursor: "pointer", border: isReal && isPast ? "1px solid #a855f7" : "1px solid rgba(217,70,168,0.1)" }}>
                                        {d}
                                        <div style={{ fontSize: 6, marginTop: 2, color: isToday ? "#fff" : (isPast ? "#4ade80" : "#b88dc7"), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                            {sch.name.slice(0, 3)}
                                        </div>
                                        {isReal && isPast && <div style={{ fontSize: 5, color: "#4ade80" }}>✓</div>}
                                    </div>
                                );
                            })}
                        </div>
                        <div style={{ padding: "0 16px 16px", fontSize: 11, color: "#b88dc7", textAlign: "center" }}>
                            🔴 今天 · 🟩 已过去（✓ 有真实记录） · 点击查看当天行程
                        </div>
                    </div>
                </div>
            );
        }

        // ========== 礼物 ==========
// ========== 礼物 ==========
        if (showGift) {
            return (
                <div className="modal-overlay" onClick={() => setShowGift(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3>🎁 送礼物</h3><button className="modal-close" onClick={() => setShowGift(false)}>×</button></div>
                        <div style={{ padding: 16 }}>
                            <div style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
                                {FANS.map(fan => (
                                    <button 
                                        key={fan.id} 
                                        className="btn-secondary" 
                                        style={{ fontSize: 12, border: selectedGiftFan?.id === fan.id ? "1px solid #d946a8" : "1px solid transparent" }} 
                                        onClick={() => setSelectedGiftFan(fan)}
                                    >
                                        {fan.emoji} {fan.name}
                                    </button>
                                ))}
                            </div>
                            {GIFT_ITEMS.map(gift => (
                                <div key={gift.id} style={{ background: "#ffffff", borderRadius: 16, padding: 12, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} 
                                onClick={() => { 
                                    if (!selectedGiftFan) return alert("请先在上方点击选择要送礼的大粉！");
                                    handleSendGift(selectedGiftFan, gift); 
                                }}>
                                    <div>
                                        <div style={{ color: "#4a1d5a", fontWeight: "bold" }}>{gift.name}</div>
                                        <div style={{ fontSize: 11, color: "#9d6db8" }}>❤️+{gift.heartDelta}</div>
                                    </div>
                                    <div>💰 {gift.price}万</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            );
        }
        // ========== 关系图谱弹窗 ==========
        if (showRelationGraph) {
            return (
                <div className="modal-overlay" onClick={() => setShowRelationGraph(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3>🕸️ 关系图谱</h3><button className="modal-close" onClick={() => setShowRelationGraph(false)}>×</button></div>
                        <div style={{ padding: 16 }}>
                            <RelationGraph fans={FANS} hearts={hearts} onSelectFan={(fan) => { setShowRelationGraph(false); setShowFanDetail(fan); }} />
                            <div style={{ fontSize: 11, color: "#b88dc7", textAlign: "center", marginTop: 12 }}>
                                点击头像查看大粉详情 · 连线数值为心动值
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        // ========== 结局：星途结算卡 ==========
        if (activeModal === "ending") {
            const 攻略人数 = Object.values(hearts).filter(v => v >= 60).length;
            const maxHeart = Math.max(...Object.values(hearts));
            const maxFanId = Object.entries(hearts).find(([, v]) => v === maxHeart)?.[0];
            const maxFan = FANS.find(f => f.id === maxFanId);
            const othersLow = FANS.filter(f => f.id !== maxFanId).every(f => hearts[f.id] < 40);
            const isSingleTarget = 攻略人数 === 1 && maxHeart >= 70 && othersLow;
            const isSiegeRoute = isSingleTarget && seaLevel > 30;
            
            // ===== 头衔生成系统 =====
            // 复合条件优先级判定
            const titles = [];
            if (isSiegeRoute) titles.push({ name: "💔 围剿玫瑰", desc: "你只爱一人，其余五位联手围剿了你" });
            else if (seaLevel >= 80 && 攻略人数 >= 4) titles.push({ name: "👑 海后女皇", desc: "六条船全部点亮，至高无上的时间管理之神" });
            else if (seaLevel >= 70 && currentRisk <= 3) titles.push({ name: "🦊 隐秘大师", desc: "海后值爆表却滴水不漏，狗仔都拍不到你" });
            else if (currentRisk >= 8 && day <= 15) titles.push({ name: "💥 塌房艺术家", desc: `出道才${day}天就让组合面临解散，速度堪比流星` });
            else if (攻略人数 >= 5 && fandomHeat >= 70) titles.push({ name: "🍑 人间水蜜桃", desc: "你游走在六个姐夫之间，他们甚至为你建了应援站" });
            else if (攻略人数 === 1 && maxHeart >= 85) titles.push({ name: `💘 ${maxFan?.name || "他"}的小公主`, desc: "你放弃了所有人，他在某个深夜对你说：'我不想只是你的粉丝了'" });
            else if (attrs.人气值 >= 85 && 攻略人数 === 0) titles.push({ name: "😇 纯爱战士", desc: "一心搞事业的清流爱豆，粉圈最干净的那位" });
            else if (antiCount >= 70 && fandomHeat >= 70) titles.push({ name: "🔥 黑红流量", desc: "黑粉和真粉数量五五开，热搜常驻嘉宾" });
            else if (companyContract?.signed && companyContract.control >= 2) titles.push({ name: "🔗 公司爱将", desc: "签了重磅协议，安全但你的灵魂也被一并打包" });
            else if (attrs.人气值 < 40 && 攻略人数 >= 2) titles.push({ name: "🎣 私联大师", desc: "事业糊了但粉圈生态学满级，你才是真正的赢家" });
            else if (seaLevel >= 50 && 攻略人数 >= 3) titles.push({ name: "💅 时间管理大师", desc: "三线并行毫不慌张，姐夫们对你又恨又爱" });
            else if (seaLevel >= 30) titles.push({ name: "🐟 海底小鱼苗", desc: "已经开始养鱼但还没完全展开，前途无量" });
            else titles.push({ name: "🌱 初出茅庐", desc: "粉圈生态还没摸清，但已经迈出第一步" });
            // 副称号（玩家性格底色）
            const traitBadges = {
                ambitious: "🔥 野心家",
                pleaser:   "🍑 讨好型",
                aloof:     "🌙 清冷感",
                rebel:     "🎭 杀手锏"
            };
            const traitBadge = traitBadges[char?.hiddenTrait] || "";
            const mainTitle = titles[0];
            
            const cardWidth = 360, cardHeight = 580;
            // 雷达图：6 个粉丝 hearts
            const cx = cardWidth / 2, cy = 280, r = 70;
            const radarPoints = FANS.map((f, i) => {
                const angle = (Math.PI * 2 * i) / FANS.length - Math.PI / 2;
                const dist = (hearts[f.id] / 100) * r;
                return { x: cx + Math.cos(angle) * dist, y: cy + Math.sin(angle) * dist, label: f.emoji, fid: f.id };
            });
            const polyPoints = radarPoints.map(p => `${p.x},${p.y}`).join(' ');

            return (
                <div className="modal-overlay" onClick={() => setActiveModal(null)}>
                    <div className="modal-content modal-anim" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
                        <div className="modal-header"><h3>✨ 星途结算卡</h3><button className="modal-close" onClick={() => setActiveModal(null)}>×</button></div>
                        <div style={{ padding: 12 }}>
                            {/* === 可分享卡片：SVG === */}
                            <svg id="ending-card-svg" viewBox={`0 0 ${cardWidth} ${cardHeight}`} width="100%" style={{ display: "block", borderRadius: 16, background: "linear-gradient(160deg, #fce7f3 0%, #e9d5ff 50%, #fbcfe8 100%)" }}>
                                {/* 装饰星点 */}
                                {[...Array(20)].map((_, i) => (
                                    <circle key={i} cx={Math.random() * cardWidth} cy={Math.random() * cardHeight} r={Math.random() * 1.5} fill="#a855f7" opacity={Math.random() * 0.4 + 0.15} />
                                ))}
                                {/* 顶部：艺名 + 头衔 */}
                                <text x={cx} y="40" textAnchor="middle" fill="#6b3d7e" fontSize="13" fontWeight="bold" letterSpacing="2">EHP · 姐夫大作战</text>
                                <text x={cx} y="68" textAnchor="middle" fill="#a855f7" fontSize="22" fontWeight="bold">{char?.artistName || "晨晨"}</text>
                                <text x={cx} y="88" textAnchor="middle" fill="#9d6db8" fontSize="11">{char?.groupName || "NOVA"} · 第 {day} 天 · {char?.role}</text>
                                
                                {/* 主称号 */}
                                <rect x="20" y="105" width={cardWidth-40} height="70" rx="14" fill="url(#titleGrad)" />
                                <defs>
                                    <linearGradient id="titleGrad" x1="0" y1="0" x2="1" y2="0">
                                        <stop offset="0" stopColor="#ec4899" stopOpacity="0.85" />
                                        <stop offset="0.5" stopColor="#a855f7" stopOpacity="0.95" />
                                        <stop offset="1" stopColor="#ec4899" stopOpacity="0.85" />
                                    </linearGradient>
                                </defs>
                                <text x={cx} y="135" textAnchor="middle" fill="#ffffff" fontSize="18" fontWeight="bold">{mainTitle.name}</text>
                                <foreignObject x="30" y="142" width={cardWidth-60} height="35">
                                    <div xmlns="http://www.w3.org/1999/xhtml" style={{ color: "#fce7f3", fontSize: 10, textAlign: "center", lineHeight: 1.5, padding: "0 4px" }}>{mainTitle.desc}</div>
                                </foreignObject>
                                {traitBadge && <text x={cx} y="195" textAnchor="middle" fill="#7e22ce" fontSize="11" fontStyle="italic">底色：{traitBadge}</text>}
                                
                                {/* 雷达图 */}
                                <text x={cx} y="225" textAnchor="middle" fill="#6b3d7e" fontSize="11" fontWeight="bold">🕸️ 粉圈关系图</text>
                                {[1, 0.66, 0.33].map((scale, i) => (
                                    <polygon key={i} points={FANS.map((f, j) => {
                                        const angle = (Math.PI * 2 * j) / FANS.length - Math.PI / 2;
                                        return `${cx + Math.cos(angle) * r * scale},${cy + Math.sin(angle) * r * scale}`;
                                    }).join(' ')} fill="none" stroke="#f3d5ed" strokeWidth="1" opacity="0.5" />
                                ))}
                                <polygon points={polyPoints} fill="rgba(236, 72, 153, 0.4)" stroke="#ec4899" strokeWidth="2" />
                                {FANS.map((f, i) => {
                                    const angle = (Math.PI * 2 * i) / FANS.length - Math.PI / 2;
                                    const labelX = cx + Math.cos(angle) * (r + 18);
                                    const labelY = cy + Math.sin(angle) * (r + 18) + 4;
                                    return (
                                        <g key={f.id}>
                                            <text x={labelX} y={labelY} textAnchor="middle" fontSize="14">{f.emoji}</text>
                                            <text x={labelX} y={labelY + 12} textAnchor="middle" fill="#9d6db8" fontSize="8">{hearts[f.id]}</text>
                                        </g>
                                    );
                                })}
                                
                                {/* 数值条 */}
                                {[
                                    { label: "海后值", value: seaLevel, max: 100, color: "#ec4899" },
                                    { label: "暴露风险", value: currentRisk, max: 10, color: "#f472b6" },
                                    { label: "人气", value: attrs.人气值, max: 100, color: "#a855f7" },
                                    { label: "公司好感", value: companyFavor, max: 100, color: "#8b5cf6" }
                                ].map((bar, i) => (
                                    <g key={i} transform={`translate(30, ${385 + i * 30})`}>
                                        <text x="0" y="12" fill="#6b3d7e" fontSize="10">{bar.label}</text>
                                        <rect x="70" y="3" width="200" height="12" rx="6" fill="#ffffff" stroke="#f3d5ed" />
                                        <rect x="70" y="3" width={Math.max(2, (bar.value / bar.max) * 200)} height="12" rx="6" fill={bar.color} />
                                        <text x="280" y="12" fill="#4a1d5a" fontSize="10" fontWeight="bold">{bar.value}{bar.max === 100 ? "%" : `/${bar.max}`}</text>
                                    </g>
                                ))}
                                
                                {/* 底部水印 */}
                                <text x={cx} y={cardHeight - 14} textAnchor="middle" fill="#9d6db8" fontSize="9">截图分享你的星途 · #EHP姐夫大作战</text>
                            </svg>
                            
                            <div style={{ fontSize: 10, color: "#b88dc7", textAlign: "center", marginTop: 10 }}>
                                💡 长按上方卡片可截图保存分享
                            </div>
                            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                                <button onClick={() => {
                                    // 把 SVG 序列化为 data URL，方便桌面端右键保存
                                    const svg = document.getElementById('ending-card-svg');
                                    if (!svg) return;
                                    const xml = new XMLSerializer().serializeToString(svg);
                                    const blob = new Blob([xml], { type: 'image/svg+xml' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url; a.download = `星途结算卡_${char?.artistName || '我'}_第${day}天.svg`;
                                    document.body.appendChild(a); a.click(); document.body.removeChild(a);
                                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                                }} className="btn-secondary" style={{ flex: 1 }}>📥 下载卡片</button>
                                <button onClick={() => { deleteGameFromSlot(slotId); window.location.reload(); }} className="btn-primary" style={{ flex: 1 }}>🔄 重玩</button>
                            </div>
                            {specialEnding && false /* legacy 占位，保留兼容 */}
                            {isSiegeRoute && (
                                <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 12, padding: 10, marginTop: 14, fontSize: 11, color: "#f9a8d4", lineHeight: 1.6 }}>
                                    🔥 <b>五人联合围剿</b>：你只在乎{maxFan?.name}，另外五位察觉了异样并联合起来。Pann出现了爆料贴，{maxFan?.name}站出来护你却反被说成"证据"。这场围剿，是你选择的代价。
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }

        // ========== 直播 ==========
        if (activeModal === "live") {
            return (
                <LiveModal
                    char={char} seaLevel={seaLevel} currentRisk={currentRisk}
                    fandomHeat={fandomHeat} antiCount={antiCount} coupleExposure={coupleExposure}
                    liveMessages={liveMessages} setLiveMessages={setLiveMessages}
                    liveActive={liveActive} setLiveActive={setLiveActive}
                    hearts={hearts} updateHearts={updateHearts} updateRisk={updateRisk}
                    addWorldState={addWorldState} triggerSocialDynamic={triggerSocialDynamic}
                    onClose={() => setActiveModal(null)}
                />
            );
        }

        return null;
    };
    // ========== 主 return ==========
    const composerCfg = postComposer ? SOCIAL_CFG[postComposer.platformKey] : null;
    const sheetPost = commentSheet ? (socialFeeds[commentSheet.feedKey] || []).find(p => p.id === commentSheet.postId) : null;
    const sheetCfg = commentSheet ? SOCIAL_CFG[commentSheet.feedKey] : null;
    return (
        <div style={{ position: "relative" }}>
            {/* 危机模式视觉叠加层 */}
            {currentRisk >= 8 && <div className="crisis-mode" aria-hidden="true" />}
            {renderModal()}
            {postComposer && (
                <PostComposerModal cfg={composerCfg} onClose={() => setPostComposer(null)}
                    onPublish={(text, media) => publishPost(postComposer.platformKey, text, media)} />
            )}
            {commentSheet && sheetPost && (
                <CommentSheetModal post={sheetPost} cfg={sheetCfg} loading={commentLoading}
                    onClose={() => setCommentSheet(null)} onLike={id => toggleLike(commentSheet.feedKey, id)}
                    onRetry={() => { updatePost(commentSheet.feedKey, sheetPost.id, { comments: null }); openComments(commentSheet.feedKey, { ...sheetPost, comments: null }); }} />
            )}
            {/* 手机操作就地反馈 Toast（不推主线，只显示结果） */}
            {toastMsg && (
                <div style={{ position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
                    background: "rgba(15,15,20,0.96)", border: "1px solid rgba(225,29,72,0.4)", borderRadius: 16,
                    padding: "10px 18px", fontSize: 12, color: "#4a1d5a", maxWidth: "80vw", textAlign: "center",
                    boxShadow: "0 4px 24px rgba(0,0,0,0.6)", backdropFilter: "blur(8px)", lineHeight: 1.6 }}>
                    {toastMsg}
                </div>
            )}
            
            {/* 顶部状态栏 */}
            <div className="status-bar">
                <span className="time">23:41</span>
                <span>📶 🔋 89%</span>
            </div>
            
            {/* 主头部 */}
            <div className="main-header">
                <div className="day-badge">DAY {day}</div>
                <div className="sea-badge" title={`海后值：${seaLevel}`}>
                    {seaLevel >= 80 ? "🌊 海后女皇" : seaLevel >= 60 ? "🐟 时间管理中" : seaLevel >= 30 ? "💋 有点小心思" : "😇 纯情小白"}
                </div>
                {currentEvent && <div className="sea-badge" style={{ background: "rgba(225,29,72,0.2)" }}>{currentEvent.name}</div>}
            </div>
            
            {/* 风险标签 */}
            <div className={`risk-badge ${riskClass}`} style={{ margin: "0 16px 8px" }} title={`暴露风险：${currentRisk}/10`}>
                {riskText}：{currentRisk >= 8 ? "狗仔已盯上你" : currentRisk >= 6 ? "小号议论纷纷" : currentRisk >= 4 ? "圈内有些风声" : currentRisk >= 2 ? "略有蛛丝马迹" : "一切如常"}
            </div>
            
            {/* 主内容区 */}
            {renderContent()}
            
            {/* 底部 Tab 栏 */}
            <div className="bottom-tabs">
                <button className={`tab-btn ${activeTab === "story" ? "active" : ""}`} onClick={() => setActiveTab("story")}>
                    <span>📖</span><span>剧情</span>
                </button>
                <button className={`tab-btn ${activeTab === "relation" ? "active" : ""}`} onClick={() => setActiveTab("relation")}>
                    <span>🕸️</span><span>关系</span>
                </button>
                <button className={`tab-btn ${activeTab === "phone" ? "active" : ""}`} onClick={() => setActiveTab("phone")}>
                    <span>📱</span><span>手机</span>
                </button>
                <button className={`tab-btn ${activeTab === "settings" ? "active" : ""}`} onClick={() => setActiveTab("settings")}>
                    <span>⚙️</span><span>设置</span>
                </button>
            </div>
        </div>
    );
}

// ============================================================
// 登录组件
// ============================================================
function Login({ onLogin, onGuest }) {
    const [email, setEmail] = React.useState("");
    const [password, setPassword] = React.useState("");
    const [isLogin, setIsLogin] = React.useState(true);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState("");
    
    const handleSubmit = async () => {
        if (!email || !password) return;
        setLoading(true);
        setError("");
        let result;
        if (isLogin) {
            result = await supabaseClient.auth.signInWithPassword({ email, password });
        } else {
            result = await supabaseClient.auth.signUp({ email, password });
        }
        if (result.error) {
            setError(result.error.message);
        } else {
            onLogin(result.data.user);
        }
        setLoading(false);
    };
    
    return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #fdf2f8 0%, #fce7f3 50%, #e9d5ff 100%)" }}>
            <div className="login-card" style={{ background: "#fdf4ff", borderRadius: 24, padding: 24, margin: 20, maxWidth: 400, width: "100%" }}>
                <h2 style={{ color: "#4a1d5a", textAlign: "center", marginBottom: 20 }}>{isLogin ? "登录" : "注册"}</h2>
                <input className="login-input" type="email" placeholder="邮箱" value={email} onChange={e => setEmail(e.target.value)} />
                <input className="login-input" type="password" placeholder="密码" value={password} onChange={e => setPassword(e.target.value)} />
                {error && <div className="error-text">{error}</div>}
                <button className="login-btn" onClick={handleSubmit} disabled={loading}>{loading ? "处理中..." : (isLogin ? "登录" : "注册")}</button>
                <button className="btn-secondary" onClick={onGuest} style={{ width: "100%", marginTop: 12 }}>
                    游客模式（仅本地存档）
                </button>
                <button className="switch-btn" onClick={() => setIsLogin(!isLogin)} style={{ width: "100%", marginTop: 12, background: "none", border: "none", color: "#9d6db8", cursor: "pointer" }}>
                    {isLogin ? "没有账号？立即注册" : "已有账号？立即登录"}
                </button>
            </div>
        </div>
    );
}

// ============================================================
// 存档选择界面
// ============================================================
function SlotSelector({ onSelectSlot, onCreateNew, onLogout }) {
    const [slots, setSlots] = React.useState({});
    const [loading, setLoading] = React.useState(false);
    
    React.useEffect(() => {
        const load = async () => {
            const uid = await getCurrentUserId();
            if (!uid) return;
            const query = supabaseClient.from('saves').select('slot_id, game_data').eq('user_id', uid);
            const { data } = await withTimeout(query, 6000, { data: null });
            const processed = {};
            if (data) {
                data.forEach(item => {
                    if (item.game_data?.char) processed[item.slot_id] = { char: item.game_data.char, day: item.game_data.day };
                });
            }
            for (let i = 1; i <= 3; i++) {
                const local = loadGameFromSlot(i);
                if (local?.char && !processed[i]) processed[i] = { char: local.char, day: local.day };
            }
            setSlots(processed);
        };
        load();
    }, []);
    
    const handleSelect = async (slotId) => {
        setLoading(true);
        let data = await loadFromCloud(slotId);
        if (!data) data = loadGameFromSlot(slotId);
        if (data?.char) {
            onSelectSlot(slotId, data);
        } else {
            alert("该存档没有有效数据");
        }
        setLoading(false);
    };
    
    // 跨重启续档指针：若指向的存档仍有数据，则在顶部显示“继续上次”
    const lastActive = readLastActive();
    const lastData = lastActive ? slots[lastActive.slot] : null;
    
    return (
        <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #fdf2f8 0%, #fce7f3 50%, #e9d5ff 100%)", padding: "30px 20px" }}>
            <div style={{ maxWidth: 400, margin: "0 auto", textAlign: "center" }}>
                <div style={{ fontSize: 56, marginBottom: 16 }}>💫</div>
                <h1 style={{ fontSize: 32, fontWeight: "bold", color: "#4a1d5a", marginBottom: 8 }}>姐夫大作战 V16</h1>
                <p style={{ color: "#9d6db8", fontSize: 13, marginBottom: 30 }}>终极完整版 · AI全生成 · 海后联动 · 大粉互撕 · 完整社交平台</p>
                <button onClick={onLogout} className="btn-secondary" style={{ marginBottom: 20 }}>🚪 退出登录</button>
                {lastData && (
                    <button
                        onClick={() => handleSelect(lastActive.slot)}
                        disabled={loading}
                        className="btn-primary"
                        style={{ width: "100%", marginBottom: 18, padding: "13px 18px", fontSize: 15, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}
                        title="回到上次正在玩的存档">
                        <span>⏯ 继续上次</span>
                        <span style={{ fontWeight: 400, fontSize: 12, opacity: 0.92 }}>存档{lastActive.slot} · {lastData.char?.artistName} · 第{lastData.day}天</span>
                    </button>
                )}
                {[1, 2, 3].map(slotId => {
                    const data = slots[slotId];
                    return (
                        <div key={slotId} className="save-slot-card" style={{ background: "rgba(255,255,255,0.85)", borderRadius: 20, padding: 16, marginBottom: 12 }}>
                            <div className="flex-between" style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "#d946a8", fontWeight: "bold" }}>存档 {slotId}</span>
                                {data && <span style={{ fontSize: 11, color: "#10b981" }}>第{data.day}天 · {data.char?.artistName}</span>}
                            </div>
                            {data ? (
                                <div style={{ display: "flex", gap: 10, marginTop: 12, flexDirection: "column" }}>
                                    <div style={{ display: "flex", gap: 10 }}>
                                        <button onClick={() => handleSelect(slotId)} className="btn-primary" style={{ flex: 1 }} disabled={loading}>▶ 继续</button>
                                        <button onClick={() => onCreateNew(slotId)} className="btn-secondary" style={{ background: "#f43f5e", flex: 0.5 }}>覆盖</button>
                                    </div>
                                    <div style={{ display: "flex", gap: 8 }}>
                                        <button
                                            onClick={() => exportSaveToFile(slotId)}
                                            className="btn-secondary"
                                            style={{ flex: 1, fontSize: 11, padding: "6px 8px", background: "rgba(34,197,94,0.15)", border: "1px solid #10b981", color: "#10b981" }}
                                            title="导出存档为 JSON 文件，用于备份或腾出空间">
                                            📤 导出存档
                                        </button>
                                        <button
                                            onClick={() => importSaveFromFile(slotId, () => window.location.reload())}
                                            className="btn-secondary"
                                            style={{ flex: 1, fontSize: 11, padding: "6px 8px", background: "rgba(250,204,21,0.1)", border: "1px solid #a855f7", color: "#a855f7" }}
                                            title="从 JSON 文件导入存档（会覆盖当前存档！）">
                                            📥 导入存档
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div style={{ display: "flex", gap: 8, marginTop: 12, flexDirection: "column" }}>
                                    <button onClick={() => onCreateNew(slotId)} className="btn-primary" style={{ width: "100%" }}>✨ 创建角色</button>
                                    <button
                                        onClick={() => importSaveFromFile(slotId, () => window.location.reload())}
                                        className="btn-secondary"
                                        style={{ width: "100%", fontSize: 11, padding: "6px 8px", background: "rgba(250,204,21,0.1)", border: "1px solid #a855f7", color: "#a855f7" }}
                                        title="从备份文件恢复存档">
                                        📥 从文件恢复存档
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}
                {loading && <div className="loading-spinner"><div className="spinner"></div></div>}
            </div>
        </div>
    );
}
// ============================================================
// 创建角色组件（完整版）
// ============================================================
function CreateCharacter({ slotId, onComplete, onBack }) {
    const [step, setStep] = React.useState(0);
    const [loading, setLoading] = React.useState(false);
    const [socialStep, setSocialStep] = React.useState(0);
    const [teammates, setTeammates] = React.useState(null);
    const [generating, setGenerating] = React.useState(false);
    const [generatedKey, setGeneratedKey] = React.useState("");
    const [charForm, setCharForm] = React.useState({
        // 基本信息
        name: "",
        artistName: "",
        age: "",
        groupName: "",
        nickname: "",
        role: "全能ACE",
        status: "跟团发展",
        hiddenTrait: "ambitious",  // 隐藏性格底色（影响 AI 生成）
        // 社交平台 ID
        weverseId: "",
        instagramId: "",
        twitterId: "",
        kakaoId: "",
        tiktokId: "",
        biliId: "",
        weiboId: "",
        threadsId: ""
    });
    
    // 舞台风格 → 隐藏性格底色（4选1）
    const STAGE_STYLES = [
        { key: "ambitious", label: "🔥 高冷御姐", trait: "野心家", desc: "你目标明确、心狠手辣，把粉丝当工具人" },
        { key: "pleaser", label: "🍑 甜妹元气", trait: "讨好型", desc: "你想被所有人爱，不擅长拒绝，容易答应不该答应的" },
        { key: "aloof", label: "🌙 氛围感艺人", trait: "清冷感", desc: "你看似疏离实则深情，被偷拍时眼神最有戏" },
        { key: "rebel", label: "🎭 古灵精怪", trait: "杀手锏", desc: "你不按套路出牌，关键时刻会爆冷反转" }
    ];
    
    // 社交平台配置
    const socialFields = [
        { key: "weverseId", name: "Weverse", icon: "🌐", placeholder: "chen_official", platform: "Weverse" },
        { key: "instagramId", name: "Instagram", icon: "📷", placeholder: "@chen_official", platform: "Instagram" },
        { key: "twitterId", name: "X/Twitter", icon: "𝕏", placeholder: "@chen_official", platform: "Twitter" },
        { key: "kakaoId", name: "KakaoTalk", icon: "💬", placeholder: "chen_123", platform: "KakaoTalk" },
        { key: "tiktokId", name: "TikTok", icon: "🎵", placeholder: "@chen_official", platform: "TikTok" },
        { key: "biliId", name: "Bilibili", icon: "📺", placeholder: "晨晨官方", platform: "Bilibili" },
        { key: "weiboId", name: "微博", icon: "🌊", placeholder: "晨晨官方", platform: "微博" },
        { key: "threadsId", name: "Threads", icon: "🧵", placeholder: "@chen", platform: "Threads" }
    ];
    
    const ROLES = ["全能ACE", "主唱Vocal", "主舞Dance", "Rapper"];
    const STATUSES = ["跟团发展", "独立Solo期"];
    
    // 基本信息字段
    const basicFields = [
        { key: "name", label: "真实姓名", placeholder: "林晓晨" },
        { key: "artistName", label: "艺名", placeholder: "晨晨" },
        { key: "age", label: "年龄", placeholder: "22" },
        { key: "groupName", label: "女团名称", placeholder: "NOVA" },
        { key: "nickname", label: "粉圈花名", placeholder: "晨晨公主" }
    ];

    React.useEffect(() => {
        if (step !== basicFields.length + 2) return;
        const key = `${charForm.role}|${charForm.groupName}`;
        if (generatedKey === key && teammates) return;

        const generateTeammates = async () => {
            setGenerating(true);
            setGeneratedKey(key);
            const result = await callEdgeFunction('generateTeammates', { mainRole: charForm.role, groupName: charForm.groupName });
            if (!result.error && result.teammates && result.teammates.length >= 3) {
                setTeammates(result.teammates.slice(0, 4));
            } else {
                setTeammates([
                    { name: "秀妍", artistName: "SY", role: "主唱", personality: "温柔体贴" },
                    { name: "彩英", artistName: "CY", role: "主舞", personality: "活泼开朗" },
                    { name: "娜恩", artistName: "NN", role: "门面", personality: "高冷优雅" }
                ]);
            }
            setGenerating(false);
        };

        generateTeammates();
    }, [step, charForm.role, charForm.groupName, generatedKey, teammates]);
    
    // Step 0-4：基本信息
    if (step < basicFields.length) {
        const f = basicFields[step];
        return (
            <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #fdf2f8 0%, #fce7f3 50%, #e9d5ff 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
                <div className="create-character-step" style={{ maxWidth: 360, width: "100%" }}>
                    <div className="create-step-indicator" style={{ display: "flex", gap: 4, justifyContent: "center", marginBottom: 20 }}>
                        {basicFields.map((_, i) => (
                            <div key={i} style={{ height: 4, borderRadius: 10, background: i <= step ? "#d946a8" : "#f3d5ed", width: i <= step ? 28 : 12, transition: "0.3s" }} />
                        ))}
                        <div style={{ height: 4, borderRadius: 10, background: step >= basicFields.length ? "#d946a8" : "#f3d5ed", width: 12 }} />
                        <div style={{ height: 4, borderRadius: 10, background: step >= basicFields.length + 1 ? "#d946a8" : "#f3d5ed", width: 12 }} />
                    </div>
                    <p style={{ color: "#f43f5e", fontSize: 11, textAlign: "center", marginBottom: 8 }}>创建角色卡 {step + 1}/{basicFields.length + 2}</p>
                    <h2 style={{ color: "#4a1d5a", fontSize: 22, textAlign: "center", margin: "8px 0" }}>{f.label}</h2>
                    <input autoFocus type="text" value={charForm[f.key] || ""} onChange={e => setCharForm({ ...charForm, [f.key]: e.target.value })} placeholder={f.placeholder} className="create-input" />
                    <button onClick={() => charForm[f.key] && setStep(step + 1)} className="btn-primary" style={{ width: "100%", marginTop: 20 }}>继续 →</button>
                    <button onClick={onBack} className="btn-secondary" style={{ width: "100%", marginTop: 10 }}>← 返回</button>
                </div>
            </div>
        );
    }
    
    // Step 5：团内定位 + 发展状态 + 舞台风格（隐藏性格底色）
    if (step === basicFields.length) {
        return (
            <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #fdf2f8 0%, #fce7f3 50%, #e9d5ff 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
                <div className="create-character-step" style={{ maxWidth: 360, width: "100%" }}>
                    <h3 style={{ color: "#4a1d5a", fontSize: 16, textAlign: "center", marginBottom: 12 }}>团内定位</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 16 }}>
                        {ROLES.map(r => (
                            <button key={r} onClick={() => setCharForm({ ...charForm, role: r })} className="role-btn" style={{ background: charForm.role === r ? "#d946a8" : "#ffffff", padding: 10, borderRadius: 12, border: "none", color: charForm.role === r ? "white" : "#4a1d5a", cursor: "pointer", fontSize: 13 }}>
                                {r}
                            </button>
                        ))}
                    </div>
                    <h3 style={{ color: "#4a1d5a", fontSize: 16, textAlign: "center", marginBottom: 12 }}>发展状态</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 16 }}>
                        {STATUSES.map(s => (
                            <button key={s} onClick={() => setCharForm({ ...charForm, status: s })} className="role-btn" style={{ background: charForm.status === s ? "#d946a8" : "#ffffff", padding: 10, borderRadius: 12, border: "none", color: charForm.status === s ? "white" : "#4a1d5a", cursor: "pointer", fontSize: 13 }}>
                                {s}
                            </button>
                        ))}
                    </div>
                    <h3 style={{ color: "#4a1d5a", fontSize: 16, textAlign: "center", marginBottom: 4 }}>舞台风格</h3>
                    <p style={{ color: "#9d6db8", fontSize: 10, textAlign: "center", marginBottom: 10 }}>影响你的性格底色（AI 会按此塑造剧情走向）</p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 }}>
                        {STAGE_STYLES.map(s => (
                            <button key={s.key} onClick={() => setCharForm({ ...charForm, hiddenTrait: s.key })} className="role-btn"
                                style={{ background: charForm.hiddenTrait === s.key ? "#d946a8" : "#ffffff", padding: 10, borderRadius: 12, border: "none", color: charForm.hiddenTrait === s.key ? "white" : "#4a1d5a", cursor: "pointer", textAlign: "left" }}>
                                <div style={{ fontSize: 13, fontWeight: "bold" }}>{s.label}</div>
                                <div style={{ fontSize: 9, color: charForm.hiddenTrait === s.key ? "#fce7f3" : "#b88dc7", marginTop: 2 }}>{s.desc}</div>
                            </button>
                        ))}
                    </div>
                    <button onClick={() => setStep(step + 1)} className="btn-primary" style={{ width: "100%" }}>继续 →</button>
                    <button onClick={() => setStep(step - 1)} className="btn-secondary" style={{ width: "100%", marginTop: 10 }}>← 返回</button>
                </div>
            </div>
        );
    }
    
    // Step 6：社交平台 ID
    if (step === basicFields.length + 1) {
        const currentSocial = socialFields[socialStep];
        
        if (socialStep < socialFields.length) {
            return (
                <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #fdf2f8 0%, #fce7f3 50%, #e9d5ff 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
                    <div className="create-character-step" style={{ maxWidth: 360, width: "100%" }}>
                        <p style={{ color: "#f43f5e", fontSize: 11, textAlign: "center", marginBottom: 8 }}>设置社交账号 {socialStep + 1}/{socialFields.length}</p>
                        <h2 style={{ color: "#4a1d5a", fontSize: 22, textAlign: "center", margin: "8px 0" }}>{currentSocial.icon} {currentSocial.name}</h2>
                        <input autoFocus type="text" value={charForm[currentSocial.key] || ""} onChange={e => setCharForm({ ...charForm, [currentSocial.key]: e.target.value })} placeholder={currentSocial.placeholder} className="create-input" />
                        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                            {charForm[currentSocial.key]?.trim() ? (
                                <button onClick={() => {
                                    if (socialStep === socialFields.length - 1) setStep(step + 1);
                                    else setSocialStep(socialStep + 1);
                                }} className="btn-primary" style={{ flex: 1 }}>确认 ✓</button>
                            ) : (
                                <button onClick={() => {
                                    if (socialStep === socialFields.length - 1) setStep(step + 1);
                                    else setSocialStep(socialStep + 1);
                                }} className="btn-secondary" style={{ flex: 1 }}>跳过 →</button>
                            )}
                            {socialStep > 0 && <button onClick={() => setSocialStep(socialStep - 1)} className="btn-secondary" style={{ flex: 1 }}>← 上一步</button>}
                        </div>
                    </div>
                </div>
            );
        }

        return null;
    }
    
    // Step 7：AI 生成队友 + 完成创建
    if (step === basicFields.length + 2) {
        if (generating || !teammates) {
            return (
                <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #fdf2f8 0%, #fce7f3 50%, #e9d5ff 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
                    <div className="create-character-step" style={{ maxWidth: 360, width: "100%", textAlign: "center" }}>
                        <div className="loading-spinner"><div className="spinner"></div></div>
                        <p style={{ color: "#9d6db8", marginTop: 16 }}>AI 正在生成你的队友...</p>
                    </div>
                </div>
            );
        }
        
        // 随机生成初始属性
        const randomAttrs = {
            人气值: Math.floor(Math.random() * 31) + 65,
            颜值: Math.floor(Math.random() * 29) + 70,
            国民度: Math.floor(Math.random() * 41) + 50,
            时尚度: Math.floor(Math.random() * 48) + 45,
            金钱值: Math.floor(Math.random() * 56) + 30,
            vocal: Math.floor(Math.random() * 31) + 60,
            dance: Math.floor(Math.random() * 31) + 60,
            rap: Math.floor(Math.random() * 31) + 50,
            iq: Math.floor(Math.random() * 21) + 75,
            eq: Math.floor(Math.random() * 21) + 70
        };
        
        return (
            <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #fdf2f8 0%, #fce7f3 50%, #e9d5ff 100%)", padding: "40px 20px" }}>
                <div style={{ maxWidth: 380, margin: "0 auto", textAlign: "center" }}>
                    <h2 style={{ color: "#4a1d5a" }}>✨ 角色卡完成</h2>
                    <div style={{ background: "linear-gradient(135deg, #7c3aed 0%, #d946a8 100%)", borderRadius: 20, padding: 20, marginBottom: 20, boxShadow: "0 8px 24px rgba(124,58,237,0.25)" }}>
                        <div style={{ fontSize: 48 }}>{(charForm.artistName || charForm.name)?.[0] || "✨"}</div>
                        <div style={{ color: "#ffffff", fontWeight: "bold", fontSize: 20 }}>{charForm.artistName}</div>
                        <div style={{ color: "#fce7f3" }}>{charForm.name} · {charForm.age}岁 · {charForm.groupName}</div>
                        <div style={{ color: "#fde047", marginTop: 8, fontWeight: "bold" }}>{charForm.role} · {charForm.status}</div>
                        <div style={{ color: "#f5d0fe", fontSize: 11, marginTop: 8 }}>花名：{charForm.nickname}</div>
                    </div>
                    <div style={{ background: "#ffffff", border: "1px solid #f3d6ee", borderRadius: 16, padding: 12, marginBottom: 20, boxShadow: "0 4px 16px rgba(217,70,168,0.10)" }}>
                        <h3 style={{ color: "#a855f7", fontSize: 14 }}>🎪 {charForm.groupName} 成员</h3>
                        {teammates.map((tm, i) => (
                            <div key={i} style={{ display: "flex", gap: 12, padding: "6px 0", alignItems: "center" }}>
                                <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#d946a8", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", color: "white" }}>{tm.name[0]}</div>
                                <div><div style={{ color: "#4a1d5a", fontSize: 13, fontWeight: "bold" }}>{tm.name} ({tm.artistName})</div><div style={{ color: "#9d6db8", fontSize: 11 }}>{tm.role}</div></div>
                            </div>
                        ))}
                    </div>
                    <div style={{ background: "#ffffff", border: "1px solid #f3d6ee", borderRadius: 16, padding: 12, marginBottom: 20, boxShadow: "0 4px 16px rgba(217,70,168,0.10)" }}>
                        <h3 style={{ color: "#a855f7", fontSize: 14 }}>📱 社交账号</h3>
                        {socialFields.map(sf => (
                            <div key={sf.key} style={{ fontSize: 11, color: "#6b4480", padding: "4px 0" }}>{sf.icon} {sf.name}: {charForm[sf.key] || "未设置"}</div>
                        ))}
                    </div>
                    <button onClick={() => {
                        const initStory = buildInitStory(charForm);
                        const gameData = {
                            char: charForm, day: 1, teammates,
                            hearts: Object.fromEntries(FANS.map(f => [f.id, 30])),
                            seaLevel: 0, unlocked: [],
                            currentStory: initStory, currentChoices: INIT_CHOICES, currentRisk: 0,
                            history: [initStory], schedules: {},
                            attrs: randomAttrs, money: randomAttrs.金钱值,
                            fandomHeat: 65, antiCount: 30, fanEmotions: initFanEmotions(),
                            activeEvents: [], currentSchedule: generateRandomSchedule(1),
                            dmReadStatus: {}, dmHistories: {}, coupleExposure: null, socialFeeds: {},
                            paidDmDaily: { lastChatDate: null, messages: {}, thread: [] },
                            companyFavor: 60
                        };
                        saveGameToSlot(slotId, gameData);
                        syncToCloud(slotId, gameData);
                        onComplete(slotId, gameData);
                    }} className="btn-primary" style={{ width: "100%", padding: 14 }}>🎮 开始海后生涯</button>
                    <button onClick={() => setStep(step - 1)} className="btn-secondary" style={{ width: "100%", marginTop: 10 }}>← 返回修改</button>
                </div>
            </div>
        );
    }
    
    return null;
}
// ============================================================
// 主应用
// ============================================================
function App() {
    const [user, setUser] = React.useState(null);
    const [currentSlot, setCurrentSlot] = React.useState(null);
    const [gameData, setGameData] = React.useState(null);
    const [showCreate, setShowCreate] = React.useState(false);
    const [loading, setLoading] = React.useState(true);
    const [slotsData, setSlotsData] = React.useState({});
    
    // 切后台恢复：用户登录后检查是否有未完成的游戏存档
    const tryRestoreActiveSlot = React.useCallback(async () => {
        // 决定要不要自动续档：
        //   1) 同会话（刷新 / 切后台但未被杀）：sessionStorage 有指针 → 直接续
        //   2) 被系统杀死后重开：sessionStorage 已空，看 localStorage 时间戳
        //      · 30 分钟内 → 自动续；超时 → 不自动续，交给选择页“继续上次”按钮
        const sessionSlot = safeSessionStorage.getItem('ehp_activeSlot');
        let slotId = null;
        if (sessionSlot && !isNaN(parseInt(sessionSlot))) {
            slotId = parseInt(sessionSlot);
        } else {
            const last = readLastActive();
            if (last && last.fresh) slotId = last.slot;
        }
        if (slotId == null) return;

        // 优先本地（快），失败再拉云端
        let data = loadGameFromSlot(slotId);
        if (!data?.char) data = await loadFromCloud(slotId);
        if (data?.char) {
            markActiveSlot(slotId);   // 归一化两个存储（被杀后 sessionStorage 为空，这里补回）
            setCurrentSlot(slotId);
            setGameData(data);
        }
        // 注意：失败时不清 lastActive —— 让选择页仍能显示“继续上次”（若该槽位确实没数据，按钮自然不出现）
    }, []);

    React.useEffect(() => {
        let cancelled = false;
        // 【移动端关键修复】看门狗：无论 getSession / 云端加载发生什么，
        // 最多 7 秒后必须结束 loading，避免手机端网络抖动或存储异常时永久转圈。
        const watchdog = setTimeout(() => {
            if (!cancelled) setLoading(false);
        }, 7000);
        const finishLoading = () => {
            if (cancelled) return;
            clearTimeout(watchdog);
            setLoading(false);
        };

        const bootstrap = async (session) => {
            try {
                if (session?.user) {
                    window._ehpUserId = session.user.id;
                    if (!cancelled) setUser(session.user);
                    await loadAllSlots();
                    await tryRestoreActiveSlot();
                }
            } catch (e) {
                console.error('[bootstrap] 初始化失败:', e);
            } finally {
                finishLoading();
            }
        };

        // getSession 读本地，理论上很快，但仍加 catch + 超时兜底
        withTimeout(supabaseClient.auth.getSession(), 6000, { data: { session: null } })
            .then((res) => bootstrap(res?.data?.session))
            .catch((e) => { console.error('[getSession] 失败:', e); finishLoading(); });

        // 只处理“真正的”登录/登出，避免与上面的 getSession 重复触发 loadAllSlots
        const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((event, session) => {
            if (cancelled) return;
            if (event === 'SIGNED_IN' && session?.user) {
                window._ehpUserId = session.user.id;
                setUser(session.user);
                loadAllSlots();
                tryRestoreActiveSlot();
            } else if (event === 'SIGNED_OUT') {
                window._ehpUserId = null;
                setUser(null);
                setSlotsData({});
                setLoading(false);
            }
        });

        return () => { cancelled = true; clearTimeout(watchdog); subscription.unsubscribe(); };
    }, []);
    
    const loadAllSlotsFromCloud = async () => {
        try {
            // 复用已知的 userId（bootstrap 里已写入），避免再发一次 getUser() 网络请求
            let userId = window._ehpUserId;
            if (!userId) {
                const r = await withTimeout(supabaseClient.auth.getSession(), 4000, { data: { session: null } });
                userId = r?.data?.session?.user?.id;
            }
            if (!userId) return {};
            const query = supabaseClient.from('saves').select('slot_id, game_data').eq('user_id', userId);
            // 云端查询加 6 秒超时：手机网络卡住时返回空而不是无限等待
            const { data } = await withTimeout(query, 6000, { data: null });
            if (!data) return {};
            const result = {};
            data.forEach(row => { result[row.slot_id] = row.game_data; });
            return result;
        } catch(e) { console.error('[loadAllSlotsFromCloud]', e); return {}; }
    };

    const loadAllSlots = async () => {
        setLoading(true);
        const cloudSlots = await loadAllSlotsFromCloud();
        const processed = {};
        for (const [slotId, data] of Object.entries(cloudSlots)) {
            if (data && data.char) processed[slotId] = { char: data.char, day: data.day };
        }
        setSlotsData(processed);
        setLoading(false);
    };
    
    const handleSelectSlot = (slotId, data) => {
        markActiveSlot(slotId);
        setCurrentSlot(slotId);
        setGameData(data);
    };
    
    const handleCreateNew = (slotId) => {
        setCurrentSlot(slotId);
        setShowCreate(true);
    };
    
    const handleCompleteCreate = (slotId, data) => {
        markActiveSlot(slotId);
        setGameData(data);
        setCurrentSlot(slotId);
        setShowCreate(false);
    };
    
    const handleBack = () => {
        clearActiveSlot();
        setCurrentSlot(null);
        setGameData(null);
        setShowCreate(false);
    };
    
    const handleLogout = async () => {
        clearActiveSlot();
        if (!user?.isGuest) await supabaseClient.auth.signOut();
        setUser(null);
        setCurrentSlot(null);
        setGameData(null);
    };
    
    if (loading) {
        return <div className="loading-spinner" style={{ minHeight: "100vh", justifyContent: "center" }}><div className="spinner"></div></div>;
    }
    
    if (!user) {
        return <Login onLogin={setUser} onGuest={() => setUser({ id: "local-guest", isGuest: true })} />;
    }
    
    if (showCreate && currentSlot) {
        return <CreateCharacter slotId={currentSlot} onComplete={handleCompleteCreate} onBack={handleBack} />;
    }
    
    if (currentSlot && gameData) {
        return <GameApp slotId={currentSlot} initialData={gameData} onBack={handleBack} />;
    }
    
    return <SlotSelector onSelectSlot={handleSelectSlot} onCreateNew={handleCreateNew} onLogout={handleLogout} />;
}

// 渲染

export default App;
