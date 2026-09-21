import { useState, useEffect } from 'react';
import { useToast } from '../../../shared/ui';
import type { ExportFormatConfig, ExportTemplateRecord } from '../../../shared/types/exportFormat';
import type { SectionId } from '../../../shared/types/navigation';
import type { BidTemplateChapter, BidTemplateSkeleton, PastBidTemplateRecord } from '../../../shared/types/ipc';

interface PastBidTemplatePageProps {
  onSectionChange?: (section: SectionId) => void;
}

interface DeriveSummary {
  paper: string;
  marginsCm: number[];
  headingFont?: string;
  headingSize?: string;
  bodyFont?: string;
  bodySize?: string;
  derivedHeadingLevels: number;
  note?: string;
}

interface ExtractResult {
  skeleton: BidTemplateSkeleton;
  source_file_names: string[];
  source_markdowns: Record<string, string>;
}

function skeletonToMarkdown(skeleton: BidTemplateSkeleton | null): string {
  if (!skeleton) return '';
  const lines: string[] = [];
  const walk = (chapters: BidTemplateChapter[], depth: number) => {
    for (const chapter of chapters) {
      const prefix = `${'#'.repeat(Math.min(6, depth + 1))} `;
      lines.push(`${prefix}${chapter.title}`);
      if (chapter.note) lines.push(`> ${chapter.note}`);
      for (const point of chapter.points || []) lines.push(`- ${point}`);
      if (chapter.placeholder) lines.push(`**待填：** ${chapter.placeholder}`);
      if (chapter.children?.length) {
        lines.push('');
        walk(chapter.children, depth + 1);
      }
      lines.push('');
    }
  };
  walk(skeleton.chapters || [], 0);
  return lines.join('\n').trim();
}

function countChapters(chapters: BidTemplateChapter[] | undefined): number {
  return (chapters || []).reduce(
    (sum, chapter) => sum + 1 + countChapters(chapter.children),
    0,
  );
}

