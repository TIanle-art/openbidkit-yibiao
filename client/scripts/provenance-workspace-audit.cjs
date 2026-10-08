// Audit real persisted data; --supplement adds only uniquely located candidates.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { getGeneratedImagesDir } = require('../electron/utils/paths.cjs');
const Database = require('better-sqlite3');
const { createTechnicalPlanStore } = require('../electron/services/technicalPlanStore.cjs');
const { createKnowledgeBaseStore } = require('../electron/services/knowledgeBaseStore.cjs');
const { createTaskLogStore } = require('../electron/services/taskLogStore.cjs');
const { readSectionProvenance } = require('../electron/services/sectionProvenanceService.cjs');
const { createProvenanceAttachmentService } = require('../electron/services/provenanceAttachmentService.cjs');

async function run() {
  const userData = process.env.PROVENANCE_USER_DATA;
  const output = process.env.PROVENANCE_REPORT;
  if (!userData || !output) throw new Error('Set PROVENANCE_USER_DATA and PROVENANCE_REPORT');
  app.setPath('userData', userData);
  const writable = process.argv.includes('--supplement');
  const db = new Database(path.join(userData, 'workspace', 'yibiao.sqlite'), { readonly: !writable });
  try {
    if (writable) await db.backup(`${output}.backup.sqlite`);
    const makeDeps = () => {
      const technicalPlanStore = createTechnicalPlanStore({ app, db, taskLogStore: createTaskLogStore({ db }) });
      const knowledge = createKnowledgeBaseStore({ app, db });
      return { app, technicalPlanStore, knowledgeBaseService: {
        readReferences: (...args) => knowledge.readReferences(...args),
        findImageDocuments: (...args) => knowledge.findImageDocuments(...args),
        resolveSourcePath: (id) => knowledge.resolvePath(knowledge.getDocument(id)?.source_path),
      }, imageLibraryService: { listImages: () => db.prepare('SELECT * FROM image_library_images').all() } };
    };
    const deps = makeDeps();
    const leaves = [];
    const walk = (items) => items.forEach((node) => node.children?.length ? walk(node.children) : leaves.push(node));
    walk(deps.technicalPlanStore.loadTechnicalPlan().outlineData.outline);
    const before = leaves.map((node) => readSectionProvenance({ ...deps, nodeId: node.id }));
    const actions = [];
    if (writable) {
      const service = createProvenanceAttachmentService(deps);
      for (const node of leaves) actions.push({ node_id: node.id, title: node.title, ...await service.supplementLocations(node.id) });
      if (process.env.PROVENANCE_TENDER_PDF) {
        const source = process.env.PROVENANCE_TENDER_PDF;
        const bytes = fs.readFileSync(source);
        const hash = crypto.createHash('sha256').update(bytes).digest('hex');
        const root = path.join(userData, 'workspace', 'provenance-evidence');
        fs.mkdirSync(root, { recursive: true });
        const stored = `f489-${hash}.pdf`;
        fs.writeFileSync(path.join(root, stored), bytes);
        const mapping = [
          ['报价函',49,50], ['法定代表人身份证明或授权委托书',51,52], ['联合体协议书',53,53],
          ['响应保证金',54,54], ['报价商务和技术偏差表',55,56], ['报价物资报价表',57,57],
          ['分项报价表及明细表',58,71], ['商务评审索引表',74,75], ['商务偏差表',76,76],
          ['资格审查资料',77,83], ['生产组织供应能力说明',85,85], ['承诺书',86,90],
          ['其他商务资料',91,91], ['技术评审索引表',94,95], ['技术偏差表',96,96],
        ];
        const { PDFParse } = require('pdf-parse');
        const parser = new PDFParse({ data: new Uint8Array(bytes) });
        try {
          const text = await parser.getText();
          assert.equal(text.total, 98, 'Expected reviewed F489 original PDF');
          const folder = path.join(getGeneratedImagesDir(app), 'provenance');
          fs.mkdirSync(folder, { recursive: true });
          for (const [title, first, last] of mapping) {
            const node = leaves.find((item) => item.title === title);
            if (!node) continue;
            const state = readSectionProvenance({ ...deps, nodeId: node.id });
            for (let page = first; page <= last; page++) {
              const render = await parser.getScreenshot({ partial: [page], desiredWidth: 1400, imageDataUrl: false });
              const filename = `${hash}-${page}.png`;
              fs.writeFileSync(path.join(folder, filename), render.pages.find((item) => item.pageNumber === page).data);
              deps.technicalPlanStore.saveSupplementalEvidence(node.id, {
                id: `f489-official-${page}`, kind: 'requirement', title: `${title} · 招标原页`,
                file_name: path.basename(source), stored_file: stored, file_hash: hash,
                content_hash: state.content_hash, physical_page: page, page_count: 98,
                section: title, excerpt: text.pages.find((item) => item.num === page)?.text || '',
                preview_url: `yibiao-asset://generated-images/provenance/${filename}`,
                confirmed: false, method: 'reviewed-template-page-map', recorded_at: new Date().toISOString(),
              });
            }
          }
        } finally { await parser.destroy(); }
      }
    }
    const fresh = makeDeps();
    const after = leaves.map((node) => readSectionProvenance({ ...fresh, nodeId: node.id }));
    assert.deepEqual(after.map((row) => row.content_hash), before.map((row) => row.content_hash), 'Supplement must preserve every body');
    const persisted = after.reduce((n, row) => n + row.entries.filter((entry) => entry.evidence_id).length, 0);
    let versionChangeVerified = false;
    if (writable && persisted) {
      const sample = after.find((row) => row.entries.some((entry) => entry.evidence_id));
      db.exec('BEGIN');
      try {
        const node = leaves.find((item) => item.id === sample.node_id);
        fresh.technicalPlanStore.saveChapterContent({ nodeId: node.id, content: `${node.content}\n版本检测临时文本` });
        const changed = readSectionProvenance({ ...makeDeps(), nodeId: node.id });
        assert.notEqual(changed.content_hash, sample.content_hash);
        assert.ok(changed.entries.some((entry) => entry.evidence_id && entry.status === 'changed'), 'Stale evidence must be flagged');
        assert.throws(() => createProvenanceAttachmentService(makeDeps()).confirm(node.id,
          sample.entries.find((entry) => entry.evidence_id).evidence_id, sample.content_hash), /正文已变化/);
        versionChangeVerified = true;
      } finally { db.exec('ROLLBACK'); }
      assert.equal(readSectionProvenance({ ...makeDeps(), nodeId: sample.node_id }).content_hash, sample.content_hash);
    }
    const report = { recorded_at: new Date().toISOString(), mode: writable ? 'supplement' : 'audit',
      checks: { bodies_unchanged: true, store_reopened: true, version_change_and_stale_confirmation: versionChangeVerified }, leaves: leaves.length, persisted_evidence: persisted,
      located: actions.reduce((n, action) => n + action.located, 0), actions, sections: after };
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ leaves: report.leaves, located: report.located, persisted, report: output }));
  } finally { db.close(); }
}
run().then(() => app.exit(0)).catch((error) => { console.error(error.stack); app.exit(1); });
