// hiedu shared 层总出口(双门户共享,禁止宿主依赖 import.meta.env/window)。
export * from './contract';
export * from './client';
export * from './resources';
export * from './format';
export * from './permissions';
export { SHARED_VERSION } from './version';
