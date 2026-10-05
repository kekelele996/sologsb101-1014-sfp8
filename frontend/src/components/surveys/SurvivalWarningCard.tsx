/**
 * <SurvivalWarningCard> 成活率预警卡片
 * 只收最新验收成活率低于告警线（默认 50%）的地块，按成活率从低到高排列；
 * 每行可单独生成补植计划，右上角一键为全部预警地块生成；
 * 已有未完成（待补植 / 已补植）补植计划的地块默认跳过，无预警地块时显示空态。
 * 派生数据来自 useSurvivalWarnings（即时刷新），写库动作走 surveyStore。
 */
import { useState } from 'react';
import { App, Button, Card, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ThunderboltOutlined, ToolOutlined, WarningOutlined } from '@ant-design/icons';
import type { SurvivalWarning } from '../../hooks/useSurvivalWarnings';
import { useSurveyStore } from '../../stores/surveyStore';
import { SURVIVAL_WARN_RATE, percentText } from '../../utils/rate';

export interface SurvivalWarningCardProps {
  warnings: SurvivalWarning[];
  loading?: boolean;
}

export default function SurvivalWarningCard({ warnings, loading = false }: SurvivalWarningCardProps) {
  const { message } = App.useApp();
  const generateReplant = useSurveyStore((state) => state.generateReplant);
  const generateWarningReplants = useSurveyStore((state) => state.generateWarningReplants);
  const [busyPlotId, setBusyPlotId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const handleRowGenerate = async (warning: SurvivalWarning): Promise<void> => {
    setBusyPlotId(warning.plotId);
    try {
      const result = await generateReplant(warning.plotId);
      message.success(result);
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      setBusyPlotId(null);
    }
  };

  const handleGenerateAll = async (): Promise<void> => {
    // 预警卡片里仍未完成计划的地块才需要生成，其余在 store 内也会再防御性跳过
    const targets = warnings.filter((item) => !item.hasPendingReplant).map((item) => item.plotId);
    if (targets.length === 0) {
      message.info('预警地块都已有未完成补植计划，无需重复生成');
      return;
    }
    setBulkBusy(true);
    try {
      const { created, skipped } = await generateWarningReplants(targets);
      if (created > 0) {
        message.success(`已为 ${created} 个预警地块生成补植计划${skipped > 0 ? `，跳过 ${skipped} 个` : ''}`);
      } else {
        message.info(`跳过 ${skipped} 个：均已有未完成补植计划`);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '批量生成补植计划失败');
    } finally {
      setBulkBusy(false);
    }
  };

  const columns: ColumnsType<SurvivalWarning> = [
    {
      title: '地块名',
      dataIndex: 'plotName',
      key: 'plotName',
      width: 200,
      render: (value: string, record) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 600 }}>{value}</span>
          {record.hasPendingReplant ? (
            <Tooltip title="存在待补植 / 已补植且未复核的补植计划，生成时自动跳过">
              <Tag color="orange" style={{ width: 'fit-content', marginInline: 0 }}>
                已有 {record.pendingReplantCount} 条未完成计划
              </Tag>
            </Tooltip>
          ) : null}
        </Space>
      ),
    },
    {
      title: '最新测次',
      key: 'latestRound',
      width: 150,
      render: (_value, record) => (
        <Space direction="vertical" size={0}>
          <Tag color="red" style={{ width: 'fit-content' }}>
            第 {record.latestRound} 次
          </Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {record.latestDate}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '成活率',
      dataIndex: 'latestRate',
      key: 'latestRate',
      width: 120,
      align: 'right',
      sorter: (a, b) => a.latestRate - b.latestRate,
      defaultSortOrder: 'ascend',
      render: (value: number) => (
        <Typography.Text strong type="danger" style={{ fontSize: 15 }}>
          {percentText(value)}
        </Typography.Text>
      ),
    },
    {
      title: '缺株数（株）',
      dataIndex: 'missingCount',
      key: 'missingCount',
      width: 130,
      align: 'right',
      render: (value: number) => value.toLocaleString('zh-CN'),
    },
    {
      title: '建议补植（株）',
      dataIndex: 'suggestReplant',
      key: 'suggestReplant',
      width: 140,
      align: 'right',
      render: (value: number) => (
        <Typography.Text strong style={{ color: '#c0392b' }}>
          {value.toLocaleString('zh-CN')}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 170,
      align: 'right',
      render: (_value, record) =>
        record.hasPendingReplant ? (
          <Tooltip title="该地块已有未完成补植计划，无需重复生成">
            <Button size="small" type="link" disabled icon={<ToolOutlined />}>
              已安排补植
            </Button>
          </Tooltip>
        ) : (
          <Button
            size="small"
            type="primary"
            danger
            ghost
            icon={<ToolOutlined />}
            loading={busyPlotId === record.plotId}
            onClick={() => void handleRowGenerate(record)}
          >
            生成补植计划
          </Button>
        ),
    },
  ];

  const actionableCount = warnings.filter((item) => !item.hasPendingReplant).length;

  return (
    <Card
      size="small"
      style={{ marginBottom: 14, borderColor: 'rgba(192,57,43,0.35)', boxShadow: '0 1px 6px rgba(192,57,43,0.08)' }}
      title={
        <Space>
          <WarningOutlined style={{ color: '#c0392b' }} />
          <span>低成活率预警</span>
          {warnings.length > 0 ? (
            <Tag color="red">
              {warnings.length} 块 · {actionableCount} 块待安排
            </Tag>
          ) : null}
        </Space>
      }
      extra={
        warnings.length > 0 ? (
          <Tooltip
            title={
              actionableCount === 0
                ? '全部预警地块都已有未完成补植计划'
                : `为 ${actionableCount} 个尚无未完成计划的预警地块批量生成；已有计划的自动跳过`
            }
          >
            <Button
              type="primary"
              danger
              size="small"
              icon={<ThunderboltOutlined />}
              loading={bulkBusy}
              disabled={actionableCount === 0}
              onClick={() => void handleGenerateAll()}
            >
              一键生成全部补植计划
            </Button>
          </Tooltip>
        ) : null
      }
    >
      {warnings.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            padding: '24px 16px',
          }}
        >
          <Typography.Text strong style={{ fontSize: 14, color: '#1f8a4c' }}>
            暂无低成活率预警地块
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            所有已验收地块的最新成活率均不低于 {SURVIVAL_WARN_RATE}%；新录入验收或补植状态变化后这里会即时刷新。
          </Typography.Text>
        </div>
      ) : (
        <Table<SurvivalWarning>
          rowKey="plotId"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={warnings}
          pagination={false}
          scroll={{ x: 980 }}
        />
      )}
    </Card>
  );
}
