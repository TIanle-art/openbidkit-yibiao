using DocumentFormat.OpenXml;
using Wp = DocumentFormat.OpenXml.Wordprocessing;

namespace Yibiao.OpenXmlHelper.Jobs;

/// <summary>将已确认候选确定性转换为带业务标识的 Word 内容控件。</summary>
static class TemplateFieldSdtWriter
{
    public const string TagPrefix = "yibiao:field:";
    public const string PlaceholderFill = "FCE8E6";
    public const string PlaceholderTextColor = "000000";

    public static void Apply(TemplateFieldCandidate candidate, TemplateFieldDefinition field, int wordId)
    {
        if (candidate.Target is Wp.SdtRun existing)
        {
            UpdateExistingControl(existing, field, wordId);
            return;
        }

        if (candidate.Target is Wp.SdtBlock existingBlock)
        {
            UpdateExistingBlockControl(existingBlock, field, wordId);
            return;
        }

        if (candidate.Target is not Wp.Paragraph paragraph)
        {
            throw new InvalidOperationException($"候选位置已失效：{candidate.CandidateId}");
        }

        ReplaceParagraphRange(paragraph, candidate.Start, candidate.Length, field, wordId);
    }

    static void UpdateExistingControl(Wp.SdtRun control, TemplateFieldDefinition field, int wordId)
    {
        var properties = control.SdtProperties ?? control.PrependChild(new Wp.SdtProperties());
        properties.RemoveAllChildren<Wp.SdtAlias>();
        properties.RemoveAllChildren<Wp.SdtId>();
        properties.RemoveAllChildren<Wp.Tag>();
        properties.AddChild(new Wp.SdtAlias { Val = field.Name }, throwOnError: true);
        properties.AddChild(new Wp.SdtId { Val = wordId }, throwOnError: true);
        properties.AddChild(new Wp.Tag { Val = $"{TagPrefix}{field.Id}" }, throwOnError: true);

        var content = control.SdtContentRun ?? control.AppendChild(new Wp.SdtContentRun());
        var sourceRun = content.Elements<Wp.Run>().FirstOrDefault();
        content.RemoveAllChildren();
        content.AppendChild(CreateContentRun(field, sourceRun));
    }

    static void UpdateExistingBlockControl(Wp.SdtBlock control, TemplateFieldDefinition field, int wordId)
    {
        var properties = control.SdtProperties ?? control.PrependChild(new Wp.SdtProperties());
        properties.RemoveAllChildren<Wp.SdtAlias>();
        properties.RemoveAllChildren<Wp.SdtId>();
        properties.RemoveAllChildren<Wp.Tag>();
        properties.AddChild(new Wp.SdtAlias { Val = field.Name }, throwOnError: true);
        properties.AddChild(new Wp.SdtId { Val = wordId }, throwOnError: true);
        properties.AddChild(new Wp.Tag { Val = $"{TagPrefix}{field.Id}" }, throwOnError: true);

        var content = control.SdtContentBlock ?? control.AppendChild(new Wp.SdtContentBlock());
        var sourceParagraph = content.Elements<Wp.Paragraph>().FirstOrDefault();
        var sourceRun = sourceParagraph?.Descendants<Wp.Run>().FirstOrDefault();
        var paragraph = new Wp.Paragraph();
        if (sourceParagraph?.ParagraphProperties is not null)
        {
            paragraph.AppendChild((Wp.ParagraphProperties)sourceParagraph.ParagraphProperties.CloneNode(true));
        }
        paragraph.AppendChild(CreateContentRun(field, sourceRun));
        content.RemoveAllChildren();
        content.AppendChild(paragraph);
    }

