export type AugmentRarity = 0 | 1 | 2;

export interface AugmentRecord {
  id: string;
  name: string;
  rarity: AugmentRarity;
  tier?: number;
  iconUrl: string;
  description?: string;
  fitChampionIds: string[];
}

export interface ChampionRecommendation {
  augmentId: string;
  rank: number;
}

export interface RecommendationInput {
  championId: string;
  candidateIds: string[];
  championRecommendations: Record<string, ChampionRecommendation[]>;
  augments: Record<string, AugmentRecord>;
}

export interface RankedAugment {
  augment: AugmentRecord;
  score: number;
  reasons: string[];
}

const TIER_POINTS: Record<number, number> = {
  1: 50,
  2: 42,
  3: 34,
  4: 26,
  5: 18
};

const RARITY_POINTS: Record<AugmentRarity, number> = {
  0: 2,
  1: 4,
  2: 6
};

export function rankCandidateAugments(input: RecommendationInput): RankedAugment[] {
  const championRecs = input.championRecommendations[input.championId] ?? [];
  const rankByAugment = new Map(
    championRecs.map((recommendation) => [
      recommendation.augmentId,
      recommendation.rank
    ])
  );

  return input.candidateIds
    .map((candidateId, index) =>
      scoreCandidate({
        candidateId,
        originalIndex: index,
        championId: input.championId,
        rankByAugment,
        augments: input.augments
      })
    )
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.originalIndex - right.originalIndex;
    })
    .map(({ originalIndex: _originalIndex, ...ranked }) => ranked);
}

function scoreCandidate(args: {
  candidateId: string;
  originalIndex: number;
  championId: string;
  rankByAugment: Map<string, number>;
  augments: Record<string, AugmentRecord>;
}): RankedAugment & { originalIndex: number } {
  const augment = args.augments[args.candidateId] ?? {
    id: args.candidateId,
    name: args.candidateId,
    rarity: 0 as AugmentRarity,
    iconUrl: "",
    fitChampionIds: []
  };

  if (!args.augments[args.candidateId]) {
    return {
      augment,
      score: -100,
      reasons: ["未找到数据，只作为兜底候选显示"],
      originalIndex: args.originalIndex
    };
  }

  let score = 0;
  const reasons: string[] = [];
  const championRank = args.rankByAugment.get(args.candidateId);

  if (championRank !== undefined) {
    const points = Math.max(52, 112 - championRank * 12);
    score += points;
    reasons.push(`该英雄推荐第 ${championRank}`);
  }

  if (augment.tier !== undefined) {
    score += TIER_POINTS[augment.tier] ?? 8;
    reasons.push(`全局强度 T${augment.tier}`);
  }

  if (augment.fitChampionIds.includes(args.championId)) {
    score += 18;
    reasons.push("海克斯榜标记为适配当前英雄");
  }

  score += RARITY_POINTS[augment.rarity];
  reasons.push(`${rarityLabel(augment.rarity)}海克斯`);

  if (reasons.length === 1) {
    reasons.unshift("没有英雄专属推荐记录，按通用强度兜底");
  }

  return {
    augment,
    score,
    reasons,
    originalIndex: args.originalIndex
  };
}

export function rarityLabel(rarity: AugmentRarity): string {
  if (rarity === 2) return "棱彩";
  if (rarity === 1) return "黄金";
  return "白银";
}
