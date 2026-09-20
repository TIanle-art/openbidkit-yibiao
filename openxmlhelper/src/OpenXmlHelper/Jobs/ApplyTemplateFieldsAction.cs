using System.Text;
using System.Text.Json;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;
using Wp = DocumentFormat.OpenXml.Wordprocessing;

namespace Yibiao.OpenXmlHelper.Jobs;

/// <summary>按 Agent 的候选分类生成带内容控件的最终模板及精简字段清单。</summary>
static class ApplyTemplateFieldsAction
{
    public const string Name = "apply-template-fields";

    public static JobResult Execute(string workspace, string jobId)
    {
        if (!TryReadRequest(workspace, jobId, out var request, out var error))
        {
            return JobResult.Fail(error);
        }

        string? tempDocumentPath = null;
        string? tempFieldsPath = null;
        try
        {
            var inputPath = WordWorkspace.ResolveWorkspacePath(workspace, request.Input);
            var outputPath = WordWorkspace.ResolveWorkspacePath(workspace, request.Output);
            var fieldsOutputPath = WordWorkspace.ResolveWorkspacePath(workspace, request.FieldsOutput);
            if (!File.Exists(inputPath)) return JobResult.Fail("投标模版源文件不存在");
            if (WordWorkspace.PathsEqual(inputPath, outputPath)) return JobResult.Fail("源模版和最终模版不能使用同一路径");

            Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
            Directory.CreateDirectory(Path.GetDirectoryName(fieldsOutputPath)!);
            tempDocumentPath = $"{outputPath}.{Guid.NewGuid():N}.tmp.docx";
            tempFieldsPath = $"{fieldsOutputPath}.{Guid.NewGuid():N}.tmp";
            File.Copy(inputPath, tempDocumentPath, overwrite: true);

            // 先在源文件上量一遍校验基线。
            //
            // 真实招标/模板文件常带着 Word 能容忍、但严格校验器不接受的历史问题：
            // 重复的 styleId、非规范的枚举值（如 w:val="start"）、w:pPr 子元素顺序等。
            // 这些大多来自 WPS / LibreOffice / PDF 转换 / 多文档合并，和「写内容控件」无关。
            // 直接把源文档的既有问题当失败，会让动作在所有真实文件上都跑不起来
            // （实测两份不同的真实 docx 都会在这里挂掉，报的还是两套完全不同的错）。
            // 所以只拦「本次写入新引入的」错误，做法是比对错误签名计数。
            Dictionary<string, int> baselineValidationCounts;
            using (var sourceDocument = WordprocessingDocument.Open(inputPath, false))
            {
                baselineValidationCounts = CollectValidationSignatureCounts(sourceDocument);
            }

            TemplateFieldDefinitionFile definitions;
            using (var document = WordprocessingDocument.Open(tempDocumentPath, true))
            {
                var candidates = TemplateFieldScanner.Scan(document);
                var normalized = NormalizeSelections(request, candidates);
                var mainPart = document.MainDocumentPart ?? throw new InvalidOperationException("投标模版缺少正文部件");
                var nextWordId = mainPart.Document.Descendants<Wp.SdtId>()
                    .Select(item => item.Val?.Value ?? 0)
                    .DefaultIfEmpty(0)
                    .Max() + 1;
                definitions = new TemplateFieldDefinitionFile();
                var applications = new List<(TemplateFieldCandidate Candidate, TemplateFieldDefinition Field, int WordId)>();
                foreach (var item in normalized.OrderBy(item => item.Candidate.Order))
                {
                    var field = new TemplateFieldDefinition
                    {
                        Id = $"f{definitions.Fields.Count + 1:D4}",
                        Name = item.Selection.Name,
                        FillBy = item.Selection.FillBy,
                        Instruction = item.Selection.Instruction,
                        Value = item.Selection.Value,
                    };
                    definitions.Fields.Add(field);
                    applications.Add((item.Candidate, field, nextWordId++));
                }

                foreach (var application in applications
                    .OrderByDescending(item => item.Candidate.Start)
                    .ThenByDescending(item => item.Candidate.Order))
                {
                    TemplateFieldSdtWriter.Apply(application.Candidate, application.Field, application.WordId);
                }

                mainPart.Document.Save();
                var introduced = CollectIntroducedValidationErrors(document, baselineValidationCounts);
                if (introduced.Count > 0)
                {
                    var details = string.Join("；", introduced.Take(10));
                    throw new InvalidOperationException($"投标模版 Open XML 校验失败（写入引入）：{details}");
                }
            }

            File.WriteAllText(
                tempFieldsPath,
                JsonSerializer.Serialize(definitions, JsonOptions.File) + "\n",
                new UTF8Encoding(false));
            File.Move(tempDocumentPath, outputPath, overwrite: true);
            tempDocumentPath = null;
            File.Move(tempFieldsPath, fieldsOutputPath, overwrite: true);
            tempFieldsPath = null;
            return JobResult.Success(Name, WordWorkspace.ToRelativePath(workspace, outputPath), definitions.Fields.Count);
        }
        catch (Exception exception)
        {
            return JobResult.Fail(exception.Message);
        }
        finally
        {
            TryDelete(tempDocumentPath);
            TryDelete(tempFieldsPath);
        }
    }

