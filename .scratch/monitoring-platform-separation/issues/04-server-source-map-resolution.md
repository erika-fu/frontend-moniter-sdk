# 04: 交付服务端 Source Map 存储与解析 API

**What to build:** 让服务端按应用和发布版本接收、保存并使用 Source Map，在错误查询中提供可追溯的源码位置，同时始终保留原始堆栈。

**Blocked by:** 03/交付错误聚合、详情与状态管理.

**Status:** resolved

- [x] 上传 API 要求有效的 `appId`、`release` 和 Source Map 文件，并拒绝超限或格式错误的内容。
- [x] 同一应用和发布版本可以保存多个构建文件的 Source Map，并支持明确的替换行为。
- [x] 错误堆栈按事件的应用、发布版本和生成文件匹配 Source Map。
- [x] 错误查询同时返回原始堆栈、解析后的帧以及解析状态。
- [x] 未上传版本、生成文件不匹配和解析失败均返回稳定且可区分的状态，不影响错误详情查询。
- [x] 固定构建产物测试覆盖上传、版本隔离、成功还原、替换和失败状态。

## Comments

- 服务端新增 `/api/v1/source-maps` JSON/multipart 上传与列表 API，Source Map 持久化到 SQLite。
- 上传限制为 5 MiB；重复生成文件必须显式 `replace=true` 才会替换。
- 错误事项和事件详情返回原始堆栈、解析帧及 `resolved`、`version_not_found`、`file_not_found`、`parse_failed` 或 `unmapped` 状态。
