// 测试默认关闭 imt_ 画布/agents 开关，避免 authMiddleware fail-closed
// 把既有「Authorization: Bearer test」用例打成 401。
// 需要验证默认开启行为的用例须自行 delete / 设为 'true'，并在 finally 里恢复 'false'。
process.env.BFF_ENABLE_IMT_CANVAS_AGENTS = 'false';
