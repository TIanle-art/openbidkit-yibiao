import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { MarkdownRenderer, useToast } from '../../../shared/ui';
import type { SectionProvenance, SectionProvenanceEntry, AttachSectionEvidenceRequest, QuotationAuditDecision, QuotationAuditState, AuditDecisionStatus } from '../types';

const statusLabels: Record<SectionProvenanceEntry['status'], string> = {
  recorded: '已记录', candidate: '待确认', missing: '缺依据', changed: '版本变化', unlocated: '待定位', generated: '生成图',
};
const tabs = [{ kind: 'requirement', title: '招标依据' }, { kind: 'content', title: '内容参考' }, { kind: 'image', title: '图片来源' }] as const;
const decisionStatuses: AuditDecisionStatus[] = ['待填写', '待核对', '待修复', '已核验'];
const humanDecisionValues = ['未审', '来源确认', '来源退回', '缺资料', '通过', '退回'] as const;
const normalizeHumanDecision = (value: unknown) => value === '待人工核验' ? '未审' : String(value || '未审');
const sourceFingerprint = (entry: SectionProvenanceEntry) => JSON.stringify([entry.file_name, entry.section, entry.physical_page, entry.snapshot_hash, entry.current_hash, entry.status, entry.source_locator, entry.excerpt, entry.images]);

interface Props {
  nodeId: string;
  content: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPreviewImage: (url: string, alt: string) => void;
}

