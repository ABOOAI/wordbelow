# 词下 · WordBelow — 来源与许可

此版本基于 [breeze-r/wordwise](https://github.com/breeze-r/wordwise) 的 MIT 许可代码，保留网页文本节点扫描、规范化及插入注释的实现思路，并针对离线逐词上下对照重新实现内容脚本和设置面板。WordBelow 使用重新设计的图标。

WordWise 上游 revision：`6a904f5a4019d62c845b8be021c89d40dcd6f0ec`。
上游许可完整文本：`LICENSE-WordWise.txt`。

本版本调整：逐词上下排版、常见词与短词标注、ECDICT 扩充词库、无账号离线查词、动态内容处理、原文复制、全局与站点开关、网页右键按页启用、中文页面自动跳过，以及可选的 OpenAI 兼容 API 整句翻译。API 支持小批量合并、可配置并发、MiMo V2 思考参数、按编号校验与异常回退、过期请求取消及视口优先。离线中文小字为词典释义；API 模式由使用者自行配置服务商，中文句子译文仍置于英文原文下方。

ECDICT 数据来源、版本、构建摘要和许可见 `dictionary/` 中的说明文件。

本版本新增源代码同样以 MIT 许可提供，原有第三方权利和署名保持不变。
