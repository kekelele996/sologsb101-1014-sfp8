/**
 * 成活率预警派生 hook
 * 只收最新验收成活率低于告警阈值（默认 50%）的地块，按成活率从低到高排序；
 * 同时订阅补植计划表，标出已有未完成计划（待补植 / 已补植）的地块，
 * 验收或补植数据变化时经 liveQuery 即时刷新。
 */
import { useMemo } from 'react';
import { useIdbTable } from './useIdbTable';
import { usePlotStore } from '../stores/plotStore';
import { db } from '../utils/db';
import { SURVIVAL_WARN_RATE } from '../utils/rate';
import type { Replant } from '../types/replant';
import type { RateLevel } from '../types/survey';

/** 单条成活率预警（一个地块至多一条，取其最新测次） */
export interface ReplantAlert {
  plotId: string;
  plotName: string;
  /** 最新测次 */
  round: number;
  /** 最新验收日期 YYYY-MM-DD */
  date: string;
  /** 最新成活率（%） */
  rate: number;
  /** 最新测次等级（含人工复核结果） */
  level: RateLevel;
  /** 缺株数（栽植总株数 - 最新成活株数） */
  missingCount: number;
  /** 建议补植株数 */
  suggestReplant: number;
  /** 是否已有未完成（待补植 / 已补植）的补植计划，生成时默认跳过 */
  hasOpenReplant: boolean;
}

export interface UseReplantAlertsResult {
  alerts: ReplantAlert[];
  loading: boolean;
}

export function useReplantAlerts(threshold: number = SURVIVAL_WARN_RATE): UseReplantAlertsResult {
  const plots = usePlotStore((state) => state.plots);
  const summaries = usePlotStore((state) => state.summaries);
  const ready = usePlotStore((state) => state.ready);
  const { rows: replants, loading } = useIdbTable<Replant>(db.replants, { sortByUpdatedAt: false });

  const alerts = useMemo(() => {
    const openPlotIds = new Set(
      replants.filter((row) => row.state !== '已复核').map((row) => row.plotId),
    );
    return plots
      .map((plot): ReplantAlert | null => {
        const summary = summaries[plot.id];
        if (summary === undefined || summary.latest === null) return null;
        if (summary.latestRate >= threshold) return null;
        return {
          plotId: plot.id,
          plotName: plot.name,
          round: summary.latest.round,
          date: summary.latest.date,
          rate: summary.latestRate,
          level: summary.latest.level,
          missingCount: Math.max(0, summary.totalCount - summary.latest.aliveCount),
          suggestReplant: summary.suggestReplant,
          hasOpenReplant: openPlotIds.has(plot.id),
        };
      })
      .filter((item): item is ReplantAlert => item !== null)
      .sort((a, b) => a.rate - b.rate || a.plotName.localeCompare(b.plotName, 'zh-Hans-CN'));
  }, [plots, summaries, replants, threshold]);

  return { alerts, loading: loading || !ready };
}
