# 联网与遥测告知 / Privacy & Telemetry Notice

本文件说明本应用（易标 OpenBidKit）在**打包发行版**运行期会发起的网络请求、上传字段、默认策略与关闭方式。
开发态（`!app.isPackaged`）仍整体跳过授权与联网检查，仅用于本地调试。

## 1. 默认策略：先询问，后联网（opt-in）

- 配置键：`telemetry_consent`，取值 `unset` | `granted` | `denied`，默认 **`unset`**。
- 只有明确 `granted` 才允许发起授权/联网请求；`unset` 与 `denied` 一律**不联网**（保守默认）。
- 打包版首次启动会弹出告知对话框，让用户选择「允许联网授权 / 仅离线使用」：
  - 选择「仅离线」或关闭对话框 → 记为 `denied`，之后不联网；
  - 无法弹窗（无对话框环境）→ 直接记为 `denied`。
- 用户可随时改为 `denied` 关闭联网；离线授权（导入离线授权文件 / 离线激活码）不受影响。

## 2. 会联网的时机与目的

| 时机 | 端点 | 目的 |
| --- | --- | --- |
| 启动约 800ms 后（仅当本地授权缺失/机器不匹配/失效且已同意） | `POST https://analytics.agnet.top/license/activate` | 在线激活/校验授权 |
| 启动时及每 30 分钟 | `GET https://analytics.agnet.top/notice` | 拉取公告（仅上传 projectName） |
| 启动时及每 30 分钟 | `GET https://openbidkit-oss.agnet.top/release/latest.json` | 检查更新 |

本文件重点约束**授权激活**这条链路的设备指纹上报。

## 3. 授权激活请求上传的字段（全部为必要字段）

- `projectName` / `appId` / `productName`：应用标识；
- `appVersion` / `platform` / `arch`：版本与平台；
- `clientId` / `clientCreatedAt`：本机生成的安装标识与首次时间；
- `machineFingerprintHash`：设备指纹**哈希**（SHA-256，64 位十六进制），由 OS 机器标识、MAC、主机名等派生后单向哈希，**不可逆**；
- `fingerprintVersion`：指纹算法版本；
- `buildAttestation`：构建证明（用于校验发行包可信度）。

## 4. 明确不上传的内容

- 不上传标书正文、用户文件内容、文件名、文件路径；
- 不上传原始 MAC 地址、原始 MachineGuid、明文主机名；
- 不上传许可证明文；
- 客户端代码未调用 `/track`、`sendBeacon`、`trackEvent` 等行为埋点接口。

用户文件外发仅发生在用户**主动选择云端解析**时，且发往第三方解析服务（mineru.net），与遥测无关。

## 5. 关闭方式

- UI/接口：`license.setConsent('denied')`（IPC `license:set-consent`）；
- 配置文件：将 `telemetry_consent` 置为 `denied`；
- 关闭后仅停止联网授权与含指纹的上报；离线授权路径继续可用。

## 6. 相关实现位置

- `client/electron/services/telemetryConsent.cjs`：授权常量、告知内容、开关判定（纯模块，可单测）；
- `client/electron/services/licenseService.cjs`：`resolveStartupConsent / getConsent / persistConsent / getPrivacyNotice / decorateStatus` 及联网前的 consent 门；
- `client/electron/services/configStore.cjs`：`telemetry_consent` 默认值与持久化；
- `client/electron/ipc/licenseIpc.cjs`、`client/electron/preload.cjs`、`client/src/shared/types/ipc.ts`：IPC 与类型；
- 测试：`client/electron/services/telemetryConsent.test.cjs`、`licenseService.consent.test.cjs`。
