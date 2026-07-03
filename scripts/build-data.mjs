import { mkdir, writeFile } from "node:fs/promises";

const DDRAGON_VERSION_URL = "https://ddragon.leagueoflegends.com/api/versions.json";
const ARAMGG_HOME_URL = "https://aramgg.com/zh-CN";
const ARAMGG_AUGMENTS_URL = "https://aramgg.com/zh-CN/augments";
const CDRAGON_AUGMENTS_URL =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/zh_cn/v1/cherry-augments.json";
const CDRAGON_ASSET_BASE =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default";
const OUT_FILE = new URL("../src/data/generated/app-data.json", import.meta.url);

const responseText = async (url) => {
  const response = await fetch(url, {
    headers: {
      "user-agent": "hextech-aram-recommender/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
};

const responseJson = async (url) => JSON.parse(await responseText(url));

const rarityMap = {
  kSilver: 0,
  kGold: 1,
  kPrismatic: 2
};

async function main() {
  const versions = await responseJson(DDRAGON_VERSION_URL);
  const ddragonVersion = versions[0];
  const [championJson, aramHomeHtml, aramAugmentsHtml, cdragonAugments] =
    await Promise.all([
      responseJson(
        `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/data/zh_CN/champion.json`
      ),
      responseText(ARAMGG_HOME_URL),
      responseText(ARAMGG_AUGMENTS_URL),
      responseJson(CDRAGON_AUGMENTS_URL)
    ]);

  const champions = normalizeChampions(championJson, ddragonVersion);
  const championRecommendations = extractChampionRecommendations(aramHomeHtml);
  const tierByAugmentId = extractGlobalTiers(aramAugmentsHtml);
  const fitChampionIdsByAugmentId = extractFitChampionIds(aramAugmentsHtml);
  const recAugmentIds = new Set(
    Object.values(championRecommendations)
      .flat()
      .map((recommendation) => recommendation.augmentId)
  );
  const augmentIds = new Set([
    ...Object.keys(tierByAugmentId),
    ...Object.keys(fitChampionIdsByAugmentId),
    ...recAugmentIds
  ]);
  const augments = normalizeAugments({
    cdragonAugments,
    championRecommendations,
    augmentIds,
    tierByAugmentId,
    fitChampionIdsByAugmentId
  });

  const meta = {
    generatedAt: new Date().toISOString(),
    ddragonVersion,
    aramggPatch: extractFirstMatch(aramHomeHtml, /版本\s*(\d+\.\d+)/) ?? "unknown",
    aramggSnapshot:
      extractFirstMatch(aramHomeHtml, /当前数据：([^<"]+)/) ??
      extractFirstMatch(aramAugmentsHtml, /当前数据：([^<"]+)/) ??
      "unknown",
    sources: {
      champions: "Riot Data Dragon",
      recommendations: ARAMGG_HOME_URL,
      augmentTiers: ARAMGG_AUGMENTS_URL,
      augmentDefinitions: "CommunityDragon cherry-augments.json"
    }
  };

  const appData = {
    meta,
    champions,
    augments,
    championRecommendations
  };

  await mkdir(new URL("../src/data/generated/", import.meta.url), { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(appData, null, 2)}\n`);

  const recommendationCount = Object.values(championRecommendations).reduce(
    (sum, recommendations) => sum + recommendations.length,
    0
  );
  console.log(
    JSON.stringify(
      {
        champions: champions.length,
        augments: augments.length,
        recommendationChampions: Object.keys(championRecommendations).length,
        recommendations: recommendationCount,
        globalTieredAugments: Object.keys(tierByAugmentId).length,
        fitMappedAugments: Object.keys(fitChampionIdsByAugmentId).length,
        output: OUT_FILE.pathname
      },
      null,
      2
    )
  );
}

function normalizeChampions(championJson, ddragonVersion) {
  return Object.values(championJson.data)
    .map((champion) => ({
      id: String(champion.key),
      key: champion.id,
      name: `${champion.name} ${champion.title}`,
      shortName: champion.title,
      alias: champion.name,
      tags: champion.tags ?? [],
      iconUrl: `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${champion.image.full}`
    }))
    .sort((left, right) => Number(left.id) - Number(right.id));
}

function extractChampionRecommendations(html) {
  const anchor = html.indexOf('\\"222\\":[{\\"id\\":');
  if (anchor < 0) {
    throw new Error("Could not find champion recommendation map anchor");
  }
  const start = html.lastIndexOf('{\\"1\\":[', anchor);
  if (start < 0) {
    throw new Error("Could not find champion recommendation map start");
  }
  const recommendationMap = parseEscapedJsonObjectAt(html, start);
  return Object.fromEntries(
    Object.entries(recommendationMap).map(([championId, recommendations]) => [
      championId,
      recommendations.map((recommendation, index) => ({
        augmentId: String(recommendation.id),
        rank: index + 1
      }))
    ])
  );
}

function extractGlobalTiers(html) {
  const orderedIds = [];
  const hrefRegex = /href="\/zh-CN\/augments\/(\d+)"/g;
  let match;
  while ((match = hrefRegex.exec(html))) {
    if (!orderedIds.includes(match[1])) {
      orderedIds.push(match[1]);
    }
  }

  const tierCounts = [];
  const countRegex =
    /<span class="font-medium text-[^"]+">T(\d)<\/span><span class="text-muted-foreground text-sm">(\d+)个<\/span>/g;
  while ((match = countRegex.exec(html))) {
    tierCounts.push({ tier: Number(match[1]), count: Number(match[2]) });
  }

  const tierByAugmentId = {};
  let offset = 0;
  for (const group of tierCounts) {
    for (const augmentId of orderedIds.slice(offset, offset + group.count)) {
      tierByAugmentId[augmentId] = group.tier;
    }
    offset += group.count;
  }
  return tierByAugmentId;
}

function extractFitChampionIds(html) {
  const refByAugmentId = new Map();
  const entryRegex =
    /\[\\"(\d+)\\",\\"\$([0-9a-z]+)\\",\\"16\.\d+\\",\\"[^\\]+\\",\\"dummy\\"\]/g;
  let match;
  while ((match = entryRegex.exec(html))) {
    refByAugmentId.set(match[1], match[2]);
  }

  const fitChampionIdsByAugmentId = {};
  for (const [augmentId, ref] of refByAugmentId.entries()) {
    const refIndex = html.indexOf(`${ref}:`);
    if (refIndex < 0) continue;
    const start = html.indexOf("{", refIndex);
    if (start < 0) continue;
    try {
      const payload = parseEscapedJsonObjectAt(html, start);
      const championIds = (payload.top_champions ?? [])
        .slice(0, 8)
        .map((champion) => String(champion.champion_id));
      if (championIds.length > 0) {
        fitChampionIdsByAugmentId[augmentId] = championIds;
      }
    } catch {
      // Some RSC refs are not augment payloads; ignore them.
    }
  }
  return fitChampionIdsByAugmentId;
}

function normalizeAugments({
  cdragonAugments,
  championRecommendations,
  augmentIds,
  tierByAugmentId,
  fitChampionIdsByAugmentId
}) {
  const cdragonById = new Map();
  for (const augment of cdragonAugments) {
    const id = String(augment.id);
    if (!augment.nameTRA || !augment.augmentSmallIconPath) continue;
    if (!cdragonById.has(id)) {
      cdragonById.set(id, augment);
    }
  }

  const recommendationNameById = new Map();
  for (const recommendations of Object.values(championRecommendations)) {
    for (const recommendation of recommendations) {
      const source = findRecommendationSource(championRecommendations, recommendation.augmentId);
      if (source?.name) {
        recommendationNameById.set(recommendation.augmentId, source.name);
      }
    }
  }

  return [...augmentIds]
    .map((id) => {
      const source = cdragonById.get(id);
      const fallbackName = recommendationNameById.get(id) ?? `海克斯 ${id}`;
      const iconPath = source?.augmentSmallIconPath;
      return {
        id,
        name: source?.nameTRA ?? fallbackName,
        rarity: rarityMap[source?.rarity] ?? inferRarityFromRecommendations(championRecommendations, id),
        tier: tierByAugmentId[id],
        iconUrl: iconPath ? communityDragonIconUrl(iconPath) : "",
        fitChampionIds: fitChampionIdsByAugmentId[id] ?? []
      };
    })
    .sort((left, right) => {
      const leftTier = left.tier ?? 99;
      const rightTier = right.tier ?? 99;
      if (leftTier !== rightTier) return leftTier - rightTier;
      return left.name.localeCompare(right.name, "zh-CN");
    });
}

function findRecommendationSource(championRecommendations, augmentId) {
  for (const recommendations of Object.values(championRecommendations)) {
    const found = recommendations.find((recommendation) => recommendation.augmentId === augmentId);
    if (found) return found;
  }
  return undefined;
}

function inferRarityFromRecommendations(championRecommendations, augmentId) {
  for (const recommendations of Object.values(championRecommendations)) {
    const source = recommendations.find((recommendation) => recommendation.augmentId === augmentId);
    if (source?.rarity !== undefined) return source.rarity;
  }
  return 0;
}

function communityDragonIconUrl(iconPath) {
  return `${CDRAGON_ASSET_BASE}${iconPath
    .replace(/^\/lol-game-data\/assets\/assets/i, "/assets")
    .toLowerCase()}`;
}

function parseEscapedJsonObjectAt(text, start) {
  const end = findBalancedEnd(text, start);
  const escaped = text.slice(start, end);
  return JSON.parse(escaped.replace(/\\"/g, '"'));
}

function findBalancedEnd(text, start) {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  throw new Error(`Could not find balanced JSON object from ${start}`);
}

function extractFirstMatch(text, regex) {
  const match = text.match(regex);
  return match?.[1];
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
