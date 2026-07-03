import { Search, ShoppingBag, Sparkles, Star, X } from "lucide-react";
import { useMemo, useState } from "react";
import appData from "./data/generated/app-data.json";
import {
  rankCandidateAugments,
  rarityLabel,
  type AugmentRecord
} from "./lib/recommendation";

interface ChampionRecord {
  id: string;
  key: string;
  name: string;
  shortName: string;
  alias: string;
  tags: string[];
  iconUrl: string;
}

interface ItemRecord {
  id: string;
  name: string;
  iconUrl: string;
}

interface CoreItemSet {
  items: ItemRecord[];
  games: number;
  winRate: number;
  pickRate: number;
}

interface ChampionBuildVariant {
  patch: string;
  tags: string[];
  games: number;
  winRate: number;
  pickRate: number;
  coreItems: CoreItemSet[];
  startingItems: ItemRecord[];
  situationalItems: ItemRecord[];
}

interface ChampionBuildSummaryRecord {
  latestPatch: string;
  builds: ChampionBuildVariant[];
}

const data = appData as {
  meta: {
    generatedAt: string;
    ddragonVersion: string;
    aramggPatch: string;
    aramggSnapshot: string;
  };
  champions: ChampionRecord[];
  augments: AugmentRecord[];
  championRecommendations: Record<string, { augmentId: string; rank: number }[]>;
  championBuilds: Record<string, ChampionBuildSummaryRecord>;
};

const augmentById = Object.fromEntries(
  data.augments.map((augment) => [augment.id, augment])
);

const defaultChampionId =
  data.champions.find((champion) => champion.id === "222")?.id ??
  data.champions[0]?.id ??
  "";

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function matchesChampion(champion: ChampionRecord, query: string) {
  const normalized = normalizeSearch(query);
  if (!normalized) return true;
  return [champion.name, champion.shortName, champion.alias, champion.key, champion.id]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

function matchesAugment(augment: AugmentRecord, query: string) {
  const normalized = normalizeSearch(query);
  if (!normalized) return true;
  return [augment.name, augment.id].join(" ").toLowerCase().includes(normalized);
}

function formatPercent(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "暂无";
  return `${(value * 100).toFixed(1)}%`;
}

function formatCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "暂无";
  return Math.round(value).toLocaleString("zh-CN");
}

