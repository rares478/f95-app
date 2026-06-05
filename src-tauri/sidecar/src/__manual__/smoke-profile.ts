import * as path from 'node:path';
import { F95Client } from '../f95';

const SESSION_DIR =
  process.env.SESSION_DIR ??
  path.join(
    process.env.LOCALAPPDATA ?? '',
    'com.f95.app',
    'sessions',
  );

async function main(): Promise<void> {
  const client = new F95Client({ sessionDir: SESSION_DIR });

  const loggedIn = await client.isLoggedIn();
  console.log('isLoggedIn:', loggedIn);
  if (!loggedIn) {
    console.error('NOT LOGGED IN — open the app and log in first');
    process.exit(1);
  }

  const profile = await client.getProfile();
  // Pretty-print everything except activity (just count + first entry)
  const { activity, ...rest } = profile;
  console.log('profile:', JSON.stringify(rest, null, 2));
  console.log(`activity: ${activity.length} items`);
  if (activity.length > 0) {
    console.log('first activity item:', JSON.stringify(activity[0], null, 2));
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