    static void ReplaceParagraphRange(
        Wp.Paragraph paragraph,
        int start,
        int length,
        TemplateFieldDefinition field,
        int wordId)
    {
        var runs = paragraph.Elements<Wp.Run>().ToList();
        var runTexts = runs.Select(ReadRunText).ToList();
        var totalLength = runTexts.Sum(item => item.Length);
        if (start < 0 || length < 0 || start + length > totalLength)
        {
            throw new InvalidOperationException($"模板字段位置已漂移：{field.Name}");
        }

        var control = CreateControl(field, wordId, FindStyleRun(runs, runTexts, start));
        if (runs.Count == 0)
        {
            if (start != 0 || length != 0) throw new InvalidOperationException($"模板字段位置已漂移：{field.Name}");
            paragraph.AppendChild(control);
            return;
        }

        if (length == 0)
        {
            InsertAt(paragraph, runs, runTexts, start, control);
            return;
        }

        var end = start + length;
        var firstIndex = FindRunIndex(runTexts, start, preferNextAtBoundary: true);
        var lastIndex = FindRunIndex(runTexts, end, preferNextAtBoundary: false);
        if (firstIndex < 0 || lastIndex < firstIndex)
        {
            throw new InvalidOperationException($"模板字段位置已漂移：{field.Name}");
        }

        var firstStart = runTexts.Take(firstIndex).Sum(item => item.Length);
        var lastStart = runTexts.Take(lastIndex).Sum(item => item.Length);
        var prefix = runTexts[firstIndex][..(start - firstStart)];
        var suffix = runTexts[lastIndex][(end - lastStart)..];
        var firstRun = runs[firstIndex];
        var lastRun = runs[lastIndex];

        if (prefix.Length > 0) firstRun.InsertBeforeSelf(CreateTextRun(prefix, firstRun));
        firstRun.InsertBeforeSelf(control);
        if (suffix.Length > 0) firstRun.InsertBeforeSelf(CreateTextRun(suffix, lastRun));
        for (var index = firstIndex; index <= lastIndex; index += 1)
        {
            runs[index].Remove();
        }
    }

    static void InsertAt(
        Wp.Paragraph paragraph,
        IReadOnlyList<Wp.Run> runs,
        IReadOnlyList<string> runTexts,
        int start,
        Wp.SdtRun control)
    {
        var totalLength = runTexts.Sum(item => item.Length);
        if (start == totalLength)
        {
            runs[^1].InsertAfterSelf(control);
            return;
        }

        var runIndex = FindRunIndex(runTexts, start, preferNextAtBoundary: true);
        if (runIndex < 0)
        {
            paragraph.AppendChild(control);
            return;
        }

        var runStart = runTexts.Take(runIndex).Sum(item => item.Length);
        var offset = start - runStart;
        var run = runs[runIndex];
        var text = runTexts[runIndex];
        if (offset == 0)
        {
            run.InsertBeforeSelf(control);
            return;
        }

        var prefix = text[..offset];
        var suffix = text[offset..];
        if (prefix.Length > 0) run.InsertBeforeSelf(CreateTextRun(prefix, run));
        run.InsertBeforeSelf(control);
        if (suffix.Length > 0) run.InsertBeforeSelf(CreateTextRun(suffix, run));
        run.Remove();
    }

    static int FindRunIndex(IReadOnlyList<string> runTexts, int offset, bool preferNextAtBoundary)
    {
        var cursor = 0;
        for (var index = 0; index < runTexts.Count; index += 1)
        {
            var next = cursor + runTexts[index].Length;
            if (offset < next || (!preferNextAtBoundary && offset == next && runTexts[index].Length > 0))
            {
                return index;
            }
            cursor = next;
        }
        return -1;
    }

    static Wp.Run? FindStyleRun(IReadOnlyList<Wp.Run> runs, IReadOnlyList<string> runTexts, int start)
    {
        if (runs.Count == 0) return null;
        var index = FindRunIndex(runTexts, start, preferNextAtBoundary: true);
        return index >= 0 ? runs[index] : runs[^1];
    }

