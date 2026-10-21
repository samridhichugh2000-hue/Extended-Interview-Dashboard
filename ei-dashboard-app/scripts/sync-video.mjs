// Camera-on tracking from Graph call records. Thin wrapper over syncVideo in
// lib/syncRunners.js so the Windows task and the Vercel route run the same code.
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { syncVideo } = await import('../lib/syncRunners.js');
console.log((await syncVideo()).message);
