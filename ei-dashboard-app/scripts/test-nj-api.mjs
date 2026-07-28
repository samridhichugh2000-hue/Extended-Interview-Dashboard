import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getNewJoiners } = await import('../lib/koenigApi.js');

const to = new Date();
const from = new Date(to);
from.setMonth(from.getMonth() - 6);
const fmt = (d) => d.toISOString().slice(0, 10);

const joiners = await getNewJoiners(fmt(from), fmt(to));
console.log(`New joiners from ${fmt(from)} to ${fmt(to)}: ${joiners.length}`);
console.log(joiners.slice(0, 5));
