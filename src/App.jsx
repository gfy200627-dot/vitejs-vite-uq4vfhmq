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
    { id: "luxury_bag", name: "奢侈品包", price: 50, effect: { fashion: 5 }, desc: "时尚+5" },
    { id: "dinner", name: "请粉丝吃饭", price: 20, effect: { popularity: 5 }, desc: "人气+5" },
    // 颜值除整容外不可提升：长期坚持美容仅 +1~2
    { id: "beauty", name: "长期美容护理", price: 15, effect: { beautify: 1 }, desc: "长期坚持美容 · 颜值+1" },
    { id: "surgery", name: "医美整容", price: 80, effect: { beautify: 2 }, desc: "整容 · 颜值+2" },
    { id: "clothes", name: "情侣款衣服", price: 30, effect: { risk: 8, heart: 3 }, desc: "风险+8% 好感+3" }
];

const GIFT_ITEMS = [
    { id: "rose", name: "🌹 红玫瑰", price: 5, heartDelta: 3, emotionDelta: { trust: 1 } },
    { id: "perfume", name: "💝 限量香水", price: 15, heartDelta: 4, emotionDelta: { trust: 2 } },
    { id: "bracelet", name: "💫 情侣手链", price: 25, heartDelta: 5, emotionDelta: { trust: 3 } },
    { id: "letter", name: "✉️ 手写信", price: 3, heartDelta: 3, emotionDelta: { trust: 5 } }
];

// ============================================================
// 【结局系统】共 16 种：6 单人HE + 3 公共 + 3 BE + 2 OE + 2 TE(隐藏)
// 每个结局：id / 类型 / 标题 / 成就 / 结局正文 / cond(state)=>bool
// cond 收到的 state 含：hearts(好感), trust, jealousy(派生), attrs, day,
//   currentRisk(%), fandomHeat, antiCount(%), unlockedCount, endingsUnlocked, everBE, maxHeart, avgHeart 等
// ============================================================
function heartsAllGte(hearts, n) { return Object.values(hearts).every(v => v >= n); }
function trustAllGte(trustMap, n) { return Object.values(trustMap).every(v => (v ?? 0) >= n); }

const ENDINGS = [
  // ---- 单人 HE ----
  { id: "he_wonjeong", type: "HE", title: "梁祯元 ·《我与我周旋久》", achievement: "夜航船",
    cond: s => s.hearts.wonjeong >= 90 && s.trust.wonjeong >= 80 && s.attrs.人气值 >= 80 && s.attrs.国民度 >= 75 && s.attrs.时尚度 >= 70,
    text: `台上与台下，到底隔着多远。\n梁祯元曾经以为，那是一生都无法跨越的距离。他站在人群里，看过你无数次谢幕，也曾隔着屏幕为你的每一次回归争得面红耳赤。如今，他终于走到了你的身边。\n从前写在评论区里的每一句建议，如今都落成企划案里密密麻麻的批注；从前只能仰望的舞台，如今成了你们共同完成的作品。\n你靠在沙发上刷手机，忽然笑出了声——粉丝论坛热帖《关于梁祯元最近怎么不骂人了这件事》。你把手机递给他。他扫了一眼，耳尖泛红，却还是嘴硬："……闭嘴是不可能闭嘴的。第二套造型还是不好看。Ending 镜头应该再多给你两秒。"\n你伸手捏了捏他的脸："你到底是我男朋友，还是我粉丝？"\n"先是你的粉丝。然后，才成为了你的恋人。所以这两件事，我一件都不会放弃。"` },
  { id: "he_jongseong", type: "HE", title: "朴综星 ·《黄金时代》", achievement: "金钱、欲望、黄金般的爱意，全都倾泄于你",
    cond: s => s.hearts.jongseong >= 90 && s.trust.jongseong >= 85 && s.attrs.金钱值 >= 90 && s.attrs.时尚度 >= 80 && s.attrs.国民度 >= 80,
    text: `朴综星给你买了一座岛。\n他把产权证书递给你，表情一如既往的从容："你不是说想找个谁也找不到你的地方吗？"你打开证书，上面写的是你的名字。\n"朴综星……你是不是疯了？"\n他笑了，揉你的头发："没疯。就是想让你知道——你可以靠自己的本事站在山顶，但要是哪天累了，我这里永远有个地方，只属于你。"\n那一天他二十来岁，在他一生的黄金时代，他有好多奢望。想爱，想吃，还想在一瞬间变成天上半明半暗的云，轻轻地飘在你的身后，做一个用钱和心为你筑成的避风港。` },
  { id: "he_jaeyun", type: "HE", title: "沈载伦 ·《姐夫转正指南》", achievement: "一只特立独行的狗",
    cond: s => s.hearts.jaeyun >= 92 && s.trust.jaeyun >= 75 && s.currentRisk < 55 && s.fandomHeat >= 80 && s.attrs.eq >= 70,
    text: `沈载伦的姐夫病终于治好了——因为转正了。\n他注销了那个犯姐夫瘾的 ID，"悄咪咪"把剩下账号的简介改成："正牌姐夫，谢绝代餐。"\n你们官宣那天，粉圈炸了。「姐夫你别这样」投稿：沈载伦你小子是真姐夫啊？？？他窝在你旁边一条条翻评论，看到骂他的就哼哼唧唧，看到祝福的就截图保存。你踢他一脚："你能不能别看了？"\n他把手机一扔，翻身抱住你："不看就不看。我有真人，谁还看评论啊。"` },
  { id: "he_sunghoon", type: "HE", title: "朴成训 ·《慢热终章》", achievement: "我在等风也等你",
    cond: s => s.hearts.sunghoon >= 88 && s.trust.sunghoon >= 90 && s.attrs.国民度 >= 70 && s.fandomHeat > 80 && !s.otherHighAmbiguity("sunghoon"),
    text: `朴成训已经很久没有焦虑了。\n他打字慢，每次吵架都落下风，只能悄悄在小号上写满忧郁。透过镜头，他无法窥见真实的你；绕过镜头，真实的你让他患得患失。但最后，你慢慢贴近他的心，一次次告诉他：我不会走。\n你们公开时，他没有发长文，只发了一张图——他拍的第一张你的舞台照，和一张摆在花束旁的戒指盒照片拼在一起。配文只有三个字："从开始。"` },
  { id: "he_sunoo", type: "HE", title: "金善禹 ·《如初见》", achievement: "枕草子",
    cond: s => s.hearts.sunoo >= 90 && s.trust.sunoo >= 80 && s.attrs.国民度 >= 85 && s.attrs.时尚度 >= 75 && s.attrs.eq >= 85,
    text: `你们没有官宣。\n只是 INS 上那个搬运博的运营者，某天新增了一串日期。粉丝以为是他的运营年限。只有你知道——那是他认识你的年份，到现在。\n他朋友打电话来问：你们不公开？他开着免提，手里剥着橘子，语气很平："她站在台上发光的时候，所有人都在看。我站在台下看，跟站在家里看，有什么区别？"\n你踢了他一脚。他笑着把橘子递到你嘴边。全世界不需要知道你属于他，全世界只需要知道他属于你，这就够了。` },
  { id: "he_riki", type: "HE", title: "西村力 ·《刀子嘴豆腐心的末日》", achievement: "月曜日",
    cond: s => s.hearts.riki >= 90 && s.trust.riki >= 70 && s.attrs.人气值 >= 80,
    text: `西村力变了。\n他大号还在骂人——骂公司、骂黑粉、骂对家粉，嘴毒得一如既往。但再没对你说过一句重话。粉丝问他："刀哥现在怎么不骂姐了？是不是不爱了？"\n他思索片刻，然后说："爱啊。就是……不想让她再听那些难听的话了。我以前用骂人表达关心，后来发现，她配得上更好的爱法。"\n你回他："刀哥，你正常点。"他秒回："你再叫我刀哥我现在就去你宿舍楼下骂你。"\n还是这样的他最对味。` },
  // ---- 公共结局 ----
  { id: "co_haihou_a", type: "公共", title: "海后 ·《你们都是我的翅膀》", achievement: "粉圈历史第一人",
    cond: s => s.unlockedCount === 6 && heartsAllGte(s.hearts, 85) && trustAllGte(s.trust, 75) && s.currentRisk < 40,
    text: `六个人都知道了彼此的存在，但他们选择……共存。\n梁祯元第一个发现，把所有证据甩在桌上："你自己说。"你只能全招了。全场沉默。朴综星先开口："……所以呢？"金善禹笑了："那怎么办？又不是假的。"西村力靠在墙角："……那就这样吧。"\n"我们认识的她，本来就是这样的。她谁都喜欢，谁都不想伤害。既然分不开，那就……一起守着她吧。"\n你从顶流爱豆变成了拥有六人骑士的女王。粉丝锐评：这不是海后，这是女帝。` },
  { id: "co_haihou_c", type: "公共", title: "海后 ·《最后的派对》", achievement: "风暴眼",
    cond: s => s.unlockedCount === 6 && heartsAllGte(s.hearts, 80) && s.currentRisk >= 65,
    text: `完蛋了，全都暴露了——私生锤、姐夫站十连投、队友粉狂欢。粉圈炸了，热搜前十挂了六个。公司连夜开会。\n你坐在宿舍里，手机在震动，屏幕上六个人的消息在轮流弹。暴风雨中心。危机是他们留下的唯一证据。` },
  { id: "co_solo", type: "公共", title: "《独美，勿扰》", achievement: "顶流女王，无冕之皇",
    cond: s => Object.values(s.hearts).every(v => v <= 50) && s.attrs.人气值 >= 90 && s.attrs.国民度 >= 85 && s.fandomHeat > 90,
    text: `你把所有心思都放在了事业上。没有攻略任何人，没有暧昧，没有私联。你只专注舞台、音乐、作品。你的专辑横扫各大榜单，演唱会一票难求，代言接到手软。\n你站在万人演唱会的舞台上，灯光照亮你一个人。你对着台下说："谢谢你们。我一直都是一个人，但我从来不孤独。"全场尖叫。\n你把手机扣下，对着化妆镜笑了一下。很好。你拥有了全世界。` },
  // ---- BE ----
  { id: "be_trust", type: "BE", title: "《信任崩塌》", achievement: "得不到就一起毁灭",
    cond: s => s.someFan(f => s.hearts[f] < 90 && s.trust[f] < 40 && s.jealousy[f] >= 110),
    text: `某位男主在极度吃醋和极度不信任下，做出了不可挽回的事——公开所有私联记录、放出聊天截图、把一切摊在阳光下。你被全网审判，从顶流跌入深渊。他毁了你们所有，因为他觉得，得不到就一起毁灭。` },
  { id: "be_bye", type: "BE", title: "《姐，再见》", achievement: "彻底归零",
    cond: s => s.currentRisk >= 90 && s.antiCount >= 50 && s.fandomHeat < 30,
    text: `你失去了粉丝，也失去了大粉。六个人陆续离开，不是因为不爱，是因为你的选择和操作让他们觉得——"她好像不是我们认识的那个她了。"\n你坐在空荡荡的宿舍里，手机上"姐夫你别这样"挂着的还是你的锤。没有行程，没有通告，没有粉丝。六个人的 ID 全部停更。你一个人，彻底归零。` },
  { id: "be_confess", type: "BE", title: "《自毁式告白》", achievement: "他的爱烧了自己也烧了你",
    cond: s => s.someFan(f => s.hearts[f] >= 90 && s.jealousy[f] >= 100) && s.currentRisk >= 70,
    text: `他选择在直播中自爆："我喜欢她，六年了。她不要我，那我就让所有人都知道。"\n你被拖下水。他的爱太炽热，烧了自己，也烧了你。你被迫回应，被迫承认，被迫失去一切。他哭着说对不起，但已经来不及了。` },
  // ---- OE ----
  { id: "oe_withdraw", type: "OE", title: "《戒断反应》", achievement: "未完待续",
    cond: s => Object.values(s.hearts).every(v => v >= 60 && v <= 80) && s.unlockedCount >= 2,
    text: `你决定停止私联，专心事业。六个人……没有挽留。\n结局未完待续。你走不掉的。他们也走不掉。` },
  { id: "oe_parallel", type: "OE", title: "《平行时空》", achievement: "把答案留给了想象",
    cond: s => s.attrs.人气值 >= 88 && Object.values(s.hearts).every(v => v >= 80 && v <= 85),
    text: `你在演唱会上对着台下六个人的方向停了三秒。你没有指认任何人，你只是笑了一下。后来，你在私密小号发了一句话："如果平行时空存在，我会选一个全都不要，再选一个全都想要。"\n第二天，六个人同时点赞。但没人再追问。你们心照不宣，把答案留给了想象。` },
  // ---- TE(隐藏) ----
  { id: "te_sixworld", type: "TE", title: "《六人一世界》", achievement: "六个姐夫轮流值班",
    cond: s => heartsAllGte(s.hearts, 95) && trustAllGte(s.trust, 80) && s.attrs.人气值 >= 85 && s.currentRisk < 25,
    text: `不是海王，是真·六人共妻。六个人达成了某种微妙的平衡——他们不是共享，而是"守护同盟"。梁祯元负责你的事业，朴综星负责你的物质，沈载伦负责你的快乐，朴成训负责你的安全感，金善禹负责你的情绪，西村力负责你的"清醒"。\n你站在舞台中央，台下六个人各自举着你的灯牌，上面写着不同的字，拼在一起是同一句话——"我们都在。"\n粉圈从"打死那个姐夫"变成"六个姐夫轮流值班"，最后变成了"算了，姐姐开心就好"。` },
  { id: "te_restart", type: "TE", title: "《重来》", achievement: "慢慢来",
    cond: s => s.endingsUnlocked.length >= 3 && s.everBE && heartsAllGte(s.hearts, 90) && s.attrs.人气值 >= 85,
    text: `你在某个清晨醒来，手机里是六条未读消息——不同的 ID，不同的语气，但都是同一句话："你醒了？今天签售，我会去。你不用选我。你只要选你自己就好。"\n你愣了一下。这一幕，你好像……经历过很多次了。你笑了笑，推开窗，阳光照进来。不管哪一次轮回，你都会走上这条路。但这一次，你决定——慢慢来。` }
];

// 结局评估：返回第一个满足条件的结局（TE 优先，其次公共/HE，再 BE/OE）
function evaluateEnding(state) {
  const order = ["TE", "公共", "HE", "BE", "OE"];
  const sorted = [...ENDINGS].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  for (const e of sorted) {
    try { if (e.cond(state)) return e; } catch { /* skip malformed cond */ }
  }
  return null;
}

// ============================================================
// 【独立成就系统】与结局解耦的里程碑成就：游戏过程中随状态达成即解锁（带 toast）。
// cond 收到的 state 与 evaluateEnding 同源（buildEndingState），额外附带 cycleCount / achievementsUnlocked。
// 成就是"粘性"的：一旦解锁永久保留，可跨周目累积。图鉴里未解锁时显示 hint 而非 desc。
// ============================================================
const ACHIEVEMENTS = [
  { id: "ac_first_unlock", icon: "🎣", name: "初次私联", desc: "拿到了第一位大粉的私人联系方式。", hint: "和某位大粉的关系足够近，走出第一步。",
    cond: s => s.unlockedCount >= 1 },
  { id: "ac_three_lines", icon: "🕸️", name: "时间管理", desc: "同时私联 3 位大粉，游刃有余。", hint: "同时私联多位大粉。",
    cond: s => s.unlockedCount >= 3 },
  { id: "ac_six_lines", icon: "👑", name: "六线女帝", desc: "六条船全部点亮，粉圈时间管理之神。", hint: "私联全部六位大粉。",
    cond: s => s.unlockedCount >= 6 },
  { id: "ac_soulmate", icon: "💞", name: "命中注定", desc: "对某位大粉的好感度突破 95。", hint: "把某位大粉的好感度推到极致。",
    cond: s => s.maxHeart >= 95 },
  { id: "ac_top", icon: "🔥", name: "顶流", desc: "人气值达到 90，一线顶流。", hint: "把人气值做到很高。",
    cond: s => (s.attrs?.人气值 ?? 0) >= 90 },
  { id: "ac_national", icon: "🇰🇷", name: "国民女神", desc: "国民度达到 90，全民偶像。", hint: "把国民度做到很高。",
    cond: s => (s.attrs?.国民度 ?? 0) >= 90 },
  { id: "ac_fashion", icon: "💃", name: "时尚 Icon", desc: "时尚度达到 90，红毯常客。", hint: "把时尚度做到很高。",
    cond: s => (s.attrs?.时尚度 ?? 0) >= 90 },
  { id: "ac_rich", icon: "💰", name: "财富自由", desc: "金钱值达到 90，甲方变乙方。", hint: "把金钱值攒到很高。",
    cond: s => (s.attrs?.金钱值 ?? 0) >= 90 },
  { id: "ac_brink", icon: "💣", name: "塌房边缘", desc: "暴露风险一度冲到 80，命悬一线。", hint: "把暴露风险作到极高（然后祈祷）。",
    cond: s => s.currentRisk >= 80 },
  { id: "ac_survive", icon: "🧯", name: "化险为夷", desc: "从塌房边缘全身而退，把风险压回安全区。", hint: "在经历高危之后，把风险重新降下来。",
    cond: s => s.achievementsUnlocked.includes("ac_brink") && s.currentRisk < 30 },
  { id: "ac_blackred", icon: "🌶️", name: "黑红也是红", desc: "黑粉占比与粉圈热度同时飙高。", hint: "在巨大争议中依然保持超高热度。",
    cond: s => (s.antiCount ?? 0) >= 60 && (s.fandomHeat ?? 0) >= 70 },
  { id: "ac_pure", icon: "😇", name: "纯爱战士", desc: "谁都没私联，却把事业做到了顶。", hint: "一个都不撩、只搞事业，还得混得好。",
    cond: s => s.unlockedCount === 0 && (s.attrs?.人气值 ?? 0) >= 85 },
  { id: "ac_persist", icon: "📅", name: "坚持不懈", desc: "一个周目坚持到了第 30 天。", hint: "在同一周目里活得够久。",
    cond: s => (s.day ?? 0) >= 30 },
  { id: "ac_collector", icon: "📚", name: "结局收藏家", desc: "累计解锁 5 个不同结局。", hint: "解锁足够多的结局。",
    cond: s => s.endingsUnlocked.length >= 5 },
  { id: "ac_completionist", icon: "🏆", name: "全结局达成", desc: "解锁全部结局，真·通关。", hint: "解锁所有结局。",
    cond: s => s.endingsUnlocked.length >= ENDINGS.length },
  { id: "ac_reincarnation", icon: "🔁", name: "轮回者", desc: "开启了第 2 个周目，走上重来的路。", hint: "结束一个周目，再来一次。",
    cond: s => (s.cycleCount ?? 0) >= 1 }
];
// 结局类型元信息（图鉴分组 + 未解锁时的模糊提示）
const ENDING_TYPE_META = {
  "HE":   { label: "单人结局 · Happy End", hint: "与某位大粉修成正果" },
  "公共": { label: "公共结局",             hint: "六人关系的某种收束" },
  "BE":   { label: "Bad End",              hint: "关系破裂 / 塌房的结局" },
  "OE":   { label: "Open End",             hint: "悬而未决的开放结局" },
  "TE":   { label: "隐藏结局 · True End",  hint: "达成特定隐藏条件才会解锁" }
};

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

// ============================================================
// 【光夜变奏】平行世界线 + 心动邂逅地点
// 仅常驻主世界(main)可玩；其余为预留世界线，切换只改变全局主题并展示"序章筹备"。
// 邂逅始终通过 continueStory 接入主线引擎，绝不新开一套逻辑。
// ============================================================
const WORLDS = [
    { id: "main", code: "PRIME", name: "璀璨人生", unlocked: true,
      tagline: "镁光灯下的娱乐圈修罗场",
      desc: "顶流爱豆的双面人生。每一次营业与暗涌，都会把这条世界线推向新的分歧。",
      cardLabel: "主线 · 平行时空" },
    { id: "vampire", code: "SANGUIS", name: "赤红契约", unlocked: false,
      tagline: "古堡 · 暗夜 · 血族博弈",
      desc: "月色浸透的古堡长廊，甜腥的猎杀与誓约。血族平行宇宙 · 序章筹备中。",
      cardLabel: "血族 · 赤红契约" },
    { id: "cyber", code: "MACHINA", name: "齿轮宿命", unlocked: false,
      tagline: "霓虹夜雨 · 仿生之心",
      desc: "机械与人心的边界正在融化。赛博平行宇宙 · 序章筹备中。",
      cardLabel: "赛博 · 齿轮宿命" },
    { id: "future", code: "TO·BE", name: "未完待续", unlocked: false,
      tagline: "下一条世界线，正在观测中",
      desc: "更多平行时空即将展开，敬请期待。",
      cardLabel: "？？？" }
];
function getWorld(id) { return WORLDS.find(w => w.id === id) || WORLDS[0]; }

