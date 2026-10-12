# 更新日志

## 1.5.0 — 2026-10-12

- 名称更新为「词下 · WordBelow」，同步更新 Chrome 扩展名称、工具栏图标、面板和 API 设置页。
- 新增中文介绍页、中文使用说明及公开版本打包脚本。
- Qwen-MT Flash 预设使用通用配置：新用户填写自己的百炼兼容服务地址；已配置 Qwen-MT 的用户保留原地址和密钥草稿，点击保存后才写入设置。
- 保留旧版扩展存储键。在原扩展目录更新并重新加载时，API 配置、翻译模式、外观和站点设置继续使用。
- 提供不调用真实 API 的设置回归检查，以及验证安装包、扩展资源和离线词典分片的打包校验。

本版本包含此前已完成的功能：离线逐词释义、OpenAI 兼容 API 整句翻译、Qwen-MT Flash 适配、视口及上下约 400 像素预取、可配置批量与并发、中文页面自动跳过、默认手动翻译、自动翻译开关、一级右键菜单、自定义译文颜色和透明度。

## 来源

项目基于 [breeze-r/wordwise](https://github.com/breeze-r/wordwise) 改造，并使用 [ECDICT](https://github.com/skywind3000/ECDICT) 离线词典。上游版权、完整许可和固定版本记录分别保存在 `extension/LICENSE-WordWise.txt`、`extension/dictionary/ECDICT-LICENSE.txt` 及 `extension/THIRD-PARTY-NOTICES.md`。

