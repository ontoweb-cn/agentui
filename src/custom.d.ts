type Nullable<T> = T | null;

declare module '*.md' {
  const content: string;
  export default content;
}

declare module 'jsoneditor' {
  // oxlint/TS(2309):不能同时 export default 与 export=
  const JSONEditor: any;
  export = JSONEditor;
}
