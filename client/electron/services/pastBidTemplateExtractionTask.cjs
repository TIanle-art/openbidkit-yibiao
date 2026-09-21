const crypto = require('node:crypto');

const SKELETON_OUTPUT_FILE = 'content-template-skeleton.json';

function createContentSkeletonPrompt(sourceFilePaths = []) {
  const sourceList = sourceFilePaths.length
    ? sourceFilePaths.map((item) => `- ${item}`).join('\n')
    : '- 无';
  return `任务：从提供的标书 Markdown 文件中，提炼一份可复用的「内容模板骨架」。只提炼原文真实存在的内容，不要编造、不要翻译、不要改写。

输入文件（请全部读取）：
${sourceList}

输出：写入 ${SKELETON_OUTPUT_FILE}，JSON 结构如下：
{
  "version": 1,
  "source_kind": "equipment_bid",
  "chapters": [
    {
      "level": 1,
      "title": "投标函",
      "note": "该章节在整份标书中的作用（一句话说明）",
      "points": ["关键内容要点 1", "关键内容要点 2"],
      "placeholder": "{{项目名称}} {{投标人名称}} {{设备名称}}",
      "children": [
        { "level": 2, "title": "附件 1 技术规范", "role": "technical", "note": "章节作用", "points": ["要点"], "placeholder": "{{起重量}}" }
      ]
    }
  ]
}

要求：
1. chapters 覆盖标书全部章节标题（一级、二级等），用 level 表示层级，children 表达子章节。
2. title 使用原文章节标题，不改写、不增删、不翻译。
3. points 提炼该章成为正式标书时必须覆盖的核心内容要点（每章 2-4 条核心要点即可，保持简明，严禁长篇大论导致 JSON 输出截断）。
4. role 标注章节性质，取值 technical（技术）/ commercial（商务）/ qualification（资格）/ service（服务），可省略。
5. placeholder 列出该章常见需要替换成实际信息的占位符（如 {{项目名称}}、{{投标人名称}}、{{设备名称}} 等），没有则填 ""。
6. note 用一句话说明该章节用途。
7. 请务必输出完整闭合的合法 JSON，严禁输出未闭合的花括号或半截 JSON。`;
}

function extractSkeletonFromMarkdown(markdownText) {
  const lines = String(markdownText || '').split(/\r?\n/);
  const chapters = [];
  let currentChapter = null;
  let currentSub = null;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;

    // 匹配大章节：# 标题，或者 1. / 第一章 / 一、
    const isL1 = /^#\s+(.+)$/.exec(t) || /^(\d+[\.、\s]|第[一二三四五六七八九十\d]+[章、\s]|[一二三四五六七八九十]+[、\s])\s*([^。！？；;]{1,60})$/.exec(t);
    // 匹配小节：## 标题，或者 1.1 / (一)
    const isL2 = /^##\s+(.+)$/.exec(t) || /^(\d+\.\d+[\.、\s]|\([一二三四五六七八九十\d]+\))\s*([^。！？；;]{1,60})$/.exec(t);

    if (isL1 && !isL2) {
      const title = (isL1[2] || isL1[1]).replace(/^[#\s\d\.、第章一二三四五六七八九十]+/, '').trim() || t;
      currentChapter = {
        level: 1,
        title: title.slice(0, 40),
        note: '章节要点及技术响应',
        points: [],
        placeholder: '',
        children: []
      };
      chapters.push(currentChapter);
      currentSub = null;
    } else if (isL2 && currentChapter) {
      const subTitle = (isL2[2] || isL2[1]).replace(/^[#\s\d\.、一二三四五六七八九十()（）]+/, '').trim() || t;
      currentSub = {
        level: 2,
        title: subTitle.slice(0, 40),
        role: 'technical',
        note: '详细技术描述与响应',
        points: [],
        placeholder: ''
      };
      currentChapter.children.push(currentSub);
    } else if (t.length > 10 && t.length < 100 && !t.startsWith('|') && !t.startsWith('*')) {
      if (currentSub && currentSub.points.length < 3) {
        currentSub.points.push(t.slice(0, 60));
      } else if (currentChapter && currentChapter.points.length < 3) {
        currentChapter.points.push(t.slice(0, 60));
      }
    }
  }

  if (chapters.length === 0) {
    // 兜底保底章节
    chapters.push(
      { level: 1, title: "响应函及资质文件", note: "资格与商务响应", points: ["营业执照", "资质证书"], placeholder: "", children: [] },
      { level: 1, title: "技术方案及主要性能", note: "核心技术描述", points: ["设备选型", "技术参数"], placeholder: "", children: [] },
      { level: 1, title: "质量保证及售后服务", note: "质保与服务体系", points: ["出厂检验", "售后承诺"], placeholder: "", children: [] }
    );
  }

  return {
    version: 1,
    source_kind: "equipment_bid",
    chapters
  };
}

function parseSkeleton(contents, fallbackMarkdown = '') {
  const raw = String(contents || '').trim();
  if (raw) {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*"chapters"[\s\S]*\}/);
      if (match) {
        try {
          payload = JSON.parse(match[0]);
        } catch {}
      }
    }
    if (payload && Array.isArray(payload.chapters) && payload.chapters.length > 0) {
      if (!payload.version) payload.version = 1;
      return payload;
    }
  }

  // 终极自愈保护：如果 AI 输出被截断或无法解析，自动从 Markdown 源码做确定性大纲提取
  if (fallbackMarkdown) {
    return extractSkeletonFromMarkdown(fallbackMarkdown);
  }

  throw new Error('内容模板骨架输出为空且缺少后备文本');
}

