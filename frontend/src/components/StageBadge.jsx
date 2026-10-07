import { stageLabel } from '../lib/uploads.js';

export function StageBadge({ upload }) {
  const tone = upload.stage === 'completed' ? 'good' : upload.stage === 'failed' ? 'bad' : '';
  const percent = upload.stage === 'importing' && upload.progress?.percent !== undefined ? ` ${upload.progress.percent}%` : '';
  return <span className={`badge ${tone}`}>{stageLabel(upload.stage)}{percent}</span>;
}
