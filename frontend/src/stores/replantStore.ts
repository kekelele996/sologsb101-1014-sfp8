/**
 * 补植计划状态管理（Zustand）
 * 维护补植计划的行内草稿、复核状态与批量选中项；
 * 状态推进与「补植完成回写地块缺株数」也在这里统一收口。
 */
import { create } from 'zustand';
import type { Replant, ReplantDraft, ReplantState } from '../types/replant';
import {
  advanceReplantState,
  db,
  exportSnapshot,
  importSnapshot,
  initDatabase,
  putReplant,
  removeReplant,
  resetDatabase,
  type DatabaseSnapshot,
} from '../utils/db';
import { nowIso, uuid } from '../utils/id';
import { usePlotStore } from './plotStore';

/** 补植计划筛选条件 */
export interface ReplantFilters {
  plotId: string | 'all';
  state: ReplantState | 'all';
  keyword: string;
}

export interface ReplantStoreState {
  filters: ReplantFilters;
  /** 每行的行内编辑草稿，key = replant id */
  drafts: Record<string, Partial<ReplantDraft>>;
  /** 当前复核选中的状态（用于批量推进） */
  reviewState: ReplantState | 'all';
  selectedIds: string[];
  lastMessage: string;
  revision: number;
  init: () => Promise<void>;
  setFilters: (patch: Partial<ReplantFilters>) => void;
  resetFilters: () => void;
  setDraft: (replantId: string, patch: Partial<ReplantDraft>) => void;
  clearDraft: (replantId: string) => void;
  hasDraft: (replantId: string) => boolean;
  saveDraft: (replantId: string) => Promise<void>;
  createReplant: (draft: ReplantDraft) => Promise<Replant>;
  deleteReplant: (replantId: string) => Promise<void>;
  /** 为单个预警地块生成补植计划；已有未完成计划或无缺株时跳过 */
  generateForPlot: (plotId: string) => Promise<'created' | 'skipped' | 'noMissing'>;
  /** 一键为全部预警地块生成补植计划，返回新增与跳过条数 */
  generateForPlots: (plotIds: string[]) => Promise<{ created: number; skipped: number }>;
  /** 推进到下一状态；进入「已补植」时回写地块缺株数并重算成活率 */
  advance: (replantId: string) => Promise<ReplantState | null>;
  setState: (replantId: string, state: ReplantState) => Promise<void>;
  batchAdvance: () => Promise<number>;
  setSelectedIds: (ids: string[]) => void;
  setReviewState: (state: ReplantState | 'all') => void;
  exportAll: () => Promise<DatabaseSnapshot>;
  importAll: (snapshot: DatabaseSnapshot) => Promise<void>;
  resetAll: () => Promise<void>;
}

const EMPTY_FILTERS: ReplantFilters = { plotId: 'all', state: 'all', keyword: '' };
const FLOW: ReplantState[] = ['待补植', '已补植', '已复核'];