function PastBidTemplatePage({ onSectionChange }: PastBidTemplatePageProps) {
  const { showToast } = useToast();

  // ── 内容模板（主） ─────────────────────────────
  const [mode, setMode] = useState<'content' | 'layout'>('content');
  const [extractTask, setExtractTask] = useState<{ status: string; progress: number; logs: string[] } | null>(null);
  const [skeleton, setSkeleton] = useState<BidTemplateSkeleton | null>(null);
  const [sourceFileNames, setSourceFileNames] = useState<string[]>([]);
  const [sourceMarkdowns, setSourceMarkdowns] = useState<Record<string, string>>({});
  const [templateName, setTemplateName] = useState('');
  const [templates, setTemplates] = useState<PastBidTemplateRecord[]>([]);
  const [layoutTemplates, setLayoutTemplates] = useState<ExportTemplateRecord[]>([]);
  const [selectedLayoutTemplateId, setSelectedLayoutTemplateId] = useState('');
  const [savedTemplateId, setSavedTemplateId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  // ── 导出排版模板（次要，保留） ─────────────────
  const [deriving, setDeriving] = useState(false);
  const [config, setConfig] = useState<ExportFormatConfig | null>(null);
  const [summary, setSummary] = useState<DeriveSummary | null>(null);
  const [fileName, setFileName] = useState('');
  const [layoutName, setLayoutName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    window.yibiao?.pastBidTemplate?.list().then(setTemplates).catch(() => undefined);
    window.yibiao?.templates?.list().then((items) => {
      setLayoutTemplates(items || []);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const unsubscribe = window.yibiao?.tasks?.onTaskEvent((event) => {
      const task = event?.task;
      if (!task || task.type !== 'past-bid-template-extraction') return;
      setExtractTask({ status: task.status, progress: task.progress, logs: task.logs || [] });
      if (task.status === 'success' && task.result) {
        const result = task.result as ExtractResult;
        setSkeleton(result.skeleton);
        setSourceFileNames(result.source_file_names || []);
        setSourceMarkdowns(result.source_markdowns || {});
        setSavedTemplateId(null);
        setExportOpen(false);
        if (!templateName) setTemplateName('历史标书内容模板');
        showToast('内容模板提炼完成，请核对后保存', 'success');
      }
      if (task.status === 'error') {
        showToast(task.error || '内容模板提炼失败', 'error');
      }
    });
    return () => unsubscribe?.();
  }, [showToast, templateName]);

  const handleExtract = async () => {
    setExtractTask({ status: 'running', progress: 0, logs: ['正在启动…'] });
    setSkeleton(null);
    setSourceFileNames([]);
    setSourceMarkdowns({});
    setTemplateName('');
    setSavedTemplateId(null);
    setExportOpen(false);
    try {
      const result = await window.yibiao?.pastBidTemplate?.startExtract();
      if (!result?.success) {
        showToast(result?.message || '未选择文件', 'info');
        setExtractTask(null);
        return;
      }
      showToast('已开始提炼历史标书内容模板', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '启动提炼失败', 'error');
      setExtractTask(null);
    }
  };

  const handleSaveContentTemplate = async () => {
    if (!skeleton) return;
    if (!templateName.trim()) {
      showToast('请先填写模板名称', 'info');
      return;
    }
    try {
      const record = await window.yibiao?.pastBidTemplate?.create({
        template_name: templateName.trim(),
        skeleton,
        source_file_names: sourceFileNames,
        source_markdowns: sourceMarkdowns,
      });
      if (record?.template_id) {
        showToast('已保存到历史标书内容模板', 'success');
        setSavedTemplateId(record.template_id);
        setExportOpen(false);
        setTemplates(await window.yibiao?.pastBidTemplate?.list());
      } else {
        showToast('保存失败', 'error');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存内容模板失败', 'error');
    }
  };

  const handleCopySkeleton = async () => {
    const text = skeletonToMarkdown(skeleton);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast('已复制内容模板为 Markdown', 'success');
    } catch {
      showToast('复制失败', 'error');
    }
  };

  const handleExportMarkdown = async () => {
    const text = skeletonToMarkdown(skeleton);
    if (!text) return;
    try {
      const result = await window.yibiao?.pastBidTemplate?.saveMarkdown({
        suggested_name: templateName.trim() || '内容模板',
        content: text,
      });
      if (result?.success) {
        showToast('已导出为 Markdown 文件', 'success');
      } else {
        showToast(result?.message || '导出失败', 'info');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导出失败', 'error');
    }
  };

  const handleExportWord = async () => {
    if (!skeleton) return;
    try {
      const result = await window.yibiao?.pastBidTemplate?.exportWord({
        suggested_name: templateName.trim() || '内容模板',
        skeleton,
        template_id: selectedLayoutTemplateId || undefined,
      });
      if (result?.success) {
        showToast('已导出为 Word 模板', 'success');
      } else {
        showToast(result?.message || '导出失败', 'info');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导出失败', 'error');
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    try {
      const result = await window.yibiao?.pastBidTemplate?.delete(templateId);
      if (result?.success) {
        showToast('模板已删除', 'success');
        setTemplates(await window.yibiao?.pastBidTemplate?.list());
      } else {
        showToast(result?.message || '删除失败', 'error');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '删除失败', 'error');
    }
  };

  const renderChapters = (chapters: BidTemplateChapter[] = [], depth = 0) => (
    <div className="pbt-skeleton" style={{ marginLeft: depth > 0 ? 16 : 0 }}>
      {chapters.map((chapter, index) => (
        <div className="pbt-skeleton-chapter" key={`${chapter.title}-${index}`}>
          <div className="pbt-skeleton-chapter-title">
            {chapter.level || depth + 1}. {chapter.title}
          </div>
          {chapter.note ? <p className="pbt-skeleton-note">{chapter.note}</p> : null}
          {chapter.points?.length ? (
            <ul className="pbt-skeleton-points">
              {chapter.points.map((point, pointIndex) => (
                <li key={pointIndex}>{point}</li>
              ))}
            </ul>
          ) : null}
          {chapter.placeholder ? (
            <div className="pbt-skeleton-placeholder">待填：{chapter.placeholder}</div>
          ) : null}
          {chapter.children?.length ? renderChapters(chapter.children, depth + 1) : null}
        </div>
      ))}
    </div>
  );

  // ── 现有导入标书生成导出排版模板流程 ─────────────
  const handleImport = async () => {
    setDeriving(true);
    setSaved(false);
    try {
      const result = await window.yibiao?.templates.deriveFromFile();
      if (!result?.success || !result.config) {
        showToast(result?.message || '未选择文件', 'info');
        return;
      }
      setConfig(result.config);
      setSummary(result.summary || null);
      const baseName = (result.fileName || '').replace(/\.docx$/i, '');
      setFileName(result.fileName || '');
      setLayoutName(baseName || result.config.template_name || '导入模版');
      showToast('已从标书读取排版，可核对后保存为模版', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '推导排版失败', 'error');
    } finally {
      setDeriving(false);
    }
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const record = await window.yibiao?.templates.create({ ...config, template_name: layoutName.trim() || config.template_name });
      if (record?.template_id) {
        setSaved(true);
        showToast('已保存到「我的模板」', 'success');
      } else {
        showToast('保存失败', 'error');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存模版失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pbt-page pbt-page-single">
      <div className="pbt-mode-tabs">
        <button type="button" className={`pbt-mode-tab ${mode === 'content' ? 'pbt-mode-tab-active' : ''}`} onClick={() => setMode('content')}>
          内容模板
        </button>
        <button type="button" className={`pbt-mode-tab ${mode === 'layout' ? 'pbt-mode-tab-active' : ''}`} onClick={() => setMode('layout')}>
          导出排版模板
        </button>
      </div>

      {mode === 'content' ? (
        <section className="pbt-panel" aria-label="历史标书内容模板">
          <div className="pbt-head">
            <div>
              <span className="section-kicker">历史标书内容模板</span>
              <h2>从过往标书提炼内容模板</h2>
              <p>导入一份往期投标文件（.docx / .pdf），自动提炼章节目录骨架、每章内容要点与待填占位符，保存后可复用于新标书。</p>
            </div>
            <button type="button" className="primary-action" onClick={handleExtract} disabled={extractTask?.status === 'running'}>
              导入标书（.docx / .pdf）
            </button>
          </div>

          <div className="pbt-body">
            {extractTask && extractTask.status === 'running' ? (
              <div className="pbt-progress">
                <div className="pbt-progress-bar">
                  <div className="pbt-progress-fill" style={{ width: `${Math.max(2, extractTask.progress ?? 2)}%` }} />
                </div>
                <ul className="pbt-progress-logs">
                  {(extractTask.logs || []).map((log, index) => (
                    <li key={index}>{log}</li>
                  ))}
                </ul>
                <p className="pbt-hint">长标书解析与 AI 提炼需要几分钟，请稍候。你可以在处理中离开本页，任务会继续。</p>
              </div>
            ) : skeleton ? (
              <div className="pbt-result">
                <div className="pbt-result-head">
                  <div>
                    <span className="section-kicker">提炼结果</span>
                    <h3>内容模板骨架（{skeleton.chapters.length} 个一级章节）</h3>
                  </div>
                </div>

                <div className="pbt-summary-grid">
                  <div className="pbt-summary-item">
                    <span>来源标书</span>
                    <strong>{sourceFileNames.join('、') || '—'}</strong>
                  </div>
                  <div className="pbt-summary-item">
                    <span>章节总数</span>
                    <strong>{countChapters(skeleton.chapters)} 个</strong>
                  </div>
                </div>

                <div className="pbt-skeleton">
                  {renderChapters(skeleton.chapters)}
                </div>

                <label className="pbt-field">
                  <span>模板名称</span>
                  <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="给这个内容模板起个名字" />
                </label>

                <div className="pbt-actions">
                  {savedTemplateId ? (
                    <button type="button" className="primary-action" onClick={() => setExportOpen((open) => !open)}>
                      {exportOpen ? '收起导出' : '导出'}
                    </button>
                  ) : (
                    <button type="button" className="primary-action" onClick={handleSaveContentTemplate}>
                      保存内容模板
                    </button>
                  )}
                  <button type="button" className="secondary-action" onClick={handleCopySkeleton}>
                    复制为 Markdown
                  </button>
                </div>

                {exportOpen ? (
                  <div className="pbt-export-options">
                    <label className="pbt-field">
                      <span>导出 Word 时套用的排版模板</span>
                      <select value={selectedLayoutTemplateId} onChange={(event) => setSelectedLayoutTemplateId(event.target.value)}>
                        <option value="">使用系统默认排版</option>
                        {layoutTemplates.map((template) => (
                          <option key={template.template_id} value={template.template_id}>{template.template_name}</option>
                        ))}
                      </select>
                    </label>
                    <div className="pbt-actions">
                      <button type="button" className="secondary-action" onClick={handleExportWord}>
                        导出为 Word
                      </button>
                      <button type="button" className="secondary-action" onClick={handleExportMarkdown}>
                        导出为 Markdown
                      </button>
                    </div>
                    <p className="pbt-hint">Word 格式按所选排版模板排版（含封面、目录、编号、页眉页脚）；Markdown 为纯文本结构骨架。</p>
                  </div>
                ) : null}
              </div>
            ) : templates.length ? (
              <div className="pbt-template-list">
                {templates.map((record) => (
                  <div className="pbt-template-card" key={record.template_id}>
                    <div className="pbt-template-card-head">
                      <span className="pbt-template-card-title">{record.template_name}</span>
                      <span className="pbt-template-card-meta">
                        {countChapters(record.skeleton?.chapters)} 章节
                      </span>
                    </div>
                    <div className="pbt-template-card-meta">
                      来源：{record.source_file_names.join('、') || '—'}
                    </div>
                    <div className="pbt-template-card-actions">
                      <button type="button" className="text-button" onClick={() => { setSkeleton(record.skeleton); setSourceFileNames(record.source_file_names || []); setSourceMarkdowns({}); setTemplateName(record.template_name); setExtractTask(null); setSavedTemplateId(record.template_id); setExportOpen(false); }}>
                        查看
                      </button>
                      <button type="button" className="text-button" onClick={async () => {
                        const text = skeletonToMarkdown(record.skeleton);
                        if (!text) return;
                        const result = await window.yibiao?.pastBidTemplate?.saveMarkdown({ suggested_name: record.template_name, content: text });
                        showToast(result?.success ? '已导出为 Markdown 文件' : (result?.message || '导出失败'), result?.success ? 'success' : 'info');
                      }}>
                        导出
                      </button>
                      <button type="button" className="text-button" onClick={() => handleDeleteTemplate(record.template_id)}>
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="pbt-empty">
                <strong>还没有历史标书内容模板</strong>
                <span>点击右上角「导入标书」，系统会解析该文件并提炼出可复用的章节骨架与内容要点。</span>
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className="pbt-panel" aria-label="导入标书生成导出排版模版">
          <div className="pbt-head">
            <div>
              <span className="section-kicker">模版设置</span>
              <h2>导入标书生成导出排版模版</h2>
              <p>选择一份以往标书（.docx / .pdf），自动读取其纸张、边距、标题与正文样式，生成可复用的 Word 导出排版模版。</p>
            </div>
            <button type="button" className="primary-action" onClick={handleImport} disabled={deriving}>
              {deriving ? '读取中…' : '导入标书（.docx / .pdf）'}
            </button>
          </div>

          <div className="pbt-body">
            {config && summary ? (
              <div className="pbt-result">
                <div className="pbt-result-head">
                  <div>
                    <span className="section-kicker">推导结果</span>
                    <h3>{fileName || '未命名标书'}</h3>
                  </div>
                </div>

                <div className="pbt-summary-grid">
                  <div className="pbt-summary-item">
                    <span>纸张</span>
                    <strong>{summary.paper}</strong>
                  </div>
                  <div className="pbt-summary-item">
                    <span>边距（上/下/左/右 cm）</span>
                    <strong>{summary.marginsCm.join(' / ')}</strong>
                  </div>
                  <div className="pbt-summary-item">
                    <span>一级标题</span>
                    <strong>{summary.headingFont || '-'} · {summary.headingSize || '-'}</strong>
                  </div>
                  <div className="pbt-summary-item">
                    <span>正文</span>
                    <strong>{summary.bodyFont || '-'} · {summary.bodySize || '-'}</strong>
                  </div>
                  <div className="pbt-summary-item">
                    <span>识别到的标题层级</span>
                    <strong>{summary.derivedHeadingLevels} 级</strong>
                  </div>
                </div>

                <label className="pbt-field">
                  <span>模版名称</span>
                  <input value={layoutName} onChange={(event) => setLayoutName(event.target.value)} placeholder="给这个模版起个名字" />
                </label>

                <div className="pbt-actions">
                  <button type="button" className="primary-action" onClick={handleSave} disabled={saving}>
                    {saving ? '保存中…' : '保存到我的模板'}
                  </button>
                  {saved ? (
                    <button type="button" className="secondary-action" onClick={() => onSectionChange?.('my-templates')}>
                      前往「我的模板」查看/微调
                    </button>
                  ) : null}
                </div>

                {summary.note ? <p className="pbt-hint">{summary.note}</p> : null}
                <p className="pbt-hint">保存后可在「模版设置 → 我的模板」里打开，逐项微调标题/正文/表格/图片样式，导出 Word 时即可选用。</p>
              </div>
            ) : (
              <div className="pbt-empty">
                <strong>还没有导入标书</strong>
                <span>点击右上角「导入标书（.docx / .pdf）」，系统会从该文件读取排版并生成 Word 模版。Word 样式精确，PDF 为近似推导。</span>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export default PastBidTemplatePage;
