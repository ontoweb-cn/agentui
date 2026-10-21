// canvas 包源码态类型检查:CSS Modules(less)导入声明。
// 构建期由 vite css 管线处理;此处仅为 tsc --noEmit 通过。
declare module '*.module.less' {
  const classes: Record<string, string>;
  export default classes;
}

declare module '*.less' {
  const classes: Record<string, string>;
  export default classes;
}
