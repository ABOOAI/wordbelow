# 本地逐词释义的来源

离线逐词模式使用随扩展打包的 **ECDICT 英汉词典**，直接在电脑本地查词，不调用网络翻译接口，也不发送页面内容。`dictionary.js` 中另外提供 164 个常用短词、缩写形式及常见词的人工简释，供冠词、代词、助动词和 `I'm`、`don't` 等形式使用。扩展另有可选 API 整句模式，该模式由使用者配置服务商。

这是词典释义，不是根据整句话选择词义的机器翻译。一个英文词可能有多个意思，短注释保留词典的前一至两个中文义项。因此，多义词、专有名词和语法连接词在具体句子里的含义仍可能与简释不同。未知词返回空结果，显示层可以标明“未收录”，不会猜测释义。

## ECDICT 数据溯源

- 官方仓库：https://github.com/skywind3000/ECDICT
- 固定源版本：`bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b`
- 源版本时间：`2025-03-28T01:02:57Z`
- 下载、构建日期：`2026-10-12`（按用户时区 Asia/Shanghai）
- 原始文件：https://raw.githubusercontent.com/skywind3000/ECDICT/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b/ecdict.csv
- 原始文件大小：`65,933,428` 字节
- 原始文件 SHA-256：`1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf`
- 许可证：MIT，原文保存在 `ECDICT-LICENSE.txt`。

原始 CSV 包含 770,611 行。这个版本保留带中文释义的英文单词，统一大小写，允许单词内部的英文撇号和连字符。词组和不适用于英文单词识别的条目没有放入单词查找表。

最终词典包含 **398,070** 个查找键：397,789 个直接条目，加上 ECDICT `exchange` 字段明确记录的 281 个词形变化。29,620 个词形说明或有词形关联的缩略词冲突条目，根据同一字段换成词根的中文释义。保留有独立主要词义的条目，例如 `found` 的“建立”和 `left` 的“左边的”。人工常用词简释会在查询时覆盖同名的词典条目，其来源单独标注为“常用词简释”。

标签先去掉词性及领域前缀，再选取前一至两个中文义项。标签超过 18 个字符时，显示主要义项或带省略号的短标签；缩略词释义中较长的英文展开式会在必要时跳过，以确保短标签仍包含中文。已选义项的较长形式可通过查询结果的 `full` 字段取得。每个分片的条目数量、大小和 SHA-256 都记录在 `metadata.json`。

## 运行接口

在内容脚本加载 `dictionary.js` 后调用：

```javascript
const map = await WordWiseDictionary.lookupMany(["I", "reading", "I'm", "unknownword"]);
// map.i -> { gloss: "我", source: "常用词简释" }
// map.reading -> { gloss: "阅读", source: "常用词简释" }
// map["i'm"] -> { gloss: "我是", source: "常用词简释" }
// map.unknownword -> null
```

返回对象的键经过小写转换及弯撇号转换。未知词返回 `null`；本地文件加载失败会抛出异常，避免把资源加载错误当成未收录。词典根据词首字母分成 27 个本地 JSON 文件，只按需读取。每个页面最多保留四个分片的缓存，并合并相同分片的并发读取请求；另缓存最近查询的 20,000 个单词结果（包括未收录），避免文章分批处理时重复读取已查询词对应的分片。

构建脚本只读取 CSV 数据，使用 Python 标准库，没有导入或执行 ECDICT 仓库中的代码。脚本保存在扩展目录的 `tools/` 中，安装扩展不需要 Python；只有重新生成词典时才需要 Python 3.11 或更高版本。下载上文固定版本的 CSV 后，在扩展根目录运行：

```text
python tools/build_dictionary.py --input path/to/ecdict.csv --output dictionary --source-commit bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b --source-commit-date 2025-03-28T01:02:57Z --build-date 2026-10-12
```