export const useReplantStore = create<ReplantStoreState>((set, get) => ({
  filters: { ...EMPTY_FILTERS },
  drafts: {},
  reviewState: 'all',
  selectedIds: [],
  lastMessage: '',
  revision: 0,

  async init() {
    await initDatabase();
    set({ revision: get().revision + 1 });
  },

  setFilters(patch) {
    set({ filters: { ...get().filters, ...patch } });
  },

  resetFilters() {
    set({ filters: { ...EMPTY_FILTERS }, selectedIds: [] });
  },

  setDraft(replantId, patch) {
    set({ drafts: { ...get().drafts, [replantId]: { ...get().drafts[replantId], ...patch } } });
  },

  clearDraft(replantId) {
    const next = { ...get().drafts };
    delete next[replantId];
    set({ drafts: next });
  },

  hasDraft(replantId) {
    return get().drafts[replantId] !== undefined;
  },

  async saveDraft(replantId) {
    const draft = get().drafts[replantId];
    if (draft === undefined) return;
    const existing = await db.replants.get(replantId);
    if (!existing) return;
    await putReplant({ ...existing, ...draft } as Replant);
    get().clearDraft(replantId);
    set({ revision: get().revision + 1, lastMessage: '草稿已保存到补植计划' });
  },

  async createReplant(draft) {
    const stamp = nowIso();
    const row: Replant = {
      id: uuid('replant'),
      plotId: draft.plotId,
      missingCount: draft.missingCount,
      planDate: draft.planDate,
      species: draft.species,
      state: draft.state,
      createdAt: stamp,
      updatedAt: stamp,
      revision: 2,
    };
    await putReplant(row);
    set({ revision: get().revision + 1 });
    return row;
  },

  async deleteReplant(replantId) {
    await removeReplant(replantId);
    get().clearDraft(replantId);
    set({
      selectedIds: get().selectedIds.filter((id) => id !== replantId),
      revision: get().revision + 1,
    });
  },

  async generateForPlot(plotId) {
    const plotState = usePlotStore.getState();
    const plot = plotState.plots.find((row) => row.id === plotId);
    if (!plot) return 'skipped';
    // 已有未完成（待补植 / 已补植）计划的地块默认跳过，避免重复派单
    const existing = await db.replants.where('plotId').equals(plotId).toArray();
    if (existing.some((row) => row.state !== '已复核')) return 'skipped';
    const missing = plotState.summaryOf(plotId).suggestReplant;
    if (missing <= 0) return 'noMissing';
    const species = plotState.seedlings.find((row) => row.plotId === plotId)?.species ?? '秋茄';
    const stamp = nowIso();
    await putReplant({
      id: uuid('replant'),
      plotId,
      missingCount: missing,
      planDate: new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString().slice(0, 10),
      species,
      state: '待补植',
      createdAt: stamp,
      updatedAt: stamp,
      revision: 2,
    });
    set({
      revision: get().revision + 1,
      lastMessage: `已为「${plot.name}」生成补植计划：缺株 ${missing} 株`,
    });
    return 'created';
  },

  async generateForPlots(plotIds) {
    let created = 0;
    let skipped = 0;
    for (const plotId of plotIds) {
      const result = await get().generateForPlot(plotId);
      if (result === 'created') created += 1;
      else skipped += 1;
    }
    set({ lastMessage: `批量生成补植计划完成：新增 ${created} 条，跳过 ${skipped} 条` });
    return { created, skipped };
  },

  async advance(replantId) {
    const existing = await db.replants.get(replantId);
    if (!existing) return null;
    const index = FLOW.indexOf(existing.state);
    if (index < 0 || index >= FLOW.length - 1) return null;
    const next = FLOW[index + 1];
    await advanceReplantState(replantId, next);
    await usePlotStore.getState().refreshCounts();
    set({
      revision: get().revision + 1,
      lastMessage: next === '已补植' ? '已标记补植完成，地块缺株数与成活率已回写' : `状态已推进为「${next}」`,
    });
    return next;
  },

  async setState(replantId, state) {
    await advanceReplantState(replantId, state);
    set({ revision: get().revision + 1 });
  },

  async batchAdvance() {
    const ids = get().selectedIds;
    let count = 0;
    for (const id of ids) {
      const next = await get().advance(id);
      if (next !== null) count += 1;
    }
    set({ selectedIds: [], lastMessage: `已批量推进 ${count} 条补植计划` });
    return count;
  },

  setSelectedIds(ids) {
    set({ selectedIds: [...ids] });
  },

  setReviewState(state) {
    set({ reviewState: state });
  },

  async exportAll() {
    return exportSnapshot();
  },

  async importAll(snapshot) {
    await importSnapshot(snapshot);
    set({ revision: get().revision + 1 });
  },

  async resetAll() {
    await resetDatabase();
    set({ drafts: {}, selectedIds: [], revision: get().revision + 1 });
  },
}));
