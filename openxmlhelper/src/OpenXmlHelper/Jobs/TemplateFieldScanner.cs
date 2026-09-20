using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using Wp = DocumentFormat.OpenXml.Wordprocessing;

namespace Yibiao.OpenXmlHelper.Jobs;

/// <summary>扫描投标模板正文中的明确占位和简单空单元格，输出供 Agent 分类的稳定候选。</summary>
static class TemplateFieldScanner
{
    static readonly Regex PlaceholderPattern = new(
        @"_{2,}|＿{2,}|【\s*(?:待填写|人工处理)\s*[：:]?[^】]*】|\(\s*\)|（\s*）",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);
    static readonly Regex TrailingLabelPattern = new(
        @"(?<label>[\p{L}\p{N}（）()《》/·\-]{2,30})[：:]\s*$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);
    static readonly Regex ExplicitNamePattern = new(
        @"【\s*(?:待填写|人工处理)\s*[：:]\s*(?<name>[^】]+)】",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);
    static readonly Regex ManualPattern = new(
        @"签字|签名|签章|盖章|公章|印章|手印|法定代表人签|授权代表签",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);
    // 空位**后面**紧跟的括号提示：「你方在 ▁▁（谈判日期）参加的 ▁▁（项目名称）」里，
    // 真正的字段名是括号里的字，不在空位前面。
    static readonly Regex LeadingHintPattern = new(
        @"^[（(]\s*(?<name>[^（()）]{2,24})\s*[）)]",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);
    // 空位**前面**紧贴的括号提示：「（2） 总部地址： ▁▁」这类由前置标签规则覆盖，
    // 这里兜住「…关于贵方 ▁▁（采购人名称）」这种没有冒号的情况。
    static readonly Regex TrailingHintPattern = new(
        @"[（(]\s*(?<name>[^（()）]{2,24})\s*[）)]\s*$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);
    // 「年 月 日」这类日期行。它跟在标签后面说明标签确实等着人填。
    static readonly Regex DateLinePattern = new(
        @"^[\s\d]*年[\s\d]*月[\s\d]*日[\s]*$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);
    // 条款号：1 / 3.1 / 6.1.2。用来判断首行到底是表头还是数据。
    static readonly Regex ClauseNumberPattern = new(
        @"^\d+(\.\d+)*$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);
    // 编号前缀：（1）/（一）/ 1. / 1、/ 一、。字段名本身不带条目号。
    static readonly Regex LeadingNumberingPattern = new(
        @"^(?:[（(]\s*(?:\d+|[一二三四五六七八九十]+)\s*[）)]|\d+\s*[.、]|[一二三四五六七八九十]+\s*、)\s*",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public static TemplateFieldCandidateFile Scan(WordprocessingDocument document)
    {
        var part = document.MainDocumentPart ?? throw new InvalidOperationException("投标模版缺少正文部件");
        var body = part.Document.Body ?? throw new InvalidOperationException("投标模版正文为空");
        var result = new TemplateFieldCandidateFile();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var order = 0;

        for (var blockIndex = 0; blockIndex < body.ChildElements.Count; blockIndex += 1)
        {
            var block = body.ChildElements[blockIndex];
            var blockPath = $"body/{blockIndex}:{block.LocalName}";
            var next = blockIndex + 1 < body.ChildElements.Count ? body.ChildElements[blockIndex + 1] : null;
            ScanElement(block, blockPath, next, result.Candidates, seen, ref order);
        }

        return result;
    }

    static void ScanElement(
        OpenXmlElement element,
        string path,
        OpenXmlElement? nextBlock,
        List<TemplateFieldCandidate> candidates,
        HashSet<string> seen,
        ref int order)
    {
        if (element is Wp.SdtRun runControl)
        {
            ScanExistingControl(runControl, path, candidates, seen, ref order);
            return;
        }

        if (element is Wp.SdtBlock blockControl)
        {
            ScanExistingControl(blockControl, path, candidates, seen, ref order);
            return;
        }

        if (element is Wp.SdtCell or Wp.SdtRow)
        {
            return;
        }

        if (element is Wp.Paragraph paragraph)
        {
            ScanParagraph(paragraph, path, BlockText(nextBlock), candidates, seen, ref order);
            return;
        }

        if (element is Wp.Table table)
        {
            ScanTable(table, path, candidates, seen, ref order);
            return;
        }

        for (var index = 0; index < element.ChildElements.Count; index += 1)
        {
            var child = element.ChildElements[index];
            ScanElement(child, $"{path}/{index}:{child.LocalName}", null, candidates, seen, ref order);
        }
    }

    /// <summary>
    /// 取一个块级元素的纯文本，用于判断「上一个块后面还有没有正文」。
    /// 只有段落才有文本；表格/控件一律当作「有内容」，避免把引导句误判成待填点。
    /// </summary>
    static string BlockText(OpenXmlElement? element)
    {
        if (element is null) return "";
        if (element is Wp.Paragraph paragraph) return WordWorkspace.Normalize(ReadParagraphText(paragraph));
        return NonParagraphMarker;
    }

    static void ScanTable(
        Wp.Table table,
        string path,
        List<TemplateFieldCandidate> candidates,
        HashSet<string> seen,
        ref int order)
    {
        var rows = table.Elements<Wp.TableRow>().ToList();
        // 首行当表头：空单元格该填什么，最可靠的线索就是它所在列的列名。
        //
        // 但很多表根本没有表头行（首行就是数据）。这时宁可不给列名，也不能拿数据当列名：
        // 实测有张表首格是「6.1」，被当成列名后产生了
        // 「采购人组建判小组，由谈判小组按照本条规定的程序……（评审办法）」这种 65 字的名字。
        // 判据是首格像不像条款号（1 / 3.1 / 6.1.2）——真表头的首格是「条款号」「序号」这类词。
        var headerTexts = rows.Count > 0
            ? rows[0].Elements<Wp.TableCell>().Select(ReadCellText).ToList()
            : new List<string>();
        if (headerTexts.Count == 0 || ClauseNumberPattern.IsMatch(headerTexts[0].Trim()))
        {
            headerTexts = new List<string>();
        }

        for (var rowIndex = 0; rowIndex < rows.Count; rowIndex += 1)
        {
            var cells = rows[rowIndex].Elements<Wp.TableCell>().ToList();
            var rowTexts = cells.Select(ReadCellText).ToList();
            var rowPath = $"{path}/row/{rowIndex}";

            // 「整行只有非首列的某一格有字」的行，是分组标题行或合计行，不是待填行。
            //
            // 例如 ['', '生产设备', '', …] 是给下面几行做分类用的标题行、
            // ['', '合计', '', …] 是合计行——这类行里的空格只是版面占位，
            // 不是要投标人填的位置。实测这类行贡献了 25 个纯噪音候选。
            // 判据里要求「非空格不在首列」：像 ['申请人名称', '', '', …] 这种
            // 才是正常的「标签 + 待填写区」，必须保留。
            var nonEmptyIndexes = Enumerable.Range(0, rowTexts.Count)
                .Where(index => rowTexts[index].Length > 0)
                .ToList();
            var isGroupingRow = nonEmptyIndexes.Count == 1
                && nonEmptyIndexes[0] > 0
                && rowTexts.Take(nonEmptyIndexes[0]).Any(text => text.Length == 0);

            for (var cellIndex = 0; cellIndex < cells.Count; cellIndex += 1)
            {
                var cell = cells[cellIndex];
                var cellPath = $"{rowPath}/cell/{cellIndex}";
                var paragraphs = cell.Elements<Wp.Paragraph>().ToList();
                for (var paragraphIndex = 0; paragraphIndex < paragraphs.Count; paragraphIndex += 1)
                {
                    var nextText = paragraphIndex + 1 < paragraphs.Count
                        ? WordWorkspace.Normalize(ReadParagraphText(paragraphs[paragraphIndex + 1]))
                        : "";
                    ScanParagraph(
                        paragraphs[paragraphIndex],
                        $"{cellPath}/p/{paragraphIndex}",
                        nextText,
                        candidates,
                        seen,
                        ref order);
                }

                if (isGroupingRow) continue;
                if (!IsSimpleEmptyCell(cell, rowTexts[cellIndex])) continue;
                // 同行没有任何文字的空单元格不产生候选。
                //
                // 空单元格本身说明不了该填什么，名字只能从同行其它单元格的标签推出来。
                // 一整行都是空的，就没有任何可判断依据，只会把招标文件自身的空白表格
                // 全变成噪音——实测一份真实招标文件 408 个候选里有 133 个属于这种。
                //
                // 判据只看**同一行**，不能把列名算进来：否则整行全空的表格会因为
                // 「这一列有列名」而重新冒出候选（实测会让表格候选从 78 涨到 186）。
                if (BuildRowContext(rowTexts, cellIndex).Length == 0) continue;
                var context = BuildCellContext(rowTexts, cellIndex, headerTexts, rowIndex);
                var targetParagraph = paragraphs.FirstOrDefault();
                if (targetParagraph is null) continue;
                AddCandidate(
                    candidates,
                    seen,
                    ref order,
                    kind: "empty-table-cell",
                    location: $"{cellPath}/p/0",
                    dedupeScope: rowPath,
                    text: "",
                    context,
                    suggestedName: SuggestCellName(rowTexts, cellIndex, headerTexts, rowIndex),
                    suggestedFillBy: SuggestFillBy(context),
                    target: targetParagraph,
                    start: 0,
                    length: 0);
            }
        }
    }

    static void ScanExistingControl(
        OpenXmlElement control,
        string path,
        List<TemplateFieldCandidate> candidates,
        HashSet<string> seen,
        ref int order)
    {
        var properties = control switch
        {
            Wp.SdtRun run => run.SdtProperties,
            Wp.SdtBlock block => block.SdtProperties,
            _ => null,
        };
        if (IsStructuralControl(properties)) return;
        var name = properties?.GetFirstChild<Wp.SdtAlias>()?.Val?.Value?.Trim() ?? "";
        var controlText = WordWorkspace.Normalize(control.InnerText ?? "");
        var context = Limit(controlText, 200);
        AddCandidate(
            candidates,
            seen,
            ref order,
            kind: "existing-content-control",
            location: path,
            dedupeScope: path,
            text: controlText,
            context,
            suggestedName: name.Length > 0 ? name : SuggestName(controlText, ""),
            suggestedFillBy: SuggestFillBy($"{name} {controlText}"),
            target: control,
            start: 0,
            length: 0);
    }

    /// <summary>
    /// 判断一个已有内容控件是不是「结构性控件」，是则一律不当待填点。
    ///
    /// 两类要跳过：
    /// 1. 带 <c>w:docPartObj</c> 的控件——目录（TOC）这类自动生成的文档部件。
    ///    它的内容由 Word 自己维护，用占位段落去替换会把整页目录毁掉
    ///    （实测：目录整页只剩一个占位符，且只写入 w:tag、拿不到 w:alias/w:id）。
    /// 2. 已经带 <c>yibiao:field:</c> 标记的控件——那是本助手自己写进去的字段。
    ///    不跳过的话，拿处理过的模板再扫一次会把自己的输出当新候选，越滚越多。
    /// </summary>
    static bool IsStructuralControl(Wp.SdtProperties? properties)
    {
        if (properties is null) return false;
        // 按元素本地名判断而不是用强类型：w:docPartObj 在 SDK 里的类名跨版本有差异，
        // 而这里只关心「是不是文档部件」这一件事。
        if (properties.ChildElements.Any(child => child.LocalName == "docPartObj")) return true;
        var tag = properties.GetFirstChild<Wp.Tag>()?.Val?.Value ?? "";
        return tag.StartsWith(TemplateFieldSdtWriter.TagPrefix, StringComparison.Ordinal);
    }

    static void ScanParagraph(
        Wp.Paragraph paragraph,
        string path,
        string nextText,
        List<TemplateFieldCandidate> candidates,
        HashSet<string> seen,
        ref int order)
    {
        var existingControls = paragraph.Descendants<Wp.SdtRun>().ToList();
        if (existingControls.Count > 0)
        {
            for (var index = 0; index < existingControls.Count; index += 1)
            {
                ScanExistingControl(existingControls[index], $"{path}/sdt/{index}", candidates, seen, ref order);
            }
            return;
        }

        if (!IsSimpleParagraph(paragraph)) return;
        var text = ReadParagraphText(paragraph);
        if (text.Length == 0)
        {
            return;
        }

        var placeholderMatches = PlaceholderPattern.Matches(text).Cast<Match>().ToList();
        foreach (var match in placeholderMatches)
        {
            var context = BuildContext(text, match.Index, match.Length);
            var explicitName = ExplicitNamePattern.Match(match.Value).Groups["name"].Value.Trim();
            AddCandidate(
                candidates,
                seen,
                ref order,
                kind: "text-placeholder",
                location: path,
                dedupeScope: path,
                text: match.Value,
                context,
                suggestedName: explicitName.Length > 0
                    ? CleanName(explicitName)
                    : SuggestName(text[..match.Index], text[(match.Index + match.Length)..]),
                suggestedFillBy: SuggestFillBy(context),
                target: paragraph,
                start: match.Index,
                length: match.Length);
        }

        foreach (var underlined in FindUnderlinedWhitespace(paragraph, text))
        {
            if (placeholderMatches.Any(match =>
                underlined.Start < match.Index + match.Length
                && match.Index < underlined.Start + underlined.Length))
            {
                continue;
            }
            var context = BuildContext(text, underlined.Start, underlined.Length);
            AddCandidate(
                candidates,
                seen,
                ref order,
                kind: "underlined-space",
                location: path,
                dedupeScope: path,
                text: text.Substring(underlined.Start, underlined.Length),
                context,
                suggestedName: SuggestName(
                    text[..underlined.Start],
                    text[(underlined.Start + underlined.Length)..]),
                suggestedFillBy: SuggestFillBy(context),
                target: paragraph,
                start: underlined.Start,
                length: underlined.Length);
        }

        var trailingLabel = TrailingLabelPattern.Match(text);
        if (trailingLabel.Success)
        {
            var rawLabel = trailingLabel.Groups["label"].Value.Trim();
            // 只收「整段就是一行标签」且「后面确实空着」的段落。
            //
            // 「以：结尾」本身远不足以说明它是待填点：「3.1.1 响应文件应包括下列内容：」
            // 「6.1.2 谈判小组成员有下列情形之一的，应当回避：」这类带条款号的引导句
            // 同样以冒号结尾，后面跟的是列表而不是空位。实测 21 个 after-label 候选里
            // 14 个被这两条挡掉，而全部真待填点（签字行、日期行、表单标签）都保留。
            if (IsLabelOnlyParagraph(text, rawLabel) && IsFillAfterLabel(nextText))
            {
                AddCandidate(
                    candidates,
                    seen,
                    ref order,
                    kind: "after-label",
                    location: path,
                    dedupeScope: path,
                    text: "",
                    context: BuildContext(text, text.Length, 0),
                    suggestedName: FitName(rawLabel),
                    suggestedFillBy: SuggestFillBy(text),
                    target: paragraph,
                    start: text.Length,
                    length: 0);
            }
        }
    }

    /// <summary>
    /// 段落是不是「整段就一行标签」，例如「申请人名称（公章）：」。
    /// 去掉结尾冒号后应当与匹配到的标签等长；一旦多出条款号（3.1.1）或前缀（（4）），
    /// 就说明它是引导句而不是标签。
    /// </summary>
    static bool IsLabelOnlyParagraph(string text, string rawLabel)
    {
        if (rawLabel.Length == 0) return false;
        var head = text.Trim().TrimEnd('：', ':').Trim();
        return head.Length == rawLabel.Length;
    }

    /// <summary>
    /// 标签后面到底有没有空位。
    /// 标签段落后面若还跟着正文（列表项、说明段落、已填好的内容），它就是个引导句。
    /// 判据：下一块为空 / 也是标签 / 是「年 月 日」这类日期行。
    /// </summary>
    static bool IsFillAfterLabel(string nextText)
    {
        if (nextText.Length == 0) return true;
        if (nextText == NonParagraphMarker) return false;
        if (nextText.EndsWith("：", StringComparison.Ordinal)
            || nextText.EndsWith(":", StringComparison.Ordinal)) return true;
        return DateLinePattern.IsMatch(nextText);
    }

    const string NonParagraphMarker = "\u0000非段落";

    static bool IsSimpleParagraph(Wp.Paragraph paragraph)
    {
        if (paragraph.Descendants<Wp.FieldChar>().Any()
            || paragraph.Descendants<Wp.FieldCode>().Any()
            || paragraph.Descendants<Wp.Drawing>().Any()
            || paragraph.Descendants<Wp.DeletedRun>().Any()
            || paragraph.Descendants<Wp.InsertedRun>().Any()
            || paragraph.Descendants<Wp.Hyperlink>().Any())
        {
            return false;
        }

        if (!paragraph.ChildElements.All(item => item is Wp.ParagraphProperties or Wp.Run))
        {
            return false;
        }

        return paragraph.Elements<Wp.Run>()
            .All(run => run.ChildElements.All(item => item is Wp.RunProperties or Wp.Text));
    }

    static string ReadParagraphText(Wp.Paragraph paragraph)
    {
        var builder = new StringBuilder();
        foreach (var run in paragraph.Elements<Wp.Run>())
        {
            foreach (var text in run.Elements<Wp.Text>())
            {
                builder.Append(text.Text);
            }
        }
        return builder.ToString();
    }

    static List<(int Start, int Length)> FindUnderlinedWhitespace(Wp.Paragraph paragraph, string text)
    {
        var result = new List<(int Start, int Length)>();
        var offset = 0;
        foreach (var run in paragraph.Elements<Wp.Run>())
        {
            var runText = string.Concat(run.Elements<Wp.Text>().Select(item => item.Text));
            var underline = run.RunProperties?.Underline;
            if (underline is not null && underline.Val?.Value != Wp.UnderlineValues.None)
            {
                foreach (Match match in Regex.Matches(runText, @"[\s　]{2,}", RegexOptions.CultureInvariant))
                {
                    result.Add((offset + match.Index, match.Length));
                }
            }
            offset += runText.Length;
        }
        return result.Where(item => item.Start >= 0 && item.Start + item.Length <= text.Length).ToList();
    }

    static bool IsSimpleEmptyCell(Wp.TableCell cell, string text)
    {
        if (text.Length > 0) return false;
        if (cell.Elements<Wp.Table>().Any()
            || cell.Descendants<Wp.Drawing>().Any()
            || cell.Descendants<Wp.FieldChar>().Any()
            || cell.Descendants<Wp.SdtElement>().Any())
        {
            return false;
        }

        var merge = cell.TableCellProperties?.VerticalMerge;
        if (merge is not null && merge.Val?.Value != Wp.MergedCellValues.Restart) return false;
        return cell.Elements<Wp.Paragraph>().Count() == 1;
    }

    static string ReadCellText(Wp.TableCell cell)
    {
        return WordWorkspace.Normalize(string.Join(" ", cell.Elements<Wp.Paragraph>().Select(ReadParagraphText)));
    }

    /// <summary>同一行其它单元格的文本。空单元格是什么字段，主要靠行里的标签推。</summary>
    static string BuildRowContext(IReadOnlyList<string> rowTexts, int cellIndex)
    {
        var parts = new List<string>();
        for (var index = 0; index < rowTexts.Count; index += 1)
        {
            if (index == cellIndex || rowTexts[index].Length == 0) continue;
            parts.Add($"第{index + 1}列：{rowTexts[index]}");
        }
        return string.Join("；", parts);
    }

    /// <summary>
    /// 空单元格的上下文 = 本列列名 + 同行标签。
    ///
    /// 先给出本列的表头名。空单元格是什么字段，最直接的答案就是「它属于哪一列」，
    /// 而原来的上下文只有同行其它格，反而看不到这一列叫什么。
    /// </summary>
    static string BuildCellContext(
        IReadOnlyList<string> rowTexts,
        int cellIndex,
        IReadOnlyList<string> headerTexts,
        int rowIndex)
    {
        var rowContext = BuildRowContext(rowTexts, cellIndex);
        var columnLabel = ColumnLabel(headerTexts, cellIndex, rowIndex);
        if (columnLabel.Length == 0) return Limit(rowContext, 240);
        if (rowContext.Length == 0) return Limit($"本列表头：{columnLabel}", 240);
        return Limit($"本列表头：{columnLabel}；{rowContext}", 240);
    }

    /// <summary>取某一列可用的列名；不是合格的列名（太长、带句子标点）就当没有。</summary>
    static string ColumnLabel(IReadOnlyList<string> headerTexts, int cellIndex, int rowIndex)
    {
        if (rowIndex <= 0 || cellIndex >= headerTexts.Count) return "";
        var value = CleanName(WordWorkspace.Normalize(headerTexts[cellIndex]));
        if (value.Length == 0 || value.Length > 16) return "";
        // 带句子标点的「列名」其实是数据行（如整句的条款内容），不能当列名用。
        if (value.Any(ch => "，。；、：,".Contains(ch))) return "";
        return value;
    }

    /// <summary>
    /// 给表格空单元格取名。
    ///
    /// 取「本列的列名」＋「同行左侧最近的非空标签」两个来源：
    /// - 列名回答「这一列是干什么的」：如「编列内容」「物资」「备注」；
    /// - 行标签回答「这一行说的是谁」：如「总则」「注册地址」「最大月生产能力」。
    /// 两者都有时合成「列名（行标签）」，既能唯一区分又有语义。
    ///
    /// 只靠行标签会重名（同一行相邻的好几格推出来的名字一样），只靠列名也一样；
    /// 合起来才唯一。行内同名的相邻格再由 dedupeScope 合并成一个。
    /// </summary>
    static string SuggestCellName(
        IReadOnlyList<string> rowTexts,
        int cellIndex,
        IReadOnlyList<string> headerTexts,
        int rowIndex)
    {
        var rowLabel = "";
        for (var index = cellIndex - 1; index >= 0; index -= 1)
        {
            var value = CleanName(WordWorkspace.Normalize(rowTexts[index]));
            if (value.Length > 0)
            {
                rowLabel = value;
                break;
            }
        }

        var columnLabel = ColumnLabel(headerTexts, cellIndex, rowIndex);

        if (columnLabel.Length == 0) return Limit(FitName(rowLabel), 80);
        if (rowLabel.Length == 0 || rowLabel == columnLabel) return Limit(FitName(columnLabel), 80);
        // 行标签自己带括号说明时（「已签合同（月供应数量）」），合成名会出现套括号
        // （「物资（已签合同（月供应数量））」）。括号里的说明是补充信息，去掉更好读。
        var shortRowLabel = Regex.Replace(rowLabel, @"[（(][^（()）]*[）)]$", "").Trim();
        if (shortRowLabel.Length >= 2) rowLabel = shortRowLabel;
        return Limit(FitName($"{columnLabel}（{rowLabel}）"), 80);
    }

    static string BuildContext(string text, int start, int length)
    {
        var from = Math.Max(0, start - 80);
        var to = Math.Min(text.Length, start + length + 80);
        return Limit(text[from..to].Replace('\t', ' '), 200);
    }

    /// <summary>
    /// 从空位「前面」和「后面」两段文字里找字段名。
    ///
    /// 只看前面是不够的：模板里常见「你方在 ▁▁（谈判日期）参加的 ▁▁（项目名称）」，
    /// 真正的字段名写在空位**后面**的括号里。只看前面就会把正文句子截成
    /// 「你方在」这种碎片——实测 199 个候选里有 20 多个这种垃圾名字。
    ///
    /// 四条来源按可信度排序，全都取不到时**返回空**而不是硬截一段：
    /// 空名字只是信息少，错名字会直接把分类引到错的方向。
    /// </summary>
    static string SuggestName(string before, string after)
    {
        var head = WordWorkspace.Normalize(before ?? "");
        var tail = WordWorkspace.Normalize(after ?? "");

        var explicitName = ExplicitNamePattern.Match(head).Groups["name"].Value.Trim();
        if (explicitName.Length > 0) return FitName(explicitName);

        // ① 前置标签紧贴空位：「采购编号：▁▁」
        var label = TrailingLabelPattern.Match(head).Groups["label"].Value.Trim();
        if (label.Length > 0)
        {
            var fitted = FitName(DropUnbalancedPrefix(label));
            if (fitted.Length > 0) return fitted;
        }

        // ② 前置标签与空位之间隔着一个短后缀：「成立时间： ▁▁ 年 ▁▁ 月 ▁▁ 日」
        //    这里空位前面是「成立时间： 年」，末位不是冒号，① 匹配不到。
        //    判据是「最后一个冒号到空位之间只隔几个字」——超过就不敢认，
        //    免得把整句话的冒号当成字段标签。
        var colon = head.LastIndexOfAny(new[] { '：', ':' });
        if (colon >= 0 && head[(colon + 1)..].Trim().Length <= 8)
        {
            var segment = LastLabelSegment(head[..colon]);
            if (segment.Length > 0) return segment;
        }

        // ③ 后置括号提示：「▁▁（谈判日期）」
        var hint = FitName(ExtractHint(tail, leading: true));
        if (hint.Length > 0) return hint;

        // ④ 前置括号提示：「（谈判日期）▁▁」
        var beforeHint = FitName(ExtractHint(head, leading: false));
        if (beforeHint.Length > 0) return beforeHint;

        return "";
    }

    /// <summary>
    /// 从一段文字里取最后一个像字段名的片段。
    ///
    /// 只在「已确认冒号紧邻空位」的前提下调用。即便如此也要防住前缀：
    /// 「关于贵方 采购谈判采购文件（采购编号为： ▁▁」里，冒号前的整段有 20 多字，
    /// 真正要的是最后那节「采购编号为」。所以把空格与左括号也当作切分点。
    /// </summary>
    static string LastLabelSegment(string value)
    {
        // 先合并中文之间的空格再切：「数 量」要当成一个词「数量」，
        // 否则会被当成两段，取最后一段得到单字「量」。
        var cleaned = CleanName(value);
        var pieces = Regex.Split(cleaned, @"[\s，。；、：,;（(]+", RegexOptions.CultureInvariant)
            .Select(CleanName)
            .Where(item => item.Length is >= 1 and <= 30)
            .ToList();
        return pieces.LastOrDefault() ?? "";
    }

    /// <summary>
    /// 名字太长时收紧，仍然太长就放弃（返回空）。
    ///
    /// 长标签几乎都是从整句话里带出了定语：「并愿意与物资报价表相一致的合价总计人民币（小写）」
    /// 真正的字段名只有最后那截。中文里「的」就是定语与中心语的分界，取最后一个「的」之后的部分。
    /// 收不紧说明这个「标签」其实是一句话，宁可留空也不能拿它当字段名。
    /// </summary>
    static string FitName(string value)
    {
        var text = CleanName(value);
        if (text.Length <= 20) return text;
        var index = text.LastIndexOf('的');
        if (index >= 0 && text.Length - index - 1 >= 2) text = text[(index + 1)..];
        return text.Length <= 20 ? text : "";
    }

    /// <summary>
    /// 取括号提示里的名字。提示语自身可能带括号（如「（采购编号、物资品种、标段（包））」），
    /// 按「不含括号」截取会少一个右括号，这里补平。
    /// </summary>
    static string ExtractHint(string value, bool leading)
    {
        // 空位与提示之间常有一个空格（「▁▁ （谈判日期）」），先去掉再匹配，
        // 否则「必须以括号开头」的判据会因为这一个空格而失配。
        var text = (value ?? "").Trim();
        var match = (leading ? LeadingHintPattern : TrailingHintPattern).Match(text);
        if (!match.Success) return "";
        var name = match.Groups["name"].Value.Trim();
        var open = name.Count(ch => ch is '（' or '(');
        var close = name.Count(ch => ch is '）' or ')');
        while (open > close)
        {
            name += "）";
            close += 1;
        }
        return CleanName(name);
    }

    static string CleanName(string value)
    {
        var text = Regex.Replace(value ?? "", @"[\s＿_]+$", "").TrimStart();
        // 整体被一对括号包住时脱掉外层：「（成交供应商名称）」→「成交供应商名称」。
        // 但名字内部的括号是内容的一部分，必须留着——「申请人名称（公章）」里的
        // 「（公章）」说明了要盖什么章，削掉就成了半个词。
        if (text.Length > 2
            && (text[0] is '（' or '(')
            && (text[^1] is '）' or ')')
            && ParenCount(text[1..^1], open: true) == ParenCount(text[1..^1], open: false))
        {
            text = text[1..^1];
        }
        // 去掉编号前缀：「（1）制造物资的设施及有关情况」里「（1）」是条目号，不是名字的一部分。
        // 只在去掉后还剩两个字以上时才去，免得把名字本身削没。
        var stripped = LeadingNumberingPattern.Replace(text, "");
        if (stripped.Length >= 2) text = stripped;
        // 中文标签里的空格是排版需要（「电 话」「编 列 内 容」），不是词的一部分，去掉。
        // 只删「两个汉字之间」的空白，避免把英文标签（如 "Name of Bidder"）也连成一串。
        return Regex.Replace(text, @"(?<=[\p{IsCJKUnifiedIdeographs}])[\s]+(?=[\p{IsCJKUnifiedIdeographs}])", "").Trim();
    }

    static int ParenCount(string value, bool open)
    {
        return value.Count(ch => open ? ch is '（' or '(' : ch is '）' or ')');
    }

    /// <summary>
    /// 名字里有多出来的左括号时，切掉它以及它前面的部分。
    ///
    /// 「采购（采购编号」其实是「采购」和「采购编号」两截被括号连在一起，字段名是后者。
    /// 注意这和「标段（包」相反——那种是括号里的话还没说完（真正的右括号在捕获范围外），
    /// 由 ExtractHint 补齐，不能往前提刀。
    /// </summary>
    static string DropUnbalancedPrefix(string value)
    {
        if (ParenCount(value, open: true) <= ParenCount(value, open: false)) return value;
        var index = value.LastIndexOfAny(new[] { '（', '(' });
        return index >= 0 ? value[(index + 1)..] : value;
    }

    static string SuggestFillBy(string context)
    {
        return ManualPattern.IsMatch(context ?? "") ? "manual" : "ai";
    }

    static void AddCandidate(
        List<TemplateFieldCandidate> candidates,
        HashSet<string> seen,
        ref int order,
        string kind,
        string location,
        string dedupeScope,
        string text,
        string context,
        string suggestedName,
        string suggestedFillBy,
        OpenXmlElement target,
        int start,
        int length)
    {
        var identity = $"v1\u0000{location}\u0000{kind}\u0000{start}\u0000{length}\u0000{text}\u0000{context}";
        var candidateId = $"c_{Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity)))[..16].ToLowerInvariant()}";
        if (!seen.Add(candidateId)) return;

        // 再按「范围 + 字段名」去一次重。
        //
        // 段落上：underlined-space 和 after-label 是两套检测器，对「采购编号：______」
        // 这种写法指的都是**同一个待填位**，推出名字也一样，实测一份真实招标文件里
        // 这种重复有 72 个。全局 seen 的键按段落路径区分。
        //
        // 表格上：范围换成「行」。一行里相邻的几个空格往往属于同一个填写区
        // （如「申请人名称 | ______」横向合并成一整条），名字会是同一个
        // （如「申请人名称」），按格去重会产生 9 个只差格号的重复候选，
        // 按行去重后只剩 1 个。实测这一条把表格候选从 78 降到 39。
        //
        // 空名字不参与按名去重——否则同一范围里几个都叫不出名字的候选会被
        // 并成一个，那是丢信息而不是去重。此时退回按「起点+长度+类型」区分。
        var nameKey = suggestedName.Length > 0
            ? $"n\u0000{dedupeScope}\u0000{Limit(suggestedName, 80)}"
            : $"n\u0000{dedupeScope}\u0000{start}\u0000{length}\u0000{kind}";
        if (!seen.Add(nameKey)) return;

        candidates.Add(new TemplateFieldCandidate
        {
            CandidateId = candidateId,
            Kind = kind,
            Location = location,
            Text = Limit(text, 120),
            Context = Limit(context, 240),
            SuggestedName = Limit(suggestedName, 80),
            SuggestedFillBy = suggestedFillBy,
            Target = target,
            Start = start,
            Length = length,
            Order = order++,
        });
    }

    static string Limit(string value, int maxLength)
    {
        var text = value ?? "";
        return text.Length <= maxLength ? text : text[..maxLength];
    }
}
