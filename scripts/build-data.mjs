import { mkdir, writeFile } from "node:fs/promises";

const DDRAGON_VERSION_URL = "https://ddragon.leagueoflegends.com/api/versions.json";
const ARAMGG_HOME_URL = "https://aramgg.com/zh-CN";
const ARAMGG_AUGMENTS_URL = "https://aramgg.com/zh-CN/augments";
const OPGG_ARAM_MAYHEM_URL = "https://op.gg/zh-cn/lol/modes/aram-mayhem";
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
  const [
    championJson,
    itemJson,
    aramHomeHtml,
    aramAugmentsHtml,
    opggAramMayhemHtml,
    cdragonAugments
  ] =
    await Promise.all([
      responseJson(
        `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/data/zh_CN/champion.json`
      ),
      responseJson(
        `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/data/zh_CN/item.json`
      ),
      responseText(ARAMGG_HOME_URL),
      responseText(ARAMGG_AUGMENTS_URL),
      responseText(OPGG_ARAM_MAYHEM_URL),
      responseJson(CDRAGON_AUGMENTS_URL)
    ]);

  const champions = normalizeChampions(championJson, ddragonVersion);
  const itemLookup = normalizeItems(itemJson, ddragonVersion);
  const championRecommendations = extractChampionRecommendations(aramHomeHtml);
  const tierByAugmentId = extractGlobalTiers(aramAugmentsHtml);
  const fitChampionIdsByAugmentId = extractFitChampionIds(aramAugmentsHtml);
  const championBuilds = await fetchChampionBuilds(
    champions,
    itemLookup,
    opggAramMayhemHtml
  );
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
      itemBuilds: `${OPGG_ARAM_MAYHEM_URL}/{championSlug}/build`,
      itemDefinitions: "Riot Data Dragon item.json",
      augmentDefinitions: "CommunityDragon cherry-augments.json"
    }
  };

  const appData = {
    meta,
    champions,
    augments,
    championRecommendations,
    championBuilds
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
        itemBuildChampions: Object.keys(championBuilds).length,
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

function normalizeItems(itemJson, ddragonVersion) {
  const byId = {};
  const byName = new Map();

  for (const [id, item] of Object.entries(itemJson.data)) {
    if (!item.name) continue;
    const record = {
      id: String(id),
      name: item.name,
      iconUrl: `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/item/${item.image?.full ?? `${id}.png`}`
    };
    byId[record.id] = record;
    if (!byName.has(record.name)) {
      byName.set(record.name, record);
    }
  }

  return { byId, byName, ddragonVersion };
}

async function fetchChampionBuilds(champions, itemLookup, opggAramMayhemHtml) {
  const slugByChampionId = extractOpggChampionSlugs(opggAramMayhemHtml);
  const entries = [];
  const queue = [...champions];
  const workerCount = 8;

  async function worker() {
    while (queue.length > 0) {
      const champion = queue.shift();
      if (!champion) continue;
      const slug = slugByChampionId[champion.id] ?? champion.key.toLowerCase();
      try {
        const sourceUrl = `${OPGG_ARAM_MAYHEM_URL}/${slug}/build`;
        const html = await responseText(sourceUrl);
        const normalized = extractOpggBuildSummary(html, sourceUrl, itemLookup);
        if (normalized?.builds.length) {
          entries.push([champion.id, normalized]);
        }
      } catch (error) {
        console.warn(`Skipping item build for champion ${champion.id}: ${error.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return Object.fromEntries(entries.sort(([left], [right]) => Number(left) - Number(right)));
}

function extractOpggChampionSlugs(html) {
  const slugByChampionId = {};
  const regex = /\\"key\\":\\"([^\\]+)\\".*?\\"champion_id\\":(\d+)/g;
  let match;
  while ((match = regex.exec(html))) {
    slugByChampionId[String(match[2])] = match[1];
  }
  return slugByChampionId;
}

function extractOpggBuildSummary(html, sourceUrl, itemLookup) {
  const coreRows = extractOpggItemRows(extractTableByCaption(html, "Builds Table"));
  if (coreRows.length === 0) return undefined;

  const patch =
    extractFirstMatch(html, /meta\/images\/lol\/([0-9.]+)\/item\//) ??
    extractFirstMatch(html, /通过([0-9.]+)版本最佳/) ??
    "";
  const startingRows = extractOpggItemRows(extractTableByCaption(html, "Items Table"));
  const bootRows = extractOpggItemRows(extractTableByCaption(html, "Boots Table"));

  return {
    latestPatch: patch,
    source: "OP.GG ARAM: Mayhem",
    sourceUrl,
    builds: [
      {
        patch,
        tags: ["ARAM: Mayhem"],
        games: 0,
        winRate: 0,
        pickRate: 0,
        coreItems: coreRows.slice(0, 6).map((items) => ({
          items: items.map((item) => normalizeItemReference(item.id, item.name, itemLookup, item.iconUrl)),
          games: 0,
          winRate: 0,
          pickRate: 0
        })),
        startingItems: (startingRows[0] ?? [])
          .map((item) => normalizeItemReference(item.id, item.name, itemLookup, item.iconUrl))
          .slice(0, 6),
        situationalItems: bootRows
          .flat()
          .map((item) => normalizeItemReference(item.id, item.name, itemLookup, item.iconUrl))
          .slice(0, 8)
      }
    ]
  };
}

function extractTableByCaption(html, caption) {
  const captionIndex = html.indexOf(`<caption>${caption}</caption>`);
  if (captionIndex < 0) return "";
  const tableStart = html.lastIndexOf("<table", captionIndex);
  const tableEnd = html.indexOf("</table>", captionIndex);
  if (tableStart < 0 || tableEnd < 0) return "";
  return html.slice(tableStart, tableEnd + "</table>".length);
}

function extractOpggItemRows(tableHtml) {
  if (!tableHtml) return [];
  const rows = [];
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/g;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(tableHtml))) {
    const items = [];
    const imageRegex =
      /<img\s+alt="([^"]+)"[^>]+src="([^"]*\/item\/(\d+)\.png[^"]*)"/g;
    let imageMatch;
    while ((imageMatch = imageRegex.exec(rowMatch[1]))) {
      items.push({
        id: imageMatch[3],
        name: decodeHtml(imageMatch[1]),
        iconUrl: decodeHtml(imageMatch[2])
      });
    }
    if (items.length > 0) rows.push(items);
  }
  return rows;
}

function normalizeItemSequence(itemIds = [], itemNames = [], itemLookup) {
  const length = Math.max(itemIds.length, itemNames.length);
  return Array.from({ length }, (_, index) =>
    normalizeItemReference(itemIds[index], itemNames[index], itemLookup)
  ).filter((item) => item.name);
}

function normalizeItemReference(itemId, itemName, itemLookup, sourceIconUrl = "") {
  const id = itemId === undefined || itemId === null ? "" : String(itemId);
  const name = itemName === undefined || itemName === null ? "" : String(itemName);
  const byId = id ? itemLookup.byId[id] : undefined;
  const byName = name ? itemLookup.byName.get(name) : undefined;
  const resolvedId = byId?.id ?? byName?.id ?? id;

  return {
    id: resolvedId || name,
    name: byId?.name ?? byName?.name ?? name ?? (resolvedId ? `装备 ${resolvedId}` : ""),
    iconUrl:
      byId?.iconUrl ??
      byName?.iconUrl ??
      (sourceIconUrl ||
      (resolvedId
        ? `https://ddragon.leagueoflegends.com/cdn/${itemLookup.ddragonVersion}/img/item/${resolvedId}.png`
        : ""))
  };
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

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
