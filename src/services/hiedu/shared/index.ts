// hiedu shared 层总出口(双门户共享,禁止宿主环境读取(import.meta.env、localStorage、SSO 深链))。
export * from './contract';
export * from './client';
export * from './resources';
export * from './format';
export * from './permissions';
export { SHARED_VERSION } from './version';
