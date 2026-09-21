const { app } = require('electron');
const path = require('node:path');
const Database = require('better-sqlite3');

app.whenReady().then(() => {
  const dbPath = path.join(process.env.APPDATA, 'yibiao-client', 'workspace', 'yibiao.sqlite');
  const db = new Database(dbPath, { readonly: true });
  
  const docs = db.prepare("SELECT * FROM knowledge_documents").all();
  console.log("Documents:", JSON.stringify(docs, null, 2));

  const steps = db.prepare("SELECT * FROM knowledge_document_steps").all();
  console.log("Steps:", JSON.stringify(steps, null, 2));

  app.quit();
});
