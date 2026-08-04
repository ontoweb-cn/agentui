# AgentUI 运行手册

本指南帮助你在新电脑上从零启动 AgentUI 前端与 BFF。

---

## 一、环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | >= 18.20.4 | 推荐 LTS 版本 |
| npm | >= 9 | 随 Node 安装 |
| Git | 任意 | 拉取代码 |

验证:
```bash
node -v
npm -v
git --version
```

---

## 二、获取代码

```bash
git clone https://gitee.com/wustbd/agentui.git
cd agentui
```

已有本地仓库则拉取最新:
```bash
git pull
```

---

## 三、安装依赖

> **重要**: `bff/node_modules` 已从版本控制移除(2026-07-31),前端和 BFF 依赖需要分别安装。

```bash
# 1. 安装前端依赖(项目根目录)
npm install

# 2. 安装 BFF 依赖
cd bff
npm install
cd ..
```

---

## 四、配置 BFF 环境变量

BFF 启动命令为 `tsx watch --env-file=.env`,要求 `bff/.env` 文件存在。

```bash
cd bff
cp .env.example .env
cd ..
```

`.env` 默认配置即可启动(所有 token 留空,触发 Wizard 向导流程)。如需连接已存在的后端,编辑 `bff/.env` 填写对应 token:

| 变量 | 用途 |
|------|------|
| `HARNESS_INTELLECT_RAG_ADMIN_TOKEN` | Intellect RAG 画布/知识库后端 |
| `HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY` | Intellect 企业版 |
| `INTELLECT_LLM_API_KEY` | Intellect LLM Gateway |
| `CORS_ALLOWED_ORIGINS` | CORS 允许的前端来源 |

---

## 五、启动服务

需要 **两个终端** 分别运行前端和 BFF。

### 终端 1:启动 BFF

```bash
cd bff
npm run dev
```

启动成功标志:
```
[BFF] OpenKG AgentUI BFF running on http://localhost:9390
```

### 终端 2:启动前端

```bash
# 项目根目录
npm run dev
```

启动成功标志:
```
VITE v7.3.0  ready in xxx ms
➜  Local:   http://localhost:9391/
```

---

## 六、访问应用

| 入口 | 地址 | 说明 |
|------|------|------|
| 主应用 | http://localhost:9391/ | 浏览器访问 |
| 安装向导 | http://localhost:9391/wizard | 无后端配置时自动跳转至此 |

### 首次安装流程

无后端配置时(所有 token 留空),访问主应用会自动重定向到 `/wizard`:

1. BFF 启动日志会打印 Bootstrap Token(前 8 位)
2. 完整 token 位于 `bff/data/.bootstrap-token`(TTL 3600s)
3. 按向导步骤配置首个后端(KAG / Intellect Enterprise / Intellect RAG 等)
4. 配置完成后 Bootstrap Token 自动失效

---

## 七、远程开发配置

如果 BFF 运行在远程主机(非本机),前端需要配置代理目标。

在项目根目录创建 `.env.local`:

```bash
# .env.local(不入库)
BFF_HOST=192.168.x.x    # BFF 所在主机 IP
BFF_PORT=9390
```

同理,Python 后端(Intellect RAG Server)在远程时:

```bash
API_HOST=192.168.x.x
PYTHON_API_PORT=9380
PYTHON_ADMIN_PORT=9381
```

> 所有代理变量参见 [.env.example](.env.example)。

---

## 八、常用脚本

### 前端(根目录)

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器(默认 :9391) |
| `npm run build` | 生产构建 |
| `npm test` | 运行 Jest 测试(含覆盖率) |
| `npx jest <path> --no-coverage` | 运行指定测试(无覆盖率) |
| `npx tsc --noEmit` | TypeScript 类型检查 |

### BFF(bff 目录)

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动 BFF 开发服务器(默认 :9390,热重载) |
| `npm run build` | 生产构建 |
| `npm test` | 运行 Vitest 测试 |
| `npx vitest run <path>` | 运行指定测试 |

---

## 九、常见问题

### Q1: `ECONNREFUSED` / Vite 代理错误

```
[vite] http proxy error: /admin/wizard/status
AggregateError [ECONNREFUSED]
```

**原因**: BFF 未启动,或前端代理目标配置错误。

**解决**:
1. 确认 BFF 终端已启动且显示 `running on http://localhost:9390`
2. 若 BFF 在远程主机,在根目录 `.env.local` 配置 `BFF_HOST=<IP>`
3. 确认 `bff/.env` 文件存在(BFF 启动命令要求 `--env-file=.env`)

### Q2: BFF 启动报错找不到 `.env`

```
Error: Cannot find module '.env'
```

**原因**: BFF 目录缺少 `.env` 文件。

**解决**:
```bash
cd bff
cp .env.example .env
```

### Q3: `bff/node_modules` 不存在

**原因**: `bff/node_modules` 已从版本控制移除,需手动安装。

**解决**:
```bash
cd bff && npm install
```

### Q4: Bootstrap 模式相关

BFF 启动日志显示:
```
首次安装检测到无后端配置,已启用 Bootstrap 模式
Token(前 8 位):73a4afec...2ddc
```

这是**正常行为**:所有 backend token 留空时,BFF 进入首次安装模式。访问前端会自动跳转到 `/wizard` 完成配置。

### Q5: 端口冲突

| 服务 | 默认端口 | 修改方式 |
|------|----------|----------|
| 前端 | 9391 | 根目录 `.env.local` 设置 `PORT=xxxx` |
| BFF | 9390 | `bff/.env` 设置 `BFF_PORT=xxxx` + 前端 `.env.local` 同步 `BFF_PORT` |

### Q6: Wizard 页面显示英文

系统根据浏览器语言自动检测:
- `zh-CN` / `zh-Hans` → 简体中文
- `zh-TW` / `zh-Hant` → 繁体中文
- 其他 → 英文

手动切换语言:页面右上角语言选择器,选择后会持久化到 localStorage。

---

## 十、目录结构速览

```
agentui/
├── src/                    # 前端源码(React + Vite)
├── bff/                    # BFF 后端(Hono + TypeScript)
│   ├── src/
│   ├── .env.example        # BFF 环境变量模板(复制为 .env)
│   └── data/               # 运行时数据(gitignore,自动生成)
├── specs/                  # 设计文档与任务分解
├── docs/                   # 项目文档
├── .env.example            # 前端环境变量模板
├── .env.development        # 开发环境默认配置
├── vite.config.ts          # Vite 配置(含代理规则)
└── package.json            # 前端依赖与脚本
```
