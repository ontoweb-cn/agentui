# AgentUI 新成员快速启动检查清单

> 逐项勾选,确保不漏步骤。详细说明见 [RUNNING.md](RUNNING.md)。

---

## 一、环境准备

- [ ] 已安装 Node.js(>= 18.20.4,推荐 LTS)
  - 验证:`node -v`
- [ ] 已安装 npm(>= 9,随 Node 附带)
  - 验证:`npm -v`
- [ ] 已安装 Git
  - 验证:`git --version`
- [ ] 已配置 Git 用户身份(若首次使用)
  - `git config user.name "你的名字"`
  - `git config user.email "你的邮箱"`

---

## 二、获取代码

- [ ] 已克隆仓库(或拉取最新代码)
  - 首次:`git clone https://gitee.com/wustbd/agentui.git && cd agentui`
  - 已有:`git pull`
- [ ] 当前在 `main` 分支
  - 验证:`git branch --show-current`

---

## 三、安装依赖(关键步骤,易遗漏)

> `bff/node_modules` 已从版本控制移除,前端和 BFF 依赖**必须分别安装**。

- [ ] 已安装前端依赖(项目根目录)
  - `npm install`
- [ ] 已安装 BFF 依赖
  - `cd bff && npm install && cd ..`
- [ ] 确认 `bff/node_modules/` 目录已生成
  - 验证:`ls bff/node_modules/`(应看到 hono、tsx 等)

---

## 四、配置 BFF 环境变量(关键步骤,易遗漏)

> BFF 启动命令为 `tsx watch --env-file=.env`,**缺少 .env 文件会启动失败**。

- [ ] 已复制 BFF 配置模板
  - `cd bff && cp .env.example .env && cd ..`
- [ ] 确认 `bff/.env` 文件存在
  - 验证:`cat bff/.env`(应看到 `BFF_PORT=9390` 等)
- [ ] (可选)已填写真实 backend token(留空则进入 Wizard 首次安装流程)
  - `HARNESS_INTELLECT_RAG_ADMIN_TOKEN=`
  - `HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY=`

---

## 五、远程开发配置(仅 BFF/后端不在本机时)

- [ ] 已在项目根目录创建 `.env.local`
- [ ] 已配置 `BFF_HOST=<BFF 主机 IP>`
- [ ] (若 Python 后端也在远程)已配置 `API_HOST=<Python 后端 IP>`

---

## 六、启动服务

### 终端 1:启动 BFF

- [ ] 已切换到 bff 目录:`cd bff`
- [ ] 已运行 `npm run dev`
- [ ] 控制台显示 `[BFF] OpenKG AgentUI BFF running on http://localhost:9390`
- [ ] (首次安装)控制台显示 `已启用 Bootstrap 模式` + Token 前 8 位

### 终端 2:启动前端

- [ ] 已切换到项目根目录:`cd agentui`(或新终端)
- [ ] 已运行 `npm run dev`
- [ ] 控制台显示 `VITE v7.3.0 ready` + `Local: http://localhost:9391/`

---

## 七、访问验证

- [ ] 浏览器可访问 http://localhost:9391/
- [ ] 无 `ECONNREFUSED` / `http proxy error` 报错
- [ ] (无 backend token)页面自动跳转到 `/wizard`
- [ ] Wizard 页面语言与浏览器语言匹配(zh-CN → 简体中文)
- [ ] (有 backend token)进入主应用登录页

---

## 八、故障排查(启动失败时勾选)

- [ ] 确认 BFF 终端未关闭(常驻运行)
- [ ] 确认 BFF 端口 9390 未被占用
- [ ] 确认前端端口 9391 未被占用
- [ ] 确认 `bff/.env` 文件存在(非 `.env.example`)
- [ ] 确认 `bff/node_modules` 已安装(`npm install` 执行过)
- [ ] 确认前端代理配置正确(本地开发无需 `.env.local`)
- [ ] 查阅 [RUNNING.md 第九节「常见问题」](RUNNING.md#九常见问题)

---

## 九、后续工作

- [ ] 阅读项目文档:[specs/](specs/) 目录
- [ ] 了解架构:[specs/013-trae-work-ui-refactor/spec.md](specs/013-trae-work-ui-refactor/spec.md)
- [ ] 运行测试验证环境:
  - 前端:`npx jest --no-coverage`
  - BFF:`cd bff && npx vitest run`
- [ ] 类型检查:`npx tsc --noEmit`

---

## 附:一键启动命令(复制粘贴)

```bash
# 1. 拉取代码
git pull

# 2. 安装前端依赖
npm install

# 3. 安装 BFF 依赖
cd bff && npm install && cd ..

# 4. 配置 BFF 环境变量
cd bff && cp .env.example .env && cd ..

# 5. 启动 BFF(终端 1,保持运行)
cd bff && npm run dev

# 6. 启动前端(终端 2,保持运行)
npm run dev

# 7. 浏览器访问
# http://localhost:9391/
```
