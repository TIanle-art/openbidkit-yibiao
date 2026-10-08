const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { dialog, shell, BrowserWindow } = require('electron');
const { getWorkspaceDir, getGeneratedImagesDir } = require('../utils/paths.cjs');
const { readSectionProvenance } = require('./sectionProvenanceService.cjs');

const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function createProvenanceAttachmentService(deps) {
  const { app, technicalPlanStore, knowledgeBaseService } = deps;
  const root = path.join(getWorkspaceDir(app), 'provenance-evidence');

  async function pdfPage(filePath, page, identity) {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(await fs.readFile(filePath)) });
    try {
      const result = await parser.getScreenshot({ partial: [page], desiredWidth: 1400, imageDataUrl: false });
      const screenshot = result.pages.find((item) => item.pageNumber === page);
      if (!screenshot) throw new Error(`PDF 没有物理页 ${page}（共 ${result.total} 页）`);
      const folder = path.join(getGeneratedImagesDir(app), 'provenance');
      await fs.mkdir(folder, { recursive: true });
      const filename = `${identity}-${page}.png`;
      await fs.writeFile(path.join(folder, filename), screenshot.data);
      return { url: `yibiao-asset://generated-images/provenance/${filename}`, total: result.total };
    } finally { await parser.destroy(); }
  }

  async function attach(payload, webContents) {
    const before = readSectionProvenance({ ...deps, nodeId: payload.node_id });
    const owner = BrowserWindow.fromWebContents(webContents);
    const options = { title: '选择小节证据原件', properties: ['openFile'], filters: [{ name: '证据文件', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'docx', 'doc', 'wps', 'md'] }] };
    const selected = await (owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options));
    if (selected.canceled || !selected.filePaths.length) return { canceled: true };
    const original = selected.filePaths[0];
    const bytes = await fs.readFile(original);
    const fileHash = digest(bytes);
    const ext = path.extname(original).toLowerCase();
    const id = crypto.randomUUID();
    await fs.mkdir(root, { recursive: true });
    const filename = `${id}${ext}`;
    const stored = path.join(root, filename);
    await fs.writeFile(stored, bytes);
    let preview = '';
    let total = null;
    try {
      if (ext === '.pdf') {
        if (!Number.isInteger(payload.physical_page) || payload.physical_page < 1) throw new Error('PDF 必须填写有效的物理页码');
        const result = await pdfPage(stored, payload.physical_page, fileHash);
        preview = result.url;
        total = result.total;
      } else if (['.png', '.jpg', '.jpeg'].includes(ext)) {
        const folder = path.join(getGeneratedImagesDir(app), 'provenance');
        await fs.mkdir(folder, { recursive: true });
        await fs.writeFile(path.join(folder, filename), bytes);
        preview = `yibiao-asset://generated-images/provenance/${filename}`;
      }
      // 文件选择/渲染期间正文可能已改变，提交前重新核对。
      const current = readSectionProvenance({ ...deps, nodeId: payload.node_id });
      if (current.content_hash !== before.content_hash || current.title !== before.title) throw new Error('小节已变化，请刷新后重新补证据');
      const evidence = { id, kind: payload.kind, title: payload.title, section: payload.section || '',
        target_entry_id: payload.target_entry_id || '', file_name: path.basename(original), stored_file: filename,
        file_hash: fileHash, content_hash: before.content_hash, excerpt: payload.excerpt || '',
        physical_page: ext === '.pdf' ? payload.physical_page : null, printed_page: payload.printed_page || '',
        page_count: total, preview_url: preview, confirmed: false, recorded_at: new Date().toISOString(),
      };
      technicalPlanStore.saveSupplementalEvidence(payload.node_id, evidence);
      return { canceled: false, evidence };
    } catch (error) {
      await fs.unlink(stored).catch(() => {});
      throw error;
    }
  }

  async function openSource(nodeId, entryId) {
    const data = readSectionProvenance({ ...deps, nodeId });
    const entry = data.entries.find((item) => item.id === entryId);
    const locator = entry?.source_locator;
    if (!locator) throw new Error('未保存可打开的来源文件，请补充证据');
    const filePath = locator.kind === 'attachment' ? path.join(root, locator.id)
      : locator.kind === 'knowledge' ? knowledgeBaseService.resolveSourcePath(locator.id)
        : technicalPlanStore.resolveProvenanceSourcePath(locator);
    if (!filePath) throw new Error('来源文件不存在，请补充原件');
    await fs.access(filePath);
    const error = await shell.openPath(filePath);
    if (error) throw new Error(error);
  }

  function locateText(markdown, text) {
    const normalized = (value) => String(value || '').replace(/\s+/g, '');
    const needle = normalized(text);
    if (needle.length < 20) return null;
    const source = normalized(markdown);
    const start = source.indexOf(needle);
    if (start < 0 || source.indexOf(needle, start + 1) >= 0) return null;
    const lines = String(markdown).split(/\r?\n/);
    let offset = 0;
    let section = '';
    for (let index = 0; index < lines.length; index += 1) {
      const heading = /^#{1,6}\s+(.+)/.exec(lines[index]);
      if (heading) section = heading[1];
      offset += normalized(lines[index]).length;
      if (offset > start) return { section, line: index + 1 };
    }
    return null;
  }

  async function supplementLocations(nodeId) {
    const data = readSectionProvenance({ ...deps, nodeId });
    const state = technicalPlanStore.loadTechnicalPlan();
    let located = 0;
    const supplemented = new Set((state.contentGenerationPlans?.[nodeId]?.plan?.supplemental_evidence || [])
      .filter((item) => !item.superseded).map((item) => item.target_entry_id));
    const pending = data.entries.filter((item) => !item.evidence_id && !supplemented.has(item.id) && !item.physical_page && item.kind !== 'image');
    const pdfTexts = new Map();
    const sourceErrors = [];
    for (const entry of pending.filter((item) => item.kind === 'requirement' && item.status === 'unlocated')) {
      const matches = (state.tenderFiles || []).flatMap((file) => {
        const result = locateText(technicalPlanStore.readTenderSourceMarkdown(file.id), entry.excerpt);
        return result ? [{ file, ...result }] : [];
      });
      if (matches.length !== 1) continue;
      const match = matches[0];
      technicalPlanStore.saveSupplementalEvidence(nodeId, { id: `location-${entry.id}`, target_entry_id: entry.id,
        kind: 'requirement', title: entry.title, file_name: match.file.fileName, section: match.section,
        excerpt: entry.excerpt, content_hash: data.content_hash, source_locator: { kind: 'tender', id: match.file.id },
        source_hash: match.file.contentHash, line: match.line, confirmed: false, method: 'unique-text', recorded_at: new Date().toISOString(),
      });
      located += 1;
    }
    for (const entry of pending.filter((item) => item.source_locator?.kind === 'knowledge')) {
      let filePath;
      try { filePath = knowledgeBaseService.resolveSourcePath(entry.source_locator.id); }
      catch { continue; }
      if (path.extname(filePath).toLowerCase() !== '.pdf') continue;
      try {
        if (!pdfTexts.has(filePath)) {
          const bytes = await fs.readFile(filePath);
          const { PDFParse } = require('pdf-parse');
          const parser = new PDFParse({ data: new Uint8Array(bytes) });
          try { pdfTexts.set(filePath, { pages: (await parser.getText()).pages, hash: digest(bytes) }); }
          finally { await parser.destroy(); }
        }
        const source = pdfTexts.get(filePath);
        const quote = (entry.source_blocks?.length ? entry.source_blocks.map((block) => block.content).join('\n') : entry.excerpt)
          .split(/\r?\n/).filter((line) => !line.includes('![') && !line.trim().startsWith('|'))
          .map((line) => line.replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '').trim())
          .filter((line) => line.replace(/\s/g, '').length >= 60).sort((a, b) => b.length - a.length)[0];
        if (!quote) continue;
        const needle = quote.replace(/\s+/g, '');
        const matches = source.pages.filter((page) => page.text.replace(/\s+/g, '').includes(needle));
        if (matches.length !== 1) continue;
        const matchedText = matches[0].text.replace(/\s+/g, '');
        if (matchedText.indexOf(needle, matchedText.indexOf(needle) + 1) >= 0) continue;
        const preview = await pdfPage(filePath, matches[0].num, source.hash);
        const current = readSectionProvenance({ ...deps, nodeId });
        if (current.content_hash !== data.content_hash) throw new Error('正文已变化，请重新定位');
        technicalPlanStore.saveSupplementalEvidence(nodeId, { id: `pdf-location-${entry.id}`, target_entry_id: entry.id,
          kind: entry.kind, title: entry.title, file_name: entry.file_name, section: entry.section,
          excerpt: quote, content_hash: data.content_hash, source_locator: entry.source_locator,
          file_hash: source.hash, physical_page: matches[0].num, page_count: preview.total, preview_url: preview.url,
          confirmed: false, method: 'pdf-text', recorded_at: new Date().toISOString(),
        });
        located += 1;
      } catch (error) { sourceErrors.push(`${entry.file_name}：${error.message}`); }
    }
    return { located, remaining: Math.max(0, pending.length - located), source_errors: [...new Set(sourceErrors)] };
  }

  function confirm(nodeId, evidenceId, contentHash) {
    const data = readSectionProvenance({ ...deps, nodeId });
    if (data.content_hash !== contentHash) throw new Error('正文已变化，请刷新后核对');
    const state = technicalPlanStore.loadTechnicalPlan();
    const evidence = state.contentGenerationPlans?.[nodeId]?.plan?.supplemental_evidence?.find((item) => item.id === evidenceId);
    const entry = data.entries.find((item) => item.evidence_id === evidenceId);
    if (!evidence || !entry || entry.status === 'missing') throw new Error('证据原件不可用，请重新补充');
    if ((evidence.file_hash && entry.current_hash !== evidence.file_hash) || (evidence.source_hash && entry.current_hash !== evidence.source_hash)) throw new Error('来源已变化，请重新补充原件或定位');
    technicalPlanStore.saveSupplementalEvidence(nodeId, { ...evidence, content_hash: data.content_hash, confirmed: true, reviewed_at: new Date().toISOString() });
  }

  return { attach, openSource, supplementLocations, confirm };
}

module.exports = { createProvenanceAttachmentService };
