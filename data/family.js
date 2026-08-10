/*
 * 陳氏家族 DEMO 族譜資料
 *
 * 這是一份虛構的示範資料，用於開發階段驗證資料模型與族譜圖呈現。
 * 姓名、年份、關係皆為捏造，與任何真實人物無關。
 *
 * 結構：
 *   people   個人屬性，不含房別——房別一律由譜系推導，不儲存。
 *   unions   婚姻，只有一種，因此不帶 type；子女不掛在此處。
 *   descents 親子關係，五種 kind 平等並列。
 *   bonds    同輩關係，目前僅契手足。
 *
 * 承繼房別的 kind 只有三種：親生、過繼、養子女。
 * 義子女與契子女畫線但不入房；契手足亦然。
 *
 * people 的陣列順序即族譜圖同一世代列中由左至右的排列順序，
 * 配偶刻意相鄰排列，再婚者（p1）置於兩位配偶之間。
 */
const FAMILY = {
  people: [
    // 第一代
    { id: "p2", name: "林氏", gender: "F", birth: "1895?", death: "1970", gen: 1 },
    { id: "p1", name: "陳阿土", gender: "M", birth: "1890", death: "1962-03-11", gen: 1 },
    { id: "p8", name: "黃阿葉", gender: "F", birth: "1902", death: "1981", gen: 1 },

    // 第二代
    { id: "p3", name: "陳文彬", gender: "M", birth: "1918", death: "1994-07-22", gen: 2 },
    { id: "p9", name: "王美雲", gender: "F", birth: "1922", death: "2001", gen: 2 },
    { id: "p4", name: "陳秀琴", gender: "F", birth: "1924", death: "2005", gen: 2 },
    { id: "p10", name: "張水木", gender: "M", birth: "1920", death: "1996", gen: 2 },
    { id: "p5", name: "陳文山", gender: "M", birth: "1930", death: "2012", gen: 2 },
    { id: "p6", name: "陳文德", gender: "M", birth: "1926", death: "2003", gen: 2 },
    // 異姓收養，入房並參與排行。
    { id: "p21", name: "陳阿海", gender: "M", birth: "1932", death: "2015", gen: 2 },
    // 結義，不入房。
    { id: "p22", name: "劉金水", gender: "M", birth: "1921", death: "1999", gen: 2 },

    // 第三代
    { id: "p11", name: "陳建國", gender: "M", birth: "1950", death: null, gen: 3 },
    { id: "p15", name: "吳雅婷", gender: "F", birth: "1954", death: null, gen: 3 },
    { id: "p12", name: "陳建民", gender: "M", birth: "1953", death: "2019-11-08", gen: 3 },
    { id: "p7", name: "陳淑芬", gender: "F", birth: "1951?", death: null, gen: 3 },
    { id: "p13", name: "張家豪", gender: "M", birth: "1955", death: null, gen: 3 },
    // 認乾親，不入房。
    { id: "p23", name: "何秀娟", gender: "F", birth: "1957", death: null, gen: 3 },
    // 與陳建國結為契兄弟，輩分不同但年齡相近。
    { id: "p24", name: "周文彥", gender: "M", birth: "1949", death: null, gen: 2 },

    // 第四代
    { id: "p16", name: "陳志明", gender: "M", birth: "1978-05-02", death: null, gen: 4 },
    { id: "p17", name: "陳志偉", gender: "M", birth: "1981", death: null, gen: 4 },
    { id: "p18", name: "陳雅雯", gender: "F", birth: "1984-09-14", death: null, gen: 4 },
    { id: "p19", name: "陳雅琪", gender: "F", birth: "1987", death: null, gen: 4 },
    { id: "p20", name: "陳冠廷", gender: "M", birth: "1990", death: null, gen: 4 },
    { id: "p14", name: "陳思妤", gender: "F", birth: "1993", death: null, gen: 4 }
  ],

  unions: [
    // 婚姻只有一種，因此不帶 type 欄位；子女記在 descents。
    { id: "u1", partners: ["p1", "p2"] },
    { id: "u2", partners: ["p1", "p8"] },
    { id: "u3", partners: ["p3", "p9"] },
    { id: "u4", partners: ["p4", "p10"] },
    { id: "u5", partners: ["p11", "p15"] }
  ],

  descents: [
    // 陳阿土的子女橫跨 u1 與 u2，排行合併計算：
    // 陳文彬 1918(1)、陳秀琴 1924(2)、陳文德 1926(3)、陳文山 1930(4)、陳阿海 1932(5)
    { union: "u1", child: "p3", kind: "親生" },
    { union: "u1", child: "p4", kind: "親生" },
    { union: "u1", child: "p6", kind: "過繼" },
    { union: "u2", child: "p5", kind: "親生" },
    { union: "u1", child: "p21", kind: "養子女" },

    // 不入房：結義與認乾親，畫線但不承繼宗族身分。
    { union: "u1", child: "p22", kind: "義子女" },
    { union: "u3", child: "p23", kind: "契子女" },

    { union: "u3", child: "p11", kind: "親生" },
    { union: "u3", child: "p12", kind: "親生" },
    { union: "u3", child: "p7", kind: "親生" },

    { union: "u4", child: "p13", kind: "親生" },

    { union: "u5", child: "p16", kind: "親生" },
    { union: "u5", child: "p17", kind: "親生" },
    { union: "u5", child: "p18", kind: "親生" },
    { union: "u5", child: "p19", kind: "親生" },
    { union: "u5", child: "p20", kind: "親生" },
    { union: "u5", child: "p14", kind: "親生" }
  ],

  bonds: [
    // 兩人 gen 不同（p24 為 2、p11 為 3），刻意保留以驗證跨輩分的契手足。
    { members: ["p24", "p11"], kind: "契手足" }
  ]
};