export default function App() {
  const [championQuery, setChampionQuery] = useState("");
  const [augmentQuery, setAugmentQuery] = useState("");
  const [selectedChampionId, setSelectedChampionId] = useState(defaultChampionId);
  const [candidateIds, setCandidateIds] = useState<string[]>([]);

  const selectedChampion = data.champions.find(
    (champion) => champion.id === selectedChampionId
  );

  const championRecommendations =
    data.championRecommendations[selectedChampionId] ?? [];
  const championBuild = data.championBuilds[selectedChampionId];

  const recommendedAugments = championRecommendations
    .map((recommendation) => ({
      recommendation,
      augment: augmentById[recommendation.augmentId]
    }))
    .filter((entry) => entry.augment);

  const filteredChampions = useMemo(() => {
    return data.champions.filter((champion) => matchesChampion(champion, championQuery));
  }, [championQuery]);

  const filteredAugments = useMemo(() => {
    const selected = new Set(candidateIds);
    return data.augments
      .filter((augment) => !selected.has(augment.id))
      .filter((augment) => matchesAugment(augment, augmentQuery))
      .slice(0, 36);
  }, [augmentQuery, candidateIds]);

  const rankedCandidates = useMemo(() => {
    return rankCandidateAugments({
      championId: selectedChampionId,
      candidateIds,
      championRecommendations: data.championRecommendations,
      augments: augmentById
    });
  }, [candidateIds, selectedChampionId]);

  function selectChampion(championId: string) {
    setSelectedChampionId(championId);
    setChampionQuery("");
    setCandidateIds([]);
  }

  function addCandidate(augmentId: string) {
    setCandidateIds((current) => {
      if (current.includes(augmentId) || current.length >= 3) return current;
      return [...current, augmentId];
    });
    setAugmentQuery("");
  }

  function removeCandidate(augmentId: string) {
    setCandidateIds((current) => current.filter((id) => id !== augmentId));
  }

  function clearCandidates() {
    setCandidateIds([]);
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">ARAM: Mayhem</p>
          <h1>海克斯大乱斗推荐助手</h1>
        </div>
        <div className="meta-block">
          <span>版本 {data.meta.aramggPatch}</span>
          <span>{data.augments.length} 海克斯</span>
          <span>{data.champions.length} 英雄</span>
        </div>
      </header>

      <section className="tool-grid">
        <section className="panel champion-panel">
          <div className="panel-heading">
            <h2>英雄</h2>
            <label className="search-field">
              <Search size={16} aria-hidden="true" />
              <input
                value={championQuery}
                onChange={(event) => setChampionQuery(event.target.value)}
                placeholder="搜索英雄"
              />
            </label>
          </div>

          <div className="champion-grid" aria-label="英雄列表">
            {filteredChampions.map((champion) => (
              <button
                key={champion.id}
                className={
                  champion.id === selectedChampionId
                    ? "champion-tile is-selected"
                    : "champion-tile"
                }
                onClick={() => selectChampion(champion.id)}
                title={champion.name}
              >
                <img src={champion.iconUrl} alt={champion.name} />
                <span>{champion.shortName}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel focus-panel">
          {selectedChampion ? (
            <div className="selected-champion">
              <img src={selectedChampion.iconUrl} alt={selectedChampion.name} />
              <div>
                <h2>{selectedChampion.name}</h2>
                <div className="tag-row">
                  {selectedChampion.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          <BuildPanel build={championBuild} />

          <div className="section-title">
            <Star size={18} aria-hidden="true" />
            <h3>英雄推荐</h3>
          </div>
          <div className="augment-list">
            {recommendedAugments.map(({ recommendation, augment }) => (
              <AugmentCard
                key={augment.id}
                augment={augment}
                badge={`#${recommendation.rank}`}
                onClick={() => addCandidate(augment.id)}
              />
            ))}
          </div>
        </section>

        <section className="panel candidate-panel">
          <div className="panel-heading">
            <h2>本轮候选</h2>
            <button className="icon-command" onClick={clearCandidates} title="清空候选">
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="candidate-slots">
            {[0, 1, 2].map((slot) => {
              const augment = candidateIds[slot] ? augmentById[candidateIds[slot]] : undefined;
              return augment ? (
                <button
                  className="candidate-slot filled"
                  key={slot}
                  onClick={() => removeCandidate(augment.id)}
                  title="移除"
                >
                  <img src={augment.iconUrl} alt={augment.name} />
                  <span>{augment.name}</span>
                  <X size={14} aria-hidden="true" />
                </button>
              ) : (
                <div className="candidate-slot empty" key={slot}>
                  <span>{slot + 1}</span>
                </div>
              );
            })}
          </div>

          <label className="search-field augment-search">
            <Search size={16} aria-hidden="true" />
            <input
              value={augmentQuery}
              onChange={(event) => setAugmentQuery(event.target.value)}
              placeholder="搜索海克斯"
            />
          </label>

          <div className="augment-picker" aria-label="海克斯列表">
            {filteredAugments.map((augment) => (
              <AugmentCard
                key={augment.id}
                augment={augment}
                compact
                onClick={() => addCandidate(augment.id)}
              />
            ))}
          </div>
        </section>
      </section>

      <section className="result-panel">
        <div className="section-title">
          <Sparkles size={18} aria-hidden="true" />
          <h2>推荐排序</h2>
        </div>
        {rankedCandidates.length > 0 ? (
          <div className="ranking-list">
            {rankedCandidates.map((ranked, index) => (
              <article
                className={index === 0 ? "rank-card best" : "rank-card"}
                key={ranked.augment.id}
              >
                <div className="rank-number">{index + 1}</div>
                <img src={ranked.augment.iconUrl} alt={ranked.augment.name} />
                <div className="rank-body">
                  <h3>{ranked.augment.name}</h3>
                  <p>{ranked.reasons.join("；")}</p>
                </div>
                <div className="score-pill">{ranked.score}</div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-result">选择 1-3 个候选海克斯后显示排序</div>
        )}
      </section>

      <footer className="source-line">
        <span>{data.meta.aramggSnapshot}</span>
        <span>英雄：Data Dragon {data.meta.ddragonVersion}</span>
        <span>推荐与层级：aramgg / CommunityDragon</span>
      </footer>
    </main>
  );
}

function AugmentCard({
  augment,
  badge,
  compact = false,
  onClick
}: {
  augment: AugmentRecord;
  badge?: string;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={compact ? "augment-card compact" : "augment-card"} onClick={onClick}>
      <img src={augment.iconUrl} alt={augment.name} />
      <span className="augment-name">{augment.name}</span>
      <span className={`rarity rarity-${augment.rarity}`}>{rarityLabel(augment.rarity)}</span>
      {augment.tier ? <span className="tier-pill">T{augment.tier}</span> : null}
      {badge ? <span className="rank-badge">{badge}</span> : null}
    </button>
  );
}

function BuildPanel({ build }: { build?: ChampionBuildSummaryRecord }) {
  const primaryBuild = build?.builds[0];
  const primaryCore = primaryBuild?.coreItems[0];

  return (
    <section className="build-panel" aria-label="推荐出装">
      <div className="section-title">
        <ShoppingBag size={18} aria-hidden="true" />
        <h3>推荐出装</h3>
      </div>

      {primaryBuild && primaryCore ? (
        <>
          <div className="build-meta">
            <div className="tag-row">
              {primaryBuild.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
            <span>版本 {build?.latestPatch || primaryBuild.patch}</span>
          </div>

          <div className="core-build">
            <div>
              <p className="build-label">核心三件套</p>
              <ItemRow items={primaryCore.items} />
            </div>
            <div className="build-stats">
              <span>胜率 {formatPercent(primaryCore.winRate)}</span>
              <span>选取 {formatPercent(primaryCore.pickRate)}</span>
              <span>样本 {formatCount(primaryCore.games)}</span>
            </div>
          </div>

          {primaryBuild.coreItems.length > 1 ? (
            <div className="alt-builds">
              {primaryBuild.coreItems.slice(1).map((coreItem, index) => (
                <div className="alt-build" key={`${coreItem.items.map((item) => item.id).join("-")}-${index}`}>
                  <span>#{index + 2}</span>
                  <ItemRow items={coreItem.items} compact />
                  <span>{formatPercent(coreItem.winRate)}</span>
                </div>
              ))}
            </div>
          ) : null}

          <BuildItemGroup title="出门装" items={primaryBuild.startingItems} />
          <BuildItemGroup title="情境装备" items={primaryBuild.situationalItems} />
        </>
      ) : (
        <div className="build-empty">暂无出装数据</div>
      )}
    </section>
  );
}

function BuildItemGroup({ title, items }: { title: string; items: ItemRecord[] }) {
  if (!items.length) return null;

  return (
    <div className="build-group">
      <p className="build-label">{title}</p>
      <ItemRow items={items} compact />
    </div>
  );
}

function ItemRow({ items, compact = false }: { items: ItemRecord[]; compact?: boolean }) {
  return (
    <div className={compact ? "item-row compact" : "item-row"}>
      {items.map((item, index) => (
        <span className="item-chip" key={`${item.id}-${index}`} title={item.name}>
          <img src={item.iconUrl} alt={item.name} />
          <span>{item.name}</span>
        </span>
      ))}
    </div>
  );
}
