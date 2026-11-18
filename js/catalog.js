export const ACTIVITY_GROUPS = [
  ["Tại nhà", [
    ["home_idle", "Nghỉ ngơi", "🌿"], ["home_sleeping", "Đi ngủ", "☾"], ["home_morning", "Vệ sinh", "✿"],
    ["home_desk_work", "Làm việc ở nhà", "▤"], ["home_studying", "Học bài", "📖"],
    ["home_french_studying", "Học tiếng Pháp", "🇫🇷", "tbv"],
    ["home_cooking", "Nấu ăn", "♨"],
    ["home_eating", "Dùng bữa", "◈"], ["home_chores", "Dọn nhà", "✧"],
    ["home_bed_rot", "Thư giãn trên sofa", "▣"], ["home_gaming", "Chơi game", "✚"],
    ["home_nap", "Chợp mắt", "☽"],
    ["home_football", "Xem bóng đá", "⚽", "tbv"], ["home_play_with_cofi", "Chơi với Cofi", "🐾", "ppa"],
  ]],
  ["Chỗ làm", [
    ["work_locked_in", "Tập trung", "✦"], ["work_teaching", "Dạy học", "📚"], ["work_meeting", "Họp", "▥"],
    ["work_bored_staring", "Ngồi thẫn thờ", "·"], ["work_fake_working", "Lén xem điện thoại", "▣"],
    ["work_coffee_escape", "Nghỉ uống cà phê", "♨"], ["work_counting_down", "Đợi tan làm", "◷"],
  ]],
  ["Ngoài trời", [
    ["out_walking", "Đi bộ", "◇"], ["out_running", "Chạy bộ", "➜"],
    ["out_gym", "Tập tạ", "✚"], ["out_errand", "Ghé cửa hàng", "▦"],
    ["out_going_to_school", "Đi học", "🎒"],
    ["out_heading_home", "Về nhà lúc chạng vạng", "⌂"],
  ]],
  ["Đi chơi & đi xa", [
    ["social_cafe", "Hẹn ở quán cà phê", "♨"], ["social_dining", "Ăn ngoài", "◈"],
    ["travel_driving_long", "Lái xe đường dài", "➜"], ["travel_hometown", "Về quê", "⌂"],
    ["travel_thailand", "Đi chơi Thái Lan", "🇹🇭", "ppa"],
  ]],
];
const activities = ACTIVITY_GROUPS.flatMap(([, group]) => group);
export const ACTIVITY_TITLES = new Map(activities.map(([id, name]) => [id, name]));
export const ACTIVITY_IDS = new Set(ACTIVITY_TITLES.keys());
const activityProfiles = new Map(activities.map(([id, , , profile]) => [id, profile]));

export function canSelectActivity(user, activity) {
  const exclusiveProfile = activityProfiles.get(activity);
  return ACTIVITY_IDS.has(activity) && (exclusiveProfile === undefined || exclusiveProfile === user);
}

export const DAILY_QUESTS = [
  { id: "eat_veggies", title: "Ăn rau xanh", icon: "🥗", reward: 1 },
  { id: "early_shower", title: "Tắm sớm", icon: "🫧", reward: 1 },
  { id: "drink_water", title: "Uống nước ấm", icon: "🍵", reward: 1 },
  { id: "clean_desk", title: "Dọn bàn sạch sẽ", icon: "✨", reward: 1 },
  { id: "fresh_air", title: "Ra ngoài hít thở", icon: "🌿", reward: 1, hint: "Ở ngoài trời ít nhất 5 phút." },
  { id: "complete_5_notes", title: "Hoàn thành 5 ghi chú", icon: "☑", reward: 2, automatic: true, noteTarget: 5,
    hint: "Tự nhận khi tích đủ 5 việc trong sổ hôm nay." },
  { id: "hug_5s", title: "Ôm nhau 5 giây", icon: "🤗", reward: 2, pair: true },
  { id: "tbv_kiss_ppa", title: "TBV thơm má PPA", icon: "💋", reward: 2, pair: true },
  { id: "ppa_kiss_tbv", title: "PPA thơm má TBV", icon: "💋", reward: 2, pair: true },
];