const ENCOUNTER_LOCATIONS = {
    main: [
        { emoji: "☕", title: "咖啡店", sub: "靠窗的角落，拿铁的热气模糊了视线" },
        { emoji: "🎬", title: "电影院", sub: "散场后的空厅，银幕的余光还没散" },
        { emoji: "🌳", title: "公园", sub: "傍晚的长椅，风把落叶吹到脚边" },
        { emoji: "🏪", title: "深夜便利店", sub: "收工后偶遇，关东煮冒着热气" },
        { emoji: "🚗", title: "回程的车里", sub: "保姆车最后一排，肩靠着肩" }
    ],
    vampire: [
        { emoji: "🕯️", title: "古堡长廊", sub: "烛影摇曳，脚步声回荡在石壁间" },
        { emoji: "⚰️", title: "地窖一角", sub: "血色微光，禁忌在阴影里滋长" },
        { emoji: "🌙", title: "月光庭院", sub: "夜露与蔷薇，月色浸透衣袖" },
        { emoji: "🍷", title: "血色宴会厅", sub: "水晶灯下的博弈，杯中泛着暗红" }
    ],
    cyber: [
        { emoji: "🌧️", title: "霓虹雨巷", sub: "全息广告在积水里破碎" },
        { emoji: "🔧", title: "仿生维修舱", sub: "冷光与线缆，机械之心在跳" },
        { emoji: "🚝", title: "悬浮列车", sub: "穿过夜城，车窗映出两张脸" }
    ]
};
function getEncounterLocations(worldId) { return ENCOUNTER_LOCATIONS[worldId] || ENCOUNTER_LOCATIONS.main; }

