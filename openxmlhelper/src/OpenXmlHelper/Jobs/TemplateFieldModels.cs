using System.Text.Json.Serialization;
using DocumentFormat.OpenXml;
using Wp = DocumentFormat.OpenXml.Wordprocessing;

namespace Yibiao.OpenXmlHelper.Jobs;

sealed class TemplateFieldCandidateFile
{
    public int Version { get; set; } = 1;
    public List<TemplateFieldCandidate> Candidates { get; set; } = [];
}

sealed class TemplateFieldCandidate
{
    [JsonPropertyName("candidate_id")]
    public string CandidateId { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Location { get; set; } = "";
    public string Text { get; set; } = "";
    public string Context { get; set; } = "";
    [JsonPropertyName("suggested_name")]
    public string SuggestedName { get; set; } = "";
    [JsonPropertyName("suggested_fill_by")]
    public string SuggestedFillBy { get; set; } = "ai";

    [JsonIgnore]
    public OpenXmlElement? Target { get; set; }

    [JsonIgnore]
    public int Start { get; set; }

    [JsonIgnore]
    public int Length { get; set; }

    [JsonIgnore]
    public int Order { get; set; }
}

sealed class TemplateFieldSelection
{
    [JsonPropertyName("candidate_id")]
    public string CandidateId { get; set; } = "";
    public string Name { get; set; } = "";
    [JsonPropertyName("fill_by")]
    public string FillBy { get; set; } = "";
    public string? Instruction { get; set; }
    /// <summary>
    /// 要写进控件里的真值。为空表示「还没取到值」，仍写占位符并保留淡红底。
    /// manual 字段永远不该带值——那是留给人签字盖章的位置。
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Value { get; set; }
}

sealed class TemplateFieldDefinitionFile
{
    public int Version { get; set; } = 1;
    public List<TemplateFieldDefinition> Fields { get; set; } = [];
}

sealed class TemplateFieldDefinition
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    [JsonPropertyName("fill_by")]
    public string FillBy { get; set; } = "";
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Instruction { get; set; }
    /// <summary>
    /// 实际写进文档的值；null 表示这个控件还是待填状态。
    /// 写进清单是为了交付时能一眼分清「哪些已填、哪些还空着」。
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Value { get; set; }
}

sealed class ScanTemplateFieldsRequest
{
    public string Action { get; set; } = "";
    public string Input { get; set; } = "";
}

sealed class ApplyTemplateFieldsRequest
{
    public string Action { get; set; } = "";
    public string Input { get; set; } = "";
    public string Output { get; set; } = "";
    [JsonPropertyName("fields_output")]
    public string FieldsOutput { get; set; } = "";
    public List<TemplateFieldSelection> Fields { get; set; } = [];
    [JsonPropertyName("ignored_candidate_ids")]
    public List<string> IgnoredCandidateIds { get; set; } = [];
}