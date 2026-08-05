/**
 * Cognitive Wargame 插件中文词条。
 *
 * 词条会由 features/_registry 合并进 'translation' 命名空间，
 * 因此页面中以 `t('cognitiveWargame.nav.dashboard')` 形式访问。
 */
export default {
  cognitiveWargame: {
    nav: {
      dashboard: '总览仪表盘',
      scenarios: '想定管理',
      rounds: '推演监控',
      metrics: '态势分析',
      kg: '知识图谱',
      reports: '评估报告',
    },
    common: {
      title: '认知博弈推演',
      subtitle: '红蓝对抗认知域推演与评估',
      loading: '加载中…',
      empty: '暂无数据',
      error: '加载失败',
      retry: '重试',
      refresh: '刷新',
      viewDetail: '查看详情',
      back: '返回',
      execute: '执行推演',
      generate: '生成想定',
      selectScenario: '请选择想定',
      selectRound: '请选择回合',
      round: '回合',
      status: '状态',
      createdAt: '创建时间',
      updatedAt: '更新时间',
      actions: '操作',
    },
    dashboard: {
      title: '推演总览',
      totalScenarios: '想定总数',
      runningScenarios: '进行中推演',
      completedScenarios: '已完成推演',
      recentScenarios: '最近想定',
    },
    scenario: {
      listTitle: '想定列表',
      name: '想定名称',
      description: '描述',
      redForce: '红方',
      blueForce: '蓝方',
      roundsLimit: '回合上限',
      roundsCompleted: '已完成回合',
      detailTitle: '想定详情',
      roundList: '回合列表',
    },
    round: {
      title: '回合视图',
      eventStream: '事件流',
      phase: '阶段',
      actor: '执行方',
      action: '动作',
      timestamp: '时间',
    },
    metrics: {
      title: '态势分析',
      redScore: '红方得分',
      blueScore: '蓝方得分',
      redCognitive: '红方认知态势',
      blueCognitive: '蓝方认知态势',
      chartPlaceholder: '图表区域（占位）',
    },
    kg: {
      title: '知识图谱',
      entities: '实体',
      relations: '关系',
      graphPlaceholder: '图谱可视化区域（占位）',
    },
    report: {
      title: '评估报告',
      listTitle: '报告列表',
      type: '报告类型',
      generatedAt: '生成时间',
      contentPlaceholder: 'Markdown 报告内容（占位）',
    },
  },
};
