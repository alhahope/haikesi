import { describe, expect, test } from "vitest";
import { rankCandidateAugments, type RecommendationInput } from "./recommendation";

const baseInput: RecommendationInput = {
  championId: "222",
  candidateIds: [],
  championRecommendations: {
    "222": [
      { augmentId: "crit-missile", rank: 1 },
      { augmentId: "dual-wield", rank: 2 },
      { augmentId: "infinity-edge", rank: 3 }
    ]
  },
  augments: {
    "crit-missile": {
      id: "crit-missile",
      name: "暴击飞弹",
      rarity: 1,
      tier: 3,
      iconUrl: "/crit.png",
      fitChampionIds: []
    },
    "tank-engine": {
      id: "tank-engine",
      name: "坦克引擎",
      rarity: 1,
      tier: 1,
      iconUrl: "/tank.png",
      fitChampionIds: []
    },
    "dual-wield": {
      id: "dual-wield",
      name: "双刀流",
      rarity: 2,
      tier: 2,
      iconUrl: "/dual.png",
      fitChampionIds: ["222"]
    },
    "same-tier-fit": {
      id: "same-tier-fit",
      name: "适配同层级",
      rarity: 0,
      tier: 2,
      iconUrl: "/fit.png",
      fitChampionIds: ["222"]
    },
    "same-tier-no-fit": {
      id: "same-tier-no-fit",
      name: "非适配同层级",
      rarity: 0,
      tier: 2,
      iconUrl: "/no-fit.png",
      fitChampionIds: []
    }
  }
};

describe("rankCandidateAugments", () => {
  test("prioritizes a champion-specific recommendation over a stronger global tier", () => {
    const ranked = rankCandidateAugments({
      ...baseInput,
      candidateIds: ["tank-engine", "crit-missile"]
    });

    expect(ranked.map((item) => item.augment.id)).toEqual([
      "crit-missile",
      "tank-engine"
    ]);
    expect(ranked[0].reasons.join(" ")).toContain("该英雄推荐第 1");
  });

  test("uses global tier as fallback when candidates are not champion recommendations", () => {
    const ranked = rankCandidateAugments({
      ...baseInput,
      candidateIds: ["same-tier-no-fit", "tank-engine"]
    });

    expect(ranked[0].augment.id).toBe("tank-engine");
    expect(ranked[0].reasons.join(" ")).toContain("全局强度 T1");
  });

  test("adds a champion-fit boost for globally suggested pairings", () => {
    const ranked = rankCandidateAugments({
      ...baseInput,
      championRecommendations: {},
      candidateIds: ["same-tier-no-fit", "same-tier-fit"]
    });

    expect(ranked[0].augment.id).toBe("same-tier-fit");
    expect(ranked[0].reasons.join(" ")).toContain("适配当前英雄");
  });

  test("keeps unknown candidate IDs visible but ranks them last", () => {
    const ranked = rankCandidateAugments({
      ...baseInput,
      candidateIds: ["unknown-augment", "tank-engine"]
    });

    expect(ranked[0].augment.id).toBe("tank-engine");
    expect(ranked[1].augment.id).toBe("unknown-augment");
    expect(ranked[1].reasons.join(" ")).toContain("未找到数据");
  });
});
