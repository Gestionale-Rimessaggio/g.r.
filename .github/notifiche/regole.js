/* Pubblica firestore.rules nel database Firebase del cantiere.
   Lo lancia GitHub (workflow «Regole del database») quando le regole cambiano. */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

(async () => {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) { console.error('Manca il segreto FIREBASE_SERVICE_ACCOUNT.'); process.exit(1); }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  const testo = fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8');
  const r = await admin.securityRules().releaseFirestoreRulesetFromSource(testo);
  console.log('Regole pubblicate:', r.name, r.createTime);
})().catch((e) => { console.error('Regole NON pubblicate:', e.code || '', e.message); process.exit(1); });
