// Tier B host 插件入口(canvas-stage4-independent-build-spec.md §9.2)。
// 独立构建的唯一入口:default 导出 host 插件定义(routes 沿用包内
// ModuleDefinition,单一事实源),宿主 runtime 懒两段式消费——启动期只读
// app.json 声明式路由表,首访才装载本产物。
//
// 词->词条不走本入口:i18n 经 app.json i18n.files(ui/locales/*.json,构建期
// 发射)由 BFF 内联下发;此处保留的 i18n 字段仅作为产物完整性存在,不被消费。
import { defineHostPlugin, getSharedHost } from '@agentui/plugin-sdk/host';
import canvasModule from './index';

const shared = getSharedHost();
if (!shared) {
  throw new Error(
    '[canvas] 宿主共享面 __AGENTUI_SHARED__ 未安装(宿主过旧或非宿主环境),插件无法装载',
  );
}

export default defineHostPlugin({
  ...canvasModule,
  name: 'canvas',
});
