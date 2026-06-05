import { resolveMixdrop, resolveMixdropParsed } from '../domain/resolvers/mixdrop';

async function main() {
  const url = 'https://mixdrop.ag/f/zp4qakpxho9vgr';
  const parsed = await resolveMixdropParsed(url);
  console.log('mirror', parsed.pageUrl);
  const res = await resolveMixdrop(url);
  console.log('ok', res.fileName, res.directUrl.slice(0, 120));
}

main().catch((e) => {
  console.error('fail', e);
  process.exit(1);
});