    static List<(TemplateFieldCandidate Candidate, TemplateFieldSelection Selection)> NormalizeSelections(
        ApplyTemplateFieldsRequest request,
        TemplateFieldCandidateFile candidateFile)
    {
        var candidateMap = candidateFile.Candidates.ToDictionary(item => item.CandidateId, StringComparer.Ordinal);
        var ignoredIds = (request.IgnoredCandidateIds ?? [])
            .Select(item => (item ?? "").Trim())
            .Where(item => item.Length > 0)
            .ToList();
        if (ignoredIds.Count != ignoredIds.Distinct(StringComparer.Ordinal).Count())
        {
            throw new InvalidOperationException("ignored_candidate_ids 存在重复项");
        }

        var selections = (request.Fields ?? []).Select(item => new TemplateFieldSelection
        {
            CandidateId = (item.CandidateId ?? "").Trim(),
            Name = (item.Name ?? "").Trim(),
            FillBy = (item.FillBy ?? "").Trim().ToLowerInvariant(),
            Instruction = string.IsNullOrWhiteSpace(item.Instruction) ? null : item.Instruction.Trim(),
            // 空串与空白一律当成「没值」：写了等于没写，还会把淡红底的待填标记吃掉，
            // 交付时看不出这格其实还空着。
            Value = string.IsNullOrWhiteSpace(item.Value) ? null : item.Value,
        }).ToList();
        if (selections.Any(item => item.CandidateId.Length == 0 || item.Name.Length == 0))
        {
            throw new InvalidOperationException("模板字段缺少 candidate_id 或 name");
        }
        // 四类来源的分工很实际：
        //   copy    = 采购编号/项目名称这类，值在招标文件原文里，照抄；
        //   profile = 企业资料库（营业执照、财务、业绩台账），取不到就留空；
        //   manual  = 签字盖章与报价，必须留给人；
        //   ai      = 项目自述类，才交给模型撰写。
        // 下游按 fill_by 决定「去哪儿取值」，所以这四类一个都不能合并——
        // 合并了就等于让模型去编采购编号和报价金额。
        if (selections.Any(item => item.FillBy is not ("ai" or "manual" or "profile" or "copy")))
        {
            throw new InvalidOperationException("fill_by 只能是 ai、manual、profile 或 copy");
        }
        if (selections.Select(item => item.CandidateId).Distinct(StringComparer.Ordinal).Count() != selections.Count)
        {
            throw new InvalidOperationException("模板字段 candidate_id 不能重复");
        }

        var classifiedIds = selections.Select(item => item.CandidateId)
            .Concat(ignoredIds)
            .ToList();
        if (classifiedIds.Distinct(StringComparer.Ordinal).Count() != classifiedIds.Count)
        {
            throw new InvalidOperationException("同一候选不能同时标记为字段和忽略");
        }
        var unknown = classifiedIds.Where(item => !candidateMap.ContainsKey(item)).ToList();
        if (unknown.Count > 0)
        {
            throw new InvalidOperationException($"存在无效候选：{string.Join('、', unknown)}");
        }
        var missing = candidateMap.Keys.Except(classifiedIds, StringComparer.Ordinal).ToList();
        if (missing.Count > 0)
        {
            throw new InvalidOperationException($"这些候选尚未分类：{string.Join('、', missing)}");
        }

        var inconsistent = selections
            .GroupBy(item => item.Name, StringComparer.Ordinal)
            .FirstOrDefault(group => group.Select(item => $"{item.FillBy}\u0000{item.Instruction ?? ""}").Distinct(StringComparer.Ordinal).Count() > 1);
        if (inconsistent is not null)
        {
            throw new InvalidOperationException($"同名字段的 fill_by 和 instruction 必须一致：{inconsistent.Key}");
        }

        return selections.Select(item => (candidateMap[item.CandidateId], item)).ToList();
    }

