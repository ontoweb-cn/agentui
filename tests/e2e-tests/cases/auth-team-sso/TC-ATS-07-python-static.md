# TC-ATS-07 Python 同契约静态检视

| 项 | 内容 |
|---|---|
| 目的 | Python adapter 是否注册 `members/oauth/exchange` |
| 操作 | `rg 'members/oauth/exchange' plugins/platforms/api_server/adapter.py` |
| 预期 | **当前 FAIL** → F-TEAM-PY-01 |
