/**
 * 成活率预警派生 hook
 * 汇总「最新验收成活率低于告警线」的地块，并标出是否已有未完成补植计划。
 * 订阅地块 / 栽植 / 验收 / 补植四张表，验收与补植任一变化都会即时刷新；
 * 这里只做纯派生，所有写库动作收口在 surveyStore。
 */
import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import type { Plot } from '../types/plot';
import type { Planting } from '../types/planting';
import type { Survey } from '../types/survey';
import type { Replant } from '../types/replant';
import { db, initDatabase } from '../utils/db';
import { SURVIVAL_WARN_RATE, suggestReplantCount } from '../utils/rate';
import { buildSurvivalSummary } from './useSurvivalRate';

/** 未完成补植计划：尚未推进到最终状态（已复核）的计划 */
export function isReplantPending(state: Replant['state']): boolean {
  return state !== '已复核';
}

/** 一行预警卡片数据 */
export interface SurvivalWarning {
  plotId: string;
  /** 地块名 */
  plotName: string;
  /** 最新测次（第 N 次） */
  latestRound: number;
  /** 最新验收日期 YYYY-MM-DD */
  latestDate: string;
  /** 最新成活率（%） */
  latestRate: number;
  /** 缺株数（株）——按最新测次的栽植总株数 - 成活株数派生 */
  missingCount: number;
  /** 建议补植株数（株） */
  suggestReplant: number;
  /** 已有未完成（待补植 / 已补植）补植计划，默认跳过生成 */
  hasPendingReplant: boolean;
  /** 未完成补植计划条数 */
  pendingReplantCount: number;
}

/** 纯函数：由四张表的行集合派生预警地块，按成活率从低到高排序 */
export function buildSurvivalWarnings(
  plots: Plot[],
  surveys: Survey[],
  plantings: Planting[],
  replants: Replant[],
  threshold: number = SURVIVAL_WARN_RATE,
): SurvivalWarning[] {
  const pendingByPlot = new Map<string, number>();
  for (const row of replants) {
    if (isReplantPending(row.state)) {
      pendingByPlot.set(row.plotId, (pendingByPlot.get(row.plotId) ?? 0) + 1);
    }
  }

  const warnings: SurvivalWarning[] = [];
  for (const plot of plots) {
    const summary = buildSurvivalSummary(plot.id, surveys, plantings, threshold);
    if (summary.latest === null || !summary.warn) continue;
    const missing = suggestReplantCount(summary.totalCount, summary.latest.aliveCount);
    const pendingCount = pendingByPlot.get(plot.id) ?? 0;
    warnings.push({
      plotId: plot.id,
      plotName: plot.name,
      latestRound: summary.latest.round,
      latestDate: summary.latest.date,
      latestRate: summary.latestRate,
      missingCount: missing,
      suggestReplant: summary.suggestReplant,
      hasPendingReplant: pendingCount > 0,
      pendingReplantCount: pendingCount,
    });
  }

  return warnings.sort((a, b) => a.latestRate - b.latestRate || a.plotName.localeCompare(b.plotName, 'zh-Hans-CN'));
}

export interface UseSurvivalWarningsResult {
  warnings: SurvivalWarning[];
  loading: boolean;
  error: string;
}

/**
 * 订阅预警数据：地块、栽植、验收、补植计划任一变化都会重新派生，
 * 因此新录入测次、编辑成活率、生成 / 推进 / 删除补植计划后预警即时刷新。
 */
export function useSurvivalWarnings(threshold: number = SURVIVAL_WARN_RATE): UseSurvivalWarningsResult {
  const [plots, setPlots] = useState<Plot[]>([]);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [plantings, setPlantings] = useState<Planting[]>([]);
  const [replants, setReplants] = useState<Replant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    const subscription = liveQuery(async () => {
      await initDatabase();
      const [plotRows, surveyRows, plantingRows, replantRows] = await Promise.all([
        db.plots.toArray(),
        db.surveys.toArray(),
        db.plantings.toArray(),
        db.replants.toArray(),
      ]);
      return { plotRows, surveyRows, plantingRows, replantRows };
    }).subscribe({
      next: ({ plotRows, surveyRows, plantingRows, replantRows }) => {
        if (!active) return;
        setPlots(plotRows);
        setSurveys(surveyRows);
        setPlantings(plantingRows);
        setReplants(replantRows);
        setError('');
        setLoading(false);
      },
      error: (err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : '读取预警数据失败');
        setLoading(false);
      },
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const warnings = useMemo(
    () => buildSurvivalWarnings(plots, surveys, plantings, replants, threshold),
    [plots, surveys, plantings, replants, threshold],
  );

  return { warnings, loading, error };
}
