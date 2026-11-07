export const ACTIVITY_GROUPS = [
  ["Tại nhà", [
    ["home_idle", "Nghỉ ngơi", "🌿"], ["home_sleeping", "Đi ngủ", "☾"], ["home_morning", "Vệ sinh", "✿"],
    ["home_desk_work", "Làm việc ở nhà", "▤"], ["home_studying", "Học bài", "📖"],
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
    ["out_heading_home", "Về nhà lúc chạng vạng", "⌂"],
  ]],
  ["Đi chơi & đi xa", [
    ["social_cafe", "Hẹn ở quán cà phê", "♨"], ["social_dining", "Ăn ngoài", "◈"],
    ["travel_driving_long", "Lái xe đường dài", "➜"], ["travel_hometown", "Về quê", "⌂"],
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
  { id: "hug_5s", title: "Ôm nhau 5 giây", icon: "🤗", reward: 2, pair: true },
  { id: "tbv_kiss_ppa", title: "TBV thơm má PPA", icon: "💋", reward: 2, pair: true },
  { id: "ppa_kiss_tbv", title: "PPA thơm má TBV", icon: "💋", reward: 2, pair: true },
];


const spriteRoot = new URL("../assets/sprites/", import.meta.url);

export function spriteURL(key) {
  if (/^bonsai_0[1-5]_(healthy|dry)$/.test(key)) {
    const suffix = key.endsWith("_healthy") ? "_strip" : "";
    return new URL("bonsai/" + key.replace("bonsai_", "bonsai_stage_") + suffix + ".png", spriteRoot).href;
  }
  const user = key.slice(0, 3);
  if (!["ppa", "tbv"].includes(user) || !canSelectActivity(user, key.slice(4))) return null;
  return new URL(user + "/" + key + "_sheet.png", spriteRoot).href;
}