export function SectionProvenanceDialog({ nodeId, content, open, onOpenChange, onPreviewImage }: Props) {
  const [data, setData] = useState<SectionProvenance | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<SectionProvenanceEntry['kind']>('requirement');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<AttachSectionEvidenceRequest | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [problemsOnly, setProblemsOnly] = useState(false);
  const { showToast } = useToast();
  const success = (message: string) => showToast(message, 'success');
  const showError = (message: string) => showToast(message, 'error');
  const info = (message: string) => showToast(message, 'info');
  useEffect(() => { setDraft(null); setSelectedId(''); setQuery(''); }, [nodeId, open]);
  const entries = (data?.entries || []).filter((entry) => entry.kind === kind
    && (!problemsOnly || !['recorded', 'generated'].includes(entry.status))
    && `${entry.title} ${entry.file_name} ${entry.section} ${entry.excerpt}`.toLowerCase().includes(query.toLowerCase()));
  const selected = entries.find((entry) => entry.id === selectedId) || entries.find((entry) => entry.images.length) || entries[0];
  const relatedKind = kind === 'requirement' ? 'content' : 'requirement';
  const related = (data?.entries || []).filter((entry) => entry.kind === relatedKind)
    .sort((a, b) => Number(b.images.length > 0) - Number(a.images.length > 0));
  const [relatedId, setRelatedId] = useState('');
  const [audit, setAudit] = useState<QuotationAuditState | null>(null);
  const [auditDecisions, setAuditDecisions] = useState<Record<string, QuotationAuditDecision>>({});
  const [auditSaving, setAuditSaving] = useState(false);
  const comparison = related.find((entry) => entry.id === relatedId) || related[0];
  const pendingFields = (content.match(/待补充[:：]|【待填】|\[待填\]/g) || []).length;
  const actionLabel = (entry: SectionProvenanceEntry) => ({ recorded: '核对内容适用性', candidate: '核对原件后确认', missing: '补充来源原件', changed: '重核正文与来源', unlocated: '补章节／原页', generated: '核对示意图内容' }[entry.status]);
  const renderEvidence = (entry?: SectionProvenanceEntry) => entry ? <>
    <div className="provenance-pane-meta"><strong>{entry.file_name || '缺来源文件'}</strong><span>{entry.section || '章节未定位'} · {entry.physical_page ? `PDF P${entry.physical_page}` : entry.page ? `引用页 ${entry.page}` : '原页未定位'}{entry.line ? ` · L${entry.line}` : ''}</span></div>
    {entry.images.length ? <div className="provenance-page-images">{entry.images.map((url) => <button type="button" key={url} onClick={() => onPreviewImage(url, entry.title)} title="放大原页"><img src={url} alt={entry.title} loading="lazy" /></button>)}</div>
      : <div className="provenance-text-source"><div className="provenance-no-page">无原页图 · 以下为来源摘录</div><MarkdownRenderer allowRawHtml={false}>{entry.excerpt || '缺原文：补充原件后核对'}</MarkdownRenderer></div>}
  </> : <div className="provenance-empty">无关联来源记录 · 需补证据</div>;
  const startSupplement = (entry?: SectionProvenanceEntry) => setDraft({ node_id: nodeId,
    target_entry_id: entry?.target_entry_id || entry?.id, kind: entry?.kind || kind, title: entry?.title || '',
    section: entry?.section || '', physical_page: entry?.physical_page || 1,
    printed_page: entry?.printed_page || '', excerpt: entry?.excerpt || '',
  });
  async function runAction(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); setRevision((value) => value + 1); }
    catch (reason) { showError(reason instanceof Error ? reason.message : '证据操作失败'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!open || !nodeId) return;
    let active = true;
    setData(null);
    setError('');
    setLoading(true);
    void Promise.all([window.yibiao.technicalPlan.readSectionProvenance(nodeId), window.yibiao.technicalPlan.loadQuotationAudit(nodeId)]).then(([result, savedAudit]) => {
      if (!active) return;
      setData(result);
      setAudit(savedAudit);
      setAuditDecisions(Object.fromEntries(savedAudit.decisions.map((decision) => [decision.evidence_id, decision])));
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : '来源读取失败');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [nodeId, open, revision]);

  const bodyChanged = Boolean(data && audit?.saved_content_hash && data.content_hash !== audit.saved_content_hash);
  const sourceChanged = (entry: SectionProvenanceEntry) => {
    const previous = auditDecisions[entry.id];
    return Boolean(previous && ((previous.source_fingerprint && previous.source_fingerprint !== sourceFingerprint(entry))
      || (data && previous.reviewed_content_hash && previous.reviewed_content_hash !== data.content_hash)
      || (bodyChanged && previous.reviewed_content_hash !== data?.content_hash)));
  };
  const selectedDecision = selected ? auditDecisions[selected.id] : undefined;
  const currentDecisionEntries = data?.entries || [];
  const confirmedCurrentCount = currentDecisionEntries.filter((entry) => auditDecisions[entry.id]?.status === '已核验' && !sourceChanged(entry)).length;
  const orphanDecisionCount = Object.keys(auditDecisions).filter((id) => !id.startsWith('quotation-field:')
    && !currentDecisionEntries.some((entry) => entry.id === id)).length;
  const importedFieldDecisions = Object.values(auditDecisions).filter((decision) => decision.evidence_id.startsWith('quotation-field:'));
  const saveAudit = async () => {
    if (!data) return;
    setAuditSaving(true);
    try {
      const decisions = Object.entries(auditDecisions).map(([evidenceId, decision]) => {
        const entry = data.entries.find((item) => item.id === evidenceId);
        return { ...decision, evidence_id: evidenceId,
          ...(entry && sourceChanged(entry) ? { status: '待核对' as const } : {}),
          ...(!decision.reviewed_content_hash && audit?.saved_content_hash ? { reviewed_content_hash: audit.saved_content_hash } : {}),
        };
      });
      const result = await window.yibiao.technicalPlan.saveQuotationAudit({ nodeId, contentHash: data.content_hash, decisions });
      if (!result.saved) { info('正文版本已变化；刷新后重新核对，再保存决定'); setRevision((value) => value + 1); return; }
      const next = await window.yibiao.technicalPlan.loadQuotationAudit(nodeId);
      setAudit(next);
      setAuditDecisions(Object.fromEntries(next.decisions.map((decision) => [decision.evidence_id, decision])));
      success('审查决定已保存');
    } catch (reason) { showError(reason instanceof Error ? reason.message : '审查决定保存失败'); }
    finally { setAuditSaving(false); }
  };

  const importFieldCard = async (file?: File) => {
    if (!file || !data) return;
    try {
      const incoming = JSON.parse(await file.text()) as {
        version?: number; node_id?: string; official_sha256?: string; software_sha256?: string; tender_sha256?: string;
        contract_sha256?: string; contract_pdf_sha256?: string; spares_sha256?: string; spares_pdf_sha256?: string;
        decisions?: Record<string, { field_id?: string; field_title?: string; state?: AuditDecisionStatus; decision?: string; note?: string; field_fingerprint?: string; saved_at?: string }>;
      };
      if (incoming.version !== 2 || incoming.node_id !== nodeId || incoming.software_sha256 !== data.content_hash
        || !incoming.official_sha256 || !incoming.tender_sha256 || !incoming.contract_sha256
        || !incoming.contract_pdf_sha256 || !incoming.spares_sha256 || !incoming.spares_pdf_sha256
        || !incoming.decisions || typeof incoming.decisions !== 'object') {
        throw new Error('卡片版本、节点或正文哈希不匹配；请从当前报价函字段卡重新导出。');
      }
      const imported: Record<string, QuotationAuditDecision> = {};
      const importedAt = new Date().toISOString();
      const batchId = `${incoming.official_sha256}:${incoming.software_sha256}:${incoming.tender_sha256}:${incoming.contract_sha256}:${incoming.contract_pdf_sha256}:${incoming.spares_sha256}:${incoming.spares_pdf_sha256}`;
      for (const [key, value] of Object.entries(incoming.decisions)) {
        const fieldId = String(value.field_id || key);
        if (!/^[a-z][a-z0-9_]{1,63}$/.test(fieldId)) throw new Error(`字段ID无效：${fieldId}`);
        if (!decisionStatuses.includes(value.state as AuditDecisionStatus)) throw new Error(`字段 ${fieldId} 的审查状态无效：${value.state}`);
        const humanDecision = normalizeHumanDecision(value.decision);
        if (!humanDecisionValues.includes(humanDecision as typeof humanDecisionValues[number])) {
          throw new Error(`字段 ${fieldId} 的人工决定值无效：${humanDecision}`);
        }
        const evidenceId = `quotation-field:${batchId}:${fieldId}`;
        const fieldFingerprint = String(value.field_fingerprint || '');
        imported[evidenceId] = {
          evidence_id: evidenceId, field_id: fieldId, field_title: String(value.field_title || fieldId),
          audit_batch_id: batchId, imported_at: importedAt,
          status: value.state as AuditDecisionStatus, note: String(value.note || ''), human_decision: humanDecision,
          field_fingerprint: fieldFingerprint, official_sha256: incoming.official_sha256,
          software_sha256: incoming.software_sha256, tender_sha256: incoming.tender_sha256,
          contract_sha256: incoming.contract_sha256, contract_pdf_sha256: incoming.contract_pdf_sha256,
          spares_sha256: incoming.spares_sha256, spares_pdf_sha256: incoming.spares_pdf_sha256,
          source_fingerprint: JSON.stringify([fieldFingerprint, incoming.official_sha256, incoming.software_sha256, incoming.tender_sha256,
            incoming.contract_sha256, incoming.contract_pdf_sha256, incoming.spares_sha256, incoming.spares_pdf_sha256]),
          reviewed_content_hash: data.content_hash, saved_at: String(value.saved_at || ''),
        };
      }
      if (!Object.keys(imported).length) throw new Error('文件内没有有效的字段审查决定。');
      const merged = { ...auditDecisions, ...imported };
      const result = await window.yibiao.technicalPlan.saveQuotationAudit({
        nodeId, contentHash: data.content_hash, decisions: Object.values(merged),
      });
      if (!result.saved) throw new Error('易标正文已变化；刷新字段卡后重新导出。');
      setAuditDecisions(merged);
      setAudit(await window.yibiao.technicalPlan.loadQuotationAudit(nodeId));
      success(`已导入并保存 ${Object.keys(imported).length} 项字段决定`);
    } catch (reason) {
      showError(reason instanceof Error ? reason.message : '字段决定导入失败');
    }
  };

  const exportFieldCardDecisions = () => {
    const currentBodyBatches = new Map<string, QuotationAuditDecision[]>();
    for (const item of importedFieldDecisions.filter((decision) => decision.software_sha256 === data?.content_hash)) {
      const batchId = item.audit_batch_id || [item.official_sha256, item.software_sha256, item.tender_sha256,
        item.contract_sha256, item.contract_pdf_sha256, item.spares_sha256, item.spares_pdf_sha256].join(':');
      currentBodyBatches.set(batchId, [...(currentBodyBatches.get(batchId) || []), item]);
    }
    if (!currentBodyBatches.size) { info('当前正文版本没有可导出的字段决定'); return; }
    const latestBatch = [...currentBodyBatches.values()].sort((a, b) => (b[0].imported_at || '').localeCompare(a[0].imported_at || ''))[0];
    const first = latestBatch[0];
    const decisions = Object.fromEntries(latestBatch.map((item) => [item.field_id || item.evidence_id.split(':').pop(), {
      field_id: item.field_id, field_title: item.field_title, state: item.status, decision: item.human_decision || '未审',
      note: item.note, field_fingerprint: item.field_fingerprint || '', saved_at: item.saved_at || '',
      official_sha256: item.official_sha256, software_sha256: item.software_sha256, tender_sha256: item.tender_sha256,
      contract_sha256: item.contract_sha256, contract_pdf_sha256: item.contract_pdf_sha256,
      spares_sha256: item.spares_sha256, spares_pdf_sha256: item.spares_pdf_sha256,
    }]));
    const payload = { version: 2, node_id: nodeId, audit_batch_id: first.audit_batch_id, official_sha256: first.official_sha256,
      software_sha256: first.software_sha256 || data?.content_hash, tender_sha256: first.tender_sha256,
      contract_sha256: first.contract_sha256, contract_pdf_sha256: first.contract_pdf_sha256,
      spares_sha256: first.spares_sha256, spares_pdf_sha256: first.spares_pdf_sha256, decisions };
    void window.yibiao.technicalPlan.exportQuotationAuditDecisions({ content: JSON.stringify(payload, null, 2) }).then((result) => {
      if (result.success) success(`已导出字段决定：${result.path || ''}`);
      else if (result.message !== '已取消导出') showError(result.message || '字段决定导出失败');
    }).catch((reason: unknown) => showError(reason instanceof Error ? reason.message : '字段决定导出失败'));
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="content-regenerate-modal" />
        <Dialog.Content className="section-provenance-dialog" aria-describedby="section-provenance-description">
          <header className="section-provenance-head">
            <div>
              <Dialog.Title>小节审查 · {nodeId} {data?.title || ''}</Dialog.Title>
              <Dialog.Description id="section-provenance-description">正文 / 招标 / 参考对照 · 来源确认与内容验收分别核对</Dialog.Description>
            </div>
            <Dialog.Close className="secondary-action">关闭</Dialog.Close>
          </header>
          <nav className="section-provenance-tabs" aria-label="来源类型">
            {tabs.map((tab) => <button key={tab.kind} type="button" className={kind === tab.kind ? 'primary-action' : 'secondary-action'} aria-pressed={kind === tab.kind} onClick={() => setKind(tab.kind)}>
              {tab.title} {data?.entries.filter((entry) => entry.kind === tab.kind).length ?? 0}
            </button>)}
            <button type="button" className="secondary-action" disabled={loading || busy} onClick={() => setRevision((value) => value + 1)}>刷新</button>
            <button type="button" className="secondary-action" disabled={loading || busy} onClick={() => void runAction(async () => {
              const result = await window.yibiao.technicalPlan.supplementSectionLocations(nodeId);
              info(`定位候选 ${result.located} 项；未定位 ${result.remaining} 项`);
              if (result.source_errors.length) showError(result.source_errors.join('；'));
            })}>补定位</button>
            <button type="button" className="primary-action" disabled={loading || busy || !data} onClick={() => startSupplement()}>补充证据</button>
            <button type="button" className="primary-action" disabled={loading || auditSaving || !data} onClick={() => void saveAudit()}>{auditSaving ? '保存中…' : '保存审查结论'}</button>
            <label className="secondary-action" aria-label="导入报价函字段卡决定">导入字段决定<input type="file" accept="application/json,.json" hidden disabled={loading || auditSaving || !data} onChange={(event) => { const file = event.currentTarget.files?.[0]; void importFieldCard(file); event.currentTarget.value = ''; }} /></label>
            <button type="button" className="secondary-action" disabled={!importedFieldDecisions.length} onClick={exportFieldCardDecisions}>导出字段决定 {importedFieldDecisions.length || ''}</button>
          </nav>
          <div className="section-provenance-workspace">
          <aside className="provenance-directory">
            <input aria-label="搜索证据" placeholder="搜索文件／章节／原文" value={query} onChange={(event) => setQuery(event.target.value)} />
            <label className="provenance-problem-toggle"><input type="checkbox" checked={problemsOnly} onChange={(event) => setProblemsOnly(event.target.checked)} />仅待处理</label>
            <small>{entries.length} 条证据 · {entries.filter((entry) => entry.images.length).length} 条带图</small>
            <div className="provenance-directory-list">{entries.map((entry, index) => <button type="button" key={entry.id} className={selected?.id === entry.id ? 'is-active' : ''} onClick={() => setSelectedId(entry.id)}>
              <span className={`provenance-state is-${entry.status}`}>{statusLabels[entry.status]}</span><strong>{String(index + 1).padStart(2, '0')} {entry.title}</strong>
              <small>{entry.file_name || '缺来源'} · {entry.physical_page ? `P${entry.physical_page}` : entry.line ? `L${entry.line}` : '未定位'}{entry.images.length ? ` · 图${entry.images.length}` : ''}</small>
            </button>)}</div>
          </aside>
          <div className="section-provenance-body">
            {bodyChanged && <p className="section-provenance-warning">正文版本已变化：已保存的人工决定保留为历史记录，本次需重新核对后再保存。</p>}
            {draft && <form className="section-provenance-form" onSubmit={(event) => {
              event.preventDefault();
              void runAction(async () => {
                const result = await window.yibiao.technicalPlan.attachSectionEvidence(draft);
                if (!result.canceled) { setDraft(null); success('证据已保存，请查看原页后确认来源'); }
              });
            }}>
              <strong>补充原件</strong>
              <div className="section-provenance-form-grid">
                <label>用途<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as SectionProvenanceEntry['kind'] })}>{tabs.map((tab) => <option key={tab.kind} value={tab.kind}>{tab.title}</option>)}</select></label>
                <label>证据名称<input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
                <label>来源章节<input value={draft.section} onChange={(event) => setDraft({ ...draft, section: event.target.value })} /></label>
                <label>PDF 物理页<input required type="number" min="1" step="1" value={draft.physical_page} onChange={(event) => setDraft({ ...draft, physical_page: Number(event.target.value) })} /></label>
                <label>原页脚页码<input value={draft.printed_page} onChange={(event) => setDraft({ ...draft, printed_page: event.target.value })} /></label>
              </div>
              <label>证据摘录<textarea value={draft.excerpt} onChange={(event) => setDraft({ ...draft, excerpt: event.target.value })} /></label>
              <small>选择原件后保存副本；PDF 自动显示所选物理页。非 PDF 不使用物理页字段。</small>
              <div className="section-provenance-tabs"><button type="submit" className="primary-action" disabled={busy}>选择原件并保存</button><button type="button" className="secondary-action" disabled={busy} onClick={() => setDraft(null)}>取消</button></div>
            </form>}
            {loading && <p role="status">正在读取来源…</p>}
            {error && <p role="alert">{error} · 点击刷新重试</p>}
            {data?.warnings.map((warning) => <p className="section-provenance-warning" key={warning}>{warning}</p>)}
            {!!importedFieldDecisions.length && <section className="section-provenance-card">
              <header><strong>报价函字段卡人工决定</strong><span>{importedFieldDecisions.length} 项 · 已写入易标</span></header>
              <p className="section-provenance-location">来源 SHA：正式稿 {importedFieldDecisions[0].official_sha256?.slice(0, 12)} · 正文 {importedFieldDecisions[0].software_sha256?.slice(0, 12)} · 招标 {importedFieldDecisions[0].tender_sha256?.slice(0, 12)}</p>
              <div className="provenance-directory-list">{importedFieldDecisions.map((item) => {
                const stale = bodyChanged || Boolean(data && item.reviewed_content_hash && item.reviewed_content_hash !== data.content_hash)
                  || Boolean(data && item.software_sha256 && item.software_sha256 !== data.content_hash);
                return <div key={item.evidence_id}><span className="provenance-state is-recorded">{stale ? '版本过期 · 待核对' : item.status}</span><strong>{item.field_title || item.field_id}</strong><small>{item.human_decision || '未审'} · {item.note || '无备注'} · 批次 {item.audit_batch_id?.slice(0, 12) || '旧版'}</small></div>;
              })}</div>
            </section>}
            {data && !data.entries.some((entry) => entry.kind === kind) && <p>暂无记录</p>}
            {(selected ? [selected] : []).map((entry) => (
              <article key={entry.id} className="section-provenance-card">
                <header><strong>{entry.title}</strong><span className={`content-status-badge is-${entry.status === 'recorded' || entry.status === 'generated' ? 'success' : 'pending'}`}>{statusLabels[entry.status]}</span></header>
                <p className="section-provenance-location">{entry.file_name || '文件待补'} · {entry.section || '章节待定位'} · {entry.physical_page ? `物理页 ${entry.physical_page}` : entry.page ? `引用页 ${entry.page}` : '物理页待定位'}{entry.printed_page ? ` · 页脚 ${entry.printed_page}` : ''}{entry.line ? ` · 解析行 ${entry.line}` : ''}</p>
                <div className="provenance-issue-strip"><b>动作：{actionLabel(entry)}</b><span>{entry.message}</span></div>
                <section className="quotation-audit-decision">
                  <label>审查结论<select value={sourceChanged(entry) ? '待核对' : selectedDecision?.status || '待核对'} onChange={(event) => setAuditDecisions((current) => ({ ...current, [entry.id]: { evidence_id: entry.id, status: event.target.value as AuditDecisionStatus, note: current[entry.id]?.note || '', source_fingerprint: sourceFingerprint(entry), reviewed_content_hash: data?.content_hash } }))}>{decisionStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
                  <label>问题 / 后续动作<textarea rows={2} value={selectedDecision?.note || ''} placeholder="填写差异、待补字段或人工处理动作" onChange={(event) => setAuditDecisions((current) => ({ ...current, [entry.id]: { evidence_id: entry.id, status: current[entry.id]?.status || '待核对', note: event.target.value, source_fingerprint: sourceFingerprint(entry), reviewed_content_hash: data?.content_hash } }))} /></label>
                  {sourceChanged(entry) && <small className="section-provenance-warning">来源内容或页图变化：此结论待重新核对。</small>}
                </section>
                <div className="section-provenance-entry-actions">
                  {entry.source_locator && <button type="button" className="secondary-action" disabled={busy} onClick={() => void runAction(() => window.yibiao.technicalPlan.openSectionSource(nodeId, entry.id))}>打开来源文件</button>}
                  <button type="button" className="secondary-action" disabled={busy} onClick={() => startSupplement(entry)}>补证据</button>
                  {entry.evidence_id && entry.status !== 'recorded' && entry.status !== 'missing' && <button type="button" className="primary-action" disabled={busy} onClick={() => void runAction(async () => {
                    if (!data) return;
                    await window.yibiao.technicalPlan.confirmSectionEvidence(nodeId, entry.evidence_id!, data.content_hash);
                    success('来源已确认；内容及适用性仍需审核');
                  })}>确认来源</button>}
                </div>
                <div className="provenance-compare-grid">
                  <section className="provenance-pane"><header>① 当前正文 <span>待填标记 {pendingFields} · 非导出版式</span></header><div className="provenance-pane-scroll provenance-current"><MarkdownRenderer allowRawHtml={false}>{content || '本小节无正文'}</MarkdownRenderer></div></section>
                  <section className="provenance-pane"><header>② {tabs.find((tab) => tab.kind === kind)?.title}<span>{statusLabels[entry.status]}</span></header><div className="provenance-pane-scroll">{renderEvidence(entry)}</div></section>
                  <section className="provenance-pane"><header>③ {relatedKind === 'content' ? '内容参考' : '招标依据'} <span>小节关联 · 未逐句匹配</span></header>
                    {related.length > 1 && <select aria-label="切换对照来源" value={comparison?.id || ''} onChange={(event) => setRelatedId(event.target.value)}>{related.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.physical_page ? `P${item.physical_page}` : item.section || '待定位'}</option>)}</select>}
                    <div className="provenance-pane-scroll">{renderEvidence(comparison)}</div>
                  </section>
                </div>
                {!!entry.images.length && !!entry.excerpt && <details><summary>原页文字摘录</summary><MarkdownRenderer allowRawHtml={false}>{entry.excerpt}</MarkdownRenderer></details>}
                {!!entry.source_blocks?.length && <details><summary>查看原始块 {entry.source_blocks.length}</summary>{entry.source_blocks.map((block) => <section key={block.id}><strong>{block.id} · {block.heading_path.join(' / ')}</strong><MarkdownRenderer allowRawHtml={false}>{block.content}</MarkdownRenderer></section>)}</details>}
                <details><summary>定位记录</summary><dl><dt>来源块</dt><dd>{entry.block_ids.join(' / ') || '未记录'}</dd><dt>快照哈希</dt><dd>{entry.snapshot_hash || '未记录'}</dd><dt>当前哈希</dt><dd>{entry.current_hash || '未记录'}</dd></dl></details>
              </article>
            ))}
          </div>
          </div>
          <footer>缺依据 {data?.summary.missing ?? 0} · 待确认 {data?.summary.candidates ?? 0} · 来源变化 {data?.summary.changed ?? 0} · 当前证据结论 {confirmedCurrentCount}/{currentDecisionEntries.length} 已核验 · 失去对应来源的历史结论 {orphanDecisionCount} 条 · 保存于 {audit?.updated_at || '未保存'} · 无页码 {data?.summary.pages_pending ?? 0}</footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