function initFanEmotions() {
    const emotions = {};
    FANS.forEach(fan => { emotions[fan.id] = { trust: 40, jealousy: 25, recentInteractions: [] }; });
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
    if (data.dailyPlan === undefined) data.dailyPlan = { morning: null, noon: null, evening: null };
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
    // ===== V18 → V19 迁移 =====
    // 1) 海后值删除；2) 暴露风险/疑虑从 0-10 改百分制；3) 黑粉改百分比；
    // 4) 大粉情感删去 affection/obsession（好感统一用 hearts），吃醋度改由公式派生
    if (!data.schemaV19) {
        delete data.seaLevel;
        if (typeof data.currentRisk === "number" && data.currentRisk <= 10) data.currentRisk = Math.round(data.currentRisk * 10);
        if (typeof data.suspicion === "number" && data.suspicion <= 10) data.suspicion = Math.round(data.suspicion * 10);
        if (typeof data.antiCount === "number" && data.antiCount > 20) data.antiCount = Math.min(100, Math.round(data.antiCount / 3)); // 旧的绝对值 → 百分比近似
        if (data.fanEmotions && typeof data.fanEmotions === "object") {
            Object.keys(data.fanEmotions).forEach(k => {
                const e = data.fanEmotions[k] || {};
                data.fanEmotions[k] = { trust: e.trust ?? 40, jealousy: e.jealousy ?? 25, recentInteractions: e.recentInteractions || [], relationshipStatus: e.relationshipStatus };
            });
        }
        data.schemaV19 = true;
    }
    if (data.altAccounts === undefined) data.altAccounts = { twitter: false, tiktok: false, weibo: false, instagram: false };
    if (data.encounterUsed === undefined) data.encounterUsed = {};
    if (data.endingsUnlocked === undefined) data.endingsUnlocked = [];
    if (data.achievementsUnlocked === undefined) data.achievementsUnlocked = [];
    if (data.cycleCount === undefined) data.cycleCount = 0;
    // ===== V20 迁移：时段制 + 熟练度 + 私联门槛 =====
    if (!data.schemaV20) {
        if (!data.proficiency || typeof data.proficiency !== "object") data.proficiency = { vocal: 0, dance: 0, rap: 0, "时尚度": 0 };
        if (!data.lastTrainDay || typeof data.lastTrainDay !== "object") data.lastTrainDay = {};
        if (data.lastUnlockDay === undefined) data.lastUnlockDay = 0;
        if (!data.interactionCount || typeof data.interactionCount !== "object") data.interactionCount = {};
        data.schemaV20 = true;
    }
    // ===== V22 迁移：心力 / 每日行动数（取代 slotsDone 时段光标）=====
    if (!data.schemaV22) {
        if (data.mentalEnergy === undefined) data.mentalEnergy = MENTAL_MAX;
        if (data.todayActions === undefined) data.todayActions = 0;
        delete data.slotsDone; // 旧存档里的时段光标已废弃，清掉避免误用
        data.schemaV22 = true;
    }
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

// 顶部时间：把"天数"映射成一个会随剧情推进变化的时钟/日期显示（顶部仅保留时间变化）
function gameClock(day) {
    const d = Math.max(1, day || 1);
    const week = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    return `${week[(d - 1) % 7]} · 第${Math.ceil(d / 7)}周`;
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
// 【日程系统 · V20 时段/熟练度】玩家自定义早/中/晚行程
// ⚠️ 日程不再直接加属性！每个技能时段只累积「熟练度」，同一条线连续做 6 次
//    （≈ 长期做 >5 天）才由后端兑换 +1 属性。日程的真正作用是「成为当天剧情的骨架」。
// 每个活动声明一条 track（对应后端的四条熟练度赛道，靠 name 里的关键词被后端识别）：
//   vocal(声乐) / dance(舞蹈) / rap(说唱) / 时尚度(时尚·形体)；track:null = 休息/剧情，不练熟练度。
// 只有 money 是即时结算的（资金收入），其余一律走剧情与熟练度。
// ============================================================
const SCHEDULE_SLOTS = [
    { key: "morning", label: "上午", emoji: "🌅", desc: "上午时段" },
    { key: "noon", label: "下午", emoji: "☀️", desc: "下午时段" },
    { key: "evening", label: "晚上", emoji: "🌙", desc: "晚间时段" }
];

// 时段：morning/noon/evening ↔ 上午/下午/晚上。一天分三段，剧情一次只演一段。
const SLOT_KEYS = ["morning", "noon", "evening"];
const SLOT_CN = { morning: "上午", noon: "下午", evening: "晚上" };
const slotKeyFromDone = (n) => SLOT_KEYS[Math.max(0, Math.min(2, (n | 0)))];
const slotLabelFromDone = (n) => SLOT_CN[slotKeyFromDone(n)];

// 熟练度赛道（与后端 TRACKS 对齐，仅用于前端显示进度）
const PROF_TRACKS = ["vocal", "dance", "rap", "时尚度"];
const PROF_TRACK_CN = { vocal: "声乐", dance: "舞蹈", rap: "Rap", "时尚度": "时尚/形体" };
const PROF_PER_LEVEL = 6; // 与后端一致：累计 6 次同类训练兑换 +1 属性
const emptyProficiency = () => ({ vocal: 0, dance: 0, rap: 0, "时尚度": 0 });

const SCHEDULE_OPTIONS = {
    morning: [
        { id: "m_dance", emoji: "💃", name: "练舞房", track: "dance", desc: "练舞蹈熟练度（练满6次+1）" },
        { id: "m_vocal", emoji: "🎤", name: "声乐课", track: "vocal", desc: "练声乐熟练度（练满6次+1）" },
        { id: "m_gym", emoji: "🏋️", name: "晨间健身塑形", track: "时尚度", desc: "练时尚/形体熟练度" },
        { id: "m_sleep", emoji: "😴", name: "睡到自然醒", track: null, desc: "养精蓄锐 · 不产生熟练度" }
    ],
    noon: [
        { id: "n_studio", emoji: "🎙️", name: "录音棚练歌", track: "vocal", desc: "练声乐熟练度" },
        { id: "n_rap", emoji: "🎧", name: "说唱·作词", track: "rap", desc: "练Rap熟练度" },
        { id: "n_magazine", emoji: "📸", name: "杂志拍摄", track: "时尚度", desc: "练时尚熟练度 · 露脸" },
        { id: "n_brand", emoji: "👜", name: "品牌活动", track: null, money: 6, desc: "资金+6万 · 剧情露脸" }
    ],
    evening: [
        { id: "e_review", emoji: "🪩", name: "编舞排练", track: "dance", desc: "练舞蹈熟练度" },
        { id: "e_live", emoji: "🔴", name: "晚间直播", track: null, desc: "人气/剧情 · 之后可去Weverse开播" },
        { id: "e_sns", emoji: "📱", name: "营业发图", track: null, desc: "人气/剧情 · 营业" },
        { id: "e_rest", emoji: "🛁", name: "居家休息", track: null, desc: "放空自己 · 不产生熟练度" }
    ]
};

// 按 id 找活动（跨时段查找）
function findScheduleActivity(id) {
    if (!id) return null;
    for (const slot of Object.keys(SCHEDULE_OPTIONS)) {
        const hit = SCHEDULE_OPTIONS[slot].find(a => a.id === id);
        if (hit) return hit;
    }
    return null;
}

// 把一天的行程（活动 id）转成后端需要的中文活动名 { morning, noon, evening }。
// 后端靠这些中文名里的关键词把训练归类到熟练度赛道，所以这里必须给「名字」而不是 id。
function planToScheduleNames(plan) {
    const out = { morning: "", noon: "", evening: "" };
    if (!plan) return out;
    for (const key of SLOT_KEYS) {
        const a = findScheduleActivity(plan[key]);
        out[key] = a ? a.name : "";
    }
    return out;
}

// 把一天的行程记录（兼容旧随机格式）总结成一行可读文本，给日历用
function summarizeScheduleEntry(entry) {
    if (!entry) return "";
    // 新格式：{ morning, noon, evening }
    if (entry.morning !== undefined || entry.noon !== undefined || entry.evening !== undefined) {
        const parts = SCHEDULE_SLOTS.map(s => {
            const a = findScheduleActivity(entry[s.key]);
            return a ? a.name : null;
        }).filter(Boolean);
        return parts.length ? parts.join("·") : "自由活动";
    }
    // 旧随机格式：{ name }
    return entry.name || "";
}

// ============================================================
// 【主线节拍器 · V21】平衡「日程系统」与「主线剧情」
// 问题：日程闸门 + 剧情围绕日程展开之后，AI 每一拍都在写训练/营业流水账，
//       神秘联系人、大粉线、危机事件（真正的主线）没有任何「必须推进」的信号，
//       会无限停滞 —— 日程把主线饿死了。
// 方案：给主线装一个节拍器。连续 MAINLINE_PUSH_AFTER 拍没有实质主线进展
//       （好感/信任变化、私联、危机发酵、特殊事件都算「动了」），下一拍就
//       强制要求后端/模型推进主线，日程退为背景板。任何来源的好感变化
//       （剧情结算、私聊、送礼、通话）都会把怠速清零 —— 玩家主动经营关系，
//       本身就是在推主线，不该再被系统追着强推。
// ============================================================
const MAINLINE_PUSH_AFTER = 2;   // 连续 2 拍没动主线 → 第 3 拍强制推进
const MAINLINE_IDLE_CAP = 9;     // 怠速计数上限（防无限增长，也避免指令文案数字失真）

// ============================================================
// 【心力 / 每日行动 · 主线推进约束】把"一天能推多少主线"这件事管起来：
//   · 主线（AI 剧情选项）每选一次消耗心力；心力见底就只能休息/日程，逼出节奏。
//   · 一天不再靠"日程走完"自动结束，而是玩家自己点【结束今天】；每天恢复心力、清零行动数。
//   · 日程/社交/休息不耗心力。
// ============================================================
const MENTAL_MAX = 100;                 // 心力上限
const MENTAL_COST_MAINLINE = 15;        // 每个主线选项消耗
const MENTAL_RECOVER_PER_DAY = 50;      // 每天开始恢复
const MENTAL_MIN_TO_ACT = 10;           // 低于此值主线选项不可选
const MENTAL_WARN = 20;                  // 低于此值状态栏变黄提醒
const MAX_ACTIONS_PER_DAY = 5;          // 做满这么多件事，系统建议休息（软上限，不强制）

// 一天内"做了几件事"→ 一个粗略的时间感（顶部状态栏用；替代旧的 slotsDone 时段光标）
const dayPhaseFromActions = (n) => {
    const k = n | 0;
    if (k <= 0) return "清晨";
    if (k === 1) return "上午";
    if (k === 2) return "午后";
    if (k === 3) return "黄昏";
    if (k === 4) return "入夜";
    return "深夜";
};
// 给后端一个中性时段（主线解耦后不再有"上午/下午/晚上"的日程时段概念，仅为兼容后端签名）
const neutralSlotFromActions = (n) => (n | 0) <= 1 ? "morning" : (n | 0) <= 3 ? "noon" : "evening";

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
// ⭐ 兜底安全网：识别"公开帖被写成了第二人称剧情旁白"的漏网帖（如"你窝进沙发，摸出手机"）。
// 与后端 isNarrationLeak 同一套判据：只挑极旁白化的动词、且必须带「你」，避免误伤
// "想你了/求翻牌/她好美"这类正常粉丝发言。命中的帖子直接不渲染（宁缺毋滥）。
const POST_NARRATION_LEAK = /你(?:窝进|靠在|坐在|站在|躺在|走进|走近|摸出|掏出|塞回|扣下|攥|挑眉|皱眉|垂眸|抬眸|抬眼|抿(?:了|着)?唇|咽了口|顿住|愣(?:了|住))/;
function isPostNarrationLeak(p) {
    if (!p) return false;
    return POST_NARRATION_LEAK.test(String(p.content || "")) || POST_NARRATION_LEAK.test(String(p.title || ""));
}
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
    // 再叠一层：丢掉写成第二人称剧情旁白的漏网帖（后端漏了前端也兜住）。
    return arr
        .map(makePost)
        .filter(p => p.mine || (p.content && p.content.trim()) || (p.title && p.title.trim()) || p.media)
        .filter(p => p.mine || !isPostNarrationLeak(p));
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
function LiveModal({ char, currentRisk, fandomHeat, antiCount, coupleExposure,
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
    const liveContextRef = React.useRef({ currentRisk, fandomHeat, antiCount });
    const livePhaseRef = React.useRef(0);
    // ⭐ 记录玩家最近一次直播发言（30秒内有效），让后台批量拉的弹幕也能呼应
    const lastPlayerSpeechRef = React.useRef(null);

    React.useEffect(() => { liveTopicRef.current = liveTopic; }, [liveTopic]);
    React.useEffect(() => { liveContextRef.current = { currentRisk, fandomHeat, antiCount }; }, [currentRisk, fandomHeat, antiCount]);
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

    // 开播时拉一批进场弹幕（只此一次，不再后台轮询）
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
                    gameContext: { riskLevel: ctx.currentRisk, fandomHeat: ctx.fandomHeat, antiCount: ctx.antiCount, artistName: char?.artistName, nickname: char?.nickname },
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
        // ⭐ 开播只拉这一批弹幕；之后【不再后台自动生成】，改为等玩家说话/做动作/翻牌时才生成。
        // 这样弹幕缓冲区不会被后台批次堆满，玩家发言后的回复能立刻插队滚出，彻底消除"回复滞后"。
        fetchBatch("开播");
        // 注意：故意不设 setInterval —— 直播间在玩家不操作时保持安静，等待玩家继续操作。
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
    // ⭐ 上一次请求还在路上时，把"玩家最新一次发言"暂存在这里，等当前请求结束立刻补发，
    //    确保玩家最新发言绝不会石沉大海（旧逻辑是直接 return 丢弃，会出现"说了话没人理"）。
    const pendingDanmakuArgsRef = React.useRef(null);

    // isSpeech=true 时传 playerSpeech，false 时传 playerAction
    // isSpeech=true 时传 playerSpeech，false 时传 playerAction
    const fetchMoreDanmaku = async (action, isSpeech = false, replyTarget = null) => {
        addWorldState(`直播中${replyTarget ? `回复${replyTarget.user}：` : isSpeech ? "说：" : ""}${action.slice(0, 30)}`);
        // ⭐ 玩家说话时，记录到 ref，让后台批量拉的也能用上
        if (isSpeech) {
            lastPlayerSpeechRef.current = { text: action, time: Date.now() };
        }
        // ⭐ 真正"回复了某条大粉弹幕" → 该大粉心动 +3（从原来"点一下就加"挪到这里，更合理也更难刷）
        // ✅ 防重入：如果上一次请求还没回来，把这次"最新一次"暂存，等当前请求结束再补发（不丢弃）
        if (fetchingDanmakuRef.current) {
            pendingDanmakuArgsRef.current = { action, isSpeech, replyTarget };
            return;
        }
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
                        : `主播（${char?.artistName || "本人"}）刚刚开口说：「${action}」。这批 9-10 条弹幕里至少有一半（含相关的几位男主）必须直接回应这句话的具体内容（接梗、反应、追问、起哄、共情等），不要写跟这句话无关的通用弹幕。`
                }
                : {
                    playerAction: action,
                    instruction: `主播刚刚做了「${action}」这个动作/互动，新弹幕要紧贴这个具体行为生成反应。`
                }
            )
        };
        try {
            const result = await callEdgeFunction('live', {
                gameContext: { riskLevel: currentRisk, fandomHeat, antiCount, artistName: char?.artistName, nickname: char?.nickname },
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
            // ⭐ 有暂存的最新发言 → 立刻补发，保证玩家最后那句话也能拿到弹幕回应
            const pending = pendingDanmakuArgsRef.current;
            if (pending) {
                pendingDanmakuArgsRef.current = null;
                fetchMoreDanmaku(pending.action, pending.isSpeech, pending.replyTarget);
            }
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
    // 【V22】DM 聊天记忆：每位大粉记住"她对他说过的实质消息"（纯玩家话，最近8条），喂给后端做召回
    const [dmMemory, setDmMemory] = React.useState(initialData.dmMemory || {});
    
    // 世界状态
    // 需求：删除海后值；暴露风险改百分制(0-100)；黑粉改百分比(初始<10%)；粉圈热度初始 30-70 随机
    const [currentRisk, setCurrentRisk] = React.useState(initialData.currentRisk || 0); // 暴露风险 0-100（百分制）
    const [suspicion, setSuspicion] = React.useState(initialData.suspicion || 0); // 粉丝疑虑值（0-100），疑虑>=50时下次失误触发真实风险
    // 【同回合 risk 累积上限】一个回合内（一段剧情期间）最多累积风险，防止多触发点叠加暴毙
    const riskTurnAccumRef = React.useRef(0);
    const RISK_TURN_CAP = 15;
    const [fandomHeat, setFandomHeat] = React.useState(initialData.fandomHeat ?? (Math.floor(Math.random() * 41) + 30)); // 粉圈热度 30-70 随机
    const [antiCount, setAntiCount] = React.useState(initialData.antiCount ?? (Math.floor(Math.random() * 8) + 2)); // 黑粉占比 %，初始 <10%
    const [money, setMoney] = React.useState(initialData.money ?? 10);
    const [companyFavor, setCompanyFavor] = React.useState(initialData.companyFavor || 60);
    const [companyContract, setCompanyContract] = React.useState(initialData.companyContract || null); // 不平等条约
    
    // 完整属性系统
    // 需求：人气/国民度/时尚初始 30；颜值除整容外不可提升（美容仅+1~2）；智商情商固定；vocal/dance/rap 可增减
    const [attrs, setAttrs] = React.useState(initialData.attrs || {
        人气值: 30,
        颜值: Math.floor(Math.random() * 21) + 55,   // 出道颜值底子（固定，除整容/长期美容外不涨）
        国民度: 30,
        时尚度: 30,
        金钱值: 10,                                     // 资金初始 10（万）
        vocal: Math.floor(Math.random() * 31) + 55,
        dance: Math.floor(Math.random() * 31) + 55,
        rap: Math.floor(Math.random() * 31) + 45,
        iq: Math.floor(Math.random() * 21) + 70,       // 固定
        eq: Math.floor(Math.random() * 21) + 65        // 固定
    });
    
    // 剧情状态
    const [currentStory, setCurrentStory] = React.useState(initialData.currentStory || INIT_STORY);
    const [currentChoices, setCurrentChoices] = React.useState(initialData.currentChoices || INIT_CHOICES);
    const [history, setHistory] = React.useState(initialData.history || []);
    const [schedules, setSchedules] = React.useState(initialData.schedules || {});
    const [scheduleMap, setScheduleMap] = React.useState(initialData.scheduleMap || {}); // 每天实际行程记录
    const [dailyPlan, setDailyPlan] = React.useState(initialData.dailyPlan || { morning: null, noon: null, evening: null }); // 今日早/中/晚行程（待确认）
    // 【心力 / 每日行动】主线推进约束 + 玩家主动结束一天（取代旧的 slotsDone 时段光标）
    const [mentalEnergy, setMentalEnergy] = React.useState(initialData.mentalEnergy ?? MENTAL_MAX); // 心力 0-100，主线每选一次 -15，每天 +50
    const [todayActions, setTodayActions] = React.useState(initialData.todayActions ?? 0);          // 今天做了几件事（主线/日程/社交/休息各 +1），结束一天归零
    // 熟练度：日程不直接加属性，练同一条线累计到 6 才由后端兑换 +1。这里存后端算好的进度。
    const [proficiency, setProficiency] = React.useState(initialData.proficiency || emptyProficiency());
    const [lastTrainDay, setLastTrainDay] = React.useState(initialData.lastTrainDay || {}); // 每条赛道最后训练日（后端算停练衰减用）
    const [lastUnlockDay, setLastUnlockDay] = React.useState(initialData.lastUnlockDay ?? 0); // 上次私联的天数（后端算 7 天冷却）
    const [interactionCount, setInteractionCount] = React.useState(initialData.interactionCount || {}); // 与各大粉的实质交集次数（私联门槛之一）
    // 【主线节拍器 · V21】主线怠速计数：连续多少拍剧情没有实质主线进展（跨天累计，随存档持久化）
    const [mainlineIdle, setMainlineIdle] = React.useState(initialData.mainlineIdle ?? 0);
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
    // ⭐ KakaoTalk 私聊：新消息到达 / 打开私聊时，自动把最新消息滚到可见处，不用玩家手划
    const kakaoEndRef = React.useRef(null);
    
    // UI 状态
    const [activeTab, setActiveTab] = React.useState("home");
    const [showSidebar, setShowSidebar] = React.useState(false);
    const [showPhone, setShowPhone] = React.useState(false);
    const [activeModal, setActiveModal] = React.useState(null);
    const [showPrivateChat, setShowPrivateChat] = React.useState(null);
    const [showFanDetail, setShowFanDetail] = React.useState(null);
    const [showGift, setShowGift] = React.useState(false);
    const [showRelationGraph, setShowRelationGraph] = React.useState(false);
    // 【光夜变奏】平行世界 + 跃迁过场 + 心动邂逅 UI 状态（纯前端，不影响原有存档结构）
    const [currentWorld, setCurrentWorld] = React.useState(initialData.currentWorld || "main");
    const [isWarping, setIsWarping] = React.useState(false);
    const [warpTarget, setWarpTarget] = React.useState(null);
    const [showWorldMap, setShowWorldMap] = React.useState(false);
    const [showEncounter, setShowEncounter] = React.useState(false);
    // 【结局系统】已解锁结局(用于多周目真结局判定) + 周目数 + 当前触发的结局
    const [endingsUnlocked, setEndingsUnlocked] = React.useState(initialData.endingsUnlocked || []);
    const [cycleCount, setCycleCount] = React.useState(initialData.cycleCount || 0);
    const [triggeredEnding, setTriggeredEnding] = React.useState(null);
    // 【成就 + 结局图鉴】独立成就(跨周目累积) + 图鉴界面的 Tab / 正在回看的结局
    const [achievementsUnlocked, setAchievementsUnlocked] = React.useState(initialData.achievementsUnlocked || []);
    const [galleryTab, setGalleryTab] = React.useState("endings");   // "endings" | "achievements"
    const [galleryReading, setGalleryReading] = React.useState(null); // 正在回看正文的已解锁结局对象
    const [encounterFan, setEncounterFan] = React.useState(null);
    // 【偶遇】每天每位男主仅有一次机会：记录 { [day]: [fanId,...] }
    const [encounterUsed, setEncounterUsed] = React.useState(initialData.encounterUsed || {});
    const isEncounterUsed = (fanId) => (encounterUsed[day] || []).includes(fanId);
    // 【光夜变奏】当前世界线 → <html data-world>，驱动全局换肤；离开游戏时复位为主世界
    React.useEffect(() => {
        document.documentElement.setAttribute('data-world', currentWorld);
        return () => { document.documentElement.setAttribute('data-world', 'main'); };
    }, [currentWorld]);
    const [worldState, setWorldState] = React.useState([]);
    const [loading, setLoading] = React.useState(false);
    const [forumLoading, setForumLoading] = React.useState(false); // 论坛/帖子详情独立加载态，不影响主线
    const [dynamicLoading, setDynamicLoading] = React.useState(false); // 舆论涟漪加载状态
    const [streamingStory, setStreamingStory] = React.useState("");
    const [error, setError] = React.useState(null);
    const [customMode, setCustomMode] = React.useState(false);
    const [customText, setCustomText] = React.useState("");

    // ⭐ 主线剧情生成时，自动把视线焦点拉回新剧情开头（不用玩家自己往上划）
    const storyTopRef = React.useRef(null);
    React.useEffect(() => {
        if (activeTab !== "story") return;
        // 用 rAF 等 DOM 渲染完再滚：开始生成(loading)与新剧情落定(currentStory变化)时都回正到剧情顶部
        requestAnimationFrame(() => storyTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }, [currentStory, loading, activeTab]);

    // ⭐ KakaoTalk 私聊：新消息到达 / 刚打开私聊时，自动把最新一条滚到可见处
    React.useEffect(() => {
        if (activeModal === "kakao_dm" && showPrivateChat) {
            requestAnimationFrame(() => kakaoEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
        }
    }, [dmHistories, showPrivateChat, activeModal]);
    
    // 社交平台数据缓存
    const [socialCache, setSocialCache] = React.useState({});
    const [forumContext, setForumContext] = React.useState({ posts: [], activePlatform: "pann", selectedPost: null, postTab: "hot" });
    const [businessComments, setBusinessComments] = React.useState(null);
    
    // Tab 状态
    const [weverseTab, setWeverseTab] = React.useState("recommend");
    const [youtubeTab, setYoutubeTab] = React.useState("videos");
    const [cpostTab, setCpostTab] = React.useState("weibo");
    const [jiefuTab, setJiefuTab] = React.useState("jiefu");
    const [shopTab, setShopTab] = React.useState("shop"); // 商城内：商品 / 送礼

    // 【社交引擎】各平台 feed（持久化）+ 发帖器/评论区/加载态
    const SOCIAL_MODALS = ["youtube", "instagram", "twitter", "tiktok", "cpost", "threads", "jiefu", "weverse"];
    const [socialFeeds, setSocialFeeds] = React.useState(initialData.socialFeeds || {});
    const [socialLoadingKey, setSocialLoadingKey] = React.useState(null);
    const [postComposer, setPostComposer] = React.useState(null);   // { platformKey }
    const [commentSheet, setCommentSheet] = React.useState(null);   // { feedKey, postId }
    const [commentLoading, setCommentLoading] = React.useState(false);
    const [tiktokAlt, setTiktokAlt] = React.useState(initialData.tiktokAlt || false);        // TikTok 小号开关
    // 【小号管理】可在 Twitter/TikTok/微博/ins 四个软件中自主选择是否注册小号
    const [altAccounts, setAltAccounts] = React.useState(initialData.altAccounts || { twitter: false, tiktok: false, weibo: false, instagram: false });
    const [snsInput, setSnsInput] = React.useState("");             // 小号发文输入
    const [liveMessages, setLiveMessages] = React.useState([]);     // 直播弹幕
    const [liveActive, setLiveActive] = React.useState(false);      // 直播进行中
    const [toastMsg, setToastMsg] = React.useState("");             // 手机操作就地反馈（不推主线）
    const [dailySummary, setDailySummary] = React.useState(null);   // 【每日总结】一天结束时生成的当天总结卡

    // 当前 activeModal 对应的 feed key（cpost/jiefu 含子tab）
    const feedKeyFor = (modal) => {
        if (modal === "cpost") {
            if (cpostTab === "jiefu") return `jiefu:jiefu`;
            if (cpostTab === "jiefubing") return `jiefu:jiefubing`;
            return `cpost:${cpostTab}`;
        }
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
                riskLevel: currentRisk, antiCount, fandomHeat,
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
            gameContext: { popularity: attrs.人气值, antiCount, fandomHeat, artistName: char?.artistName, nickname: char?.nickname, unlockedFans: unlocked.map(id => FANS.find(f => f.id === id)?.name) }
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

    // 【吃醋度公式】不随其他数值加减，而是由好感度(hearts)与信任度(trust)实时推导：
    //   好感<90：吃醋度 = 50 + (100-信任)×0.8  （信任越高越冷静，越低越失控）
    //   好感≥90：吃醋度恒定 20（无条件包容）
    const computeJealousy = (affectionHearts, trust) => {
        if (affectionHearts >= 90) return 20;
        return Math.round(Math.min(130, Math.max(0, 50 + (100 - (trust || 0)) * 0.8)));
    };
    // 当好感/信任变化时，把每位大粉的吃醋度重算（只在检测到有暧昧他人时才生效——这里始终重算，保持一致）
    React.useEffect(() => {
        setFanEmotions(prev => {
            const next = { ...prev };
            FANS.forEach(fan => {
                if (next[fan.id]) {
                    next[fan.id] = { ...next[fan.id], jealousy: computeJealousy(hearts[fan.id] ?? 0, next[fan.id].trust ?? 40) };
                }
            });
            return next;
        });
    }, [hearts]);

    // 好感度≥90 特殊剧情提示
    const [highHeartEvent, setHighHeartEvent] = React.useState(null);
    React.useEffect(() => {
        const highHeartFans = Object.entries(hearts).filter(([id, val]) => val >= 90);
        if (highHeartFans.length > 0 && !highHeartEvent) {
            const fan = FANS.find(f => f.id === highHeartFans[0][0]);
            setHighHeartEvent({
                fan: fan,
                message: `💗 ${fan.name} 对你的好感度已达90！他似乎愿意为你做任何事，甚至...`
            });
            setTimeout(() => setHighHeartEvent(null), 8000);
        }
    }, [hearts]);
    
    // 自动保存（用 ref 避免重复 alert）
    const saveFailedRef = React.useRef(false);
    React.useEffect(() => {
        const saveData = {
            char, day, hearts, unlocked, currentStory, currentChoices, currentRisk, suspicion,
            history, storySummary, schedules, attrs, money, teammates, fandomHeat, antiCount, fanEmotions,
            activeEvents, currentSchedule, dmReadStatus, dmHistories, coupleExposure, paidDmDaily,
            companyFavor, socialFeeds, socialDynamics, tiktokAlt, scheduleMap, companyContract, dailyPlan,
            currentWorld, altAccounts, encounterUsed, endingsUnlocked, cycleCount,
            // V20 熟练度/私联
            proficiency, lastTrainDay, lastUnlockDay, interactionCount,
            // V21 主线节拍器
            mainlineIdle,
            // V22 心力 / 每日行动数（取代 slotsDone）
            mentalEnergy, todayActions,
            // DM 聊天记忆
            dmMemory,
            // 成就（跨周目累积）
            achievementsUnlocked,
            schemaV19: true, schemaV20: true, schemaV21: true, schemaV22: true
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
    }, [day, hearts, currentStory, currentChoices, currentRisk, suspicion, history, storySummary, schedules,
        attrs, money, teammates, fandomHeat, antiCount, fanEmotions, activeEvents, currentSchedule, dmReadStatus, dmHistories,
        coupleExposure, paidDmDaily, companyFavor, socialFeeds, socialDynamics, tiktokAlt, scheduleMap, companyContract, dailyPlan,
        currentWorld, altAccounts, encounterUsed, endingsUnlocked, cycleCount,
        proficiency, lastTrainDay, lastUnlockDay, interactionCount, mainlineIdle, mentalEnergy, todayActions, dmMemory, achievementsUnlocked]);
    
    // 每日推进
    React.useEffect(() => {
        setCurrentSchedule(generateRandomSchedule(day));
        // ⭐ 新的一天，清空待确认的早/中/晚行程，让玩家重新安排
        setDailyPlan({ morning: null, noon: null, evening: null });
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
    // 【好感度】现实约束：单次加减平常≤5，特殊事件≤10（尤其男主好感度不可大幅跳变）
    const updateHearts = (changes, special = false) => {
        if (!changes) return;
        // 【主线节拍器 · V21】任何来源的好感变化（剧情结算、私聊、送礼、视频通话、直播、DM…）
        // 都在这里汇成一个漏斗 → 统一算作「主线动了一拍」，怠速清零。
        // 玩家主动经营大粉关系，本身就是在推主线，不需要系统再追着强推。
        const moved = Object.entries(changes).some(([id, d]) => {
            const v = Number(d);
            return Number.isFinite(v) && v !== 0 && FANS.some(f => f.id === id);
        });
        if (moved) setMainlineIdle(0);
        const cap = special ? 10 : 5;
        setHearts(prev => {
            const next = { ...prev };
            Object.entries(changes).forEach(([id, delta]) => {
                let value = Number(delta);
                if (next[id] !== undefined && Number.isFinite(value)) {
                    value = Math.max(-cap, Math.min(cap, value));
                    next[id] = Math.min(100, Math.max(0, next[id] + value));
                }
            });
            return next;
        });
    };
    // 暴露风险（百分制 0-100）。危机阈值：>60 随时触发公司警觉；>80 随时可能触发脱粉回踩。
    // 单回合累积上限 RISK_TURN_CAP(=15)，疑虑≥50 才把积累引爆为真实风险。
    const updateRisk = (delta) => {
        if (delta <= 0) {
            setCurrentRisk(prev => Math.min(100, Math.max(0, prev + delta)));
            return;
        }
        if (riskTurnAccumRef.current >= RISK_TURN_CAP) return;
        const allowed = Math.min(delta, RISK_TURN_CAP - riskTurnAccumRef.current);
        delta = allowed;
        riskTurnAccumRef.current += allowed;
        setCurrentRisk(prevRisk => {
            // 风险已 >= 60（危机区）：直接累加，不再走疑虑缓冲
            if (prevRisk >= 60) {
                const newRisk = Math.min(100, prevRisk + delta);
                if (newRisk >= 80 && prevRisk < 80) { vibrate(VIBE.crisis); playSFX('crisis'); }
                else if (newRisk > prevRisk) { vibrate(VIBE.riskUp); playSFX('risk'); }
                return newRisk;
            }
            return prevRisk;
        });
        setSuspicion(prev => {
            const newSusp = Math.min(100, prev + delta);
            if (newSusp >= 50) {
                setCurrentRisk(r => {
                    const newRisk = Math.min(100, r + delta);
                    if (newRisk >= 80 && r < 80) { vibrate(VIBE.crisis); playSFX('crisis'); }
                    else if (newRisk > r) { vibrate(VIBE.riskUp); playSFX('risk'); }
                    return newRisk;
                });
                return Math.max(0, newSusp - 50);
            }
            return newSusp;
        });
    };
    const updateSuspicion = (delta) => setSuspicion(prev => Math.min(100, Math.max(0, prev + delta)));
    const updateMoney = (delta) => setMoney(prev => Math.max(0, prev + delta));
    // 【数值现实约束】颜值除整容外不可提升（美容仅+1~2）；智商/情商固定；vocal/dance/rap 可增减；
    // 其余数值加减一律 clamp（平常≤5，特殊事件≤10）
    const LOCKED_ATTRS = ["颜值", "iq", "eq"];
    const clampAttrDelta = (key, delta, special = false) => {
        if (LOCKED_ATTRS.includes(key)) return 0;              // 颜值/智商/情商锁定
        const cap = special ? 10 : 5;
        return Math.max(-cap, Math.min(cap, Number(delta) || 0));
    };
    const updateAttrs = (changes, special = false) => setAttrs(prev => {
        const next = { ...prev };
        Object.entries(changes || {}).forEach(([k, v]) => {
            const d = clampAttrDelta(k, v, special);
            if (d !== 0) next[k] = Math.max(0, Math.min(100, (prev[k] || 0) + d));
        });
        return next;
    });
    // 长期坚持美容：颜值可提升 1~2 点（唯一非整容的提升途径），单独通道绕过 LOCKED
    const beautifyFace = (pts = 1) => setAttrs(prev => ({ ...prev, 颜值: Math.min(100, prev.颜值 + Math.max(1, Math.min(2, pts))) }));
    // 【大粉情感】删去心动值(affection 独立槽)与痴迷度(obsession)：好感度统一用 hearts，
    // 这里只维护 trust；吃醋度(jealousy)由 computeJealousy 依据好感/信任实时推导，不接受直接加减。
    const updateFanEmotion = (fanId, changes) => {
        if (!changes) return;
        setFanEmotions(prev => {
            const base = prev[fanId] || { trust: 40, jealousy: 25, recentInteractions: [] };
            // 信任度也遵循现实约束：平常≤5，特殊≤10
            const trustDelta = Math.max(-5, Math.min(5, Number(changes.trust) || 0));
            const newTrust = Math.min(100, Math.max(0, (base.trust ?? 40) + trustDelta));
            return {
                ...prev,
                [fanId]: {
                    ...base,
                    trust: newTrust,
                    jealousy: computeJealousy(hearts[fanId] ?? 0, newTrust),
                    relationshipStatus: changes.relationshipStatus ?? base.relationshipStatus
                }
            };
        });
    };

    // 【实质交集名单 · V21】contactFans = 已私联 ∪ 有过实质互动（interactionCount > 0）的大粉。
    // 随每次剧情请求发给后端，两个用途：
    //   ① 主线强推时，优先安排这些「已经和玩家有交集」的大粉登场，剧情才接得上；
    //   ② 后端数值裁剪时据此校验好感变化对象 —— 名单外的大粉不该突然大幅动心
    //     （前端在结算处同样限 ±1 做安全网，见 continueStory）。
    const getContactFans = () => {
        const set = new Set(unlocked);
        Object.entries(interactionCount || {}).forEach(([id, n]) => { if ((Number(n) || 0) > 0) set.add(id); });
        return FANS.filter(f => set.has(f.id)).map(f => f.id);
    };

    // ⭐【日程系统 · V20/V21】锁定当天日程的公共通道 —— confirmDailyPlan（手动确认）与
    // reuseLastPlan（一键沿用）共用。日程锁定后：① 只即时结算资金收入；
    // ② 剧情将围绕这份日程逐时段展开；③ 技能训练只累积熟练度（后端算），连续做够 6 次才兑换 +1 属性。
    const lockPlanForToday = (plan, { reused = false } = {}) => {
        const cleanPlan = { morning: plan?.morning || null, noon: plan?.noon || null, evening: plan?.evening || null };
        const picks = SCHEDULE_SLOTS.map(s => findScheduleActivity(cleanPlan[s.key])).filter(Boolean);
        if (picks.length === 0) return null;
        // 【V22 日程直接结算】日程与主线彻底分离：不再"锁定后靠剧情逐段演出来"，
        //   而是当场把每个活动的效果算掉，不调 AI、不耗心力。沿用既有平衡：
        //   技能→熟练度（练满 6 次 +1 同名属性）｜资金活动→现金｜休息→心力｜营业→人气。
        let moneyDelta = 0, mentalDelta = 0, popDelta = 0;
        const attrInc = {};                          // vocal/dance/rap/时尚度 +1
        const profNext = { ...(proficiency || {}) };
        const trainDayNext = { ...(lastTrainDay || {}) };
        const notes = [];
        picks.forEach(a => {
            if (a.track) {
                const cur = (profNext[a.track] ?? 0) + 1;
                if (cur >= PROF_PER_LEVEL) { profNext[a.track] = 0; attrInc[a.track] = (attrInc[a.track] || 0) + 1; notes.push(`${PROF_TRACK_CN[a.track]}+1`); }
                else { profNext[a.track] = cur; notes.push(`${PROF_TRACK_CN[a.track]}熟练${cur}/${PROF_PER_LEVEL}`); }
                trainDayNext[a.track] = day;
            } else if (a.money) { moneyDelta += a.money; notes.push(`资金+${a.money}万`); }
            else if (a.id === "m_sleep" || a.id === "e_rest") { mentalDelta += 10; notes.push("心力+10"); }
            else if (a.id === "e_live" || a.id === "e_sns") { popDelta += 2; notes.push("人气+2"); }
        });
        if (moneyDelta) updateMoney(moneyDelta);
        if (mentalDelta) setMentalEnergy(prev => Math.min(MENTAL_MAX, prev + mentalDelta));
        setProficiency(profNext);
        setLastTrainDay(trainDayNext);
        if (Object.keys(attrInc).length || popDelta) {
            setAttrs(prev => {
                const next = { ...prev };
                Object.entries(attrInc).forEach(([k, v]) => { next[k] = Math.min(100, (next[k] ?? 0) + v); });
                if (popDelta) next.人气值 = Math.min(100, (next.人气值 ?? 0) + popDelta);
                return next;
            });
        }
        setDailyPlan(cleanPlan);
        setScheduleMap(prev => ({ ...prev, [day]: { ...cleanPlan, confirmed: true, settled: true, ...(reused ? { reused: true } : {}) } }));
        // 每个日程活动算「一件事」
        setTodayActions(n => (n | 0) + picks.length);
        addWorldState(`${reused ? "沿用上次安排，" : ""}处理了今天的日程：${picks.map(a => a.name).join("、")}`);
        vibrate(VIBE.unlock); playSFX('unlock');
        return { picks, moneyDelta, notes };
    };

    const confirmDailyPlan = () => {
        if (scheduleMap[day]) {  // 今天已锁定 → 不重复
            setToastMsg("📋 今日日程已经锁定啦~");
            setTimeout(() => setToastMsg(""), 2500);
            return;
        }
        const locked = lockPlanForToday(dailyPlan);
        if (!locked) {
            setToastMsg("先安排至少一个时段再锁定~");
            setTimeout(() => setToastMsg(""), 2500);
            return;
        }
        setToastMsg(`✅ 今日日程已结算：${locked.picks.map(a => a.emoji + a.name).join(" · ")}${locked.notes?.length ? `（${locked.notes.join("、")}）` : ""}`);
        setTimeout(() => setToastMsg(""), 3800);
        setActiveModal(null); // 关掉日历
    };

    // 【一键沿用 · V21】把最近一次锁定过的日程原样抄给今天并立即锁定。
    // 「每天必须手排日程」是主线体感停滞的帮凶之一 —— 想直接看剧情的玩家，一键就能开演。
    const findReusablePlan = () => {
        for (let d = day - 1; d >= 1; d--) {
            const rec = scheduleMap[d];
            if (rec && (rec.morning || rec.noon || rec.evening)) return rec;
        }
        return null;
    };
    const reuseLastPlan = () => {
        if (scheduleMap[day]) {
            setToastMsg("📋 今日日程已经锁定啦~");
            setTimeout(() => setToastMsg(""), 2500);
            return false;
        }
        const src = findReusablePlan();
        if (!src) {
            setToastMsg("还没有可沿用的历史日程，先手动安排一次吧~");
            setTimeout(() => setToastMsg(""), 2500);
            return false;
        }
        const locked = lockPlanForToday(src, { reused: true });
        if (!locked) {
            setToastMsg("上次的日程记录不完整，先手动安排一次吧~");
            setTimeout(() => setToastMsg(""), 2500);
            return false;
        }
        setToastMsg(`⚡ 已沿用并结算上次日程：${locked.picks.map(a => a.emoji + a.name).join(" · ")}${locked.notes?.length ? `（${locked.notes.join("、")}）` : ""}`);
        setTimeout(() => setToastMsg(""), 3200);
        return true;
    };
    
    // 社交平台内容刷新
    const refreshSocialContent = async (platform, type) => {
        const unlockedNames = unlocked.map(id => FANS.find(f => f.id === id)?.name).filter(Boolean);
        const gameContext = {
            day, riskLevel: currentRisk, popularity: attrs.人气值,
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
    // 主线剧情推进。偶遇（心动邂逅）不走这里——它是完全独立的彩蛋分支，见 startEncounter。
    const continueStory = async (playerAction) => {
        // 重入保护：useRef 在同一次事件循环中立即生效，比 loading state 更可靠
        if (continueStoryLockRef.current) {
            console.warn('[continueStory] 重入被拦截：上一个剧情请求还在进行');
            return;
        }
        // 【心力闸门 · V22】主线已与日程解耦：主线不再需要先排日程，但受"心力"约束。
        // 心力见底 → 今天不能再推主线，只能休息/日程/刷手机，逼出"一天推几步"的节奏。
        if (mentalEnergy < MENTAL_MIN_TO_ACT) {
            continueStoryLockRef.current = false;
            setToastMsg("😴 你今天太累了，先休息吧。明天心力会恢复。");
            setTimeout(() => setToastMsg(""), 3000);
            return;
        }
        continueStoryLockRef.current = true;
        setLoading(true);
        setError(null);
        setStreamingStory("");
        // 【主线节拍器 · V21】怠速达到阈值 → 本拍强制推主线；差一拍时先埋伏笔做铺垫。
        // 指令同时走两条路：① context 里的结构化字段（mainlineIdle/mainlinePush/contactFans），
        // 供后端在 system prompt 层面正式处理；② 直接拼进 worldStateSummary —— 后端会把它
        // 原样喂给模型，所以即使后端还没更新，这条指令也立即生效（前端兜底）。
        const mainlinePush = mainlineIdle >= MAINLINE_PUSH_AFTER;
        const contactFans = getContactFans();
        const contactNames = contactFans.map(id => FANS.find(f => f.id === id)?.name).filter(Boolean).join("、");
        const pacingDirective = mainlinePush
            ? `【叙事指令·必须遵守】主线已经连续 ${mainlineIdle} 段剧情停滞在日常里。本段必须推进主线：让神秘联系人 / 大粉（优先：${contactNames || "任一大粉"}）/ 进行中的事件登场，并发生实质进展（新消息、新变故、关系升温或危机发酵）。今日日程只能作为场景背景，禁止写成纯训练、营业流水账。`
            : (mainlineIdle === MAINLINE_PUSH_AFTER - 1
                ? "【叙事提示】主线已略有停滞：请在本段日程场景中穿插至少一条主线伏笔（大粉动向 / 神秘消息 / 舆论暗涌）。"
                : "");
        const worldActionsSummary = worldState.length ? `玩家在做决定前还做了：${worldState.join("；")}` : "";
        const worldStateSummary = [worldActionsSummary, pacingDirective].filter(Boolean).join(" ");
        clearWorldState();
        
        // 各大粉情感（好感=hearts，信任=trust，吃醋=jealousy 派生）打包给后端做叙事/吃醋判定
        const fanRelations = {};
        FANS.forEach(f => {
            fanRelations[f.id] = {
                name: f.name,
                好感度: hearts[f.id] ?? 0,
                信任度: fanEmotions[f.id]?.trust ?? 40,
                吃醋度: fanEmotions[f.id]?.jealousy ?? computeJealousy(hearts[f.id] ?? 0, fanEmotions[f.id]?.trust ?? 40),
                已私联: unlocked.includes(f.id)
            };
        });
        // 【主线解耦 · V22】主线不再挂靠"上午/下午/晚上"日程时段：
        //   · slot 只给后端一个中性值（保持签名兼容），不再代表某个日程时段；
        //   · todaySchedule 传空 → 主线剧情不归类任何熟练度赛道（训练只从"点日程"结算，不从主线来）；
        //   · decoupled:true → 后端跳过"必须先排日程"闸门，并改用纯主线叙事框架。
        const slot = neutralSlotFromActions(todayActions);
        const storyData = {
            context: {
                character: char,
                day, heartLevels: hearts, unlockedFans: unlocked, attrs,
                fanRelations,
                playerPersonality: char?.hiddenTrait,        // 严格遵守玩家开局选择的性格
                teammates: teammates?.map(t => t.name) || [],
                previousStory: currentStory,
                storySummary,
                // ── V22 主线解耦：中性时段 + 空日程（主线不产生训练熟练度）──
                slot,
                todaySchedule: {},                           // 主线不带日程 → 后端不归类熟练度
                decoupled: true,                             // 主线与日程分离标记
                proficiency, lastTrainDay,                   // 熟练度进度 + 最后训练日（停练衰减用）
                // ⚠️ 从未私联时不要传 lastUnlockDay（传 0 会被后端当成「第0天私联过」，误触发 7 天冷却）
                lastUnlockDay: lastUnlockDay > 0 ? lastUnlockDay : undefined,
                interactionCount,                            // 与各大粉实质交集次数（私联门槛之一）
                worldStateSummary, coupleExposure,
                // ── V21 主线节拍器：怠速拍数 / 本拍是否强制推主线 / 实质交集名单 ──
                // 后端用途：mainlinePush=true 时在 system prompt 追加主线推进指令；
                // 数值裁剪函数用 contactFans 校验 heartChanges 的对象（名单外 clamp 到 ±1）。
                mainlineIdle, mainlinePush, contactFans
            },
            slot,                                            // 顶层也带一份，非流式路径直接可读
            decoupled: true,                                 // 顶层也带一份（后端两处都读）
            attended: true,
            playerAction,
            // 海后值已删除；风险/黑粉/粉圈热度均为百分制
            worldState: { currentRisk, suspicion, popularity: attrs.人气值, fandomHeat, antiCount, companyFavor },
            stream: true  // 请求流式输出
        };

        let result = null;
        // 服务端算好的、与模型无关的元信息（时段/日结/熟练度/私联资格）——流式时通过响应头带回
        let headerMeta = null;

        // ── 尝试流式读取 ──
        try {
            const res = await fetch(FUNCTION_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
                // ⭐ 注入 userId：流式分支之前没带，后端 rate limiter 只能退回 IP 识别（同一出口IP的多人会互相挤限额）
                body: JSON.stringify({ action: 'story', data: { ...storyData, userId: window._ehpUserId || 'guest' } })
            });

            // 读取服务端元信息头（时段/是否一天结束/熟练度进度/私联资格）
            try {
                const h = res.headers.get('X-EHP-Meta');
                if (h) headerMeta = JSON.parse(decodeURIComponent(h));
            } catch { /* 头缺失或损坏，后面用 commit_story 兜底 */ }

            // 后端返回 needSchedule（今天没排日程）→ 跳日程界面，不当剧情处理
            if (res.headers.get('content-type')?.includes('application/json')) {
                const maybe = await res.clone().json().catch(() => null);
                if (maybe?.needSchedule) {
                    setLoading(false);
                    continueStoryLockRef.current = false;
                    setActiveModal("calendar");
                    setToastMsg(maybe.message || "📅 先安排今天的日程~");
                    setTimeout(() => setToastMsg(""), 3000);
                    return;
                }
            }

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
                // 流读完，解析完整 JSON（这是模型原始输出，数值还没裁剪）
                setStreamingStory('');
                let raw = null;
                const jsonMatch = fullText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try { raw = JSON.parse(jsonMatch[0]); } catch {
                        raw = { story: lastStoryText, choices: ['继续', '等待', '观察'], newUnlockedFan: null };
                    }
                } else {
                    raw = { story: lastStoryText, choices: ['继续', '等待', '观察'], newUnlockedFan: null };
                }
                // 【二次裁剪】流式下服务端拿不到完整 JSON，必须再调 commit_story：
                // 用同样的 context/slot 算出权威的、可入档的数值（好感±3/±5、熟练度突破、私联资格…）。
                const committed = await callEdgeFunction('commit_story', {
                    context: storyData.context, slot, attended: true, payload: raw
                });
                if (committed && !committed.error) {
                    // 权威数值 + 服务端元信息；正文用流式已展示的 raw.story，选项优先用裁剪后的
                    result = {
                        ...committed,
                        story: raw.story || committed.story || lastStoryText,
                        choices: (committed.choices?.length ? committed.choices : raw.choices) || ['继续', '等待', '观察']
                    };
                } else {
                    // commit 失败：退回用 raw 的数值（前端 updateHearts/updateAttrs 自带上限做安全网）+ 响应头元信息
                    result = { ...raw, ...(headerMeta || {}) };
                }
            } else {
                // 后端没返回 SSE（可能是错误响应或 needSchedule），回退到 JSON（已含裁剪数值+元信息）
                result = await res.json().catch(() => ({}));
            }
        } catch (streamErr) {
            console.warn('streaming failed, falling back:', streamErr);
            // 非流式兜底：显式关掉 stream，让后端一次性返回裁剪后的数值 + 元信息（可被 JSON 解析）
            result = await callEdgeFunction('story', { ...storyData, stream: false });
            if (result?.needSchedule) {
                setLoading(false); continueStoryLockRef.current = false;
                setActiveModal("calendar");
                setToastMsg(result.message || "📅 先安排今天的日程~");
                setTimeout(() => setToastMsg(""), 3000);
                return;
            }
        }
        
        if (result?.error) {
            setError(result.error);
        } else if (result?.needSchedule) {
            // 今天没排日程（非流式路径兜底）→ 跳日程界面
            setActiveModal("calendar");
            setToastMsg(result.message || "📅 先安排今天的日程~");
            setTimeout(() => setToastMsg(""), 3000);
        } else if (result?.story) {
            setCurrentStory(result.story);
            setCurrentChoices(result.choices || ["继续", "等待", "观察"]);
            const isSpecial = !!result.specialEvent; // 后端可标记"特殊事件"，允许数值幅度到 10（否则≤5）
            // 【contactFans 校验 · V21 前端安全网】没实质交集的大粉不该突然大幅动心：
            // 名单外的好感变化单拍最多 ±1（初识≠动心）；名单内正常走 updateHearts 的 ±5/±10 上限。
            // 与后端数值裁剪函数里的 contactFans 校验保持同一口径，后端未更新时前端兜底。
            const gatedHearts = {};
            Object.entries(result.heartChanges || {}).forEach(([id, d]) => {
                const v = Number(d) || 0;
                if (v === 0 || !FANS.some(f => f.id === id)) return;
                gatedHearts[id] = contactFans.includes(id) ? v : Math.max(-1, Math.min(1, v));
            });
            if (Object.keys(gatedHearts).length) updateHearts(gatedHearts, isSpecial);
            if (result.emotionChanges) Object.entries(result.emotionChanges).forEach(([fanId, changes]) => updateFanEmotion(fanId, changes));
            // 【属性只从熟练度来】result.attrChanges 现在是后端熟练度「突破」兑换的 +1（不是模型自由加的）
            if (result.attrChanges && Object.keys(result.attrChanges).length) updateAttrs(result.attrChanges, true);
            if (result.beautify) beautifyFace(result.beautify); // 长期美容：颜值+1~2（唯一非整容通道）
            if (result.riskChange) updateRisk(result.riskChange);
            if (result.suspicionChange) updateSuspicion(result.suspicionChange); // 疑虑期：小失误转疑虑，不直接爆发
            if (typeof result.fandomChange === "number" && result.fandomChange) setFandomHeat(prev => Math.max(0, Math.min(100, prev + Math.max(-10, Math.min(10, result.fandomChange)))));
            if (typeof result.antiChange === "number" && result.antiChange) setAntiCount(prev => Math.max(0, Math.min(100, prev + Math.max(-10, Math.min(10, result.antiChange)))));
            if (typeof result.companyChange === "number" && result.companyChange) setCompanyFavor(prev => Math.max(0, Math.min(100, prev + Math.max(-10, Math.min(10, result.companyChange)))));
            if (result.popularityChange) setAttrs(prev => ({ ...prev, 人气值: Math.max(0, Math.min(100, prev.人气值 + Math.max(-10, Math.min(10, result.popularityChange)))) }));
            if (result.coupleExposure) setCoupleExposure(result.coupleExposure);
            // 【剧情深度融合】后端可返回 triggerPhone，让剧情"主动弹出"手机界面（Kakao/DM/论坛/Weverse…）
            if (result.triggerPhone) handleStoryTrigger(result.triggerPhone);

            // ── 熟练度：直接采用后端算好的进度（前端不自己累加，避免与后端双算）──
            if (result.proficiency && typeof result.proficiency === "object") setProficiency(prev => ({ ...prev, ...result.proficiency }));
            if (result.lastTrainDay && typeof result.lastTrainDay === "object") setLastTrainDay(prev => ({ ...prev, ...result.lastTrainDay }));
            if (result.breakthrough?.trackCn) {
                setToastMsg(`🌱 「${result.breakthrough.trackCn}」练成了，属性 +1！`);
                setTimeout(() => setToastMsg(""), 3500);
                vibrate(VIBE.unlock); playSFX('unlock');
            }

            // ── 交集次数：本回合真正和你有互动（好感/信任变化）的大粉 +1（私联硬门槛之一）──
            {
                const touched = new Set([
                    ...Object.keys(gatedHearts),   // 用校验后的名单：名单外的初识 +1 也计一次交集，下拍即入 contactFans
                    ...Object.keys(result.emotionChanges || {}).filter(id => FANS.some(f => f.id === id))
                ]);
                if (touched.size) {
                    setInteractionCount(prev => {
                        const next = { ...prev };
                        touched.forEach(id => { next[id] = (next[id] || 0) + 1; });
                        return next;
                    });
                }
            }

            // ── 私联解锁：必须命中后端算出的资格名单（服务端说了算，前端再校验一次）──
            const eligibleNow = Array.isArray(result.eligibleUnlocks) ? result.eligibleUnlocks : null;
            if (result.newUnlockedFan && !unlocked.includes(result.newUnlockedFan)
                && (!eligibleNow || eligibleNow.includes(result.newUnlockedFan))) {
                const newFan = FANS.find(f => f.id === result.newUnlockedFan);
                if (newFan) {
                    setUnlocked(prev => prev.includes(newFan.id) ? prev : [...prev, newFan.id]);
                    setLastUnlockDay(day); // 记录，后端据此算 7 天私联冷却
                    addWorldState(`成功私联了${newFan.name}`);
                    vibrate(VIBE.unlock); playSFX('unlock');
                    setTimeout(() => alert(`💌 你成功私联了新大粉：${newFan.emoji} ${newFan.name}！现在可以在手机里主动私聊、找他要钱了。`), 300);
                }
            }

            // ── 【主线节拍器 · V21】判定本拍是否推进了主线 ──
            // 好感/信任变化、私联解锁、危机实质发酵（|risk|≥3）、特殊事件、情侣物暴露、
            // 剧情主动弹手机、后端显式标记 mainlineBeat，任一命中都算「动了」→ 怠速清零；
            // 一个都没有 → 这是一拍纯日常流水账，怠速 +1（updateHearts 处的清零与此口径一致）。
            const beatMoved =
                Object.keys(gatedHearts).length > 0 ||
                Object.keys(result.emotionChanges || {}).length > 0 ||
                !!result.newUnlockedFan || !!result.specialEvent || !!result.coupleExposure ||
                !!result.triggerPhone || result.mainlineBeat === true ||
                Math.abs(Number(result.riskChange) || 0) >= 3;
            setMainlineIdle(n => beatMoved ? 0 : Math.min(MAINLINE_IDLE_CAP, n + 1));

            // history 截断到最近 25 条，避免无限增长撑爆 localStorage（5MB 配额）
            const HISTORY_MAX = 25;
            const merged = [...history, result.story];
            const newHistory = merged.length > HISTORY_MAX ? merged.slice(-HISTORY_MAX) : merged;
            setHistory(newHistory);

            // 【结局判定】每个时段都判一次（好感/私联里程碑可能在白天就达成），延后一拍等 state 落定
            setTimeout(() => checkEndings(), 400);
            // 重置同回合 risk 累积计数
            riskTurnAccumRef.current = 0;

            // ══════════════════════════════════════════════════════════════
            // 【主线一拍完成 · V22】主线已与"日程/时段"解耦，不再自动结束一天。
            //   这里只做三件事：① 扣心力（每个主线选项 -15）；② 今日行动数 +1；
            //   ③ 到软上限时提醒可以休息。天数推进交给玩家点【结束今天】(endDay)。
            //   后端仍会返回 dayEnded/slot，但解耦模式下前端不再据此自动翻天。
            // ══════════════════════════════════════════════════════════════
            setMentalEnergy(prev => Math.max(0, prev - MENTAL_COST_MAINLINE));
            const actedCountML = (todayActions | 0) + 1;
            setTodayActions(actedCountML);
            if (actedCountML === MAX_ACTIONS_PER_DAY) {
                setToastMsg(`今天做了不少事（${actedCountML} 件），要休息吗？可点下方「结束今天」。`);
                setTimeout(() => setToastMsg(""), 4000);
            }
            // 【舆论涟漪】高风险或每 3 拍随机，让粉圈对刚发生的事有反应（延迟触发不阻塞主流程）
            {
                const eventSummary = (worldActionsSummary || playerAction || "").slice(0, 80);
                if (currentRisk >= 60 || (newHistory.length % 3 === 0 && Math.random() < 0.35)) {
                    setTimeout(() => triggerSocialDynamic(eventSummary), 1500);
                }
            }
        } else {
            // 流式 + fallback 都失败、或后端没返回 story 字段
            setError("剧情生成失败，请重试。若反复失败，请稍后再来或检查网络。");
        }
        setLoading(false);
        continueStoryLockRef.current = false;
    };
    
    // ══════════════════════════════════════════════════════════════
    // 【结束今天 · V22】玩家主动结束一天（取代"日程走完自动翻天"）。
    //   做的正是旧 dayEnded 分支的日结工作 + 心力恢复 + 行动数清零。
    // ══════════════════════════════════════════════════════════════
    const endDayLockRef = React.useRef(false);
    const endDay = () => {
        if (loading) { setToastMsg("剧情还在生成，稍等一下再结束今天~"); setTimeout(() => setToastMsg(""), 2500); return; }
        if (endDayLockRef.current) return;
        endDayLockRef.current = true;
        setTimeout(() => { endDayLockRef.current = false; }, 800);
        const endedDay = day;
        // 长期摘要压缩（每 5 天）
        if ((endedDay + 1) % 5 === 0) {
            callEdgeFunction('summarize_story', { history: history.slice(-5) }).then(res => {
                if (res.summary) setStorySummary(res.summary);
            });
        }
        // 【每日总结】有今日日程就把它列进去，没有就写"今天以主线为主"
        {
            const sched = scheduleMap[endedDay];
            const schedText = sched
                ? SCHEDULE_SLOTS.map(s => {
                    const a = findScheduleActivity(sched?.[s.key]);
                    return a ? `${s.label}·${a.name}` : null;
                }).filter(Boolean).join("  ")
                : "";
            setDailySummary({
                day: endedDay,
                text: schedText
                    ? `第 ${endedDay} 天结束。今日安排：${schedText}。`
                    : `第 ${endedDay} 天结束。今天以主线剧情为主。`,
                risk: currentRisk,
                fandom: fandomHeat
            });
        }
        setDay(prev => prev + 1);
        // 【每日恢复】心力 +50（上限 100）；今日行动数清零
        setMentalEnergy(prev => Math.min(MENTAL_MAX, prev + MENTAL_RECOVER_PER_DAY));
        setTodayActions(0);
        // 【自然衰减】风险每天 -5（危机 ≥80 时不衰减，正在发酵）；疑虑每天 -8
        setCurrentRisk(prev => prev >= 80 ? prev : Math.max(0, prev - 5));
        setSuspicion(prev => Math.max(0, prev - 8));
        // 一天结束才重置社交缓存/动态（保留玩家自己发的帖）
        setSocialCache({});
        setSocialFeeds(prev => {
            const next = {};
            Object.keys(prev).forEach(k => {
                const mine = (prev[k] || []).filter(p => p.mine);
                if (mine.length) next[k] = mine;
            });
            return next;
        });
        setTimeout(() => checkEndings(), 400);
        vibrate(VIBE.softTap);
        setToastMsg(`🌙 第 ${endedDay} 天结束，心力恢复到 ${Math.min(MENTAL_MAX, mentalEnergy + MENTAL_RECOVER_PER_DAY)}。新的一天开始了~`);
        setTimeout(() => setToastMsg(""), 3500);
    };

    // ══════════════════════════════════════════════════════════════
    // 【每日日程闸门】关闭「每日总结」= 正式进入新的一天。
    //   此刻自动弹出日程界面，确保玩家每天都会先安排/结算当天日程（每日日程有进行）。
    //   日程仍是模态窗，玩家可自行关闭——只是保证「每天都会被带到日程面前」，不硬性困住。
    //   若此时已达成结局（triggeredEnding），则不打断结局展示。
    // ══════════════════════════════════════════════════════════════
    const enterNextDayFromSummary = () => {
        setDailySummary(null);
        if (!triggeredEnding) setActiveModal("calendar");
    };

    const handleChoice = (choice) => continueStory(choice);
    const handleCustom = () => {
        if (customText.trim()) {
            continueStory("【自定义】" + customText);
            setCustomText("");
            setCustomMode(false);
        }
    };
    // 【光夜变奏】跃迁到某条世界线：1.5s 时空扭曲过场，动画中段(~0.75s)瞬时切换全局主题
    const switchWorld = (worldId) => {
        if (isWarping) return;
        setShowWorldMap(false);
        setWarpTarget(getWorld(worldId));
        setIsWarping(true);
        vibrate(VIBE.unlock);
        setTimeout(() => { setCurrentWorld(worldId); }, 750);
        setTimeout(() => { setIsWarping(false); setWarpTarget(null); }, 1500);
    };
    // 【结局判定】把当前状态打包成 evaluateEnding 需要的形状
    const buildEndingState = () => {
        const trust = {}; const jealousy = {};
        FANS.forEach(f => {
            trust[f.id] = fanEmotions[f.id]?.trust ?? 40;
            jealousy[f.id] = computeJealousy(hearts[f.id] ?? 0, trust[f.id]);
        });
        const heartVals = FANS.map(f => hearts[f.id] ?? 0);
        return {
            hearts, trust, jealousy, attrs, day,
            currentRisk, fandomHeat, antiCount,
            unlockedCount: unlocked.length,
            endingsUnlocked, everBE: endingsUnlocked.some(id => id.startsWith("be_")),
            maxHeart: Math.max(...heartVals), avgHeart: heartVals.reduce((a, b) => a + b, 0) / heartVals.length,
            someFan: (fn) => FANS.some(f => fn(f.id)),
            otherHighAmbiguity: (exceptId) => FANS.some(f => f.id !== exceptId && (hearts[f.id] ?? 0) >= 80 && unlocked.includes(f.id))
        };
    };
    const checkEndings = () => {
        if (triggeredEnding) return; // 已在结局中
        const e = evaluateEnding(buildEndingState());
        if (e) {
            setTriggeredEnding(e);
            setEndingsUnlocked(prev => prev.includes(e.id) ? prev : [...prev, e.id]);
            vibrate(VIBE.crisis); playSFX('unlock');
        }
    };

    // 【成就自动解锁】把当前状态映射成"此刻满足哪些成就"的 id 列表（memo：只在相关状态变化时重算）。
    // 与已解锁列表做差 → 有新达成就写库并弹 toast。effect 只依赖 memo 结果，不依赖 achievementsUnlocked，避免回环。
    const satisfiedAchievements = React.useMemo(() => {
        let st;
        try { st = { ...buildEndingState(), cycleCount, achievementsUnlocked }; }
        catch { return []; }
        return ACHIEVEMENTS.filter(a => { try { return a.cond(st); } catch { return false; } }).map(a => a.id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hearts, attrs, currentRisk, unlocked, endingsUnlocked, cycleCount, fandomHeat, antiCount, day]);

    React.useEffect(() => {
        const newly = satisfiedAchievements.filter(id => !achievementsUnlocked.includes(id));
        if (!newly.length) return;
        setAchievementsUnlocked(prev => {
            const add = newly.filter(id => !prev.includes(id));
            return add.length ? [...prev, ...add] : prev;
        });
        const first = ACHIEVEMENTS.find(a => a.id === newly[0]);
        if (first) {
            setToastMsg(`🏆 成就解锁：${first.icon} ${first.name}${newly.length > 1 ? ` 等 ${newly.length} 项` : ""}`);
            setTimeout(() => setToastMsg(""), 3200);
            vibrate(VIBE.dmReceive); playSFX('unlock');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [satisfiedAchievements]);

    // 结局后：继续剧情（留在本周目）
    const continueAfterEnding = () => setTriggeredEnding(null);
    // 结局后：结束本周目（进入下一周目，保留已解锁结局/周目数，重置进度）
    const endCurrentCycle = () => {
        setCycleCount(c => c + 1);
        setTriggeredEnding(null);
        setDay(1);
        setCurrentRisk(0); setSuspicion(0);
        setFandomHeat(Math.floor(Math.random() * 41) + 30);
        setAntiCount(Math.floor(Math.random() * 8) + 2);
        setUnlocked([]);
        setHearts(prev => { const n = {}; Object.keys(prev).forEach(k => n[k] = 30); return n; });
        setFanEmotions(initFanEmotions());
        setEncounterUsed({});
        // 【V20/V22】新周目：熟练度/私联/日程 + 心力/行动数全部归零，从第 1 天满心力开始
        setMentalEnergy(MENTAL_MAX); setTodayActions(0);
        setProficiency(emptyProficiency());
        setLastTrainDay({}); setLastUnlockDay(0); setInteractionCount({});
        setScheduleMap({}); setDailyPlan({ morning: null, noon: null, evening: null });
        setMainlineIdle(0); // 【V21】新周目主线节拍器归零
        setActiveTab("home");
        setCurrentStory(INIT_STORY);
        setCurrentChoices(INIT_CHOICES);
        setToastMsg("🎬 新的周目开始了~");
        setTimeout(() => setToastMsg(""), 3000);
    };

    // ========================================================================
    // 【心动邂逅 · 彩蛋】完全独立于主线之外，不与任何主线状态发生交换：
    //   ✗ 不推进天数        ✗ 不改 currentStory / currentChoices
    //   ✗ 不加好感度/信任度  ✗ 不改风险/疑虑/粉圈热度
    //   ✗ 不写 history       ✗ 不触发结局判定  ✗ 不生成每日总结
    //   ✓ 只做一件事：生成一段只给玩家看的独处小剧场，显示在偶遇弹窗里
    // 唯一持久化的是 encounterUsed（每天每位男主一次的额度），不影响任何数值。
    // ========================================================================
    const [encounterScene, setEncounterScene] = React.useState(null); // { fan, loc, text }
    const [encounterLoading, setEncounterLoading] = React.useState(false);
    const [encounterError, setEncounterError] = React.useState(null);
    const encounterLockRef = React.useRef(false);

    const startEncounter = async (fan, loc) => {
        if (encounterLockRef.current) return;
        if (isEncounterUsed(fan.id)) {
            setToastMsg(`今天已经和 ${fan.name} 偶遇过了，明天再来吧~`);
            setTimeout(() => setToastMsg(""), 2500);
            return;
        }
        encounterLockRef.current = true;
        setEncounterLoading(true);
        setEncounterError(null);
        setEncounterScene(null);
        vibrate(VIBE.heartUp);

        // 额度先扣（防止连点刷），失败时退回
        setEncounterUsed(prev => ({ ...prev, [day]: [...(prev[day] || []), fan.id] }));

        const place = loc.sub ? `${loc.title}，${loc.sub}` : loc.title;
        // 独立的 encounter action：后端只回一段文字，不返回任何数值/选项
        const result = await callEdgeFunction('encounter', {
            fan: { id: fan.id, name: fan.name, type: fan.type, personality: fan.personality, handle: fan.handle },
            place,
            locationTitle: loc.title,
            worldName: getWorld(currentWorld).name,
            character: { artistName: char?.artistName, nickname: char?.nickname, age: char?.age },
            playerPersonality: char?.hiddenTrait,   // 严格遵守玩家开局选择的性格
            heartLevel: hearts[fan.id] ?? 0,        // 只读：决定亲密度分寸，不回写
            trust: fanEmotions[fan.id]?.trust ?? 40,
            isUnlocked: unlocked.includes(fan.id)
        });

        if (result?.error || !result?.scene) {
            // 失败 → 退还今天的额度
            setEncounterUsed(prev => ({ ...prev, [day]: (prev[day] || []).filter(id => id !== fan.id) }));
            setEncounterError("这次偶遇没能发生……稍后再试一次吧。");
        } else {
            setEncounterScene({ fan, loc, text: result.scene });
            playSFX('unlock');
        }
        setEncounterLoading(false);
        encounterLockRef.current = false;
    };
    // 关闭偶遇彩蛋（回到偶遇入口，主线完全不受影响）
    const closeEncounter = () => {
        setShowEncounter(false);
        setEncounterFan(null);
        setEncounterScene(null);
        setEncounterError(null);
        setEncounterLoading(false);
    };

    // 【剧情深度融合】剧情主动弹出手机界面：剧情文字里出现"手机亮了/弹出通知"时，
    // 后端返回 triggerPhone: { type, target, data }，这里据此自动打开对应 App，而不是让玩家手点。
    //   type: open_phone / open_kakao / open_dm / open_forum / open_weverse / open_instagram / open_live 等
    const [storyIncomingMsg, setStoryIncomingMsg] = React.useState(null); // 剧情预填的来消息 {sender, message, choices}
    const handleStoryTrigger = (trigger) => {
        if (!trigger || typeof trigger !== "object") return;
        const t = trigger.type || (trigger.target ? `open_${trigger.target}` : "open_phone");
        const data = trigger.data || {};
        if (data.sender || data.message) setStoryIncomingMsg({ sender: data.sender, message: data.message, choices: data.choices, fanId: trigger.fanId });
        // 短延迟让剧情文字先落定，再"手机自己跳出来找你"
        setTimeout(() => {
            setShowPhone(true);
            switch (t) {
                case "open_kakao": setActiveModal("kakao"); if (trigger.fanId) setShowPrivateChat(FANS.find(f => f.id === trigger.fanId) || null); break;
                case "open_dm": setActiveModal("weverse"); if (trigger.fanId) setSelectedPaidFan(FANS.find(f => f.id === trigger.fanId) || null); break;
                case "open_forum": loadForum(trigger.target === "pann" ? "pann" : "pann"); setActiveModal("pann"); break;
                case "open_weverse": setActiveModal("weverse"); break;
                case "open_instagram": setActiveModal("instagram"); break;
                case "open_live": setActiveModal("weverse"); break;
                case "open_phone": default: setActiveTab("phone"); break;
            }
            vibrate(VIBE.unlock);
        }, 600);
    };

    // ========== 手机功能函数 ==========
    
    // 营业
    const [businessResult, setBusinessResult] = React.useState(null);

    const handleBusiness = async (platform, type, content, triggerSpinoff) => {
        addWorldState(`在${platform}进行了${type}：${content.slice(0,25)}`);
        const gameContext = {
            popularity: attrs.人气值, antiCount, fandomHeat,
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
            // 时尚/人气走 clamp 通道；颜值只能通过 beautify（美容/整容）+1~2
            const attrDelta = {};
            if (item.effect.fashion) attrDelta.时尚度 = item.effect.fashion;
            if (item.effect.popularity) attrDelta.人气值 = item.effect.popularity;
            if (Object.keys(attrDelta).length) updateAttrs(attrDelta);
            if (item.effect.beautify) beautifyFace(item.effect.beautify);
            if (item.effect.risk) updateRisk(item.effect.risk);
            if (item.effect.heart && unlocked.length > 0) updateHearts({ [unlocked[0]]: item.effect.heart });
            addWorldState(`购物：买了${item.name}，花了${item.price}万`);
            setToastMsg(`🛍️ 购买成功！${item.name} 已入手${item.effect.fashion ? `，时尚度+${item.effect.fashion}` : ""}${item.effect.beautify ? `，颜值+${item.effect.beautify}` : ""}${item.effect.popularity ? `，人气+${item.effect.popularity}` : ""}`);
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
        const result = await callEdgeFunction('company', { action, companyFavor, currentRisk, artistName: char?.artistName });
        if (result?.error || !result?.story) {
            alert(`📞 公司这边没接通，请稍后重试。`);
            return;
        }
        if (result.companyFavorChange) setCompanyFavor(prev => Math.min(100, Math.max(0, prev + result.companyFavorChange)));
        if (result.companyChange) setCompanyFavor(prev => Math.min(100, Math.max(0, prev + result.companyChange)));
        if (result.riskChange) updateRisk(result.riskChange);
        // 签约逻辑
        if (result.contractTerms) {
            setCompanyContract({ terms: result.contractTerms, control: result.companyControl || 1, signedDay: day, signed: true });
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
    // 【V22】把"她对这个大粉说过的实质消息"记进聊天记忆（零成本召回材料，喂给后端）。
    // 只记有内容的话：太短的（嗯/哦/在吗）和连续重复的不记；每人最多留最近 8 条。
    const rememberPlayerMsg = (fanId, msg) => {
        const t = String(msg || '').trim();
        if (t.length < 4) return;
        setDmMemory(prev => {
            const list = prev[fanId] || [];
            if (list[list.length - 1] === t) return prev;
            return { ...prev, [fanId]: [...list, t].slice(-8) };
        });
    };
const sendDM = async (fan, text, actionItem) => {
        const messageText = text || (actionItem ? actionItem.prompt : "");
        if (!messageText) return;
        
        const jealousy = fanEmotions[fan.id]?.jealousy || 25;
        const isJealous = jealousy > 70;
        let heartBonus = 1;  // 海后值已删除，不再按养鱼程度打折
        
        let processedMessage = messageText;
        if (fan.name === "沈载伦") processedMessage = messageText.replace(/姐姐|欧尼/g, "你");
        
        addWorldState(`和${fan.name}聊了天：${processedMessage.slice(0, 30)}`);
        addRecentInteraction(fan.id, `发了消息：${processedMessage.slice(0, 40)}`);
        // 【V22】把她这句话记进聊天记忆（供后端"你还记得她说过…"召回）
        rememberPlayerMsg(fan.id, processedMessage);
        
        const myMsg = { role: "user", content: processedMessage, time: new Date().toLocaleTimeString() };
        addDmMessage(fan.id, { ...myMsg, isMe: true });
        
        const currentHistory = (dmHistories[fan.id] || []).slice(-10).map(m => ({
            role: m.isMe ? "user" : "assistant",
            content: m.content
        }));
        const nowHour = new Date().getHours();
        
        const result = await callEdgeFunction('dm', {
            fan: { name: fan.name, handle: fan.handle, type: fan.type, personality: fan.personality, age: fan.age || 22, famousEvent: fan.famousEvent },
            charAge: Number(char?.age) || 20, // 【传入年龄判定】
            userMessage: isJealous ? `[吃醋模式] ${processedMessage}` : processedMessage,
            history: currentHistory,
            emotions: { ...fanEmotions[fan.id], jealousy: computeJealousy(hearts[fan.id] ?? 0, fanEmotions[fan.id]?.trust ?? 40) },
            heartLevel: hearts[fan.id] ?? 30,   // 好感度（后端据此判断包容/失控）
            // 【V22】DM 真人感三件套的入参
            dmMemory: dmMemory[fan.id] || [],                                   // 她之前说过的实质消息
            relationshipStatus: fanEmotions[fan.id]?.relationshipStatus || "",  // 每8句算好的关系氛围摘要
            isLateNight: (nowHour >= 23 || nowHour < 5),                        // 深夜模式氛围
        });
        
        if (result.reply || (Array.isArray(result.bubbles) && result.bubbles.length)) {
            // 【V22】多气泡：像真人发微信一样，一条条错开时间弹出
            const bubbles = (Array.isArray(result.bubbles) && result.bubbles.length)
                ? result.bubbles
                : [result.reply];
            bubbles.forEach((b, i) => {
                setTimeout(() => {
                    addDmMessage(fan.id, { role: "assistant", content: b, isMe: false, time: new Date().toLocaleTimeString() });
                    vibrate(VIBE.dmReceive);
                    if (i === 0) playSFX('dm');
                }, i * 700);
            });
            updateHearts({ [fan.id]: Math.floor((actionItem ? actionItem.heartDelta : 1) * heartBonus) });
            
            // 【每聊 8 句触发关系摘要】修复闭包：手动拼上刚发/刚收的两条，避免拿到旧 state
            const newCount = (dmHistories[fan.id]?.length || 0) + 2;
            if (newCount > 0 && newCount % 8 === 0) {
                const latestMsgs = [
                    ...((dmHistories[fan.id] || []).slice(-6)),
                    { isMe: true, content: processedMessage },
                    { isMe: false, content: result.reply || bubbles.join(" ") }
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
        
        // ⭐ 改为"惰性任务"而非立即并发：FANS.map(async ...) 会让 6 个 LLM 请求瞬间同时发出，
        //   极易在硅基撞到每分钟请求/Token 上限(429)，而 429 一旦触发，接下来一整分钟内
        //   手机里所有功能（论坛/评论/弹幕/社媒）都会跟着加载失败或变慢。下面用并发池限到 2。
        const fanTasks = FANS.map((fan) => async () => {
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
                    emotions: { ...fanEmotions[fan.id], jealousy: computeJealousy(hearts[fan.id] ?? 0, fanEmotions[fan.id]?.trust ?? 40) },
                    heartLevel: hearts[fan.id] ?? 30,
                    playerNickname: nickname,
                    // 【V22】群发私回也吃记忆/关系氛围/时间，让付费DM回复同样带真人质感
                    dmMemory: dmMemory[fan.id] || [],
                    relationshipStatus: fanEmotions[fan.id]?.relationshipStatus || "",
                    isLateNight: (new Date().getHours() >= 23 || new Date().getHours() < 5),
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
        // 并发池：最多同时跑 2 个，跑完一个再补下一个，避免一次性 6 个把限额打爆
        let _fanIdx = 0;
        const runFanPool = async () => {
            while (_fanIdx < fanTasks.length) {
                const k = _fanIdx++;
                await fanTasks[k]();
            }
        };
        await Promise.all(Array.from({ length: Math.min(2, fanTasks.length) }, runFanPool));

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
                    nickname: char?.nickname
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
        const cacheKey = `${platformId}_day${day}_risk${Math.floor(currentRisk/20)}_unlock${unlocked.length}_evt${evtTag}`;
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
            day, riskLevel: currentRisk, fandomHeat, antiCount,
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
            riskLevel: currentRisk, antiCount, fandomHeat,
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
    
    // 风险等级（百分制 5 级：<5 隐形 / 5-20 低危 / 20-50 中危 / 50-80 高危 / >80 致命）
    const riskClass = currentRisk >= 50 ? "risk-high" : (currentRisk >= 20 ? "risk-mid" : "risk-low");
    const riskLevelInfo =
        currentRisk >= 80 ? { star: "⭐⭐⭐⭐⭐", name: "致命", text: "⚫ 塌房级" } :
        currentRisk >= 50 ? { star: "⭐⭐⭐⭐", name: "高危", text: "🔴 高危" } :
        currentRisk >= 20 ? { star: "⭐⭐⭐", name: "中危", text: "🟠 中危" } :
        currentRisk >= 5  ? { star: "⭐⭐", name: "低危", text: "🟡 低危" } :
                            { star: "⭐", name: "隐形", text: "🟢 隐形" };
    const riskText = riskLevelInfo.text;
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
                <div className="sidebar-item"><span>⚡ 暴露风险</span><span className="sidebar-value">{currentRisk}%</span></div>
                <div className="sidebar-item"><span>🔥 粉圈热度</span><span className="sidebar-value">{fandomHeat}</span></div>
                <div className="sidebar-item"><span>🗡️ 黑粉占比</span><span className="sidebar-value">{antiCount}%</span></div>
            </div>
            <div className="sidebar-section">
                <h4>❤️ 大粉好感度</h4>
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
                <h4>📋 今日日程{scheduleMap[day] ? "（已结算）" : "（未安排）"}</h4>
                {SCHEDULE_SLOTS.map(s => {
                    const a = findScheduleActivity((scheduleMap[day] || dailyPlan)[s.key]);
                    return <div key={s.key} className="sidebar-item"><span>{s.emoji} {s.label}</span><span>{a ? a.name : "—"}</span></div>;
                })}
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
        // 首页：参考乙女游戏的清爽入口层，保留主线、活动、偶遇、手机系统的关系
        if (activeTab === "home") {
            // 【活动系统 · 独立】首页「活动」入口副标题为静态占位，绝不读取主线/剧情事件（currentEvent）。
            const activityTitle = "筹备中 · 敬请期待";
            return (
                <div className="ln-home">
                    <div className="ln-sky" aria-hidden="true">
                        <div className="ln-cloud ln-cloud-a" />
                        <div className="ln-cloud ln-cloud-b" />
                        <div className="ln-tower" />
                    </div>
                    <div className="ln-home-top">
                        <div>
                            <div className="ln-kicker">Parallel Heartline</div>
                            <h1>{char?.artistName || "晨晨"}</h1>
                        </div>
                        <div className="ln-home-actions">
                            <button className="ln-round-btn glow" onClick={() => setShowWorldMap(true)} aria-label="观测次元">🌌</button>
                            <button className="ln-round-btn" onClick={() => setActiveTab("settings")} aria-label="状态">i</button>
                        </div>
                    </div>

                    <div className="ln-main-card" onClick={() => setActiveTab("story")}>
                        <div>
                            <div className="ln-card-label">{getWorld(currentWorld).cardLabel}</div>
                            <h2>{getWorld(currentWorld).name}</h2>
                            <p>{getWorld(currentWorld).desc}</p>
                        </div>
                        <span className="ln-arrow">›</span>
                    </div>

                    <div className="ln-side-menu" aria-label="功能入口">
                        <button onClick={() => setActiveTab("activity")}>
                            <span>活动</span>
                            <small>{activityTitle}</small>
                        </button>
                        <button onClick={() => setActiveModal("calendar")}>
                            <span>日程</span>
                            <small>{scheduleMap[day] ? "今日已安排" : "安排上午/下午/晚上"}</small>
                        </button>
                        <button onClick={() => setActiveTab("relation")}>
                            <span>偶遇</span>
                            <small>心动邂逅 / 关系图谱</small>
                        </button>
                    </div>

                    <div className="ln-bottom-actions">
                        <button onClick={() => setActiveTab("phone")}>
                            <span>手机</span>
                            <small>SNS / 私聊 / 商城</small>
                        </button>
                        <button onClick={() => setActiveTab("settings")}>
                            <span>状态</span>
                            <small>属性 / 存档 / 系统</small>
                        </button>
                    </div>
                </div>
            );
        }

        if (activeTab === "activity") {
            return (
                <div className="ln-activity">
                    <div className="ln-section-title">
                        <span>活动</span>
                        <button onClick={() => setActiveTab("home")}>返回首页</button>
                    </div>
                    <div className="ln-placeholder-event">
                        <div className="ln-event-badge">Coming Soon</div>
                        {/* 【活动系统 · 独立】纯占位：不读取 currentEvent，不提供任何跳转到主线/剧情的入口。
                            具体玩法留待后续单独实现，与主线、剧情事件完全隔离、互不联动。 */}
                        <h2>限时活动预留位</h2>
                        <p>这里是以后要追加的独立玩法入口，和主线、剧情事件完全分开、互不影响。具体玩法待补充。</p>
                        <button className="btn-secondary" disabled>活动尚未开放</button>
                    </div>
                </div>
            );
        }

        // 剧情页
        if (activeTab === "story") {
            const todayScheduled = !!scheduleMap[day];
            const restNeeded = mentalEnergy < MENTAL_MIN_TO_ACT;   // 心力见底 → 今天推不动主线
            return (
                <>
                    {/* 今日进度：心力 + 已做几件事（取代旧的「必须先排日程」闸门与时段光标）*/}
                    <div style={{ margin: "0 16px 10px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 11, color: "#9d6db8" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 700, color: restNeeded ? "#ef4444" : mentalEnergy < MENTAL_WARN ? "#f59e0b" : "#ec4899" }}>
                            ❤️ 心力 {mentalEnergy}/{MENTAL_MAX}
                        </span>
                        <span>·</span>
                        <span>🕑 {dayPhaseFromActions(todayActions)}</span>
                        <span>·</span>
                        <span>今天做了 <b style={{ color: "#a21caf" }}>{todayActions}</b> 件事</span>
                        <button onClick={() => setActiveModal("calendar")} style={{ marginLeft: "auto", background: "none", border: "1px solid rgba(217,70,168,0.35)", color: "#d946a8", fontSize: 10, borderRadius: 10, padding: "2px 8px", cursor: "pointer" }}>
                            {todayScheduled ? "📅 今日已安排" : "📅 安排日程"}
                        </button>
                    </div>
                    {restNeeded && (
                        <div style={{ margin: "0 16px 10px", fontSize: 11, color: "#ef4444", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, padding: "6px 10px", lineHeight: 1.6 }}>
                            😴 心力不足（&lt;{MENTAL_MIN_TO_ACT}），今天推不动主线了。可以去「安排日程」或休息，或点下方「结束今天」——明天心力会恢复。
                        </div>
                    )}
                    {/* 【主线节拍器 · V21】怠速到阈值 → 明示玩家：下一拍主线要动了 */}
                    {!loading && !restNeeded && mainlineIdle >= MAINLINE_PUSH_AFTER && (
                        <div style={{ margin: "0 16px 10px", fontSize: 11, color: "#a21caf", background: "rgba(168,85,247,0.10)", border: "1px solid rgba(168,85,247,0.25)", borderRadius: 12, padding: "6px 10px" }}>
                            🎬 主线蓄势中 —— 日常已连续 {mainlineIdle} 拍，下一段剧情将迎来主线进展
                        </div>
                    )}
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
                    {suspicion >= 50 && (
                        <div style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 14, margin: "0 16px 10px", padding: "8px 14px", fontSize: 11, color: "#fde68a" }}>
                            👀 {suspicion >= 80 ? "粉丝疑虑极高，论坛已有人在数据分析，下次任何可疑举动都会引爆舆论" : "已有粉丝注意到一些反常迹象，蛛丝马迹正在积累..."}
                        </div>
                    )}
                    {FANS.filter(f => (fanEmotions[f.id]?.jealousy ?? 0) > 70 && unlocked.includes(f.id)).length >= 2 && (
                        <div className="sea-warning">
                            ⚠️ 多位大粉吃醋度飙升，私聊语气变酸，论坛出现"是不是同时喜欢好几个"的讨论...
                        </div>
                    )}
                    {currentRisk > 60 && (
                        <div className="high-heart-event" style={{ background: "linear-gradient(135deg, #ec4899, #a855f7)" }}>
                            🚨 风险已过 60%，公司随时可能警觉；{currentRisk > 80 ? "已过 80%，粉丝脱粉回踩一触即发！" : "狗仔/小号随时可能爆瓜。"}下一步选择将触发危机剧情。
                        </div>
                    )}
                    {highHeartEvent && (
                        <div className="high-heart-event">
                            💕 {highHeartEvent.message} 💕
                        </div>
                    )}
                    <div className="story-card" ref={storyTopRef}>
                        {/* 氛围标签 */}
                        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 10, color: "#b88dc7" }}>🎭 氛围：</span>
                            <span style={{ fontSize: 10, fontWeight: "bold", color: currentRisk > 60 ? "#f472b6" : Object.values(hearts).some(v => v > 80) ? "#ec4899" : "#10b981" }}>
                                {currentRisk > 80 ? "🚨 塌房边缘，全网审判在即" :
                                 currentRisk > 60 ? "⚠️ 风雨欲来，公司已经警觉" :
                                 currentRisk > 30 ? "👀 热贴讨论，注意言行" :
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
                                {/* 主线选项：每选一次 -15 心力；心力见底则变灰不可选 */}
                                {currentChoices.map((choice, idx) => (
                                    <button key={idx} className="choice-btn" onClick={() => handleChoice(choice)} disabled={restNeeded}
                                        style={restNeeded ? { opacity: 0.45, cursor: "not-allowed" } : undefined}>
                                        <span className="choice-label">{String.fromCharCode(65 + idx)}</span>
                                        <span style={{ flex: 1 }}>{choice}</span>
                                        <span style={{ fontSize: 10, color: restNeeded ? "#ef4444" : "#c084fc", whiteSpace: "nowrap", marginLeft: 6 }}>−{MENTAL_COST_MAINLINE}心力</span>
                                    </button>
                                ))}
                                {restNeeded && (
                                    <div style={{ fontSize: 11, color: "#ef4444", textAlign: "center", padding: "4px 0" }}>
                                        心力不足，主线选项暂不可选。去点日程/休息，或「结束今天」让心力恢复。
                                    </div>
                                )}
                                {!customMode ? (
                                    <button className="choice-btn" onClick={() => setCustomMode(true)} disabled={restNeeded}
                                        style={{ border: "1px dashed #d946a8", textAlign: "center", ...(restNeeded ? { opacity: 0.45, cursor: "not-allowed" } : {}) }}>
                                        ✏️ 自定义行动（主线 −{MENTAL_COST_MAINLINE}心力）
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
                                {/* 【一天的控制 · V22】玩家自己决定继续还是结束今天 */}
                                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(217,70,168,0.15)" }}>
                                    <div style={{ fontSize: 11, color: "#9d6db8", textAlign: "center", marginBottom: 8 }}>
                                        今天做了 <b style={{ color: "#a21caf" }}>{todayActions}</b> 件事
                                        {todayActions >= MAX_ACTIONS_PER_DAY && <span style={{ color: "#f59e0b" }}> · 做了不少了，要不要休息？</span>}
                                    </div>
                                    <div style={{ display: "flex", gap: 10 }}>
                                        <button className="btn-secondary" style={{ flex: 1 }} onClick={() => storyTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                                            继续今天
                                        </button>
                                        <button className={todayActions >= MAX_ACTIONS_PER_DAY ? "btn-primary" : "btn-secondary"} style={{ flex: 1 }} onClick={endDay}>
                                            🌙 结束今天
                                        </button>
                                    </div>
                                </div>
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
                    <div className="ln-main-card" style={{ minHeight: 0, marginTop: 0, marginBottom: 16, padding: 18 }}
                        onClick={() => { setEncounterFan(null); setEncounterScene(null); setEncounterError(null); setShowEncounter(true); }}>
                        <div>
                            <div className="ln-card-label">心动邂逅</div>
                            <h2 style={{ fontSize: 20 }}>偶遇 · {getWorld(currentWorld).name}</h2>
                            <p>挑一位大粉，选一个只属于你们的角落，触发一场电影感的独处。</p>
                        </div>
                        <span className="ln-arrow">›</span>
                    </div>
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
                                    <div className="sidebar-item"><span>❤️ 好感度</span><span className="sidebar-value">{hearts[showFanDetail.id]}</span></div>
                                    <div className="sidebar-item"><span>🤝 信任度</span><span className="sidebar-value">{fanEmotions[showFanDetail.id]?.trust ?? 40}</span></div>
                                    <div className="sidebar-item"><span>💢 吃醋度</span><span className="sidebar-value">{computeJealousy(hearts[showFanDetail.id] ?? 0, fanEmotions[showFanDetail.id]?.trust ?? 40)}</span></div>
                                    <div style={{ fontSize: 10, color: "#b88dc7", margin: "2px 0 10px" }}>
                                        {hearts[showFanDetail.id] >= 90 ? "好感≥90：无条件包容，吃醋恒为 20" : "好感<90：信任越低，他越容易吃醋失控"}
                                    </div>
                                    {hearts[showFanDetail.id] >= 90 && (
                                        <div style={{ background: "linear-gradient(135deg, #f472b6, #c084fc)", borderRadius: 12, padding: 8, marginBottom: 12, textAlign: "center" }}>
                                            <span style={{ color: "white", fontSize: 11 }}>💗 好感度≥90！他愿意为你做任何事，甚至当男小三</span>
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
                        <button className="phone-close" onClick={() => setActiveTab("home")}>×</button>
                    </div>
                    <div className="phone-apps">
                        <div className="phone-app" onClick={() => setActiveModal("weverse")}><div className="phone-app-icon">🌐</div><div className="phone-app-name">Weverse</div></div>
                        <div className="phone-app" onClick={() => setActiveModal("kakao")}><div className="phone-app-icon">💬</div><div className="phone-app-name">KakaoTalk</div></div>
                        <div className="phone-app" onClick={() => setActiveModal("instagram")}><div className="phone-app-icon">📷</div><div className="phone-app-name">Instagram</div></div>
                        <div className="phone-app" onClick={() => { loadForum("pann"); setActiveModal("pann"); }}><div className="phone-app-icon">🔥</div><div className="phone-app-name">Pann</div></div>
                        <div className="phone-app" onClick={() => setActiveModal("twitter")}><div className="phone-app-icon">𝕏</div><div className="phone-app-name">Twitter</div></div>
                        <div className="phone-app" onClick={() => setActiveModal("tiktok")}><div className="phone-app-icon">🎵</div><div className="phone-app-name">TikTok</div></div>
                        {/* 姐夫站已并入微博（微博内设「姐夫站」子tab） */}
                        <div className="phone-app" onClick={() => { setCpostTab("weibo"); setActiveModal("cpost"); }}><div className="phone-app-icon">🌊</div><div className="phone-app-name">微博</div></div>
                        <div className="phone-app" onClick={() => setActiveModal("threads")}><div className="phone-app-icon">🧵</div><div className="phone-app-name">Threads</div></div>
                        <div className="phone-app" onClick={() => setActiveModal("youtube")}><div className="phone-app-icon">📺</div><div className="phone-app-name">YouTube</div></div>
                        {/* 礼物已并入商城（商城内含「送礼」区） */}
                        <div className="phone-app" onClick={() => setActiveModal("shop")}><div className="phone-app-icon">🛒</div><div className="phone-app-name">商城</div></div>
                        <div className="phone-app" onClick={() => setActiveModal("company")}><div className="phone-app-icon">🏢</div><div className="phone-app-name">公司</div></div>
                        <div className="phone-app" onClick={() => { setActiveModal("graph"); setShowRelationGraph(true); }}><div className="phone-app-icon">🕸️</div><div className="phone-app-name">关系图谱</div></div>
                        {/* 🏆 结局图鉴 + 成就总览 */}
                        <div className="phone-app" onClick={() => { setGalleryTab("endings"); setGalleryReading(null); setActiveModal("gallery"); }}><div className="phone-app-icon">🏆</div><div className="phone-app-name">图鉴</div></div>
                        {/* 匿名小号 → 小号管理：可在 Twitter/TikTok/微博/ins 自主选择是否注册小号 */}
                        <div className="phone-app" onClick={() => setActiveModal("altmanager")}><div className="phone-app-icon">🎭</div><div className="phone-app-name">小号管理</div></div>
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
                        <div className="sidebar-item"><span>⚡ 暴露风险</span><span className="sidebar-value">{currentRisk}%</span></div>
                        <div className="sidebar-item"><span>🔥 粉圈热度</span><span className="sidebar-value">{fandomHeat}</span></div>
                        <div className="sidebar-item"><span>🗡️ 黑粉占比</span><span className="sidebar-value">{antiCount}%</span></div>
                    </div>
                    <div className="sidebar-section">
                        <h4>❤️ 大粉好感度</h4>
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
                        <h4>📋 今日日程{scheduleMap[day] ? "（已结算）" : "（未安排）"}</h4>
                        {SCHEDULE_SLOTS.map(s => {
                            const a = findScheduleActivity((scheduleMap[day] || dailyPlan)[s.key]);
                            return <div key={s.key} className="sidebar-item"><span>{s.emoji} {s.label}</span><span>{a ? a.name : "—"}</span></div>;
                        })}
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
        // ========== 🏆 结局图鉴 + 成就（乙女游戏式收集总览）==========
        if (activeModal === "gallery") {
            const unlockedSet = new Set(endingsUnlocked);
            const endTotal = ENDINGS.length;
            const endGot = ENDINGS.filter(e => unlockedSet.has(e.id)).length;
            const typeOrder = ["HE", "公共", "BE", "OE", "TE"];
            const grouped = typeOrder
                .map(t => ({ t, meta: ENDING_TYPE_META[t], list: ENDINGS.filter(e => e.type === t) }))
                .filter(g => g.list.length);

            const acGot = ACHIEVEMENTS.filter(a => achievementsUnlocked.includes(a.id)).length;
            const acTotal = ACHIEVEMENTS.length;

            const closeGallery = () => { setActiveModal(null); setGalleryReading(null); };

            // —— 子视图：回看某个已解锁结局的正文 ——
            if (galleryReading) {
                const e = galleryReading;
                return (
                    <div className="modal-overlay" onClick={closeGallery}>
                        <div className="modal-content modal-anim" onClick={ev => ev.stopPropagation()} style={{ maxWidth: 440, maxHeight: "88vh", overflowY: "auto" }}>
                            <div className="modal-header">
                                <h3>🎬 {e.type} · 结局回顾</h3>
                                <button className="modal-close" onClick={() => setGalleryReading(null)}>×</button>
                            </div>
                            <div style={{ padding: 18 }}>
                                <h2 style={{ fontSize: 18, color: "#a855f7", marginBottom: 4 }}>{e.title}</h2>
                                <div style={{ fontSize: 11, color: "#b88dc7", marginBottom: 14 }}>【结局成就】{e.achievement}</div>
                                <div style={{ fontSize: 13, color: "#4a1d5a", lineHeight: 1.9, whiteSpace: "pre-wrap", marginBottom: 18 }}>{e.text}</div>
                                <button className="btn-secondary" style={{ width: "100%" }} onClick={() => setGalleryReading(null)}>← 返回图鉴</button>
                            </div>
                        </div>
                    </div>
                );
            }

            const Bar = ({ got, total }) => (
                <div style={{ height: 8, background: "#f3d5ed", borderRadius: 999, overflow: "hidden", marginTop: 6 }}>
                    <div style={{ width: `${total ? Math.round(got / total * 100) : 0}%`, height: "100%", background: "linear-gradient(90deg,#d946a8,#a855f7)", borderRadius: 999, transition: "width .4s" }} />
                </div>
            );

            return (
                <div className="modal-overlay" onClick={closeGallery}>
                    <div className="modal-content modal-anim" onClick={ev => ev.stopPropagation()} style={{ maxWidth: 460, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
                        <div className="modal-header">
                            <h3>🏆 图鉴 · 第 {cycleCount + 1} 周目</h3>
                            <button className="modal-close" onClick={closeGallery}>×</button>
                        </div>
                        {/* Tab 切换 */}
                        <div style={{ display: "flex", gap: 8, padding: "10px 16px 0" }}>
                            {[["endings", `结局 ${endGot}/${endTotal}`], ["achievements", `成就 ${acGot}/${acTotal}`]].map(([k, label]) => (
                                <button key={k} onClick={() => setGalleryTab(k)}
                                    style={{
                                        flex: 1, padding: "8px 0", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer",
                                        border: galleryTab === k ? "none" : "1px solid #f3d5ed",
                                        background: galleryTab === k ? "linear-gradient(90deg,#d946a8,#a855f7)" : "#fff",
                                        color: galleryTab === k ? "#fff" : "#9d6db8"
                                    }}>{label}</button>
                            ))}
                        </div>

                        <div style={{ padding: 16, overflowY: "auto" }}>
                            {galleryTab === "endings" && (
                                <>
                                    <div style={{ fontSize: 11, color: "#9d6db8" }}>已解锁 {endGot} / {endTotal} 个结局（跨周目累积）</div>
                                    <Bar got={endGot} total={endTotal} />
                                    {grouped.map(g => (
                                        <div key={g.t} style={{ marginTop: 16 }}>
                                            <div style={{ fontSize: 12, fontWeight: 700, color: "#a855f7", marginBottom: 8 }}>{g.meta.label}</div>
                                            <div style={{ display: "grid", gap: 8 }}>
                                                {g.list.map(e => {
                                                    const got = unlockedSet.has(e.id);
                                                    if (got) return (
                                                        <div key={e.id} onClick={() => setGalleryReading(e)}
                                                            style={{ background: "#fff", border: "1px solid #f3d5ed", borderRadius: 14, padding: "10px 12px", cursor: "pointer" }}>
                                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                                                <span style={{ fontSize: 13, fontWeight: 700, color: "#4a1d5a" }}>{e.title}</span>
                                                                <span style={{ fontSize: 10, color: "#d946a8", whiteSpace: "nowrap" }}>点击回看 ›</span>
                                                            </div>
                                                            <div style={{ fontSize: 10, color: "#b88dc7", marginTop: 3 }}>🏅 {e.achievement}</div>
                                                        </div>
                                                    );
                                                    // 未解锁：隐藏结局(TE)遮得更死
                                                    const masked = e.type === "TE";
                                                    return (
                                                        <div key={e.id}
                                                            style={{ background: "#faf3fb", border: "1px dashed #e6c8e6", borderRadius: 14, padding: "10px 12px", opacity: .85 }}>
                                                            <div style={{ fontSize: 13, fontWeight: 700, color: "#c9a8d6" }}>
                                                                {masked ? "？？？ 隐藏结局" : `🔒 ${e.title.replace(/·.*$/, "").trim() || "未解锁结局"}`}
                                                            </div>
                                                            <div style={{ fontSize: 10, color: "#b88dc7", marginTop: 3 }}>{g.meta.hint}</div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </>
                            )}

                            {galleryTab === "achievements" && (
                                <>
                                    <div style={{ fontSize: 11, color: "#9d6db8" }}>已解锁 {acGot} / {acTotal} 个成就（跨周目累积）</div>
                                    <Bar got={acGot} total={acTotal} />
                                    {/* 独立里程碑成就 */}
                                    <div style={{ fontSize: 12, fontWeight: 700, color: "#a855f7", margin: "16px 0 8px" }}>里程碑成就</div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                        {ACHIEVEMENTS.map(a => {
                                            const got = achievementsUnlocked.includes(a.id);
                                            return (
                                                <div key={a.id} style={{
                                                    background: got ? "#fff" : "#faf3fb",
                                                    border: got ? "1px solid #f3d5ed" : "1px dashed #e6c8e6",
                                                    borderRadius: 14, padding: "10px 10px", opacity: got ? 1 : .8
                                                }}>
                                                    <div style={{ fontSize: 20, filter: got ? "none" : "grayscale(1) opacity(.5)" }}>{got ? a.icon : "🔒"}</div>
                                                    <div style={{ fontSize: 12, fontWeight: 700, color: got ? "#4a1d5a" : "#c9a8d6", marginTop: 4 }}>{got ? a.name : "未解锁"}</div>
                                                    <div style={{ fontSize: 10, color: "#b88dc7", marginTop: 3, lineHeight: 1.5 }}>{got ? a.desc : a.hint}</div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {/* 结局成就（与每个结局绑定）*/}
                                    <div style={{ fontSize: 12, fontWeight: 700, color: "#a855f7", margin: "18px 0 8px" }}>结局成就</div>
                                    <div style={{ display: "grid", gap: 6 }}>
                                        {ENDINGS.map(e => {
                                            const got = unlockedSet.has(e.id);
                                            return (
                                                <div key={e.id} style={{
                                                    display: "flex", alignItems: "center", gap: 8,
                                                    background: got ? "#fff" : "#faf3fb",
                                                    border: got ? "1px solid #f3d5ed" : "1px dashed #e6c8e6",
                                                    borderRadius: 12, padding: "8px 10px", opacity: got ? 1 : .8
                                                }}>
                                                    <span style={{ fontSize: 15 }}>{got ? "🏅" : "🔒"}</span>
                                                    <div style={{ minWidth: 0 }}>
                                                        <div style={{ fontSize: 12, fontWeight: 700, color: got ? "#4a1d5a" : "#c9a8d6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                            {got ? e.achievement : "？？？"}
                                                        </div>
                                                        <div style={{ fontSize: 10, color: "#b88dc7" }}>{got ? e.title : ENDING_TYPE_META[e.type]?.label}</div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            );
        }
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
            const isJiefu = cpostTab === "jiefu" || cpostTab === "jiefubing";
            const key = isJiefu ? `jiefu:${cpostTab === "jiefubing" ? "jiefubing" : "jiefu"}` : `cpost:${cpostTab}`;
            const cfg = SOCIAL_CFG[key];
            const feed = socialFeeds[key] || [];
            const loading = socialLoadingKey === key;
            return (
                <div className="modal-overlay" onClick={() => setActiveModal(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3>🌊 微博</h3><button className="modal-close" onClick={() => setActiveModal(null)}>×</button></div>
                        <div style={{ padding: 16, overflowY: "auto" }}>
                            <div className="weverse-tabs">
                                <button className={`weverse-tab ${cpostTab === "weibo" ? "active" : ""}`} onClick={() => setCpostTab("weibo")}>微博</button>
                                <button className={`weverse-tab ${cpostTab === "douban" ? "active" : ""}`} onClick={() => setCpostTab("douban")}>豆瓣</button>
                                <button className={`weverse-tab ${cpostTab === "jiefu" ? "active" : ""}`} onClick={() => setCpostTab("jiefu")}>⚠️ 姐夫站</button>
                            </div>
                            {isJiefu && (
                                <>
                                    <div className="weverse-tabs" style={{ marginTop: 4 }}>
                                        <button className={`weverse-tab ${cpostTab === "jiefu" ? "active" : ""}`} onClick={() => setCpostTab("jiefu")}>姐夫你别这样</button>
                                        <button className={`weverse-tab ${cpostTab === "jiefubing" ? "active" : ""}`} onClick={() => setCpostTab("jiefubing")}>有姐夫病没姐夫命</button>
                                    </div>
                                    <div style={{ fontSize: 11, color: "#b88dc7", margin: "8px 0 12px" }}>💡 姐夫站是粉丝/辱追的投稿区，你只能围观和点开看评论</div>
                                </>
                            )}
                            {!isJiefu && cfg?.canPost && (
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
                                const opinionTag = currentRisk > 55 ? { text: "⚡ 粉圈在讨论", color: "#fb923c" } :
                                    currentRisk >= 5 ? { text: "🔍 有人扒料中", color: "#f472b6" } :
                                    currentRisk > 25 ? { text: "👀 有些奇怪风向", color: "#a855f7" } :
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
                                <div ref={kakaoEndRef} />
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
        // ========== 小号管理（可在 Twitter/TikTok/微博/ins 自主注册小号）==========
        if (activeModal === "sns" || activeModal === "altmanager") {
            const ALT_APPS = [
                { key: "twitter", name: "Twitter", icon: "𝕏" },
                { key: "tiktok", name: "TikTok", icon: "🎵" },
                { key: "weibo", name: "微博", icon: "🌊" },
                { key: "instagram", name: "Instagram", icon: "📷" }
            ];
            const anyReg = ALT_APPS.some(a => altAccounts[a.key]);
            const SNS_PRESETS = [
                { label: "🗡️ 发黑帖撕对家", text: "用小号发黑帖攻击对家爱豆，带节奏踩一捧一" },
                { label: "🧼 洗白自己", text: "用小号下场帮自己澄清黑料、引导风向洗白" },
                { label: "🔥 带节奏拱火", text: "用小号在热帖下拱火，把粉圈骂战搅得更大" },
                { label: "🤫 暗示恋情", text: "用小号暗戳戳暗示自己疑似恋爱，试探风向" }
            ];
            const doSns = (text) => { handleSNS(text); setSnsInput(""); };
            const toggleReg = (k) => {
                setAltAccounts(prev => ({ ...prev, [k]: !prev[k] }));
                if (k === "tiktok") setTiktokAlt(v => !v);
            };
            return (
                <div className="modal-overlay" onClick={() => setActiveModal(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3>🎭 小号管理</h3><button className="modal-close" onClick={() => setActiveModal(null)}>×</button></div>
                        <div style={{ padding: 16, overflowY: "auto" }}>
                            <div style={{ fontSize: 11, color: "#9d6db8", marginBottom: 12 }}>
                                在下面四个软件中自主选择是否注册小号。小号下场有风险，被扒出来暴露风险会飙升。当前风险 {currentRisk}%
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                                {ALT_APPS.map(a => (
                                    <div key={a.key} style={{ background: "#ffffff", borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
                                        <div style={{ fontSize: 22 }}>{a.icon}</div>
                                        <div style={{ color: "#4a1d5a", fontWeight: "bold", fontSize: 13 }}>{a.name}</div>
                                        <div style={{ fontSize: 10, color: altAccounts[a.key] ? "#10b981" : "#b88dc7" }}>{altAccounts[a.key] ? "✓ 已注册小号" : "未注册"}</div>
                                        <button className={altAccounts[a.key] ? "btn-secondary" : "btn-primary"} style={{ width: "100%", padding: "6px 0", fontSize: 12 }} onClick={() => toggleReg(a.key)}>
                                            {altAccounts[a.key] ? "注销小号" : "注册小号"}
                                        </button>
                                    </div>
                                ))}
                            </div>
                            {anyReg ? (
                                <>
                                    <div style={{ fontSize: 12, color: "#a855f7", fontWeight: "bold", marginBottom: 8 }}>🎭 用小号操作</div>
                                    {SNS_PRESETS.map((p, i) => (
                                        <button key={i} className="choice-btn" style={{ marginBottom: 8 }} onClick={() => doSns(p.text)}>{p.label}</button>
                                    ))}
                                    <textarea rows={3} placeholder="或自定义小号操作..." value={snsInput} onChange={e => setSnsInput(e.target.value)} style={{ width: "100%", background: "#ffffff", border: "1px solid #f3d5ed", borderRadius: 16, padding: 12, color: "#4a1d5a", marginTop: 8, marginBottom: 12 }} />
                                    <button className="btn-primary" style={{ width: "100%" }} onClick={() => { if (snsInput.trim()) doSns(snsInput.trim()); else alert("请选择或输入小号操作"); }}>🎭 用小号发布</button>
                                </>
                            ) : (
                                <div style={{ textAlign: "center", color: "#b88dc7", fontSize: 12, padding: "12px 0" }}>先在上面注册至少一个小号，才能下场操作。</div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }
        // ========== 商城（礼物已并入：商品 / 送礼 两个区）==========
        if (activeModal === "shop") {
            return (
                <div className="modal-overlay" onClick={() => setActiveModal(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3>🛒 商城 · 余额 {money}万</h3><button className="modal-close" onClick={() => setActiveModal(null)}>×</button></div>
                        <div style={{ padding: 16, overflowY: "auto" }}>
                            <div className="weverse-tabs" style={{ marginBottom: 12 }}>
                                <button className={`weverse-tab ${shopTab === "shop" ? "active" : ""}`} onClick={() => setShopTab("shop")}>🛒 商品</button>
                                <button className={`weverse-tab ${shopTab === "gift" ? "active" : ""}`} onClick={() => setShopTab("gift")}>🎁 送礼</button>
                            </div>
                            {shopTab === "shop" && SHOP_ITEMS.map(item => (
                                <div key={item.id} style={{ background: "#ffffff", borderRadius: 16, padding: 12, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div>
                                        <div style={{ color: "#4a1d5a", fontWeight: "bold" }}>{item.name}</div>
                                        <div style={{ fontSize: 11, color: "#9d6db8" }}>{item.desc}</div>
                                    </div>
                                    <button className="btn-secondary" onClick={() => handleBuy(item)}>💰 {item.price}万</button>
                                </div>
                            ))}
                            {shopTab === "gift" && (
                                <>
                                    <div style={{ marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                                        {FANS.map(fan => (
                                            <button key={fan.id} className="btn-secondary" style={{ fontSize: 12, border: selectedGiftFan?.id === fan.id ? "1px solid #d946a8" : "1px solid transparent" }} onClick={() => setSelectedGiftFan(fan)}>
                                                {fan.emoji} {fan.name}
                                            </button>
                                        ))}
                                    </div>
                                    {GIFT_ITEMS.map(gift => (
                                        <div key={gift.id} style={{ background: "#ffffff", borderRadius: 16, padding: 12, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                                            onClick={() => { if (!selectedGiftFan) return alert("请先在上方点击选择要送礼的大粉！"); handleSendGift(selectedGiftFan, gift); }}>
                                            <div>
                                                <div style={{ color: "#4a1d5a", fontWeight: "bold" }}>{gift.name}</div>
                                                <div style={{ fontSize: 11, color: "#9d6db8" }}>❤️+{gift.heartDelta}</div>
                                            </div>
                                            <div>💰 {gift.price}万</div>
                                        </div>
                                    ))}
                                </>
                            )}
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
                            {currentRisk >= 30 && !companyContract && (
                                <div>
                                    <div style={{ fontSize: 10, color: "#fb923c", textAlign: "center", marginBottom: 8 }}>
                                        ⚠️ 风险 {currentRisk}%，公司正在施压……
                                    </div>
                                    <button style={{ width: "100%", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)", color: "#f9a8d4", borderRadius: 16, padding: "10px 16px", cursor: "pointer", fontSize: 13 }}
                                        onClick={() => handleCompany("sign_contract")}>
                                        📋 签署"形象管理协议"（风险-15 但公司管控你）
                                    </button>
                                    <div style={{ fontSize: 10, color: "#b88dc7", textAlign: "center", marginTop: 6 }}>
                                        签约后暴露风险增长被压制，但公司会管控你的行程
                                    </div>
                                </div>
                            )}
                            {currentRisk >= 30 && companyContract && (
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
                                ⚠️ 可能需要付出代价，好感度可能下降
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        // ========== 日程表（玩家自定义早/中/晚行程） ==========
        if (activeModal === "calendar") {
            const todayRecord = scheduleMap[day];
            const lockedToday = !!todayRecord;  // 今天已确认结算 → 锁定不可再改
            const reusableRec = lockedToday ? null : findReusablePlan(); // 【V21】可一键沿用的最近日程
            return (
                <div className="modal-overlay" onClick={() => setActiveModal(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxHeight: "88vh", overflowY: "auto" }}>
                        <div className="modal-header"><h3>📅 今日日程 · 第 {day} 天</h3><button className="modal-close" onClick={() => setActiveModal(null)}>×</button></div>
                        <div style={{ padding: "4px 16px 0", color: "#9d6db8", fontSize: 12, textAlign: "center", lineHeight: 1.6 }}>
                            {lockedToday
                                ? "✅ 今日日程已结算（属性已到账，不消耗心力）"
                                : "安排上午 / 下午 / 晚上要做的事。点「结算」当场生效、不调剧情、不耗心力：训练累计 6 次兑换 +1 属性，营业 +人气，休息 +心力。"}
                        </div>

                        {/* 熟练度进度：让玩家看到离「兑换 +1」还差几次 */}
                        <div style={{ padding: "8px 16px 0" }}>
                            <div style={{ background: "rgba(217,70,168,0.06)", border: "1px solid rgba(217,70,168,0.15)", borderRadius: 12, padding: "8px 10px" }}>
                                <div style={{ fontSize: 11, color: "#a21caf", fontWeight: 600, marginBottom: 6 }}>🌱 熟练度（练满 {PROF_PER_LEVEL} 次兑换 +1 属性）</div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
                                    {PROF_TRACKS.map(t => {
                                        const v = Math.max(0, Math.min(PROF_PER_LEVEL, proficiency?.[t] ?? 0));
                                        return (
                                            <div key={t} style={{ fontSize: 10, color: "#7a3d8f" }}>
                                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                                                    <span>{PROF_TRACK_CN[t]}</span><span>{v}/{PROF_PER_LEVEL}</span>
                                                </div>
                                                <div style={{ height: 5, background: "rgba(217,70,168,0.12)", borderRadius: 4, overflow: "hidden" }}>
                                                    <div style={{ width: `${(v / PROF_PER_LEVEL) * 100}%`, height: "100%", background: "linear-gradient(90deg,#d946a8,#a855f7)" }} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* 三个时段选择 */}
                        <div style={{ padding: "12px 16px 4px" }}>
                            {SCHEDULE_SLOTS.map(slot => {
                                const chosenId = lockedToday ? todayRecord?.[slot.key] : dailyPlan[slot.key];
                                return (
                                    <div key={slot.key} style={{ marginBottom: 14 }}>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: "#4a1d5a", marginBottom: 6 }}>{slot.emoji} {slot.label}（{slot.desc}）</div>
                                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                                            {SCHEDULE_OPTIONS[slot.key].map(opt => {
                                                const active = chosenId === opt.id;
                                                return (
                                                    <button key={opt.id} disabled={lockedToday}
                                                        onClick={() => setDailyPlan(prev => ({ ...prev, [slot.key]: prev[slot.key] === opt.id ? null : opt.id }))}
                                                        style={{
                                                            textAlign: "left", padding: "8px 10px", borderRadius: 12, cursor: lockedToday ? "default" : "pointer",
                                                            border: active ? "1.5px solid #d946a8" : "1px solid rgba(217,70,168,0.18)",
                                                            background: active ? "linear-gradient(135deg,#fce7f3,#f3e8ff)" : "#fff",
                                                            opacity: lockedToday && !active ? 0.4 : 1
                                                        }}>
                                                        <div style={{ fontSize: 13, color: "#4a1d5a", fontWeight: 500 }}>{opt.emoji} {opt.name}</div>
                                                        <div style={{ fontSize: 10, color: "#9d6db8", marginTop: 2 }}>{opt.desc}</div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* 确认 / 已执行 */}
                        <div style={{ padding: "0 16px 12px" }}>
                            {lockedToday ? (
                                <div style={{ textAlign: "center", padding: "10px", borderRadius: 12, background: "rgba(74,222,128,0.12)", color: "#16a34a", fontSize: 13 }}>
                                    ✅ 今日日程已结算：{summarizeScheduleEntry(todayRecord)}
                                </div>
                            ) : (
                                <>
                                    <button className="btn-primary" style={{ width: "100%" }} onClick={confirmDailyPlan}>✅ 结算今日日程（直接生效 · 不耗心力）</button>
                                    {reusableRec && (
                                        <button className="btn-secondary" style={{ width: "100%", marginTop: 8 }}
                                            onClick={() => { if (reuseLastPlan()) setActiveModal(null); }}>
                                            ⚡ 一键沿用上次日程（{summarizeScheduleEntry(reusableRec)}）
                                        </button>
                                    )}
                                </>
                            )}
                        </div>

                        {/* 本月行程总览 */}
                        <div style={{ padding: "0 16px 4px", fontSize: 12, color: "#9d6db8", fontWeight: 600 }}>📆 本月行程总览</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, padding: "6px 16px 8px" }}>
                            {["一", "二", "三", "四", "五", "六", "日"].map(d => <div key={d} style={{ color: "#b88dc7", fontSize: 11, textAlign: "center" }}>{d}</div>)}
                            {Array.from({ length: 30 }, (_, i) => i + 1).map(d => {
                                const rec = scheduleMap[d];
                                const isToday = d === day;
                                const isPast = d < day;
                                // 今天若还没确认，用待安排的 dailyPlan 做预览
                                const summary = isToday && !rec ? summarizeScheduleEntry(dailyPlan) : summarizeScheduleEntry(rec);
                                return (
                                    <div key={d} onClick={() => alert(`第${d}天${isToday ? "（今天）" : isPast ? "（已过）" : "（未来）"}：\n${summary || "未安排"}`)}
                                        style={{ background: isToday ? "#d946a8" : (isPast ? "#e9d5ff" : "#ffffff"), borderRadius: 10, padding: "6px 4px", textAlign: "center", fontSize: 13, color: isToday ? "white" : "#4a1d5a", cursor: "pointer", border: rec && isPast ? "1px solid #a855f7" : "1px solid rgba(217,70,168,0.1)" }}>
                                        {d}
                                        <div style={{ fontSize: 6, marginTop: 2, color: isToday ? "#fff" : (isPast ? "#16a34a" : "#b88dc7"), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                            {summary ? summary.slice(0, 4) : ""}
                                        </div>
                                        {rec && isPast && <div style={{ fontSize: 5, color: "#16a34a" }}>✓</div>}
                                    </div>
                                );
                            })}
                        </div>
                        <div style={{ padding: "0 16px 16px", fontSize: 11, color: "#b88dc7", textAlign: "center" }}>
                            🔴 今天 · 🟪 已过去（✓ 已执行） · 点格子看当天安排
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
                                点击头像查看大粉详情 · 连线数值为好感度
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
            const 高好感人数 = Object.values(hearts).filter(v => v >= 80).length;
            const isSiegeRoute = isSingleTarget && 高好感人数 >= 2;
            
            // ===== 头衔生成系统 =====
            // 复合条件优先级判定
            const titles = [];
            if (isSiegeRoute) titles.push({ name: "💔 围剿玫瑰", desc: "你只爱一人，其余五位联手围剿了你" });
            else if (攻略人数 >= 5) titles.push({ name: "👑 六人女帝", desc: "六条船全部点亮，至高无上的时间管理之神" });
            else if (攻略人数 >= 4 && currentRisk <= 25) titles.push({ name: "🦊 隐秘大师", desc: "多线并行却滴水不漏，狗仔都拍不到你" });
            else if (currentRisk >= 80 && day <= 15) titles.push({ name: "💥 塌房艺术家", desc: `出道才${day}天就让组合面临解散，速度堪比流星` });
            else if (攻略人数 >= 5 && fandomHeat >= 70) titles.push({ name: "🍑 人间水蜜桃", desc: "你游走在六个姐夫之间，他们甚至为你建了应援站" });
            else if (攻略人数 === 1 && maxHeart >= 85) titles.push({ name: `💘 ${maxFan?.name || "他"}的小公主`, desc: "你放弃了所有人，他在某个深夜对你说：'我不想只是你的粉丝了'" });
            else if (attrs.人气值 >= 85 && 攻略人数 === 0) titles.push({ name: "😇 纯爱战士", desc: "一心搞事业的清流爱豆，粉圈最干净的那位" });
            else if (antiCount >= 70 && fandomHeat >= 70) titles.push({ name: "🔥 黑红流量", desc: "黑粉和真粉数量五五开，热搜常驻嘉宾" });
            else if (companyContract?.signed && companyContract.control >= 2) titles.push({ name: "🔗 公司爱将", desc: "签了重磅协议，安全但你的灵魂也被一并打包" });
            else if (attrs.人气值 < 40 && 攻略人数 >= 2) titles.push({ name: "🎣 私联大师", desc: "事业糊了但粉圈生态学满级，你才是真正的赢家" });
            else if (攻略人数 >= 3) titles.push({ name: "💅 时间管理大师", desc: "三线并行毫不慌张，姐夫们对你又恨又爱" });
            else if (攻略人数 >= 2) titles.push({ name: "🐟 初露锋芒", desc: "已经开始多线联系但还没完全展开，前途无量" });
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
                                    { label: "粉圈热度", value: fandomHeat, max: 100, color: "#ec4899" },
                                    { label: "暴露风险", value: currentRisk, max: 100, color: "#f472b6" },
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
                    char={char} currentRisk={currentRisk}
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
            {/* 【光夜变奏】时空扭曲跃迁过场（1.5s） */}
            {isWarping && (
                <div className="warp-overlay" aria-hidden="true">
                    <div className="warp-ring" /><div className="warp-ring r2" /><div className="warp-ring r3" />
                    <div className="warp-streaks">
                        {Array.from({ length: 12 }).map((_, i) => (
                            <div key={i} className="warp-streak" style={{ transform: `translate(-50%,0) rotate(${i * 30}deg)`, animationDelay: `${i * 0.02}s` }} />
                        ))}
                    </div>
                    <div className="warp-core" />
                    {warpTarget && (
                        <div className="warp-title">
                            <div className="wt-kicker">{warpTarget.code}</div>
                            <div className="wt-name">{warpTarget.name}</div>
                        </div>
                    )}
                </div>
            )}
            {/* 【观测次元】平行世界切换 */}
            {showWorldMap && (
                <div className="modal-overlay" onClick={() => setShowWorldMap(false)}>
                    <div className="modal-content modal-anim" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>🌌 观测次元</h3>
                            <button className="modal-close" onClick={() => setShowWorldMap(false)}>×</button>
                        </div>
                        <div className="worldmap-list">
                            {WORLDS.map(w => (
                                <div key={w.id}
                                    className={`world-card w-${w.id} ${currentWorld === w.id ? "active" : ""} ${w.unlocked ? "" : "locked"}`}
                                    onClick={() => {
                                        if (w.unlocked) { switchWorld(w.id); }
                                        else { vibrate(VIBE.riskUp); setToastMsg(`「${w.name}」序章筹备中，敬请期待`); setTimeout(() => setToastMsg(""), 2200); }
                                    }}>
                                    <div className="wc-glow" />
                                    <span className={`wc-status ${w.unlocked ? "on" : "off"}`}>{w.unlocked ? "已开启" : "筹备中"}</span>
                                    <div className="wc-code">{w.code}</div>
                                    <div className="wc-name">{w.name}</div>
                                    <div className="wc-desc">{w.tagline} · {w.desc}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
            {/* 【心动邂逅 · 彩蛋】完全独立于主线：只展示一段独处小剧场，不改任何主线数值 */}
            {showEncounter && (
                <div className="modal-overlay" onClick={closeEncounter}>
                    <div className="modal-content modal-anim" onClick={e => e.stopPropagation()} style={{ maxHeight: "88vh", overflowY: "auto" }}>
                        <div className="modal-header">
                            <h3>💗 心动邂逅 · {getWorld(currentWorld).name}</h3>
                            <button className="modal-close" onClick={closeEncounter}>×</button>
                        </div>

                        {/* ③ 已生成场景 / 生成中 / 生成失败 */}
                        {(encounterScene || encounterLoading || encounterError) ? (
                            <div style={{ padding: 18 }}>
                                {encounterLoading && (
                                    <div style={{ textAlign: "center", padding: "30px 0" }}>
                                        <div className="loading-spinner"><div className="spinner"></div></div>
                                        <div style={{ fontSize: 12, color: "#b88dc7", marginTop: 12 }}>
                                            正在和 {encounterFan?.name} 不期而遇……
                                        </div>
                                    </div>
                                )}
                                {encounterError && !encounterLoading && (
                                    <div style={{ textAlign: "center", padding: "24px 0" }}>
                                        <div style={{ fontSize: 30, marginBottom: 10 }}>🍃</div>
                                        <div style={{ fontSize: 13, color: "#9d6db8", marginBottom: 16 }}>{encounterError}</div>
                                        <button className="btn-secondary" style={{ width: "100%" }} onClick={() => { setEncounterError(null); }}>返回重选</button>
                                    </div>
                                )}
                                {encounterScene && !encounterLoading && (
                                    <>
                                        <div className="enc-chosen-fan" style={{ marginBottom: 12 }}>
                                            <span className="ecf-emoji">{encounterScene.fan.emoji}</span>
                                            <span className="ecf-name">{encounterScene.loc.emoji} {encounterScene.loc.title}</span>
                                        </div>
                                        <div style={{ fontSize: 13, color: "#4a1d5a", lineHeight: 1.95, whiteSpace: "pre-wrap" }}>
                                            {encounterScene.text}
                                        </div>
                                        <div style={{ fontSize: 10, color: "#b88dc7", textAlign: "center", margin: "16px 0 12px", lineHeight: 1.6 }}>
                                            ✨ 这是一段只属于你们的插曲——它不会改变主线剧情、天数或任何数值
                                        </div>
                                        <button className="btn-primary" style={{ width: "100%" }} onClick={closeEncounter}>收好这段回忆</button>
                                    </>
                                )}
                            </div>
                        ) : !encounterFan ? (
                            /* ① 选人 */
                            <>
                                <div className="encounter-intro">挑一位大粉，触发一场只属于你们的独处。<br/><span style={{ fontSize: 11, color: "#b88dc7" }}>每天每位大粉只有一次偶遇机会 · 纯彩蛋，不影响主线</span></div>
                                <div className="encounter-grid">
                                    {FANS.map(fan => {
                                        const used = isEncounterUsed(fan.id);
                                        return (
                                            <div key={fan.id} className="enc-fan" onClick={() => { if (used) { setToastMsg(`今天已和 ${fan.name} 偶遇过了`); setTimeout(() => setToastMsg(""), 2000); } else { setEncounterFan(fan); } }} style={used ? { opacity: 0.4, filter: "grayscale(1)" } : undefined}>
                                                <div className="enc-emoji" style={{ boxShadow: `0 0 20px -8px ${fan.color}` }}>{fan.emoji}</div>
                                                <div className="enc-name">{fan.name}{used && " ✓"}</div>
                                                <div className="enc-type">{used ? "今日已偶遇" : fan.type}</div>
                                                <div className="enc-heart">
                                                    <span>💕</span>
                                                    <div className="enc-heart-bar"><div style={{ width: `${hearts[fan.id]}%`, height: "100%", background: fan.color }} /></div>
                                                    <span>{hearts[fan.id]}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </>
                        ) : (
                            /* ② 选地点 */
                            <>
                                <button className="enc-back" onClick={() => setEncounterFan(null)}>‹ 换一位</button>
                                <div className="enc-chosen-fan">
                                    <span className="ecf-emoji">{encounterFan.emoji}</span>
                                    <span className="ecf-name">和 {encounterFan.name} 在哪里相遇？</span>
                                </div>
                                <div className="enc-locations">
                                    {getEncounterLocations(currentWorld).map((loc, i) => (
                                        <div key={i} className="enc-loc" onClick={() => startEncounter(encounterFan, loc)}>
                                            <span className="enc-loc-emoji">{loc.emoji}</span>
                                            <div>
                                                <div className="enc-loc-title">{loc.title}</div>
                                                <div className="enc-loc-sub">{loc.sub}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
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
            
            {/* 【结局系统】达成结局 → 展示结局正文与成就，玩家可选择继续剧情或结束本周目 */}
            {triggeredEnding && (
                <div className="modal-overlay" style={{ zIndex: 10001 }}>
                    <div className="modal-content modal-anim" onClick={e => e.stopPropagation()} style={{ maxWidth: 420, maxHeight: "88vh", overflowY: "auto" }}>
                        <div className="modal-header">
                            <h3>🎬 {triggeredEnding.type} · 结局达成</h3>
                        </div>
                        <div style={{ padding: 18 }}>
                            <h2 style={{ fontSize: 18, color: "#a855f7", marginBottom: 4 }}>{triggeredEnding.title}</h2>
                            <div style={{ fontSize: 11, color: "#b88dc7", marginBottom: 14 }}>【结局成就】{triggeredEnding.achievement}</div>
                            <div style={{ fontSize: 13, color: "#4a1d5a", lineHeight: 1.9, whiteSpace: "pre-wrap", marginBottom: 18 }}>{triggeredEnding.text}</div>
                            <div style={{ fontSize: 11, color: "#9d6db8", marginBottom: 12 }}>
                                已解锁结局：{endingsUnlocked.length} / {ENDINGS.length} · 第 {cycleCount + 1} 周目
                            </div>
                            <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                                <button className="btn-secondary" style={{ flex: 1 }} onClick={continueAfterEnding}>继续剧情</button>
                                <button className="btn-primary" style={{ flex: 1 }} onClick={endCurrentCycle}>结束本周目</button>
                            </div>
                            <button className="btn-secondary" style={{ width: "100%", fontSize: 12 }}
                                onClick={() => { setTriggeredEnding(null); setGalleryTab("endings"); setGalleryReading(null); setActiveModal("gallery"); }}>
                                🏆 查看结局图鉴 / 成就
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* 【每日总结】一天结束时弹出的当天总结卡 */}
            {dailySummary && (
                <div className="modal-overlay" onClick={enterNextDayFromSummary} style={{ zIndex: 10000 }}>
                    <div className="modal-content modal-anim" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
                        <div className="modal-header"><h3>🌙 第 {dailySummary.day} 天 · 每日总结</h3><button className="modal-close" onClick={enterNextDayFromSummary}>×</button></div>
                        <div style={{ padding: 18 }}>
                            <div style={{ fontSize: 13, color: "#4a1d5a", lineHeight: 1.7, whiteSpace: "pre-wrap", marginBottom: 14 }}>{dailySummary.text}</div>
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11, color: "#9d6db8" }}>
                                <span>⚡ 暴露风险 {dailySummary.risk}%</span>
                                <span>🔥 粉圈热度 {dailySummary.fandom}</span>
                            </div>
                            <button className="btn-primary" style={{ width: "100%", marginTop: 16 }} onClick={enterNextDayFromSummary}>📅 进入第 {dailySummary.day + 1} 天 · 安排日程</button>
                        </div>
                    </div>
                </div>
            )}
            {/* 顶部状态栏：天数 + 行动时间感 + 星期 + 心力（❤️ x/100，<20 黄，<10 红）*/}
            <div className="status-bar">
                <span className="time">DAY {day} · {dayPhaseFromActions(todayActions)} · {gameClock(day)}</span>
                <span className="time" style={{ marginLeft: 10, fontWeight: 700, color: mentalEnergy < MENTAL_MIN_TO_ACT ? "#ef4444" : mentalEnergy < MENTAL_WARN ? "#f59e0b" : "#ec4899" }}>
                    ❤️ {mentalEnergy}/{MENTAL_MAX}
                </span>
            </div>
            
            {/* 主头部：仅保留当前进行中的活动名（DAY 已上移到顶部时间） */}
            {currentEvent && (
                <div className="main-header">
                    <div className="sea-badge" style={{ background: "rgba(225,29,72,0.2)" }}>{currentEvent.name}</div>
                </div>
            )}
            
            {/* 风险标签（百分制 5 级） */}
            <div className={`risk-badge ${riskClass}`} style={{ margin: "0 16px 8px" }} title={`暴露风险：${currentRisk}%`}>
                {riskLevelInfo.star} {riskText} {currentRisk}%：{currentRisk >= 80 ? "全网审判，塌房级" : currentRisk >= 50 ? "大规模脱粉，需发声明" : currentRisk >= 20 ? "热贴讨论，公司介入" : currentRisk >= 5 ? "小范围讨论" : "无人察觉"}
            </div>
            
            {/* 【光夜变奏】非主世界预览提示（此时剧情与存档仍锚定常驻主世界，仅视觉换肤预览） */}
            {currentWorld !== "main" && (
                <div style={{ margin: "0 16px 10px", padding: "10px 14px", borderRadius: 14,
                    border: "1px solid var(--gold-line)", background: "var(--glass)",
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontSize: 11, color: "var(--gold)", lineHeight: 1.5 }}>
                        🌌 当前观测：{getWorld(currentWorld).name} · 序章筹备中（剧情与存档仍在主世界「璀璨人生」）
                    </span>
                    <button className="btn-secondary" style={{ flex: "0 0 auto", padding: "6px 12px" }}
                        onClick={() => switchWorld("main")}>返回主世界</button>
                </div>
            )}
            {/* 主内容区 */}
            {renderContent()}
            
            {/* 底部 Tab 栏：按需求删除「主线/手机/状态」（首页已有这三个入口），仅保留首页与偶遇 */}
            <div className="bottom-tabs">
                <button className={`tab-btn ${activeTab === "home" ? "active" : ""}`} onClick={() => setActiveTab("home")}>
                    <span>⌂</span><span>首页</span>
                </button>
                <button className={`tab-btn ${activeTab === "relation" ? "active" : ""}`} onClick={() => setActiveTab("relation")}>
                    <span>♡</span><span>偶遇</span>
                </button>
            </div>
            {/* 【观测次元】跃迁悬浮按钮（Dock 右上方） */}
            <button className="dock-warp" onClick={() => setShowWorldMap(true)} aria-label="观测次元 · 跃迁">🌌</button>
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
                <p style={{ color: "#9d6db8", fontSize: 13, marginBottom: 30 }}>终极完整版 · AI全生成 · 平行时空 · 大粉互撕 · 完整社交平台</p>
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
        // 需求：人气/国民度/时尚初始 30；资金初始 10 万；颜值固定；智商情商固定
        const randomAttrs = {
            人气值: 30,
            颜值: Math.floor(Math.random() * 21) + 55,
            国民度: 30,
            时尚度: 30,
            金钱值: 10,
            vocal: Math.floor(Math.random() * 31) + 55,
            dance: Math.floor(Math.random() * 31) + 55,
            rap: Math.floor(Math.random() * 31) + 45,
            iq: Math.floor(Math.random() * 21) + 70,
            eq: Math.floor(Math.random() * 21) + 65
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
                            unlocked: [],
                            currentStory: initStory, currentChoices: INIT_CHOICES, currentRisk: 0, suspicion: 0,
                            history: [initStory], schedules: {},
                            attrs: randomAttrs, money: 10,
                            fandomHeat: Math.floor(Math.random() * 41) + 30,   // 粉圈热度 30-70 随机
                            antiCount: Math.floor(Math.random() * 8) + 2,      // 黑粉占比 <10%
                            fanEmotions: initFanEmotions(),
                            altAccounts: { twitter: false, tiktok: false, weibo: false, instagram: false },
                            encounterUsed: {}, endingsUnlocked: [], achievementsUnlocked: [], cycleCount: 0,
                            // V20 熟练度/私联 + V22 心力/行动数：全新开局
                            proficiency: { vocal: 0, dance: 0, rap: 0, "时尚度": 0 },
                            lastTrainDay: {}, lastUnlockDay: 0, interactionCount: {}, schemaV20: true,
                            mentalEnergy: MENTAL_MAX, todayActions: 0, schemaV22: true,
                            activeEvents: [], currentSchedule: generateRandomSchedule(1),
                            scheduleMap: {}, dailyPlan: { morning: null, noon: null, evening: null },
                            dmReadStatus: {}, dmHistories: {}, dmMemory: {}, coupleExposure: null, socialFeeds: {},
                            paidDmDaily: { lastChatDate: null, messages: {}, thread: [] },
                            companyFavor: 60
                        };
                        saveGameToSlot(slotId, gameData);
                        syncToCloud(slotId, gameData);
                        onComplete(slotId, gameData);
                    }} className="btn-primary" style={{ width: "100%", padding: 14 }}>🎮 开启璀璨人生</button>
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