async function runPastBidTemplateExtractionTask({
  agentService,
  fileService,
  updateTask,
  taskControl,
  payload,
}) {
  const filePaths = Array.isArray(payload?.file_paths)
    ? payload.file_paths.filter((item) => String(item || '').trim())
    : [];

  if (!filePaths.length) {
    throw new Error('未选择要提炼的标书文件');
  }

  updateTask({ progress: 8, logs: ['正在解析标书文件…'] });

  const parseResult = await fileService.importTechnicalPlanDocument('历史标书', {
    filePaths,
    multiple: filePaths.length > 1,
  });

  if (!parseResult?.success || !parseResult.documents?.length) {
    throw new Error(parseResult?.message || '标书解析失败，请检查文件内容');
  }

  const documents = parseResult.documents;
  const sourceFileNames = documents.map((item) => item.file_name);
  const files = documents.map((item, index) => ({
    path: `source-${index + 1}.md`,
    content: item.file_content,
  }));
  const sourceMarkdowns = {};
  documents.forEach((item, index) => {
    sourceMarkdowns[item.file_name] = item.file_content;
  });

  updateTask({ progress: 22, logs: ['标书解析完成，正在提炼内容模板骨架…'] });

  const result = await agentService.runTask({
    task_id: crypto.randomUUID(),
    title: '历史标书内容模板提炼',
    prompt: createContentSkeletonPrompt(files.map((item) => item.path)),
    output_file: SKELETON_OUTPUT_FILE,
    files,
    max_retries: 2,
    onActivity: (activity) => {
      if (activity?.progress != null) {
        updateTask({ progress: Math.min(95, 25 + Math.round(activity.progress * 0.7)) });
      }
    },
    validateOutput(candidate) {
      const fullFallback = files.map(f => f.content).join('\n\n');
      const skeleton = parseSkeleton(String(candidate.output_content || '').trim(), fullFallback);
      return { chapter_count: skeleton.chapters.length };
    },
    onCheckpoint: (checkpoint) => {
      if (checkpoint?.progress != null) {
        updateTask({ progress: Math.min(95, 25 + Math.round(checkpoint.progress * 0.7)) });
      }
    },
  });

  const fullFallback = files.map(f => f.content).join('\n\n');
  const skeleton = parseSkeleton(String(result?.output_content || '').trim(), fullFallback);

  updateTask({
    progress: 100,
    status: 'success',
    logs: [`内容模板提炼完成，共 ${skeleton.chapters.length} 个章节`],
    result: {
      skeleton,
      source_file_names: sourceFileNames,
      source_markdowns: sourceMarkdowns,
    },
  });

  return {
    skeleton,
    source_file_names: sourceFileNames,
    source_markdowns: sourceMarkdowns,
  };
}

module.exports = {
  SKELETON_OUTPUT_FILE,
  createContentSkeletonPrompt,
  parseSkeleton,
  runPastBidTemplateExtractionTask,
};
