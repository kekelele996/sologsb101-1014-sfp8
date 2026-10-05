/**
 * /surveys 成活率与株高验收台
 * 按测次录入成活株数与平均株高，自动算成活率并低于阈值告警；支持批量调整成活率等级。
 * 消费模型：Survey、Plot、Planting；复用组件：<RateTag>、<EmptyPanel>、<StatBadge>
 */
import { useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  DatePicker,
  Form,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  EditOutlined,
  ExperimentOutlined,
  PlusOutlined,
  RiseOutlined,
  FallOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import EmptyPanel from '../components/common/EmptyPanel';
import RateTag from '../components/common/RateTag';
import StatBadge from '../components/common/StatBadge';
import { useIdbTable } from '../hooks/useIdbTable';
import { useReplantAlerts, type ReplantAlert } from '../hooks/useReplantAlerts';
import { usePlotStore } from '../stores/plotStore';
import { useReplantStore } from '../stores/replantStore';
import { useSurveyStore } from '../stores/surveyStore';
import { db } from '../utils/db';
import { RATE_LEVEL_LABEL, RATE_LEVEL_OPTIONS, type RateLevel, type Survey } from '../types/survey';
import { SURVIVAL_WARN_RATE, percentText } from '../utils/rate';

interface SurveyFormValues {
  plotId: string;
  round: number;
  date: Dayjs;
  aliveCount: number;
  avgHeightCm: number;
}

export default function SurveyBoard() {
  const { message } = App.useApp();
  const plots = usePlotStore((state) => state.plots);
  const ready = usePlotStore((state) => state.ready);
  const statOf = usePlotStore((state) => state.statOf);
  const summaryOf = usePlotStore((state) => state.summaryOf);
  const filters = useSurveyStore((state) => state.filters);
  const setFilters = useSurveyStore((state) => state.setFilters);
  const resetFilters = useSurveyStore((state) => state.resetFilters);
  const selectedIds = useSurveyStore((state) => state.selectedIds);
  const setSelectedIds = useSurveyStore((state) => state.setSelectedIds);
  const gradeDraft = useSurveyStore((state) => state.gradeDraft);
  const setGradeDraft = useSurveyStore((state) => state.setGradeDraft);
  const bulkApplyGrade = useSurveyStore((state) => state.bulkApplyGrade);
  const generateReplant = useSurveyStore((state) => state.generateReplant);
  const createSurvey = useSurveyStore((state) => state.createSurvey);
  const updateSurvey = useSurveyStore((state) => state.updateSurvey);
  const deleteSurvey = useSurveyStore((state) => state.deleteSurvey);
  const surveyRevision = useSurveyStore((state) => state.revision);
  const generateForPlot = useReplantStore((state) => state.generateForPlot);
  const generateForPlots = useReplantStore((state) => state.generateForPlots);

  const { rows, loading, remove } = useIdbTable<Survey>(db.surveys, { sortByUpdatedAt: false });
  const { alerts, loading: alertsLoading } = useReplantAlerts();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Survey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [form] = Form.useForm<SurveyFormValues>();

  const filtered = useMemo(() => {
    void surveyRevision;
    const key = filters.keyword.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (filters.plotId !== 'all' && row.plotId !== filters.plotId) return false;
        if (filters.from !== '' && row.date < filters.from) return false;
        if (filters.to !== '' && row.date > filters.to) return false;
        if (filters.level !== 'all') {
          const summary = summaryOf(row.plotId);
          const point = summary.points.find((item) => item.surveyId === row.id);
          const level: RateLevel = point?.level ?? row.grade;
          if (level !== filters.level) return false;
        }
        if (key === '') return true;
        const plotName = plots.find((item) => item.id === row.plotId)?.name ?? '';
        return plotName.toLowerCase().includes(key) || row.date.includes(key) || `第${row.round}`.includes(key);
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.round - a.round);
    // surveyRevision 用于写操作后强制重算派生列
  }, [rows, filters, plots, summaryOf, surveyRevision]);

  const plotName = (plotId: string): string => plots.find((item) => item.id === plotId)?.name ?? '（地块已删除）';

  const stats = useMemo(() => {
    const rated = plots.filter((plot) => statOf(plot.id).surveyCount > 0);
    const warn = rated.filter((plot) => statOf(plot.id).latestRate < SURVIVAL_WARN_RATE);
    const strong = rated.filter((plot) => statOf(plot.id).latestRate >= 85);
    return {
      ratedCount: rated.length,
      warnCount: warn.length,
      strongCount: strong.length,
      strongPct: rated.length === 0 ? 0 : Math.round((strong.length / rated.length) * 1000) / 10,
      avgRate:
        rated.length === 0
          ? 0
          : Math.round((rated.reduce((acc, plot) => acc + statOf(plot.id).latestRate, 0) / rated.length) * 10) / 10,
    };
  }, [plots, statOf]);

  const openCreate = (): void => {
    const plotId = filters.plotId !== 'all' ? filters.plotId : plots.length > 0 ? plots[0].id : '';
    const nextRound = rows.filter((row) => row.plotId === plotId).length + 1;
    setEditing(null);
    form.setFieldsValue({
      plotId,
      round: nextRound,
      date: dayjs(),
      aliveCount: 0,
      avgHeightCm: 0,
    });
    setOpen(true);
  };

  const openEdit = (row: Survey): void => {
    setEditing(row);
    form.setFieldsValue({
      plotId: row.plotId,
      round: row.round,
      date: dayjs(row.date),
      aliveCount: row.aliveCount,
      avgHeightCm: row.avgHeightCm,
    });
    setOpen(true);
  };

  const handleSubmit = async (): Promise<void> => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const payload = {
        plotId: values.plotId,
        round: values.round,
        date: values.date.format('YYYY-MM-DD'),
        aliveCount: values.aliveCount,
        avgHeightCm: values.avgHeightCm,
      };
      if (editing === null) {
        const row = await createSurvey(payload);
        message.success(`已录入第 ${row.round} 测次，成活率 ${row.survivalRate}%`);
        if (row.survivalRate < SURVIVAL_WARN_RATE) {
          message.warning(`成活率 ${row.survivalRate}% 低于告警阈值 ${SURVIVAL_WARN_RATE}%，建议生成补植计划`, 6);
        }
      } else {
        await updateSurvey(editing.id, payload);
        message.success('验收记录已更新');
      }
      setOpen(false);
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkGrade = async (): Promise<void> => {
    const count = await bulkApplyGrade(gradeDraft);
    if (count === 0) {
      message.info('请先在列表中勾选需要调整等级的验收记录');
      return;
    }
    message.success(`已把 ${count} 条记录的成活率等级调整为「${RATE_LEVEL_LABEL[gradeDraft]}」`);
  };

  const handleGenerateReplant = async (): Promise<void> => {
    const plotId = filters.plotId !== 'all' ? filters.plotId : plots.length > 0 ? plots[0].id : '';
    if (plotId === '') {
      message.info('请先选择地块');
      return;
    }
    const result = await generateReplant(plotId);
    message.success(result);
  };

  const handleGenerateOne = async (alert: ReplantAlert): Promise<void> => {
    const result = await generateForPlot(alert.plotId);
    if (result === 'created') {
      message.success(`已为「${alert.plotName}」生成补植计划：建议补植 ${alert.suggestReplant.toLocaleString('zh-CN')} 株`);
    } else if (result === 'skipped') {
      message.info(`「${alert.plotName}」已有未完成的补植计划，已跳过`);
    } else {
      message.info(`「${alert.plotName}」当前无缺株，无需生成补植计划`);
    }
  };

  const handleGenerateAll = async (): Promise<void> => {
    setGenerating(true);
    try {
      const { created, skipped } = await generateForPlots(alerts.map((item) => item.plotId));
      message.success(`批量生成完成：新增 ${created} 条，跳过 ${skipped} 条`);
    } finally {
      setGenerating(false);
    }
  };

  const alertColumns: ColumnsType<ReplantAlert> = [
    { title: '地块', dataIndex: 'plotName', key: 'plotName', width: 200 },
    {
      title: '最新测次',
      key: 'round',
      width: 150,
      render: (_value, record) => (
        <Space direction="vertical" size={0}>
          <Tag color="blue">第 {record.round} 次</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {record.date}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '成活率',
      key: 'rate',
      width: 160,
      render: (_value, record) => <RateTag rate={record.rate} level={record.level} />,
    },
    {
      title: '缺株数',
      dataIndex: 'missingCount',
      key: 'missingCount',
      width: 110,
      align: 'right',
      render: (value: number) => `${value.toLocaleString('zh-CN')} 株`,
    },
    {
      title: '建议补植',
      dataIndex: 'suggestReplant',
      key: 'suggestReplant',
      width: 110,
      align: 'right',
      render: (value: number) => (
        <Typography.Text strong type="danger">
          {value.toLocaleString('zh-CN')} 株
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 210,
      render: (_value, record) => (
        <Space size={8}>
          <Tooltip title={record.hasOpenReplant ? '该地块已有待补植 / 已补植的计划，默认跳过' : undefined}>
            <Button
              size="small"
              type="primary"
              ghost
              icon={<ToolOutlined />}
              disabled={record.hasOpenReplant}
              onClick={() => void handleGenerateOne(record)}
            >
              生成补植计划
            </Button>
          </Tooltip>
          {record.hasOpenReplant ? <Tag color="orange">已有未完成计划</Tag> : null}
        </Space>
      ),
    },
  ];

  const columns: ColumnsType<Survey> = [
    {
      title: '地块',
      key: 'plot',
      width: 200,
      render: (_value, record) => (
        <Space direction="vertical" size={0}>
          <span>{plotName(record.plotId)}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            栽植总株数 {statOf(record.plotId).plantTotal.toLocaleString('zh-CN')} 株
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '测次',
      dataIndex: 'round',
      key: 'round',
      width: 84,
      align: 'center',
      render: (value: number) => <Tag color="blue">第 {value} 次</Tag>,
      sorter: (a, b) => a.round - b.round,
    },
    { title: '验收日期', dataIndex: 'date', key: 'date', width: 128, sorter: (a, b) => a.date.localeCompare(b.date) },
    {
      title: '成活株数',
      dataIndex: 'aliveCount',
      key: 'aliveCount',
      width: 110,
      align: 'right',
      render: (value: number) => value.toLocaleString('zh-CN'),
    },
    {
      title: '成活率',
      key: 'rate',
      width: 180,
      render: (_value, record) => {
        const summary = summaryOf(record.plotId);
        const point = summary.points.find((item) => item.surveyId === record.id);
        return (
          <RateTag
            rate={point?.rate ?? record.survivalRate}
            level={point?.level ?? record.grade}
            manual={record.gradeManual}
          />
        );
      },
    },
    {
      title: '平均株高',
      dataIndex: 'avgHeightCm',
      key: 'avgHeightCm',
      width: 128,
      align: 'right',
      render: (value: number, record) => {
        const summary = summaryOf(record.plotId);
        const index = summary.points.findIndex((item) => item.surveyId === record.id);
        const previous = index > 0 ? summary.points[index - 1] : null;
        return (
          <Space direction="vertical" size={0} style={{ alignItems: 'flex-end' }}>
            <span>{value} cm</span>
            {previous !== null ? (
              <Typography.Text
                type={value >= previous.avgHeightCm ? 'success' : 'danger'}
                style={{ fontSize: 12 }}
              >
                {value >= previous.avgHeightCm ? <RiseOutlined /> : <FallOutlined />}{' '}
                {Math.abs(Math.round((value - previous.avgHeightCm) * 10) / 10)} cm
              </Typography.Text>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: '等级来源',
      key: 'gradeSource',
      width: 110,
      render: (_value, record) =>
        record.gradeManual ? <Tag color="purple">人工复核</Tag> : <Tag>自动判定</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_value, record) => (
        <Space size={4}>
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除该测次记录？"
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={async () => {
              await deleteSurvey(record.id);
              await remove(record.id);
              message.success('验收记录已删除');
            }}
          >
            <Button size="small" type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <StatBadge label="验收记录" value={rows.length} suffix="条" tone="primary" icon={<ExperimentOutlined />} />
        <StatBadge label="已验收地块" value={stats.ratedCount} suffix="块" tone="info" />
        <StatBadge label="平均成活率" value={percentText(stats.avgRate)} percent={stats.avgRate} tone="success" />
        <StatBadge
          label="优秀地块占比"
          value={percentText(stats.strongPct)}
          percent={stats.strongPct}
          tone="primary"
          hint="最新成活率 ≥ 85% 的地块占比"
        />
        <StatBadge
          label="告警地块"
          value={stats.warnCount}
          suffix="块"
          tone={stats.warnCount > 0 ? 'danger' : 'default'}
          hint={`最新成活率低于 ${SURVIVAL_WARN_RATE}% 的地块`}
        />
      </div>

      <Card
        size="small"
        style={{ marginBottom: 14, borderColor: alerts.length > 0 ? '#ffccc7' : undefined }}
        title={
          <Space size={8}>
            <WarningOutlined style={{ color: alerts.length > 0 ? '#cf1322' : '#8c8c8c' }} />
            <span>成活率预警（最新测次低于 {SURVIVAL_WARN_RATE}%）</span>
            {alerts.length > 0 ? <Tag color="red">{alerts.length} 块</Tag> : null}
          </Space>
        }
        extra={
          <Button
            type="primary"
            danger
            icon={<ThunderboltOutlined />}
            disabled={alerts.length === 0}
            loading={generating}
            onClick={() => void handleGenerateAll()}
          >
            一键为全部预警地块生成计划
          </Button>
        }
      >
        {alerts.length === 0 ? (
          <EmptyPanel
            title="暂无预警地块"
            description={`所有已验收地块的最新成活率均不低于 ${SURVIVAL_WARN_RATE}%，无需生成补植计划。`}
          />
        ) : (
          <>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 10, fontSize: 12 }}>
              按成活率从低到高排列；已有未完成补植计划（待补植 / 已补植）的地块生成时默认跳过。
            </Typography.Text>
            <Table<ReplantAlert>
              rowKey="plotId"
              size="small"
              loading={alertsLoading}
              columns={alertColumns}
              dataSource={alerts}
              pagination={false}
            />
          </>
        )}
      </Card>

      <Card
        title="成活率与株高验收台"
        extra={
          <Space>
            <Button icon={<ToolOutlined />} onClick={() => void handleGenerateReplant()}>
              生成补植计划
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} disabled={plots.length === 0}>
              录入测次
            </Button>
          </Space>
        }
      >
        <Space size={12} wrap style={{ marginBottom: 14 }}>
          <Space size={6}>
            <span style={{ color: '#5b6b66', fontSize: 13 }}>地块</span>
            <Select
              style={{ minWidth: 200 }}
              value={filters.plotId}
              onChange={(value: string) => setFilters({ plotId: value })}
              options={[
                { value: 'all', label: '全部地块' },
                ...plots.map((plot) => ({ value: plot.id, label: plot.name })),
              ]}
            />
          </Space>
          <Space size={6}>
            <span style={{ color: '#5b6b66', fontSize: 13 }}>等级</span>
            <Select
              style={{ minWidth: 140 }}
              value={filters.level}
              onChange={(value: string) => setFilters({ level: value as RateLevel | 'all' })}
              options={[
                { value: 'all', label: '全部等级' },
                ...RATE_LEVEL_OPTIONS.map((level) => ({ value: level, label: RATE_LEVEL_LABEL[level] })),
              ]}
            />
          </Space>
          <Space size={6}>
            <span style={{ color: '#5b6b66', fontSize: 13 }}>日期区间</span>
            <DatePicker
              value={filters.from === '' ? null : dayjs(filters.from)}
              onChange={(value) => setFilters({ from: value === null ? '' : value.format('YYYY-MM-DD') })}
              placeholder="开始日期"
            />
            <DatePicker
              value={filters.to === '' ? null : dayjs(filters.to)}
              onChange={(value) => setFilters({ to: value === null ? '' : value.format('YYYY-MM-DD') })}
              placeholder="结束日期"
            />
          </Space>
          <Button onClick={resetFilters}>重置筛选</Button>
          <Tag color="cyan">
            命中 {filtered.length} / {rows.length} 条
          </Tag>
        </Space>

        <Space size={12} wrap style={{ marginBottom: 14 }}>
          <Tag color={selectedIds.length > 0 ? 'purple' : 'default'}>已选 {selectedIds.length} 条</Tag>
          <Space size={6}>
            <span style={{ color: '#5b6b66', fontSize: 13 }}>批量调整为</span>
            <Select
              style={{ minWidth: 120 }}
              value={gradeDraft}
              onChange={(value: RateLevel) => setGradeDraft(value)}
              options={RATE_LEVEL_OPTIONS.map((level) => ({ value: level, label: RATE_LEVEL_LABEL[level] }))}
            />
          </Space>
          <Button type="primary" ghost disabled={selectedIds.length === 0} onClick={() => void handleBulkGrade()}>
            批量调整成活率等级
          </Button>
          <Button disabled={selectedIds.length === 0} onClick={() => setSelectedIds([])}>
            取消选择
          </Button>
        </Space>

        {rows.length === 0 && !loading ? (
          <EmptyPanel
            title="还没有任何验收记录"
            description="按测次录入成活株数与平均株高，系统会自动计算成活率并在低于阈值时告警。"
            actionText="录入第一个测次"
            onAction={openCreate}
          />
        ) : (
          <Table<Survey>
            rowKey="id"
            size="middle"
            loading={loading || !ready}
            columns={columns}
            dataSource={filtered}
            scroll={{ x: 1280 }}
            rowSelection={{
              selectedRowKeys: selectedIds,
              onChange: (keys) => setSelectedIds(keys.map((key) => String(key))),
            }}
            pagination={{ pageSize: 8, showSizeChanger: false }}
            locale={{
              emptyText: (
                <EmptyPanel title="没有符合筛选条件的验收记录" actionText="重置筛选" onAction={resetFilters} />
              ),
            }}
          />
        )}
      </Card>

      <Modal
        title={editing === null ? '录入验收测次' : '编辑验收测次'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void handleSubmit()}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="plotId" label="地块" style={{ flex: 2 }} rules={[{ required: true, message: '请选择地块' }]}>
              <Select options={plots.map((plot) => ({ value: plot.id, label: plot.name }))} />
            </Form.Item>
            <Form.Item name="round" label="测次" style={{ flex: 1 }} rules={[{ required: true, message: '请填写测次' }]}>
              <InputNumber min={1} max={99} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="date" label="验收日期" style={{ flex: 1 }} rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="aliveCount"
              label="成活株数"
              style={{ flex: 1 }}
              rules={[{ required: true, message: '请填写成活株数' }]}
            >
              <InputNumber min={0} max={500000} step={10} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="avgHeightCm"
              label="平均株高（cm）"
              style={{ flex: 1 }}
              rules={[{ required: true, message: '请填写平均株高' }]}
            >
              <InputNumber min={0} max={2000} step={1} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            成活率 = 成活株数 / 该地块栽植总株数，保存时自动计算；成活率低于 {SURVIVAL_WARN_RATE}% 会给出告警提示。
          </Typography.Text>
        </Form>
      </Modal>
    </div>
  );
}