export const BALANCE_VERSION = 2;
export const STAGE_GROWTH_DAY_CAP = 9;
export const STAGE_PROGRESSION_DAYS = 10;
export const STAGE_DAILY_INCREASES = [1, 1, 1, 1, 1, 1, 1, 1, 0];
export const STAGE_MAINTENANCE_RATIO = 0.85;

export const WATER_REWARDS = {
  sleep: { category: "sleep", minutes: null, reward: null, cap: 10, wakeOnly: true,
    tiers: [{ minutes: 420, reward: 5 }, { minutes: 480, reward: 10 }] },
  study: { category: "study", minutes: 40, reward: 8, cap: 20, pairGroup: "study" },
  focus: { category: "focus", minutes: 50, reward: 6, cap: 24, pairGroup: "work" },
  sport: { category: "sport", minutes: 30, reward: 10, cap: 20 },
  chores: { category: "chores", minutes: 30, reward: 4, cap: 8 },
};
export const WATER_ACTIVITY_MINUTES = { out_running: 30, out_gym: 20, home_cooking: 20, home_chores: 30 };
export const WATER_ACTIVITY_CATEGORIES = {
  home_sleeping: "sleep", home_studying: "study", home_french_studying: "study",
  home_desk_work: "focus", work_locked_in: "focus", work_teaching: "focus", office_focus_typing: "focus",
  out_running: "sport", out_gym: "sport", home_cooking: "chores", home_chores: "chores",
};

export const DAILY_WATER_MAX_BY_PROFILE = Object.fromEntries(["ppa", "tbv"].map(profile => {
  const activityMaximum = Object.entries(WATER_REWARDS).reduce((sum, [category, rule]) => {
    const eligibleCount = Object.entries(WATER_ACTIVITY_CATEGORIES)
      .filter(([activity, group]) => group === category && canSelectActivity(profile, activity)).length;
    const award = rule.pairGroup ? Math.ceil(rule.reward * 1.2) : rule.reward;
    return sum + Math.min(rule.cap, rule.wakeOnly ? rule.cap : eligibleCount * award);
  }, 0);
  return [profile, activityMaximum + DAILY_QUESTS.reduce((sum, quest) => sum + quest.reward, 0)];
}));
export const DAILY_WATER_MAX_PER_PROFILE = Math.max(...Object.values(DAILY_WATER_MAX_BY_PROFILE));
export const DAILY_WATER_MAX = Object.values(DAILY_WATER_MAX_BY_PROFILE).reduce((sum, maximum) => sum + maximum, 0);
export const STAGE_TARGETS = [62, 72, 82, 92, 102, 112, 122, 132, Math.ceil(DAILY_WATER_MAX * STAGE_MAINTENANCE_RATIO)];


const spriteRoot = new URL("../assets/sprites/", import.meta.url);

export function spriteURL(key) {
  if (/^bonsai_0[1-9]_(healthy|dry)$/.test(key)) {
    const level = Number(key.slice(7, 9));
    const variant = key.endsWith('_healthy') ? 'healthy' : 'dry';
    const suffix = key.endsWith("_healthy") ? "_strip" : "";
    const asset = level % 2 ? 'bonsai_stage_' + String((level + 1) / 2).padStart(2, '0')
      : 'bonsai_level_' + String(level).padStart(2, '0');
    return new URL('bonsai/' + asset + '_' + variant + suffix + '.png', spriteRoot).href;
  }
  const user = key.slice(0, 3);
  if (!["ppa", "tbv"].includes(user) || !canSelectActivity(user, key.slice(4))) return null;
  return new URL(user + "/" + key + "_sheet.png", spriteRoot).href;
}
