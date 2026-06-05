import { Client, Stronghold } from '@tauri-apps/plugin-stronghold';
import { appLocalDataDir, join } from '@tauri-apps/api/path';

const VAULT_FILENAME = 'vault.hold';
const CLIENT_NAME = 'f95';
const CREDS_RECORD_KEY = 'creds';

export interface StoredCredentials {
  username: string;
  password: string;
}

let cachedStronghold: Stronghold | null = null;
let cachedClient: Client | null = null;

async function getClient(): Promise<Client> {
  if (cachedClient && cachedStronghold) return cachedClient;
  const dir = await appLocalDataDir();
  const vaultPath = await join(dir, VAULT_FILENAME);
  // Convenience-grade seed: derived from a constant + the install dir so the
  // password is reconstructible without prompting. Anyone with disk access can
  // re-derive it; this is intentional for an MVP and noted in the README.
  const seed = `f95-app::${dir}::v1`;
  const stronghold = await Stronghold.load(vaultPath, seed);
  let client: Client;
  try {
    client = await stronghold.loadClient(CLIENT_NAME);
  } catch {
    client = await stronghold.createClient(CLIENT_NAME);
  }
  cachedStronghold = stronghold;
  cachedClient = client;
  return client;
}

export async function saveCredentials(creds: StoredCredentials): Promise<void> {
  const client = await getClient();
  const store = client.getStore();
  const data = new TextEncoder().encode(JSON.stringify(creds));
  await store.insert(CREDS_RECORD_KEY, Array.from(data));
  await cachedStronghold!.save();
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  const client = await getClient();
  const store = client.getStore();
  try {
    const bytes = await store.get(CREDS_RECORD_KEY);
    if (!bytes || bytes.length === 0) return null;
    const json = new TextDecoder().decode(new Uint8Array(bytes));
    return JSON.parse(json) as StoredCredentials;
  } catch {
    return null;
  }
}

export async function clearCredentials(): Promise<void> {
  const client = await getClient();
  const store = client.getStore();
  try {
    await store.remove(CREDS_RECORD_KEY);
    await cachedStronghold!.save();
  } catch {
    // Record didn't exist — ignore
  }
  cachedStronghold = null;
  cachedClient = null;
}
