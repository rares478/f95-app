import { formatDownloadSpeed } from '../../lib/downloadSettings';
import {
  padHistory,
  speedAxisTicks,
  speedHistoryMax,
  speedHistoryPolyline,
  type GraphHistory,
} from '../../lib/downloadSpeed';
import { useT } from '../../lib/i18n';

const VIEW_W = 600;
const VIEW_H = 88;

interface Props {
  history: GraphHistory;
  downloadBps: number;
  extractBps: number;
  speedInMbps: boolean;
}

export function DownloadSpeedGraph({
  history,
  downloadBps,
  extractBps,
  speedInMbps,
}: Props) {
  const { t } = useT();
  const download = padHistory(history.download);
  const extract = padHistory(history.extract);
  const peak = Math.max(
    speedHistoryMax(download),
    speedHistoryMax(extract),
    downloadBps,
    extractBps,
    1,
  );
  const ticks = speedAxisTicks(peak);
  const axisMax = Math.max(peak, ticks[ticks.length - 1] ?? peak);
  const dlPoints = speedHistoryPolyline(download, VIEW_W, VIEW_H, axisMax);
  const exPoints = speedHistoryPolyline(extract, VIEW_W, VIEW_H, axisMax);
  const dlArea = dlPoints ? `0,${VIEW_H} ${dlPoints} ${VIEW_W},${VIEW_H}` : '';
  const liveDl = downloadBps > 0;
  const liveEx = extractBps > 0;
  const showExtract = liveEx || extract.some((n) => n > 0);

  return (
    <section className="dl-speed-graph" aria-label={t('downloads.graph.label')}>
      <div className="dl-speed-graph-head">
        <span className="dl-speed-graph-kicker">{t('downloads.graph.label')}</span>
        <div className="dl-speed-graph-legend">
          <span className={`dl-speed-graph-value${liveDl ? ' is-live' : ''}`}>
            <i className="dl-speed-graph-swatch dl-speed-graph-swatch-dl" aria-hidden />
            {t('downloads.graph.download')}:{' '}
            {liveDl ? formatDownloadSpeed(downloadBps, speedInMbps) : '—'}
          </span>
          <span className={`dl-speed-graph-value is-extract${liveEx ? ' is-live' : ''}`}>
            <i className="dl-speed-graph-swatch dl-speed-graph-swatch-ex" aria-hidden />
            {t('downloads.graph.extract')}:{' '}
            {liveEx ? formatDownloadSpeed(extractBps, speedInMbps) : '—'}
          </span>
        </div>
      </div>
      <div className="dl-speed-graph-body">
        <div className="dl-speed-graph-yaxis" aria-hidden>
          {ticks
            .slice()
            .reverse()
            .map((bps) => (
              <span key={bps} style={{ bottom: `${(bps / axisMax) * 100}%` }}>
                {formatDownloadSpeed(bps, speedInMbps)}
              </span>
            ))}
        </div>
        <div className="dl-speed-graph-plot">
          {ticks.map((bps) => (
            <span
              key={bps}
              className="dl-speed-graph-gridline"
              style={{ bottom: `${(bps / axisMax) * 100}%` }}
            />
          ))}
          <svg
            className="dl-speed-graph-svg"
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="none"
            role="img"
          >
            <defs>
              <linearGradient id="dl-speed-fill-dl" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.4" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.04" />
              </linearGradient>
            </defs>
            {dlArea && <polygon points={dlArea} fill="url(#dl-speed-fill-dl)" />}
            {dlPoints && (
              <polyline
                points={dlPoints}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {showExtract && exPoints && (
              <polyline
                points={exPoints}
                fill="none"
                stroke="var(--status-purple)"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        </div>
      </div>
    </section>
  );
}