    static Wp.SdtRun CreateControl(TemplateFieldDefinition field, int wordId, Wp.Run? sourceRun)
    {
        var properties = new Wp.SdtProperties(
            new Wp.SdtAlias { Val = field.Name },
            new Wp.SdtId { Val = wordId },
            new Wp.Tag { Val = $"{TagPrefix}{field.Id}" });
        var content = new Wp.SdtContentRun(CreateContentRun(field, sourceRun));
        return new Wp.SdtRun(properties, content);
    }

    /// <summary>有真值就写真值，没有就写占位符。两处的底纹故意不同，见各自说明。</summary>
    static Wp.Run CreateContentRun(TemplateFieldDefinition field, Wp.Run? sourceRun)
    {
        return string.IsNullOrEmpty(field.Value)
            ? CreatePlaceholderRun(field, sourceRun)
            : CreateValueRun(field, sourceRun);
    }

    /// <summary>
    /// 已取到值的控件：写值，并且**不**上淡红底。
    ///
    /// 淡红底是「这格还没处理」的标记；填了值还标红，交付时人眼分不清哪些真的空着。
    /// 颜色也不动——沿用原文 run 的字色，免得一片黑字里冒出异色。
    /// </summary>
    static Wp.Run CreateValueRun(TemplateFieldDefinition field, Wp.Run? sourceRun)
    {
        var properties = sourceRun?.RunProperties is null
            ? new Wp.RunProperties()
            : (Wp.RunProperties)sourceRun.RunProperties.CloneNode(true);
        properties.RemoveAllChildren<Wp.Shading>();
        return new Wp.Run(
            properties,
            new Wp.Text(field.Value ?? "") { Space = SpaceProcessingModeValues.Preserve });
    }

    /// <summary>
    /// 占位符文案长度上限（以字段名为准，超了就退回短标记）。
    ///
    /// 占位符是写在原本空着的下划线/空格上的，写长了会把原本一行的落款撑成两行——
    /// 实测「【人工处理：法定代表人或其授权代理人签字】」20 多个字，直接把响应函的
    /// 签署行折行，等于改了版式。而字段名本身没丢：它同时写进了 w:alias，
    /// 在 Word 的内容控件属性、以及 apply 产出的字段清单里都能查到。
    /// </summary>
    const int MaxInlineNameLength = 4;

    static Wp.Run CreatePlaceholderRun(TemplateFieldDefinition field, Wp.Run? sourceRun)
    {
        var properties = sourceRun?.RunProperties is null
            ? new Wp.RunProperties()
            : (Wp.RunProperties)sourceRun.RunProperties.CloneNode(true);
        properties.RemoveAllChildren<Wp.Color>();
        properties.RemoveAllChildren<Wp.Shading>();
        properties.AddChild(new Wp.Color { Val = PlaceholderTextColor }, throwOnError: true);
        properties.AddChild(
            new Wp.Shading
            {
                Val = Wp.ShadingPatternValues.Clear,
                Color = "auto",
                Fill = PlaceholderFill,
            },
            throwOnError: true);
        // 人工签署类一律用短标记：这些字段最终必须由人动手，标记要最显眼；
        // 其余字段名字短就直接显示名字（可读），名字长才退回「【待填】」。
        var name = field.Name ?? "";
        var label = field.FillBy == "manual"
            ? "【人工】"
            : (name.Length > 0 && name.Length <= MaxInlineNameLength ? $"【{name}】" : "【待填】");
        return new Wp.Run(
            properties,
            new Wp.Text(label) { Space = SpaceProcessingModeValues.Preserve });
    }

    static Wp.Run CreateTextRun(string text, Wp.Run sourceRun)
    {
        var run = new Wp.Run();
        if (sourceRun.RunProperties is not null)
        {
            run.AppendChild((Wp.RunProperties)sourceRun.RunProperties.CloneNode(true));
        }
        run.AppendChild(new Wp.Text(text) { Space = SpaceProcessingModeValues.Preserve });
        return run;
    }

    static string ReadRunText(Wp.Run run)
    {
        return string.Concat(run.Elements<Wp.Text>().Select(item => item.Text));
    }
}