    /// <summary>
    /// 把校验错误压成「描述 + 所在部件」的签名并计数。
    ///
    /// 刻意不带 XPath：写入字段会让后续元素的路径整体位移，带上路径会让同一批既有
    /// 问题在前后两次校验里算出不同签名，从而被误判成「新引入」。
    /// 用计数比对即可覆盖「同样的错误变多了」这种情况。
    /// </summary>
    static Dictionary<string, int> CollectValidationSignatureCounts(WordprocessingDocument document)
    {
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var error in new OpenXmlValidator(FileFormatVersions.Microsoft365).Validate(document))
        {
            var key = $"{error.Description}|{error.Part?.Uri}";
            counts[key] = counts.TryGetValue(key, out var current) ? current + 1 : 1;
        }
        return counts;
    }

    /// <summary>返回超出基线的校验错误（即本次写入真正引入的），格式为「签名 ×数量」。</summary>
    static List<string> CollectIntroducedValidationErrors(
        WordprocessingDocument document,
        Dictionary<string, int> baselineCounts)
    {
        var introduced = new List<string>();
        foreach (var item in CollectValidationSignatureCounts(document))
        {
            baselineCounts.TryGetValue(item.Key, out var baseline);
            var delta = item.Value - baseline;
            if (delta > 0)
            {
                introduced.Add($"{item.Key} ×{delta}");
            }
        }
        introduced.Sort(StringComparer.Ordinal);
        return introduced;
    }

    static bool TryReadRequest(string workspace, string jobId, out ApplyTemplateFieldsRequest request, out string error)
    {
        request = new ApplyTemplateFieldsRequest();
        error = "";
        try
        {
            var path = Path.Combine(JobFolder.GetJobDirectory(workspace, jobId), JobFolder.RequestFileName);
            var parsed = JsonSerializer.Deserialize<ApplyTemplateFieldsRequest>(File.ReadAllText(path, Encoding.UTF8), JsonOptions.File);
            if (parsed is null
                || string.IsNullOrWhiteSpace(parsed.Input)
                || string.IsNullOrWhiteSpace(parsed.Output)
                || string.IsNullOrWhiteSpace(parsed.FieldsOutput))
            {
                error = "request.json 缺少 input、output 或 fields_output";
                return false;
            }
            request = parsed;
            request.Input = request.Input.Trim();
            request.Output = request.Output.Trim();
            request.FieldsOutput = request.FieldsOutput.Trim();
            return true;
        }
        catch (Exception exception)
        {
            error = $"无法读取 request.json：{exception.Message}";
            return false;
        }
    }

    static void TryDelete(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        try { File.Delete(path); } catch {}
    }
}
